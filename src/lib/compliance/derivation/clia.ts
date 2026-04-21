// src/lib/compliance/derivation/clia.ts
//
// CLIA derivation rules. One credential-based rule at launch —
// CLIA_CERTIFICATE flips COMPLIANT when the practice has an active,
// non-expired CREDENTIAL_TYPE:CLIA_WAIVER_CERTIFICATE on
// /programs/credentials. Other 7 CLIA requirements are manual until
// their operational surfaces ship (lab test menu, QC logs, competency
// assessments, PT enrollment — all deferred from v1's lab-ops module).

import type { DerivationRule } from "./hipaa";
import { credentialTypePresentRule } from "./shared";

export const CLIA_DERIVATION_RULES: Record<string, DerivationRule> = {
  CLIA_CERTIFICATE: credentialTypePresentRule("CLIA_WAIVER_CERTIFICATE"),
};
