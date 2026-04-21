// src/lib/compliance/derivation/dea.ts
//
// DEA derivation rules. First framework to derive from a Credential —
// a practice's DEA_REGISTRATION flips COMPLIANT when they have an
// active, non-expired CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION
// credential on /programs/credentials.
//
// The other 7 DEA requirements are manual-override for launch; wire when
// operational surfaces exist (inventory log, storage attestation, loss
// reporting, etc.).

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";

/**
 * Generic: is there at least one active, non-expired Credential for the
 * given credential-type code? "active" = retiredAt is null. "non-expired"
 * = expiryDate is null (perpetual) OR expiryDate is in the future.
 */
function credentialTypePresentRule(credentialTypeCode: string): DerivationRule {
  return async (
    tx: Prisma.TransactionClient,
    practiceId: string,
  ): Promise<DerivedStatus | null> => {
    const credType = await tx.credentialType.findUnique({
      where: { code: credentialTypeCode },
      select: { id: true },
    });
    if (!credType) return null; // type not seeded yet → rule doesn't apply

    const count = await tx.credential.count({
      where: {
        practiceId,
        credentialTypeId: credType.id,
        retiredAt: null,
        OR: [
          { expiryDate: null },
          { expiryDate: { gt: new Date() } },
        ],
      },
    });
    return count >= 1 ? "COMPLIANT" : "GAP";
  };
}

export const DEA_DERIVATION_RULES: Record<string, DerivationRule> = {
  DEA_REGISTRATION: credentialTypePresentRule(
    "DEA_CONTROLLED_SUBSTANCE_REGISTRATION",
  ),
};
