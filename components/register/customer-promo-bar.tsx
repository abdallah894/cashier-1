"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Tag, UserRound, X } from "lucide-react";
import { findCustomer, registerCustomer, type CustomerChip } from "@/lib/actions/customers";
import { useOnline } from "@/hooks/use-online";
import { formatEgp } from "@/lib/money";
import { useCart } from "@/lib/store/cart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Optional customer link and coupon codes; both need the server, so they are online-only. */
export function CustomerPromoBar() {
  const t = useTranslations("register.customer");
  const locale = useLocale();
  const online = useOnline();
  const customer = useCart((s) => s.customer);
  const setCustomer = useCart((s) => s.setCustomer);
  const promoCodes = useCart((s) => s.promoCodes);
  const addPromoCode = useCart((s) => s.addPromoCode);
  const removePromoCode = useCart((s) => s.removePromoCode);
  const promo = useCart((s) => s.promo);
  const hasItems = useCart((s) => s.items.length > 0);

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");

  function submitCode() {
    if (!code.trim()) return;
    addPromoCode(code);
    setCode("");
  }

  return (
    <div className="flex flex-col gap-2 border-t px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {customer ? (
          <Badge variant="secondary" className="gap-1.5 py-1">
            <UserRound className="size-3.5" />
            {customer.name}
            <span className="text-muted-foreground tabular-nums" dir="ltr">
              ···{customer.phoneLast4}
            </span>
            <button type="button" aria-label={t("detach")} onClick={() => setCustomer(null)}>
              <X className="size-3.5" />
            </button>
          </Badge>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!online} data-shortcut="customer">
            <UserRound className="size-4" />
            {t("attach")}
          </Button>
        )}
        <div className="ms-auto flex items-center gap-1.5">
          <Tag className="text-muted-foreground size-4" />
          <Input
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCode()}
            placeholder={t("codePlaceholder")}
            aria-label={t("codePlaceholder")}
            disabled={!online || !hasItems}
            data-shortcut="promo-code"
            className="h-8 w-32 uppercase"
          />
          <Button variant="outline" size="sm" onClick={submitCode} disabled={!online || !hasItems || !code.trim()}>
            {t("applyCode")}
          </Button>
        </div>
      </div>

      {!online && <p className="text-xs text-amber-700 dark:text-amber-400">{t("offlineNote")}</p>}

      {(promoCodes.length > 0 || (promo?.applied.length ?? 0) > 0) && (
        <ul className="flex flex-col gap-1">
          {promo?.applied.map((entry) => (
            <li key={entry.promotionId} className="flex items-center justify-between text-green-700 dark:text-green-500">
              <span>
                {locale === "ar" ? entry.nameAr : entry.nameEn}
                {entry.code ? ` (${entry.code})` : ""}
              </span>
              <span className="tabular-nums" dir="ltr">
                − {formatEgp(entry.discount, locale)}
              </span>
            </li>
          ))}
          {promoCodes
            .filter((c) => !promo?.applied.some((entry) => entry.code?.toUpperCase() === c))
            .map((c) => (
              <li key={c} className="text-muted-foreground flex items-center justify-between">
                <span dir="ltr">{c}</span>
                <button type="button" aria-label={t("removeCode")} onClick={() => removePromoCode(c)}>
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
        </ul>
      )}

      <CustomerDialog
        open={open}
        onOpenChange={setOpen}
        onAttach={(chip) => {
          setCustomer(chip);
          setOpen(false);
          toast.success(t("attached", { name: chip.name }));
        }}
      />
    </div>
  );
}

function CustomerDialog({
  open,
  onOpenChange,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttach: (chip: CustomerChip) => void;
}) {
  const t = useTranslations("register.customer");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<CustomerChip | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);

  function reset() {
    setPhone("");
    setFound(undefined);
    setName("");
    setConsent(false);
  }

  function search() {
    startTransition(async () => {
      const result = await findCustomer({ phone });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setFound(result.data);
    });
  }

  function create() {
    startTransition(async () => {
      const result = await registerCustomer({ name, phone, marketingConsent: consent });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      onAttach(result.data);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="customer-phone">{t("phone")}</Label>
            <div className="flex gap-2">
              <Input
                id="customer-phone"
                dir="ltr"
                inputMode="tel"
                autoFocus
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setFound(undefined);
                }}
                onKeyDown={(e) => e.key === "Enter" && phone.trim().length >= 8 && search()}
              />
              <Button onClick={search} disabled={pending || phone.trim().length < 8}>
                {t("find")}
              </Button>
            </div>
          </div>

          {found && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-medium">{found.name}</div>
                <div className="text-muted-foreground text-xs tabular-nums" dir="ltr">
                  ···{found.phoneLast4}
                </div>
              </div>
              <Button onClick={() => onAttach(found)}>{t("use")}</Button>
            </div>
          )}

          {found === null && (
            <div className="grid gap-3 rounded-md border p-3">
              <p className="text-muted-foreground text-sm">{t("notFound")}</p>
              <div className="grid gap-1.5">
                <Label htmlFor="customer-name">{t("name")}</Label>
                <Input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex items-start gap-2">
                <Switch id="customer-consent" checked={consent} onCheckedChange={setConsent} />
                <Label htmlFor="customer-consent" className="grid gap-0.5 font-normal">
                  <span>{t("consent")}</span>
                  <span className="text-muted-foreground text-xs">{t("consentHint")}</span>
                </Label>
              </div>
              <Button onClick={create} disabled={pending || name.trim() === ""}>
                {t("create")}
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
