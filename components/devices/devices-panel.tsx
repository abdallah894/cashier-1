"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useDeviceErrorText } from "@/hooks/use-device-error";
import { toast } from "sonner";
import { Plus, Usb } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  authorizeDrawerOpen,
  completeDrawerOpening,
  reportDeviceHealth,
  saveDevice,
} from "@/lib/actions/devices";
import { runDrawerOpen } from "@/lib/devices/print-service";
import { findPairedUsbPrinter, pairUsbPrinter, webUsbSupported } from "@/lib/devices/transport";
import { ESC_POS } from "@/lib/receipts/escpos";
import type { Device, DeviceProfile, PrintJob } from "@/lib/supabase/queries/devices";
import type { Tables } from "@/lib/supabase/database.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Settings = { vendorId?: number; productId?: number; columns?: number };

function settingsOf(device: Device): Settings {
  const raw = device.settings;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Settings) : {};
}

const HEALTH_VARIANT = { ok: "outline", degraded: "secondary", offline: "destructive", unknown: "secondary" } as const;

/** Hardware setup: devices per till, USB pairing, health checks, a test drawer opening and the print-job log. */
export function DevicesPanel({
  tills,
  devices,
  profiles,
  jobs,
}: {
  tills: Tables<"tills">[];
  devices: Device[];
  profiles: DeviceProfile[];
  jobs: PrintJob[];
}) {
  const t = useTranslations("devices");
  const tErrors = useTranslations("errors");
  const deviceError = useDeviceErrorText();
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState<Device["kind"]>("printer");
  const [profile, setProfile] = useState("");
  const [name, setName] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerNote, setDrawerNote] = useState("");
  const [managerPin, setManagerPin] = useState("");

  const tillId = tills[0]?.id ?? "";
  const profileLabel = (key: string) => profiles.find((p) => p.key === key)?.label ?? key;
  const supportedProfiles = profiles.filter((p) => p.kind === kind && p.supported);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, doneKey: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(tErrors.has(result.error ?? "") ? tErrors(result.error ?? "") : (result.error ?? "error"));
        return;
      }
      toast.success(t(doneKey));
      router.refresh();
    });
  }

  function addDevice() {
    run(
      () => saveDevice({ tillId, kind, name, profile, active: true, settings: {} }),
      "saved"
    );
    setAddOpen(false);
    setName("");
  }

  async function pair(device: Device) {
    try {
      const { vendorId, productId } = await pairUsbPrinter();
      run(
        () =>
          saveDevice({
            id: device.id,
            tillId: device.till_id,
            kind: device.kind,
            name: device.name,
            profile: device.profile,
            active: device.active,
            settings: { ...settingsOf(device), vendorId, productId },
          }),
        "paired"
      );
    } catch (error) {
      toast.error(error instanceof Error ? deviceError(error.message) : t("pairFailed"));
    }
  }

  async function checkHealth(device: Device) {
    const settings = settingsOf(device);
    let health: "ok" | "offline" = "offline";
    let detail = t("notPaired");
    try {
      const transport = await findPairedUsbPrinter({ vendorId: settings.vendorId, productId: settings.productId });
      if (transport) {
        await transport.send(Uint8Array.from(ESC_POS.init)); // ESC @ is harmless and proves the pipe works
        health = "ok";
        detail = transport.label;
      }
    } catch (error) {
      detail = error instanceof Error ? deviceError(error.message) : t("checkFailed");
    }
    run(() => reportDeviceHealth({ deviceId: device.id, health, detail }), health === "ok" ? "healthOk" : "healthOffline");
  }

  async function testDrawer(drawerDevice: Device | undefined) {
    const printer = devices.find((d) => d.kind === "printer" && d.active && d.till_id === drawerDevice?.till_id);
    const settings = printer ? settingsOf(printer) : {};
    const transport = await findPairedUsbPrinter({ vendorId: settings.vendorId, productId: settings.productId }).catch(() => null);
    const outcome = await runDrawerOpen({
      transport,
      authorize: async () => {
        const result = await authorizeDrawerOpen({
          reason: "no_sale",
          note: drawerNote,
          managerPin: managerPin || undefined,
        });
        return result.ok ? { ok: true, openingId: result.data.openingId } : { ok: false, error: result.error };
      },
      complete: async (openingId, ok, error) => {
        await completeDrawerOpening({ openingId, ok, error: error ?? undefined, deviceId: drawerDevice?.id });
      },
    });
    if (outcome.status === "opened") toast.success(t("drawerOpened"));
    else toast.error(tErrors.has(outcome.error) ? tErrors(outcome.error) : t("drawerFailed", { error: outcome.error }));
    setDrawerOpen(false);
    setDrawerNote("");
    setManagerPin("");
    router.refresh();
  }

  const drawerDevice = devices.find((d) => d.kind === "cash_drawer" && d.active);
  const failedJobs = jobs.filter((job) => job.status === "failed");

  return (
    <div className="flex flex-col gap-6">
      {!webUsbSupported() && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">{t("noWebUsb")}</p>}
      {failedJobs.length > 0 && (
        <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{t("failedJobs", { count: failedJobs.length })}</p>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("devicesTitle", { till: tills[0]?.name ?? "" })}</h2>
          <div className="flex gap-2">
            {drawerDevice && (
              <Button variant="outline" onClick={() => setDrawerOpen(true)}>
                {t("openDrawer")}
              </Button>
            )}
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              {t("add")}
            </Button>
          </div>
        </div>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-start">{t("colName")}</th>
                <th className="p-3 text-start">{t("colKind")}</th>
                <th className="p-3 text-start">{t("colProfile")}</th>
                <th className="p-3 text-start">{t("colHealth")}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const settings = settingsOf(device);
                return (
                  <tr key={device.id} className="border-b align-top last:border-0">
                    <td className="p-3 font-medium">
                      {device.name}
                      {!device.active && <Badge variant="outline" className="ms-2">{t("inactive")}</Badge>}
                    </td>
                    <td className="p-3">{t(`kind.${device.kind}`)}</td>
                    <td className="p-3 text-xs">{profileLabel(device.profile)}</td>
                    <td className="p-3">
                      <Badge variant={HEALTH_VARIANT[device.health as keyof typeof HEALTH_VARIANT] ?? "secondary"}>{t(`health.${device.health}`)}</Badge>
                      {device.health_detail && <div className="text-muted-foreground mt-1 max-w-xs text-xs">{device.health_detail}</div>}
                      {device.last_seen_at && (
                        <div className="text-muted-foreground text-xs">{format.dateTime(new Date(device.last_seen_at), { dateStyle: "short", timeStyle: "short" })}</div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {device.profile === "escpos_usb_80mm" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void pair(device)} disabled={pending}>
                              <Usb className="size-4" />
                              {settings.vendorId !== undefined ? t("repair") : t("pair")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void checkHealth(device)} disabled={pending}>
                              {t("check")}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {devices.length === 0 && (
                <tr>
                  <td className="text-muted-foreground p-6 text-center" colSpan={5}>{t("empty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("jobsTitle")}</h2>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-start">{t("colWhen")}</th>
                <th className="p-3 text-start">{t("colDocument")}</th>
                <th className="p-3 text-start">{t("colCopy")}</th>
                <th className="p-3 text-start">{t("colStatus")}</th>
                <th className="p-3 text-start">{t("colDetail")}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b last:border-0">
                  <td className="p-3">{format.dateTime(new Date(job.created_at), { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="p-3">{t(`document.${job.document_type}`)} · {t(`jobKind.${job.kind}`)}</td>
                  <td className="p-3 tabular-nums">{job.copy_number}</td>
                  <td className="p-3">
                    <Badge variant={job.status === "failed" ? "destructive" : "outline"}>{t(`jobStatus.${job.status}`)}</Badge>
                  </td>
                  <td className="text-muted-foreground p-3 text-xs">{job.error ?? job.reason ?? ""}</td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td className="text-muted-foreground p-6 text-center" colSpan={5}>{t("noJobs")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("profilesTitle")}</h2>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <tbody>
              {profiles.map((p) => (
                <tr key={p.key} className="border-b last:border-0">
                  <td className="p-3">{t(`kind.${p.kind}`)}</td>
                  <td className="p-3">{p.label}</td>
                  <td className="p-3">
                    <Badge variant={p.supported ? "outline" : "secondary"}>{p.supported ? t("supported") : t("notSupported")}</Badge>
                  </td>
                  <td className="text-muted-foreground p-3 text-xs">{p.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>{t("addDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>{t("colKind")}</Label>
              <Select value={kind} onValueChange={(v) => { setKind(v as Device["kind"]); setProfile(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="printer">{t("kind.printer")}</SelectItem>
                  <SelectItem value="scanner">{t("kind.scanner")}</SelectItem>
                  <SelectItem value="cash_drawer">{t("kind.cash_drawer")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("colProfile")}</Label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger><SelectValue placeholder={t("pickProfile")} /></SelectTrigger>
                <SelectContent>
                  {supportedProfiles.map((p) => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="device-name">{t("colName")}</Label>
              <Input id="device-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("cancel")}</Button>
            <Button onClick={addDevice} disabled={pending || !profile || name.trim() === ""}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("openDrawer")}</DialogTitle>
            <DialogDescription>{t("openDrawerDescription")}</DialogDescription>
          </DialogHeader>
          <Input value={drawerNote} onChange={(e) => setDrawerNote(e.target.value)} placeholder={t("drawerReason")} aria-label={t("drawerReason")} />
          <Input
            dir="ltr"
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={managerPin}
            onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ""))}
            placeholder={t("managerPinOptional")}
            aria-label={t("managerPinOptional")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>{t("cancel")}</Button>
            <Button onClick={() => void testDrawer(drawerDevice)} disabled={drawerNote.trim() === ""}>{t("openDrawer")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
