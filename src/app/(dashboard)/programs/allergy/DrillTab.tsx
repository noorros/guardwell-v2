"use client";

import type { CompetencyTabProps } from "./CompetencyTab";

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

export function DrillTab(_props: DrillTabProps) {
  return <p className="text-sm text-muted-foreground">drills — Task 10</p>;
}
