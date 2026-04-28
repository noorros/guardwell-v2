// src/app/(dashboard)/programs/track/sync-internals.ts
//
// Server-only logic for re-running the track auto-complete pass against
// current ComplianceItem state. Pure-by-practiceId so it can be called
// from the server action AND from integration tests without RBAC/auth
// noise. The wrapping action layer handles auth.

import { db } from "@/lib/db";

export interface SyncResult {
  closed: number;
}

export async function syncTrackTasksFromEvidence(
  practiceId: string,
): Promise<SyncResult> {
  const track = await db.practiceTrack.findUnique({
    where: { practiceId },
    select: { practiceId: true },
  });
  if (!track) return { closed: 0 };

  return await db.$transaction(async (tx) => {
    const openCodedTasks = await tx.practiceTrackTask.findMany({
      where: {
        practiceId,
        completedAt: null,
        NOT: { requirementCode: null },
      },
      select: { id: true, requirementCode: true },
    });
    if (openCodedTasks.length === 0) return { closed: 0 };

    const codes = [...new Set(openCodedTasks.map((t) => t.requirementCode!))];
    const compliant = await tx.regulatoryRequirement.findMany({
      where: {
        code: { in: codes },
        complianceItems: {
          some: { practiceId, status: "COMPLIANT" },
        },
      },
      select: { code: true },
    });
    if (compliant.length === 0) return { closed: 0 };

    const compliantSet = new Set(compliant.map((c) => c.code));
    const tasksToClose = openCodedTasks.filter(
      (t) => t.requirementCode != null && compliantSet.has(t.requirementCode),
    );
    if (tasksToClose.length === 0) return { closed: 0 };

    for (const t of tasksToClose) {
      await tx.eventLog.create({
        data: {
          practiceId,
          actorUserId: null,
          type: "TRACK_TASK_COMPLETED",
          schemaVersion: 1,
          payload: {
            trackTaskId: t.id,
            completedByUserId: null,
            reason: "DERIVED",
          },
        },
      });
      await tx.practiceTrackTask.update({
        where: { id: t.id },
        data: { completedAt: new Date(), completedByUserId: null },
      });
    }

    const remaining = await tx.practiceTrackTask.count({
      where: { practiceId, completedAt: null },
    });
    if (remaining === 0) {
      await tx.practiceTrack.update({
        where: { practiceId },
        data: { completedAt: new Date() },
      });
    }

    return { closed: tasksToClose.length };
  });
}
