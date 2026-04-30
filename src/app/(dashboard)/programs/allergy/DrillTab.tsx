"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CompetencyTabProps } from "./CompetencyTab";
import { deleteDrillAction, logDrillAction, updateDrillAction } from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate, formatPracticeDateForInput } from "@/lib/audit/format";
import { HistoryRowActions } from "@/components/gw/HistoryRowActions";

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
  /**
   * Audit #21 (Allergy IM-2): pre-resolved metadata for participantIds
   * that no longer appear in `members` (member removed, or — for very old
   * legacy data — id from a different practice). Used to render a stable
   * "User no longer at practice" label rather than "Unknown". Empty in
   * the common case where every drill has only active participants.
   */
  legacyParticipants?: Array<{
    id: string;
    name: string;
    sameTenant: boolean;
  }>;
  /**
   * Audit #21 / Allergy IM-10 (2026-04-30): soft-deleted drills, surfaced
   * only when an admin opted in via `?showRetired=1` at the page level.
   * Read-only — no edit/delete actions on retired rows. Useful when
   * reconstructing why a drill was removed for state pharmacy board
   * inquiries; the EventLog has the full history but the UI was hiding it.
   */
  retiredDrills?: Array<{
    id: string;
    conductedAt: string;
    scenario: string;
    participantIds: string[];
    durationMinutes: number | null;
    observations: string | null;
    correctiveActions: string | null;
    nextDrillDue: string | null;
    retiredAt: string | null;
  }>;
  /**
   * Audit #21 / Allergy IM-10: drives the toggle link's display state
   * (showing → "Hide retired drills"; hiding → "Show retired drills").
   * Must come from the page (server-derived from searchParams) so the
   * link target stays serialisable.
   */
  showRetiredDrills?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * DAY_MS;

// Audit #21 / Allergy MIN-6 (2026-04-30): the overdue banner used a single
// amber tone regardless of how overdue the drill was. USP §21.6 is a hard
// annual; once past 365 days the practice is out of compliance, and the
// further past, the more urgent the alert. Three tiers chosen to map the
// audit risk: 0–30 days late = caution, 30–90 days = needs attention,
// >90 days = state board would treat this as a sustained gap. Ranges
// match the credentials EXPIRING_SOON / EXPIRED window precedent.
type OverdueSeverity = "caution" | "warning" | "critical";

