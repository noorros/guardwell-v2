// tests/integration/osha-recordkeeping-correctness.test.ts
//
// Audit #21 — OSHA recordkeeping correctness PR-B8 covers four fixes:
//   - C-3: oshaDaysAway / oshaDaysRestricted capped at 180 (§1904.7(b)(3)(vii))
//   - I-1: oshaRequiredPostersRule uses practice-TZ year boundary (§1903.2)
//   - I-7: Form 300A worksheet inputs have caps + Number.isFinite guards
//   - I-9: audit-prep "all-time" OSHA count capped at 5 years (§1904.33)
//
// Tests 1-3 hit reportIncidentAction (Zod validation).
// Test 4 mocks system time + seeds a Hawaii practice.
// Test 5 covers the audit-prep loader's 5-year horizon. (The 300A worksheet
// UI cap is exercised in src/components/gw/Extras/OshaExtras.test.tsx.)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectPosterAttestation,
} from "@/lib/events/projections/oshaAttestation";
import { OSHA_DERIVATION_RULES } from "@/lib/compliance/derivation/osha";
import { loadOsha300LogEvidence } from "@/lib/audit-prep/evidence-loaders";
import { randomUUID } from "node:crypto";

declare global {
  var __oshaB8TestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__oshaB8TestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__oshaB8TestUser) throw new Error("Unauthorized");
      return globalThis.__oshaB8TestUser;
    },
  };
});

// `revalidatePath` requires Next's static-generation store, not present
// in vitest. Stub so the action's revalidate calls don't blow up.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__oshaB8TestUser = null;
});

afterEach(() => {
  vi.useRealTimers();
});

