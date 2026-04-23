// src/app/(dashboard)/programs/track/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectTrackTaskCompleted,
  projectTrackTaskReopened,
} from "@/lib/events/projections/track";

const TaskInput = z.object({
  trackTaskId: z.string().min(1),
});

export async function recordTrackTaskCompletionAction(
  input: z.infer<typeof TaskInput>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = TaskInput.parse(input);

  const task = await db.practiceTrackTask.findUnique({
    where: { id: parsed.trackTaskId },
    select: { practiceId: true, completedAt: true },
  });
  if (!task || task.practiceId !== pu.practiceId) {
    throw new Error("Task not found");
  }
  if (task.completedAt) return; // idempotent

  const payload = {
    trackTaskId: parsed.trackTaskId,
    completedByUserId: user.id,
    reason: "USER" as const,
  };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "TRACK_TASK_COMPLETED",
      payload,
    },
    async (tx) =>
      projectTrackTaskCompleted(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/track");
  revalidatePath("/dashboard");
}

export async function reopenTrackTaskAction(
  input: z.infer<typeof TaskInput>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = TaskInput.parse(input);

  const task = await db.practiceTrackTask.findUnique({
    where: { id: parsed.trackTaskId },
    select: { practiceId: true, completedAt: true },
  });
  if (!task || task.practiceId !== pu.practiceId) {
    throw new Error("Task not found");
  }
  if (!task.completedAt) return; // idempotent

  const payload = { trackTaskId: parsed.trackTaskId };
  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "TRACK_TASK_REOPENED",
      payload,
    },
    async (tx) =>
      projectTrackTaskReopened(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );
  revalidatePath("/programs/track");
}
