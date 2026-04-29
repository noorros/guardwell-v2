// tests/integration/osha-300-log.test.ts
//
// Reporting an OSHA_RECORDABLE incident should flip OSHA_300_LOG to
// COMPLIANT via the incident-recordable evidence path — UNLESS the
// outcome is FIRST_AID, which §1904.7(b)(5) explicitly excludes from
// the 300 Log. Audit C-1 / OSHA code review (2026-04-29).

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectIncidentReported } from "@/lib/events/projections/incident";
import { loadOsha300LogEvidence } from "@/lib/audit-prep/evidence-loaders";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `osha-${Math.random().toString(36).slice(2, 10)}`,
      email: `osha-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "OSHA Log Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "OSHA" },
    update: {},
    create: {
      code: "OSHA",
      name: "OSHA",
      description: "test",
      jurisdiction: "federal",
      weightDefault: 0.2,
      scoringStrategy: "STANDARD_CHECKLIST",
      sortOrder: 20,
    },
  });
  const req = await db.regulatoryRequirement.upsert({
    where: {
      frameworkId_code: {
        frameworkId: framework.id,
        code: "OSHA_300_LOG",
      },
    },
    update: { acceptedEvidenceTypes: ["INCIDENT:OSHA_RECORDABLE"] },
    create: {
      frameworkId: framework.id,
      code: "OSHA_300_LOG",
      title: "OSHA 300 Log",
      severity: "STANDARD",
      weight: 1,
      description: "test",
      acceptedEvidenceTypes: ["INCIDENT:OSHA_RECORDABLE"],
      sortOrder: 50,
    },
  });
  await db.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId: practice.id,
        frameworkId: framework.id,
      },
    },
    update: {},
    create: {
      practiceId: practice.id,
      frameworkId: framework.id,
      enabled: true,
      scoreCache: 0,
    },
  });
  return { user, practice, req };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("OSHA_300_LOG → INCIDENT:OSHA_RECORDABLE derivation", () => {
  it("No OSHA incidents → GAP (via rederive)", async () => {
    const { user, practice, req } = await seed();
    // Report a non-OSHA incident; should NOT flip OSHA_300_LOG.
    const id = `inc-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      incidentId: id,
      title: "PHI email",
      description: "Wrong recipient",
      type: "PRIVACY" as const,
      severity: "LOW" as const,
      phiInvolved: true,
      affectedCount: 1,
      discoveredAt: new Date().toISOString(),
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_REPORTED",
        payload,
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: user.id,
          payload,
        }),
    );
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");
  });

  it("OSHA_RECORDABLE incident with DAYS_AWAY outcome flips OSHA_300_LOG to COMPLIANT", async () => {
    const { user, practice, req } = await seed();
    const id = `inc-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      incidentId: id,
      title: "Slip-and-fall — sprained ankle",
      description: "Staff member slipped on wet floor",
      type: "OSHA_RECORDABLE" as const,
      severity: "MEDIUM" as const,
      phiInvolved: false,
      affectedCount: 0,
      discoveredAt: new Date().toISOString(),
      oshaBodyPart: "Ankle",
      oshaInjuryNature: "Sprain",
      oshaOutcome: "DAYS_AWAY" as const,
      oshaDaysAway: 3,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_REPORTED",
        payload,
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: user.id,
          payload,
        }),
    );
    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("FIRST_AID-only incident does NOT flip OSHA_300_LOG (§1904.7(b)(5) exclusion)", async () => {
    const { user, practice, req } = await seed();
    const id = `inc-${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      incidentId: id,
      title: "Minor cut — bandage only",
      description: "RN small finger cut, treated with bandage",
      type: "OSHA_RECORDABLE" as const,
      severity: "LOW" as const,
      phiInvolved: false,
      affectedCount: 0,
      discoveredAt: new Date().toISOString(),
      oshaBodyPart: "Finger",
      oshaInjuryNature: "Laceration",
      oshaOutcome: "FIRST_AID" as const,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_REPORTED",
        payload,
      },
      async (tx) =>
        projectIncidentReported(tx, {
          practiceId: practice.id,
          reportedByUserId: user.id,
          payload,
        }),
    );
    // §1904.7(b)(5): first-aid-only injuries are NOT recordable on Form 300.
    // Projection still rederives (incident type is OSHA_RECORDABLE) but the
    // rule excludes FIRST_AID from the count, so it lands on GAP.
    expect(await statusOf(practice.id, req.id)).toBe("GAP");
  });

  it("loadOsha300LogEvidence excludes FIRST_AID incidents from counts", async () => {
    const { user, practice } = await seed();
    // One DAYS_AWAY (recordable) + one FIRST_AID (NOT recordable per §1904.7).
    await db.incident.createMany({
      data: [
        {
          practiceId: practice.id,
          title: "Real recordable",
          type: "OSHA_RECORDABLE",
          severity: "MEDIUM",
          status: "OPEN",
          description: "Slip-and-fall",
          phiInvolved: false,
          discoveredAt: new Date(),
          reportedByUserId: user.id,
          oshaInjuryNature: "Sprain",
          oshaOutcome: "DAYS_AWAY",
          oshaDaysAway: 3,
        },
        {
          practiceId: practice.id,
          title: "First aid only",
          type: "OSHA_RECORDABLE",
          severity: "LOW",
          status: "RESOLVED",
          description: "Minor cut",
          phiInvolved: false,
          discoveredAt: new Date(),
          reportedByUserId: user.id,
          oshaInjuryNature: "Laceration",
          oshaOutcome: "FIRST_AID",
        },
      ],
    });
    const evidence = await db.$transaction((tx) =>
      loadOsha300LogEvidence(tx, practice.id),
    );
    // Only the DAYS_AWAY row should count — FIRST_AID is not recordable.
    expect(evidence.recordableIncidentsLast12Months).toBe(1);
    expect(evidence.recordableIncidentsAllTime).toBe(1);
  });
});
