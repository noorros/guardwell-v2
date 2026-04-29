// src/lib/events/projections/practiceProfileSettings.ts
//
// Projection helper for PRACTICE_PROFILE_UPDATED v2 (settings surface).
// Writes the Practice columns + keeps the legacy 6-bucket category on
// PracticeComplianceProfile in sync. Distinct from
// practiceProfile.ts (v1, onboarding) which also flips
// PracticeFramework.enabled toggles — settings doesn't touch those.

import type { Prisma } from "@prisma/client";
import { deriveSpecialtyCategory } from "@/lib/specialties";
import type { PracticeProfileInput } from "@/components/gw/PracticeProfileForm/types";

export async function projectPracticeProfileSettingsUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; data: PracticeProfileInput },
): Promise<void> {
  const { practiceId, data } = args;
  await tx.practice.update({
    where: { id: practiceId },
    data: {
      name: data.name,
      npiNumber: data.npiNumber,
      entityType: data.entityType,
      primaryState: data.primaryState,
      operatingStates: data.operatingStates,
      timezone: data.timezone,
      addressStreet: data.addressStreet,
      addressSuite: data.addressSuite,
      addressCity: data.addressCity,
      addressZip: data.addressZip,
      specialty: data.specialty,
      providerCount: data.providerCount,
      ehrSystem: data.ehrSystem,
      staffHeadcount: data.staffHeadcount,
      phone: data.phone,
    },
  });
  const bucket = deriveSpecialtyCategory(data.specialty);
  await tx.practiceComplianceProfile.upsert({
    where: { practiceId },
    create: {
      practiceId,
      specialtyCategory: bucket,
    },
    update: {
      specialtyCategory: bucket,
    },
  });
}
