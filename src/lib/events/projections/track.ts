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
import { TRACK_TEMPLATES, type TrackTemplateTask } from "@/lib/track/templates";
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
  await backfillCompliantTasks(tx, args.practiceId, tasks);
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

// Backfill pass: any task whose requirementCode matches an existing
// COMPLIANT ComplianceItem on this practice is closed immediately. The
// task-set discovery is bespoke here (we have the template task list in
// hand); the close-loop itself is shared via autoCompleteTrackTasks.
async function backfillCompliantTasks(
  tx: Prisma.TransactionClient,
  practiceId: string,
  tasks: TrackTemplateTask[],
): Promise<void> {
  const codedTasks = tasks
    .map((t) => t.requirementCode)
    .filter((code): code is string => code != null);
  if (codedTasks.length === 0) return;

  const compliantRequirementCodes = await tx.regulatoryRequirement.findMany({
    where: {
      code: { in: codedTasks },
      complianceItems: {
        some: { practiceId, status: "COMPLIANT" },
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
      practiceId,
      requirementCode: { in: [...compliantCodeSet] },
      completedAt: null,
    },
    select: { id: true },
  });

  await autoCompleteTrackTasks(
    tx,
    practiceId,
    tasksToBackfill.map((t) => t.id),
  );
}

// Shared close-loop for derivation-driven auto-completion. Each caller
// computes its own set of task IDs (discovery differs by site — track
// generation has the template in hand, the manual Sync button queries
// open coded tasks, the rederive hook scopes to a single requirement),
// then delegates the byte-identical "emit TRACK_TASK_COMPLETED, update
// completedAt, maybe-mark-track-complete" loop here. Keeping it in one
// place means future event-payload changes (e.g. analytics metadata)
// are a single edit, not three.
//
// No-op when taskIds is empty — callers don't need to guard at the call
// site, and we skip maybeMarkTrackComplete when nothing closed (the
// track's completion state can't have changed).
export async function autoCompleteTrackTasks(
  tx: Prisma.TransactionClient,
  practiceId: string,
  taskIds: string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  for (const id of taskIds) {
    await tx.eventLog.create({
      data: {
        practiceId,
        actorUserId: null,
        type: "TRACK_TASK_COMPLETED",
        schemaVersion: 1,
        payload: {
          trackTaskId: id,
          completedByUserId: null,
          reason: "DERIVED",
        },
      },
    });
    await tx.practiceTrackTask.update({
      where: { id },
      data: {
        completedAt: new Date(),
        completedByUserId: null,
      },
    });
  }
  await maybeMarkTrackComplete(tx, practiceId);
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
