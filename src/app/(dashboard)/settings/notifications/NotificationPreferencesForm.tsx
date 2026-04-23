// src/app/(dashboard)/settings/notifications/NotificationPreferencesForm.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateNotificationPreferencesAction } from "./actions";

export function NotificationPreferencesForm({
  initial,
}: {
  initial: {
    digestEnabled: boolean;
    criticalAlertsEnabled: boolean;
    emailEnabled: boolean;
  };
}) {
  const [digestEnabled, setDigestEnabled] = useState(initial.digestEnabled);
  const [criticalAlertsEnabled, setCriticalAlertsEnabled] = useState(
    initial.criticalAlertsEnabled,
  );
  const [emailEnabled, setEmailEnabled] = useState(initial.emailEnabled);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await updateNotificationPreferencesAction({
          digestEnabled,
          criticalAlertsEnabled,
          emailEnabled,
        });
        setNotice("Saved.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={digestEnabled}
            onChange={(e) => setDigestEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">Weekly compliance digest</span>
            <span className="block text-xs text-muted-foreground">
              One email per week summarizing every open compliance item —
              upcoming deadlines, expiring credentials, open incidents.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={criticalAlertsEnabled}
            onChange={(e) => setCriticalAlertsEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">Critical alerts (same-day)</span>
            <span className="block text-xs text-muted-foreground">
              Immediate email when a breach is determined, a credential
              expires, or any CRITICAL-severity event fires.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => setEmailEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">Email delivery</span>
            <span className="block text-xs text-muted-foreground">
              Master switch for outbound email. Turning this off leaves the
              in-product notification inbox working but mutes email.
            </span>
          </span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save preferences"}
        </Button>
        {notice && (
          <span className="text-xs text-[color:var(--gw-color-compliant)]">
            {notice}
          </span>
        )}
        {error && (
          <span className="text-xs text-[color:var(--gw-color-risk)]">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
