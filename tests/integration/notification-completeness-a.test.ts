// tests/integration/notification-completeness-a.test.ts
//
// Phase A coverage for chunk 8 launch readiness — five new
// domain-scan notification generators:
//   - POLICY_REVIEW_DUE
//   - TRAINING_OVERDUE
//   - CMS_ENROLLMENT_EXPIRING
//   - BREACH_DETERMINATION_DEADLINE_APPROACHING
//   - OSHA_POSTING_REMINDER
//
// Each describe block tests the generator in isolation: a happy-path
// proposal at the right milestone/state, plus a negative case (out-of-
// window, already resolved, framework not enabled, etc.) that emits
// nothing. Closes with a single end-to-end dedup test running the full
// runNotificationDigest twice.
//
// Mirrors the seeding + assertion shape from
// tests/integration/credential-renewal-reminders.test.ts.

import { afterEach, describe, it, expect, vi } from "vitest";
import { db } from "@/lib/db";
import {
  generatePolicyReviewDueNotifications,
  generateTrainingOverdueNotifications,
  generateCmsEnrollmentNotifications,
  generateBreachDeterminationDeadlineNotifications,
  generateOshaPostingReminderNotifications,
} from "@/lib/notifications/generators";
import { runNotificationDigest } from "@/lib/notifications/run-digest";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `notif-a-${Math.random().toString(36).slice(2, 10)}`,
      email: `notif-a-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Test",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `Notif-A Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedAdditionalAdmin(practiceId: string, label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `notif-a-admin-${Math.random().toString(36).slice(2, 10)}`,
      email: `notif-a-admin-${Math.random().toString(36).slice(2, 8)}@test.test`,
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
      firebaseUid: `notif-a-staff-${Math.random().toString(36).slice(2, 10)}`,
      email: `notif-a-staff-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Staff",
      lastName: label,
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "STAFF" },
  });
  return user;
}

async function seedCredentialType(code: string, name: string): Promise<string> {
  const t = await db.credentialType.upsert({
    where: { code },
    update: { name },
    create: { code, name, category: "MEDICARE_MEDICAID" },
  });
  return t.id;
}

async function seedTrainingCourse(label: string) {
  return db.trainingCourse.create({
    data: {
      code: `T_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: `Training ${label}`,
      type: "HIPAA",
      lessonContent: "Test lesson",
    },
  });
}

async function seedOshaFramework(): Promise<string> {
  const fw = await db.regulatoryFramework.upsert({
    where: { code: "OSHA" },
    update: {},
    create: {
      code: "OSHA",
      name: "OSHA",
      description: "test",
      sortOrder: 20,
    },
  });
  return fw.id;
}

// -------------------------------------------------------------------------
// POLICY_REVIEW_DUE
// -------------------------------------------------------------------------

