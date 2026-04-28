// src/lib/compliance/derivation/dea.ts
//
// DEA derivation rules. First framework to derive from a Credential —
// DEA_REGISTRATION flips COMPLIANT when the practice has an active,
// non-expired CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION
// on /programs/credentials.
//
// PR 3 adds 6 new rules + 1 Phase-11 stub:
//   DEA_INVENTORY          — biennial inventory check (24-month window)
//   DEA_RECORDS            — audit-trail composite (any CS activity in 24 mo)
//   DEA_STORAGE            — DEA_SECURE_STORAGE_POLICY adopted
//   DEA_PRESCRIPTION_SECURITY — policy adopted + EPCS attestation in 365 days
//   DEA_LOSS_REPORTING     — policy adopted + form106SubmittedAt on all reports
//   DEA_DISPOSAL           — any disposal record OR no CS activity (vacuous)
//   DEA_EMPLOYEE_SCREENING — STUB (Phase 11 — LeieScreening model pending)

import type { Prisma } from "@prisma/client";
import type { DerivationRule, DerivedStatus } from "./hipaa";
import { credentialTypePresentRule } from "./shared";

// 24-month window for biennial requirements (21 CFR §1304.11).
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
// 12-month window for annual attestations / EPCS check.
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// ─── DEA_INVENTORY ─────────────────────────────────────────────────────────
// 21 CFR §1304.11 — biennial controlled substance inventory.
// COMPLIANT when at least one DeaInventory row exists with asOfDate within
// the last 24 months. Evidence code: "DEA_INVENTORY:RECORDED".

async function deaInventoryRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const cutoff = new Date(Date.now() - TWO_YEARS_MS);
  const count = await tx.deaInventory.count({
    where: { practiceId, asOfDate: { gte: cutoff } },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── DEA_RECORDS ──────────────────────────────────────────────────────────
// 21 CFR §1304.22 — dispensing/administration records (2-year retention).
// Composite: any DeaInventory OR DeaOrderRecord OR DeaDisposalRecord in the
// last 24 months → COMPLIANT (records are being maintained).
// A practice with zero CS activity across all three tables is vacuously
// COMPLIANT — no controlled substances were handled, so no records are
// required. This mirrors the "zero recordable incidents" precedent from
// OSHA_300_LOG. Evidence code: "DEA_RECORDS:ACTIVITY".

async function deaRecordsRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const cutoff = new Date(Date.now() - TWO_YEARS_MS);

  const inventoryCount = await tx.deaInventory.count({
    where: { practiceId, asOfDate: { gte: cutoff } },
  });
  if (inventoryCount >= 1) return "COMPLIANT";

  const orderCount = await tx.deaOrderRecord.count({
    where: { practiceId, orderedAt: { gte: cutoff } },
  });
  if (orderCount >= 1) return "COMPLIANT";

  const disposalCount = await tx.deaDisposalRecord.count({
    where: { practiceId, disposalDate: { gte: cutoff } },
  });
  if (disposalCount >= 1) return "COMPLIANT";

  // No activity across any of the three record types within 24 months.
  // Check if the practice has ever had any CS activity at all.
  const everInventory = await tx.deaInventory.count({ where: { practiceId } });
  const everOrder = await tx.deaOrderRecord.count({ where: { practiceId } });
  const everDisposal = await tx.deaDisposalRecord.count({ where: { practiceId } });

  if (everInventory === 0 && everOrder === 0 && everDisposal === 0) {
    // Vacuously COMPLIANT — practice has never handled controlled substances.
    return "COMPLIANT";
  }

  // Had CS activity historically but records are stale (>24 months old).
  return "GAP";
}

// ─── DEA_STORAGE ──────────────────────────────────────────────────────────
// 21 CFR §1301.75 — secure storage.
// COMPLIANT when DEA_SECURE_STORAGE_POLICY is adopted (retiredAt null).
// Evidence code: "POLICY:DEA_SECURE_STORAGE_POLICY".

async function deaStorageRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  const count = await tx.practicePolicy.count({
    where: { practiceId, policyCode: "DEA_SECURE_STORAGE_POLICY", retiredAt: null },
  });
  return count >= 1 ? "COMPLIANT" : "GAP";
}

// ─── DEA_PRESCRIPTION_SECURITY ────────────────────────────────────────────
// 21 CFR §1311 — EPCS two-factor auth + audit trail.
// Composite: policy adopted AND at least one EPCS_ATTESTATION EventLog row
// within the last 365 days.
//   - policy only → GAP (not enough)
//   - policy + recent attestation → COMPLIANT
//   - no policy → GAP
// Evidence codes: "POLICY:DEA_PRESCRIPTION_SECURITY_POLICY", "EVENT:EPCS_ATTESTATION".
// (rederive is called by both projectPolicyAdopted and projectEpcsAttestation)

async function deaPrescriptionSecurityRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  // 1. Policy must be adopted.
  const policyCount = await tx.practicePolicy.count({
    where: {
      practiceId,
      policyCode: "DEA_PRESCRIPTION_SECURITY_POLICY",
      retiredAt: null,
    },
  });
  if (policyCount === 0) return "GAP";

  // 2. EPCS attestation must be present within the last 365 days.
  const cutoff = new Date(Date.now() - ONE_YEAR_MS);
  const epcsCount = await tx.eventLog.count({
    where: {
      practiceId,
      type: "EPCS_ATTESTATION",
      createdAt: { gte: cutoff },
    },
  });
  return epcsCount >= 1 ? "COMPLIANT" : "GAP";
}

// ─── DEA_LOSS_REPORTING ───────────────────────────────────────────────────
// 21 CFR §1301.76(b) — theft/significant-loss reporting (Form 106).
// Composite: policy adopted AND either:
//   (a) no DeaTheftLossReport rows for this practice → vacuously COMPLIANT
//   (b) all existing reports have form106SubmittedAt IS NOT NULL → COMPLIANT
//   (c) any report has form106SubmittedAt null → GAP
// Evidence codes: "POLICY:DEA_LOSS_REPORTING_POLICY", "DEA_THEFT_LOSS:REPORTED".

async function deaLossReportingRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  // 1. Policy must be adopted.
  const policyCount = await tx.practicePolicy.count({
    where: {
      practiceId,
      policyCode: "DEA_LOSS_REPORTING_POLICY",
      retiredAt: null,
    },
  });
  if (policyCount === 0) return "GAP";

  // 2. Check all theft/loss reports.
  const totalReports = await tx.deaTheftLossReport.count({ where: { practiceId } });
  if (totalReports === 0) {
    // Vacuously COMPLIANT — no theft/loss events to report.
    return "COMPLIANT";
  }

  // All reports must have form106SubmittedAt set (field exists in schema,
  // confirmed in registry.ts: form106SubmittedAt: z.string().datetime().nullable()).
  const unfiledCount = await tx.deaTheftLossReport.count({
    where: { practiceId, form106SubmittedAt: null },
  });
  return unfiledCount === 0 ? "COMPLIANT" : "GAP";
}

// ─── DEA_DISPOSAL ─────────────────────────────────────────────────────────
// 21 CFR Part 1317 — controlled substance disposal.
// COMPLIANT if at least one DeaDisposalRecord exists (any disposal documented)
// OR if the practice has never ordered or inventoried any controlled substances
// (vacuously COMPLIANT — nothing to dispose of).
// Evidence code: "DEA_DISPOSAL:COMPLETED".

async function deaDisposalRule(
  tx: Prisma.TransactionClient,
  practiceId: string,
): Promise<DerivedStatus | null> {
  // Any disposal record ever → COMPLIANT (disposal pathway demonstrated).
  const disposalCount = await tx.deaDisposalRecord.count({ where: { practiceId } });
  if (disposalCount > 0) return "COMPLIANT";

  // No disposal records — check if practice has ever ordered/inventoried CS.
  // If they have, they need to demonstrate a disposal pathway.
  const orderCount = await tx.deaOrderRecord.count({ where: { practiceId } });
  const inventoryCount = await tx.deaInventory.count({ where: { practiceId } });

  if (orderCount === 0 && inventoryCount === 0) {
    // Vacuously COMPLIANT — practice has never touched controlled substances.
    return "COMPLIANT";
  }

  // Has CS activity but no documented disposal → GAP.
  return "GAP";
}

// ─── DEA_EMPLOYEE_SCREENING (stub) ────────────────────────────────────────
// TODO(Phase 11): Wire to LeieScreening once the LeieScreening model lands.
// The OIG LEIE check will confirm no workforce member with CS access has a
// disqualifying conviction (21 CFR §1301.90). Returns null so rederive skips
// and the ComplianceItem stays NOT_STARTED until Phase 11 ships.

async function deaEmployeeScreeningStub(): Promise<DerivedStatus | null> {
  return null;
}

// ─── Rule registry ────────────────────────────────────────────────────────

export const DEA_DERIVATION_RULES: Record<string, DerivationRule> = {
  // §1301.13 — Current DEA registration (credential-backed).
  DEA_REGISTRATION: credentialTypePresentRule(
    "DEA_CONTROLLED_SUBSTANCE_REGISTRATION",
  ),
  // §1304.11 — Biennial inventory (24-month window).
  DEA_INVENTORY: deaInventoryRule,
  // §1304.22 — Dispensing/administration records (composite, 24-month window).
  DEA_RECORDS: deaRecordsRule,
  // §1301.75 — Secure storage (policy-driven).
  DEA_STORAGE: deaStorageRule,
  // §1311 — Prescription security + EPCS (composite).
  DEA_PRESCRIPTION_SECURITY: deaPrescriptionSecurityRule,
  // §1301.76(b) — Theft/loss reporting (policy + form106SubmittedAt).
  DEA_LOSS_REPORTING: deaLossReportingRule,
  // Part 1317 — Disposal (any record OR vacuous).
  DEA_DISPOSAL: deaDisposalRule,
  // §1301.90 — Employee screening (stub until Phase 11).
  DEA_EMPLOYEE_SCREENING: deaEmployeeScreeningStub,
};
