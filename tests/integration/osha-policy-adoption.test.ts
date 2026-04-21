// tests/integration/osha-policy-adoption.test.ts
//
// Validates that the derivation engine handles a second framework. Adopting
// an OSHA policy via the same POLICY_ADOPTED event (not a new event type)
// flips the corresponding OSHA requirement to COMPLIANT.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectPolicyAdopted,
  projectPolicyRetired,
} from "@/lib/events/projections/policyAdopted";
import type { OshaPolicyCode } from "@/lib/compliance/policies";

async function seedPracticeWithOsha() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "OSHA" },
    include: { requirements: true },
  });
  const byCode = new Map(framework.requirements.map((r) => [r.code, r]));
  const bbpReq = byCode.get("OSHA_BBP_EXPOSURE_CONTROL");
  const hazcomReq = byCode.get("OSHA_HAZCOM");
  const eapReq = byCode.get("OSHA_EMERGENCY_ACTION_PLAN");
  if (!bbpReq || !hazcomReq || !eapReq) {
    throw new Error(
      "OSHA policy requirements missing — run `npm run db:seed:osha` first.",
    );
  }
  return { user, practice, framework, bbpReq, hazcomReq, eapReq };
}

async function adopt(
  practiceId: string,
  userId: string,
  policyCode: OshaPolicyCode,
) {
  const practicePolicyId = randomUUID();
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "POLICY_ADOPTED",
      payload: { practicePolicyId, policyCode, version: 1 },
    },
    async (tx) =>
      projectPolicyAdopted(tx, {
        practiceId,
        payload: { practicePolicyId, policyCode, version: 1 },
      }),
  );
  return practicePolicyId;
}

async function retire(
  practiceId: string,
  userId: string,
  practicePolicyId: string,
  policyCode: OshaPolicyCode,
) {
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "POLICY_RETIRED",
      payload: { practicePolicyId, policyCode },
    },
    async (tx) =>
      projectPolicyRetired(tx, {
        practiceId,
        payload: { practicePolicyId, policyCode },
      }),
  );
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("OSHA policy adoption → OSHA requirement derivation", () => {
  it("adopting OSHA_BBP_EXPOSURE_CONTROL_PLAN flips OSHA_BBP_EXPOSURE_CONTROL to COMPLIANT", async () => {
    const { user, practice, bbpReq } = await seedPracticeWithOsha();
    expect(await statusOf(practice.id, bbpReq.id)).toBe("NOT_STARTED");

    await adopt(practice.id, user.id, "OSHA_BBP_EXPOSURE_CONTROL_PLAN");

    expect(await statusOf(practice.id, bbpReq.id)).toBe("COMPLIANT");
  });

  it("adopting 3 OSHA policies flips 3 OSHA requirements independently", async () => {
    const { user, practice, bbpReq, hazcomReq, eapReq } =
      await seedPracticeWithOsha();

    await adopt(practice.id, user.id, "OSHA_BBP_EXPOSURE_CONTROL_PLAN");
    await adopt(practice.id, user.id, "OSHA_HAZCOM_PROGRAM");
    await adopt(practice.id, user.id, "OSHA_EMERGENCY_ACTION_PLAN");

    expect(await statusOf(practice.id, bbpReq.id)).toBe("COMPLIANT");
    expect(await statusOf(practice.id, hazcomReq.id)).toBe("COMPLIANT");
    expect(await statusOf(practice.id, eapReq.id)).toBe("COMPLIANT");

    const pf = await db.practiceFramework.findUniqueOrThrow({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: (await db.regulatoryFramework.findUniqueOrThrow({ where: { code: "OSHA" } })).id,
        },
      },
    });
    // 3 of 8 compliant = 37.5 → rounds to 38
    expect(pf.scoreCache).toBe(38);
  });

  it("retiring an OSHA policy flips its requirement back to GAP", async () => {
    const { user, practice, bbpReq } = await seedPracticeWithOsha();
    const id = await adopt(practice.id, user.id, "OSHA_BBP_EXPOSURE_CONTROL_PLAN");
    expect(await statusOf(practice.id, bbpReq.id)).toBe("COMPLIANT");

    await retire(practice.id, user.id, id, "OSHA_BBP_EXPOSURE_CONTROL_PLAN");
    expect(await statusOf(practice.id, bbpReq.id)).toBe("GAP");
  });

  it("OSHA policy adoption does NOT affect HIPAA requirements", async () => {
    const { user, practice } = await seedPracticeWithOsha();
    const hipaa = await db.regulatoryFramework.findUniqueOrThrow({
      where: { code: "HIPAA" },
      include: { requirements: true },
    });
    const hipaaReqIds = new Set(hipaa.requirements.map((r) => r.id));

    await adopt(practice.id, user.id, "OSHA_HAZCOM_PROGRAM");

    const hipaaItems = await db.complianceItem.findMany({
      where: { practiceId: practice.id, requirementId: { in: Array.from(hipaaReqIds) } },
    });
    // None of the HIPAA requirements should have been touched.
    expect(hipaaItems).toHaveLength(0);
  });
});
