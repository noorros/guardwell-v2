// tests/integration/stripe-webhook-notifications.test.ts
//
// Phase 7 PR 5 — coverage for the new immediate-notification path in the
// Stripe webhook handler. The handler ALREADY appends events through
// appendEventAndApply (idempotent via Stripe event id); this test
// covers the SECOND idempotency layer (firePerEventNotification's
// (userId, type, entityKey) dedup) and verifies the recipient is
// scoped to OWNER + ADMIN.
//
// Strategy: mock the Stripe SDK's signature verification + getStripe
// and POST a crafted event payload at the route handler. Real DB +
// real Notification insertions on the firePerEvent path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Stripe mocking — must be hoisted before the route module loads.
// ---------------------------------------------------------------------------
//
// We stub:
//   verifyWebhook(rawBody, sig)        → returns whatever the test set
//   getStripe()                        → never reached for invoice /
//                                        subscription events; the
//                                        checkout flow does call it but
//                                        we don't exercise checkout in
//                                        these notification tests.
//
// pendingEvent is the closure handle the test mutates per-case.

let pendingEvent: Stripe.Event | null = null;

vi.mock("@/lib/stripe", () => ({
  verifyWebhook: (_raw: string, _sig: string) => {
    if (!pendingEvent) {
      throw new Error("test set no pendingEvent before posting");
    }
    return pendingEvent;
  },
  getStripe: () => {
    throw new Error("getStripe not expected in this test");
  },
}));

// Import AFTER the mock so the module under test resolves to the stub.
import { POST } from "@/app/api/stripe/webhook/route";

beforeEach(() => {
  pendingEvent = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `swh-${Math.random().toString(36).slice(2, 10)}`,
      email: `swh-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: {
      name: `Stripe-Webhook Test ${label}`,
      primaryState: "AZ",
      stripeCustomerId: `cus_${label}_${Math.random().toString(36).slice(2, 8)}`,
      stripeSubscriptionId: `sub_${label}_${Math.random().toString(36).slice(2, 8)}`,
      subscriptionStatus: "ACTIVE",
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedAdmin(practiceId: string, label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `swh-adm-${Math.random().toString(36).slice(2, 10)}`,
      email: `swh-adm-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Admin",
      lastName: label,
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "ADMIN" },
  });
  return user;
}

