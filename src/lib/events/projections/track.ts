// src/lib/events/projections/track.ts
//
// Projections for Compliance Track lifecycle:
//   TRACK_GENERATED        → INSERT PracticeTrack + N PracticeTrackTask rows
//   TRACK_TASK_COMPLETED   → UPDATE one task's completedAt + completedByUserId
//   TRACK_TASK_REOPENED    → clear completedAt + completedByUserId on one task
//
// Plus the auto-generate helper used by projectPracticeProfileUpdated:
// generateTrackIfMissing(tx, practiceId) is idempotent — returns
// `{ generated: false }` if a track already exists, otherwise emits
// TRACK_GENERATED + writes rows.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { TRACK_TEMPLATES } from "@/lib/track/templates";
import {
  pickTemplateForProfile,
  type TrackTemplateCode,
} from "@/lib/track/applicability";

type TaskCompletedPayload = PayloadFor<"TRACK_TASK_COMPLETED", 1>;
type TaskReopenedPayload = PayloadFor<"TRACK_TASK_REOPENED", 1>;

export async function projectTrackGenerated(
  tx: Prisma.TransactionClient,
  args: {
    practiceId: string;
    templateCode: TrackTemplateCode;
  },
): Promise<void> {
  const tasks = TRACK_TEMPLATES[args.templateCode];
  await tx.practiceTrack.create({
    data: {
      practiceId: args.practiceId,
      templateCode: args.templateCode,
    },
  });
  for (const t of tasks) {
    await tx.practiceTrackTask.create({
      data: {
        practiceId: args.practiceId,
        weekTarget: t.weekTarget,
        sortOrder: t.sortOrder,
        title: t.title,
        description: t.description,
        href: t.href,
        requirementCode: t.requirementCode ?? null,
      },
    });
  }

  // Backfill pass: any task whose requirementCode matches an existing
  // COMPLIANT ComplianceItem on this practice is closed immediately,
  // emitting TRACK_TASK_COMPLETED with reason="DERIVED". Same shape as
  // the forward rederive auto-complete in rederiveRequirementStatus —
  // see src/lib/compliance/derivation/rederive.ts:142-188.
  const codedTasks = tasks
    .map((t) => t.requirementCode)
    .filter((code): code is string => code != null);
  if (codedTasks.length === 0) return;

  const compliantRequirementCodes = await tx.regulatoryRequirement.findMany({
    where: {
      code: { in: codedTasks },
      complianceItems: {
        some: { practiceId: args.practiceId, status: "COMPLIANT" },
      },
    },
    select: { code: true },
  });
  if (compliantRequirementCodes.length === 0) return;

  const compliantCodeSet = new Set(
    compliantRequirementCodes.map((r) => r.code),
  );
  const tasksToBackfill = await tx.practiceTrackTask.findMany({
    where: {
      practiceId: args.practiceId,
      requirementCode: { in: [...compliantCodeSet] },
      completedAt: null,
    },
    select: { id: true },
  });

  for (const t of tasksToBackfill) {
    await tx.eventLog.create({
      data: {
        practiceId: args.practiceId,
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
      data: {
        completedAt: new Date(),
        completedByUserId: null,
      },
    });
  }

  const remaining = await tx.practiceTrackTask.count({
    where: { practiceId: args.practiceId, completedAt: null },
  });
  if (remaining === 0) {
    await tx.practiceTrack.update({
      where: { practiceId: args.practiceId },
      data: { completedAt: new Date() },
    });
  }
}

export async function projectTrackTaskCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: TaskCompletedPayload },
): Promise<void> {
  await tx.practiceTrackTask.update({
    where: { id: args.payload.trackTaskId },
    data: {
      completedAt: new Date(),
      completedByUserId: args.payload.completedByUserId,
    },
  });
  await maybeMarkTrackComplete(tx, args.practiceId);
}

export async function projectTrackTaskReopened(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: TaskReopenedPayload },
): Promise<void> {
  await tx.practiceTrackTask.update({
    where: { id: args.payload.trackTaskId },
    data: { completedAt: null, completedByUserId: null },
  });
  // Re-opening a task always clears the track's completedAt — even if it
  // was already null, the no-op write is cheap and keeps the projection
  // simple.
  await tx.practiceTrack.update({
    where: { practiceId: args.practiceId },
    data: { completedAt: null },
  });
}

async function maybeMarkTrackComplete(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<void> {
  const remaining = await tx.practiceTrackTask.count({
    where: { practiceId, completedAt: null },
  });
  if (remaining === 0) {
    await tx.practiceTrack.update({
      where: { practiceId },
      data: { completedAt: new Date() },
    });
  }
}

export async function generateTrackIfMissing(
  tx: Prisma.TransactionClient,
  practiceId: string,
  actorUserId: string | null,
): Promise<{ generated: boolean; templateCode: TrackTemplateCode | null }> {
  const existing = await tx.practiceTrack.findUnique({
    where: { practiceId },
    select: { templateCode: true },
  });
  if (existing) {
    return {
      generated: false,
      templateCode: existing.templateCode as TrackTemplateCode,
    };
  }

  const profile = await tx.practiceComplianceProfile.findUnique({
    where: { practiceId },
    select: { specialtyCategory: true },
  });
  const templateCode = pickTemplateForProfile({
    specialtyCategory: profile?.specialtyCategory ?? null,
  });
  const tasks = TRACK_TEMPLATES[templateCode];

  await tx.eventLog.create({
    data: {
      practiceId,
      actorUserId,
      type: "TRACK_GENERATED",
      schemaVersion: 1,
      payload: { templateCode, taskCount: tasks.length },
    },
  });
  await projectTrackGenerated(tx, { practiceId, templateCode });
  return { generated: true, templateCode };
}
