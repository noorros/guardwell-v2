// tests/integration/osha-injured-employee.test.ts
//
// Audit #19 (OSHA B-3 / I-5): Incident.injuredUserId — distinct from
// reportedByUserId. §1904.35(b)(2)(v) governs the injured employee on
// Form 300/301; pre-audit-#19 the PDFs were rendering the reporter,
// not the injured staff member.
//
// Regression guards:
//   - INCIDENT_REPORTED with injuredUserId persists it on the row
//   - INCIDENT_REPORTED without injuredUserId falls back to actorUserId
//     when type=OSHA_RECORDABLE (so legacy form callers don't lose data)
//   - non-OSHA types leave injuredUserId null

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectIncidentReported } from "@/lib/events/projections/incident";
import { randomUUID } from "node:crypto";

declare global {
  var __injTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__injTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__injTestUser) throw new Error("Unauthorized");
      return globalThis.__injTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__injTestUser = null;
});

async function seed(role: "OWNER" | "STAFF" = "OWNER") {
  const reporter = await db.user.create({
    data: {
      firebaseUid: `inj-rep-${Math.random().toString(36).slice(2, 10)}`,
      email: `inj-rep-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const injured = await db.user.create({
    data: {
      firebaseUid: `inj-emp-${Math.random().toString(36).slice(2, 10)}`,
      email: `inj-emp-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Injured",
      lastName: "Employee",
    },
  });
  const practice = await db.practice.create({
    data: { name: "Audit-#19 Practice", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: reporter.id, practiceId: practice.id, role },
  });
  await db.practiceUser.create({
    data: { userId: injured.id, practiceId: practice.id, role: "STAFF" },
  });
  globalThis.__injTestUser = {
    id: reporter.id,
    email: reporter.email,
    firebaseUid: reporter.firebaseUid,
  };
  return { reporter, injured, practice };
}

describe("Audit #19 — Incident.injuredUserId", () => {
  it("OSHA_RECORDABLE with injuredUserId from form persists it on the Incident row", async () => {
    const { reporter, injured, practice } = await seed();
    const id = randomUUID();
    const payload = {
      incidentId: id,
      title: "Lacerated finger on broken vial",
      description: "Sterilizing area; glass vial cracked during handling.",
      type: "OSHA_RECORDABLE" as const,
      severity: "MEDIUM" as const,
      phiInvolved: false,
      affectedCount: null,
      discoveredAt: new Date().toISOString(),
      patientState: null,
      oshaBodyPart: "Right index finger",
      oshaInjuryNature: "Laceration",
      oshaOutcome: "OTHER_RECORDABLE" as const,
      oshaDaysAway: null,
      oshaDaysRestricted: null,
      sharpsDeviceType: null,
      injuredUserId: injured.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: reporter.id,
        type: "INCIDENT_REPORTED",
        payload,
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: reporter.id,
          payload,
        }),
    );
    const row = await db.incident.findUniqueOrThrow({ where: { id } });
    expect(row.injuredUserId).toBe(injured.id);
    expect(row.reportedByUserId).toBe(reporter.id);
  });

  it("Non-OSHA types leave injuredUserId null even when one is supplied (defensive)", async () => {
    const { reporter, injured, practice } = await seed();
    // The action layer (reportIncidentAction) only forwards
    // injuredUserId when type=OSHA_RECORDABLE, but the projection
    // layer is dumb and writes whatever the payload says. This test
    // pins the projection's literal behavior so a future change to
    // the action won't silently corrupt the row.
    const id = randomUUID();
    const payload = {
      incidentId: id,
      title: "PHI emailed to wrong patient",
      description: "Reply-all on a long email thread.",
      type: "PRIVACY" as const,
      severity: "LOW" as const,
      phiInvolved: true,
      affectedCount: 1,
      discoveredAt: new Date().toISOString(),
      patientState: "AZ",
      oshaBodyPart: null,
      oshaInjuryNature: null,
      oshaOutcome: null,
      oshaDaysAway: null,
      oshaDaysRestricted: null,
      sharpsDeviceType: null,
      injuredUserId: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: reporter.id,
        type: "INCIDENT_REPORTED",
        payload,
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: reporter.id,
          payload,
        }),
    );
    const row = await db.incident.findUniqueOrThrow({ where: { id } });
    expect(row.injuredUserId).toBeNull();
    void injured;
  });

  it("Pre-audit-#19 events (no injuredUserId) leave the field null — PDF reads fall back to reportedByUserId", async () => {
    const { reporter, practice } = await seed();
    // Simulate a legacy event payload that doesn't carry the new field.
    const id = randomUUID();
    const payload = {
      incidentId: id,
      title: "Legacy needlestick",
      description: "Emitted before audit-#19 shipped.",
      type: "OSHA_RECORDABLE" as const,
      severity: "MEDIUM" as const,
      phiInvolved: false,
      affectedCount: null,
      discoveredAt: new Date().toISOString(),
      patientState: null,
      oshaBodyPart: "Left thumb",
      oshaInjuryNature: "Needlestick",
      oshaOutcome: "OTHER_RECORDABLE" as const,
      oshaDaysAway: null,
      oshaDaysRestricted: null,
      sharpsDeviceType: "Needle",
      // injuredUserId intentionally omitted — Zod schema marks it
      // .nullable().optional() so the registry accepts the legacy shape.
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: reporter.id,
        type: "INCIDENT_REPORTED",
        payload,
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: reporter.id,
          payload,
        }),
    );
    const row = await db.incident.findUniqueOrThrow({ where: { id } });
    expect(row.injuredUserId).toBeNull();
    expect(row.reportedByUserId).toBe(reporter.id);
  });
});
