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
