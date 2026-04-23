// src/app/onboarding/compliance-profile/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";

const Input = z.object({
  hasInHouseLab: z.boolean(),
  dispensesControlledSubstances: z.boolean(),
  medicareParticipant: z.boolean(),
  billsMedicaid: z.boolean(),
  subjectToMacraMips: z.boolean(),
  sendsAutomatedPatientMessages: z.boolean(),
  specialtyCategory: z
    .enum([
      "PRIMARY_CARE",
      "SPECIALTY",
      "DENTAL",
      "BEHAVIORAL",
      "ALLIED",
      "OTHER",
    ])
    .nullable()
    .optional(),
  providerCount: z.number().int().min(0).nullable().optional(),
});

export async function saveComplianceProfileAction(
  input: z.infer<typeof Input>,
): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can update the compliance profile");
  }
  const parsed = Input.parse(input);

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "PRACTICE_PROFILE_UPDATED",
      payload: parsed,
    },
    async (tx) =>
      projectPracticeProfileUpdated(tx, {
        practiceId: pu.practiceId,
        payload: parsed,
      }),
  );

  // Framework enable/disable changes affect every dashboard surface.
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/audit/overview");
  revalidatePath("/settings/practice");
}
