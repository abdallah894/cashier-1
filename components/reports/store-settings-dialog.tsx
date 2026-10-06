"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Settings } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { updateStoreSettings } from "@/lib/actions/ops";
import type { StoreSettings } from "@/lib/supabase/queries/ops-reports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Store timezone, business-day cutoff and the reorder planning parameters. Admin only (the RPC enforces it). */
export function StoreSettingsDialog({ settings }: { settings: StoreSettings }) {
  const t = useTranslations("opsReports.settings");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [timezone, setTimezone] = useState(settings.timezone);
  const [cutoff, setCutoff] = useState(String(Math.floor(settings.business_day_cutoff_minutes / 60)).padStart(2, "0") + ":" + String(settings.business_day_cutoff_minutes % 60).padStart(2, "0"));
  const [cover, setCover] = useState(String(settings.reorder_cover_days));
  const [lookback, setLookback] = useState(String(settings.reorder_lookback_days));
  const [lead, setLead] = useState(String(settings.default_lead_time_days));
  const [identity, setIdentity] = useState({
    storeNameAr: settings.store_name_ar,
    storeNameEn: settings.store_name_en,
    addressAr: settings.address_ar,
    addressEn: settings.address_en,
    phone: settings.phone,
    taxRegistrationNumber: settings.tax_registration_number,
    receiptFooterAr: settings.receipt_footer_ar,
    receiptFooterEn: settings.receipt_footer_en,
  });
  const setId = (key: keyof typeof identity, value: string) => setIdentity((prev) => ({ ...prev, [key]: value }));

  function save() {
    const [h, m] = cutoff.split(":").map(Number);
    startTransition(async () => {
      const result = await updateStoreSettings({
        timezone,
        businessDayCutoffMinutes: (h || 0) * 60 + (m || 0),
        reorderCoverDays: Number(cover),
        reorderLookbackDays: Number(lookback),
        defaultLeadTimeDays: Number(lead),
        ...identity,
      });
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
        <Button variant="outline" size="sm">
          <Settings className="size-4" />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-sm font-medium">{t("identityTitle")}</p>
          <p className="text-muted-foreground -mt-2 text-xs">{t("identityHint")}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field id="nameAr" label={t("nameAr")}>
              <Input id="nameAr" dir="rtl" value={identity.storeNameAr} onChange={(e) => setId("storeNameAr", e.target.value)} />
            </Field>
            <Field id="nameEn" label={t("nameEn")}>
              <Input id="nameEn" dir="ltr" value={identity.storeNameEn} onChange={(e) => setId("storeNameEn", e.target.value)} />
            </Field>
            <Field id="addrAr" label={t("addressAr")}>
              <Input id="addrAr" dir="rtl" value={identity.addressAr} onChange={(e) => setId("addressAr", e.target.value)} />
            </Field>
            <Field id="addrEn" label={t("addressEn")}>
              <Input id="addrEn" dir="ltr" value={identity.addressEn} onChange={(e) => setId("addressEn", e.target.value)} />
            </Field>
            <Field id="phone" label={t("phone")}>
              <Input id="phone" dir="ltr" inputMode="tel" value={identity.phone} onChange={(e) => setId("phone", e.target.value)} />
            </Field>
            <Field id="taxNo" label={t("taxNumber")}>
              <Input id="taxNo" dir="ltr" value={identity.taxRegistrationNumber} onChange={(e) => setId("taxRegistrationNumber", e.target.value)} />
            </Field>
            <Field id="footAr" label={t("footerAr")}>
              <Input id="footAr" dir="rtl" value={identity.receiptFooterAr} onChange={(e) => setId("receiptFooterAr", e.target.value)} />
            </Field>
            <Field id="footEn" label={t("footerEn")}>
              <Input id="footEn" dir="ltr" value={identity.receiptFooterEn} onChange={(e) => setId("receiptFooterEn", e.target.value)} />
            </Field>
          </div>
          <Field id="tz" label={t("timezone")}>
            <Input id="tz" dir="ltr" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </Field>
          <Field id="cutoff" label={t("cutoff")}>
            <Input id="cutoff" type="time" dir="ltr" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field id="cover" label={t("coverDays")}>
              <Input id="cover" dir="ltr" inputMode="numeric" value={cover} onChange={(e) => setCover(e.target.value)} />
            </Field>
            <Field id="lookback" label={t("lookbackDays")}>
              <Input id="lookback" dir="ltr" inputMode="numeric" value={lookback} onChange={(e) => setLookback(e.target.value)} />
            </Field>
            <Field id="lead" label={t("leadDays")}>
              <Input id="lead" dir="ltr" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending}>
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
