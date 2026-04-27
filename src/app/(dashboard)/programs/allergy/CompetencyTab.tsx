"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  attestFingertipTestAction,
  attestMediaFillTestAction,
  toggleStaffAllergyRequirementAction,
  logCompoundingActivityAction,
} from "./actions";

export interface CompetencyTabProps {
  canManage: boolean;
  year: number;
  currentPracticeUserId: string;
  members: Array<{
    id: string;
    role: string;
    requiresAllergyCompetency: boolean;
    name: string;
    email: string | null;
  }>;
  competencies: Array<{
    id: string;
    practiceUserId: string;
    year: number;
    quizPassedAt: string | null;
    fingertipPassCount: number;
    fingertipLastPassedAt: string | null;
    mediaFillPassedAt: string | null;
    isFullyQualified: boolean;
    lastCompoundedAt: string | null;
  }>;
}

// ── Attest dialog (shared for fingertip and media fill) ───────────────────────
interface AttestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onSubmit: (notes: string) => Promise<void>;
}

function AttestDialog({ open, onOpenChange, title, description, onSubmit }: AttestDialogProps) {
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await onSubmit(notes);
        setNotes("");
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred. Please try again.");
      }
    });
  }

  function handleOpenChange(next: boolean) {
    if (!isPending) {
      if (!next) {
        setNotes("");
        setError(null);
      }
      onOpenChange(next);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="space-y-1.5">
          <label htmlFor="attest-notes" className="text-sm font-medium">
            Notes <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            id="attest-notes"
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Supervisor observations, kit used, batch number…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isPending}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        <DialogFooter showCloseButton>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : "Record Pass"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Toggle (required/not-required) ────────────────────────────────────────────
interface RequiredToggleProps {
  practiceUserId: string;
  initialRequired: boolean;
}

function RequiredToggle({ practiceUserId, initialRequired }: RequiredToggleProps) {
  const [required, setRequired] = useState(initialRequired);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    const prev = required;
    setRequired(next);
    startTransition(async () => {
      try {
        await toggleStaffAllergyRequirementAction({ practiceUserId, required: next });
      } catch {
        setRequired(prev);
      }
    });
  }

  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
        required
          ? "border-[color:var(--gw-color-compliant)] bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_10%,transparent)] text-[color:var(--gw-color-compliant)]"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
        isPending && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={required}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[color:var(--gw-color-compliant)]"
        aria-label="Requires allergy competency"
      />
      <span>{required ? "Required" : "Not required"}</span>
    </label>
  );
}