async function seedPractice(opts?: { timezone?: string }) {
  const user = await db.user.create({
    data: {
      firebaseUid: `osha-b8-${Math.random().toString(36).slice(2, 10)}`,
      email: `osha-b8-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: {
      name: `Audit-#21 Practice ${Math.random().toString(36).slice(2, 8)}`,
      primaryState: "AZ",
      timezone: opts?.timezone ?? "America/Phoenix",
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  globalThis.__oshaB8TestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice };
}

// ──────────────────────────────────────────────────────────────────────
// Fix 1 — OSHA C-3: §1904.7(b)(3)(vii) 180-day cap on day counts
// ──────────────────────────────────────────────────────────────────────

describe("Audit #21 OSHA C-3 — 180-day cap on day counts", () => {
  it("rejects oshaDaysAway: 365 (over 180-day cap)", async () => {
    const { user } = await seedPractice();
    const { reportIncidentAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      reportIncidentAction({
        title: "Sprained ankle — extended absence",
        description: "Staff member injured falling down stairs.",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        phiInvolved: false,
        affectedCount: null,
        discoveredAt: new Date().toISOString(),
        patientState: null,
        oshaBodyPart: "Ankle",
        oshaInjuryNature: "Sprain",
        oshaOutcome: "DAYS_AWAY",
        // 365 days exceeds §1904.7(b)(3)(vii) cap of 180.
        oshaDaysAway: 365,
        oshaDaysRestricted: null,
        sharpsDeviceType: null,
        injuredUserId: user.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects oshaDaysRestricted: 200 (over 180-day cap)", async () => {
    const { user } = await seedPractice();
    const { reportIncidentAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      reportIncidentAction({
        title: "Lifting injury — light duty",
        description: "Staff strained back lifting supply box.",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        phiInvolved: false,
        affectedCount: null,
        discoveredAt: new Date().toISOString(),
        patientState: null,
        oshaBodyPart: "Back",
        oshaInjuryNature: "Strain",
        oshaOutcome: "RESTRICTED",
        oshaDaysAway: null,
        // 200 exceeds the 180 cap.
        oshaDaysRestricted: 200,
        sharpsDeviceType: null,
        injuredUserId: user.id,
      }),
    ).rejects.toThrow();
  });

  it("accepts oshaDaysAway: 180 (boundary — exactly at cap)", async () => {
    const { user } = await seedPractice();
    const { reportIncidentAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    const result = await reportIncidentAction({
      title: "Sprained ankle — full 180 days",
      description: "Staff member injured falling down stairs.",
      type: "OSHA_RECORDABLE",
      severity: "MEDIUM",
      phiInvolved: false,
      affectedCount: null,
      discoveredAt: new Date().toISOString(),
      patientState: null,
      oshaBodyPart: "Ankle",
      oshaInjuryNature: "Sprain",
      oshaOutcome: "DAYS_AWAY",
      // §1904.7 caps AT 180 — that exact value is the legitimate
      // edge case (count maxed but record-keeping cap satisfied).
      oshaDaysAway: 180,
      oshaDaysRestricted: null,
      sharpsDeviceType: null,
      injuredUserId: user.id,
    });
    expect(result.incidentId).toEqual(expect.any(String));
    const stored = await db.incident.findUniqueOrThrow({
      where: { id: result.incidentId },
    });
    expect(stored.oshaDaysAway).toBe(180);
  });

  it("accepts oshaDaysRestricted: 180 (boundary — exactly at cap)", async () => {
    const { user } = await seedPractice();
    const { reportIncidentAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    const result = await reportIncidentAction({
      title: "Restricted — full 180 days",
      description: "Light-duty assignment after surgery.",
      type: "OSHA_RECORDABLE",
      severity: "MEDIUM",
      phiInvolved: false,
      affectedCount: null,
      discoveredAt: new Date().toISOString(),
      patientState: null,
      oshaBodyPart: "Back",
      oshaInjuryNature: "Surgery recovery",
      oshaOutcome: "RESTRICTED",
      oshaDaysAway: null,
      oshaDaysRestricted: 180,
      sharpsDeviceType: null,
      injuredUserId: user.id,
    });
    expect(result.incidentId).toEqual(expect.any(String));
    const stored = await db.incident.findUniqueOrThrow({
      where: { id: result.incidentId },
    });
    expect(stored.oshaDaysRestricted).toBe(180);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Fix 2 — OSHA I-1: poster rule uses practice-TZ year boundary
// ──────────────────────────────────────────────────────────────────────

describe("Audit #21 OSHA I-1 — oshaRequiredPostersRule honors practice TZ", () => {
  it("Hawaii practice + server-UTC just past Jan 1 still uses 2025 year boundary", async () => {
    // System clock: 2026-01-01T05:00:00Z. In Hawaii (UTC-10) that's
    // still 2025-12-31T19:00 — the practice is firmly in 2025.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T05:00:00Z"));

    const { user, practice } = await seedPractice({
      timezone: "Pacific/Honolulu",
    });

    // Seed a 2025 poster attestation — this one IS in the practice's
    // current calendar year (Hawaii is still in 2025).
    const dec2025 = new Date("2025-12-15T20:00:00Z");
    await db.eventLog.create({
      data: {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POSTER_ATTESTATION",
        payload: {
          attestationId: randomUUID(),
          attestedByUserId: user.id,
          attestedAt: dec2025.toISOString(),
          posters: ["OSHA_JOB_SAFETY"],
        },
        createdAt: dec2025,
      },
    });

    // Pre-fix: rule used new Date().getFullYear() = 2026 in UTC, so the
    // Dec 2025 attestation fell BEFORE the 2026-01-01T00:00:00Z cutoff
    // and the rule returned GAP. Post-fix: practice TZ = Hawaii means
    // the practice's calendar year is 2025, the 2025 boundary captures
    // the Dec attestation, and the rule returns COMPLIANT.
    const rule = OSHA_DERIVATION_RULES.OSHA_REQUIRED_POSTERS;
    if (!rule) throw new Error("OSHA_REQUIRED_POSTERS rule missing");
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("COMPLIANT");
  });

  it("Hawaii practice flips to GAP after the practice's own Jan 1 (Hawaii time)", async () => {
    // Set clock to 2026-01-02T00:00:00Z — that's 2026-01-01T14:00 in
    // Honolulu, so Hawaii has just crossed into 2026 too. A 2025
    // attestation is now last year and should NOT satisfy the rule.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));

    const { user, practice } = await seedPractice({
      timezone: "Pacific/Honolulu",
    });

    const dec2025 = new Date("2025-12-15T20:00:00Z");
    await db.eventLog.create({
      data: {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POSTER_ATTESTATION",
        payload: {
          attestationId: randomUUID(),
          attestedByUserId: user.id,
          attestedAt: dec2025.toISOString(),
        },
        createdAt: dec2025,
      },
    });

    const rule = OSHA_DERIVATION_RULES.OSHA_REQUIRED_POSTERS;
    if (!rule) throw new Error("OSHA_REQUIRED_POSTERS rule missing");
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("GAP");
  });

  it("end-to-end: attestation projected today flips Hawaii practice to COMPLIANT (TZ-aware)", async () => {
    // Real time, real projection — sanity check that the TZ-aware
    // boundary doesn't break the happy path.
    const { user, practice } = await seedPractice({
      timezone: "Pacific/Honolulu",
    });
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POSTER_ATTESTATION",
        payload: {
          attestationId: randomUUID(),
          attestedByUserId: user.id,
          attestedAt: new Date().toISOString(),
          posters: ["OSHA_JOB_SAFETY"],
        },
      },
      async (tx) =>
        projectPosterAttestation(tx, { practiceId: practice.id }),
    );
    const rule = OSHA_DERIVATION_RULES.OSHA_REQUIRED_POSTERS;
    if (!rule) throw new Error("OSHA_REQUIRED_POSTERS rule missing");
    const status = await db.$transaction((tx) => rule(tx, practice.id));
    expect(status).toBe("COMPLIANT");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Fix 4 — OSHA I-9: audit-prep all-time count uses 5-year horizon
// ──────────────────────────────────────────────────────────────────────

describe("Audit #21 OSHA I-9 — audit-prep 5-year retention horizon", () => {
  it("5-year-old incident IS counted; 6-year-old incident is NOT", async () => {
    const { user, practice } = await seedPractice();

    // 4 years old — within §1904.33 horizon.
    const fourYearsAgo = new Date(
      Date.now() - 4 * 365 * 24 * 60 * 60 * 1000,
    );
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Lifting injury — recent",
        description: "Within 5-year retention window.",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        status: "RESOLVED",
        discoveredAt: fourYearsAgo,
        reportedByUserId: user.id,
        oshaOutcome: "DAYS_AWAY",
      },
    });

    // 6 years old — outside §1904.33 horizon. Should NOT appear in the
    // audit-prep "all-time" count anymore.
    const sixYearsAgo = new Date(
      Date.now() - 6 * 365 * 24 * 60 * 60 * 1000,
    );
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Lifting injury — old",
        description: "Outside 5-year retention window per §1904.33.",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        status: "RESOLVED",
        discoveredAt: sixYearsAgo,
        reportedByUserId: user.id,
        oshaOutcome: "DAYS_AWAY",
      },
    });

    const ev = await loadOsha300LogEvidence(db, practice.id);
    // Pre-fix: allTime would be 2 (no horizon at all). Post-fix: only
    // the 4-year-old row counts.
    expect(ev.recordableIncidentsAllTime).toBe(1);
    // 12-month window unchanged — neither incident falls inside it.
    expect(ev.recordableIncidentsLast12Months).toBe(0);
    // mostRecentRecordableAt should reflect the 4-year-old row, NOT
    // the 6-year-old one (which would have leaked through pre-fix).
    expect(ev.mostRecentRecordableAt).toBe(fourYearsAgo.toISOString());
  });

  it("incident at exactly 5-year boundary (just inside) is counted", async () => {
    const { user, practice } = await seedPractice();

    // Exactly 5 years minus 1 day — still inside the §1904.33 window.
    const justInsideHorizon = new Date(
      Date.now() - (5 * 365 - 1) * 24 * 60 * 60 * 1000,
    );
    await db.incident.create({
      data: {
        practiceId: practice.id,
        title: "Edge of horizon",
        description: "1 day inside the §1904.33 5-year boundary.",
        type: "OSHA_RECORDABLE",
        severity: "MEDIUM",
        status: "RESOLVED",
        discoveredAt: justInsideHorizon,
        reportedByUserId: user.id,
        oshaOutcome: "OTHER_RECORDABLE",
      },
    });

    const ev = await loadOsha300LogEvidence(db, practice.id);
    expect(ev.recordableIncidentsAllTime).toBe(1);
  });
});
