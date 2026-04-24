// src/app/onboarding/first-run/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectFirstRunCompleted } from "@/lib/events/projections/firstRunCompleted";

const Input = z.object({
  stepsCompleted: z.array(z.string()).min(1),
  durationSeconds: z.number().int().min(0).default(0),
});

export async function completeFirstRunAction(
  input: z.infer<typeof Input>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can complete onboarding");
  }
  const parsed = Input.parse(input);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "ONBOARDING_FIRST_RUN_COMPLETED",
      payload: {
        completedByUserId: user.id,
        stepsCompleted: parsed.stepsCompleted,
        durationSeconds: parsed.durationSeconds,
      },
    },
    async (tx) =>
      projectFirstRunCompleted(tx, {
        practiceId: pu.practiceId,
        payload: {
          completedByUserId: user.id,
          stepsCompleted: parsed.stepsCompleted,
          durationSeconds: parsed.durationSeconds,
        },
      }),
  );

  revalidatePath("/dashboard");
  revalidatePath("/programs/track");
}
