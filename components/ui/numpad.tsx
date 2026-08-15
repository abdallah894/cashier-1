"use client";

import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type NumpadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "backspace";

const LAYOUT: NumpadKey[] = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "backspace"];

/**
 * On-screen numpad for touch counters. onPointerDown is prevented so taps
 * never steal focus from the paired input — hardware keyboard flow (scanner,
 * digits, Enter) keeps working while the numpad edits the same value.
 */
export function Numpad({
  onKey,
  withDot = true,
  className,
}: {
  onKey: (key: NumpadKey) => void;
  withDot?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {LAYOUT.map((key, i) =>
        key === "." && !withDot ? (
          <div key={i} aria-hidden />
        ) : (
          <Button
            key={i}
            type="button"
            variant="outline"
            className="h-12 text-lg font-medium tabular-nums"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onKey(key)}
            aria-label={key === "backspace" ? "backspace" : key}
          >
            {key === "backspace" ? <Delete className="size-5 rtl:rotate-180" /> : key}
          </Button>
        )
      )}
    </div>
  );
}
