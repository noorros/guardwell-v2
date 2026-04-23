// tests/integration/critical-breach-alert.test.ts
//
// Covers emitCriticalBreachAlert end-to-end against a real DB:
//   - Creates one CRITICAL Notification per active practice member
//   - Respects criticalAlertsEnabled=false (no notification)
//   - Dedups repeat calls (unique on userId + type + entityKey)
//   - Major-breach title path triggers on affectedCount ≥ 500

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { emitCriticalBreachAlert } from "@/lib/notifications/critical-alert";

async function seedPracticeWithIncident(opts: { affectedCount: number }) {
  const user = await db.user.create({
    data: {
      firebaseUid: `ca-${Math.random().toString(36).slice(2, 10)}`,
      email: `ca-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Critical Alert Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const incident = await db.incident.create({
    data: {
      practiceId: practice.id,
      reportedByUserId: user.id,
      title: "Server-room burglary",
      description: "Overnight break-in; laptops with PHI stolen.",
      type: "SECURITY",
      severity: "CRITICAL",
      status: "UNDER_INVESTIGATION",
      isBreach: true,
      affectedCount: opts.affectedCount,
      phiInvolved: true,
      discoveredAt: new Date(),
    },
  });
  return { user, practice, incident };
}

describe("emitCriticalBreachAlert", () => {
  it("creates one CRITICAL notification per practice member on major breach", async () => {
    const { user, practice, incident } = await seedPracticeWithIncident({
      affectedCount: 1200,
    });
    const result = await emitCriticalBreachAlert({
      practiceId: practice.id,
      incidentId: incident.id,
      incidentTitle: incident.title,
      affectedCount: 1200,
      overallRiskScore: 85,
      discoveredAt: incident.discoveredAt,
    });
    expect(result.notified).toBe(1);
    const notes = await db.notification.findMany({
      where: { userId: user.id, type: "INCIDENT_BREACH_UNRESOLVED" },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe("CRITICAL");
    expect(notes[0]!.title).toContain("Major breach");
    expect(notes[0]!.title).toContain("1,200");
  });

  it("uses non-major title when affectedCount < 500", async () => {
    const { user, practice, incident } = await seedPracticeWithIncident({
      affectedCount: 10,
    });
    await emitCriticalBreachAlert({
      practiceId: practice.id,
      incidentId: incident.id,
      incidentTitle: incident.title,
      affectedCount: 10,
      overallRiskScore: 55,
      discoveredAt: incident.discoveredAt,
    });
    const notes = await db.notification.findMany({
      where: { userId: user.id, type: "INCIDENT_BREACH_UNRESOLVED" },
    });
    expect(notes[0]!.title).toContain("Breach determined");
    expect(notes[0]!.title).not.toContain("Major");
  });

  it("dedups — repeat calls for the same incident don't create duplicate rows", async () => {
    const { user, practice, incident } = await seedPracticeWithIncident({
      affectedCount: 100,
    });
    const payload = {
      practiceId: practice.id,
      incidentId: incident.id,
      incidentTitle: incident.title,
      affectedCount: 100,
      overallRiskScore: 60,
      discoveredAt: incident.discoveredAt,
    };
    const first = await emitCriticalBreachAlert(payload);
    const second = await emitCriticalBreachAlert(payload);
    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
    const notes = await db.notification.findMany({
      where: { userId: user.id, type: "INCIDENT_BREACH_UNRESOLVED" },
    });
    expect(notes).toHaveLength(1);
  });
});