async function seedStaff(practiceId: string, label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `swh-staff-${Math.random().toString(36).slice(2, 10)}`,
      email: `swh-staff-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Staff",
      lastName: label,
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "STAFF" },
  });
  return user;
}

// ---------------------------------------------------------------------------
// Stripe event factories
// ---------------------------------------------------------------------------

function makeInvoicePaymentFailedEvent(opts: {
  eventId: string;
  invoiceId: string;
  stripeSubscriptionId: string;
  attemptCount: number;
}): Stripe.Event {
  return {
    id: opts.eventId,
    type: "invoice.payment_failed",
    object: "event",
    api_version: "2024-04-10",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: opts.invoiceId,
        object: "invoice",
        subscription: opts.stripeSubscriptionId,
        attempt_count: opts.attemptCount,
        period_end: Math.floor(Date.now() / 1000),
      } as unknown as Stripe.Invoice,
    },
  } as unknown as Stripe.Event;
}

function makeSubscriptionDeletedEvent(opts: {
  eventId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Stripe.Event {
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  return {
    id: opts.eventId,
    type: "customer.subscription.deleted",
    object: "event",
    api_version: "2024-04-10",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: opts.stripeSubscriptionId,
        object: "subscription",
        customer: opts.stripeCustomerId,
        status: "canceled",
        items: {
          object: "list",
          data: [
            {
              id: `si_${Math.random().toString(36).slice(2, 8)}`,
              current_period_end: periodEnd,
            },
          ],
        },
        current_period_end: periodEnd,
      } as unknown as Stripe.Subscription,
    },
  } as unknown as Stripe.Event;
}

async function postWebhook(): Promise<Response> {
  const req = new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test_signature" },
    body: "{}",
  });
  return POST(req);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Stripe webhook → immediate notifications", () => {
  it("invoice.payment_failed (attempt_count=1) fires SUBSCRIPTION_PAST_DUE for OWNER + ADMIN only", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("att1");
    const admin = await seedAdmin(practice.id, "att1");
    const staff = await seedStaff(practice.id, "att1");

    pendingEvent = makeInvoicePaymentFailedEvent({
      eventId: `evt_${Date.now()}_att1`,
      invoiceId: `in_${Date.now()}_att1`,
      stripeSubscriptionId: practice.stripeSubscriptionId!,
      attemptCount: 1,
    });
    const res = await postWebhook();
    expect(res.status).toBe(200);

    const pastDue = await db.notification.findMany({
      where: { practiceId: practice.id, type: "SUBSCRIPTION_PAST_DUE" },
    });
    expect(pastDue).toHaveLength(2);
    const recipients = new Set(pastDue.map((n) => n.userId));
    expect(recipients.has(owner.id)).toBe(true);
    expect(recipients.has(admin.id)).toBe(true);
    expect(recipients.has(staff.id)).toBe(false);
    for (const n of pastDue) {
      expect(n.severity).toBe("CRITICAL");
      expect(n.href).toBe("/settings/subscription");
      expect(n.title).toContain("Card declined");
    }

    // attempt_count=1 → BILLING_ISSUE NOT fired
    const billing = await db.notification.findMany({
      where: { practiceId: practice.id, type: "SUBSCRIPTION_BILLING_ISSUE" },
    });
    expect(billing).toHaveLength(0);
  });

  it("invoice.payment_failed (attempt_count=2) fires both PAST_DUE and BILLING_ISSUE", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("att2");
    const admin = await seedAdmin(practice.id, "att2");

    pendingEvent = makeInvoicePaymentFailedEvent({
      eventId: `evt_${Date.now()}_att2`,
      invoiceId: `in_${Date.now()}_att2`,
      stripeSubscriptionId: practice.stripeSubscriptionId!,
      attemptCount: 2,
    });
    const res = await postWebhook();
    expect(res.status).toBe(200);

    const pastDue = await db.notification.findMany({
      where: { practiceId: practice.id, type: "SUBSCRIPTION_PAST_DUE" },
    });
    expect(pastDue).toHaveLength(2);
    const billing = await db.notification.findMany({
      where: { practiceId: practice.id, type: "SUBSCRIPTION_BILLING_ISSUE" },
    });
    expect(billing).toHaveLength(2);
    const billingRecipients = new Set(billing.map((n) => n.userId));
    expect(billingRecipients.has(owner.id)).toBe(true);
    expect(billingRecipients.has(admin.id)).toBe(true);
    for (const n of billing) {
      expect(n.severity).toBe("WARNING");
      expect(n.href).toBe("/settings/subscription");
      expect(n.title).toContain("Repeated billing failures");
    }
  });

  it("customer.subscription.deleted fires SUBSCRIPTION_CANCELED for OWNER + ADMIN", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("cancel");
    const admin = await seedAdmin(practice.id, "cancel");
    const staff = await seedStaff(practice.id, "cancel");

    pendingEvent = makeSubscriptionDeletedEvent({
      eventId: `evt_${Date.now()}_cancel`,
      stripeCustomerId: practice.stripeCustomerId!,
      stripeSubscriptionId: practice.stripeSubscriptionId!,
    });
    const res = await postWebhook();
    expect(res.status).toBe(200);

    const canceled = await db.notification.findMany({
      where: { practiceId: practice.id, type: "SUBSCRIPTION_CANCELED" },
    });
    expect(canceled).toHaveLength(2);
    const recipients = new Set(canceled.map((n) => n.userId));
    expect(recipients.has(owner.id)).toBe(true);
    expect(recipients.has(admin.id)).toBe(true);
    expect(recipients.has(staff.id)).toBe(false);
    for (const n of canceled) {
      expect(n.severity).toBe("WARNING");
      expect(n.href).toBe("/settings/subscription");
    }
  });

  it("replay (same Stripe event id) does NOT duplicate notifications — entityKey dedup", async () => {
    const { practice } = await seedPracticeWithOwner("replay");

    const evt = makeInvoicePaymentFailedEvent({
      eventId: `evt_${Date.now()}_replay`,
      invoiceId: `in_${Date.now()}_replay`,
      stripeSubscriptionId: practice.stripeSubscriptionId!,
      attemptCount: 2,
    });

    pendingEvent = evt;
    const res1 = await postWebhook();
    expect(res1.status).toBe(200);

    pendingEvent = evt;
    const res2 = await postWebhook();
    expect(res2.status).toBe(200);

    const pastDue = await db.notification.findMany({
      where: { practiceId: practice.id, type: "SUBSCRIPTION_PAST_DUE" },
    });
    const billing = await db.notification.findMany({
      where: { practiceId: practice.id, type: "SUBSCRIPTION_BILLING_ISSUE" },
    });
    // 1 OWNER × 1 row of each type — replay must NOT double the count.
    expect(pastDue).toHaveLength(1);
    expect(billing).toHaveLength(1);
  });

  it("STAFF user does NOT receive any subscription notifications", async () => {
    const { practice } = await seedPracticeWithOwner("staff-only");
    const staff = await seedStaff(practice.id, "staff-only");

    pendingEvent = makeInvoicePaymentFailedEvent({
      eventId: `evt_${Date.now()}_stafo`,
      invoiceId: `in_${Date.now()}_stafo`,
      stripeSubscriptionId: practice.stripeSubscriptionId!,
      attemptCount: 2,
    });
    const res = await postWebhook();
    expect(res.status).toBe(200);

    const staffNotes = await db.notification.findMany({
      where: { userId: staff.id },
    });
    expect(staffNotes).toHaveLength(0);
  });
});
