// src/app/onboarding/compliance-profile/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectPracticeProfileUpdated } from "@/lib/events/projections/practiceProfile";
import { deriveSpecialtyCategory } from "@/lib/specialties";

const Input = z.object({
  hasInHouseLab: z.boolean(),
  dispensesControlledSubstances: z.boolean(),
  medicareParticipant: z.boolean(),
  billsMedicaid: z.boolean(),
  subjectToMacraMips: z.boolean(),
  sendsAutomatedPatientMessages: z.boolean(),
  compoundsAllergens: z.boolean(),
  // Specific specialty (e.g. "Family Medicine"). The legacy 6-bucket
  // category is derived via deriveSpecialtyCategory() — never user-input.
  specialty: z.string().nullable().optional(),
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
  const specialty = parsed.specialty ?? null;
  const specialtyCategory = deriveSpecialtyCategory(specialty);

  // Persist the specific specialty on Practice. This field is descriptive
  // metadata — it doesn't drive framework applicability and so doesn't
  // need to flow through the event-sourcing pipeline.
  await db.practice.update({
    where: { id: pu.practiceId },
    data: { specialty },
  });

  // The event still carries the legacy 6-bucket specialtyCategory (derived)
  // — that's what PracticeComplianceProfile.specialtyCategory + framework
  // applicability logic consume.
  const eventPayload = {
    hasInHouseLab: parsed.hasInHouseLab,
    dispensesControlledSubstances: parsed.dispensesControlledSubstances,
    medicareParticipant: parsed.medicareParticipant,
    billsMedicaid: parsed.billsMedicaid,
    subjectToMacraMips: parsed.subjectToMacraMips,
    sendsAutomatedPatientMessages: parsed.sendsAutomatedPatientMessages,
    compoundsAllergens: parsed.compoundsAllergens,
    specialtyCategory,
    providerCount: parsed.providerCount ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "PRACTICE_PROFILE_UPDATED",
      payload: eventPayload,
    },
    async (tx) =>
      projectPracticeProfileUpdated(tx, {
        practiceId: pu.practiceId,
        payload: eventPayload,
      }),
  );

  // Framework enable/disable changes affect every dashboard surface.
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/audit/overview");
  revalidatePath("/settings/practice");
}
