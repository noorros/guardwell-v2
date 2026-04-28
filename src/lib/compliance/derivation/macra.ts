// src/lib/compliance/derivation/macra.ts
//
// MACRA / MIPS derivation rules. Five activity-log-driven rules + one
// cross-framework SRA reuse + two manual-only stubs.
//
// PR 6 wires:
//   MACRA_MIPS_EXEMPTION_VERIFIED      ≥1 QUALITY activity for currentYear
//   MACRA_IMPROVEMENT_ACTIVITIES       ≥2 IMPROVEMENT activities for currentYear
//   MACRA_PROMOTING_INTEROPERABILITY   ≥1 PI activity for currentYear
//   MACRA_SECURITY_RISK_ANALYSIS       ≥1 completed SraAssessment (cross-framework)
//   MACRA_ANNUAL_DATA_SUBMISSION       ≥1 SUBMISSION activity for currentYear
//   MACRA_QUALITY_MEASURES             STUB (returns null until QPP catalog ships)
//   MACRA_CERTIFIED_EHR_TECHNOLOGY     STUB (returns null until TechAsset CEHRT tracking)
//
// Year scoping: rules query attestationYear === new Date().getFullYear().
// A 2025 activity counts toward 2025 attestation; on 2026-01-01 the
// requirement quietly returns to GAP until 2026 activities are logged.
// This matches the QPP performance year boundaries.
//
// The QUALITY activity-count rule for MACRA_MIPS_EXEMPTION_VERIFIED is a
// proxy — full eligibility verification requires the QPP Participation
// Status tool integration (deferred to Phase 9+). Logging any quality
// activity for the year demonstrates the practice has consciously
// engaged with MIPS for that performance year.

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";

// ─── Activity-count factory ────────────────────────────────────────────────
// All four MACRA category rules share the same shape — count
// MacraActivityLog rows for (practiceId, attestationYear, activityType)
// against a minimum threshold. The factory removes the duplication.

type ActivityType = "QUALITY" | "IMPROVEMENT" | "PI" | "SUBMISSION";

function macraActivityCountRule(
  activityType: ActivityType,
  minimum: number,
): DerivationRule {
  return async (
    tx: Prisma.TransactionClient,
    practiceId: string,
  ): Promise<DerivedStatus | null> => {
    const currentYear = new Date().getFullYear();
    const count = await tx.macraActivityLog.count({
      where: { practiceId, attestationYear: currentYear, activityType },
    });
    return count >= minimum ? "COMPLIANT" : "GAP";
  };
}

// ─── MACRA_SECURITY_RISK_ANALYSIS (cross-framework) ────────────────────────
// 45 CFR §164.308(a)(1)(ii)(A) is HIPAA's SRA requirement; MIPS PI category
// also requires a completed SRA per 42 CFR §414.1375. Reuse the HIPAA SRA
// evidence rather than make practices complete two parallel assessments.
// COMPLIANT when at least one PracticeSraAssessment exists with
// completedAt set (isDraft=false). Evidence code: "SRA_COMPLETED".

async function macraSecurityRiskAnalysisRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practiceSraAssessment.count({
    where: { practiceId, completedAt: { not: null }, isDraft: false },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── Manual-only stubs ────────────────────────────────────────────────────
// QPP quality-measure data + CEHRT certification tracking are deferred to
// Phase 9+ when the operational surfaces ship. Returning null tells
// rederive to skip — the requirement stays at the user-set status.

async function macraQualityMeasuresStub(): Promise<DerivedStatus | null> {
  return null; // TODO(Phase 9+): wire to QPP quality measure data model.
}

async function macraCertifiedEhrTechnologyStub(): Promise<DerivedStatus | null> {
  return null; // TODO(Phase 9+): wire to TechAsset CEHRT certification tracking.
}

// ─── Rule registry ────────────────────────────────────────────────────────

export const MACRA_DERIVATION_RULES: Record<string, DerivationRule> = {
  // §414.1305 low-volume threshold — proxy: ≥1 QUALITY activity for the year.
  MACRA_MIPS_EXEMPTION_VERIFIED: macraActivityCountRule("QUALITY", 1),
  // §414.1330 Quality category — STUB until QPP measure catalog ships.
  MACRA_QUALITY_MEASURES: macraQualityMeasuresStub,
  // §414.1355 Improvement Activities — ≥2 IA activities for the year (proxy
  // for the 40-point minimum; full point math requires the IA catalog).
  MACRA_IMPROVEMENT_ACTIVITIES: macraActivityCountRule("IMPROVEMENT", 2),
  // §414.1375 Promoting Interoperability — ≥1 PI activity for the year.
  MACRA_PROMOTING_INTEROPERABILITY: macraActivityCountRule("PI", 1),
  // §164.308(a)(1)(ii)(A) cross-referenced by PI — completed HIPAA SRA satisfies.
  MACRA_SECURITY_RISK_ANALYSIS: macraSecurityRiskAnalysisRule,
  // §414.1400 CEHRT — STUB until TechAsset CEHRT certification tracking ships.
  MACRA_CERTIFIED_EHR_TECHNOLOGY: macraCertifiedEhrTechnologyStub,
  // §414.1325 — ≥1 SUBMISSION activity for the year (QPP portal upload event).
  MACRA_ANNUAL_DATA_SUBMISSION: macraActivityCountRule("SUBMISSION", 1),
};
