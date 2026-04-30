// tests/integration/critical-osha-alert.test.ts
//
// Audit #21 (OSHA I-4): §1904.39 8-hour fatality alert. Covers:
//   1. reportIncidentAction with oshaOutcome=DEATH triggers the helper
//      and appends an INCIDENT_OSHA_FATALITY_REPORTED event.
//   2. Non-DEATH outcomes (DAYS_AWAY) DO NOT trigger.
//   3. Helper is idempotent — repeat calls for the same incidentId
//      append exactly one event.
//   4. Notification recipient list is restricted to OWNER + ADMIN
//      (STAFF / VIEWER receive nothing in-app or via email).
//   5. updateIncidentOshaOutcomeAction upgrading DAYS_AWAY → DEATH
//      fires the alert (covers the "post-intake correction" path).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { triggerCriticalOshaAlert } from "@/lib/notifications/critical-osha-alert";

declare global {
  var __criticalOshaTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__criticalOshaTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__criticalOshaTestUser) {
        throw new Error("Unauthorized");
      }
      return globalThis.__criticalOshaTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__criticalOshaTestUser = null;
});

async function seedPracticeWithMembers() {
  // Reporter who will sign in (gets OWNER role).
  const owner = await db.user.create({
    data: {
      firebaseUid: `coa-own-${Math.random().toString(36).slice(2, 10)}`,
      email: `coa-own-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const admin = await db.user.create({
    data: {
      firebaseUid: `coa-adm-${Math.random().toString(36).slice(2, 10)}`,
      email: `coa-adm-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const staff = await db.user.create({
    data: {
      firebaseUid: `coa-stf-${Math.random().toString(36).slice(2, 10)}`,
      email: `coa-stf-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const viewer = await db.user.create({
    data: {
      firebaseUid: `coa-vwr-${Math.random().toString(36).slice(2, 10)}`,
      email: `coa-vwr-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Critical OSHA Alert Test", primaryState: "AZ" },
  });
  await db.practiceUser.createMany({
    data: [
      { userId: owner.id, practiceId: practice.id, role: "OWNER" },
      { userId: admin.id, practiceId: practice.id, role: "ADMIN" },
      { userId: staff.id, practiceId: practice.id, role: "STAFF" },
      { userId: viewer.id, practiceId: practice.id, role: "VIEWER" },
    ],
  });
  globalThis.__criticalOshaTestUser = {
    id: owner.id,
    email: owner.email,
    firebaseUid: owner.firebaseUid,
  };
  return { owner, admin, staff, viewer, practice };
}

describe("triggerCriticalOshaAlert (helper unit)", () => {
  it("appends an INCIDENT_OSHA_FATALITY_REPORTED event with the §1904.39 8-hour deadline", async () => {
    const { owner, practice } = await seedPracticeWithMembers();
    const occurredAt = new Date("2026-04-30T10:00:00Z");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: owner.id,
        title: "Fatal injury",
        description: "Employee fatality on shop floor",
        type: "OSHA_RECORDABLE",
        severity: "CRITICAL",
        phiInvolved: false,
        discoveredAt: occurredAt,
        oshaOutcome: "DEATH",
      },
    });
    const result = await triggerCriticalOshaAlert({
      practiceId: practice.id,
      incidentId: incident.id,
      oshaOutcome: "DEATH",
      occurredAt,
      incidentTitle: incident.title,
      actorUserId: owner.id,
    });
    expect(result.fired).toBe(true);

    const events = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "INCIDENT_OSHA_FATALITY_REPORTED",
      },
    });
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as {
      incidentId: string;
      oshaOutcome: string;
      occurredAt: string;
      deadlineAt: string;
    };
    expect(payload.incidentId).toBe(incident.id);
    expect(payload.oshaOutcome).toBe("DEATH");
    // Deadline = occurredAt + 8h.
    expect(new Date(payload.deadlineAt).getTime()).toBe(
      occurredAt.getTime() + 8 * 60 * 60 * 1000,
    );
  });

  it("is idempotent — repeat calls leave exactly one event row", async () => {
    const { owner, practice } = await seedPracticeWithMembers();
    const occurredAt = new Date("2026-04-30T10:00:00Z");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: owner.id,
        title: "Fatal injury",
        description: "Test",
        type: "OSHA_RECORDABLE",
        severity: "CRITICAL",
        phiInvolved: false,
        discoveredAt: occurredAt,
        oshaOutcome: "DEATH",
      },
    });
    const first = await triggerCriticalOshaAlert({
      practiceId: practice.id,
      incidentId: incident.id,
      oshaOutcome: "DEATH",
      occurredAt,
      actorUserId: owner.id,
    });
    const second = await triggerCriticalOshaAlert({
      practiceId: practice.id,
      incidentId: incident.id,
      oshaOutcome: "DEATH",
      occurredAt,
      actorUserId: owner.id,
    });
    expect(first.fired).toBe(true);
    expect(second.fired).toBe(false);
    const events = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "INCIDENT_OSHA_FATALITY_REPORTED",
      },
    });
    expect(events).toHaveLength(1);
  });

  it("delivers in-app notifications to OWNER + ADMIN only — STAFF / VIEWER receive nothing", async () => {
    const { owner, admin, staff, viewer, practice } =
      await seedPracticeWithMembers();
    const occurredAt = new Date("2026-04-30T10:00:00Z");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: owner.id,
        title: "Fatal injury",
        description: "Test",
        type: "OSHA_RECORDABLE",
        severity: "CRITICAL",
        phiInvolved: false,
        discoveredAt: occurredAt,
        oshaOutcome: "DEATH",
      },
    });
    const result = await triggerCriticalOshaAlert({
      practiceId: practice.id,
      incidentId: incident.id,
      oshaOutcome: "DEATH",
      occurredAt,
      actorUserId: owner.id,
    });
    // 2 admins (OWNER + ADMIN) get notifications. STAFF + VIEWER excluded.
    expect(result.notified).toBe(2);

    const ownerNotes = await db.notification.findMany({
      where: { userId: owner.id, type: "INCIDENT_OPEN" },
    });
    const adminNotes = await db.notification.findMany({
      where: { userId: admin.id, type: "INCIDENT_OPEN" },
    });
    const staffNotes = await db.notification.findMany({
      where: { userId: staff.id, type: "INCIDENT_OPEN" },
    });
    const viewerNotes = await db.notification.findMany({
      where: { userId: viewer.id, type: "INCIDENT_OPEN" },
    });
    expect(ownerNotes).toHaveLength(1);
    expect(adminNotes).toHaveLength(1);
    expect(staffNotes).toHaveLength(0);
    expect(viewerNotes).toHaveLength(0);
    expect(ownerNotes[0]!.severity).toBe("CRITICAL");
    expect(ownerNotes[0]!.title).toContain("OSHA fatality");
    expect(ownerNotes[0]!.title).toContain("8 hours");
  });
});

