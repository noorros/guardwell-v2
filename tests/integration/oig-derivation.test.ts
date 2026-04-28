// tests/integration/oig-derivation.test.ts
//
// Integration tests for the OIG derivation rules added in PR 5.
// Covers the three rules that can be exercised end-to-end without
// seeding additional catalog data (training course not yet seeded):
//   1. OIG_WRITTEN_POLICIES  — adopt ≥2 OIG policies → COMPLIANT
//   2. OIG_AUDITING_MONITORING  — emit OIG_ANNUAL_REVIEW_SUBMITTED → COMPLIANT
//   3. OIG_RESPONSE_VIOLATIONS  — emit OIG_CORRECTIVE_ACTION_RESOLVED → COMPLIANT
//
// Additionally covers the partial-stub rules:
//   4. OIG_COMMUNICATION_LINES  — adopt OIG_ANONYMOUS_REPORTING_POLICY → COMPLIANT
//   5. OIG_ENFORCEMENT_DISCIPLINE  — adopt OIG_DISCIPLINE_POLICY → COMPLIANT (Phase 11 stub)
//   6. OIG_WRITTEN_POLICIES gap  — 1 of 3 policies → GAP
//   7. OIG_TRAINING_EDUCATION  — returns null (course not seeded) → NOT_STARTED (no override)

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";
import {
  projectOigAnnualReviewSubmitted,
  projectOigCorrectiveActionResolved,
} from "@/lib/events/projections/oigReview";

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function seedOig() {
  const user = await db.user.create({
    data: {
      firebaseUid: `oig-deriv-${Math.random().toString(36).slice(2, 10)}`,
      email: `oig-deriv-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "OIG Derivation Test Clinic", primaryState: "IL" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "OIG" },
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

async function adoptPolicy(
  practiceId: string,
  userId: string,
  policyCode: string,
) {
  const id = randomUUID();
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "POLICY_ADOPTED",
      payload: { practicePolicyId: id, policyCode, version: 1 },
    },
    async (tx) =>
      projectPolicyAdopted(tx, {
        practiceId,
        payload: { practicePolicyId: id, policyCode, version: 1 },
      }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OIG derivation rules", () => {
  it("Adopting 2 OIG policies flips OIG_WRITTEN_POLICIES to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_WRITTEN_POLICIES")!;
    expect(req).toBeDefined();

    await adoptPolicy(
      practice.id,
      user.id,
      "OIG_STANDARDS_OF_CONDUCT_POLICY",
    );
    await adoptPolicy(
      practice.id,
      user.id,
      "OIG_ANONYMOUS_REPORTING_POLICY",
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("Adopting only 1 OIG policy leaves OIG_WRITTEN_POLICIES as GAP", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_WRITTEN_POLICIES")!;
    expect(req).toBeDefined();

    await adoptPolicy(
      practice.id,
      user.id,
      "OIG_STANDARDS_OF_CONDUCT_POLICY",
    );

    expect(await statusOf(practice.id, req.id)).toBe("GAP");
  });

  it("OIG_ANNUAL_REVIEW_SUBMITTED within last 12 months flips OIG_AUDITING_MONITORING to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_AUDITING_MONITORING")!;
    expect(req).toBeDefined();

    const reviewPayload = {
      reviewId: randomUUID(),
      submittedByUserId: user.id,
      submittedAt: new Date().toISOString(),
      reviewType: "CODING_AUDIT" as const,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "OIG_ANNUAL_REVIEW_SUBMITTED",
        payload: reviewPayload,
      },
      async (tx) =>
        projectOigAnnualReviewSubmitted(tx, { practiceId: practice.id }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("OIG_CORRECTIVE_ACTION_RESOLVED flips OIG_RESPONSE_VIOLATIONS to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_RESPONSE_VIOLATIONS")!;
    expect(req).toBeDefined();

    const actionPayload = {
      actionId: randomUUID(),
      resolvedByUserId: user.id,
      resolvedAt: new Date().toISOString(),
      description: "Overbilling corrected and disclosed to CMS",
      disclosureEntityCode: null,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "OIG_CORRECTIVE_ACTION_RESOLVED",
        payload: actionPayload,
      },
      async (tx) =>
        projectOigCorrectiveActionResolved(tx, { practiceId: practice.id }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("Adopting OIG_ANONYMOUS_REPORTING_POLICY flips OIG_COMMUNICATION_LINES to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_COMMUNICATION_LINES")!;
    expect(req).toBeDefined();

    await adoptPolicy(
      practice.id,
      user.id,
      "OIG_ANONYMOUS_REPORTING_POLICY",
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("Adopting OIG_DISCIPLINE_POLICY flips OIG_ENFORCEMENT_DISCIPLINE to COMPLIANT (Phase 11 stub)", async () => {
    const { user, practice, byCode } = await seedOig();
    const req = byCode.get("OIG_ENFORCEMENT_DISCIPLINE")!;
    expect(req).toBeDefined();

    await adoptPolicy(
      practice.id,
      user.id,
      "OIG_DISCIPLINE_POLICY",
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("OIG_TRAINING_EDUCATION stays NOT_STARTED when OIG_COMPLIANCE_TRAINING course not seeded", async () => {
    const { practice, byCode } = await seedOig();
    const req = byCode.get("OIG_TRAINING_EDUCATION")!;
    expect(req).toBeDefined();

    // The courseCompletionThresholdRule returns null when the course is not
    // seeded, so no ComplianceItem row is written → status falls back to
    // NOT_STARTED (the default from statusOf helper).
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");
  });
});
