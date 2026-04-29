// src/app/(dashboard)/programs/cybersecurity/BackupVerificationForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { logBackupVerificationAction } from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

const SCOPE_OPTIONS = ["EHR", "Email", "Files", "Imaging", "Other"];

export function BackupVerificationForm() {
  const router = useRouter();
  const tz = usePracticeTimezone();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [verifiedAt, setVerifiedAt] = useState(
    () => formatPracticeDate(new Date(), tz),
  );
  const [scope, setScope] = useState("EHR");
  const [success, setSuccess] = useState("true");
  const [restoreTimeMinutes, setRestoreTimeMinutes] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = () => {
    setError(null);
    const restore = restoreTimeMinutes.trim()
      ? Number.parseInt(restoreTimeMinutes, 10)
      : null;
    if (restore !== null && (!Number.isFinite(restore) || restore < 0)) {
      setError("Restore time must be a non-negative integer (minutes).");
      return;
    }
    startTransition(async () => {
      try {
        await logBackupVerificationAction({
          verifiedAtIso: new Date(verifiedAt).toISOString(),
          scope,
          success: success === "true",
          restoreTimeMinutes: restore ?? undefined,
          notes: notes.trim() || undefined,
        });
        setOpen(false);
        setRestoreTimeMinutes("");
        setNotes("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to log");
      }
    });
  };

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        Log a backup test
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Log a backup restore-test</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium text-foreground">
            Verified at
            <input
              type="date"
              value={verifiedAt}
              onChange={(e) => setVerifiedAt(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-foreground">
            Scope
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {SCOPE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-foreground">
            Result
            <select
              value={success}
              onChange={(e) => setSuccess(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="true">Successful restore</option>
              <option value="false">Failed restore</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-foreground">
            Restore time (minutes, optional)
            <input
              type="number"
              min={0}
              value={restoreTimeMinutes}
              onChange={(e) => setRestoreTimeMinutes(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>
        <label className="block space-y-1 text-xs font-medium text-foreground">
          Notes (optional)
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What you restored, by whom, any issues encountered."
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        {error && (
          <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
        )}
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Logging…" : "Log test"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
