// src/lib/compliance/derivation/hipaaSra.ts
//
// HIPAA §164.308(a)(1)(ii)(A) — Security Risk Assessment.
//
// Rule: at least one PracticeSraAssessment completed within the last
// 365 days. This treats the SRA as an annual obligation, which is the
// OCR norm though the Security Rule itself says "periodic" and "when
// significant changes occur." For launch we ship the 12-month standard;
// practices can force a new assessment at any time.

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
  const count = await tx.practiceSraAssessment.count({
    where: {
      practiceId,
      isDraft: false,
      completedAt: { gt: cutoff },
    },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
};
