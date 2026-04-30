// src/components/gw/BulkCsvImport/BulkCsvImport.tsx
//
// Generic CSV-import client component. Caller supplies:
//   - parseConfig — column definitions + per-row parser
//   - onSubmit — server action that takes parsed rows + returns a per-
//     row result summary
//   - templateCsv — string that becomes the "Download template" link
//   - renderRow (optional) — preview row renderer
// The component owns: file upload + parse + table preview + submit +
// per-row result rendering. No paste mode — bulk data for these
// surfaces almost always comes from a spreadsheet.
//
// Companion to <BulkInviteForm> which is paste-first.

"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseCsv, type ParseConfig } from "./parseCsv";

export type BulkRowStatus =
  | "INSERTED"
  | "UPDATED"
  | "DUPLICATE_IN_BATCH"
  | "ALREADY_EXISTS"
  | "INVALID";

export interface BulkPerRowResult {
  identifier: string; // human-readable row id (name, email, etc.)
  status: BulkRowStatus;
  reason?: string;
}

export interface BulkResult {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  perRowResults: BulkPerRowResult[];
}

export interface BulkCsvImportProps<TRow> {
  parseConfig: ParseConfig<TRow>;
  onSubmit: (rows: TRow[]) => Promise<BulkResult>;
  /** Template CSV string. Linked from "Download template" anchor. */
  templateCsv: string;
  /** Friendly name for the template download (without .csv). */
  templateFilename: string;
  /** Optional per-row preview renderer. Defaults to JSON-ish. */
  renderRow?: (row: TRow, index: number) => React.ReactNode;
  /** Maximum file size in bytes (default 500KB). */
  maxFileSizeBytes?: number;
  /** Maximum row count (default 200). */
  maxRows?: number;
  /** Hint text shown above the file picker. */
  hint?: string;
}

const DEFAULT_MAX_FILE_BYTES = 500 * 1024;
const DEFAULT_MAX_ROWS = 200;

export function BulkCsvImport<TRow>(props: BulkCsvImportProps<TRow>) {
  const maxBytes = props.maxFileSizeBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxRows = props.maxRows ?? DEFAULT_MAX_ROWS;

  const [parsedRows, setParsedRows] = useState<TRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parseNotes, setParseNotes] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(props.templateCsv)}`;

  const handleFile = async (file: File) => {
    setResult(null);
    setSubmitError(null);
    if (file.size > maxBytes) {
      setParseErrors([`CSV too large — max ${Math.round(maxBytes / 1024)} KB.`]);
      setParsedRows([]);
      setParseNotes([]);
      return;
    }
    const text = await file.text();
    const parsed = parseCsv<TRow>(text, props.parseConfig);
    if (parsed.rows.length > maxRows) {
      setParseErrors([
        `Too many rows: ${parsed.rows.length} exceeds the ${maxRows}-row cap. Split into multiple uploads.`,
      ]);
      setParsedRows([]);
      setParseNotes(parsed.notes);
      return;
    }
    setParsedRows(parsed.rows);
    setParseErrors(parsed.errors);
    setParseNotes(parsed.notes);
  };

  const handleSubmit = () => {
    if (parsedRows.length === 0) return;
    setSubmitError(null);
    startTransition(async () => {
      try {
        const r = await props.onSubmit(parsedRows);
        setResult(r);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Bulk import failed");
      }
    });
  };

  if (result) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-lg font-semibold">
            {result.insertedCount + result.updatedCount} row
            {result.insertedCount + result.updatedCount === 1 ? "" : "s"}{" "}
            imported
          </p>
          <ul className="text-sm text-muted-foreground space-y-1">
            {result.insertedCount > 0 && (
              <li>· {result.insertedCount} inserted</li>
            )}
            {result.updatedCount > 0 && (
              <li>· {result.updatedCount} updated</li>
            )}
            {result.skippedCount > 0 && (
              <li>· {result.skippedCount} skipped</li>
            )}
          </ul>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Per-row results ({result.perRowResults.length})
            </summary>
            <ul className="mt-2 space-y-0.5 text-foreground">
              {result.perRowResults.map((r, i) => (
                <li key={`${r.identifier}-${i}`} className="font-mono">
                  {r.identifier} — {r.status}
                  {r.reason ? ` (${r.reason})` : ""}
                </li>
              ))}
            </ul>
          </details>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setResult(null);
                setParsedRows([]);
                setParseErrors([]);
                setParseNotes([]);
              }}
            >
              Import more
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {props.hint && (
          <p id="bulk-csv-hint" className="text-sm text-muted-foreground">
            {props.hint}
          </p>
        )}
        <label htmlFor="bulk-csv-file" className="sr-only">
          CSV file
        </label>
        <input
          id="bulk-csv-file"
          type="file"
          accept=".csv"
          aria-describedby={
            props.hint ? "bulk-csv-hint bulk-csv-help" : "bulk-csv-help"
          }
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          className="block w-full text-sm"
        />
        <p id="bulk-csv-help" className="text-xs text-muted-foreground">
          <a
            href={templateHref}
            download={`${props.templateFilename}.csv`}
            className="underline"
          >
            Download template CSV
          </a>{" "}
          · max {maxRows} rows · max {Math.round(maxBytes / 1024)} KB
        </p>
      </div>

      {parseNotes.length > 0 && (
        <ul className="text-xs text-amber-600 space-y-0.5">
          {parseNotes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}

      {parseErrors.length > 0 && (
        <ul className="text-xs text-red-600 space-y-0.5">
          {parseErrors.map((err, i) => (
            <li key={i}>· {err}</li>
          ))}
        </ul>
      )}

      {parsedRows.length > 0 && (
        <div className="rounded-md border text-xs">
          <p className="bg-muted px-3 py-2 font-medium">
            <Badge variant="secondary">{parsedRows.length}</Badge> row
            {parsedRows.length === 1 ? "" : "s"} ready to import
          </p>
          <ul className="divide-y text-foreground">
            {parsedRows.slice(0, 50).map((r, i) => (
              <li key={i} className="px-3 py-1.5">
                {props.renderRow ? (
                  props.renderRow(r, i)
                ) : (
                  <code className="text-[11px] text-muted-foreground">
                    {JSON.stringify(r)}
                  </code>
                )}
              </li>
            ))}
          </ul>
          {parsedRows.length > 50 && (
            <p className="px-3 py-1 text-muted-foreground">
              · +{parsedRows.length - 50} more row(s)
            </p>
          )}
        </div>
      )}

      {submitError && (
        <p className="text-sm text-red-600" role="alert">
          {submitError}
        </p>
      )}

      <div>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || parsedRows.length === 0}
        >
          {isPending
            ? "Importing…"
            : parsedRows.length === 0
              ? "Choose a CSV file"
              : `Import ${parsedRows.length} row${parsedRows.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
