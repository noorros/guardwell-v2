// src/app/(dashboard)/programs/credentials/[id]/CredentialDetail/CeuPanel.tsx
//
// CEU (Continuing Education) panel — extracted from CredentialDetail.tsx
// (audit #21 MN-4, Wave-4 D4 file-organization). Owns the progress bar,
// the activity list/row, and the new-activity form. Pure refactor: no
// behavior change.

"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GraduationCap, Plus, Trash2 } from "lucide-react";
import {
  logCeuActivityAction,
  removeCeuActivityAction,
} from "../../actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";
import {
  type CeuActivityRow,
  type CeuProgress,
  computeCeuProgress,
  makeUuid,
  FIELD_CLASS,
  TEXTAREA_CLASS,
} from "./helpers";

export interface CeuPanelProps {
  canManage: boolean;
  credentialId: string;
  ceuRequirementHours: number | null;
  ceuRequirementWindowMonths: number | null;
  ceuActivities: CeuActivityRow[];
}

export function CeuPanel({
  canManage,
  credentialId,
  ceuRequirementHours,
  ceuRequirementWindowMonths,
  ceuActivities,
}: CeuPanelProps) {
  const showCeuProgress =
    ceuRequirementHours != null && ceuRequirementWindowMonths != null;

  const progress = useMemo(() => {
    if (ceuRequirementHours == null || ceuRequirementWindowMonths == null) {
      return null;
    }
    return computeCeuProgress(
      ceuActivities,
      ceuRequirementHours,
      ceuRequirementWindowMonths,
    );
  }, [ceuActivities, ceuRequirementHours, ceuRequirementWindowMonths]);

  return (
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
                {ceuRequirementHours} hours required every{" "}
                {ceuRequirementWindowMonths} months.
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
            <CeuActivityRowView
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

function CeuActivityRowView({
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
