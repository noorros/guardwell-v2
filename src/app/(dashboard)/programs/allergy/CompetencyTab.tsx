// src/app/(dashboard)/programs/allergy/CompetencyTab.tsx
//
// Orchestrator for the per-member USP §21 competency list. Renders the
// member roster, with empty states for "no members" and "no compounders
// designated yet". Sub-components live alongside in `CompetencyTab/`:
//
//   - AttestDialog       — shared dialog for fingertip + media fill
//   - RequiredToggle     — admin-only toggle for "requires competency"
//   - OverallBadge       — qualification status badge
//   - MemberRow          — the per-member row (uses the three above)
//   - helpers.ts         — pure helpers (isInactive)
//
// Audit #21 MIN-8 (Wave-4 D4): the original 522-LOC file was split into
// focused siblings. Public interface (this exported component + props)
// is unchanged — `AllergyDashboard.tsx` and `DrillTab.tsx` continue to
// import from `./CompetencyTab`.

"use client";

import Link from "next/link";
import type { Route } from "next";
import { User } from "lucide-react";
import { MemberRow } from "./CompetencyTab/MemberRow";

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
