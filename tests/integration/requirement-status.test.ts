// tests/integration/requirement-status.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectRequirementStatusUpdated } from "@/lib/events/projections/requirementStatus";

async function seedPracticeAndHipaaReq() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "HIPAA" },
    update: {},
    create: {
      code: "HIPAA",
      name: "HIPAA",
      description: "Test fixture — not used for real compliance",
      jurisdiction: "federal",
    },
  });
  const requirement = await db.regulatoryRequirement.upsert({
    where: { frameworkId_code: { frameworkId: framework.id, code: "HIPAA_SRA" } },
    update: {},
    create: {
      frameworkId: framework.id,
      code: "HIPAA_SRA",
      title: "SRA",
      description: "test",
    },
  });
  return { user, practice, framework, requirement };
}

describe("REQUIREMENT_STATUS_UPDATED", () => {
  it("projects a new ComplianceItem with the next status + writes an EventLog row", async () => {
    const { user, practice, requirement } = await seedPracticeAndHipaaReq();

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "REQUIREMENT_STATUS_UPDATED",
        payload: {
          requirementId: requirement.id,
          frameworkCode: "HIPAA",
          requirementCode: "HIPAA_SRA",
          previousStatus: "NOT_STARTED",
          nextStatus: "COMPLIANT",
          source: "USER",
        },
      },
      async (tx) =>
        projectRequirementStatusUpdated(tx, {
          practiceId: practice.id,
          payload: {
            requirementId: requirement.id,
            frameworkCode: "HIPAA",
            requirementCode: "HIPAA_SRA",
            previousStatus: "NOT_STARTED",
            nextStatus: "COMPLIANT",
            source: "USER",
          },
        }),
    );

    const ci = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: {
          practiceId: practice.id,
          requirementId: requirement.id,
        },
      },
    });
    expect(ci?.status).toBe("COMPLIANT");

    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "REQUIREMENT_STATUS_UPDATED" },
    });
    expect(events).toHaveLength(1);
  });

  it("a second event updates the existing ComplianceItem (not a duplicate row)", async () => {
    const { user, practice, requirement } = await seedPracticeAndHipaaReq();

    const emit = (next: "COMPLIANT" | "GAP") =>
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "REQUIREMENT_STATUS_UPDATED",
          payload: {
            requirementId: requirement.id,
            frameworkCode: "HIPAA",
            requirementCode: "HIPAA_SRA",
            previousStatus: next === "COMPLIANT" ? "NOT_STARTED" : "COMPLIANT",
            nextStatus: next,
            source: "USER",
          },
        },
        async (tx) =>
          projectRequirementStatusUpdated(tx, {
            practiceId: practice.id,
            payload: {
              requirementId: requirement.id,
              frameworkCode: "HIPAA",
              requirementCode: "HIPAA_SRA",
              previousStatus: next === "COMPLIANT" ? "NOT_STARTED" : "COMPLIANT",
              nextStatus: next,
              source: "USER",
            },
          }),
      );

    await emit("COMPLIANT");
    await emit("GAP");

    const cis = await db.complianceItem.findMany({
      where: { practiceId: practice.id, requirementId: requirement.id },
    });
    expect(cis).toHaveLength(1);
    expect(cis[0]?.status).toBe("GAP");

    const events = await db.eventLog.findMany({
      where: { practiceId: practice.id, type: "REQUIREMENT_STATUS_UPDATED" },
    });
    expect(events).toHaveLength(2);
  });

  it("recomputes PracticeFramework.scoreCache after a COMPLIANT status (1/N requirements)", async () => {
    const { user, practice } = await seedPracticeAndHipaaReq();
    // HIPAA seed grows over time; assert dynamically against the actual count.
    const framework = await db.regulatoryFramework.findUniqueOrThrow({
      where: { code: "HIPAA" },
      include: { requirements: true },
    });
    if (framework.requirements.length < 10) {
      throw new Error(
        `HIPAA framework has only ${framework.requirements.length} requirements; run \`npm run db:seed:hipaa\` first.`,
      );
    }
    // Federal-only count (state-overlay rows have non-empty
    // jurisdictionFilter and don't apply to AZ practices).
    const federalReqs = framework.requirements.filter(
      (r) => r.jurisdictionFilter.length === 0,
    );
    const total = federalReqs.length;
    const expectedScore = Math.round((1 / total) * 100);
    const req = federalReqs[0]!;

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "REQUIREMENT_STATUS_UPDATED",
        payload: {
          requirementId: req.id,
          frameworkCode: "HIPAA",
          requirementCode: req.code,
          previousStatus: "NOT_STARTED",
          nextStatus: "COMPLIANT",
          source: "USER",
        },
      },
      async (tx) =>
        projectRequirementStatusUpdated(tx, {
          practiceId: practice.id,
          payload: {
            requirementId: req.id,
            frameworkCode: "HIPAA",
            requirementCode: req.code,
            previousStatus: "NOT_STARTED",
            nextStatus: "COMPLIANT",
            source: "USER",
          },
        }),
    );

    const pf = await db.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: framework.id,
        },
      },
    });
    expect(pf).not.toBeNull();
    expect(pf!.scoreCache).toBe(expectedScore);
    expect(pf!.scoreLabel).toBe("At Risk");
    expect(pf!.enabled).toBe(true);
    expect(pf!.lastScoredAt).toBeInstanceOf(Date);
  });

  it("scoreCache crosses the Needs Work threshold (≥50) after marking half compliant", async () => {
    const { user, practice } = await seedPracticeAndHipaaReq();
    const framework = await db.regulatoryFramework.findUniqueOrThrow({
      where: { code: "HIPAA" },
      include: { requirements: { orderBy: { sortOrder: "asc" } } },
    });
    if (framework.requirements.length < 10) {
      throw new Error(
        `HIPAA framework has only ${framework.requirements.length} requirements; run \`npm run db:seed:hipaa\` first.`,
      );
    }

    // Mark ceil(N/2) of the federal requirements compliant — guarantees
    // ≥50% regardless of seed growth. State overlays don't apply to AZ.
    const federalReqs = framework.requirements.filter(
      (r) => r.jurisdictionFilter.length === 0,
    );
    const total = federalReqs.length;
    const halfPlus = Math.ceil(total / 2);
    for (let i = 0; i < halfPlus; i++) {
      const req = federalReqs[i]!;
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "REQUIREMENT_STATUS_UPDATED",
          payload: {
            requirementId: req.id,
            frameworkCode: "HIPAA",
            requirementCode: req.code,
            previousStatus: "NOT_STARTED",
            nextStatus: "COMPLIANT",
            source: "USER",
          },
        },
        async (tx) =>
          projectRequirementStatusUpdated(tx, {
            practiceId: practice.id,
            payload: {
              requirementId: req.id,
              frameworkCode: "HIPAA",
              requirementCode: req.code,
              previousStatus: "NOT_STARTED",
              nextStatus: "COMPLIANT",
              source: "USER",
            },
          }),
      );
    }

    const pf = await db.practiceFramework.findUnique({
      where: {
        practiceId_frameworkId: {
          practiceId: practice.id,
          frameworkId: framework.id,
        },
      },
    });
    expect(pf).not.toBeNull();
    expect(pf!.scoreCache).toBeGreaterThanOrEqual(50);
    expect(pf!.scoreLabel).toBe("Needs Work");
  });

  it("rejects an unknown status value via Zod", async () => {
    const { user, practice, requirement } = await seedPracticeAndHipaaReq();
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "REQUIREMENT_STATUS_UPDATED",
          payload: {
            requirementId: requirement.id,
            frameworkCode: "HIPAA",
            requirementCode: "HIPAA_SRA",
            previousStatus: "NOT_STARTED",
            // @ts-expect-error intentionally invalid
            nextStatus: "WORKING_ON_IT",
            source: "USER",
          },
        },
        async () => {},
      ),
    ).rejects.toThrow();
  });
});
