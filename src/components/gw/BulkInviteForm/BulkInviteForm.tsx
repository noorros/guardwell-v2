"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseCsvRoster, type RosterRow, type RosterRole } from "./parseCsvRoster";
import type { BulkInviteResult } from "@/app/(dashboard)/programs/staff/bulk-invite/actions";

export type SubmitFn = (rows: RosterRow[]) => Promise<BulkInviteResult>;

export interface BulkInviteFormProps {
  onSubmit: SubmitFn;
  onSkip?: () => void;
  submitLabel?: string;
  skipLabel?: string;
}

type Mode = "PASTE" | "CSV";

const ROLE_OPTIONS: RosterRole[] = ["STAFF", "ADMIN", "VIEWER"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitPastedEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function BulkInviteForm({
  onSubmit,
  onSkip,
  submitLabel,
  skipLabel,
}: BulkInviteFormProps) {
  const [mode, setMode] = useState<Mode>("PASTE");
  const [pastedText, setPastedText] = useState("");
  const [pasteRole, setPasteRole] = useState<RosterRole>("STAFF");
  const [csvRows, setCsvRows] = useState<RosterRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvDefaultedNote, setCsvDefaultedNote] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkInviteResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const pastedEmails = useMemo(() => splitPastedEmails(pastedText), [pastedText]);
  const pastedValid = useMemo(
    () => pastedEmails.filter((e) => EMAIL_RE.test(e)),
    [pastedEmails],
  );
  const pastedInvalid = pastedEmails.filter((e) => !EMAIL_RE.test(e));

  const rowsToSubmit: RosterRow[] = useMemo(() => {
    if (mode === "CSV") return csvRows;
    return pastedValid.map((email) => ({
      firstName: "",
      lastName: "",
      email: email.toLowerCase(),
      role: pasteRole,
    }));
  }, [mode, pastedValid, pasteRole, csvRows]);

  const handleCsvFile = async (file: File) => {
    if (file.size > 500 * 1024) {
      setCsvErrors(["CSV too large — max 500 KB."]);
      return;
    }
    const text = await file.text();
    const parsed = parseCsvRoster(text);
    setCsvRows(parsed.rows);
    setCsvErrors(parsed.errors);
    setCsvDefaultedNote(parsed.defaultedToStaff);
  };

  const handleSubmit = () => {
    if (rowsToSubmit.length === 0) return;
    setSubmitError(null);
    startTransition(async () => {
      try {
        const r = await onSubmit(rowsToSubmit);
        setResult(r);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Bulk invite failed");
      }
    });
  };

  if (result) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-lg font-semibold">
            {result.invitedCount} invitation{result.invitedCount === 1 ? "" : "s"} sent
          </p>
          <ul className="text-sm text-muted-foreground space-y-1">
            {result.skippedDuplicates > 0 && (
              <li>· {result.skippedDuplicates} skipped (already member or pending)</li>
            )}
            {result.skippedInvalid > 0 && (
              <li>· {result.skippedInvalid} skipped (invalid email)</li>
            )}
          </ul>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Per-row results ({result.perRowResults.length})
            </summary>
            <ul className="mt-2 space-y-0.5 text-foreground">
              {result.perRowResults.map((r, i) => (
                <li key={`${r.email}-${i}`} className="font-mono">
                  {r.email} — {r.status}
                </li>
              ))}
            </ul>
          </details>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setResult(null)}>
              Invite more
            </Button>
            {onSkip && (
              <Button onClick={onSkip}>{skipLabel ?? "Done"}</Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode("PASTE")}
          className={`rounded-md border px-3 py-1.5 ${mode === "PASTE" ? "bg-primary text-primary-foreground" : "bg-background"}`}
        >
          Paste emails
        </button>
        <button
          type="button"
          onClick={() => setMode("CSV")}
          className={`rounded-md border px-3 py-1.5 ${mode === "CSV" ? "bg-primary text-primary-foreground" : "bg-background"}`}
        >
          Upload CSV
        </button>
      </div>

      {mode === "PASTE" && (
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <label className="flex-1 space-y-1 text-xs font-medium">
              Emails (one per line, or comma-separated)
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={6}
                placeholder="jane@example.com&#10;john@example.com"
                className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="w-32 space-y-1 text-xs font-medium">
              Role for all
              <select
                value={pasteRole}
                onChange={(e) => setPasteRole(e.target.value as RosterRole)}
                className="block w-full rounded-md border bg-background px-2 py-2 text-sm"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            <Badge variant="secondary">{pastedValid.length}</Badge> will be invited as {pasteRole}
            {pastedInvalid.length > 0 && (
              <span className="ml-2 text-amber-600">· {pastedInvalid.length} invalid</span>
            )}
          </p>
        </div>
      )}

      {mode === "CSV" && (
        <div className="space-y-3">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleCsvFile(f);
            }}
            className="block w-full text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Expected columns: <code>firstName, lastName, email, role</code> (role optional; defaults to STAFF).
            {" "}
            <a
              href="data:text/csv;charset=utf-8,firstName%2ClastName%2Cemail%2Crole%0AJane%2CDoe%2Cjane%40example.com%2CSTAFF%0A"
              download="guardwell-roster-template.csv"
              className="underline"
            >
              Download template
            </a>
          </p>
          {csvDefaultedNote && (
            <p className="text-xs text-amber-600">
              Role column missing — all rows defaulted to STAFF.
            </p>
          )}
          {csvErrors.length > 0 && (
            <ul className="text-xs text-red-600 space-y-0.5">
              {csvErrors.map((err, i) => (
                <li key={i}>· {err}</li>
              ))}
            </ul>
          )}
          {csvRows.length > 0 && (
            <div className="rounded-md border text-xs">
              <table className="w-full">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-2 py-1">Email</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 50).map((r, i) => (
                    <tr key={`${r.email}-${i}`} className="border-t">
                      <td className="px-2 py-1 font-mono">{r.email}</td>
                      <td className="px-2 py-1">
                        {[r.firstName, r.lastName].filter(Boolean).join(" ")}
                      </td>
                      <td className="px-2 py-1">{r.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvRows.length > 50 && (
                <p className="px-2 py-1 text-muted-foreground">
                  · +{csvRows.length - 50} more row(s)
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {submitError && (
        <p className="text-sm text-red-600" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || rowsToSubmit.length === 0}
        >
          {isPending ? "Inviting…" : submitLabel ?? `Invite ${rowsToSubmit.length}`}
        </Button>
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip} disabled={isPending}>
            {skipLabel ?? "Skip"}
          </Button>
        )}
      </div>
    </div>
  );
}
