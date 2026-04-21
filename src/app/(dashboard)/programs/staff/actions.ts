// src/app/(dashboard)/programs/staff/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { OFFICER_ROLES } from "@/lib/events/registry";
import { projectOfficerDesignated } from "@/lib/events/projections/officerDesignated";
import { db } from "@/lib/db";

const Input = z.object({
  practiceUserId: z.string().min(1),
  officerRole: z.enum(OFFICER_ROLES),
  designated: z.boolean(),
});

export async function toggleOfficerAction(input: z.infer<typeof Input>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = Input.parse(input);

  // Verify the target PracticeUser is in the same practice.
  const target = await db.practiceUser.findUnique({
    where: { id: parsed.practiceUserId },
  });
  if (!target || target.practiceId !== pu.practiceId) {
    throw new Error("Unauthorized: target user not in your practice");
  }
  if (target.removedAt) {
    throw new Error("Cannot designate a removed user");
  }

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "OFFICER_DESIGNATED",
      payload: {
        practiceUserId: parsed.practiceUserId,
        userId: target.userId,
        officerRole: parsed.officerRole,
        designated: parsed.designated,
      },
    },
    async (tx) =>
      projectOfficerDesignated(tx, {
        practiceId: pu.practiceId,
        payload: {
          practiceUserId: parsed.practiceUserId,
          userId: target.userId,
          officerRole: parsed.officerRole,
          designated: parsed.designated,
        },
      }),
  );

  revalidatePath("/programs/staff");
  revalidatePath("/modules/hipaa");
}
