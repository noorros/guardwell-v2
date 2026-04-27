"use client";

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
  }>;
}

export function CompetencyTab(_props: CompetencyTabProps) {
  return <p className="text-sm text-muted-foreground">compounders — Task 8</p>;
}
