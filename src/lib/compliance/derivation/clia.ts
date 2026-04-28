// src/lib/compliance/derivation/clia.ts
//
// CLIA derivation rules. One credential-based rule at launch —
// CLIA_CERTIFICATE flips COMPLIANT when the practice has an active,
// non-expired CREDENTIAL_TYPE:CLIA_WAIVER_CERTIFICATE on
// /programs/credentials.
//
// CLIA manual-only requirements at v2 launch (7 of 8 requirements):
//
//   Requirement                  | Why manual at launch                                  | Unblocks when…
//   -----------------------------|-------------------------------------------------------|---------------------------------------
//   CLIA_LAB_DIRECTOR            | OFFICER_ROLES enum has no LAB_DIRECTOR; would need    | Phase 9+: extend OFFICER_ROLES enum +
//                                | additive PracticeUser.isLabDirector column.           | add isLabDirector boolean (additive)
//   CLIA_PATIENT_RESULTS         | No LabResult / LabReport model; v1's lab-ops module   | Phase 9+: LabResult model lands.
//                                | (LabReport, LabSpecimen, LabPanel) deliberately
//                                | deferred from v2 launch scope.
//   CLIA_INSPECTION_READINESS    | Composite signal — no single evidence event captures  | Phase 9+: when paired with LabResult +
//                                | "inspection-ready". V1 had a 14-question annual self-  | a self-assessment surface.
//                                | assessment surface; deferred.
//   CLIA_TEST_LIST               | No LabTest / LabPanel catalog model; v1's deferred.   | Phase 9+: LabTest model lands.
//   CLIA_MFR_INSTRUCTIONS        | Per-test attestation requires LabTest catalog first.  | Phase 9+ (depends on CLIA_TEST_LIST).
//   CLIA_STAFF_TRAINING          | CLIA_LAB_BASICS course not yet seeded — once seeded   | Phase 4: seed CLIA_LAB_BASICS course,
//                                | the existing courseCompletionThresholdRule pattern    | wire ["TRAINING:CLIA_LAB_BASICS"] in
//                                | (see OIG_TRAINING_EDUCATION) handles the rest.        | seed-clia.ts.
//   CLIA_QUALITY_CONTROL         | No QcLog model; v1's lab-ops surface deferred.        | Phase 9+: QcLog / QcRun models land.
//
// All 7 manual-only requirements remain user-overridable via /modules/clia
// radios at launch. The rederive helper has a USER-override guard, so when
// any of these are eventually wired they will not clobber existing manual
// COMPLIANT flips.

import type { DerivationRule } from "./hipaa";
import { credentialTypePresentRule } from "./shared";

export const CLIA_DERIVATION_RULES: Record<string, DerivationRule> = {
  CLIA_CERTIFICATE: credentialTypePresentRule("CLIA_WAIVER_CERTIFICATE"),
};
