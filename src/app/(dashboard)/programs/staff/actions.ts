// src/app/(dashboard)/programs/staff/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { OFFICER_ROLES } from "@/lib/events/registry";
import { projectOfficerDesignated } from "@/lib/events/projections/officerDesignated";
import { db } from "@/lib/db";

const Input = z.object({
  practiceUserId: z.string().min(1),
  officerRole: z.enum(OFFICER_ROLES),
  designated: z.boolean(),
});

/**
 * Audit C-2 (HIPAA): officer designation gated to OWNER. The Privacy /
 * Security / Compliance Officer roles are HIPAA-required positions
 * (§164.308(a)(2)) — assigning them is org-chart-level authority, not a
 * routine ADMIN operation. Without this gate, any STAFF/VIEWER could
 * self-promote to Security Officer.
 */
export async function toggleOfficerAction(input: z.infer<typeof Input>) {
  const pu = await requireRole("OWNER");
  const user = pu.dbUser;
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
