// tests/integration/incident-breach-determination.test.ts
//
// Audit #21 (HIPAA I-1, 2026-04-30): per-state AG notification tracking
// on multi-state breaches. The breach-determination projection
// materializes one IncidentStateAgNotification row per affected state
// with the deadline derived from the per-state HIPAA overlay rules.
//
// Coverage:
//   1. Single-state breach generates one row (regression — existing
//      single-state behavior preserved).
//   2. Multi-state breach generates one row per state with the correct
//      per-state deadline.
//   3. Idempotent projection — replaying the breach determination
//      doesn't create duplicate rows.
//   4. PDF renders multi-state table when ≥2 states involved.
//   5. PDF renders single-state line when only 1 state involved.
//   6. INCIDENT_NOTIFIED_STATE_AG with stateCode stamps the matching
//      per-state row's notifiedAt.

import { describe, it, expect, vi } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectIncidentReported,
  projectIncidentBreachDetermined,
  projectIncidentNotifiedStateAg,
} from "@/lib/events/projections/incident";
import { extractInflatedText } from "./utils/pdf-text";

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__testUser ?? null,
    requireUser: async () => {
      if (!globalThis.__testUser) throw new Error("Unauthorized");
      return globalThis.__testUser;
    },
  };
});

declare global {
  var __testUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

async function seedPractice(primaryState = "TX") {
  const user = await db.user.create({
    data: {
      firebaseUid: `uid-${Math.random().toString(36).slice(2, 10)}`,
      email: `bd-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Multi-State Test Clinic", primaryState },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function reportIncident(args: {
  user: { id: string };
  practice: { id: string };
  patientState?: string | null;
  affectedPatientStates?: string[];
  discoveredAt?: Date;
  affectedCount?: number;
}): Promise<string> {
  const incidentId = `inc-${Math.random().toString(36).slice(2, 12)}`;
  const reportedPayload = {
    incidentId,
    title: "Multi-state PHI mailing mis-route",
    description: "Statements mailed to wrong addresses across multiple states.",
    type: "PRIVACY" as const,
    severity: "HIGH" as const,
    phiInvolved: true,
    affectedCount: args.affectedCount ?? 12,
    discoveredAt: (args.discoveredAt ?? new Date("2026-04-20T10:00:00Z")).toISOString(),
    patientState: args.patientState ?? null,
    affectedPatientStates: args.affectedPatientStates,
  };
  await appendEventAndApply(
    {
      practiceId: args.practice.id,
      actorUserId: args.user.id,
      type: "INCIDENT_REPORTED",
      payload: reportedPayload,
    },
    async (tx) =>
      projectIncidentReported(tx, {
        practiceId: args.practice.id,
        reportedByUserId: args.user.id,
        payload: reportedPayload,
      }),
  );
  return incidentId;
}

async function determineBreach(args: {
  user: { id: string };
  practice: { id: string };
  incidentId: string;
  affectedCount?: number;
}): Promise<void> {
  const determinePayload = {
    incidentId: args.incidentId,
    factor1Score: 4,
    factor2Score: 3,
    factor3Score: 4,
    factor4Score: 2,
    overallRiskScore: 65,
    isBreach: true,
    affectedCount: args.affectedCount ?? 12,
    ocrNotifyRequired: true,
    memoText:
      "PHI involving names, DOBs, and service codes was mailed to incorrect addresses across multiple states. Recipients are unrelated third parties; no signed assurance of destruction received yet. Risk classified as moderate-to-high probability of compromise.",
  };
  await appendEventAndApply(
    {
      practiceId: args.practice.id,
      actorUserId: args.user.id,
      type: "INCIDENT_BREACH_DETERMINED",
      payload: determinePayload,
    },
    async (tx) =>
      projectIncidentBreachDetermined(tx, {
        practiceId: args.practice.id,
        payload: determinePayload,
      }),
  );
}

describe("Audit #21 (HIPAA I-1): per-state AG notification on breach", () => {
  it("single-state breach generates exactly one IncidentStateAgNotification row", async () => {
    const { user, practice } = await seedPractice("TX");
    const incidentId = await reportIncident({
      user,
      practice,
      patientState: "TX",
    });
    await determineBreach({ user, practice, incidentId });

    const rows = await db.incidentStateAgNotification.findMany({
      where: { incidentId },
      orderBy: { state: "asc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("TX");
    expect(rows[0]!.thresholdAffectedCount).toBe(12);
    expect(rows[0]!.notifiedAt).toBeNull();
    // TX is a 60-calendar-day state.
    const expectedDeadline = new Date("2026-04-20T10:00:00Z");
    expectedDeadline.setDate(expectedDeadline.getDate() + 60);
    expect(rows[0]!.deadlineAt.toISOString()).toBe(
      expectedDeadline.toISOString(),
    );
  });

  it("falls back to practice.primaryState when no patientState/affectedPatientStates set", async () => {
    const { user, practice } = await seedPractice("AZ");
    const incidentId = await reportIncident({ user, practice });
    await determineBreach({ user, practice, incidentId });

    const rows = await db.incidentStateAgNotification.findMany({
      where: { incidentId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("AZ");
  });

  it("multi-state breach generates one row per state with per-state deadlines", async () => {
    const { user, practice } = await seedPractice("TX");
    const incidentId = await reportIncident({
      user,
      practice,
      affectedPatientStates: ["TX", "CA", "NY"],
      discoveredAt: new Date("2026-04-20T10:00:00Z"),
    });
    await determineBreach({ user, practice, incidentId });

    const rows = await db.incidentStateAgNotification.findMany({
      where: { incidentId },
      orderBy: { state: "asc" },
    });
    expect(rows).toHaveLength(3);
    const byState = Object.fromEntries(rows.map((r) => [r.state, r]));
    expect(Object.keys(byState).sort()).toEqual(["CA", "NY", "TX"]);

    // CA: 15 BUSINESS days from 2026-04-20 (Mon) — skip 2 weekends → +21 cal days
    // (precisely: 2026-04-20..2026-05-11 covers 15 weekdays + 4 weekend days =
    //  2026-05-11 evening exact). Compute via the same algorithm.
    const caDeadline = new Date("2026-04-20T10:00:00Z");
    let added = 0;
    while (added < 15) {
      caDeadline.setDate(caDeadline.getDate() + 1);
      const day = caDeadline.getDay();
      if (day !== 0 && day !== 6) added += 1;
    }
    expect(byState.CA!.deadlineAt.toISOString()).toBe(caDeadline.toISOString());

    // TX: 60 calendar days
    const txDeadline = new Date("2026-04-20T10:00:00Z");
    txDeadline.setDate(txDeadline.getDate() + 60);
    expect(byState.TX!.deadlineAt.toISOString()).toBe(txDeadline.toISOString());

    // NY: "most expedient" → no fixed deadline; deadlineAt anchored to discoveredAt.
    expect(byState.NY!.deadlineAt.toISOString()).toBe(
      new Date("2026-04-20T10:00:00Z").toISOString(),
    );

    // Each row carries the determination-time threshold snapshot.
    for (const r of rows) expect(r.thresholdAffectedCount).toBe(12);
  });

  // Audit #21 Wave 4 #244 (Wave 4 D6): the breach-deadline projection
  // path uses computeStateBreachDeadline → addBusinessDays(skipHolidays:
  // true) for CA's 15-business-day rule. The existing multi-state test
  // happens to land outside any federal holiday window, so the
  // skipHolidays branch is structurally there but not exercised. This
  // regression pins it: a CA discovery on Fri 2026-05-08 must skip
  // Memorial Day (Mon 2026-05-25) when computing the +15-business-day
  // deadline, landing on Mon 2026-06-01 instead of Fri 2026-05-29.
  it("CA 15-business-day breach deadline skips Memorial Day federal holiday (audit #21 Wave-4)", async () => {
    const { user, practice } = await seedPractice("CA");
    const incidentId = await reportIncident({
      user,
      practice,
      patientState: "CA",
      // Fri 2026-05-08 10:00 UTC. +15 weekday-only days = Fri 2026-05-29.
      // +15 business days skipping Memorial Day = Mon 2026-06-01.
      discoveredAt: new Date("2026-05-08T10:00:00Z"),
    });
    await determineBreach({ user, practice, incidentId });

    const rows = await db.incidentStateAgNotification.findMany({
      where: { incidentId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("CA");
    // Expected deadline: 2026-06-01 (Mon), not 2026-05-29 (Fri). The
    // exact ISO instant preserves the discoveredAt time-of-day (10:00).
    expect(rows[0]!.deadlineAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("idempotent — re-emitting INCIDENT_BREACH_DETERMINED does not duplicate rows", async () => {
    const { user, practice } = await seedPractice("TX");
    const incidentId = await reportIncident({
      user,
      practice,
      affectedPatientStates: ["TX", "CA"],
    });
    await determineBreach({ user, practice, incidentId });
    // Replay determination — same payload.
    await determineBreach({ user, practice, incidentId });

    const rows = await db.incidentStateAgNotification.findMany({
      where: { incidentId },
    });
    expect(rows).toHaveLength(2);
  });

  it("INCIDENT_NOTIFIED_STATE_AG with stateCode stamps the matching per-state row", async () => {
    const { user, practice } = await seedPractice("TX");
    const incidentId = await reportIncident({
      user,
      practice,
      affectedPatientStates: ["TX", "CA"],
    });
    await determineBreach({ user, practice, incidentId });

    const notifiedAt = "2026-04-25T18:00:00.000Z";
    const payload = { incidentId, notifiedAt, stateCode: "CA" };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_NOTIFIED_STATE_AG",
        payload,
      },
      async (tx) =>
        projectIncidentNotifiedStateAg(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const rows = await db.incidentStateAgNotification.findMany({
      where: { incidentId },
      orderBy: { state: "asc" },
    });
    const byState = Object.fromEntries(rows.map((r) => [r.state, r]));
    expect(byState.CA!.notifiedAt?.toISOString()).toBe(notifiedAt);
    expect(byState.TX!.notifiedAt).toBeNull();
  });

  it("does NOT generate per-state rows when isBreach=false", async () => {
    const { user, practice } = await seedPractice("TX");
    const incidentId = await reportIncident({
      user,
      practice,
      affectedPatientStates: ["TX", "CA"],
    });
    // Explicitly determine isBreach=false.
    const determinePayload = {
      incidentId,
      factor1Score: 1,
      factor2Score: 1,
      factor3Score: 1,
      factor4Score: 1,
      overallRiskScore: 20,
      isBreach: false,
      affectedCount: 12,
      ocrNotifyRequired: false,
      memoText:
        "Documented analysis confirming low probability of compromise. Recipient was a HIPAA-bound entity that returned the data unviewed; mitigation complete.",
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "INCIDENT_BREACH_DETERMINED",
        payload: determinePayload,
      },
      async (tx) =>
        projectIncidentBreachDetermined(tx, {
          practiceId: practice.id,
          payload: determinePayload,
        }),
    );

    const rows = await db.incidentStateAgNotification.findMany({
      where: { incidentId },
    });
    expect(rows).toHaveLength(0);
  });
});

describe("Audit #21 (HIPAA I-1): breach memo PDF — single vs multi-state", () => {
  it("renders single-state legacy line when 1 state involved", async () => {
    const { user, practice } = await seedPractice("CA");
    globalThis.__testUser = {
      id: user.id,
      email: user.email,
      firebaseUid: user.firebaseUid,
    };
    const incidentId = await reportIncident({
      user,
      practice,
      patientState: "CA",
    });
    await determineBreach({ user, practice, incidentId });

    const { GET } = await import(
      "@/app/api/audit/incident-breach-memo/[id]/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: incidentId }),
    });
    expect(res.status).toBe(200);

    const buf = new Uint8Array(await res.arrayBuffer());
    const text = extractInflatedText(buf);
    // Single-state path uses the labeled NotifRow.
    expect(text).toMatch(/State Attorney General/);
    // Multi-state table title must NOT appear.
    expect(text).not.toMatch(/per affected state/);
    globalThis.__testUser = null;
  });

  it("renders multi-state per-state table when ≥2 states involved", async () => {
    const { user, practice } = await seedPractice("TX");
    globalThis.__testUser = {
      id: user.id,
      email: user.email,
      firebaseUid: user.firebaseUid,
    };
    const incidentId = await reportIncident({
      user,
      practice,
      affectedPatientStates: ["TX", "CA", "NY"],
    });
    await determineBreach({ user, practice, incidentId });

    const { GET } = await import(
      "@/app/api/audit/incident-breach-memo/[id]/route"
    );
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: incidentId }),
    });
    expect(res.status).toBe(200);

    const buf = new Uint8Array(await res.arrayBuffer());
    const text = extractInflatedText(buf);
    // Table title is unique to the multi-state path.
    expect(text).toMatch(/per affected state/i);
    // Each affected state code should appear in a table row.
    expect(text).toMatch(/TX/);
    expect(text).toMatch(/CA/);
    expect(text).toMatch(/NY/);
    // Threshold column header.
    expect(text).toMatch(/Threshold/i);
    globalThis.__testUser = null;
  });
});
