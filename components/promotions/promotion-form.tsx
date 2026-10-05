"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createPromotion } from "@/lib/actions/promotions";
import { parseEgpToPiasters } from "@/lib/money";
import { searchProductsClient } from "@/lib/supabase/queries/products-client";
import type { Tables } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type CategoryOption = { id: string; name_ar: string; name_en: string };

const NO_CATEGORY = "__all";

/** Creates a promotion. Terms are immutable afterwards (only active/inactive changes), so history stays truthful. */
export function PromotionForm({ categories }: { categories: CategoryOption[] }) {
  const t = useTranslations("promotions");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [code, setCode] = useState("");
  const [scope, setScope] = useState<"items" | "order">("items");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [categoryId, setCategoryId] = useState(NO_CATEGORY);
  const [products, setProducts] = useState<Tables<"products">[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [customerRequired, setCustomerRequired] = useState(false);
  const [stackable, setStackable] = useState(false);
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [maxPerCustomer, setMaxPerCustomer] = useState("");
  const [priority, setPriority] = useState("100");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const { data: results = [] } = useQuery({
    queryKey: ["promo-product-search", debounced],
    queryFn: () => searchProductsClient(debounced),
    enabled: debounced.length >= 1 && scope === "items",
    staleTime: 30_000,
  });

  const percent = kind === "percent" ? Number(value) : null;
  const fixed = kind === "fixed" ? parseEgpToPiasters(value) : null;
  const valueOk = kind === "percent" ? percent !== null && percent > 0 && percent <= 100 : fixed !== null && fixed > 0;
  const valid = nameEn.trim() !== "" && nameAr.trim() !== "" && valueOk;

  function submit() {
    startTransition(async () => {
      const result = await createPromotion({
        nameEn,
        nameAr,
        code: code || undefined,
        scope,
        discountKind: kind,
        percentBp: kind === "percent" ? Math.round(Number(value) * 100) : undefined,
        fixedAmount: kind === "fixed" ? (fixed ?? undefined) : undefined,
        categoryId: scope === "items" && categoryId !== NO_CATEGORY ? categoryId : undefined,
        productIds: scope === "items" && products.length ? products.map((product) => product.id) : undefined,
        minSpend: parseEgpToPiasters(minSpend) ?? 0,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        customerRequired,
        stackable,
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
        maxPerCustomer: maxPerCustomer ? Number(maxPerCustomer) : undefined,
        priority: Number(priority) || 100,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("created"));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field id="p-name-en" label={t("nameEn")}>
              <Input id="p-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </Field>
            <Field id="p-name-ar" label={t("nameAr")}>
              <Input id="p-name-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </Field>
          </div>
          <Field id="p-code" label={t("code")}>
            <Input id="p-code" dir="ltr" className="uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("codeHint")} />
          </Field>

          <div className="grid gap-1.5">
            <Label>{t("scope")}</Label>
            <Tabs value={scope} onValueChange={(v) => setScope(v as "items" | "order")}>
              <TabsList className="w-full">
                <TabsTrigger value="items" className="flex-1">{t("scopeItems")}</TabsTrigger>
                <TabsTrigger value="order" className="flex-1">{t("scopeOrder")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("kind")}</Label>
              <Tabs value={kind} onValueChange={(v) => setKind(v as "percent" | "fixed")}>
                <TabsList className="w-full">
                  <TabsTrigger value="percent" className="flex-1">%</TabsTrigger>
                  <TabsTrigger value="fixed" className="flex-1">{t("fixed")}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Field id="p-value" label={kind === "percent" ? t("percentValue") : scope === "items" ? t("fixedPerUnit") : t("fixedPerOrder")}>
              <Input id="p-value" dir="ltr" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          </div>

          {scope === "items" && (
            <div className="grid gap-3 rounded-md border p-3">
              <p className="text-muted-foreground text-xs">{t("eligibilityHint")}</p>
              <div className="grid gap-1.5">
                <Label>{t("category")}</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{t("anyCategory")}</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {locale === "ar" ? category.name_ar : category.name_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-products">{t("products")}</Label>
                <Input id="p-products" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("addProduct")} />
                {results.length > 0 && query.trim() !== "" && (
                  <div className="rounded-md border p-1">
                    {results.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className="hover:bg-accent flex w-full rounded px-2 py-1.5 text-start text-sm"
                        onClick={() => {
                          setProducts((current) => (current.some((p) => p.id === product.id) ? current : [...current, product]));
                          setQuery("");
                        }}
                      >
                        {locale === "ar" ? product.name_ar : product.name_en}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {products.map((product) => (
                    <span key={product.id} className="bg-secondary flex items-center gap-1 rounded px-2 py-1 text-xs">
                      {locale === "ar" ? product.name_ar : product.name_en}
                      <button type="button" aria-label={t("removeProduct")} onClick={() => setProducts((c) => c.filter((p) => p.id !== product.id))}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field id="p-min" label={t("minSpend")}>
              <Input id="p-min" dir="ltr" inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} />
            </Field>
            <Field id="p-priority" label={t("priority")}>
              <Input id="p-priority" dir="ltr" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </Field>
            <Field id="p-start" label={t("startsAt")}>
              <Input id="p-start" dir="ltr" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field id="p-end" label={t("endsAt")}>
              <Input id="p-end" dir="ltr" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
            <Field id="p-max" label={t("maxRedemptions")}>
              <Input id="p-max" dir="ltr" inputMode="numeric" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
            </Field>
            <Field id="p-max-customer" label={t("maxPerCustomer")}>
              <Input id="p-max-customer" dir="ltr" inputMode="numeric" value={maxPerCustomer} onChange={(e) => setMaxPerCustomer(e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Switch id="p-customer" checked={customerRequired} onCheckedChange={setCustomerRequired} />
              <Label htmlFor="p-customer">{t("customerRequired")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="p-stack" checked={stackable} onCheckedChange={setStackable} />
              <Label htmlFor="p-stack" className="grid gap-0.5">
                <span>{t("stackable")}</span>
                <span className="text-muted-foreground text-xs font-normal">{t("stackableHint")}</span>
              </Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
