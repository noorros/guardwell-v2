// tests/integration/policy-adoption.test.ts
//
// End-to-end: emit POLICY_ADOPTED / POLICY_RETIRED, assert the derivation
// engine flips HIPAA requirement statuses and the framework score
// recomputes. Covers the three important cases for HIPAA_POLICIES_PROCEDURES:
//   1. Adopting all three P&P policies → COMPLIANT
//   2. Adopting only two of the three → still GAP
//   3. Retiring one of the three after COMPLIANT → back to GAP

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectPolicyAdopted,
  projectPolicyRetired,
} from "@/lib/events/projections/policyAdopted";
import type { HipaaPolicyCode } from "@/lib/compliance/policies";

async function seedPracticeWithHipaa() {
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
    data: {
      userId: user.id,
      practiceId: practice.id,
      role: "OWNER",
    },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "HIPAA" },
    include: { requirements: true },
  });
  const byCode = new Map(framework.requirements.map((r) => [r.code, r]));
  const ppReq = byCode.get("HIPAA_POLICIES_PROCEDURES");
  const nppReq = byCode.get("HIPAA_NPP");
  const breachReq = byCode.get("HIPAA_BREACH_RESPONSE");
  if (!ppReq || !nppReq || !breachReq) {
    throw new Error(
      "HIPAA policy requirements missing; run `npm run db:seed:hipaa` first.",
    );
  }
  return { user, practice, framework, ppReq, nppReq, breachReq };
}

async function adopt(
  practiceId: string,
  userId: string,
  policyCode: HipaaPolicyCode,
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
  policyCode: HipaaPolicyCode,
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
    where: {
      practiceId_requirementId: { practiceId, requirementId },
    },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("POLICY_ADOPTED / POLICY_RETIRED → HIPAA requirement derivation", () => {
  it("adopting all 3 P&P policies flips HIPAA_POLICIES_PROCEDURES to COMPLIANT", async () => {
    const { user, practice, ppReq } = await seedPracticeWithHipaa();

    expect(await statusOf(practice.id, ppReq.id)).toBe("NOT_STARTED");

    await adopt(practice.id, user.id, "HIPAA_PRIVACY_POLICY");
    expect(await statusOf(practice.id, ppReq.id)).toBe("GAP");

    await adopt(practice.id, user.id, "HIPAA_SECURITY_POLICY");
    expect(await statusOf(practice.id, ppReq.id)).toBe("GAP");

    await adopt(practice.id, user.id, "HIPAA_BREACH_RESPONSE_POLICY");
    expect(await statusOf(practice.id, ppReq.id)).toBe("COMPLIANT");
  });

  it("adopting only 2 of 3 P&P policies leaves HIPAA_POLICIES_PROCEDURES as GAP", async () => {
    const { user, practice, ppReq } = await seedPracticeWithHipaa();

    await adopt(practice.id, user.id, "HIPAA_PRIVACY_POLICY");
    await adopt(practice.id, user.id, "HIPAA_SECURITY_POLICY");

    expect(await statusOf(practice.id, ppReq.id)).toBe("GAP");
  });

  it("retiring one of 3 adopted policies flips HIPAA_POLICIES_PROCEDURES back to GAP", async () => {
    const { user, practice, ppReq } = await seedPracticeWithHipaa();

    await adopt(practice.id, user.id, "HIPAA_PRIVACY_POLICY");
    await adopt(practice.id, user.id, "HIPAA_SECURITY_POLICY");
    const breachId = await adopt(
      practice.id,
      user.id,
      "HIPAA_BREACH_RESPONSE_POLICY",
    );
    expect(await statusOf(practice.id, ppReq.id)).toBe("COMPLIANT");

    await retire(practice.id, user.id, breachId, "HIPAA_BREACH_RESPONSE_POLICY");
    expect(await statusOf(practice.id, ppReq.id)).toBe("GAP");
  });

  it("adopting HIPAA_BREACH_RESPONSE_POLICY satisfies HIPAA_BREACH_RESPONSE independently", async () => {
    const { user, practice, breachReq, ppReq } = await seedPracticeWithHipaa();

    await adopt(practice.id, user.id, "HIPAA_BREACH_RESPONSE_POLICY");

    // Single-policy requirement flips COMPLIANT even though P&P is still GAP
    // (needs Privacy + Security too).
    expect(await statusOf(practice.id, breachReq.id)).toBe("COMPLIANT");
    expect(await statusOf(practice.id, ppReq.id)).toBe("GAP");
  });

  it("adopting HIPAA_NPP_POLICY satisfies HIPAA_NPP, retiring flips back to GAP", async () => {
    const { user, practice, nppReq } = await seedPracticeWithHipaa();

    const policyId = await adopt(practice.id, user.id, "HIPAA_NPP_POLICY");
    expect(await statusOf(practice.id, nppReq.id)).toBe("COMPLIANT");

    await retire(practice.id, user.id, policyId, "HIPAA_NPP_POLICY");
    expect(await statusOf(practice.id, nppReq.id)).toBe("GAP");
  });
});
