// src/lib/compliance/derivation/dea.ts
//
// DEA derivation rules. First framework to derive from a Credential —
// DEA_REGISTRATION flips COMPLIANT when the practice has an active,
// non-expired CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION
// on /programs/credentials.

import type { DerivationRule } from "./hipaa";
import { credentialTypePresentRule } from "./shared";

export const DEA_DERIVATION_RULES: Record<string, DerivationRule> = {
  DEA_REGISTRATION: credentialTypePresentRule(
    "DEA_CONTROLLED_SUBSTANCE_REGISTRATION",
  ),
};
