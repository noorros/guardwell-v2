// src/app/(dashboard)/programs/risk/items/[id]/RiskItemActions.tsx
//
// Phase 5 PR 5 — client component for the RiskItem detail page. Three
// controls:
//   - Status select (OPEN / MITIGATED / ACCEPTED / TRANSFERRED)
//   - Notes textarea (debounced save)
//   - "Create CAP" button — opens an inline form (PR 6: was a disabled
//     stub in PR 5). Description + optional due date; submit creates a
//     CorrectiveAction linked to this risk and routes to its detail
//     page.
//
// Server actions are colocated in ./actions.ts and the lib helpers in
// src/lib/risk/riskMutations.ts + src/lib/risk/capMutations.ts
// (ALLOWED_PATH per the gw/no-direct-projection-mutation rule).

"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import type { RiskItemStatus } from "@/lib/risk/types";
import {
  updateRiskItemStatusAction,
  updateRiskItemNotesAction,
  createCapForRiskAction,
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

  // Create-CAP form state (PR 6).
  const [showCapForm, setShowCapForm] = useState(false);
  const [capDescription, setCapDescription] = useState("");
  const [capDueDate, setCapDueDate] = useState("");

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

  const handleCreateCap = () => {
    setError(null);
    if (capDescription.trim().length === 0) {
      setError("Description is required");
      return;
    }
    startTransition(async () => {
      const res = await createCapForRiskAction({
        riskItemId,
        description: capDescription.trim(),
        dueDate: capDueDate.length > 0 ? capDueDate : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Route to the new CAP's detail page.
      router.push(`/programs/risk/cap/${res.capId}` as Route);
    });
  };

  const handleCancelCap = () => {
    setShowCapForm(false);
    setCapDescription("");
    setCapDueDate("");
    setError(null);
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

      <div className="space-y-2">
        <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Corrective action
        </label>
        {!showCapForm ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowCapForm(true)}
            disabled={isPending}
            aria-label="Create corrective action"
          >
            Create CAP
          </Button>
        ) : (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <label className="block text-xs font-medium text-foreground">
              Action description
              <textarea
                value={capDescription}
                onChange={(e) => setCapDescription(e.target.value)}
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm"
                rows={3}
                maxLength={5000}
                placeholder="What needs to be done to remediate this risk?"
                aria-label="Corrective action description"
                disabled={isPending}
              />
            </label>
            <label className="block text-xs font-medium text-foreground">
              Due date (optional)
              <input
                type="date"
                value={capDueDate}
                onChange={(e) => setCapDueDate(e.target.value)}
                className="mt-1 block rounded-md border bg-background px-2 py-1 text-sm"
                aria-label="Corrective action due date"
                disabled={isPending}
              />
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleCreateCap}
                disabled={
                  isPending || capDescription.trim().length === 0
                }
              >
                {isPending ? "Creating..." : "Create"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleCancelCap}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
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
