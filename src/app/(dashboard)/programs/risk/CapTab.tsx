// src/app/(dashboard)/programs/risk/CapTab.tsx
//
// Phase 5 PR 5 — STUB. PR 6 will replace this with the real CAP timeline
// (description, dueDate, status, evidence links, owner). For now we just
// render a message + the count so the tab badge has data to show.

import type { CorrectiveAction } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";

export interface CapTabProps {
  caps: Pick<CorrectiveAction, "id" | "status">[];
}

export function CapTab({ caps }: CapTabProps) {
  return (
    <Card>
      <CardContent className="space-y-2 p-6">
        <h2 className="text-sm font-semibold">Corrective Action Plan</h2>
        <p className="text-sm text-muted-foreground">
          {caps.length === 0
            ? "No corrective actions yet. Once you mark risks for follow-up, they'll appear here with due-date tracking and evidence links."
            : `${caps.length} corrective action(s) in progress. The full CAP timeline ships in the next release.`}
        </p>
      </CardContent>
    </Card>
  );
}
