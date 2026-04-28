// tests/integration/cms-derivation.test.ts
//
// Integration tests for CMS derivation rules (PR 4).
// Covers 3 newly wired rules + 1 stub + vacuous cases.
// Each test spins up an isolated practice with random suffixes so
// concurrent runs don't conflict.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";
import { projectOverpaymentReported } from "@/lib/events/projections/overpaymentReported";
import { CMS_DERIVATION_RULES } from "@/lib/compliance/derivation/cms";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

// ─── helpers ─────────────────────────────────────────────────────────────────

function practiceUuid() {
  return Math.random().toString(36).slice(2, 10);
}

async function seedCms() {
  const uid = practiceUuid();
  const user = await db.user.create({
    data: {
      firebaseUid: `cms-deriv-${uid}`,
      email: `cms-deriv-${uid}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `CMS Derivation Test Clinic ${uid}`, primaryState: "FL" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "CMS" },
  });
  const reqs = await db.regulatoryRequirement.findMany({
    where: { frameworkId: framework.id },
  });
  const byCode = new Map(reqs.map((r) => [r.code, r]));
  await db.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId: practice.id,
        frameworkId: framework.id,
      },
    },
    update: {},
    create: {
      practiceId: practice.id,
      frameworkId: framework.id,
      enabled: true,
      scoreCache: 0,
    },
  });
  return { user, practice, byCode };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("CMS derivation rules", () => {
  // ── CMS_EMERGENCY_PREPAREDNESS ────────────────────────────────────────────

  it("CMS_EMERGENCY_PREPAREDNESS_POLICY adoption flips CMS_EMERGENCY_PREPAREDNESS to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedCms();
    const req = byCode.get("CMS_EMERGENCY_PREPAREDNESS")!;
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");

    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POLICY_ADOPTED",
        payload: {
          practicePolicyId,
          policyCode: "CMS_EMERGENCY_PREPAREDNESS_POLICY",
          version: 1,
        },
      },
      async (tx) =>
        projectPolicyAdopted(tx, {
          practiceId: practice.id,
          payload: {
            practicePolicyId,
            policyCode: "CMS_EMERGENCY_PREPAREDNESS_POLICY",
            version: 1,
          },
        }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── CMS_STARK_AKS_COMPLIANCE ──────────────────────────────────────────────

  it("CMS_STARK_AKS_COMPLIANCE_POLICY adoption flips CMS_STARK_AKS_COMPLIANCE to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedCms();
    const req = byCode.get("CMS_STARK_AKS_COMPLIANCE")!;
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");

    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POLICY_ADOPTED",
        payload: {
          practicePolicyId,
          policyCode: "CMS_STARK_AKS_COMPLIANCE_POLICY",
          version: 1,
        },
      },
      async (tx) =>
        projectPolicyAdopted(tx, {
          practiceId: practice.id,
          payload: {
            practicePolicyId,
            policyCode: "CMS_STARK_AKS_COMPLIANCE_POLICY",
            version: 1,
          },
        }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── CMS_BILLING_COMPLIANCE (stub → policy-driven) ─────────────────────────

  it("CMS_BILLING_COMPLIANCE_POLICY adoption flips CMS_BILLING_COMPLIANCE to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedCms();
    const req = byCode.get("CMS_BILLING_COMPLIANCE")!;
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");

    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POLICY_ADOPTED",
        payload: {
          practicePolicyId,
          policyCode: "CMS_BILLING_COMPLIANCE_POLICY",
          version: 1,
        },
      },
      async (tx) =>
        projectPolicyAdopted(tx, {
          practiceId: practice.id,
          payload: {
            practicePolicyId,
            policyCode: "CMS_BILLING_COMPLIANCE_POLICY",
            version: 1,
          },
        }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── CMS_OVERPAYMENT_REFUND (vacuous) ──────────────────────────────────────

  it("CMS_OVERPAYMENT_REFUND is COMPLIANT when no recent OVERPAYMENT_REPORTED events exist", async () => {
    const { practice, byCode } = await seedCms();
    const req = byCode.get("CMS_OVERPAYMENT_REFUND")!;
    // No events emitted — rule should return COMPLIANT (no overpayments to report).
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "OVERPAYMENT:REPORTED");
    });
    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("CMS_OVERPAYMENT_REFUND is COMPLIANT when overpayment is reported within 60 days of identification", async () => {
    const { user, practice, byCode } = await seedCms();
    const req = byCode.get("CMS_OVERPAYMENT_REFUND")!;

    // identifiedAt = 10 days ago, reportedAt = now → within 60-day window.
    const identifiedAt = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const reportedAt = new Date().toISOString();

    const reportId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "OVERPAYMENT_REPORTED",
        payload: {
          reportId,
          reportedByUserId: user.id,
          reportedAt,
          identifiedAt,
          estimatedAmount: 500,
          payorType: "MEDICARE",
          refundMethod: "CHECK",
          notes: null,
        },
      },
      async (tx) =>
        projectOverpaymentReported(tx, { practiceId: practice.id }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("CMS_OVERPAYMENT_REFUND is GAP when an overpayment was identified recently but reportedAt is >60 days after identification", async () => {
    const { user, practice, byCode } = await seedCms();
    const req = byCode.get("CMS_OVERPAYMENT_REFUND")!;

    // identifiedAt = 5 days ago (within 60-day window → recent).
    // reportedAt = identifiedAt + 65 days (backdated future: the practice
    // self-reports a late refund, e.g. a historical reconciliation entry).
    // reportedAt - identifiedAt = 65 days > 60 days → GAP.
    const identifiedAt = new Date(
      Date.now() - 5 * 24 * 60 * 60 * 1000,
    );
    const reportedAt = new Date(
      identifiedAt.getTime() + 65 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const reportId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "OVERPAYMENT_REPORTED",
        payload: {
          reportId,
          reportedByUserId: user.id,
          reportedAt,
          identifiedAt: identifiedAt.toISOString(),
          estimatedAmount: 1200,
          payorType: "MEDICAID",
          refundMethod: null,
          notes: "Late refund — historical reconciliation",
        },
      },
      async (tx) =>
        projectOverpaymentReported(tx, { practiceId: practice.id }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("GAP");
  });

  // ── Rule function stubs invoked directly ──────────────────────────────────

  it("CMS_DERIVATION_RULES contains all 7 expected keys", () => {
    const expectedKeys = [
      "CMS_PECOS_ENROLLMENT",
      "CMS_NPI_REGISTRATION",
      "CMS_MEDICARE_PROVIDER_ENROLLMENT",
      "CMS_EMERGENCY_PREPAREDNESS",
      "CMS_STARK_AKS_COMPLIANCE",
      "CMS_BILLING_COMPLIANCE",
      "CMS_OVERPAYMENT_REFUND",
    ];
    for (const key of expectedKeys) {
      expect(CMS_DERIVATION_RULES[key], `Missing rule: ${key}`).toBeDefined();
    }
  });
});
