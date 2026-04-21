// tests/integration/officer-designation.test.ts
//
// End-to-end: emit OFFICER_DESIGNATED, assert the derivation engine
// projects into ComplianceItem + PracticeFramework + EventLog. Also
// asserts the USER-override guard wins over later derivations.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectOfficerDesignated } from "@/lib/events/projections/officerDesignated";
import { projectRequirementStatusUpdated } from "@/lib/events/projections/requirementStatus";

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
  const pu = await db.practiceUser.create({
    data: {
      userId: user.id,
      practiceId: practice.id,
      role: "OWNER",
    },
  });
  // Ensure HIPAA seed ran (10 requirements). Tests rely on this.
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "HIPAA" },
    include: { requirements: true },
  });
  if (framework.requirements.length < 10) {
    throw new Error(
      `HIPAA framework has only ${framework.requirements.length} requirements; run \`npm run db:seed:hipaa\` first.`,
    );
  }
  const privacyReq = framework.requirements.find(
    (r) => r.code === "HIPAA_PRIVACY_OFFICER",
  );
  const securityReq = framework.requirements.find(
    (r) => r.code === "HIPAA_SECURITY_OFFICER",
  );
  if (!privacyReq || !securityReq) {
    throw new Error(
      "HIPAA officer requirements missing; the seed should create them.",
    );
  }
  return { user, practice, pu, framework, privacyReq, securityReq };
}

describe("OFFICER_DESIGNATED → HIPAA requirement derivation", () => {
  it("designating a Privacy Officer projects COMPLIANT + writes two events + updates framework score", async () => {
    const { user, practice, pu, framework, privacyReq } =
      await seedPracticeWithHipaa();

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "OFFICER_DESIGNATED",
        payload: {
          practiceUserId: pu.id,
          userId: user.id,
          officerRole: "PRIVACY",
          designated: true,
        },
      },
      async (tx) =>
        projectOfficerDesignated(tx, {
          practiceId: practice.id,
          payload: {
            practiceUserId: pu.id,
            userId: user.id,
            officerRole: "PRIVACY",
            designated: true,
          },
        }),
    );

    // PracticeUser flag updated.
    const refreshed = await db.practiceUser.findUniqueOrThrow({
      where: { id: pu.id },
    });
    expect(refreshed.isPrivacyOfficer).toBe(true);

    // ComplianceItem derived COMPLIANT.
    const ci = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: {
          practiceId: practice.id,
          requirementId: privacyReq.id,
        },
      },
    });
    expect(ci?.status).toBe("COMPLIANT");

    // Two events: OFFICER_DESIGNATED + REQUIREMENT_STATUS_UPDATED.
    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("OFFICER_DESIGNATED");
    expect(events[1]?.type).toBe("REQUIREMENT_STATUS_UPDATED");
    const payload1 = events[1]?.payload as { source?: string; requirementId?: string };
    expect(payload1.source).toBe("DERIVED");
    expect(payload1.requirementId).toBe(privacyReq.id);

    // PracticeFramework score: 1 compliant of 10 = 10.
    const pf = await db.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: framework.id,
        },
      },
    });
    expect(pf?.scoreCache).toBe(10);
  });

  it("removing the only Privacy Officer flips derivation back to GAP", async () => {
    const { user, practice, pu, framework, privacyReq } =
      await seedPracticeWithHipaa();

    // Designate, then remove.
    const emit = (designated: boolean) =>
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "OFFICER_DESIGNATED",
          payload: {
            practiceUserId: pu.id,
            userId: user.id,
            officerRole: "PRIVACY",
            designated,
          },
        },
        async (tx) =>
          projectOfficerDesignated(tx, {
            practiceId: practice.id,
            payload: {
              practiceUserId: pu.id,
              userId: user.id,
              officerRole: "PRIVACY",
              designated,
            },
          }),
      );
    await emit(true);
    await emit(false);

    const refreshed = await db.practiceUser.findUniqueOrThrow({
      where: { id: pu.id },
    });
    expect(refreshed.isPrivacyOfficer).toBe(false);

    const ci = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: {
          practiceId: practice.id,
          requirementId: privacyReq.id,
        },
      },
    });
    expect(ci?.status).toBe("GAP");

    const pf = await db.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: framework.id,
        },
      },
    });
    expect(pf?.scoreCache).toBe(0);
  });

  it("derivation does not downgrade a USER-source COMPLIANT (user override wins, both ways)", async () => {
    const { user, practice, pu, privacyReq } = await seedPracticeWithHipaa();

    // First, user manually asserts the requirement as COMPLIANT.
    const userPayload = {
      requirementId: privacyReq.id,
      frameworkCode: "HIPAA",
      requirementCode: privacyReq.code,
      previousStatus: "NOT_STARTED" as const,
      nextStatus: "COMPLIANT" as const,
      source: "USER" as const,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "REQUIREMENT_STATUS_UPDATED",
        payload: userPayload,
      },
      async (tx) =>
        projectRequirementStatusUpdated(tx, {
          practiceId: practice.id,
          payload: userPayload,
        }),
    );

    // Now designate + remove an officer; derivation should no-op on the
    // already-COMPLIANT item because the latest event was source=USER.
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "OFFICER_DESIGNATED",
        payload: {
          practiceUserId: pu.id,
          userId: user.id,
          officerRole: "PRIVACY",
          designated: true,
        },
      },
      async (tx) =>
        projectOfficerDesignated(tx, {
          practiceId: practice.id,
          payload: {
            practiceUserId: pu.id,
            userId: user.id,
            officerRole: "PRIVACY",
            designated: true,
          },
        }),
    );
    // Still only 2 total events (USER one + OFFICER_DESIGNATED, no derived).
    let events = await db.eventLog.findMany({
      where: { practiceId: practice.id },
    });
    expect(events).toHaveLength(2);

    // Remove the officer. Derivation would flip to GAP — but the user override
    // should keep it COMPLIANT.
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "OFFICER_DESIGNATED",
        payload: {
          practiceUserId: pu.id,
          userId: user.id,
          officerRole: "PRIVACY",
          designated: false,
        },
      },
      async (tx) =>
        projectOfficerDesignated(tx, {
          practiceId: practice.id,
          payload: {
            practiceUserId: pu.id,
            userId: user.id,
            officerRole: "PRIVACY",
            designated: false,
          },
        }),
    );

    const ci = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: {
          practiceId: practice.id,
          requirementId: privacyReq.id,
        },
      },
    });
    expect(ci?.status).toBe("COMPLIANT");

    // No extra REQUIREMENT_STATUS_UPDATED events emitted by derivation.
    events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "REQUIREMENT_STATUS_UPDATED" },
    });
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { source?: string }).source).toBe("USER");
  });
});
