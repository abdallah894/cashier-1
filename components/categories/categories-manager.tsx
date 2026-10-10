"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createCategory, updateCategory, deleteCategory } from "@/lib/actions/categories";
import type { Category } from "@/lib/supabase/queries/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = Category & { productCount: number };

export function CategoriesManager({ categories }: { categories: Row[] }) {
  const t = useTranslations("categories");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setNameAr("");
    setNameEn("");
    setShowErrors(false);
    setDialogOpen(true);
  }

  function openEdit(row: Row) {
    setEditing(row);
    setNameAr(row.name_ar);
    setNameEn(row.name_en);
    setShowErrors(false);
    setDialogOpen(true);
  }

  async function submit() {
    if (!nameAr.trim() || !nameEn.trim()) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      const input = {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        sort_order: editing?.sort_order ?? categories.length,
      };
      const result = editing
        ? await updateCategory(editing.id, input)
        : await createCategory(input);
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(editing ? t("saved") : t("created"));
      setDialogOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await deleteCategory(deleting.id);
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("deletedToast"));
      setDeleting(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colNameAr")}</TableHead>
              <TableHead>{t("colNameEn")}</TableHead>
              <TableHead>{t("colProducts")}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground h-20 text-center">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell dir="rtl" className="text-start">
                    {c.name_ar}
                  </TableCell>
                  <TableCell dir="ltr" className="text-start">
                    {c.name_en}
                  </TableCell>
                  <TableCell className="tabular-nums">{c.productCount}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("edit")}
                        onClick={() => openEdit(c)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("delete")}
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2 className="text-destructive size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("editTitle") : t("newTitle")}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cat-name-ar">{t("nameAr")}</FieldLabel>
              <Input
                id="cat-name-ar"
                dir="rtl"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
              />
              {showErrors && !nameAr.trim() && <FieldError>{t("required")}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="cat-name-en">{t("nameEn")}</FieldLabel>
              <Input
                id="cat-name-en"
                dir="ltr"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
              />
              {showErrors && !nameEn.trim() && <FieldError>{t("required")}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={busy}>
              {editing ? t("save") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmBody", {
                name: deleting ? (locale === "ar" ? deleting.name_ar : deleting.name_en) : "",
                count: deleting?.productCount ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("keepIt")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete} disabled={busy}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
