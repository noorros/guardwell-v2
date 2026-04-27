// src/lib/compliance/derivation/index.ts
//
// Registry map keyed by RegulatoryRequirement.code. Each entry is a pure
// function that reads the current state and returns the derived status.
//
// Adding a new framework = export a `<FRAMEWORK>_DERIVATION_RULES` map
// from a sibling file and merge it here. The rederive helper looks up
// requirements by code, so there's no central switch statement to edit.

import { HIPAA_DERIVATION_RULES } from "./hipaa";
import { OSHA_DERIVATION_RULES } from "./osha";
import { OIG_DERIVATION_RULES } from "./oig";
import { DEA_DERIVATION_RULES } from "./dea";
import { CMS_DERIVATION_RULES } from "./cms";
import { CLIA_DERIVATION_RULES } from "./clia";
import { ALLERGY_DERIVATIONS } from "./allergy";
import type { DerivationRule } from "./hipaa";

export type { DerivationRule, DerivedStatus } from "./hipaa";

export const DERIVATION_RULES: Record<string, DerivationRule> = {
  ...HIPAA_DERIVATION_RULES,
  ...OSHA_DERIVATION_RULES,
  ...OIG_DERIVATION_RULES,
  ...DEA_DERIVATION_RULES,
  ...CMS_DERIVATION_RULES,
  ...CLIA_DERIVATION_RULES,
  ...ALLERGY_DERIVATIONS,
};
