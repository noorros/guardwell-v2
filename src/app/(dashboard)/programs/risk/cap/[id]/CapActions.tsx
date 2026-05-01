// src/app/(dashboard)/programs/risk/cap/[id]/CapActions.tsx
//
// Phase 5 PR 6 — client component for the CAP detail page. Two controls:
//   - Status select (PENDING / IN_PROGRESS / COMPLETED) — fires
//     updateCapStatusAction immediately on change. On failure, reverts
//     local state to keep UI in sync with the DB.
//   - Notes textarea + Save button — fires updateCapNotesAction on click.
//
// OVERDUE is purely a display state derived from dueDate vs. now; users
// can't pick OVERDUE from the select because it's never stored. The
// ESLint rule gw/no-direct-projection-mutation makes sure CAP writes
// flow through src/lib/risk/capMutations.ts, not directly here.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { CapStatus } from "@/lib/risk/types";
import { updateCapStatusAction, updateCapNotesAction } from "./actions";

interface Props {
  capId: string;
  currentStatus: CapStatus;
  currentNotes: string | null;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: CapStatus; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
];

export function CapActions({ capId, currentStatus, currentNotes }: Props) {
  const [status, setStatus] = useState<CapStatus>(currentStatus);
  const [notes, setNotes] = useState(currentNotes ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const router = useRouter();

  const onStatusChange = (next: CapStatus) => {
    if (next === status) return;
    setError(null);
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      const result = await updateCapStatusAction({ capId, newStatus: next });
      if (!result.ok) {
        setError(result.error);
        // Roll back optimistic state so the UI matches the DB.
        setStatus(prev);
        return;
      }
      router.refresh();
    });
  };

  const onSaveNotes = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateCapNotesAction({ capId, notes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <label
            htmlFor="cap-status"
            className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Status
          </label>
          <select
            id="cap-status"
            className="mt-1 block w-full max-w-xs rounded-md border bg-background px-2 py-1 text-sm"
            value={status}
            onChange={(e) => onStatusChange(e.target.value as CapStatus)}
            disabled={isPending}
            aria-label="Corrective action status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="cap-notes"
            className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Notes
          </label>
          <textarea
            id="cap-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes on remediation progress"
            rows={4}
            maxLength={5000}
            disabled={isPending}
            aria-label="Corrective action notes"
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
          <Button
            onClick={onSaveNotes}
            disabled={isPending}
            size="sm"
            className="mt-2"
          >
            {isPending ? "Saving..." : savedAt ? "Saved" : "Save notes"}
          </Button>
        </div>
        {error && (
          <p
            role="alert"
            className="text-[11px] text-[color:var(--gw-color-risk)]"
          >
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
