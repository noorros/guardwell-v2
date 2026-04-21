// src/app/(dashboard)/modules/[code]/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectRequirementStatusUpdated } from "@/lib/events/projections/requirementStatus";
import { REQUIREMENT_STATUS_VALUES } from "@/lib/events/registry";

const Input = z.object({
  frameworkCode: z.string().min(1),
  requirementId: z.string().min(1),
  requirementCode: z.string().min(1),
  nextStatus: z.enum(REQUIREMENT_STATUS_VALUES),
  previousStatus: z.enum(REQUIREMENT_STATUS_VALUES),
});

export async function updateRequirementStatusAction(
  input: z.infer<typeof Input>,
) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = Input.parse(input);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "REQUIREMENT_STATUS_UPDATED",
      payload: {
        requirementId: parsed.requirementId,
        frameworkCode: parsed.frameworkCode,
        requirementCode: parsed.requirementCode,
        previousStatus: parsed.previousStatus,
        nextStatus: parsed.nextStatus,
        source: "USER",
      },
    },
    async (tx, evt) =>
      projectRequirementStatusUpdated(tx, {
        practiceId: pu.practiceId,
        payload: {
          requirementId: parsed.requirementId,
          frameworkCode: parsed.frameworkCode,
          requirementCode: parsed.requirementCode,
          previousStatus: parsed.previousStatus,
          nextStatus: parsed.nextStatus,
          source: "USER",
        },
      }),
  );

  revalidatePath(`/modules/${parsed.frameworkCode.toLowerCase()}`);
}
