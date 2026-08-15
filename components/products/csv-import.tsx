"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CircleCheck, CircleX, Download, FileUp, Loader2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { importProducts, type ImportSummary } from "@/lib/actions/import";
import {
  CSV_COLUMNS,
  TEMPLATE_ROWS,
  validateCsvRow,
  type RawCsvRow,
  type RowIssue,
} from "@/lib/validation/import";
import type { Category } from "@/lib/supabase/queries/categories";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PreviewRow = {
  row: number;
  raw: RawCsvRow;
  issues: RowIssue[];
};

function buildTemplateCsv(): string {
  const header = CSV_COLUMNS.join(",");
  const lines = TEMPLATE_ROWS.map((row) =>
    CSV_COLUMNS.map((col) => {
      const value = row[col] ?? "";
      return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    }).join(",")
  );
  // BOM so Excel opens Arabic text as UTF-8
  return "﻿" + [header, ...lines].join("\r\n");
}

export function CsvImport({ categories }: { categories: Category[] }) {
  const t = useTranslations("import");
  const tErrors = useTranslations("errors");
  const tFieldErrors = useTranslations("fieldErrors");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);

  const validCount = rows.filter((r) => r.issues.length === 0).length;

  function downloadTemplate() {
    const blob = new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseFile(file: File) {
    setSummary(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      // strip BOM + whitespace from headers so "﻿barcode" matches
      transformHeader: (h) => h.replace(/^﻿/, "").trim().toLowerCase(),
      complete: (result) => {
        const headers = result.meta.fields ?? [];
        const missing = ["barcode", "name_ar", "name_en", "price_egp"].filter(
          (c) => !headers.includes(c)
        );
        if (missing.length > 0) {
          toast.error(t("missingColumns", { columns: missing.join(", ") }));
          return;
        }

        const seen = new Set<string>();
        const preview: PreviewRow[] = result.data.map((raw, i) => {
          const row: RawCsvRow = {};
          for (const col of CSV_COLUMNS) row[col] = raw[col] ?? "";
          const { input, issues } = validateCsvRow(row, categories);
          if (input) {
            if (seen.has(input.barcode)) {
              issues.push({ field: "barcode", message: "duplicateInFile" });
            } else {
              seen.add(input.barcode);
            }
          }
          return { row: i + 1, raw: row, issues };
        });

        setFileName(file.name);
        setRows(preview);
      },
      error: () => toast.error(t("parseFailed")),
    });
  }

  async function runImport() {
    setImporting(true);
    try {
      const result = await importProducts(rows.map((r) => r.raw));
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setSummary(result.data);
      toast.success(t("importedToast", { count: result.data.inserted }));
    } finally {
      setImporting(false);
    }
  }

  // server results override the local preview after import
  const statusFor = (row: PreviewRow): { ok: boolean; issues: RowIssue[] } => {
    if (summary) {
      const server = summary.results.find((r) => r.row === row.row);
      if (server) return { ok: server.status === "inserted", issues: server.issues };
    }
    return { ok: row.issues.length === 0, issues: row.issues };
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="size-4" />
            {t("downloadTemplate")}
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="size-4" />
            {t("chooseFile")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) parseFile(file);
              e.target.value = "";
            }}
          />
          {fileName && (
            <span className="text-muted-foreground text-sm" dir="ltr">
              {fileName}
            </span>
          )}
          {rows.length > 0 && !summary && (
            <Button
              onClick={runImport}
              disabled={importing || validCount === 0}
              className="ms-auto"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {t("importValid", { count: validCount })}
            </Button>
          )}
          {summary && (
            <Button variant="outline" asChild className="ms-auto">
              <Link href="/products">{t("backToProducts")}</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {summary && (
        <p className="text-sm">
          {t("summaryLine", { inserted: summary.inserted, skipped: summary.skipped })}
        </p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colBarcode")}</TableHead>
                <TableHead>{t("colNameAr")}</TableHead>
                <TableHead>{t("colNameEn")}</TableHead>
                <TableHead>{t("colPrice")}</TableHead>
                <TableHead>{t("colIssues")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const status = statusFor(row);
                return (
                  <TableRow key={row.row} className={status.ok ? "" : "bg-destructive/5"}>
                    <TableCell className="text-muted-foreground tabular-nums">{row.row}</TableCell>
                    <TableCell>
                      {status.ok ? (
                        <Badge variant="secondary" className="gap-1">
                          <CircleCheck className="size-3 text-green-600" />
                          {summary ? t("statusInserted") : t("statusValid")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <CircleX className="size-3" />
                          {summary ? t("statusSkipped") : t("statusInvalid")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell dir="ltr" className="font-mono text-xs">
                      {row.raw.barcode}
                    </TableCell>
                    <TableCell dir="rtl" className="text-start">
                      {row.raw.name_ar}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {row.raw.name_en}
                    </TableCell>
                    <TableCell dir="ltr" className="tabular-nums">
                      {row.raw.price_egp}
                    </TableCell>
                    <TableCell className="max-w-72">
                      {status.issues.length > 0 && (
                        <ul className="text-destructive space-y-0.5 text-xs">
                          {status.issues.map((issue, i) => (
                            <li key={i}>
                              <span dir="ltr" className="font-mono">
                                {issue.field}
                              </span>
                              : {tFieldErrors(issue.message)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
