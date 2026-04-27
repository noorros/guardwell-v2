// src/components/gw/BulkCsvImport/parseCsv.ts
//
// Generic CSV → typed-row parser used by every bulk-import surface
// (tech assets, vendors, credentials). The caller provides:
//   - columns: declarative description of which header names map to
//     which canonical fields, which are required, optional aliases.
//   - parseRow: takes the raw {field: value} record + line number, and
//     returns either a typed row or a per-row error message.
// The parser handles header normalization, required-column validation,
// and skip-empty-line behavior; everything else is the caller's call.

import { parse } from "csv-parse/sync";

export interface ColumnDef {
  /** Canonical field name used by parseRow / your domain row. */
  field: string;
  /** Human-readable label shown in errors + the template CSV. */
  label: string;
  /** Optional list of case-insensitive header aliases that map to this field. */
  aliases?: string[];
  /** Required = error if missing from CSV header. Default: false. */
  required?: boolean;
}

export interface ParseResult<TRow> {
  rows: TRow[];
  errors: string[];
  /** Header-derivation noise — e.g., "Role column missing — defaulted to STAFF". */
  notes: string[];
}

export interface ParseConfig<TRow> {
  columns: ColumnDef[];
  parseRow: (
    raw: Record<string, string>,
    lineNum: number,
  ) => { ok: true; row: TRow; note?: string } | { ok: false; error: string };
}

function canonicalize(raw: string): string {
  return raw.trim().replace(/["']/g, "").toLowerCase();
}

export function parseCsv<TRow>(
  csvText: string,
  config: ParseConfig<TRow>,
): ParseResult<TRow> {
  const errors: string[] = [];
  const notes: string[] = [];

  // Build header-alias lookup table.
  const aliasMap: Record<string, string> = {};
  for (const col of config.columns) {
    aliasMap[canonicalize(col.field)] = col.field;
    aliasMap[canonicalize(col.label)] = col.field;
    for (const alias of col.aliases ?? []) {
      aliasMap[canonicalize(alias)] = col.field;
    }
  }

  let records: Record<string, string>[];
  try {
    records = parse(csvText, {
      columns: (headers: string[]) =>
        headers.map((h) => aliasMap[canonicalize(h)] ?? canonicalize(h)),
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    return {
      rows: [],
      errors: [err instanceof Error ? err.message : "CSV parse failed"],
      notes,
    };
  }

  if (records.length === 0) {
    return {
      rows: [],
      errors: ["CSV has no data rows"],
      notes,
    };
  }

  const firstRow = records[0]!;
  for (const col of config.columns) {
    if (col.required && !(col.field in firstRow)) {
      errors.push(`Missing required column: ${col.label}`);
    }
  }
  if (errors.length) return { rows: [], errors, notes };

  const rows: TRow[] = [];
  records.forEach((rec, idx) => {
    const lineNum = idx + 2; // header is line 1
    const result = config.parseRow(rec, lineNum);
    if (result.ok) {
      rows.push(result.row);
      if (result.note) notes.push(result.note);
    } else {
      errors.push(`Line ${lineNum}: ${result.error}`);
    }
  });

  return { rows, errors, notes };
}

/**
 * Build a downloadable CSV string from rows. Each row gets one column
 * per columns[].field; columns[].label is the header. Pure — no side
 * effects.
 */
export function buildCsv<TRow extends Record<string, unknown>>(
  rows: TRow[],
  columns: ColumnDef[],
): string {
  const headers = columns.map((c) => csvEscape(c.label)).join(",");
  const body = rows
    .map((r) =>
      columns
        .map((c) => csvEscape(formatCell(r[c.field as keyof TRow])))
        .join(","),
    )
    .join("\n");
  return `${headers}\n${body}\n`;
}

function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
