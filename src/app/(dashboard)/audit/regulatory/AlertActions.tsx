// src/app/(dashboard)/audit/regulatory/AlertActions.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  acknowledgeAlertAction,
  dismissAlertAction,
  addAlertToCapAction,
} from "./actions";

export interface AlertActionsProps {
  alertId: string;
  acknowledgedAtIso: string | null;
  dismissedAtIso: string | null;
}

export function AlertActions({
  alertId,
  acknowledgedAtIso,
  dismissedAtIso,
}: AlertActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showCapForm, setShowCapForm] = useState(false);
  const [capDescription, setCapDescription] = useState("");
  const [capDueDate, setCapDueDate] = useState("");

  const isAcknowledged = acknowledgedAtIso !== null;
  const isDismissed = dismissedAtIso !== null;

  const handleAcknowledge = () => {
    setError(null);
    startTransition(async () => {
      const res = await acknowledgeAlertAction({ alertId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleDismiss = () => {
    setError(null);
    startTransition(async () => {
      const res = await dismissAlertAction({ alertId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleAddToCap = () => {
    setError(null);
    if (capDescription.trim().length === 0) {
      setError("Description is required");
      return;
    }
    startTransition(async () => {
      const res = await addAlertToCapAction({
        alertId,
        description: capDescription.trim(),
        dueDate: capDueDate.length > 0 ? capDueDate : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCapDescription("");
      setCapDueDate("");
      setShowCapForm(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Alert actions"
        className="flex flex-wrap items-center gap-2"
      >
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={handleAcknowledge}
          disabled={isPending || isAcknowledged || isDismissed}
        >
          {isAcknowledged ? "Acknowledged" : "Acknowledge"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowCapForm((v) => !v)}
          disabled={isPending || isDismissed}
          aria-expanded={showCapForm}
        >
          {showCapForm ? "Cancel" : "Add to my CAP"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          disabled={isPending || isDismissed}
        >
          {isDismissed ? "Dismissed" : "Dismiss"}
        </Button>
        {isAcknowledged && !isDismissed && (
          <span className="text-[11px] text-muted-foreground">
            Acknowledged
          </span>
        )}
        {isDismissed && (
          <span className="text-[11px] text-muted-foreground">
            Dismissed
          </span>
        )}
      </div>

      {showCapForm && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <label className="block text-xs font-medium text-foreground">
            Action description
            <textarea
              value={capDescription}
              onChange={(e) => setCapDescription(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1 text-sm"
              rows={2}
              maxLength={500}
              placeholder="What needs to be done?"
              aria-label="Action description"
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
              aria-label="Due date"
              disabled={isPending}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleAddToCap}
              disabled={isPending || capDescription.trim().length === 0}
            >
              {isPending ? "Saving..." : "Save action"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowCapForm(false);
                setCapDescription("");
                setCapDueDate("");
                setError(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

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
