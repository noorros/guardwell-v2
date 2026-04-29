"use client";

import { useMemo, useState, useTransition } from "react";
import { Bell, GraduationCap, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EvidenceUpload,
  type EvidenceItem,
} from "@/components/gw/EvidenceUpload";
import {
  logCeuActivityAction,
  removeCeuActivityAction,
  updateReminderConfigAction,
} from "../actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const TEXTAREA_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CeuActivityRow {
  id: string;
  activityName: string;
  provider: string | null;
  activityDate: string; // ISO
  hoursAwarded: number;
  category: string | null;
  notes: string | null;
  certificateEvidence: {
    id: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    status: string;
  } | null;
}

export interface CredentialDetailProps {
  canManage: boolean;
  credentialId: string;
  credentialType: {
    name: string;
    ceuRequirementHours: number | null;
    ceuRequirementWindowMonths: number | null;
    requiresEvidenceByDefault: boolean;
  };
  credential: {
    licenseNumber: string | null;
    issuingBody: string | null;
    issueDate: string | null; // ISO
    expiryDate: string | null; // ISO
    notes: string | null;
  };
  ceuActivities: CeuActivityRow[];
  reminderConfig: {
    id: string;
    enabled: boolean;
    milestoneDays: number[];
  } | null;
  initialEvidence: EvidenceItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface CeuProgress {
  totalHours: number;
  requiredHours: number;
  windowStart: Date;
  pct: number; // 0..100+
  bucket: "low" | "mid" | "high";
}

function computeCeuProgress(
  activities: CeuActivityRow[],
  requiredHours: number,
  windowMonths: number,
): CeuProgress {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCMonth(windowStart.getUTCMonth() - windowMonths);
  const totalHours = activities.reduce((sum, a) => {
    const d = new Date(a.activityDate);
    return d >= windowStart ? sum + a.hoursAwarded : sum;
  }, 0);
  const pct = requiredHours > 0 ? (totalHours / requiredHours) * 100 : 0;
  const bucket: CeuProgress["bucket"] =
    pct >= 100 ? "high" : pct >= 50 ? "mid" : "low";
  return { totalHours, requiredHours, windowStart, pct, bucket };
}

// ── CredentialDetail ─────────────────────────────────────────────────────────

export function CredentialDetail({
  canManage,
  credentialId,
  credentialType,
  credential,
  ceuActivities,
  reminderConfig,
  initialEvidence,
}: CredentialDetailProps) {
  const tz = usePracticeTimezone();
  const showCeuProgress =
    credentialType.ceuRequirementHours != null &&
    credentialType.ceuRequirementWindowMonths != null;

  const progress = useMemo(() => {
    if (
      credentialType.ceuRequirementHours == null ||
      credentialType.ceuRequirementWindowMonths == null
    ) {
      return null;
    }
    return computeCeuProgress(
      ceuActivities,
      credentialType.ceuRequirementHours,
      credentialType.ceuRequirementWindowMonths,
    );
  }, [
    ceuActivities,
    credentialType.ceuRequirementHours,
    credentialType.ceuRequirementWindowMonths,
  ]);

  return (
    <div className="space-y-6">
      {/* ── Credential metadata ───────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">Credential details</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                License number
              </dt>
              <dd className="mt-0.5">
                {credential.licenseNumber ? (
                  <span className="font-mono">{credential.licenseNumber}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Issuing body
              </dt>
              <dd className="mt-0.5">
                {credential.issuingBody ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Issue date
              </dt>
              <dd className="mt-0.5 tabular-nums">
                {credential.issueDate
                  ? formatPracticeDate(new Date(credential.issueDate), tz)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Expiry date
              </dt>
              <dd className="mt-0.5 tabular-nums">
                {credential.expiryDate
                  ? formatPracticeDate(new Date(credential.expiryDate), tz)
                  : "—"}
              </dd>
            </div>
            {credential.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Notes
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap">
                  {credential.notes}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* ── Evidence ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Evidence</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Upload a scan of the license, board certification, or any
                supporting documentation.
                {credentialType.requiresEvidenceByDefault && (
                  <>
                    {" "}
                    <span className="font-medium text-foreground">
                      This credential type expects evidence.
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          <EvidenceUpload
            entityType="CREDENTIAL"
            entityId={credentialId}
            initialEvidence={initialEvidence}
            canManage={canManage}
          />
        </CardContent>
      </Card>

      {/* ── CEU activities ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <h2 className="text-sm font-semibold">
                Continuing education
              </h2>
              {showCeuProgress ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {credentialType.ceuRequirementHours} hours required every{" "}
                  {credentialType.ceuRequirementWindowMonths} months.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Log CEU/CME activities for record-keeping.
                </p>
              )}
            </div>
          </div>

          {showCeuProgress && progress && (
            <CeuProgressBar progress={progress} />
          )}

          <CeuActivityList
            activities={ceuActivities}
            canManage={canManage}
          />

          {canManage && (
            <NewCeuActivityForm credentialId={credentialId} />
          )}
        </CardContent>
      </Card>

      {/* ── Renewal reminders ────────────────────────────────────────── */}
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
    </div>
  );
}

// ── CeuProgressBar ───────────────────────────────────────────────────────────

function CeuProgressBar({ progress }: { progress: CeuProgress }) {
  const tz = usePracticeTimezone();
  const widthPct = Math.min(progress.pct, 100);
  const colorVar =
    progress.bucket === "high"
      ? "var(--gw-color-compliant)"
      : progress.bucket === "mid"
        ? "var(--gw-color-warning, #d97706)"
        : "var(--gw-color-risk)";
  const status =
    progress.bucket === "high"
      ? "Requirement met"
      : progress.bucket === "mid"
        ? "On track"
        : "Behind schedule";

  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium tabular-nums">
          {progress.totalHours.toFixed(1)} hrs / {progress.requiredHours} hrs
        </span>
        <span className="text-muted-foreground">{status}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{ width: `${widthPct}%`, backgroundColor: colorVar }}
          role="progressbar"
          aria-valuenow={Math.round(progress.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Counting activities since {formatPracticeDate(progress.windowStart, tz)}
      </p>
    </div>
  );
}

// ── CeuActivityList ──────────────────────────────────────────────────────────

function CeuActivityList({
  activities,
  canManage,
}: {
  activities: CeuActivityRow[];
  canManage: boolean;
}) {
  if (activities.length === 0) {
    return (
      <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center">
        No CEU activities logged yet.
      </p>
    );
  }
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Date
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Activity
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
              Provider
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
              Hours
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">
              Category
            </th>
            {canManage && (
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {activities.map((a, i) => (
            <CeuActivityRow
              key={a.id}
              activity={a}
              striped={i % 2 === 1}
              canManage={canManage}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CeuActivityRow({
  activity,
  striped,
  canManage,
}: {
  activity: CeuActivityRow;
  striped: boolean;
  canManage: boolean;
}) {
  const tz = usePracticeTimezone();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleRemove = () => {
    if (!confirm(`Remove "${activity.activityName}" from CEU log?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await removeCeuActivityAction({ ceuActivityId: activity.id });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not remove activity.");
      }
    });
  };

  return (
    <tr className={striped ? "bg-muted/20 border-t" : "bg-background border-t"}>
      <td className="px-3 py-2.5 tabular-nums text-xs">
        {formatPracticeDate(new Date(activity.activityDate), tz)}
      </td>
      <td className="px-3 py-2.5">
        <div className="font-medium">{activity.activityName}</div>
        {activity.notes && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {activity.notes}
          </div>
        )}
        {error && (
          <div className="mt-0.5 text-[11px] text-destructive">{error}</div>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
        {activity.provider ?? "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {activity.hoursAwarded.toFixed(1)}
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        {activity.category ? (
          <Badge variant="secondary" className="text-[10px]">
            {activity.category}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      {canManage && (
        <td className="px-3 py-2.5 text-right">
          <button
            type="button"
            onClick={handleRemove}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded p-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
            aria-label={`Remove ${activity.activityName}`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </td>
      )}
    </tr>
  );
}

// ── NewCeuActivityForm ───────────────────────────────────────────────────────

function NewCeuActivityForm({ credentialId }: { credentialId: string }) {
  const tz = usePracticeTimezone();
  const [expanded, setExpanded] = useState(false);
  const [activityName, setActivityName] = useState("");
  const [provider, setProvider] = useState("");
  const [activityDate, setActivityDate] = useState(() =>
    formatPracticeDate(new Date(), tz),
  );
  const [hoursAwarded, setHoursAwarded] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setActivityName("");
    setProvider("");
    setActivityDate(formatPracticeDate(new Date(), tz));
    setHoursAwarded("");
    setCategory("");
    setNotes("");
  };

  const handleSubmit = () => {
    setError(null);
    setSuccess(false);

    if (!activityName.trim()) {
      setError("Activity name is required.");
      return;
    }
    if (!activityDate) {
      setError("Activity date is required.");
      return;
    }
    const hrs = Number.parseFloat(hoursAwarded);
    if (!Number.isFinite(hrs) || hrs < 0) {
      setError("Hours awarded must be a non-negative number.");
      return;
    }
    // Future-date guard (mirrors the server-side .refine())
    const activityDateMs = new Date(`${activityDate}T00:00:00Z`).getTime();
    if (activityDateMs > Date.now() + 24 * 60 * 60 * 1000) {
      setError("Activity date cannot be in the future.");
      return;
    }

    const ceuActivityId = makeUuid();

    startTransition(async () => {
      try {
        await logCeuActivityAction({
          ceuActivityId,
          credentialId,
          activityName: activityName.trim(),
          provider: provider.trim() || null,
          activityDate: new Date(`${activityDate}T00:00:00Z`).toISOString(),
          hoursAwarded: hrs,
          category: category.trim() || null,
          notes: notes.trim() || null,
        });
        reset();
        setSuccess(true);
        setExpanded(false);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not log activity.",
        );
      }
    });
  };

  if (!expanded) {
    return (
      <div className="space-y-2">
        {success && (
          <p className="text-xs text-[color:var(--gw-color-compliant)]">
            CEU activity logged.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            setSuccess(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Log a CEU activity
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold">Log a CEU activity</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="ceu-name" className="text-xs font-medium">
            Activity name
          </label>
          <input
            id="ceu-name"
            type="text"
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. AAMA Pharmacology Refresher"
            maxLength={300}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="ceu-provider" className="text-xs font-medium">
            Provider{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <input
            id="ceu-provider"
            type="text"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={isPending}
            placeholder="e.g. AAMA Online"
            maxLength={200}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="ceu-date" className="text-xs font-medium">
            Activity date
          </label>
          <input
            id="ceu-date"
            type="date"
            value={activityDate}
            onChange={(e) => setActivityDate(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="ceu-hours" className="text-xs font-medium">
            Hours awarded
          </label>
          <input
            id="ceu-hours"
            type="number"
            min={0}
            step={0.5}
            value={hoursAwarded}
            onChange={(e) => setHoursAwarded(e.target.value)}
            disabled={isPending}
            placeholder="0"
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="ceu-category" className="text-xs font-medium">
            Category{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <input
            id="ceu-category"
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Pharmacology"
            maxLength={100}
            className={FIELD_CLASS}
          />
        </div>
      </div>
      <div>
        <label htmlFor="ceu-notes" className="text-xs font-medium">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="ceu-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          placeholder="Any context worth keeping…"
          maxLength={2000}
          className={TEXTAREA_CLASS}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={handleSubmit} disabled={isPending} size="sm">
          {isPending ? "Saving…" : "Log activity"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            reset();
            setError(null);
            setExpanded(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── ReminderConfigForm ───────────────────────────────────────────────────────

const DEFAULT_MILESTONES = [90, 60, 30, 7];

function formatMilestones(days: number[]): string {
  return days.join(", ");
}

function parseMilestones(input: string): number[] | { error: string } {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return [];
  if (parts.length > 20) {
    return { error: "At most 20 milestone days." };
  }
  const result: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (!Number.isInteger(n) || n < 0 || n > 365 || `${n}` !== p) {
      return {
        error: `Each milestone must be a whole number between 0 and 365 (got "${p}").`,
      };
    }
    result.push(n);
  }
  return result;
}

function ReminderConfigForm({
  credentialId,
  reminderConfig,
  canManage,
}: {
  credentialId: string;
  reminderConfig: CredentialDetailProps["reminderConfig"];
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