export function classifyOverdueSeverity(daysOverdue: number): OverdueSeverity {
  if (daysOverdue > 90) return "critical";
  if (daysOverdue > 30) return "warning";
  return "caution";
}

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
    const daysAgo = Math.floor(ageMs / DAY_MS);
    const daysOverdue = daysAgo - 365;
    const severity = classifyOverdueSeverity(daysOverdue);
    // Tailwind's JIT can't pick up dynamic class names, so the three
    // palettes are listed verbatim and selected by ternary.
    const palette =
      severity === "critical"
        ? "border-destructive/50 bg-destructive/10 text-destructive"
        : severity === "warning"
          ? "border-orange-500/50 bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400"
          : "border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400";
    return (
      <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", palette)}>
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

export function LogDrillForm({ members }: { members: DrillTabProps["members"] }) {
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

  const errorId = "log-drill-error";
  const errorAttrs = error
    ? { "aria-invalid": true as const, "aria-describedby": errorId }
    : {};

  return (
    <div
      role="group"
      aria-labelledby="log-drill-heading"
      className="rounded-lg border bg-card p-4 space-y-4"
    >
      <h3 id="log-drill-heading" className="text-sm font-semibold">
        Log a drill
      </h3>

      {/* Date + Duration row */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="drill-date" className="text-xs font-medium">
            Date conducted{" "}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="drill-date"
            type="date"
            required
            aria-required="true"
            {...errorAttrs}
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
          Scenario{" "}
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        </label>
        <textarea
          id="drill-scenario"
          rows={3}
          required
          aria-required="true"
          {...errorAttrs}
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
      <fieldset
        className="space-y-1.5"
        aria-describedby={error ? errorId : undefined}
      >
        <legend className="text-xs font-medium">
          Participants{" "}
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        </legend>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No staff members found.</p>
        ) : (
          <div className="rounded-md border bg-background p-2 space-y-1 max-h-40 overflow-y-auto">
            {members.map((m) => {
              const inputId = `drill-participant-${m.id}`;
              return (
                <label
                  key={m.id}
                  htmlFor={inputId}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={participantIds.has(m.id)}
                    onChange={() => toggleParticipant(m.id)}
                    disabled={isPending}
                    className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--gw-color-compliant)]"
                  />
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{m.role}</span>
                </label>
              );
            })}
          </div>
        )}
        {participantIds.size > 0 && (
          <p className="text-xs text-muted-foreground">{participantIds.size} selected</p>
        )}
      </fieldset>

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

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      )}
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
  legacyParticipants,
  canManage,
}: {
  drill: DrillTabProps["drills"][number];
  members: DrillTabProps["members"];
  legacyParticipants: NonNullable<DrillTabProps["legacyParticipants"]>;
  canManage: boolean;
}) {
  const tz = usePracticeTimezone();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const memberMap = new Map(members.map((m) => [m.id, m.name]));
  // Audit #21 (Allergy IM-2): map for ids that don't resolve to an active
  // member of the current practice. Used to render a stable "no longer at
  // practice" label rather than just "Unknown" so reviewers know the row
  // points to a real-but-no-longer-current person, not a data corruption.
  const legacyMap = new Map(
    legacyParticipants.map((p) => [
      p.id,
      `${p.name} (no longer at practice)`,
    ]),
  );

  const participantNames = drill.participantIds
    .map(
      (id) =>
        memberMap.get(id) ??
        legacyMap.get(id) ??
        "User no longer at practice",
    )
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

      {expanded && mode === "view" && (
        <div className="border-t bg-muted/20 px-4 py-3 space-y-3 text-sm">
          {canManage && (
            <div className="flex justify-end">
              <HistoryRowActions
                canManage={canManage}
                onEdit={() => setMode("edit")}
                onDelete={async () => {
                  await deleteDrillAction({ drillId: drill.id });
                }}
                deleteConfirmText={`Delete this drill from ${formatPracticeDate(new Date(drill.conductedAt), tz)}? It stays in the audit log but stops counting toward ALLERGY_ANNUAL_DRILL.`}
              />
            </div>
          )}
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

      {expanded && mode === "edit" && (
        <EditDrillForm
          drill={drill}
          members={members}
          onCancel={() => setMode("view")}
        />
      )}
    </li>
  );
}

// ── Edit Drill Form ───────────────────────────────────────────────────────────

function EditDrillForm({
  drill,
  members,
  onCancel,
}: {
  drill: DrillTabProps["drills"][number];
  members: DrillTabProps["members"];
  onCancel: () => void;
}) {
  const tz = usePracticeTimezone();
  // Initialize the date inputs with the practice-tz calendar day, not the
  // raw UTC slice — keeps a Pacific-tenant drill from showing as the
  // following day when an Eastern reviewer opens the form (audit #21).
  const [conductedAt, setConductedAt] = useState(
    formatPracticeDateForInput(drill.conductedAt, tz),
  );
  const [scenario, setScenario] = useState(drill.scenario);
  const [participantIds, setParticipantIds] = useState<Set<string>>(
    new Set(drill.participantIds),
  );
  const [durationMinutes, setDurationMinutes] = useState(
    drill.durationMinutes != null ? String(drill.durationMinutes) : "",
  );
  const [observations, setObservations] = useState(drill.observations ?? "");
  const [correctiveActions, setCorrectiveActions] = useState(
    drill.correctiveActions ?? "",
  );
  const [nextDrillDue, setNextDrillDue] = useState(
    formatPracticeDateForInput(drill.nextDrillDue, tz),
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleParticipant(id: string) {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSave() {
    setError(null);
    if (!conductedAt) {
      setError("Date is required.");
      return;
    }
    if (!scenario.trim()) {
      setError("Scenario is required.");
      return;
    }
    if (participantIds.size === 0) {
      setError("At least one participant is required.");
      return;
    }
    startTransition(async () => {
      try {
        await updateDrillAction({
          drillId: drill.id,
          conductedAt,
          scenario: scenario.trim(),
          participantIds: Array.from(participantIds),
          durationMinutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
          observations: observations || null,
          correctiveActions: correctiveActions || null,
          nextDrillDue: nextDrillDue || null,
        });
        onCancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  const editPrefix = `edit-drill-${drill.id}`;

  return (
    <div className="border-t bg-muted/20 px-4 py-3 space-y-3 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Edit drill
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${editPrefix}-date`} className="text-xs font-medium">
            Date conducted
          </label>
          <input
            id={`${editPrefix}-date`}
            type="date"
            value={conductedAt}
            onChange={(e) => setConductedAt(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${editPrefix}-duration`} className="text-xs font-medium">
            Duration <span className="font-normal text-muted-foreground">(minutes, optional)</span>
          </label>
          <input
            id={`${editPrefix}-duration`}
            type="number"
            min="0"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${editPrefix}-scenario`} className="text-xs font-medium">
          Scenario
        </label>
        <textarea
          id={`${editPrefix}-scenario`}
          rows={3}
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          maxLength={2000}
          disabled={isPending}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Participants</p>
        <div className="rounded-md border bg-background p-2 space-y-1 max-h-40 overflow-y-auto">
          {members.map((m) => {
            const inputId = `${editPrefix}-p-${m.id}`;
            return (
              <label
                key={m.id}
                htmlFor={inputId}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={participantIds.has(m.id)}
                  onChange={() => toggleParticipant(m.id)}
                  disabled={isPending}
                  className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--gw-color-compliant)]"
                />
                <span className="truncate">{m.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{m.role}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${editPrefix}-observations`} className="text-xs font-medium">
          Observations <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`${editPrefix}-observations`}
          rows={2}
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${editPrefix}-corrective`} className="text-xs font-medium">
          Corrective actions <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`${editPrefix}-corrective`}
          rows={2}
          value={correctiveActions}
          onChange={(e) => setCorrectiveActions(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${editPrefix}-next-due`} className="text-xs font-medium">
          Next drill due <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id={`${editPrefix}-next-due`}
          type="date"
          value={nextDrillDue}
          onChange={(e) => setNextDrillDue(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={isPending} size="sm">
          {isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── DrillTab ──────────────────────────────────────────────────────────────────

export function DrillTab({
  canManage,
  members,
  drills,
  legacyParticipants,
  retiredDrills,
  showRetiredDrills,
}: DrillTabProps) {
  // Default to an empty array — legacyParticipants is optional so older
  // callers (e.g. tests) don't have to thread it through.
  const legacyResolved = legacyParticipants ?? [];
  const retiredResolved = retiredDrills ?? [];
  return (
    <div className="space-y-6">
      {/* Overdue banner */}
      <OverdueBanner drills={drills} />

      {/* Log form (admin only) */}
      {canManage && <LogDrillForm members={members} />}

      {/* History */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Drill history</h2>
          {/*
           * Audit #21 / Allergy IM-10 (2026-04-30): admin-only opt-in
           * to render retired drills below. Server-side query-string
           * toggle keeps the URL shareable and avoids client state
           * for what's an audit-prep edge case.
           */}
          {canManage && (
            <Link
              href={
                showRetiredDrills
                  ? "/programs/allergy"
                  : "/programs/allergy?showRetired=1"
              }
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Archive className="h-3 w-3" aria-hidden="true" />
              {showRetiredDrills ? "Hide retired drills" : "Show retired drills"}
            </Link>
          )}
        </div>
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
                <DrillRow
                  key={d.id}
                  drill={d}
                  members={members}
                  legacyParticipants={legacyResolved}
                  canManage={canManage}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Audit #21 / Allergy IM-10: retired drill history (admin-opt-in). */}
      {canManage && showRetiredDrills && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-muted-foreground">
            Retired drills{" "}
            <span className="text-xs font-normal">
              ({retiredResolved.length})
            </span>
          </h2>
          {retiredResolved.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No retired drills.
            </p>
          ) : (
            <div className="rounded-lg border bg-muted/20">
              <ul>
                {retiredResolved.map((d) => (
                  <RetiredDrillRow
                    key={d.id}
                    drill={d}
                    members={members}
                    legacyParticipants={legacyResolved}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Retired Drill Row ─────────────────────────────────────────────────────────
//
// Audit #21 / Allergy IM-10: read-only render of a soft-deleted drill.
// No HistoryRowActions (Edit / Delete) — retired rows are immutable
// from the UI; the EventLog is the audit trail.

function RetiredDrillRow({
  drill,
  members,
  legacyParticipants,
}: {
  drill: NonNullable<DrillTabProps["retiredDrills"]>[number];
  members: DrillTabProps["members"];
  legacyParticipants: NonNullable<DrillTabProps["legacyParticipants"]>;
}) {
  const tz = usePracticeTimezone();
  const memberMap = new Map(members.map((m) => [m.id, m.name]));
  const legacyMap = new Map(
    legacyParticipants.map((p) => [
      p.id,
      `${p.name} (no longer at practice)`,
    ]),
  );
  const participantNames = drill.participantIds
    .map(
      (id) =>
        memberMap.get(id) ??
        legacyMap.get(id) ??
        "User no longer at practice",
    )
    .join(", ");
  return (
    <li className="border-b last:border-b-0 px-4 py-3 text-sm space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium tabular-nums line-through text-muted-foreground">
          {formatPracticeDate(new Date(drill.conductedAt), tz)}
        </span>
        {drill.retiredAt && (
          <span className="text-xs text-muted-foreground">
            retired {formatPracticeDate(new Date(drill.retiredAt), tz)}
          </span>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3 w-3" aria-hidden="true" />
          {drill.participantIds.length} participant
          {drill.participantIds.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{drill.scenario}</p>
      <p className="text-xs text-muted-foreground">{participantNames || "—"}</p>
    </li>
  );
}
