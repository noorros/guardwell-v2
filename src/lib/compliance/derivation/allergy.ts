// src/lib/compliance/derivation/allergy.ts
//
// Four derived rules for the ALLERGY framework. The other 5 §21
// requirements (designated area, hand hygiene, BUD labeling, vial
// labeling, records retention) are POLICY:* attestation evidence and
// derive via the existing policy-derivation pipeline.

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";

const KIT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const FRIDGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DRILL_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/** Are all `requiresAllergyCompetency=true` users isFullyQualified for the current year? */
export async function deriveAllergyCompetency(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const required = await tx.practiceUser.findMany({
    where: {
      practiceId,
      requiresAllergyCompetency: true,
      removedAt: null,
    },
    select: { id: true },
  });
  if (required.length === 0) return "NOT_STARTED";
  const year = new Date().getFullYear();
  const qualified = await tx.allergyCompetency.findMany({
    where: {
      practiceId,
      year,
      isFullyQualified: true,
      practiceUserId: { in: required.map((r) => r.id) },
    },
    select: { practiceUserId: true },
  });
  if (qualified.length === required.length) return "COMPLIANT";
  return "GAP";
}

export async function deriveAllergyEmergencyKit(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const latest = await tx.allergyEquipmentCheck.findFirst({
    // Audit #15: skip soft-deleted rows so retiring a stale check
    // can flip the rule back to NOT_STARTED / GAP correctly.
    where: { practiceId, checkType: "EMERGENCY_KIT", retiredAt: null },
    orderBy: { checkedAt: "desc" },
  });
  if (!latest) return "NOT_STARTED";
  if (latest.checkedAt.getTime() < Date.now() - KIT_WINDOW_MS) {
    return "GAP";
  }
  if (!latest.allItemsPresent) {
    return "GAP";
  }
  if (latest.epiExpiryDate && latest.epiExpiryDate.getTime() < Date.now()) {
    return "GAP";
  }
  return "COMPLIANT";
}

export async function deriveAllergyRefrigeratorLog(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const latest = await tx.allergyEquipmentCheck.findFirst({
    where: {
      practiceId,
      checkType: "REFRIGERATOR_TEMP",
      checkedAt: { gt: new Date(Date.now() - FRIDGE_WINDOW_MS) },
      retiredAt: null, // audit #15
    },
    orderBy: { checkedAt: "desc" },
  });
  if (!latest) return "NOT_STARTED";
  if (!latest.inRange) {
    return "GAP";
  }
  return "COMPLIANT";
}

export async function deriveAllergyAnnualDrill(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const latest = await tx.allergyDrill.findFirst({
    where: { practiceId, retiredAt: null }, // audit #15
    orderBy: { conductedAt: "desc" },
  });
  if (!latest) return "NOT_STARTED";
  if (latest.conductedAt.getTime() < Date.now() - DRILL_WINDOW_MS) {
    return "GAP";
  }
  return "COMPLIANT";
}

export const ALLERGY_DERIVATIONS: Record<string, DerivationRule> = {
  ALLERGY_COMPETENCY: deriveAllergyCompetency,
  ALLERGY_EMERGENCY_KIT_CURRENT: deriveAllergyEmergencyKit,
  ALLERGY_REFRIGERATOR_LOG: deriveAllergyRefrigeratorLog,
  ALLERGY_ANNUAL_DRILL: deriveAllergyAnnualDrill,
} as const;
