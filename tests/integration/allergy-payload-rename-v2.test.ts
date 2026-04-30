// tests/integration/allergy-payload-rename-v2.test.ts
//
// Audit #21 / Allergy MIN-7 (2026-04-30): the ALLERGY_FINGERTIP_TEST_PASSED
// and ALLERGY_MEDIA_FILL_PASSED event payloads renamed `attestedByUserId`
// to `attestedByPracticeUserId` (the value has always been a PracticeUser.id;
// the v1 name suggested User.id and was misleading). v2 is the new
// canonical shape; v1 retained verbatim so historical EventLog rows
// replay cleanly.
//
// These tests confirm both directions:
//   - v1 events still write to fingertipAttestedById / mediaFillAttestedById
//   - v2 events write the same column from the renamed payload field

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectAllergyFingertipTestPassed,
  projectAllergyMediaFillPassed,
} from "@/lib/events/projections/allergyCompetency";

async function seed() {
  const owner = await db.user.create({
    data: {
      firebaseUid: `min7-${Math.random().toString(36).slice(2, 10)}`,
      email: `min7-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const compounder = await db.user.create({
    data: {
      firebaseUid: `min7c-${Math.random().toString(36).slice(2, 10)}`,
      email: `min7c-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "MIN-7 Practice", primaryState: "AZ" },
  });
  const ownerPu = await db.practiceUser.create({
    data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
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

describe("Audit #21 / Allergy MIN-7 — payload rename to v2", () => {
  it("accepts a v1 ALLERGY_FINGERTIP_TEST_PASSED with `attestedByUserId`", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const payload = {
      practiceUserId: compounderPu.id,
      year,
      attestedByUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_FINGERTIP_TEST_PASSED",
        // Default schemaVersion = 1 — historical event shape.
        payload,
      },
      async (tx) =>
        projectAllergyFingertipTestPassed(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const comp = await db.allergyCompetency.findFirstOrThrow({
      where: { practiceUserId: compounderPu.id, year },
    });
    expect(comp.fingertipPassCount).toBe(1);
    expect(comp.fingertipAttestedById).toBe(ownerPu.id);
  });

  it("accepts a v2 ALLERGY_FINGERTIP_TEST_PASSED with `attestedByPracticeUserId`", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const payload = {
      practiceUserId: compounderPu.id,
      year,
      attestedByPracticeUserId: ownerPu.id,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_FINGERTIP_TEST_PASSED",
        schemaVersion: 2,
        payload,
      },
      async (tx) =>
        projectAllergyFingertipTestPassed(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const comp = await db.allergyCompetency.findFirstOrThrow({
      where: { practiceUserId: compounderPu.id, year },
    });
    expect(comp.fingertipPassCount).toBe(1);
    // v2 payload's renamed field lands in the same column.
    expect(comp.fingertipAttestedById).toBe(ownerPu.id);
  });

  it("v2 ALLERGY_MEDIA_FILL_PASSED writes attestor to mediaFillAttestedById", async () => {
    const { owner, ownerPu, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    const payload = {
      practiceUserId: compounderPu.id,
      year,
      attestedByPracticeUserId: ownerPu.id,
      notes: "first media fill",
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.id,
        type: "ALLERGY_MEDIA_FILL_PASSED",
        schemaVersion: 2,
        payload,
      },
      async (tx) =>
        projectAllergyMediaFillPassed(tx, {
          practiceId: practice.id,
          payload,
        }),
    );
    const comp = await db.allergyCompetency.findFirstOrThrow({
      where: { practiceUserId: compounderPu.id, year },
    });
    expect(comp.mediaFillPassedAt).not.toBeNull();
    expect(comp.mediaFillAttestedById).toBe(ownerPu.id);
    expect(comp.mediaFillNotes).toBe("first media fill");
  });

  it("rejects a v2 payload missing `attestedByPracticeUserId`", async () => {
    const { owner, compounderPu, practice } = await seed();
    const year = new Date().getFullYear();
    // Old (v1) field name on the v2 schema → registry parser refuses.
    const payload = {
      practiceUserId: compounderPu.id,
      year,
      attestedByUserId: "should-have-been-renamed",
      notes: null,
    } as unknown as {
      practiceUserId: string;
      year: number;
      attestedByPracticeUserId: string;
      notes: null;
    };
    await expect(
      appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: owner.id,
          type: "ALLERGY_FINGERTIP_TEST_PASSED",
          schemaVersion: 2,
          payload,
        },
        async () => {},
      ),
    ).rejects.toThrow();
  });
});
