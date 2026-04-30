// src/app/(dashboard)/programs/allergy/CompetencyTab/OverallBadge.tsx
//
// Overall qualification status badge. Extracted from CompetencyTab.tsx
// (audit #21 MIN-8, Wave-4 D4).

"use client";

import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CompetencyTabProps } from "../CompetencyTab";

export function OverallBadge({
  competency,
}: {
  competency: CompetencyTabProps["competencies"][number] | undefined;
}) {
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
