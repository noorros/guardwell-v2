// tests/integration/allergy-drill.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectAllergyDrillLogged } from "@/lib/events/projections/allergyDrill";
import { randomUUID } from "node:crypto";

describe("Allergy drill projection", () => {
  it("inserts a drill row with participants", async () => {
    const owner = await db.user.create({
      data: {
        firebaseUid: `dr-${Math.random().toString(36).slice(2, 10)}`,
        email: `d-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const practice = await db.practice.create({
      data: { name: "Drill Test", primaryState: "AZ" },
    });
    const ownerPu = await db.practiceUser.create({
      data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
    });
    const drillId = randomUUID();
    const payload = {
      drillId,
      conductedByUserId: ownerPu.id,
      conductedAt: new Date().toISOString(),
      scenario: "Patient develops anaphylaxis 5 minutes after injection",
      participantIds: [ownerPu.id],
      durationMinutes: 12,
      observations: "All staff knew where the kit was",
      correctiveActions: null,
      nextDrillDue: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_DRILL_LOGGED",
        payload,
      },
      async (tx) =>
        projectAllergyDrillLogged(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const row = await db.allergyDrill.findUniqueOrThrow({
      where: { id: drillId },
    });
    expect(row.scenario).toContain("anaphylaxis");
    expect(row.participantIds).toHaveLength(1);
  });
});
