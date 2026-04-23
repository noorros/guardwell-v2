// src/lib/events/projections/practiceProfile.ts
//
// Upserts the PracticeComplianceProfile AND flips
// PracticeFramework.enabled according to the applicability matrix:
//
//   HIPAA, OSHA, OIG  → always on (baseline for any healthcare practice)
//   CLIA              → on when hasInHouseLab
//   DEA               → on when dispensesControlledSubstances
//   CMS               → on when medicareParticipant OR billsMedicaid
//   MACRA             → on when subjectToMacraMips
//   TCPA              → on when sendsAutomatedPatientMessages
//
// Disabling a framework is non-destructive: scoreCache is preserved, we
// only set enabled=false + disabledAt. Re-enabling clears disabledAt.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type Payload = PayloadFor<"PRACTICE_PROFILE_UPDATED", 1>;

export function computeFrameworkApplicability(
  profile: Pick<
    Payload,
    | "hasInHouseLab"
    | "dispensesControlledSubstances"
    | "medicareParticipant"
    | "billsMedicaid"
    | "subjectToMacraMips"
    | "sendsAutomatedPatientMessages"
  >,
): Record<string, boolean> {
  return {
    HIPAA: true,
    OSHA: true,
    OIG: true,
    CLIA: profile.hasInHouseLab,
    DEA: profile.dispensesControlledSubstances,
    CMS: profile.medicareParticipant || profile.billsMedicaid,
    MACRA: profile.subjectToMacraMips,
    TCPA: profile.sendsAutomatedPatientMessages,
  };
}

export async function projectPracticeProfileUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;

  await tx.practiceComplianceProfile.upsert({
    where: { practiceId },
    create: {
      practiceId,
      hasInHouseLab: payload.hasInHouseLab,
      dispensesControlledSubstances: payload.dispensesControlledSubstances,
      medicareParticipant: payload.medicareParticipant,
      billsMedicaid: payload.billsMedicaid,
      subjectToMacraMips: payload.subjectToMacraMips,
      sendsAutomatedPatientMessages: payload.sendsAutomatedPatientMessages,
      specialtyCategory: payload.specialtyCategory ?? null,
      providerCount: payload.providerCount ?? null,
    },
    update: {
      hasInHouseLab: payload.hasInHouseLab,
      dispensesControlledSubstances: payload.dispensesControlledSubstances,
      medicareParticipant: payload.medicareParticipant,
      billsMedicaid: payload.billsMedicaid,
      subjectToMacraMips: payload.subjectToMacraMips,
      sendsAutomatedPatientMessages: payload.sendsAutomatedPatientMessages,
      specialtyCategory: payload.specialtyCategory ?? null,
      providerCount: payload.providerCount ?? null,
    },
  });

  // Flip PracticeFramework.enabled per the applicability matrix.
  const applicability = computeFrameworkApplicability(payload);
  const frameworks = await tx.regulatoryFramework.findMany({
    select: { id: true, code: true },
  });
  const now = new Date();
  for (const f of frameworks) {
    const shouldBeEnabled = applicability[f.code] ?? true;
    const existing = await tx.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: { practiceId, frameworkId: f.id },
      },
    });
    if (!existing) {
      // Only create if the framework should be active — don't pollute
      // the table with explicit disabled rows for every disabled
      // framework for every practice.
      if (shouldBeEnabled) {
        await tx.practiceFramework.create({
          data: {
            practiceId,
            frameworkId: f.id,
            enabled: true,
            enabledAt: now,
            scoreCache: 0,
            scoreLabel: "At Risk",
            lastScoredAt: now,
          },
        });
      }
      continue;
    }
    if (shouldBeEnabled && !existing.enabled) {
      await tx.practiceFramework.update({
        where: {
          practiceId_frameworkId: { practiceId, frameworkId: f.id },
        },
        data: { enabled: true, disabledAt: null, enabledAt: now },
      });
    } else if (!shouldBeEnabled && existing.enabled) {
      await tx.practiceFramework.update({
        where: {
          practiceId_frameworkId: { practiceId, frameworkId: f.id },
        },
        data: { enabled: false, disabledAt: now },
      });
    }
  }
}