// ── Overall status badge ──────────────────────────────────────────────────────
function OverallBadge({ competency }: { competency: CompetencyTabProps["competencies"][number] | undefined }) {
  if (!competency) {
    return (
      <Badge variant="secondary" className="text-xs">
        Not started
      </Badge>
    );
  }
  if (competency.isFullyQualified) {
    return (
      <Badge className="text-xs">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Fully qualified
      </Badge>
    );
  }
  const anyDone =
    Boolean(competency.quizPassedAt) ||
    competency.fingertipPassCount > 0 ||
    Boolean(competency.mediaFillPassedAt);
  if (anyDone) {
    return (
      <Badge variant="outline" className="text-xs">
        In progress
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs">
      Not started
    </Badge>
  );
}

// ── Format ISO date string to YYYY-MM-DD ──────────────────────────────────────
function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

// ── Format ISO date string to "MMM d, yyyy" (e.g. "Apr 3, 2025") ─────────────
function fmtDateLong(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

// ── 6-month inactivity check (183 days, matching USP §21 + v1 logic) ──────────
const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
function isInactive(lastCompoundedAt: string | null | undefined): boolean {
  if (!lastCompoundedAt) return false;
  return Date.now() - new Date(lastCompoundedAt).getTime() >= SIX_MONTHS_MS;
}

// ── MemberRow ─────────────────────────────────────────────────────────────────
interface MemberRowProps {
  member: CompetencyTabProps["members"][number];
  competency: CompetencyTabProps["competencies"][number] | undefined;
  year: number;
  isCurrentUser: boolean;
  canManage: boolean;
}

function MemberRow({ member, competency, year, isCurrentUser, canManage }: MemberRowProps) {
  const [fingertipOpen, setFingertipOpen] = useState(false);
  const [mediaFillOpen, setMediaFillOpen] = useState(false);
  const [logSessionPending, startLogSessionTransition] = useTransition();
  const [logSessionError, setLogSessionError] = useState<string | null>(null);

  const lastCompoundedAt = competency?.lastCompoundedAt ?? null;
  const inactive = isInactive(lastCompoundedAt);

  function handleLogSession() {
    setLogSessionError(null);
    startLogSessionTransition(async () => {
      try {
        await logCompoundingActivityAction({ practiceUserId: member.id });
      } catch (e) {
        setLogSessionError(e instanceof Error ? e.message : "Failed to log session.");
      }
    });
  }

  // Fingertip count display (always show "of 3" — isFullyQualified is source of truth)
  const ftCount = competency?.fingertipPassCount ?? 0;
  const ftLabel =
    ftCount === 0
      ? "0 of 3"
      : ftCount === 1
        ? "1 of 3"
        : ftCount === 2
          ? "2 of 3"
          : `${Math.min(ftCount, 3)} of 3`;

  return (
    <>
      <li className="flex flex-col gap-3 border-b last:border-b-0 px-4 py-4 sm:flex-row sm:items-start sm:gap-4">
        {/* Name + role */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <User className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium">{member.name}</span>
              <Badge variant="outline" className="text-[10px]">
                {member.role}
              </Badge>
              {isCurrentUser && (
                <Badge variant="secondary" className="text-[10px]">
                  You
                </Badge>
              )}
            </div>
            {member.email && (
              <p className="truncate text-xs text-muted-foreground">{member.email}</p>
            )}
          </div>
        </div>

        {/* Controls grid */}
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          {/* Required toggle (admin only) */}
          {canManage && (
            <RequiredToggle
              practiceUserId={member.id}
              initialRequired={member.requiresAllergyCompetency}
            />
          )}
          {!canManage && (
            <span className="text-xs text-muted-foreground">
              {member.requiresAllergyCompetency ? "Required" : "Not required"}
            </span>
          )}

          {/* Quiz */}
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Quiz
            </span>
            {competency?.quizPassedAt ? (
              <span className="flex items-center gap-1 text-[color:var(--gw-color-compliant)]">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {fmtDate(competency.quizPassedAt)}
              </span>
            ) : isCurrentUser ? (
              <Link
                href={"/programs/allergy/quiz" as Route}
                className="text-primary underline-offset-2 hover:underline"
              >
                Take quiz
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {/* Fingertip */}
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Fingertip
            </span>
            <span
              className={cn(
                ftCount >= 3
                  ? "text-[color:var(--gw-color-compliant)]"
                  : ftCount > 0
                    ? "text-amber-600"
                    : "text-muted-foreground",
              )}
            >
              {ftCount >= 3 && <CheckCircle2 className="mr-0.5 inline h-3 w-3" aria-hidden="true" />}
              {ftLabel}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => setFingertipOpen(true)}
                className="mt-0.5 text-left text-primary underline-offset-2 hover:underline"
              >
                Attest
              </button>
            )}
          </div>

          {/* Media fill */}
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Media fill
            </span>
            {competency?.mediaFillPassedAt ? (
              <span className="flex items-center gap-1 text-[color:var(--gw-color-compliant)]">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {fmtDate(competency.mediaFillPassedAt)}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setMediaFillOpen(true)}
                className="mt-0.5 text-left text-primary underline-offset-2 hover:underline"
              >
                Attest
              </button>
            )}
          </div>

          {/* Overall */}
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </span>
            <OverallBadge competency={competency} />
            {inactive && (
              <Badge variant="destructive" className="mt-1 text-[10px]">
                Inactive &gt;6mo · re-eval required
              </Badge>
            )}
          </div>
        </div>

        {/* Last compounded date + Log session */}
        <div className="w-full px-0 sm:w-auto sm:self-center">
          {lastCompoundedAt && (
            <p className="text-xs text-muted-foreground">
              Last compounded: {fmtDateLong(lastCompoundedAt)}
            </p>
          )}
          {canManage && (
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handleLogSession}
                disabled={logSessionPending}
                className="text-xs text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {logSessionPending ? "Logging…" : "Log session"}
              </button>
              {logSessionError && (
                <span className="text-xs text-destructive">{logSessionError}</span>
              )}
            </div>
          )}
        </div>
      </li>

      {/* Fingertip attestation dialog */}
      {canManage && (
        <AttestDialog
          open={fingertipOpen}
          onOpenChange={setFingertipOpen}
          title={`Record fingertip test pass — ${member.name}`}
          description={`By recording this you attest that ${member.name} successfully completed the gloved fingertip and thumb sampling procedure with no microbial growth detected on the TSA plates.`}
          onSubmit={(notes) =>
            attestFingertipTestAction({ practiceUserId: member.id, notes: notes || null })
          }
        />
      )}

      {/* Media fill attestation dialog */}
      {canManage && (
        <AttestDialog
          open={mediaFillOpen}
          onOpenChange={setMediaFillOpen}
          title={`Record media fill test pass — ${member.name}`}
          description={`By recording this you attest that ${member.name} successfully completed the media fill simulation test with no contamination detected after incubation.`}
          onSubmit={(notes) =>
            attestMediaFillTestAction({ practiceUserId: member.id, notes: notes || null })
          }
        />
      )}
    </>
  );
}

// ── CompetencyTab ─────────────────────────────────────────────────────────────
export function CompetencyTab({
  canManage,
  year,
  currentPracticeUserId,
  members,
  competencies,
}: CompetencyTabProps) {
  const compMap = new Map(competencies.map((c) => [c.practiceUserId, c]));

  // Empty state 1: no members at all
  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
        <User className="mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm font-medium">No staff members found</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Invite staff from the{" "}
          <Link href={"/programs/staff" as Route} className="underline underline-offset-2">
            Staff page
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  // Empty state 2: no members require allergy competency
  const required = members.filter((m) => m.requiresAllergyCompetency);
  if (required.length === 0) {
    return (
      <div className="space-y-4">
        {/* Show all members so admin can toggle */}
        <div className="rounded-lg border">
          <ul>
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                competency={compMap.get(m.id)}
                year={year}
                isCurrentUser={m.id === currentPracticeUserId}
                canManage={canManage}
              />
            ))}
          </ul>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          No staff currently require USP §21 competency.{" "}
          {canManage
            ? "Use the toggle on each row to mark compounders."
            : "Ask an admin to designate which staff compound allergen extracts."}
        </p>
      </div>
    );
  }

  // Normal state: at least one member required
  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <ul>
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              competency={compMap.get(m.id)}
              year={year}
              isCurrentUser={m.id === currentPracticeUserId}
              canManage={canManage}
            />
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        {year} competency — Quiz + fingertip sampling + media fill test required annually per USP 797 §21.
      </p>
    </div>
  );
}
