// src/lib/compliance/derivation/hipaaSra.ts
//
// HIPAA §164.308(a)(1)(ii)(A) — Security Risk Assessment.
//
// Rule: at least one PracticeSraAssessment completed within the last
// 365 days AND at least one TechAsset with processesPhi=true on file.
// The asset gate catches the "I just clicked through the SRA wizard
// without identifying any actual systems" failure mode.

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";

const DAY_MS = 24 * 60 * 60 * 1000;

export const hipaaSraRule: DerivationRule = async (
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> => {
  const cutoff = new Date(Date.now() - 365 * DAY_MS);
  // Only completed assessments count — drafts (isDraft=true) never
  // satisfy the HIPAA_SRA obligation, even if answered partially.
  const completedAssessments = await tx.practiceSraAssessment.count({
    where: {
      practiceId,
      isDraft: false,
      completedAt: { gt: cutoff },
    },
  });
  if (completedAssessments < 1) return "GAP";
  // Asset-inventory gate: an SRA without identified PHI assets is an
  // attestation, not an analysis. Require ≥1 active PHI-processing asset.
  const phiAssets = await tx.techAsset.count({
    where: { practiceId, processesPhi: true, retiredAt: null },
  });
  return phiAssets >= 1 ? "COMPLIANT" : "GAP";
};
