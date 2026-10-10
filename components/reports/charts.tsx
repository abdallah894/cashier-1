"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { formatEgp } from "@/lib/money";

// Compact axis label: piasters → pounds, e.g. 1234500 → "12.3K". Currency
// symbol is dropped here (too wide for an axis); the tooltip shows the full
// EGP amount.
function compactEgp(piasters: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(piasters / 100);
}

// Recharts v3 reads tooltip content props from context, so we take the
// callback form (its param is inferred) and hand off to this renderer.
function tooltipBox(
  label: unknown,
  value: number,
  locale: string,
  kind: "currency" | "number"
) {
  const formatted =
    kind === "currency"
      ? formatEgp(value, locale)
      : new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG").format(value);
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-md">
      {label != null && <div className="text-muted-foreground mb-1">{String(label)}</div>}
      <div className="font-medium tabular-nums" dir="ltr">
        {formatted}
      </div>
    </div>
  );
}

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

export type TimePoint = { label: string; revenue: number };

/** Revenue per time bucket — vertical bars. Time axis flips in RTL. */
export function TimeSeriesChart({
  data,
  locale,
  rtl,
}: {
  data: TimePoint[];
  locale: string;
  rtl: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" reversed={rtl} tick={AXIS_TICK} tickMargin={8} />
        <YAxis
          orientation={rtl ? "right" : "left"}
          tick={AXIS_TICK}
          width={56}
          tickFormatter={(v: number) => compactEgp(v, locale)}
        />
        <Tooltip
          cursor={{ fill: "var(--accent)" }}
          content={({ active, payload, label }) =>
            active && payload?.length
              ? tooltipBox(label, Number(payload[0]?.value ?? 0), locale, "currency")
              : null
          }
        />
        <Bar dataKey="revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export type BarRow = { label: string; value: number };

/** Horizontal bars for categorical breakdowns (top products, category,
 *  cashier). Value axis flips and labels move to the right in RTL. */
export function CategoricalBarChart({
  data,
  locale,
  rtl,
  kind,
}: {
  data: BarRow[];
  locale: string;
  rtl: boolean;
  kind: "currency" | "number";
}) {
  const height = Math.max(160, data.length * 40 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 12, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          reversed={rtl}
          tick={AXIS_TICK}
          tickFormatter={(v: number) => (kind === "currency" ? compactEgp(v, locale) : String(v))}
        />
        <YAxis
          type="category"
          dataKey="label"
          orientation={rtl ? "right" : "left"}
          tick={AXIS_TICK}
          width={120}
          // long product names: the tooltip shows them in full
          tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
        />
        <Tooltip
          cursor={{ fill: "var(--accent)" }}
          content={({ active, payload, label }) =>
            active && payload?.length
              ? tooltipBox(label, Number(payload[0]?.value ?? 0), locale, kind)
              : null
          }
        />
        <Bar dataKey="value" fill="var(--chart-3)" radius={rtl ? [4, 0, 0, 4] : [0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
