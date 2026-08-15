"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { decodeBarcodeFromVideo } from "@/lib/barcode/decode-frame";

// Pause between decode attempts. Each attempt itself takes 30–200ms, so the
// effective rate is ~3–6 fps — plenty for hand-held scanning without pegging
// the CPU on a low-end counter device.
const SCAN_INTERVAL_MS = 150;

// html5-qrcode's own scan loop decodes at the video element's CSS size
// (~400px wide in this dialog), which is too coarse for EAN-13. We manage the
// camera ourselves and decode full native frames via decodeBarcodeFromVideo.
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    // Many webcams default to a fixed or one-shot focus that stays sharp
    // at desktop distance but blurs a barcode held a few inches from the
    // lens. Chrome/Edge ignore unsupported advanced constraints instead
    // of failing getUserMedia, so this is safe to request unconditionally.
    advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
  },
};

type CameraError = "cameraUnavailable" | "cameraPermissionRequired";

function waitForUsableVideo(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
    };

    const handleReady = () => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Video stream failed to load"));
    };

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
  });
}

export function CameraScanDialog({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (barcode: string) => void;
}) {
  const t = useTranslations("register.camera");
  const [error, setError] = useState<CameraError | null>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  // Crumpled foil, torn labels, or curved packaging can distort a linear
  // barcode's bar widths enough that no decoder — ours or a dedicated
  // laser scanner — can read it reliably. Always offer a manual fallback
  // rather than trapping the cashier in a dialog that can never succeed.
  const [manualValue, setManualValue] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);
  const onScanRef = useRef(onScan);
  const onOpenChangeRef = useRef(onOpenChange);
  // First successful decode wins — the loop and the manual button can race.
  const handledRef = useRef(false);
  const decodingRef = useRef(false);

  useEffect(() => {
    onScanRef.current = onScan;
    onOpenChangeRef.current = onOpenChange;
  });

  const finishScan = useCallback((barcode: string) => {
    const value = barcode.trim();
    if (!value || handledRef.current) return;

    handledRef.current = true;
    onScanRef.current(value);
    onOpenChangeRef.current(false);
  }, []);

  const decodeCurrentFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || decodingRef.current || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return null;
    }

    decodingRef.current = true;
    try {
      return await decodeBarcodeFromVideo(video);
    } finally {
      decodingRef.current = false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    handledRef.current = true;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }

    setReady(false);
    setStarting(false);
    setCapturing(false);
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video || starting || ready) return;

    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setError("cameraPermissionRequired");
      return;
    }

    handledRef.current = false;
    setError(null);
    setStarting(true);

    const scheduleScan = () => {
      timeoutRef.current = window.setTimeout(scanLoop, SCAN_INTERVAL_MS);
    };

    const scanLoop = async () => {
      if (handledRef.current) return;

      const barcode = await decodeCurrentFrame().catch(() => null);
      if (handledRef.current) return;

      if (barcode) {
        finishScan(barcode);
        return;
      }

      scheduleScan();
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      await waitForUsableVideo(video);

      setReady(true);
      void scanLoop();
    } catch {
      setError("cameraUnavailable");
      stopCamera();
    } finally {
      setStarting(false);
    }
  }, [decodeCurrentFrame, finishScan, ready, starting, stopCamera]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setManualValue("");
      stopCamera();
    }
    onOpenChange(next);
  }

  function handleManualSubmit(event: FormEvent) {
    event.preventDefault();
    finishScan(manualValue);
  }

  async function handleManualScan() {
    if (!ready) {
      await startCamera();
      return;
    }

    if (capturing) return;

    setCapturing(true);
    try {
      const barcode = await decodeCurrentFrame();
      if (barcode) {
        finishScan(barcode);
        return;
      }
      toast.error(t("noBarcodeFound"));
    } catch {
      toast.error(t("noBarcodeFound"));
    } finally {
      setCapturing(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    return stopCamera;
  }, [open, stopCamera]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <div className="relative min-h-[280px] overflow-hidden rounded-lg bg-black">
          {/* ref on a plain element ≈ Vue template ref; no $el indirection */}
          <video ref={videoRef} autoPlay playsInline muted className="w-full" />
          {/* Matches the center crop decode-frame.ts analyzes (85% x 35%) —
              keep the barcode inside this box so it fills the decoded region. */}
          {ready && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[35%] w-[85%] rounded-md border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
        </div>
        {error && <p className="text-destructive text-center text-sm">{t(error)}</p>}

        {/* Damaged/curved barcodes are a fact of life at a real checkout —
            this fallback lets the cashier keep moving without the camera. */}
        <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
          <Input
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            placeholder={t("manualEntryPlaceholder")}
            dir="ltr"
            inputMode="numeric"
            className="font-mono tabular-nums"
          />
          <Button type="submit" variant="secondary" disabled={!manualValue.trim()}>
            {t("manualEntrySubmit")}
          </Button>
        </form>
        <p className="text-muted-foreground -mt-2 text-center text-xs">{t("manualEntryHint")}</p>

        <DialogFooter className="sm:justify-stretch">
          {error && (
            <Button type="button" variant="outline" size="lg" className="h-12 w-full text-base" onClick={startCamera}>
              <ScanLine className="size-5" />
              {t("allowCamera")}
            </Button>
          )}
          {!error && (
            <Button
              type="button"
              size="lg"
              className="h-12 w-full text-base"
              disabled={starting || capturing}
              onClick={handleManualScan}
            >
              <ScanLine className="size-5" />
              {starting ? t("starting") : capturing ? t("scanning") : ready ? t("scanNow") : t("allowCamera")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
