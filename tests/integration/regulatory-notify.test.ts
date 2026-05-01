// tests/integration/regulatory-notify.test.ts
//
// Phase 8 PR 5 — integration coverage for runRegulatoryNotify. Real DB
// for RegulatoryAlert + Notification + PracticeUser. No AI mocks needed
// (notify cron has no LLM seam). 5 cases:
//
//   1. Happy path: 1 alert, 2 admins → 2 Notifications + alert stamped.
//   2. No admins: alert exists but practice has only STAFF/VIEWER →
//      0 Notifications, alert.sentAt still stamped (don't re-scan).
//   3. Replay: run twice → second run is a no-op (skipDuplicates +
//      sentAt filter both gate it).
//   4. Dismissed alert: dismissedAt set → not picked up at all.
//   5. Severity mapping: INFO → INFO, ADVISORY → WARNING, URGENT →
//      CRITICAL.

import { describe, it, expect } from "vitest";

import { db } from "@/lib/db";
import { runRegulatoryNotify } from "@/lib/regulatory/runNotify";

async function seedSource() {
  return db.regulatorySource.create({
    data: {
      name: "Notify test source",
      url: `https://example.com/notify-${Math.random().toString(36).slice(2, 10)}.xml`,
      feedType: "RSS",
      isActive: true,
      defaultFrameworks: [],
    },
  });
}

async function seedArticle(opts: { sourceId: string; title?: string }) {
  return db.regulatoryArticle.create({
    data: {
      sourceId: opts.sourceId,
      title: opts.title ?? "Notify test article",
      url: `https://example.com/notify/${Math.random().toString(36).slice(2, 12)}`,
      summary: "Notify test summary",
      rawContent: "Notify test content",
      publishDate: new Date("2026-04-15T10:00:00Z"),
    },
  });
}

async function seedPractice(label: string) {
  return db.practice.create({
    data: { name: `Notify Test ${label}`, primaryState: "AZ" },
  });
}

async function seedUser(label: string) {
  const seed = `${label}-${Math.random().toString(36).slice(2, 8)}`;
  return db.user.create({
    data: {
      firebaseUid: `notify-${seed}`,
      email: `${seed}@notify.test`,
    },
  });
}

async function attachUser(opts: {
  userId: string;
  practiceId: string;
  role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER";
  removedAt?: Date | null;
}) {
  return db.practiceUser.create({
    data: {
      userId: opts.userId,
      practiceId: opts.practiceId,
      role: opts.role,
      removedAt: opts.removedAt ?? null,
    },
  });
}

async function seedAlert(opts: {
  practiceId: string;
  articleId: string;
  severity?: "INFO" | "ADVISORY" | "URGENT";
  alertBody?: string;
  dismissedAt?: Date | null;
}) {
  return db.regulatoryAlert.create({
    data: {
      practiceId: opts.practiceId,
      articleId: opts.articleId,
      alertBody: opts.alertBody ?? "AI-generated alert body",
      recommendedActions: ["Action 1", "Action 2"],
      severity: opts.severity ?? "ADVISORY",
      matchedFrameworks: ["HIPAA"],
      dismissedAt: opts.dismissedAt ?? null,
    },
  });
}

