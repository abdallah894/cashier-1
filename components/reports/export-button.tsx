"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/reports/csv";

// Client leaf that turns already-fetched report rows into a CSV download.
// The heavy lifting (aggregation) happened in SQL; this is display data.
export function ExportButton({
  filename,
  headers,
  rows,
  label,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
  label: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => downloadCsv(filename, headers, rows)}
      disabled={rows.length === 0}
    >
      <Download className="size-4" />
      {label}
    </Button>
  );
}
