"use client";

import { useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageOff, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { createProduct, updateProduct } from "@/lib/actions/products";
import {
  productFormSchema,
  toProductInput,
  toFormValues,
  type ProductFormValues,
} from "@/lib/validation/product";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldError, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_CATEGORY = "none";

type Props = {
  categories: Tables<"categories">[];
  product?: Tables<"products">;
  /** prefill for quick-create from the register's unknown-barcode toast */
  defaultBarcode?: string;
};

export function ProductForm({ categories, product, defaultBarcode }: Props) {
  const t = useTranslations("products.form");
  const tErrors = useTranslations("errors");
  const tFieldErrors = useTranslations("fieldErrors");
  const locale = useLocale();
  const router = useRouter();
  const isEdit = product !== undefined;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null);
  const [submitting, setSubmitting] = useState(false);

  // useForm ≈ Vuetify's v-form + rules, but validation lives in the Zod
  // schema and field state comes from register/Controller instead of v-model.
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: product
      ? toFormValues(product)
      : {
          barcode: defaultBarcode ?? "",
          name_ar: "",
          name_en: "",
          plu_code: "",
          category_id: "",
          price: "",
          cost: "0",
          taxRatePercent: "14",
          unit: "piece",
          stock_qty: "0",
          low_stock_threshold: "10",
          active: true,
        },
  });

  const previewUrl = imageFile ? URL.createObjectURL(imageFile) : imageUrl;

  async function uploadImage(): Promise<string | null | "failed"> {
    if (!imageFile) return imageUrl; // untouched (or removed → null)
    const supabase = createClient();
    const ext = imageFile.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, imageFile);
    if (error) return "failed";
    return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  }

  async function onSubmit(values: ProductFormValues) {
    setSubmitting(true);
    try {
      const uploaded = await uploadImage();
      if (uploaded === "failed") {
        toast.error(tErrors("imageUploadFailed"));
        return;
      }

      const input = toProductInput(values, uploaded);
      if ("fieldError" in input) {
        form.setError(input.fieldError.field, { message: input.fieldError.message });
        return;
      }
      // Stock is only set at creation; afterwards it changes exclusively
      // through audited stock adjustments (updateProduct ignores stock_qty).
      const result = isEdit ? await updateProduct(product.id, input) : await createProduct(input);
      if (!result.ok) {
        if (result.error === "duplicateBarcode") {
          form.setError("barcode", { message: "duplicateBarcode" });
        }
        if (result.error === "duplicatePlu") {
          form.setError("plu_code", { message: "duplicatePlu" });
        }
        toast.error(tErrors(result.error));
        return;
      }

      toast.success(isEdit ? t("saved") : t("created"));
      router.push("/products");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const err = (field: keyof ProductFormValues) => {
    const message = form.formState.errors[field]?.message;
    return message ? <FieldError>{tFieldErrors(message)}</FieldError> : null;
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="name_ar">{t("nameAr")}</FieldLabel>
            <Input id="name_ar" dir="rtl" {...form.register("name_ar")} />
            {err("name_ar")}
          </Field>
          <Field>
            <FieldLabel htmlFor="name_en">{t("nameEn")}</FieldLabel>
            <Input id="name_en" dir="ltr" {...form.register("name_en")} />
            {err("name_en")}
          </Field>
          <Field>
            <FieldLabel htmlFor="barcode">{t("barcode")}</FieldLabel>
            <Input id="barcode" dir="ltr" className="font-mono" {...form.register("barcode")} />
            {err("barcode")}
          </Field>
          <Field>
            <FieldLabel htmlFor="plu_code">{t("plu")}</FieldLabel>
            <Input id="plu_code" dir="ltr" inputMode="numeric" className="font-mono" {...form.register("plu_code")} />
            <FieldDescription>{t("pluHint")}</FieldDescription>
            {err("plu_code")}
          </Field>
          <Field>
            <FieldLabel>{t("category")}</FieldLabel>
            <Controller
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <Select
                  value={field.value === "" ? NO_CATEGORY : field.value}
                  onValueChange={(v) => field.onChange(v === NO_CATEGORY ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{t("noCategory")}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {locale === "ar" ? c.name_ar : c.name_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="price">{t("price")}</FieldLabel>
            <Input id="price" dir="ltr" inputMode="decimal" {...form.register("price")} />
            <FieldDescription>{t("priceHint")}</FieldDescription>
            {err("price")}
          </Field>
          <Field>
            <FieldLabel htmlFor="cost">{t("cost")}</FieldLabel>
            <Input id="cost" dir="ltr" inputMode="decimal" {...form.register("cost")} />
            {err("cost")}
          </Field>
          <Field>
            <FieldLabel htmlFor="taxRatePercent">{t("taxRate")}</FieldLabel>
            <Input
              id="taxRatePercent"
              dir="ltr"
              inputMode="decimal"
              {...form.register("taxRatePercent")}
            />
            <FieldDescription>{t("taxRateHint")}</FieldDescription>
            {err("taxRatePercent")}
          </Field>
          <Field>
            <FieldLabel>{t("unit")}</FieldLabel>
            <Controller
              control={form.control}
              name="unit"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="piece">{t("unitPiece")}</SelectItem>
                    <SelectItem value="kg">{t("unitKg")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="stock_qty">{t("stockQty")}</FieldLabel>
            <Input
              id="stock_qty"
              dir="ltr"
              inputMode="decimal"
              disabled={isEdit}
              {...form.register("stock_qty")}
            />
            {isEdit && <FieldDescription>{t("stockQtyLocked")}</FieldDescription>}
            {err("stock_qty")}
          </Field>
          <Field>
            <FieldLabel htmlFor="low_stock_threshold">{t("lowStockThreshold")}</FieldLabel>
            <Input
              id="low_stock_threshold"
              dir="ltr"
              inputMode="decimal"
              {...form.register("low_stock_threshold")}
            />
            {err("low_stock_threshold")}
          </Field>
          <Field orientation="horizontal" className="sm:col-span-2">
            <Controller
              control={form.control}
              name="active"
              render={({ field }) => (
                <Switch id="active" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <FieldLabel htmlFor="active">{t("active")}</FieldLabel>
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("image")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="aspect-square w-32 rounded-lg border object-cover"
              />
            ) : (
              <div className="bg-muted text-muted-foreground flex aspect-square w-32 items-center justify-center rounded-lg border">
                <ImageOff className="size-6" />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                {t("chooseImage")}
              </Button>
              {previewUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImageFile(null);
                    setImageUrl(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  {t("removeImage")}
                </Button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            />
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? t("save") : t("create")}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/products")}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    </form>
  );
}
