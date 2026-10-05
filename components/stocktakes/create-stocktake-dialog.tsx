"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createStocktake } from "@/lib/actions/stocktakes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

/** Starts a full or cycle count; expected quantities are frozen the moment it is created. */
export function CreateStocktakeDialog({ categories }: { categories: CategoryOption[] }) {
  const t = useTranslations("stocktakes");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"full" | "cycle">("full");
  const [categoryId, setCategoryId] = useState<string>("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const canCreate = scope === "full" || categoryId !== "";

  function create() {
    startTransition(async () => {
      const result = await createStocktake({
        scope,
        categoryId: scope === "cycle" ? categoryId : undefined,
        note: note || undefined,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setOpen(false);
      router.push(`/stocktakes/${result.data.stocktakeId}`);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Tabs value={scope} onValueChange={(value) => setScope(value as "full" | "cycle")}>
            <TabsList className="w-full">
              <TabsTrigger value="full" className="flex-1">
                {t("scopeFull")}
              </TabsTrigger>
              <TabsTrigger value="cycle" className="flex-1">
                {t("scopeCycle")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {scope === "cycle" && (
            <div className="grid gap-2">
              <Label>{t("category")}</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("pickCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {locale === "ar" ? category.name_ar : category.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="stocktake-note">{t("noteOptional")}</Label>
            <Input id="stocktake-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={create} disabled={pending || !canCreate}>
            {t("start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
