// tests/integration/tcpa-derivation.test.ts
//
// Integration tests for the TCPA derivation rules added in PR 6.
// All three rules are policy-driven (no new event types). Four other
// TCPA requirements are manual-only stubs (consent records, calling hours,
// marketing/informational consent) and are not exercised here — those will
// derive from PatientConsentRecord + DncEntry models when the TCPA
// operational surface ships in Phase 9+.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function seedTcpa() {
  const user = await db.user.create({
    data: {
      firebaseUid: `tcpa-deriv-${Math.random().toString(36).slice(2, 10)}`,
      email: `tcpa-deriv-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "TCPA Derivation Test Clinic", primaryState: "CA" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "TCPA" },
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

describe("TCPA derivation rules", () => {
  it("Adopting TCPA_CONSENT_POLICY flips TCPA_WRITTEN_CONSENT_POLICY to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedTcpa();
    const req = byCode.get("TCPA_WRITTEN_CONSENT_POLICY")!;
    expect(req).toBeDefined();

    await adoptPolicy(practice.id, user.id, "TCPA_CONSENT_POLICY");

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("Adopting TCPA_OPT_OUT_POLICY flips TCPA_OPT_OUT_MECHANISM to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedTcpa();
    const req = byCode.get("TCPA_OPT_OUT_MECHANISM")!;
    expect(req).toBeDefined();

    await adoptPolicy(practice.id, user.id, "TCPA_OPT_OUT_POLICY");

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("Adopting TCPA_DNC_COMPLIANCE_POLICY flips TCPA_DNC_COMPLIANCE to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedTcpa();
    const req = byCode.get("TCPA_DNC_COMPLIANCE")!;
    expect(req).toBeDefined();

    await adoptPolicy(practice.id, user.id, "TCPA_DNC_COMPLIANCE_POLICY");

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("TCPA_MARKETING_CONSENT stays NOT_STARTED — manual-only stub until Phase 9 consent records ship", async () => {
    const { practice, byCode } = await seedTcpa();
    const req = byCode.get("TCPA_MARKETING_CONSENT")!;
    expect(req).toBeDefined();

    // No event can satisfy this requirement at v2 launch — it will
    // derive from PatientConsentRecord rows when the TCPA operational
    // surface ships. Until then the requirement falls back to the
    // user-set status (NOT_STARTED with no override).
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");
  });
});
