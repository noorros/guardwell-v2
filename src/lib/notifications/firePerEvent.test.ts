// src/lib/notifications/firePerEvent.test.ts
//
// Phase 7 PR 5 — coverage for the immediate-fire notification helper.
// Real DB. Each test seeds its own User + Practice + PracticeUser.
//
// The shared tests/setup.ts wipes Notification rows via the User cascade
// (Notification.user has onDelete: Cascade), so we don't need an explicit
// notification.deleteMany() between tests.
//
// Email mocking: tests/setup.ts unsets RESEND_API_KEY, which routes
// sendEmail through the no-op-success branch (returns delivered: false).
// We test "email attempted" via emailAttempted on the FireResult and the
// sentViaEmailAt column, NOT via observing actual provider calls.

import { describe, it, expect, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { firePerEventNotification } from "./firePerEvent";

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedUserAndPractice(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `fpe-${Math.random().toString(36).slice(2, 10)}`,
      email: `fpe-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `FirePerEvent Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedUserWithoutEmail(practiceId: string, label: string) {
  // Schema requires email to be non-null + unique. Use the "no email"
  // case via a separate seed that uses an empty string, which the
  // helper treats as "no email" (`!user?.email` → falsy on "").
  const user = await db.user.create({
    data: {
      firebaseUid: `fpe-noemail-${Math.random().toString(36).slice(2, 10)}`,
      email: `fpe-noemail-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "NoEmail",
      lastName: label,
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "ADMIN" },
  });
  // Force the email to empty AFTER creation (schema unique constraint
  // on a unique-empty-string is fine for one row at a time; tests/setup
  // wipes after each test).
  await db.user.update({
    where: { id: user.id },
    data: { email: "" },
  });
  return user;
}

describe("firePerEventNotification", () => {
  it("inserts a new Notification row and returns its id when first fired", async () => {
    const { user, practice } = await seedUserAndPractice("first-fire");
    const result = await firePerEventNotification({
      practiceId: practice.id,
      userId: user.id,
      type: "SUBSCRIPTION_PAST_DUE",
      severity: "CRITICAL",
      title: "Card declined",
      body: "Update your payment method.",
      href: "/settings/subscription",
      entityKey: "subscription-past-due:in_test_1",
      sendImmediately: false,
    });

    expect(result.notificationId).not.toBeNull();
    expect(result.emailAttempted).toBe(false);
    expect(result.emailDelivered).toBe(false);

    const row = await db.notification.findUnique({
      where: { id: result.notificationId! },
    });
    expect(row).toBeTruthy();
    expect(row?.type).toBe("SUBSCRIPTION_PAST_DUE");
    expect(row?.severity).toBe("CRITICAL");
    expect(row?.entityKey).toBe("subscription-past-due:in_test_1");
    expect(row?.sentViaEmailAt).toBeNull();
  });

  it("dedups on (userId, type, entityKey) — second fire returns null id and does not insert", async () => {
    const { user, practice } = await seedUserAndPractice("dedup");
    const args = {
      practiceId: practice.id,
      userId: user.id,
      type: "SUBSCRIPTION_PAST_DUE" as const,
      severity: "CRITICAL" as const,
      title: "Card declined",
      body: "Update your payment method.",
      href: "/settings/subscription",
      entityKey: "subscription-past-due:in_dup",
      sendImmediately: false,
    };

    const first = await firePerEventNotification(args);
    expect(first.notificationId).not.toBeNull();

    // Force the createdAt back > 5 seconds so the helper's
    // "isNew" detection treats the second call as a replay.
    await db.notification.update({
      where: { id: first.notificationId! },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    const second = await firePerEventNotification(args);
    expect(second.notificationId).toBeNull();
    expect(second.emailAttempted).toBe(false);

    const count = await db.notification.count({
      where: {
        userId: user.id,
        type: "SUBSCRIPTION_PAST_DUE",
        entityKey: "subscription-past-due:in_dup",
      },
    });
    expect(count).toBe(1);
  });

  it("does NOT attempt email when sendImmediately is false (default)", async () => {
    const { user, practice } = await seedUserAndPractice("no-send");
    const result = await firePerEventNotification({
      practiceId: practice.id,
      userId: user.id,
      type: "SUBSCRIPTION_CANCELED",
      severity: "WARNING",
      title: "Subscription canceled",
      body: "Re-subscribe at /settings/subscription.",
      href: "/settings/subscription",
      entityKey: "subscription-canceled:sub_test_2",
      // sendImmediately omitted
    });

    expect(result.notificationId).not.toBeNull();
    expect(result.emailAttempted).toBe(false);
    expect(result.emailDelivered).toBe(false);

    const row = await db.notification.findUnique({
      where: { id: result.notificationId! },
    });
    expect(row?.sentViaEmailAt).toBeNull();
  });

  it("attempts email when sendImmediately is true and stamps sentViaEmailAt on delivered:true", async () => {
    // Mock sendEmail to return delivered: true so we hit the
    // post-success update path. The setup file unsets RESEND_API_KEY
    // which makes the real implementation return delivered: false; we
    // override that here to exercise the success branch.
    const sendModule = await import("@/lib/email/send");
    vi.spyOn(sendModule, "sendEmail").mockResolvedValue({
      delivered: true,
      providerId: "test_provider_id",
    });

    const { user, practice } = await seedUserAndPractice("send-ok");
    const result = await firePerEventNotification({
      practiceId: practice.id,
      userId: user.id,
      type: "SUBSCRIPTION_BILLING_ISSUE",
      severity: "WARNING",
      title: "Repeated billing failures",
      body: "Update your payment method.",
      href: "/settings/subscription",
      entityKey: "subscription-billing-issue:in_test_3",
      sendImmediately: true,
    });

    expect(result.notificationId).not.toBeNull();
    expect(result.emailAttempted).toBe(true);
    expect(result.emailDelivered).toBe(true);

    const row = await db.notification.findUnique({
      where: { id: result.notificationId! },
    });
    expect(row?.sentViaEmailAt).toBeInstanceOf(Date);
  });

  it("does NOT attempt email when the user has no email address", async () => {
    const { practice } = await seedUserAndPractice("no-email-host");
    const noEmailUser = await seedUserWithoutEmail(practice.id, "noaddr");

    const result = await firePerEventNotification({
      practiceId: practice.id,
      userId: noEmailUser.id,
      type: "SUBSCRIPTION_PAST_DUE",
      severity: "CRITICAL",
      title: "Card declined",
      body: "Update your payment method.",
      href: "/settings/subscription",
      entityKey: "subscription-past-due:in_noemail",
      sendImmediately: true,
    });

    expect(result.notificationId).not.toBeNull();
    expect(result.emailAttempted).toBe(false);
    expect(result.emailDelivered).toBe(false);

    const row = await db.notification.findUnique({
      where: { id: result.notificationId! },
    });
    expect(row?.sentViaEmailAt).toBeNull();
  });
});
