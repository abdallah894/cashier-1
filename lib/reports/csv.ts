import Papa from "papaparse";

/**
 * Build + download a CSV in the browser. UTF-8 with a BOM so Excel opens
 * Arabic text correctly (same convention as the products CSV template in
 * components/products/csv-import.tsx). Papa.unparse handles quoting.
 * Client-only: touches Blob/URL/document.
 */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const csv = "﻿" + Papa.unparse({ fields: headers, data: rows });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
