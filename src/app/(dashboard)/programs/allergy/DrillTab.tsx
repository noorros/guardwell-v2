"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CompetencyTabProps } from "./CompetencyTab";
import { logDrillAction } from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

export interface DrillTabProps {
  canManage: boolean;
  members: CompetencyTabProps["members"];
  drills: Array<{
    id: string;
    conductedAt: string;
    scenario: string;
    participantIds: string[];
    durationMinutes: number | null;
    observations: string | null;
    correctiveActions: string | null;
    nextDrillDue: string | null;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// ── Overdue Banner ────────────────────────────────────────────────────────────

function OverdueBanner({ drills }: { drills: DrillTabProps["drills"] }) {
  const tz = usePracticeTimezone();
  const latest = drills[0] ?? null;
  const now = Date.now();

  if (!latest) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>No drill on file yet — an anaphylaxis drill is required annually.</span>
      </div>
    );
  }

  const conductedMs = new Date(latest.conductedAt).getTime();
  const ageMs = now - conductedMs;

  if (ageMs > ONE_YEAR_MS) {
    const daysAgo = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>
          Anaphylaxis drill overdue — last drill was{" "}
          {formatPracticeDate(new Date(latest.conductedAt), tz)} ({daysAgo} days
          ago).
        </span>
      </div>
    );
  }

  return null;
}

// ── Log Drill Form ────────────────────────────────────────────────────────────

