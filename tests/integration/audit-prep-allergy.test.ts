// tests/integration/audit-prep-allergy.test.ts
//
// Integration coverage for the ALLERGY audit-prep packet (audit #21
// IM-3, PR-C4 of Wave 3, 2026-04-30). State pharmacy boards inspecting
// allergen-extract compounding (USP 797 §21) request:
//   - Compounder roster + qualification status across the last 3 years
//   - Anaphylaxis drill log with participants resolved
//   - Equipment maintenance (kit + fridge) with both surfaces
//   - Quiz attempts + scoring (privacy-respecting — no answer-key leak)
//   - USP §21 deviations + corrective actions
//
// These tests cover the protocol catalog, each evidence loader, the
// audit-#1 quiz-privacy invariant (PR #197), and the audit-#15 soft-delete
// behaviour (PR #213) for soft-deleted drills/equipment.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { PROTOCOLS_BY_MODE } from "@/lib/audit-prep/protocols";
import {
  loadAllergyCompounderQualification,
  loadAllergyDrillLog,
  loadAllergyEquipmentLog,
  loadAllergyQuizAttempts,
  loadAllergyDeviations,
} from "@/lib/audit-prep/evidence-loaders";

interface SeedRecord {
  user: { id: string };
  practice: { id: string };
  ownerPu: { id: string };
}

async function seedPracticeWithOwner(
  tag: string,
): Promise<SeedRecord> {
  const user = await db.user.create({
    data: {
      firebaseUid: `aprep-allergy-${tag}-${Math.random().toString(36).slice(2, 8)}`,
      email: `aprep-allergy-${tag}-${Math.random().toString(36).slice(2, 6)}@test.test`,
      firstName: "Audit",
      lastName: "Owner",
    },
  });
  const practice = await db.practice.create({
    data: {
      name: `Audit Prep Allergy ${tag}`,
      primaryState: "AZ",
      timezone: "America/Phoenix",
    },
  });
  const ownerPu = await db.practiceUser.create({
    data: {
      userId: user.id,
      practiceId: practice.id,
      role: "OWNER",
      requiresAllergyCompetency: true,
    },
  });
  return { user, practice, ownerPu };
}

async function addCompounder(
  practiceId: string,
  tag: string,
  opts: { firstName?: string; lastName?: string; removedAt?: Date | null } = {},
): Promise<{ practiceUserId: string; userId: string }> {
  const u = await db.user.create({
    data: {
      firebaseUid: `c-${tag}-${Math.random().toString(36).slice(2, 8)}`,
      email: `c-${tag}-${Math.random().toString(36).slice(2, 6)}@test.test`,
      firstName: opts.firstName ?? `Comp${tag}`,
      lastName: opts.lastName ?? "Tester",
    },
  });
  const pu = await db.practiceUser.create({
    data: {
      userId: u.id,
      practiceId,
      role: "STAFF",
      requiresAllergyCompetency: true,
      removedAt: opts.removedAt ?? null,
    },
  });
  return { practiceUserId: pu.id, userId: u.id };
}

