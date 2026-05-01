// src/app/(dashboard)/settings/notifications/NotificationPreferencesForm.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateNotificationPreferencesAction } from "./actions";

export type Cadence = "INSTANT" | "DAILY" | "WEEKLY" | "NONE";
export type DigestDay = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

const DAY_LABELS: Record<DigestDay, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

const DAYS: DigestDay[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const CADENCE_OPTIONS: Array<{
  value: Cadence;
  label: string;
  description: string;
}> = [
  {
    value: "DAILY",
    label: "Daily digest",
    description: "One email each morning summarizing the day's open items.",
  },
  {
    value: "WEEKLY",
    label: "Weekly digest",
    description:
      "One email per week with an AI-summarized rollup of open items.",
  },
  {
    value: "INSTANT",
    label: "Real-time critical events",
    description:
      "No batched digest — only critical-severity events fire immediately.",
  },
  {
    value: "NONE",
    label: "No emails",
    description:
      "Suppress all email delivery. The in-product inbox still works.",
  },
];

const TIME_REGEX = /^[0-2][0-9]:[0-5][0-9]$/;

export function NotificationPreferencesForm({
  initial,
}: {
  initial: {
    digestEnabled: boolean;
    criticalAlertsEnabled: boolean;
    emailEnabled: boolean;
    cadence: Cadence;
    digestDay: DigestDay;
    digestTime: string;
  };
}) {
  const [digestEnabled, setDigestEnabled] = useState(initial.digestEnabled);
  const [criticalAlertsEnabled, setCriticalAlertsEnabled] = useState(
    initial.criticalAlertsEnabled,
  );
  const [emailEnabled, setEmailEnabled] = useState(initial.emailEnabled);
  const [cadence, setCadence] = useState<Cadence>(initial.cadence);
  const [digestDay, setDigestDay] = useState<DigestDay>(initial.digestDay);
  const [digestTime, setDigestTime] = useState(initial.digestTime);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setTimeError(null);
    if (cadence === "WEEKLY" && !TIME_REGEX.test(digestTime)) {
      setTimeError("Time must be HH:MM in 24-hour format (e.g. 08:00).");
      return;
    }
    startTransition(async () => {
      try {
        await updateNotificationPreferencesAction({
          digestEnabled,
          criticalAlertsEnabled,
          emailEnabled,
          cadence,
          digestDay,
          digestTime,
        });
        setNotice("Saved.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  const showWeeklyFields = cadence === "WEEKLY";
  const timeErrorId = "notif-digest-time-error";

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-foreground">
          Email delivery cadence
        </legend>
        <p className="text-xs text-muted-foreground">
          How often we email about open compliance items. Critical alerts fire
          regardless of cadence (subject to the Critical alerts toggle below).
        </p>
        <div
          role="radiogroup"
          aria-labelledby="cadence-legend"
          className="space-y-2"
        >
          <span id="cadence-legend" className="sr-only">
            Email delivery cadence
          </span>
          {CADENCE_OPTIONS.map((opt) => {
            const id = `cadence-${opt.value.toLowerCase()}`;
            const descId = `${id}-desc`;
            return (
              <label
                key={opt.value}
                htmlFor={id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm hover:bg-accent/50"
              >
                <input
                  type="radio"
                  id={id}
                  name="cadence"
                  value={opt.value}
                  checked={cadence === opt.value}
                  onChange={() => setCadence(opt.value)}
                  className="mt-0.5 h-4 w-4"
                  aria-describedby={descId}
                />
                <span>
                  <span className="font-medium">{opt.label}</span>
                  <span
                    id={descId}
                    className="block text-xs text-muted-foreground"
                  >
                    {opt.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {showWeeklyFields && (
        <fieldset
          className="space-y-3 rounded-md border border-border bg-accent/30 p-3"
          aria-label="Weekly digest schedule"
        >
          <legend className="px-1 text-xs font-semibold text-foreground">
            Weekly schedule
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="digestDay"
                className="block text-xs font-medium text-foreground"
              >
                Day of week
              </label>
              <select
                id="digestDay"
                name="digestDay"
                value={digestDay}
                onChange={(e) => setDigestDay(e.target.value as DigestDay)}
                aria-required="true"
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="digestTime"
                className="block text-xs font-medium text-foreground"
              >
                Time (24-hour)
              </label>
              <input
                id="digestTime"
                name="digestTime"
                type="time"
                value={digestTime}
                onChange={(e) => setDigestTime(e.target.value)}
                aria-required="true"
                aria-invalid={timeError ? true : undefined}
                aria-describedby={timeError ? timeErrorId : undefined}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {timeError && (
                <span
                  id={timeErrorId}
                  className="block text-xs text-[color:var(--gw-color-risk)]"
                >
                  {timeError}
                </span>
              )}
            </div>
          </div>
        </fieldset>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          Channel toggles
        </h3>
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={digestEnabled}
            onChange={(e) => setDigestEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">Compliance digest</span>
            <span className="block text-xs text-muted-foreground">
              Master switch for the recurring digest email above. Turn off to
              keep notifications in the in-product inbox without emailing.
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