describe("reportIncidentAction → fatality alert wiring", () => {
  it("triggers the alert when oshaOutcome=DEATH on initial report", async () => {
    const { practice } = await seedPracticeWithMembers();
    const { reportIncidentAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    const result = await reportIncidentAction({
      title: "Fatal incident",
      description: "Employee fatality during equipment repair",
      type: "OSHA_RECORDABLE",
      severity: "CRITICAL",
      phiInvolved: false,
      discoveredAt: "2026-04-30T10:00:00.000Z",
      oshaOutcome: "DEATH",
      oshaBodyPart: "Head",
      oshaInjuryNature: "Crush injury",
    });
    const events = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "INCIDENT_OSHA_FATALITY_REPORTED",
      },
    });
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as { incidentId: string };
    expect(payload.incidentId).toBe(result.incidentId);
  });

  it("does NOT trigger the alert for non-DEATH outcomes (DAYS_AWAY)", async () => {
    const { practice } = await seedPracticeWithMembers();
    const { reportIncidentAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await reportIncidentAction({
      title: "Sprained ankle",
      description: "Employee tripped on a cable",
      type: "OSHA_RECORDABLE",
      severity: "MEDIUM",
      phiInvolved: false,
      discoveredAt: "2026-04-30T10:00:00.000Z",
      oshaOutcome: "DAYS_AWAY",
      oshaBodyPart: "Ankle",
      oshaInjuryNature: "Sprain",
      oshaDaysAway: 3,
    });
    const events = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "INCIDENT_OSHA_FATALITY_REPORTED",
      },
    });
    expect(events).toHaveLength(0);
  });
});

describe("updateIncidentOshaOutcomeAction → fatality alert wiring", () => {
  it("upgrade DAYS_AWAY → DEATH triggers the alert (post-intake correction path)", async () => {
    const { owner, practice } = await seedPracticeWithMembers();
    // Initial intake records DAYS_AWAY.
    const { reportIncidentAction, updateIncidentOshaOutcomeAction } =
      await import("@/app/(dashboard)/programs/incidents/actions");
    const reported = await reportIncidentAction({
      title: "Initial recordable injury",
      description: "Employee struck by falling pipe",
      type: "OSHA_RECORDABLE",
      severity: "HIGH",
      phiInvolved: false,
      discoveredAt: "2026-04-30T10:00:00.000Z",
      oshaOutcome: "DAYS_AWAY",
      oshaBodyPart: "Head",
      oshaInjuryNature: "Blunt trauma",
      oshaDaysAway: 0,
    });
    // Confirm no alert yet.
    let events = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "INCIDENT_OSHA_FATALITY_REPORTED",
      },
    });
    expect(events).toHaveLength(0);

    // Outcome correction: the employee subsequently died of injuries.
    await updateIncidentOshaOutcomeAction({
      incidentId: reported.incidentId,
      oshaOutcome: "DEATH",
    });

    events = await db.eventLog.findMany({
      where: {
        practiceId: practice.id,
        type: "INCIDENT_OSHA_FATALITY_REPORTED",
      },
    });
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as { incidentId: string };
    expect(payload.incidentId).toBe(reported.incidentId);
    void owner;
  });
});
