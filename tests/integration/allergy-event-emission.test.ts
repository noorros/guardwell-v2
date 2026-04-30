// tests/integration/allergy-event-emission.test.ts
//
// Audit item #9 (2026-04-29) — logCompoundingActivityAction +
// toggleStaffAllergyRequirementAction previously mutated AllergyCompetency
// / PracticeUser directly without emitting any EventLog row. The USP §21
// inactivity rule's evidence chain was silent.
//
// These tests exercise the new projections (the actions can't be called
// directly from integration tests because they hit requireUser/getPracticeUser
// — but the projection is the substantive correctness guarantee, and we
// also assert that ESLint blocks any new direct-mutation regressions).

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectAllergyCompoundingLogged,
  projectAllergyRequirementToggled,
} from "@/lib/events/projections/allergyCompetency";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `allergy-${Math.random().toString(36).slice(2, 10)}`,
      email: `a-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Allergy Audit #9 Clinic", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
  });
  const compounder = await db.user.create({
    data: {
      firebaseUid: `compounder-${Math.random().toString(36).slice(2, 10)}`,
      email: `c-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const compounderPu = await db.practiceUser.create({
    data: {
      userId: compounder.id,
      practiceId: practice.id,
      role: "STAFF",
      requiresAllergyCompetency: true,
    },
  });
  return { owner, ownerPu, compounder, compounderPu, practice };
}

describe("Allergy audit-defense event emission (audit #9)", () => {
  it("ALLERGY_COMPOUNDING_LOGGED writes lastCompoundedAt + emits an EventLog row", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const loggedAt = new Date().toISOString();
    const payload = {
      practiceUserId: compounderPu.id,
      year,
      loggedByPracticeUserId: ownerPu.id,
      loggedAt,
    };

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_COMPOUNDING_LOGGED",
        payload,
      },
      async (tx) =>
        projectAllergyCompoundingLogged(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const comp = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year },
      },
    });
    expect(comp.lastCompoundedAt).not.toBeNull();
    expect(comp.lastCompoundedAt?.toISOString()).toBe(loggedAt);

    const events = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "ALLERGY_COMPOUNDING_LOGGED",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.actorUserId).toBe(owner.id);
  });

  it("ALLERGY_REQUIREMENT_TOGGLED flips requiresAllergyCompetency + emits EventLog", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const payload = {
      practiceUserId: compounderPu.id,
      required: false,
      previousValue: true,
      toggledByPracticeUserId: ownerPu.id,
    };

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_REQUIREMENT_TOGGLED",
        payload,
      },
      async (tx) =>
        projectAllergyRequirementToggled(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const after = await db.practiceUser.findUniqueOrThrow({
      where: { id: compounderPu.id },
    });
    expect(after.requiresAllergyCompetency).toBe(false);

    const events = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "ALLERGY_REQUIREMENT_TOGGLED",
      },
    });
    expect(events).toHaveLength(1);
    const evt = events[0]!;
    expect(evt.actorUserId).toBe(owner.id);
    // Audit-defense: the previousValue is captured in the payload so
    // replay is unambiguous.
    const recordedPayload = evt.payload as typeof payload;
    expect(recordedPayload.previousValue).toBe(true);
    expect(recordedPayload.required).toBe(false);
  });

  it("compounding-logged projection clears the 6-month inactivity flag", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();

    // Pre-seed a fully qualified competency that is currently flagged
    // inactive (lastCompoundedAt 7 months ago).
    const sevenMonthsAgo = new Date(Date.now() - 213 * 24 * 60 * 60 * 1000);
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: compounderPu.id,
        year,
        quizPassedAt: new Date(),
        fingertipPassCount: 3,
        fingertipLastPassedAt: new Date(),
        mediaFillPassedAt: new Date(),
        lastCompoundedAt: sevenMonthsAgo,
        isFullyQualified: false,
      },
    });

    const payload = {
      practiceUserId: compounderPu.id,
      year,
      loggedByPracticeUserId: ownerPu.id,
      loggedAt: new Date().toISOString(),
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_COMPOUNDING_LOGGED",
        payload,
      },
      async (tx) =>
        projectAllergyCompoundingLogged(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const comp = await db.allergyCompetency.findUniqueOrThrow({
      where: {
        practiceUserId_year: { practiceUserId: compounderPu.id, year },
      },
    });
    // recomputeIsFullyQualified should have flipped this back to true
    // because lastCompoundedAt is now fresh AND all other components
    // are satisfied.
    expect(comp.isFullyQualified).toBe(true);
  });
});