describe("generatePolicyReviewDueNotifications", () => {
  it("fires the 30-day milestone for a policy whose next annual review is 30 days out", async () => {
    const { user, practice } = await seedPracticeWithOwner("policy-30d");
    // lastReviewedAt is 365-30 days ago → due in ~30 days.
    const lastReviewedAt = new Date(
      // +1h shifts dueDate forward, so daysUntil floors to 30 (not 29) at
      // call time. Without the buffer, ms elapsed between create() and
      // daysUntil() would push Math.floor down to 29 — outside the
      // (m=30, days <= m && days > m - 1) window.
      Date.now() - (365 - 30) * DAY_MS + 60 * 60 * 1000,
    );
    const policy = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        lastReviewedAt,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyReviewDueNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("POLICY_REVIEW_DUE");
    expect(p.severity).toBe("INFO");
    expect(p.entityKey).toBe(`policy:${policy.id}:milestone:30`);
    expect(p.userId).toBe(user.id);
    expect(p.href).toBe(`/policies/${policy.id}`);
    expect(p.title).toContain("HIPAA_PRIVACY_POLICY");
  });

  it("emits no proposal when the policy review is already overdue", async () => {
    const { user, practice } = await seedPracticeWithOwner("policy-overdue");
    // 400 days ago — already past the 365-day window.
    const lastReviewedAt = new Date(Date.now() - 400 * DAY_MS);
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        lastReviewedAt,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyReviewDueNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits no proposal between milestones (e.g. 45 days out)", async () => {
    const { user, practice } = await seedPracticeWithOwner("policy-45d");
    // 320 days ago → due in 45 days; 60 has already fired, 30 not yet.
    const lastReviewedAt = new Date(Date.now() - 320 * DAY_MS - 60 * 60 * 1000);
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        lastReviewedAt,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyReviewDueNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    expect(proposals).toHaveLength(0);
  });

  it("fires for OWNER + ADMIN but not STAFF", async () => {
    const { practice, user: owner } = await seedPracticeWithOwner("policy-admin");
    const admin = await seedAdditionalAdmin(practice.id, "policy");
    const staff = await seedStaff(practice.id, "policy");

    const lastReviewedAt = new Date(
      // +1h shifts dueDate forward, so daysUntil floors to 30 (not 29) at
      // call time. Without the buffer, ms elapsed between create() and
      // daysUntil() would push Math.floor down to 29 — outside the
      // (m=30, days <= m && days > m - 1) window.
      Date.now() - (365 - 30) * DAY_MS + 60 * 60 * 1000,
    );
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_SECURITY_POLICY",
        lastReviewedAt,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyReviewDueNotifications(tx, practice.id, [
        owner.id,
        admin.id,
        staff.id,
      ], "UTC", null),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(admin.id)).toBe(true);
    expect(recipientIds.has(staff.id)).toBe(false);
  });

  it("skips retired policies", async () => {
    const { user, practice } = await seedPracticeWithOwner("policy-retired");
    const lastReviewedAt = new Date(
      // +1h shifts dueDate forward, so daysUntil floors to 30 (not 29) at
      // call time. Without the buffer, ms elapsed between create() and
      // daysUntil() would push Math.floor down to 29 — outside the
      // (m=30, days <= m && days > m - 1) window.
      Date.now() - (365 - 30) * DAY_MS + 60 * 60 * 1000,
    );
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_RETIRED_POLICY",
        lastReviewedAt,
        retiredAt: new Date(),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyReviewDueNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    expect(proposals).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// TRAINING_OVERDUE
// -------------------------------------------------------------------------

describe("generateTrainingOverdueNotifications", () => {
  it("emits a proposal for a completion expired ≥ 90 days ago with no newer pass", async () => {
    const { user, practice } = await seedPracticeWithOwner("train-overdue");
    const course = await seedTrainingCourse("HIPAA Basics");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 91) * DAY_MS),
        expiresAt: new Date(Date.now() - 91 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("TRAINING_OVERDUE");
    expect(p.severity).toBe("INFO");
    expect(p.userId).toBe(user.id);
    expect(p.entityKey).toBe(`training-completion:${completion.id}`);
    expect(p.href).toBe(`/training/${course.id}`);
    expect(p.title).toContain("HIPAA Basics");
  });

  it("suppresses proposal when a newer passing completion exists", async () => {
    const { user, practice } = await seedPracticeWithOwner("train-fresh-pass");
    const course = await seedTrainingCourse("OSHA Basics");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 91) * DAY_MS),
        expiresAt: new Date(Date.now() - 91 * DAY_MS),
      },
    });
    // Newer pass — completion expires in the future.
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 90,
        passed: true,
        completedAt: new Date(Date.now() - 30 * DAY_MS),
        expiresAt: new Date(Date.now() + 335 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing when expiry was 80 days ago (under 90-day grace)", async () => {
    const { user, practice } = await seedPracticeWithOwner("train-grace");
    const course = await seedTrainingCourse("BBP Refresher");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 80) * DAY_MS),
        expiresAt: new Date(Date.now() - 80 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("targets the staff member, not admins", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("train-staff");
    const staff = await seedStaff(practice.id, "alice");
    const course = await seedTrainingCourse("Privacy 101");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 91) * DAY_MS),
        expiresAt: new Date(Date.now() - 91 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.userId).toBe(staff.id);
  });
});

// -------------------------------------------------------------------------
// CMS_ENROLLMENT_EXPIRING
// -------------------------------------------------------------------------

