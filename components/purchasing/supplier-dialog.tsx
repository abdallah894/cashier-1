"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createSupplier, updateSupplier } from "@/lib/actions/purchasing";
import type { Supplier } from "@/lib/supabase/queries/purchasing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Create (no `supplier`) or edit a supplier. Admin-only; RLS enforces it server-side. */
export function SupplierDialog({ supplier }: { supplier?: Supplier }) {
  const t = useTranslations("suppliers");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    taxId: supplier?.tax_id ?? "",
    paymentTerms: supplier?.payment_terms ?? "",
    notes: supplier?.notes ?? "",
    active: supplier?.active ?? true,
  });
  const set = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  function save() {
    startTransition(async () => {
      const result = supplier
        ? await updateSupplier({ id: supplier.id, ...form })
        : await createSupplier(form);
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {supplier ? (
          <Button variant="ghost" size="icon" aria-label={t("edit")}>
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supplier ? t("edit") : t("new")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id="name" label={t("name")}>
            <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="phone" label={t("phone")}>
              <Input id="phone" dir="ltr" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
            <Field id="email" label={t("email")}>
              <Input id="email" dir="ltr" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id="taxId" label={t("taxId")}>
              <Input id="taxId" dir="ltr" value={form.taxId} onChange={(e) => set("taxId", e.target.value)} />
            </Field>
            <Field id="terms" label={t("paymentTerms")}>
              <Input id="terms" value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
            </Field>
          </div>
          <Field id="notes" label={t("notes")}>
            <Textarea id="notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          {supplier && (
            <div className="flex items-center gap-2">
              <Switch id="active" checked={form.active} onCheckedChange={(checked) => set("active", checked)} />
              <Label htmlFor="active">{t("active")}</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending || form.name.trim() === ""}>
            {t("save")}
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
