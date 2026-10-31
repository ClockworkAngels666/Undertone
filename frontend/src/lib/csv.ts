import Papa from "papaparse";
import type { DocumentIn } from "../api/types";

export const REQUIRED_COLUMNS = ["country", "year", "text"] as const;

export const SAMPLE_CSV =
  "country,year,source,title,text\n" +
  'VNM,2023,Ministry of Foreign Affairs,Joint Statement (example),"Paste the FULL ENGLISH TEXT here, inside double quotes. We welcome dialogue and cooperation."\n' +
  'VNM,2024,Viet Nam News Agency (English),Article title (example),"Several texts in the same year are fine. They are added up."\n' +
  'CHN,2024,Xinhua (English edition),Article title (example),"Use ISO 3-letter codes such as VNM, CHN, RUS or USA."\n';

export interface ParsedCsv {
  documents: DocumentIn[];
  /** CSV line number (header = line 1) of each document, for error messages. */
  lines: number[];
  problems: string[];
}

/** Parse an uploaded CSV into documents, reporting missing columns and unusable rows. */
export function parseDocumentsCsv(content: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, string>>(content.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const columns = parsed.meta.fields ?? [];
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) {
    return {
      documents: [],
      lines: [],
      problems: [`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Required: country, year, text.`],
    };
  }
  const documents: DocumentIn[] = [];
  const lines: number[] = [];
  const problems: string[] = [];
  parsed.data.forEach((row, i) => {
    const line = i + 2;
    const year = Number.parseInt(String(row.year ?? "").trim(), 10);
    const text = String(row.text ?? "");
    if (!Number.isFinite(year)) {
      problems.push(`Line ${line}: "${row.year ?? ""}" is not a year.`);
      return;
    }
    if (!text.trim()) {
      problems.push(`Line ${line}: the text is empty.`);
      return;
    }
    documents.push({
      country: String(row.country ?? "").trim().toUpperCase(),
      year,
      text,
      source: row.source?.trim() || null,
      title: row.title?.trim() || null,
    });
    lines.push(line);
  });
  for (const error of parsed.errors.slice(0, 5)) {
    problems.push(`Line ${(error.row ?? 0) + 2}: ${error.message}`);
  }
  return { documents, lines, problems };
}

/** Split documents into upload batches by count and by size (the server caps both). */
export function batches<T extends { text: string }>(items: T[], maxCount: number, maxChars = 2_500_000): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = item.text.length + 200;
    if (current.length && (current.length >= maxCount || size + itemSize > maxChars)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length) out.push(current);
  return out;
}

/** Build a CSV file from rows (for client-side exports). */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return "\uFEFF" + Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) }, { escapeFormulae: true });
}

export function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
