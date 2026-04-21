// src/lib/compliance/derivation/cms.ts
//
// CMS (Medicare/Medicaid) derivation rules. Three credential-based
// rules wire at launch — practices that have been tracking their NPI,
// PECOS enrollment, or Medicare provider enrollment in the Credentials
// catalog (session 7) get automatic CMS requirement coverage.

import type { DerivationRule } from "./hipaa";
import { credentialTypePresentRule } from "./shared";

export const CMS_DERIVATION_RULES: Record<string, DerivationRule> = {
  // Medicare's PECOS enrollment — required for Medicare billing.
  CMS_PECOS_ENROLLMENT: credentialTypePresentRule("MEDICARE_PECOS_ENROLLMENT"),
  // National Provider Identifier — required on every Medicare/Medicaid claim.
  CMS_NPI_REGISTRATION: credentialTypePresentRule("NPI_REGISTRATION"),
  // Active Medicare billing privileges via Form 855.
  CMS_MEDICARE_PROVIDER_ENROLLMENT: credentialTypePresentRule(
    "MEDICARE_PROVIDER_ENROLLMENT",
  ),
};
