// src/app/(dashboard)/programs/allergy/CompetencyTab/MemberRow.tsx
//
// Per-member row inside the CompetencyTab list. Extracted from
// CompetencyTab.tsx (audit #21 MIN-8, Wave-4 D4). Pure refactor.

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  attestFingertipTestAction,
  attestMediaFillTestAction,
  logCompoundingActivityAction,
} from "../actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import {
  formatPracticeDate,
  formatPracticeDateLong,
} from "@/lib/audit/format";
import type { CompetencyTabProps } from "../CompetencyTab";
import { AttestDialog } from "./AttestDialog";
import { RequiredToggle } from "./RequiredToggle";
import { OverallBadge } from "./OverallBadge";
import { isInactive } from "./helpers";

export interface MemberRowProps {
  member: CompetencyTabProps["members"][number];
  competency: CompetencyTabProps["competencies"][number] | undefined;
  year: number;
  isCurrentUser: boolean;
  canManage: boolean;
}

export function MemberRow({
  member,
  competency,
  isCurrentUser,
  canManage,
}: MemberRowProps) {
  const tz = usePracticeTimezone();
  const fmtDate = (iso: string) => formatPracticeDate(new Date(iso), tz);
  const fmtDateLong = (iso: string) => formatPracticeDateLong(new Date(iso), tz);
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
