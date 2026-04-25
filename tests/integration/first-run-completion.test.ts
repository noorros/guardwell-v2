// tests/integration/first-run-completion.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectFirstRunCompleted } from "@/lib/events/projections/firstRunCompleted";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `fr-owner-${Math.random().toString(36).slice(2, 10)}`,
      email: `fr-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "First Run Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  return { owner, practice };
}

describe("First-run completion", () => {
  it("ONBOARDING_FIRST_RUN_COMPLETED sets Practice.firstRunCompletedAt", async () => {
    const { owner, practice } = await seed();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ONBOARDING_FIRST_RUN_COMPLETED",
        payload: {
          completedByUserId: owner.id,
          stepsCompleted: ["OFFICERS", "POLICY", "TRAINING", "INVITE"],
          durationSeconds: 900,
        },
      },
      async (tx) =>
        projectFirstRunCompleted(tx, {
          practiceId: practice.id,
          payload: {
            completedByUserId: owner.id,
            stepsCompleted: ["OFFICERS", "POLICY", "TRAINING", "INVITE"],
            durationSeconds: 900,
          },
        }),
    );
    const after = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
      select: { firstRunCompletedAt: true },
    });
    expect(after.firstRunCompletedAt).toBeInstanceOf(Date);
  });

  it("is idempotent — repeat writes leave the earliest timestamp", async () => {
    const { owner, practice } = await seed();
    const payload = {
      completedByUserId: owner.id,
      stepsCompleted: ["OFFICERS", "POLICY", "TRAINING", "INVITE"],
      durationSeconds: 900,
    };
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: owner.id, type: "ONBOARDING_FIRST_RUN_COMPLETED", payload },
      async (tx) => projectFirstRunCompleted(tx, { practiceId: practice.id, payload }),
    );
    const first = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
      select: { firstRunCompletedAt: true },
    });
    await new Promise((r) => setTimeout(r, 20));
    await appendEventAndApply(
      { practiceId: practice.id, actorUserId: owner.id, type: "ONBOARDING_FIRST_RUN_COMPLETED", payload },
      async (tx) => projectFirstRunCompleted(tx, { practiceId: practice.id, payload }),
    );
    const second = await db.practice.findUniqueOrThrow({
      where: { id: practice.id },
      select: { firstRunCompletedAt: true },
    });
    expect(second.firstRunCompletedAt?.getTime()).toBe(
      first.firstRunCompletedAt?.getTime(),
    );
  });
});
