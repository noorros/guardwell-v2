// tests/integration/osha-derivation.test.ts
//
// Integration tests for the three OSHA derivation rules added in PR 2:
//   - OSHA_REQUIRED_POSTERS  → POSTER_ATTESTATION in current calendar year
//   - OSHA_PPE               → PPE_ASSESSMENT_COMPLETED within last 365 days
//   - OSHA_GENERAL_DUTY      → 3 OSHA policies adopted + at least one SRA
//
// Mirrors the structure of tests/integration/policy-adoption.test.ts.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectPosterAttestation,
  projectPpeAssessmentCompleted,
} from "@/lib/events/projections/oshaAttestation";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";

// ─── helpers ────────────────────────────────────────────────────────────────

async function seedOsha() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const user = await db.user.create({
    data: {
      firebaseUid: `osha-deriv-${suffix}`,
      email: `osha-deriv-${suffix}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `OSHA Derivation Clinic ${suffix}`, primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "OSHA" },
  });
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

  async function req(code: string) {
    return db.regulatoryRequirement.findUniqueOrThrow({
      where: { frameworkId_code: { frameworkId: framework.id, code } },
    });
  }

  return { user, practice, framework, req };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

// ─── poster attestation ──────────────────────────────────────────────────────

describe("OSHA_REQUIRED_POSTERS derivation", () => {
  it("POSTER_ATTESTATION in current calendar year flips status to COMPLIANT", async () => {
    const { user, practice, req } = await seedOsha();
    const posterReq = await req("OSHA_REQUIRED_POSTERS");

    expect(await statusOf(practice.id, posterReq.id)).toBe("NOT_STARTED");

    const payload = {
      attestationId: randomUUID(),
      attestedByUserId: user.id,
      attestedAt: new Date().toISOString(),
      posters: ["OSHA_JOB_SAFETY"],
    };

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POSTER_ATTESTATION",
        payload,
      },
      async (tx) =>
        projectPosterAttestation(tx, { practiceId: practice.id }),
    );

    expect(await statusOf(practice.id, posterReq.id)).toBe("COMPLIANT");
  });
});

// ─── PPE assessment ──────────────────────────────────────────────────────────

describe("OSHA_PPE derivation", () => {
  it("PPE_ASSESSMENT_COMPLETED within last 365 days flips status to COMPLIANT", async () => {
    const { user, practice, req } = await seedOsha();
    const ppeReq = await req("OSHA_PPE");

    expect(await statusOf(practice.id, ppeReq.id)).toBe("NOT_STARTED");

    const payload = {
      assessmentId: randomUUID(),
      conductedByUserId: user.id,
      conductedAt: new Date().toISOString(),
      hazardsIdentified: ["SHARPS", "CHEMICAL"],
      ppeRequired: ["GLOVES", "EYE_PROTECTION"],
      notes: null,
    };

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PPE_ASSESSMENT_COMPLETED",
        payload,
      },
      async (tx) =>
        projectPpeAssessmentCompleted(tx, { practiceId: practice.id }),
    );

    expect(await statusOf(practice.id, ppeReq.id)).toBe("COMPLIANT");
  });
});

// ─── general duty composite ──────────────────────────────────────────────────

describe("OSHA_GENERAL_DUTY derivation", () => {
  it("3 OSHA policies adopted + 1 completed SRA → COMPLIANT", async () => {
    const { user, practice, req } = await seedOsha();
    const gdReq = await req("OSHA_GENERAL_DUTY");

    expect(await statusOf(practice.id, gdReq.id)).toBe("NOT_STARTED");

    // Directly create a completed SRA row. The oshaGeneralDutyRule queries
    // PracticeSraAssessment.completedAt directly — we don't need to go
    // through the full SRA_COMPLETED event projection (which would require
    // real SRA question codes seeded in the DB).
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: user.id,
        isDraft: false,
        completedAt: new Date(),
        overallScore: 80,
        addressedCount: 8,
        totalCount: 10,
      },
    });

    // Adopt first two policies — still GAP (EAP missing)
    for (const policyCode of [
      "OSHA_BBP_EXPOSURE_CONTROL_PLAN",
      "OSHA_HAZCOM_PROGRAM",
    ] as const) {
      const practicePolicyId = randomUUID();
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "POLICY_ADOPTED",
          payload: { practicePolicyId, policyCode, version: 1 },
        },
        async (tx) =>
          projectPolicyAdopted(tx, {
            practiceId: practice.id,
            payload: { practicePolicyId, policyCode, version: 1 },
          }),
      );
    }

    expect(await statusOf(practice.id, gdReq.id)).toBe("GAP");

    // Adopt the final policy (EAP) — triggers rederive, now policies_ok AND has_sra
    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POLICY_ADOPTED",
        payload: {
          practicePolicyId,
          policyCode: "OSHA_EMERGENCY_ACTION_PLAN",
          version: 1,
        },
      },
      async (tx) =>
        projectPolicyAdopted(tx, {
          practiceId: practice.id,
          payload: {
            practicePolicyId,
            policyCode: "OSHA_EMERGENCY_ACTION_PLAN",
            version: 1,
          },
        }),
    );

    expect(await statusOf(practice.id, gdReq.id)).toBe("COMPLIANT");
  });

  it("3 OSHA policies adopted but no SRA → GAP (has_sra false)", async () => {
    const { user, practice, req } = await seedOsha();
    const gdReq = await req("OSHA_GENERAL_DUTY");

    // Adopt all 3 policies but do NOT complete an SRA
    for (const policyCode of [
      "OSHA_BBP_EXPOSURE_CONTROL_PLAN",
      "OSHA_HAZCOM_PROGRAM",
      "OSHA_EMERGENCY_ACTION_PLAN",
    ] as const) {
      const practicePolicyId = randomUUID();
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "POLICY_ADOPTED",
          payload: { practicePolicyId, policyCode, version: 1 },
        },
        async (tx) =>
          projectPolicyAdopted(tx, {
            practiceId: practice.id,
            payload: { practicePolicyId, policyCode, version: 1 },
          }),
      );
    }

    // Still GAP — no SRA completed
    expect(await statusOf(practice.id, gdReq.id)).toBe("GAP");
  });
});