function LogDrillForm({ members }: { members: DrillTabProps["members"] }) {
  const tz = usePracticeTimezone();
  const today = formatPracticeDate(new Date(), tz);
  const [conductedAt, setConductedAt] = useState(today);
  const [scenario, setScenario] = useState("");
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [durationMinutes, setDurationMinutes] = useState("");
  const [observations, setObservations] = useState("");
  const [correctiveActions, setCorrectiveActions] = useState("");
  const [nextDrillDue, setNextDrillDue] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function toggleParticipant(id: string) {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit() {
    setError(null);
    setSuccess(false);
    if (!conductedAt) {
      setError("Date is required.");
      return;
    }
    if (!scenario.trim()) {
      setError("Scenario description is required.");
      return;
    }
    if (participantIds.size === 0) {
      setError("At least one participant must be selected.");
      return;
    }
    startTransition(async () => {
      try {
        await logDrillAction({
          conductedAt,
          scenario: scenario.trim(),
          participantIds: Array.from(participantIds),
          durationMinutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
          observations: observations || null,
          correctiveActions: correctiveActions || null,
          nextDrillDue: nextDrillDue || null,
        });
        setConductedAt(today);
        setScenario("");
        setParticipantIds(new Set());
        setDurationMinutes("");
        setObservations("");
        setCorrectiveActions("");
        setNextDrillDue("");
        setSuccess(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred. Please try again.");
      }
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Log a drill</h3>

      {/* Date + Duration row */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="drill-date" className="text-xs font-medium">
            Date conducted <span className="text-destructive">*</span>
          </label>
          <input
            id="drill-date"
            type="date"
            value={conductedAt}
            onChange={(e) => setConductedAt(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="drill-duration" className="text-xs font-medium">
            Duration{" "}
            <span className="font-normal text-muted-foreground">(minutes, optional)</span>
          </label>
          <input
            id="drill-duration"
            type="number"
            min="0"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            disabled={isPending}
            placeholder="e.g. 30"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Scenario */}
      <div className="space-y-1.5">
        <label htmlFor="drill-scenario" className="text-xs font-medium">
          Scenario <span className="text-destructive">*</span>
        </label>
        <textarea
          id="drill-scenario"
          rows={3}
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          maxLength={2000}
          disabled={isPending}
          placeholder="Describe the scenario used for the drill…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground text-right">
          {scenario.length}/2000
        </p>
      </div>

      {/* Participants */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium">
          Participants <span className="text-destructive">*</span>
        </p>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No staff members found.</p>
        ) : (
          <div className="rounded-md border bg-background p-2 space-y-1 max-h-40 overflow-y-auto">
            {members.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={participantIds.has(m.id)}
                  onChange={() => toggleParticipant(m.id)}
                  disabled={isPending}
                  className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--gw-color-compliant)]"
                />
                <span className="truncate">{m.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{m.role}</span>
              </label>
            ))}
          </div>
        )}
        {participantIds.size > 0 && (
          <p className="text-xs text-muted-foreground">{participantIds.size} selected</p>
        )}
      </div>

      {/* Observations */}
      <div className="space-y-1.5">
        <label htmlFor="drill-observations" className="text-xs font-medium">
          Observations{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="drill-observations"
          rows={2}
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          disabled={isPending}
          placeholder="Staff performance, response times, areas of strength…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* Corrective Actions */}
      <div className="space-y-1.5">
        <label htmlFor="drill-corrective" className="text-xs font-medium">
          Corrective actions{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="drill-corrective"
          rows={2}
          value={correctiveActions}
          onChange={(e) => setCorrectiveActions(e.target.value)}
          disabled={isPending}
          placeholder="Any corrective actions or follow-up steps…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* Next Drill Due */}
      <div className="space-y-1.5">
        <label htmlFor="drill-next-due" className="text-xs font-medium">
          Next drill due{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="drill-next-due"
          type="date"
          value={nextDrillDue}
          onChange={(e) => setNextDrillDue(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && (
        <p className="text-sm text-[color:var(--gw-color-compliant)]">Drill logged successfully.</p>
      )}
      <Button onClick={handleSubmit} disabled={isPending} size="sm">
        {isPending ? "Saving…" : "Log drill"}
      </Button>
    </div>
  );
}

// ── Drill Row ─────────────────────────────────────────────────────────────────

function DrillRow({
  drill,
  members,
}: {
  drill: DrillTabProps["drills"][number];
  members: DrillTabProps["members"];
}) {
  const tz = usePracticeTimezone();
  const [expanded, setExpanded] = useState(false);
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  const participantNames = drill.participantIds
    .map((id) => memberMap.get(id) ?? "Unknown")
    .join(", ");

  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-medium tabular-nums">{formatPracticeDate(new Date(drill.conductedAt), tz)}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" aria-hidden="true" />
              {drill.participantIds.length} participant
              {drill.participantIds.length !== 1 ? "s" : ""}
            </span>
            {drill.durationMinutes && (
              <span className="text-xs text-muted-foreground">{drill.durationMinutes} min</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{drill.scenario}</p>
        </div>
        <span className="mt-0.5 flex-shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-3 space-y-3 text-sm">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Scenario
            </span>
            <p className="mt-0.5 text-sm">{drill.scenario}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Participants ({drill.participantIds.length})
            </span>
            <p className="mt-0.5 text-sm">{participantNames || "—"}</p>
          </div>
          {drill.observations && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Observations
              </span>
              <p className="mt-0.5 text-sm">{drill.observations}</p>
            </div>
          )}
          {drill.correctiveActions && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Corrective actions
              </span>
              <p className="mt-0.5 text-sm">{drill.correctiveActions}</p>
            </div>
          )}
          {drill.nextDrillDue && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Next drill due
              </span>
              <p className="mt-0.5 text-sm">{formatPracticeDate(new Date(drill.nextDrillDue), tz)}</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── DrillTab ──────────────────────────────────────────────────────────────────

export function DrillTab({ canManage, members, drills }: DrillTabProps) {
  return (
    <div className="space-y-6">
      {/* Overdue banner */}
      <OverdueBanner drills={drills} />

      {/* Log form (admin only) */}
      {canManage && <LogDrillForm members={members} />}

      {/* History */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Drill history</h2>
        {drills.length === 0 ? (
          <p
            className={cn(
              "rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground",
            )}
          >
            No drills logged yet.
          </p>
        ) : (
          <div className="rounded-lg border">
            <ul>
              {drills.map((d) => (
                <DrillRow key={d.id} drill={d} members={members} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