describe("Audit Prep — ALLERGY mode", () => {
  it("getProtocolForFramework('ALLERGY') returns the 5 expected steps", () => {
    const protocols = PROTOCOLS_BY_MODE.ALLERGY;
    expect(protocols).toBeDefined();
    expect(protocols).toHaveLength(5);
    const codes = protocols!.map((p) => p.code);
    expect(codes).toEqual([
      "ALLERGY_COMPOUNDER_QUALIFICATION",
      "ALLERGY_DRILL_LOG",
      "ALLERGY_EQUIPMENT_LOG",
      "ALLERGY_QUIZ_ATTEMPTS",
      "ALLERGY_USP21_DEVIATIONS",
    ]);
    // Every protocol has a citation, description, and at least one
    // "what we attach" line.
    for (const p of protocols!) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.citation.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.whatWeAttach.length).toBeGreaterThanOrEqual(1);
      expect(p.evidenceLoaderCode).toBe(p.code);
    }
  });

  it("loadAllergyCompounderQualification covers the current year + 2 prior years", async () => {
    const { practice, ownerPu } = await seedPracticeWithOwner("3yr");
    const currentYear = new Date().getUTCFullYear();
    // Owner is also a compounder. Add 2 staff compounders.
    const c1 = await addCompounder(practice.id, "1");
    const c2 = await addCompounder(practice.id, "2");
    // 3 years of competencies for c1; 1 year (current) for c2; 2 years (older
    // two) for the owner.
    const competencyData = [
      { practiceUserId: c1.practiceUserId, year: currentYear, q: true },
      { practiceUserId: c1.practiceUserId, year: currentYear - 1, q: true },
      { practiceUserId: c1.practiceUserId, year: currentYear - 2, q: false },
      { practiceUserId: c2.practiceUserId, year: currentYear, q: true },
      { practiceUserId: ownerPu.id, year: currentYear - 1, q: true },
      { practiceUserId: ownerPu.id, year: currentYear - 2, q: false },
    ];
    for (const c of competencyData) {
      await db.allergyCompetency.create({
        data: {
          practiceId: practice.id,
          practiceUserId: c.practiceUserId,
          year: c.year,
          quizPassedAt: c.q ? new Date(c.year, 5, 1) : null,
          fingertipPassCount: c.q ? 3 : 0,
          fingertipLastPassedAt: c.q ? new Date(c.year, 5, 2) : null,
          mediaFillPassedAt: c.q ? new Date(c.year, 5, 3) : null,
          isFullyQualified: c.q,
        },
      });
    }
    const evidence = await db.$transaction(async (tx) =>
      loadAllergyCompounderQualification(tx, practice.id),
    );
    expect(evidence.yearWindow).toEqual([
      currentYear,
      currentYear - 1,
      currentYear - 2,
    ]);
    expect(evidence.activeCompounderCount).toBe(3); // owner + c1 + c2
    expect(evidence.formerCompounderInWindowCount).toBe(0);
    expect(evidence.rows.length).toBeGreaterThanOrEqual(3);

    const c1Row = evidence.rows.find((r) => r.practiceUserId === c1.practiceUserId);
    expect(c1Row).toBeDefined();
    // c1 has yearStatuses for ALL 3 years in the window, in window order.
    expect(c1Row!.yearStatuses).toHaveLength(3);
    expect(c1Row!.yearStatuses.map((y) => y.year)).toEqual([
      currentYear,
      currentYear - 1,
      currentYear - 2,
    ]);
    expect(c1Row!.yearStatuses[0]!.isFullyQualified).toBe(true);
    expect(c1Row!.yearStatuses[1]!.isFullyQualified).toBe(true);
    expect(c1Row!.yearStatuses[2]!.isFullyQualified).toBe(false);

    // c2 only has current-year data → prior years should report 0 / false.
    const c2Row = evidence.rows.find((r) => r.practiceUserId === c2.practiceUserId);
    expect(c2Row!.yearStatuses[0]!.isFullyQualified).toBe(true);
    expect(c2Row!.yearStatuses[1]!.isFullyQualified).toBe(false);
    expect(c2Row!.yearStatuses[1]!.fingertipPassCount).toBe(0);
  });

  it("loadAllergyDrillLog returns drills sorted newest-first with participant names resolved", async () => {
    const { practice, ownerPu } = await seedPracticeWithOwner("drillsort");
    const c1 = await addCompounder(practice.id, "drill1", { firstName: "Anna" });
    const c2 = await addCompounder(practice.id, "drill2", { firstName: "Bob" });
    // 3 drills with explicit out-of-order timestamps.
    const t1 = new Date("2026-01-15T10:00:00Z");
    const t2 = new Date("2026-03-20T10:00:00Z");
    const t3 = new Date("2026-02-10T10:00:00Z");
    const insertions = [
      { conductedAt: t1, scenario: "Oldest drill" },
      { conductedAt: t2, scenario: "Newest drill" },
      { conductedAt: t3, scenario: "Middle drill" },
    ];
    for (const i of insertions) {
      await db.allergyDrill.create({
        data: {
          practiceId: practice.id,
          conductedById: ownerPu.id,
          conductedAt: i.conductedAt,
          scenario: i.scenario,
          participantIds: [ownerPu.id, c1.practiceUserId, c2.practiceUserId],
          durationMinutes: 12,
        },
      });
    }
    const evidence = await db.$transaction(async (tx) =>
      loadAllergyDrillLog(tx, practice.id),
    );
    expect(evidence.rows).toHaveLength(3);
    // Newest first.
    expect(evidence.rows[0]!.scenario).toBe("Newest drill");
    expect(evidence.rows[1]!.scenario).toBe("Middle drill");
    expect(evidence.rows[2]!.scenario).toBe("Oldest drill");
    // Participants resolved with both names.
    expect(evidence.rows[0]!.participantDisplays).toHaveLength(3);
    expect(evidence.rows[0]!.participantDisplays.some((n) => n.includes("Anna"))).toBe(true);
    expect(evidence.rows[0]!.participantDisplays.some((n) => n.includes("Bob"))).toBe(true);
  });

  it("loadAllergyEquipmentLog surfaces both kit and fridge checks", async () => {
    const { practice, ownerPu } = await seedPracticeWithOwner("equip");
    // 2 kit checks + 2 fridge checks.
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "EMERGENCY_KIT",
        checkedAt: new Date("2026-04-01T10:00:00Z"),
        epiExpiryDate: new Date("2027-01-01"),
        epiLotNumber: "LOT-A",
        allItemsPresent: true,
      },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "EMERGENCY_KIT",
        checkedAt: new Date("2026-03-01T10:00:00Z"),
        epiExpiryDate: new Date("2027-01-01"),
        epiLotNumber: "LOT-A",
        allItemsPresent: true,
      },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "REFRIGERATOR_TEMP",
        checkedAt: new Date("2026-04-15T10:00:00Z"),
        temperatureC: 5.2,
        inRange: true,
      },
    });
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "REFRIGERATOR_TEMP",
        checkedAt: new Date("2026-03-15T10:00:00Z"),
        temperatureC: 9.1,
        inRange: false,
      },
    });
    // Soft-deleted kit check — must not appear (audit #15).
    await db.allergyEquipmentCheck.create({
      data: {
        practiceId: practice.id,
        checkedById: ownerPu.id,
        checkType: "EMERGENCY_KIT",
        checkedAt: new Date("2026-04-20T10:00:00Z"),
        epiLotNumber: "RETIRED",
        retiredAt: new Date(),
      },
    });
    const evidence = await db.$transaction(async (tx) =>
      loadAllergyEquipmentLog(tx, practice.id),
    );
    expect(evidence.kitRows).toHaveLength(2);
    expect(evidence.fridgeRows).toHaveLength(2);
    // Both surfaced — the explicit assertion the test calls out.
    expect(evidence.kitRows.length).toBeGreaterThan(0);
    expect(evidence.fridgeRows.length).toBeGreaterThan(0);
    // Newest-first ordering preserved.
    expect(new Date(evidence.kitRows[0]!.checkedAtIso).getTime()).toBeGreaterThan(
      new Date(evidence.kitRows[1]!.checkedAtIso).getTime(),
    );
    // Soft-deleted "RETIRED" lot does not surface.
    expect(
      evidence.kitRows.some((r) => r.epiLotNumber === "RETIRED"),
    ).toBe(false);
    // Fridge in-range mix preserved.
    expect(evidence.fridgeRows.some((r) => r.inRange === true)).toBe(true);
    expect(evidence.fridgeRows.some((r) => r.inRange === false)).toBe(true);
  });

  it("loadAllergyQuizAttempts respects the audit #1 privacy invariant", async () => {
    const { practice, ownerPu } = await seedPracticeWithOwner("quizpriv");
    // Seed a question (with an answer key).
    const question = await db.allergyQuizQuestion.create({
      data: {
        questionText: "What BUD applies to a multi-dose extract?",
        options: [
          { id: "a", text: "1 day" },
          { id: "b", text: "Per USP §21.4" },
        ],
        correctId: "b",
        explanation: "USP §21.4 lays out beyond-use date assignment rules.",
        category: "BEYOND_USE_DATES",
      },
    });
    // Seed an attempt + an answer that references the question.
    const attempt = await db.allergyQuizAttempt.create({
      data: {
        practiceId: practice.id,
        practiceUserId: ownerPu.id,
        year: new Date().getUTCFullYear(),
        completedAt: new Date(),
        score: 85,
        passed: true,
        totalQuestions: 1,
        correctAnswers: 1,
      },
    });
    await db.allergyQuizAnswer.create({
      data: {
        attemptId: attempt.id,
        questionId: question.id,
        selectedId: "b",
        isCorrect: true,
      },
    });
    const evidence = await db.$transaction(async (tx) =>
      loadAllergyQuizAttempts(tx, practice.id),
    );
    expect(evidence.attemptsLast24Months).toBe(1);
    expect(evidence.passedCount).toBe(1);
    expect(evidence.passRatePct).toBe(100);
    expect(evidence.averageScore).toBe(85);
    expect(evidence.rows).toHaveLength(1);
    const row = evidence.rows[0]!;
    expect(row.score).toBe(85);
    expect(row.passed).toBe(true);
    // The big invariant: the snapshot must NOT contain the answer key.
    const blob = JSON.stringify(evidence);
    expect(blob).not.toContain("correctId");
    expect(blob).not.toContain("explanation");
    expect(blob).not.toContain("USP §21.4 lays out");
    // It must also NOT contain per-question selectedId data — only
    // aggregate totalQuestions + correctAnswers scalars.
    expect(blob).not.toContain("selectedId");
  });

  it("removed compounder still appears in qualification history under former-staff label", async () => {
    const { practice } = await seedPracticeWithOwner("removed");
    const currentYear = new Date().getUTCFullYear();
    // Add an active compounder + a former (removed) compounder.
    const active = await addCompounder(practice.id, "active", {
      firstName: "Active",
      lastName: "Person",
    });
    const removed = await addCompounder(practice.id, "removed", {
      firstName: "Departed",
      lastName: "Person",
      removedAt: new Date(),
    });
    // Both have a competency for prior year (when "removed" was still
    // active). Only the active compounder has current year.
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: active.practiceUserId,
        year: currentYear,
        quizPassedAt: new Date(),
        fingertipPassCount: 3,
        mediaFillPassedAt: new Date(),
        isFullyQualified: true,
      },
    });
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: active.practiceUserId,
        year: currentYear - 1,
        quizPassedAt: new Date(),
        fingertipPassCount: 3,
        mediaFillPassedAt: new Date(),
        isFullyQualified: true,
      },
    });
    await db.allergyCompetency.create({
      data: {
        practiceId: practice.id,
        practiceUserId: removed.practiceUserId,
        year: currentYear - 1,
        quizPassedAt: new Date(),
        fingertipPassCount: 3,
        mediaFillPassedAt: new Date(),
        isFullyQualified: true,
      },
    });
    const evidence = await db.$transaction(async (tx) =>
      loadAllergyCompounderQualification(tx, practice.id),
    );
    // "removed" compounder appears with a (removed) suffix.
    const removedRow = evidence.rows.find(
      (r) => r.practiceUserId === removed.practiceUserId,
    );
    expect(removedRow).toBeDefined();
    expect(removedRow!.isFormerStaff).toBe(true);
    expect(removedRow!.displayName).toContain("Departed");
    expect(removedRow!.displayName).toContain("(removed)");
    // Their prior-year qualification still surfaces.
    const priorYear = removedRow!.yearStatuses.find(
      (y) => y.year === currentYear - 1,
    );
    expect(priorYear?.isFullyQualified).toBe(true);
    // formerCompounderInWindowCount counts them.
    expect(evidence.formerCompounderInWindowCount).toBe(1);
    // Active staff are listed before former staff (sort guarantee).
    const firstFormerIdx = evidence.rows.findIndex((r) => r.isFormerStaff);
    const lastActiveIdx = [...evidence.rows]
      .map((r, i) => ({ r, i }))
      .filter((x) => !x.r.isFormerStaff)
      .map((x) => x.i)
      .pop();
    expect(lastActiveIdx).not.toBeUndefined();
    expect(firstFormerIdx).toBeGreaterThan(lastActiveIdx!);
  });

  it("loadAllergyDeviations matches USP §21 / compounding / allergen incidents and counts drills with corrective actions", async () => {
    const { user, practice, ownerPu } = await seedPracticeWithOwner("dev");
    // Tagged: title contains "USP".
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "USP §21 — BUD overage observed",
        description: "Lot mixed past beyond-use date.",
        type: "PRIVACY",
        severity: "MEDIUM",
        status: "OPEN",
        discoveredAt: new Date(),
      },
    });
    // Tagged: description contains "allergen".
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Documentation gap",
        description: "Allergen extract dilution missed signature.",
        type: "PRIVACY",
        severity: "LOW",
        status: "RESOLVED",
        discoveredAt: new Date(),
        resolvedAt: new Date(),
      },
    });
    // NOT tagged: unrelated incident.
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Stolen laptop",
        description: "Workstation reported missing.",
        type: "SECURITY",
        severity: "HIGH",
        status: "OPEN",
        discoveredAt: new Date(),
      },
    });
    // Drill with corrective actions (counts).
    await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: ownerPu.id,
        conductedAt: new Date(),
        scenario: "Patient anaphylaxis 2 minutes after injection",
        participantIds: [ownerPu.id],
        correctiveActions: "Restock epi pen on north shelf",
      },
    });
    // Drill without corrective actions (does NOT count).
    await db.allergyDrill.create({
      data: {
        practiceId: practice.id,
        conductedById: ownerPu.id,
        conductedAt: new Date(),
        scenario: "Patient anaphylaxis after extract test",
        participantIds: [ownerPu.id],
        correctiveActions: null,
      },
    });
    const evidence = await db.$transaction(async (tx) =>
      loadAllergyDeviations(tx, practice.id),
    );
    expect(evidence.taggedIncidentsLast24Months).toBe(2);
    expect(evidence.openIncidents).toBe(1);
    expect(evidence.resolvedIncidents).toBe(1);
    expect(evidence.drillsWithCorrectiveActionsLast24Months).toBe(1);
    expect(evidence.mostRecentTaggedIncidentIso).not.toBeNull();
  });
});
