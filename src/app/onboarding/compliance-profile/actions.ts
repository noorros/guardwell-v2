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
import { isValidStateCode } from "@/lib/states";
import { isValidNpi } from "@/lib/npi";

const Input = z.object({
  // 7 framework toggles — drive PracticeFramework.enabled via the v1 event
  hasInHouseLab: z.boolean(),
  dispensesControlledSubstances: z.boolean(),
  medicareParticipant: z.boolean(),
  billsMedicaid: z.boolean(),
  subjectToMacraMips: z.boolean(),
  sendsAutomatedPatientMessages: z.boolean(),
  compoundsAllergens: z.boolean(),
  // Practice profile fields — written directly to Practice (descriptive
  // metadata, not flowed through the event payload).
  // TODO(post-launch): the per-field DRY split between this action and
  // savePracticeProfileAction is intentional — they emit different event
  // versions (v1 here drives framework projection, v2 in settings is
  // audit-only). Future cleanup welcome once both flows stabilize.
  name: z.string().min(1).max(200).optional(),
  npiNumber: z.string().nullable().optional(),
  entityType: z
    .enum(["COVERED_ENTITY", "BUSINESS_ASSOCIATE"])
    .optional(),
  addressStreet: z.string().nullable().optional(),
  addressSuite: z.string().nullable().optional(),
  addressCity: z.string().nullable().optional(),
  addressZip: z
    .string()
    .regex(/^\d{5}$/)
    .nullable()
    .optional(),
  ehrSystem: z.string().nullable().optional(),
  primaryState: z.string().length(2).optional(),
  // Specific specialty (e.g. "Family Medicine"). The legacy 6-bucket
  // category is derived via deriveSpecialtyCategory() — never user-input.
  specialty: z.string().nullable().optional(),
  // Provider headcount enum — Practice.providerCount is the new String
  // column ("SOLO" | "SMALL_2_5" | ...); a legacy Int? still lives on
  // PracticeComplianceProfile.providerCount and is left untouched here.
  providerCount: z
    .enum(["SOLO", "SMALL_2_5", "MEDIUM_6_15", "LARGE_16_PLUS"])
    .optional(),
  operatingStates: z.array(z.string().length(2)).default([]),
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

  if (parsed.npiNumber && !isValidNpi(parsed.npiNumber)) {
    throw new Error("Invalid NPI checksum.");
  }
  if (parsed.primaryState && !isValidStateCode(parsed.primaryState)) {
    throw new Error("Invalid primary state.");
  }

  const specialty = parsed.specialty ?? null;
  const specialtyCategory = deriveSpecialtyCategory(specialty);
  const validOperatingStates = (parsed.operatingStates ?? [])
    .map((c) => c.toUpperCase())
    .filter(isValidStateCode);

  // Persist the descriptive Practice fields. None of these drive
  // framework applicability and so don't need to flow through the
  // event-sourcing pipeline.
  const practiceUpdate: Record<string, unknown> = {
    specialty,
    operatingStates: validOperatingStates,
  };
  if (parsed.name !== undefined) practiceUpdate.name = parsed.name;
  if (parsed.npiNumber !== undefined) practiceUpdate.npiNumber = parsed.npiNumber;
  if (parsed.entityType !== undefined) practiceUpdate.entityType = parsed.entityType;
  if (parsed.addressStreet !== undefined)
    practiceUpdate.addressStreet = parsed.addressStreet;
  if (parsed.addressSuite !== undefined)
    practiceUpdate.addressSuite = parsed.addressSuite;
  if (parsed.addressCity !== undefined)
    practiceUpdate.addressCity = parsed.addressCity;
  if (parsed.addressZip !== undefined) practiceUpdate.addressZip = parsed.addressZip;
  if (parsed.ehrSystem !== undefined) practiceUpdate.ehrSystem = parsed.ehrSystem;
  if (parsed.primaryState !== undefined)
    practiceUpdate.primaryState = parsed.primaryState;
  if (parsed.providerCount !== undefined)
    practiceUpdate.providerCount = parsed.providerCount;

  await db.practice.update({
    where: { id: pu.practiceId },
    data: practiceUpdate,
  });

  // The event still carries the legacy 6-bucket specialtyCategory (derived)
  // — that's what PracticeComplianceProfile.specialtyCategory + framework
  // applicability logic consume. providerCount in the v1 payload is the
  // legacy Int? on PracticeComplianceProfile, kept null because the new
  // enum lives on Practice and isn't part of this projection.
  const eventPayload = {
    hasInHouseLab: parsed.hasInHouseLab,
    dispensesControlledSubstances: parsed.dispensesControlledSubstances,
    medicareParticipant: parsed.medicareParticipant,
    billsMedicaid: parsed.billsMedicaid,
    subjectToMacraMips: parsed.subjectToMacraMips,
    sendsAutomatedPatientMessages: parsed.sendsAutomatedPatientMessages,
    compoundsAllergens: parsed.compoundsAllergens,
    specialtyCategory,
    providerCount: null,
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
