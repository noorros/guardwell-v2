// src/lib/regulatory/alertMutations.test.ts
//
// Phase 8 PR 6 — coverage for the lib-helper layer that backs the
// regulatory UI server actions. Real DB. Each test seeds its own
// User + Practice + RegulatorySource + RegulatoryArticle + RegulatoryAlert.
//
// Cases:
//   1. acknowledgeAlert — happy path stamps acknowledgedAt + acknowledgedByUserId
//   2. acknowledgeAlert — cross-tenant throws "Cross-tenant access denied"
//   3. dismissAlert     — happy path stamps dismissedAt + dismissedByUserId
//   4. addAlertActionToAlert — creates a row + returns its id
//
// toggleSourceActive is a 1-liner without practiceId scoping; the
// server-action test (Step 6.5) covers the OWNER auth wrapper.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import {
  acknowledgeAlert,
  dismissAlert,
  addAlertActionToAlert,
} from "./alertMutations";

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedAlert(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: rid("am-uid"),
      email: `${rid("am")}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `AlertMutations Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
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

describe("acknowledgeAlert", () => {
  it("stamps acknowledgedAt + acknowledgedByUserId on the happy path", async () => {
    const { user, practice, alert } = await seedAlert("ack-happy");

    await acknowledgeAlert(alert.id, practice.id, user.id);

    const after = await db.regulatoryAlert.findUnique({
      where: { id: alert.id },
    });
    expect(after?.acknowledgedAt).toBeInstanceOf(Date);
    expect(after?.acknowledgedByUserId).toBe(user.id);
    // Dismiss fields are untouched.
    expect(after?.dismissedAt).toBeNull();
    expect(after?.dismissedByUserId).toBeNull();
  });

  it("throws 'Cross-tenant access denied' when practiceId mismatches the alert", async () => {
    const a = await seedAlert("ack-cross-a");
    const b = await seedAlert("ack-cross-b");

    await expect(
      acknowledgeAlert(b.alert.id, a.practice.id, a.user.id),
    ).rejects.toThrow(/Cross-tenant access denied/);

    // Confirm the target alert was NOT modified.
    const after = await db.regulatoryAlert.findUnique({
      where: { id: b.alert.id },
    });
    expect(after?.acknowledgedAt).toBeNull();
    expect(after?.acknowledgedByUserId).toBeNull();
  });
});

describe("dismissAlert", () => {
  it("stamps dismissedAt + dismissedByUserId on the happy path", async () => {
    const { user, practice, alert } = await seedAlert("dismiss-happy");

    await dismissAlert(alert.id, practice.id, user.id);

    const after = await db.regulatoryAlert.findUnique({
      where: { id: alert.id },
    });
    expect(after?.dismissedAt).toBeInstanceOf(Date);
    expect(after?.dismissedByUserId).toBe(user.id);
    // Acknowledge fields are untouched.
    expect(after?.acknowledgedAt).toBeNull();
    expect(after?.acknowledgedByUserId).toBeNull();
  });

  it("throws 'Cross-tenant access denied' when practiceId mismatches the alert", async () => {
    const a = await seedAlert("dismiss-cross-a");
    const b = await seedAlert("dismiss-cross-b");

    await expect(
      dismissAlert(b.alert.id, a.practice.id, a.user.id),
    ).rejects.toThrow(/Cross-tenant access denied/);

    const after = await db.regulatoryAlert.findUnique({
      where: { id: b.alert.id },
    });
    expect(after?.dismissedAt).toBeNull();
    expect(after?.dismissedByUserId).toBeNull();
  });
});

describe("addAlertActionToAlert", () => {
  it("throws 'Cross-tenant access denied' when practiceId mismatches the alert", async () => {
    const a = await seedAlert("action-cross-a");
    const b = await seedAlert("action-cross-b");

    await expect(
      addAlertActionToAlert(
        b.alert.id,
        a.practice.id,
        "Should not persist",
      ),
    ).rejects.toThrow(/Cross-tenant access denied/);

    const rows = await db.alertAction.findMany({
      where: { alertId: b.alert.id },
    });
    expect(rows).toHaveLength(0);
  });

  it("creates an AlertAction row and returns its id", async () => {
    const { user, practice, alert } = await seedAlert("action-create");

    const dueDate = new Date("2026-06-01T00:00:00.000Z");
    const result = await addAlertActionToAlert(
      alert.id,
      practice.id,
      "Review HIPAA Security Rule controls",
      { ownerUserId: user.id, dueDate },
    );

    expect(result.id).toBeTruthy();

    const row = await db.alertAction.findUnique({
      where: { id: result.id },
    });
    expect(row).not.toBeNull();
    expect(row?.alertId).toBe(alert.id);
    expect(row?.description).toBe("Review HIPAA Security Rule controls");
    expect(row?.ownerUserId).toBe(user.id);
    expect(row?.dueDate?.toISOString()).toBe(dueDate.toISOString());
    expect(row?.completionStatus).toBe("PENDING");
  });
});
