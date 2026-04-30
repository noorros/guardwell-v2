// tests/integration/breach-wizard-guards.test.ts
//
// Audit #21 (HIPAA I-6 + OSHA C-2 / B-4) — server-side guards on the
// breach determination wizard. The wizard's "is reportable" trigger
// (any factor at 5, OR composite ≥ 50) requires at least one affected
// individual; pushing through "reportable: true with affectedCount=0"
// would generate an HHS-notification-required record that nobody can
// actually submit a breach report for.
//
// Coverage:
//   - factor-5 trigger + affectedCount=0 → action throws
//   - composite ≥ 50 trigger + affectedCount=0 → action throws
//   - low-risk path (sum < 20) with affectedCount=0 still succeeds
//   - happy path: factor-5 + affectedCount=1 succeeds

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  var __breachGuardTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__breachGuardTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__breachGuardTestUser) throw new Error("Unauthorized");
      return globalThis.__breachGuardTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__breachGuardTestUser = null;
});

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `bg-${Math.random().toString(36).slice(2, 10)}`,
      email: `bg-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Breach Guard Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "ADMIN" },
  });
  globalThis.__breachGuardTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  // Seed an incident to determine.
  const incident = await db.incident.create({
    data: {
      practiceId: practice.id,
      title: "Test PHI exposure",
      description: "Test description",
      type: "PRIVACY",
      severity: "HIGH",
      phiInvolved: true,
      discoveredAt: new Date(),
      reportedByUserId: user.id,
    },
  });
  return { user, practice, incident };
}

describe("Audit #21 (HIPAA I-6) — affectedCount guard on breach determination", () => {
  it("rejects factor-5 trigger with affectedCount=0", async () => {
    const { incident } = await seed();
    const { completeBreachDeterminationAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    await expect(
      completeBreachDeterminationAction({
        incidentId: incident.id,
        // Factor 1 = 5 → hard trigger fires regardless of composite.
        factor1Score: 5,
        factor2Score: 1,
        factor3Score: 1,
        factor4Score: 1,
        affectedCount: 0,
        memoText:
          "Factor-5 trigger but the operator forgot to fill in the affected count — this should reject.",
      }),
    ).rejects.toThrow(/affected count must be at least 1/i);
  });

  it("rejects composite ≥ 50 with affectedCount=0", async () => {
    const { incident } = await seed();
    const { completeBreachDeterminationAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    // Sum 14 / 20 = 70 → composite ≥ 50, no factor at 5.
    await expect(
      completeBreachDeterminationAction({
        incidentId: incident.id,
        factor1Score: 4,
        factor2Score: 4,
        factor3Score: 3,
        factor4Score: 3,
        affectedCount: 0,
        memoText:
          "Composite-≥-50 trigger but affectedCount was left at zero — this should reject.",
      }),
    ).rejects.toThrow(/affected count must be at least 1/i);
  });

  it("accepts low-risk path (not reportable) with affectedCount=0", async () => {
    const { incident } = await seed();
    const { completeBreachDeterminationAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    // Sum 4 / 20 = 20 → composite < 50, no factor at 5. Not a breach.
    // affectedCount=0 is plausibly closeable as "incident logged, no PHI affected."
    const result = await completeBreachDeterminationAction({
      incidentId: incident.id,
      factor1Score: 1,
      factor2Score: 1,
      factor3Score: 1,
      factor4Score: 1,
      affectedCount: 0,
      memoText:
        "Misrouted fax confirmed never opened by recipient — no PHI was actually accessed.",
    });
    expect(result.isBreach).toBe(false);
    expect(result.overallRiskScore).toBe(20);
  });

  it("accepts factor-5 trigger with affectedCount=1 (happy path)", async () => {
    const { incident } = await seed();
    const { completeBreachDeterminationAction } = await import(
      "@/app/(dashboard)/programs/incidents/actions"
    );
    const result = await completeBreachDeterminationAction({
      incidentId: incident.id,
      factor1Score: 5,
      factor2Score: 1,
      factor3Score: 1,
      factor4Score: 1,
      affectedCount: 1,
      memoText:
        "Factor 1 = 5 (sensitive PHI). Single patient affected; HHS notification required.",
    });
    expect(result.isBreach).toBe(true);
  });
});