describe("generateCmsEnrollmentNotifications", () => {
  it("fires every milestone we're inside of for a Medicare PECOS credential 30 days out", async () => {
    const { user, practice } = await seedPracticeWithOwner("cms-pecos");
    const ctId = await seedCredentialType(
      "MEDICARE_PECOS_ENROLLMENT",
      "Medicare PECOS",
    );
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        title: "Practice Medicare PECOS",
        expiryDate: new Date(Date.now() + 30 * DAY_MS + 60 * 60 * 1000),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCmsEnrollmentNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    // Audit #21 IM-7: fires for every milestone in [90, 60, 30, 7] where
    // days <= m. With days=30, that's 90, 60, 30 (three proposals).
    expect(proposals).toHaveLength(3);
    expect(proposals.map((p) => p.entityKey).sort()).toEqual(
      [
        `cms-enrollment:${cred.id}:milestone:30`,
        `cms-enrollment:${cred.id}:milestone:60`,
        `cms-enrollment:${cred.id}:milestone:90`,
      ].sort(),
    );
    for (const p of proposals) {
      expect(p.type).toBe("CMS_ENROLLMENT_EXPIRING");
      expect(p.severity).toBe("INFO");
      expect(p.userId).toBe(user.id);
      expect(p.title).toContain("PECOS");
      expect(p.body).toContain("PECOS");
    }
  });

  it("emits nothing for a non-CMS credential expiring in the same window", async () => {
    const { user, practice } = await seedPracticeWithOwner("cms-non");
    const ctId = await seedCredentialType(
      `NON_CMS_${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      "MD State License",
    );
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        title: "Dr. Smith MD License",
        expiryDate: new Date(Date.now() + 30 * DAY_MS + 60 * 60 * 1000),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCmsEnrollmentNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits proposals for the Medicare provider enrollment code variant", async () => {
    const { user, practice } = await seedPracticeWithOwner("cms-provider");
    const ctId = await seedCredentialType(
      "MEDICARE_PROVIDER_ENROLLMENT",
      "Medicare Provider Enrollment",
    );
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        title: "Practice Medicare Provider Enrollment",
        expiryDate: new Date(Date.now() + 60 * DAY_MS + 60 * 60 * 1000),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCmsEnrollmentNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    // Audit #21 IM-7: 60 days out → milestones 90 and 60 fire.
    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(p.title).toContain("provider");
    }
  });

  it("respects reminderConfig.enabled = false", async () => {
    const { user, practice } = await seedPracticeWithOwner("cms-disabled");
    const ctId = await seedCredentialType(
      "MEDICARE_PECOS_ENROLLMENT",
      "Medicare PECOS",
    );
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        title: "Disabled-reminder PECOS",
        expiryDate: new Date(Date.now() + 30 * DAY_MS + 60 * 60 * 1000),
      },
    });
    await db.credentialReminderConfig.create({
      data: {
        practiceId: practice.id,
        credentialId: cred.id,
        enabled: false,
        milestoneDays: [90, 60, 30, 7],
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCmsEnrollmentNotifications(tx, practice.id, [user.id], "UTC", null),
    );

    expect(proposals).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// BREACH_DETERMINATION_DEADLINE_APPROACHING
// -------------------------------------------------------------------------

describe("generateBreachDeterminationDeadlineNotifications", () => {
  it("emits proposal when discovered 51 days ago and breach-determination wizard hasn't run", async () => {
    const { user, practice } = await seedPracticeWithOwner("breach-51d");
    const incident = await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Stolen laptop",
        description: "Laptop with PHI taken from office",
        type: "PRIVACY",
        severity: "HIGH",
        status: "OPEN",
        // isBreach: null = wizard hasn't run yet. Setting any value here would
        // be unrealistic — projection wires both isBreach and breachDeterminedAt
        // atomically when the wizard runs.
        phiInvolved: true,
        discoveredAt: new Date(Date.now() - 51 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBreachDeterminationDeadlineNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("BREACH_DETERMINATION_DEADLINE_APPROACHING");
    expect(p.severity).toBe("WARNING");
    expect(p.entityKey).toBe(`breach-deadline:${incident.id}`);
    expect(p.userId).toBe(user.id);
    expect(p.href).toBe(`/incidents/${incident.id}`);
    expect(p.title).toContain("9 days");
  });

  it("emits nothing once the determination wizard has run (isBreach + breachDeterminedAt set)", async () => {
    const { user, practice } = await seedPracticeWithOwner("breach-determined");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Already-determined breach",
        description: "Determination wizard already completed",
        type: "PRIVACY",
        severity: "HIGH",
        status: "UNDER_INVESTIGATION",
        // Wizard ran: isBreach + breachDeterminedAt set atomically.
        isBreach: true,
        affectedCount: 50,
        phiInvolved: true,
        discoveredAt: new Date(Date.now() - 51 * DAY_MS),
        breachDeterminedAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBreachDeterminationDeadlineNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing for an incident discovered 30 days ago (still inside the 50-day pre-window)", async () => {
    const { user, practice } = await seedPracticeWithOwner("breach-30d");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Recent incident",
        description: "Plenty of time left, wizard not yet run",
        type: "PRIVACY",
        severity: "MEDIUM",
        status: "OPEN",
        phiInvolved: true,
        discoveredAt: new Date(Date.now() - 30 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBreachDeterminationDeadlineNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing for an incident past the 60-day window (not the reminder generator's job)", async () => {
    const { user, practice } = await seedPracticeWithOwner("breach-past");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Long-stale incident",
        description: "Past the reminder window, wizard never ran",
        type: "PRIVACY",
        severity: "MEDIUM",
        status: "OPEN",
        phiInvolved: true,
        discoveredAt: new Date(Date.now() - 65 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBreachDeterminationDeadlineNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing when wizard determined not a breach (isBreach=false)", async () => {
    const { user, practice } = await seedPracticeWithOwner("breach-not-breach");
    await db.incident.create({
      data: {
        practiceId: practice.id,
        reportedByUserId: user.id,
        title: "Not a breach",
        description: "Wizard ran, determined no breach",
        type: "PRIVACY",
        severity: "LOW",
        status: "UNDER_INVESTIGATION",
        // Wizard ran: isBreach=false set together with breachDeterminedAt.
        isBreach: false,
        phiInvolved: true,
        discoveredAt: new Date(Date.now() - 51 * DAY_MS),
        breachDeterminedAt: new Date(Date.now() - 2 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateBreachDeterminationDeadlineNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// OSHA_POSTING_REMINDER
// -------------------------------------------------------------------------

describe("generateOshaPostingReminderNotifications", () => {
  it("emits a proposal when today is Jan 20 and OSHA framework is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-20T12:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("osha-jan");
    const fwId = await seedOshaFramework();
    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: fwId,
        enabled: true,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateOshaPostingReminderNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("OSHA_POSTING_REMINDER");
    expect(p.severity).toBe("INFO");
    expect(p.entityKey).toBe("osha-posting:2026");
    expect(p.userId).toBe(user.id);
    expect(p.href).toBe("/audit/reports");
    expect(p.title).toContain("OSHA 300A");
  });

  it("emits a proposal on the Feb 1 boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("osha-feb1");
    const fwId = await seedOshaFramework();
    await db.practiceFramework.create({
      data: { practiceId: practice.id, frameworkId: fwId, enabled: true },
    });

    const proposals = await db.$transaction((tx) =>
      generateOshaPostingReminderNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
  });

  it("emits nothing on March 1 (outside the Jan 15 – Feb 1 window)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("osha-mar");
    const fwId = await seedOshaFramework();
    await db.practiceFramework.create({
      data: { practiceId: practice.id, frameworkId: fwId, enabled: true },
    });

    const proposals = await db.$transaction((tx) =>
      generateOshaPostingReminderNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing on Jan 14 (one day before the window opens)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-14T12:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("osha-jan14");
    const fwId = await seedOshaFramework();
    await db.practiceFramework.create({
      data: { practiceId: practice.id, frameworkId: fwId, enabled: true },
    });

    const proposals = await db.$transaction((tx) =>
      generateOshaPostingReminderNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing when OSHA framework is not enabled (even inside window)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-20T12:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("osha-disabled");
    // No PracticeFramework row at all = framework not enabled.
    const proposals = await db.$transaction((tx) =>
      generateOshaPostingReminderNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing when OSHA framework exists but enabled=false", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-20T12:00:00Z"));

    const { user, practice } = await seedPracticeWithOwner("osha-flag-off");
    const fwId = await seedOshaFramework();
    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: fwId,
        enabled: false,
        disabledAt: new Date(),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateOshaPostingReminderNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// End-to-end dedup — runNotificationDigest twice should produce one row.
// -------------------------------------------------------------------------

describe("end-to-end dedup for Phase A generators", () => {
  it("running runNotificationDigest twice for POLICY_REVIEW_DUE produces a single row", async () => {
    const { user, practice } = await seedPracticeWithOwner("dedup-policy");
    const lastReviewedAt = new Date(
      // +1h shifts dueDate forward, so daysUntil floors to 30 (not 29) at
      // call time. Without the buffer, ms elapsed between create() and
      // daysUntil() would push Math.floor down to 29 — outside the
      // (m=30, days <= m && days > m - 1) window.
      Date.now() - (365 - 30) * DAY_MS + 60 * 60 * 1000,
    );
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        lastReviewedAt,
      },
    });
    // SRA already on file so we don't get an SRA_DUE nudge for this user.
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: user.id,
        completedAt: new Date(),
        overallScore: 100,
        addressedCount: 20,
        totalCount: 20,
        isDraft: false,
      },
    });

    await runNotificationDigest();
    await runNotificationDigest();

    const policyNotes = await db.notification.findMany({
      where: { userId: user.id, type: "POLICY_REVIEW_DUE" },
    });
    expect(policyNotes).toHaveLength(1);
    const note = policyNotes[0];
    if (!note) throw new Error("expected one notification");
    expect(note.practiceId).toBe(practice.id);
  });
});
