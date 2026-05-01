// tests/integration/cap-from-alert.test.ts
//
// Phase 5 PR 7 — end-to-end coverage for the alert -> CAP path through
// the SERVER ACTION layer (`addAlertToCapAction`). Complements the
// lib-helper coverage in src/lib/regulatory/alertMutations.test.ts (PR 6)
// by verifying that the action's auth gate, schema validation, and
// noon-UTC dueDate anchoring all wire up correctly into the same
// dual-create + idempotent code path.
//
// Mirrors the auth-mocking pattern in tests/integration/credential-update
// .test.ts and tests/integration/role-gate-sweep.test.ts:
//   - vi.mock("@/lib/auth", ...) returns a programmable test user
//   - vi.mock("next/cache", ...) stubs revalidatePath
//   - rbac's `requireRole` then resolves the test user via real
//     PracticeUser DB rows, so role/practiceId scoping uses real Postgres
//     state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  // eslint-disable-next-line no-var
  var __capFromAlertTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__capFromAlertTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__capFromAlertTestUser) throw new Error("Unauthorized");
      return globalThis.__capFromAlertTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__capFromAlertTestUser = null;
});

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedAlert(label: string, role: "OWNER" | "ADMIN" = "OWNER") {
  const user = await db.user.create({
    data: {
      firebaseUid: rid("cfa-uid"),
      email: `${rid("cfa")}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `CapFromAlert ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  const source = await db.regulatorySource.create({
    data: {
      name: `Test source ${label}`,
      url: `https://example.test/${rid("src")}`,
      feedType: "RSS",
      isActive: true,
    },
  });
  const article = await db.regulatoryArticle.create({
    data: {
      sourceId: source.id,
      title: `Test article ${label}`,
      url: `https://example.test/article/${rid("art")}`,
    },
  });
  const alert = await db.regulatoryAlert.create({
    data: {
      practiceId: practice.id,
      articleId: article.id,
      alertBody: "Test alert body",
      severity: "ADVISORY",
      matchedFrameworks: ["HIPAA"],
    },
  });
  return { user, practice, source, article, alert };
}

describe("addAlertToCapAction (Phase 5 PR 7 — end-to-end)", () => {
  it("creates a CAP visible from /programs/risk?tab=cap with correct fields", async () => {
    const { practice, alert, user } = await seedAlert("e2e-create");
    globalThis.__capFromAlertTestUser = {
      id: user.id,
      email: user.email,
      firebaseUid: user.firebaseUid,
    };

    const { addAlertToCapAction } = await import(
      "@/app/(dashboard)/audit/regulatory/actions"
    );

    const result = await addAlertToCapAction({
      alertId: alert.id,
      description: "Update incident response SOP",
      dueDate: "2026-06-01",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.capId).toBeTruthy();
    expect(result.actionId).toBeTruthy();

    // Verify the CAP exists in the DB with the correct fields.
    const cap = await db.correctiveAction.findUnique({
      where: { id: result.capId },
    });
    expect(cap).not.toBeNull();
    expect(cap?.practiceId).toBe(practice.id);
    expect(cap?.sourceAlertId).toBe(alert.id);
    expect(cap?.riskItemId).toBeNull();
    expect(cap?.description).toBe("Update incident response SOP");
    expect(cap?.status).toBe("PENDING");
    // dueDate string anchored at noon UTC by the action layer so it
    // round-trips as the same calendar day across U.S. timezones.
    expect(cap?.dueDate?.toISOString()).toBe(
      new Date("2026-06-01T12:00:00.000Z").toISOString(),
    );
    // ownerUserId is wired through to the OWNER (the caller).
    expect(cap?.ownerUserId).toBe(user.id);

    // The /programs/risk page-level CAP-tab query (open CAPs) should
    // pick this up. Phase 5 PR 6's CapTab queries open caps as
    // "status !== COMPLETED".
    const visibleOpen = await db.correctiveAction.findMany({
      where: { practiceId: practice.id, status: { not: "COMPLETED" } },
    });
    expect(visibleOpen).toHaveLength(1);
    expect(visibleOpen[0]!.id).toBe(result.capId);

    // Sibling AlertAction row also created (dual-create).
    const action = await db.alertAction.findUnique({
      where: { id: result.actionId },
    });
    expect(action).not.toBeNull();
    expect(action?.alertId).toBe(alert.id);
  });

  it("re-clicking is idempotent at the action layer", async () => {
    const { alert, user } = await seedAlert("e2e-idempotent");
    globalThis.__capFromAlertTestUser = {
      id: user.id,
      email: user.email,
      firebaseUid: user.firebaseUid,
    };

    const { addAlertToCapAction } = await import(
      "@/app/(dashboard)/audit/regulatory/actions"
    );

    const r1 = await addAlertToCapAction({
      alertId: alert.id,
      description: "First click",
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("expected ok");

    const r2 = await addAlertToCapAction({
      alertId: alert.id,
      description: "Second click — same alert",
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("expected ok");

    // Same CAP is reused — no new row created.
    expect(r2.capId).toBe(r1.capId);

    const caps = await db.correctiveAction.findMany({
      where: { sourceAlertId: alert.id },
    });
    expect(caps).toHaveLength(1);
  });

  it("rejects an authenticated caller using a cross-tenant alertId", async () => {
    const a = await seedAlert("e2e-cross-a");
    const b = await seedAlert("e2e-cross-b");

    // Mock auth to return practice A's owner.
    globalThis.__capFromAlertTestUser = {
      id: a.user.id,
      email: a.user.email,
      firebaseUid: a.user.firebaseUid,
    };

    const { addAlertToCapAction } = await import(
      "@/app/(dashboard)/audit/regulatory/actions"
    );

    // Try to add practice B's alert to a CAP — the action resolves
    // requireRole against practice A (the only practice the caller
    // belongs to), then alertMutations.assertAlertOwnedByPractice
    // refuses the cross-tenant write.
    const result = await addAlertToCapAction({
      alertId: b.alert.id,
      description: "Should fail — cross-tenant",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error).toMatch(/cross-tenant/i);

    // Confirm no CAP nor AlertAction was written for either practice.
    const capsForA = await db.correctiveAction.findMany({
      where: { practiceId: a.practice.id },
    });
    expect(capsForA).toHaveLength(0);
    const capsForB = await db.correctiveAction.findMany({
      where: { practiceId: b.practice.id },
    });
    expect(capsForB).toHaveLength(0);
    const actionsForB = await db.alertAction.findMany({
      where: { alertId: b.alert.id },
    });
    expect(actionsForB).toHaveLength(0);
  });

  it("rejects an unauthenticated caller with an Unauthorized error", async () => {
    const { alert } = await seedAlert("e2e-unauth");
    // Do NOT set __capFromAlertTestUser — leave null.

    const { addAlertToCapAction } = await import(
      "@/app/(dashboard)/audit/regulatory/actions"
    );

    const result = await addAlertToCapAction({
      alertId: alert.id,
      description: "Should fail — no auth",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error).toMatch(/unauthorized/i);
  });
});
