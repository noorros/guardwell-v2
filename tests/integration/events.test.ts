import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply, replayPracticeEvents } from "@/lib/events";

async function seedPractice() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  return { user, practice };
}

describe("appendEventAndApply", () => {
  it("appends an event AND runs the projection in one transaction", async () => {
    const { user, practice } = await seedPractice();

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_CREATED",
        payload: {
          practiceName: practice.name,
          primaryState: practice.primaryState,
          ownerUserId: user.id,
        },
      },
      async (tx) => {
        await tx.practiceUser.create({
          data: {
            userId: user.id,
            practiceId: practice.id,
            role: "OWNER",
            isPrivacyOfficer: true,
            isComplianceOfficer: true,
          },
        });
      },
    );

    const events = await db.eventLog.findMany({ where: { practiceId: practice.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("PRACTICE_CREATED");

    const pus = await db.practiceUser.findMany({ where: { practiceId: practice.id } });
    expect(pus).toHaveLength(1);
    expect(pus[0]?.role).toBe("OWNER");
  });

  it("rejects payloads that fail Zod validation", async () => {
    const { user, practice } = await seedPractice();
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "PRACTICE_CREATED",
          payload: {
            practiceName: "",
            primaryState: "Arizona",
            ownerUserId: user.id,
          } as never,
        },
        async () => {},
      ),
    ).rejects.toThrow();
  });

  it("respects idempotencyKey", async () => {
    const { user, practice } = await seedPractice();
    const key = `idem-${Math.random()}`;

    let projectionRuns = 0;
    const project = async () => {
      projectionRuns += 1;
    };

    const a = await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_CREATED",
        payload: {
          practiceName: practice.name,
          primaryState: practice.primaryState,
          ownerUserId: user.id,
        },
        idempotencyKey: key,
      },
      project,
    );
    const b = await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_CREATED",
        payload: {
          practiceName: practice.name,
          primaryState: practice.primaryState,
          ownerUserId: user.id,
        },
        idempotencyKey: key,
      },
      project,
    );

    expect(a.id).toBe(b.id);
    expect(projectionRuns).toBe(1);
    const events = await db.eventLog.findMany({ where: { practiceId: practice.id } });
    expect(events).toHaveLength(1);
  });

  it("rolls back the event when the projection throws", async () => {
    const { user, practice } = await seedPractice();
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "PRACTICE_CREATED",
          payload: {
            practiceName: practice.name,
            primaryState: practice.primaryState,
            ownerUserId: user.id,
          },
        },
        async () => {
          throw new Error("simulated projection failure");
        },
      ),
    ).rejects.toThrow("simulated projection failure");

    const events = await db.eventLog.findMany({ where: { practiceId: practice.id } });
    expect(events).toHaveLength(0);
  });
});

describe("replayPracticeEvents", () => {
  it("replays in chronological order with parsed payloads", async () => {
    const { user, practice } = await seedPractice();

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "PRACTICE_CREATED",
        payload: {
          practiceName: practice.name,
          primaryState: practice.primaryState,
          ownerUserId: user.id,
        },
      },
      async () => {},
    );

    const seen: Array<{ type: string; payload: unknown }> = [];
    const result = await replayPracticeEvents(practice.id, (evt, payload) => {
      seen.push({ type: evt.type, payload });
    });

    expect(result.processed).toBe(1);
    expect(seen[0]?.type).toBe("PRACTICE_CREATED");
    expect((seen[0]?.payload as { practiceName: string }).practiceName).toBe(
      practice.name,
    );
  });
});
