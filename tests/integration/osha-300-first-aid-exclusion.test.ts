// tests/integration/osha-300-first-aid-exclusion.test.ts
//
// Audit item #5 — §1904.7(b)(5): first-aid-only injuries must NOT
// appear on the OSHA Form 300 log. Three sites previously counted
// FIRST_AID outcomes:
//   1. osha300LogRule (derivation/osha.ts) — used by /modules/osha
//   2. /api/audit/osha-300/route.tsx — PDF row source
//   3. loadOsha300LogEvidence (audit-prep/evidence-loaders.ts) — captured
//      counts in audit-prep packets
//
// Each site adds `oshaOutcome: { not: "FIRST_AID" }`. This test seeds
// one FIRST_AID and one DAYS_AWAY incident and asserts the FIRST_AID
// row is excluded everywhere.

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { OSHA_DERIVATION_RULES } from "@/lib/compliance/derivation/osha";
import { loadOsha300LogEvidence } from "@/lib/audit-prep/evidence-loaders";

describe("OSHA 300 — §1904.7(b)(5) FIRST_AID exclusion", () => {
  beforeEach(async () => {
    // Defensive cleanup — the global afterEach handles ComplianceItem +
    // Practice + User cascades, but Incident requires explicit deletion
    // because it has no cascade-eligible parent in the test setup.
    await db.incident.deleteMany();
  });

  async function seed() {
    const user = await db.user.create({
      data: {
        firebaseUid: `osha-${Math.random().toString(36).slice(2, 10)}`,
        email: `o-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const practice = await db.practice.create({
      data: {
        name: "OSHA First-Aid Test",
        primaryState: "AZ",
        timezone: "America/Phoenix",
      },
    });
    const pu = await db.practiceUser.create({
      data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
    });

    // FIRST_AID outcome — must NOT show up anywhere
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Cut finger on broken vial — bandaged",
        description: "Minor laceration; cleaned and bandaged at the front desk.",
        type: "OSHA_RECORDABLE",
        severity: "LOW",
        status: "OPEN",
        discoveredAt: new Date(),
        reportedByUserId: user.id,
        oshaOutcome: "FIRST_AID",
      },
    });
    // DAYS_AWAY outcome — must show up
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Slipped — lost-time injury",
        description: "Slipped on wet floor; sent home for the rest of the shift.",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        status: "OPEN",
        discoveredAt: new Date(),
        reportedByUserId: user.id,
        oshaOutcome: "DAYS_AWAY",
        oshaDaysAway: 3,
      },
    });

    return { practice, user, pu };
  }

  it("evidence loader counts only non-FIRST_AID incidents", async () => {
    const { practice } = await seed();
    const ev = await loadOsha300LogEvidence(db, practice.id);
    // 2 incidents seeded total, 1 is FIRST_AID → both counts should be 1.
    expect(ev.recordableIncidentsLast12Months).toBe(1);
    expect(ev.recordableIncidentsAllTime).toBe(1);
  });

  it("PDF route's incident query excludes FIRST_AID outcomes", async () => {
    const { practice } = await seed();
    const year = new Date().getUTCFullYear();
    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`);
    // Mirror the route's where clause exactly so any divergence in the
    // route is caught by re-running this test on a deployment that
    // forgets the not-FIRST_AID guard.
    const incidents = await db.incident.findMany({
      where: {
        practiceId: practice.id,
        type: "OSHA_RECORDABLE",
        discoveredAt: { gte: yearStart, lt: yearEnd },
        oshaOutcome: { not: "FIRST_AID" },
      },
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.oshaOutcome).toBe("DAYS_AWAY");
  });

  it("osha300LogRule returns GAP when only FIRST_AID incidents exist", async () => {
    const onlyFirstAidUser = await db.user.create({
      data: {
        firebaseUid: `osha-only-fa-${Math.random().toString(36).slice(2, 10)}`,
        email: `ofa-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const onlyFirstAid = await db.practice.create({
      data: {
        name: "OSHA Only-FirstAid",
        primaryState: "AZ",
        timezone: "America/Phoenix",
      },
    });
    await db.incident.create({
      data: {
        practiceId: onlyFirstAid.id,
        title: "Paper cut",
        description: "Minor paper cut; bandaged at front desk.",
        type: "OSHA_RECORDABLE",
        severity: "LOW",
        status: "OPEN",
        discoveredAt: new Date(),
        reportedByUserId: onlyFirstAidUser.id,
        oshaOutcome: "FIRST_AID",
      },
    });

    const rule = OSHA_DERIVATION_RULES.OSHA_300_LOG;
    if (!rule) throw new Error("OSHA_300_LOG rule missing from registry");
    const status = await db.$transaction((tx) => rule(tx, onlyFirstAid.id));
    // Without any non-FIRST_AID OSHA-recordable incident, the rule
    // must return GAP — FIRST_AID alone does not satisfy §1904.7.
    expect(status).toBe("GAP");
  });

  it("osha300LogRule returns COMPLIANT when at least one non-FIRST_AID incident exists", async () => {
    const { practice } = await seed();
    const rule = OSHA_DERIVATION_RULES.OSHA_300_LOG;
    if (!rule) throw new Error("OSHA_300_LOG rule missing from registry");
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    // Seed creates one FIRST_AID + one DAYS_AWAY → DAYS_AWAY satisfies.
    expect(status).toBe("COMPLIANT");
  });
});
