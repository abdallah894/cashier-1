"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * A button for something that cannot be undone: it asks first, in plain
 * words, and the two answers say what they do ("Cancel order" / "Keep it")
 * rather than an ambiguous "Cancel".
 */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  variant = "outline",
}: {
  children: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmLabel: React.ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const t = useTranslations("common");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} disabled={disabled}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("keepIt")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