describe("runRegulatoryNotify", () => {
  it("creates one Notification per OWNER/ADMIN and stamps alert.sentAt (URGENT → CRITICAL)", async () => {
    const source = await seedSource();
    const article = await seedArticle({
      sourceId: source.id,
      title: "Urgent breach rule update",
    });
    const practice = await seedPractice("happy-path");
    const owner = await seedUser("owner");
    const admin = await seedUser("admin");
    const staff = await seedUser("staff");
    await attachUser({
      userId: owner.id,
      practiceId: practice.id,
      role: "OWNER",
    });
    await attachUser({
      userId: admin.id,
      practiceId: practice.id,
      role: "ADMIN",
    });
    // STAFF should NOT receive a notification.
    await attachUser({
      userId: staff.id,
      practiceId: practice.id,
      role: "STAFF",
    });
    const alert = await seedAlert({
      practiceId: practice.id,
      articleId: article.id,
      severity: "URGENT",
      alertBody: "Breach rule timing has tightened.",
    });

    const summary = await runRegulatoryNotify();

    expect(summary.alertsScanned).toBe(1);
    expect(summary.notificationsCreated).toBe(2);
    expect(summary.errors).toEqual([]);

    const notifications = await db.notification.findMany({
      where: { practiceId: practice.id, type: "REGULATORY_ALERT" },
      orderBy: { userId: "asc" },
    });
    expect(notifications).toHaveLength(2);
    const recipientIds = notifications.map((n) => n.userId).sort();
    expect(recipientIds).toEqual([owner.id, admin.id].sort());
    for (const n of notifications) {
      expect(n.severity).toBe("CRITICAL"); // URGENT → CRITICAL
      expect(n.title).toContain("Urgent breach rule update");
      expect(n.title).toMatch(/^Regulatory alert:/);
      expect(n.body).toBe("Breach rule timing has tightened.");
      expect(n.href).toBe(`/audit/regulatory/${alert.id}`);
      expect(n.entityKey).toBe(`regulatory-alert:${alert.id}:${n.userId}`);
    }

    const refreshedAlert = await db.regulatoryAlert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    expect(refreshedAlert.sentAt).not.toBeNull();
  });

  it("stamps sentAt even when the practice has no OWNER/ADMIN (so we don't re-scan)", async () => {
    const source = await seedSource();
    const article = await seedArticle({ sourceId: source.id });
    const practice = await seedPractice("no-admins");
    const staff = await seedUser("staff-only");
    const viewer = await seedUser("viewer-only");
    await attachUser({
      userId: staff.id,
      practiceId: practice.id,
      role: "STAFF",
    });
    await attachUser({
      userId: viewer.id,
      practiceId: practice.id,
      role: "VIEWER",
    });
    const alert = await seedAlert({
      practiceId: practice.id,
      articleId: article.id,
    });

    const summary = await runRegulatoryNotify();

    expect(summary.alertsScanned).toBe(1);
    expect(summary.notificationsCreated).toBe(0);
    expect(summary.errors).toEqual([]);

    const notifications = await db.notification.findMany({
      where: { practiceId: practice.id },
    });
    expect(notifications).toHaveLength(0);

    const refreshedAlert = await db.regulatoryAlert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    expect(refreshedAlert.sentAt).not.toBeNull();
  });

  it("is idempotent on replay (running twice does not duplicate notifications or alerts)", async () => {
    const source = await seedSource();
    const article = await seedArticle({ sourceId: source.id });
    const practice = await seedPractice("replay");
    const owner = await seedUser("replay-owner");
    const admin = await seedUser("replay-admin");
    await attachUser({
      userId: owner.id,
      practiceId: practice.id,
      role: "OWNER",
    });
    await attachUser({
      userId: admin.id,
      practiceId: practice.id,
      role: "ADMIN",
    });
    const alert = await seedAlert({
      practiceId: practice.id,
      articleId: article.id,
      severity: "ADVISORY",
    });

    const first = await runRegulatoryNotify();
    expect(first.alertsScanned).toBe(1);
    expect(first.notificationsCreated).toBe(2);
    expect(first.errors).toEqual([]);

    const sentAtAfterFirst = (
      await db.regulatoryAlert.findUniqueOrThrow({ where: { id: alert.id } })
    ).sentAt;
    expect(sentAtAfterFirst).not.toBeNull();

    const second = await runRegulatoryNotify();
    // sentAt filter excludes the already-sent alert from the second run.
    expect(second.alertsScanned).toBe(0);
    expect(second.notificationsCreated).toBe(0);
    expect(second.errors).toEqual([]);

    const allNotifications = await db.notification.findMany({
      where: { practiceId: practice.id, type: "REGULATORY_ALERT" },
    });
    expect(allNotifications).toHaveLength(2);

    // sentAt is from first run, not overwritten.
    const refreshedAlert = await db.regulatoryAlert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    expect(refreshedAlert.sentAt?.getTime()).toBe(sentAtAfterFirst!.getTime());
  });

  it("ignores dismissed alerts (does not scan, notify, or stamp)", async () => {
    const source = await seedSource();
    const article = await seedArticle({ sourceId: source.id });
    const practice = await seedPractice("dismissed");
    const owner = await seedUser("dismissed-owner");
    await attachUser({
      userId: owner.id,
      practiceId: practice.id,
      role: "OWNER",
    });
    const alert = await seedAlert({
      practiceId: practice.id,
      articleId: article.id,
      dismissedAt: new Date(),
    });

    const summary = await runRegulatoryNotify();

    expect(summary.alertsScanned).toBe(0);
    expect(summary.notificationsCreated).toBe(0);
    expect(summary.errors).toEqual([]);

    const notifications = await db.notification.findMany({
      where: { practiceId: practice.id },
    });
    expect(notifications).toHaveLength(0);

    const refreshedAlert = await db.regulatoryAlert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    // Dismissed alerts stay un-stamped (sentAt remains null) — they
    // don't need to be processed.
    expect(refreshedAlert.sentAt).toBeNull();
  });

  it("maps INFO/ADVISORY/URGENT to NotificationSeverity INFO/WARNING/CRITICAL", async () => {
    const source = await seedSource();
    const practice = await seedPractice("severity-mapping");
    const owner = await seedUser("sev-owner");
    await attachUser({
      userId: owner.id,
      practiceId: practice.id,
      role: "OWNER",
    });

    const infoArticle = await seedArticle({
      sourceId: source.id,
      title: "INFO article",
    });
    const advisoryArticle = await seedArticle({
      sourceId: source.id,
      title: "ADVISORY article",
    });
    const urgentArticle = await seedArticle({
      sourceId: source.id,
      title: "URGENT article",
    });

    const infoAlert = await seedAlert({
      practiceId: practice.id,
      articleId: infoArticle.id,
      severity: "INFO",
      alertBody: "info body",
    });
    const advisoryAlert = await seedAlert({
      practiceId: practice.id,
      articleId: advisoryArticle.id,
      severity: "ADVISORY",
      alertBody: "advisory body",
    });
    const urgentAlert = await seedAlert({
      practiceId: practice.id,
      articleId: urgentArticle.id,
      severity: "URGENT",
      alertBody: "urgent body",
    });

    const summary = await runRegulatoryNotify();

    expect(summary.alertsScanned).toBe(3);
    expect(summary.notificationsCreated).toBe(3);
    expect(summary.errors).toEqual([]);

    const notifications = await db.notification.findMany({
      where: { practiceId: practice.id, type: "REGULATORY_ALERT" },
    });
    expect(notifications).toHaveLength(3);

    const byEntityKey = new Map(
      notifications.map((n) => [n.entityKey, n] as const),
    );
    const infoNotification = byEntityKey.get(
      `regulatory-alert:${infoAlert.id}:${owner.id}`,
    );
    const advisoryNotification = byEntityKey.get(
      `regulatory-alert:${advisoryAlert.id}:${owner.id}`,
    );
    const urgentNotification = byEntityKey.get(
      `regulatory-alert:${urgentAlert.id}:${owner.id}`,
    );

    expect(infoNotification?.severity).toBe("INFO");
    expect(advisoryNotification?.severity).toBe("WARNING");
    expect(urgentNotification?.severity).toBe("CRITICAL");
  });
});
