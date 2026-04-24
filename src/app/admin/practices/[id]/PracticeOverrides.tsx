// src/app/admin/practices/[id]/PracticeOverrides.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  overrideSubscriptionStatusAction,
  extendTrialAction,
} from "./actions";

export interface PracticeOverridesProps {
  practiceId: string;
  currentStatus: string;
  trialEndsAtIso: string | null;
}

export function PracticeOverrides({
  practiceId,
  currentStatus,
  trialEndsAtIso,
}: PracticeOverridesProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState(currentStatus);
  const [extendDays, setExtendDays] = useState("30");

  const handleSetStatus = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await overrideSubscriptionStatusAction({
          practiceId,
          status: status as "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED",
        });
        setNotice(`Status updated to ${status}.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  const handleExtend = () => {
    setError(null);
    setNotice(null);
    const days = Number.parseInt(extendDays, 10);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      setError("Extension days must be 1–365.");
      return;
    }
    startTransition(async () => {
      try {
        await extendTrialAction({ practiceId, days });
        setNotice(`Trial extended by ${days} days.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Subscription overrides</h2>
        <p className="text-[11px] text-muted-foreground">
          Manual operations for support — every change is recorded as the
          standard updatedAt timestamp on the Practice row. Stripe webhook
          will overwrite on next sync if Stripe is the source of truth.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs font-medium text-foreground">
            Set status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="TRIALING">TRIALING</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAST_DUE">PAST_DUE</option>
              <option value="CANCELED">CANCELED</option>
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            onClick={handleSetStatus}
            disabled={isPending || status === currentStatus}
          >
            Apply
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <label className="space-y-1 text-xs font-medium text-foreground">
            Extend trial by N days
            <input
              type="number"
              min={1}
              max={365}
              value={extendDays}
              onChange={(e) => setExtendDays(e.target.value)}
              className="mt-1 block w-24 rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleExtend}
            disabled={isPending}
          >
            Extend
          </Button>
          {trialEndsAtIso && (
            <span className="text-[11px] text-muted-foreground">
              Current trial end: {trialEndsAtIso.slice(0, 10)}
            </span>
          )}
        </div>

        {error && (
          <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
        )}
        {notice && (
          <p className="text-xs text-[color:var(--gw-color-compliant)]">{notice}</p>
        )}
      </CardContent>
    </Card>
  );
}
