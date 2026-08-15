"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createStaff } from "@/lib/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const result = await createStaff({
        email: form.get("email"),
        password: form.get("password"),
        fullName: form.get("fullName"),
        role: form.get("role"),
        pin: form.get("pin") || "",
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("created"));
      onOpenChange(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="staff-name">{t("fullName")}</FieldLabel>
              <Input id="staff-name" name="fullName" required maxLength={120} autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="staff-email">{t("email")}</FieldLabel>
              <Input id="staff-email" name="email" type="email" required dir="ltr" />
            </Field>
            <Field>
              <FieldLabel htmlFor="staff-password">{t("password")}</FieldLabel>
              <Input
                id="staff-password"
                name="password"
                type="password"
                required
                minLength={8}
                dir="ltr"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="staff-role">{t("colRole")}</FieldLabel>
              <select
                id="staff-role"
                name="role"
                defaultValue="cashier"
                className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none"
              >
                <option value="cashier">{t("roles.cashier")}</option>
                <option value="admin">{t("roles.admin")}</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="staff-pin">{t("pinOptional")}</FieldLabel>
              <Input
                id="staff-pin"
                name="pin"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="1234"
                dir="ltr"
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {t("createConfirm")}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
