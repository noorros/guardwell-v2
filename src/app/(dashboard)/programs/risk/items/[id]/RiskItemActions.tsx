// src/app/(dashboard)/programs/risk/items/[id]/RiskItemActions.tsx
//
// Phase 5 PR 5 — client component for the RiskItem detail page. Three
// controls:
//   - Status select (OPEN / MITIGATED / ACCEPTED / TRANSFERRED)
//   - Notes textarea (debounced save)
//   - "Create CAP" button — disabled in PR 5; full impl ships in PR 6
//
// Server actions are colocated in ./actions.ts and the lib helper in
// src/lib/risk/riskMutations.ts (ALLOWED_PATH per the
// gw/no-direct-projection-mutation rule).

"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { RiskItemStatus } from "@/lib/risk/types";
import {
  updateRiskItemStatusAction,
  updateRiskItemNotesAction,
} from "./actions";

const STATUS_OPTIONS: ReadonlyArray<{
  value: RiskItemStatus;
  label: string;
}> = [
  { value: "OPEN", label: "Open" },
  { value: "MITIGATED", label: "Mitigated" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "TRANSFERRED", label: "Transferred" },
];

export interface RiskItemActionsProps {
  riskItemId: string;
  initialStatus: RiskItemStatus;
  initialNotes: string | null;
}

export function RiskItemActions({
  riskItemId,
  initialStatus,
  initialNotes,
}: RiskItemActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<RiskItemStatus>(initialStatus);
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced notes auto-save: 800ms after the last keystroke. Mirrors
  // the SRA wizard's autosave cadence.
  useEffect(() => {
    if ((initialNotes ?? "") === notes) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const res = await updateRiskItemNotesAction({
          riskItemId,
          notes: notes.length === 0 ? null : notes,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setSavedAt(Date.now());
        setError(null);
      });
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // initialNotes is intentionally compared on each render to avoid
    // firing immediately when the parent re-renders with the same value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, riskItemId]);

  const handleStatusChange = (next: RiskItemStatus) => {
    if (next === status) return;
    setError(null);
    setStatus(next);
    startTransition(async () => {
      const res = await updateRiskItemStatusAction({
        riskItemId,
        status: next,
      });
      if (!res.ok) {
        setError(res.error);
        // Revert local state on failure so the UI matches the DB.
        setStatus(initialStatus);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label
          htmlFor="risk-item-status"
          className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          Status
        </label>
        <select
          id="risk-item-status"
          value={status}
          onChange={(e) =>
            handleStatusChange(e.target.value as RiskItemStatus)
          }
          disabled={isPending}
          aria-label="Risk item status"
          className="block w-full max-w-xs rounded-md border bg-background px-2 py-1 text-sm"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="risk-item-notes"
          className="block text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          Notes
        </label>
        <textarea
          id="risk-item-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          rows={4}
          maxLength={5000}
          aria-label="Risk item notes"
          placeholder="e.g. accepted because compensating controls offset the residual risk"
          className="block w-full rounded-md border bg-background px-2 py-1 text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          {isPending
            ? "Saving..."
            : savedAt
              ? "Saved"
              : "Auto-saves 800ms after you stop typing"}
        </p>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Corrective action
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          aria-label="Create corrective action (available in PR 6)"
          title="Create CAP — available in PR 6"
        >
          Create CAP
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Available in the next release.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="text-[11px] text-[color:var(--gw-color-risk)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
