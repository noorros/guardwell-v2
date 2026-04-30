// src/app/(dashboard)/programs/credentials/[id]/CredentialDetail/ReminderPanel.tsx
//
// Renewal reminder configuration panel — extracted from
// CredentialDetail.tsx (audit #21 MN-4, Wave-4 D4 file-organization).
// Pure refactor: no behavior change.

"use client";

import { useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateReminderConfigAction } from "../../actions";
import {
  DEFAULT_MILESTONES,
  FIELD_CLASS,
  formatMilestones,
  makeUuid,
  parseMilestones,
} from "./helpers";

export interface ReminderConfigValue {
  id: string;
  enabled: boolean;
  milestoneDays: number[];
}

export interface ReminderPanelProps {
  credentialId: string;
  reminderConfig: ReminderConfigValue | null;
  canManage: boolean;
}

export function ReminderPanel({
  credentialId,
  reminderConfig,
  canManage,
}: ReminderPanelProps) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Bell className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold">Renewal reminders</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Days before expiry to send a renewal reminder. Defaults: 90,
              60, 30, 7.
            </p>
          </div>
        </div>
        <ReminderConfigForm
          credentialId={credentialId}
          reminderConfig={reminderConfig}
          canManage={canManage}
        />
      </CardContent>
    </Card>
  );
}

// ── ReminderConfigForm ───────────────────────────────────────────────────────

function ReminderConfigForm({
  credentialId,
  reminderConfig,
  canManage,
}: {
  credentialId: string;
  reminderConfig: ReminderConfigValue | null;
  canManage: boolean;
}) {
  const initialEnabled = reminderConfig?.enabled ?? true;
  const initialDays = reminderConfig?.milestoneDays?.length
    ? reminderConfig.milestoneDays
    : DEFAULT_MILESTONES;

  const [enabled, setEnabled] = useState(initialEnabled);
  const [daysInput, setDaysInput] = useState(formatMilestones(initialDays));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Read-only view for VIEWER/STAFF.
  if (!canManage) {
    return (
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Status</dt>
          <dd className="mt-0.5">
            {initialEnabled ? "Enabled" : "Disabled"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            Milestone days
          </dt>
          <dd className="mt-0.5 tabular-nums">
            {initialEnabled
              ? formatMilestones(initialDays)
              : "—"}
          </dd>
        </div>
      </dl>
    );
  }

  const handleSubmit = () => {
    setError(null);
    setSuccess(false);

    const parsed = parseMilestones(daysInput);
    if (!Array.isArray(parsed)) {
      setError(parsed.error);
      return;
    }
    if (enabled && parsed.length === 0) {
      setError("Add at least one milestone day, or disable reminders.");
      return;
    }

    const configId = reminderConfig?.id ?? makeUuid();

    startTransition(async () => {
      try {
        await updateReminderConfigAction({
          configId,
          credentialId,
          enabled,
          milestoneDays: parsed,
        });
        setSuccess(true);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not save reminders.",
        );
      }
    });
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSuccess(false);
          }}
          disabled={isPending}
          className="h-4 w-4 rounded border-input"
        />
        <span>Email me before this credential expires</span>
      </label>
      {enabled && (
        <div>
          <label htmlFor="reminder-days" className="text-xs font-medium">
            Milestone days
          </label>
          <input
            id="reminder-days"
            type="text"
            inputMode="numeric"
            value={daysInput}
            onChange={(e) => {
              setDaysInput(e.target.value);
              setSuccess(false);
            }}
            disabled={isPending}
            placeholder="90, 60, 30, 7"
            className={FIELD_CLASS}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Comma-separated whole numbers (0-365). Each day fires once.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && (
        <p className="text-xs text-[color:var(--gw-color-compliant)]">
          Reminder schedule saved.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleSubmit}
          disabled={isPending}
          size="sm"
        >
          {isPending ? "Saving…" : "Save reminders"}
        </Button>
      </div>
    </div>
  );
}
