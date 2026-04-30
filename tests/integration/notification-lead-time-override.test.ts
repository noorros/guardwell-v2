// tests/integration/notification-lead-time-override.test.ts
//
// Phase 7 PR 2 — regression coverage for per-practice lead-time overrides.
// Verifies that:
//   1. A Practice.reminderSettings override actually changes the milestone
//      schedule a generator fires against (not just stored, but consulted).
//   2. With no override, the global DEFAULT_LEAD_TIMES values still apply.
//   3. An empty array override falls through to defaults (defensive).
//   4. An override on one category does NOT bleed into other categories.
//   5. The 3 new categories (cmsEnrollment, trainingExpiring, policyReview)
//      are wired up end-to-end through getEffectiveLeadTimes.
//
// Inline seed pattern mirrors training-notifications.test.ts and
// credential-renewal-reminders.test.ts.

import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  generateCredentialRenewalNotifications,
  generateTrainingDueSoonNotifications,
  generateCmsEnrollmentNotifications,
  generateTrainingExpiringNotifications,
  generatePolicyReviewDueNotifications,
} from "@/lib/notifications/generators";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

async function seedPracticeWithOwner(
  label: string,
  reminderSettings?: unknown,
) {
  const user = await db.user.create({
    data: {
      firebaseUid: `lead-time-${Math.random().toString(36).slice(2, 10)}`,
      email: `lead-time-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: {
      name: `Lead-Time Test ${label}`,
      primaryState: "AZ",
      ...(reminderSettings !== undefined
        ? { reminderSettings: reminderSettings as object }
        : {}),
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedCredentialType(prefix: string) {
  const t = await db.credentialType.create({
    data: {
      code: `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `${prefix} test type`,
      category: "CLINICAL_LICENSE",
    },
  });
  return t.id;
}

async function seedCmsCredentialType(code: string, name: string) {
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
      code: `LT_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: `Lead-Time Training ${label}`,
      type: "HIPAA",
      lessonContent: "Test lesson",
    },
  });
}

// ---------------------------------------------------------------------------
// 1) Override applies — credential expiring in 95 days fires under [120, 90]
//    override but would NOT fire under default [90, 60, 30, 7].
// ---------------------------------------------------------------------------

describe("per-practice reminderSettings override", () => {
  it("override applies — credential 95 days out fires the 120 milestone (not default)", async () => {
    const { user, practice } = await seedPracticeWithOwner("override-apply", {
      credentials: [120, 90],
    });
    const credentialTypeId = await seedCredentialType("OVR");
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Override Cred",
        // 95d + 1h so daysUntil floors to 95.
        expiryDate: new Date(Date.now() + 95 * DAY_MS + HOUR_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialRenewalNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
        practice.reminderSettings,
      ),
    );

    // 95 days: matches 120 only (95<=120, 95>90). Exactly one milestone fires.
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.entityKey).toBe(`credential:${cred.id}:milestone:120`);
    expect(p.userId).toBe(user.id);
    expect(p.type).toBe("CREDENTIAL_RENEWAL_DUE");
  });

  it("default applies (no override) — credential 95 days out emits zero", async () => {
    const { user, practice } = await seedPracticeWithOwner("no-override");
    const credentialTypeId = await seedCredentialType("NOOVR");
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Default Cred",
        expiryDate: new Date(Date.now() + 95 * DAY_MS + HOUR_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialRenewalNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
        practice.reminderSettings,
      ),
    );

    // 95 > 90 (largest default milestone). Zero proposals.
    expect(proposals).toHaveLength(0);
  });

  it("empty override falls through to default — credential 95 days out emits zero", async () => {
    const { user, practice } = await seedPracticeWithOwner("empty-override", {
      credentials: [],
    });
    const credentialTypeId = await seedCredentialType("EMPTY");
    await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId,
        title: "Empty-Override Cred",
        expiryDate: new Date(Date.now() + 95 * DAY_MS + HOUR_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialRenewalNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
        practice.reminderSettings,
      ),
    );

    // Empty array → fallback to DEFAULT_LEAD_TIMES.credentials = [90,60,30,7].
    // 95 > 90 → zero proposals. (Same outcome as no-override case.)
    expect(proposals).toHaveLength(0);
  });

  it("per-category isolation — credentials override doesn't bleed into training", async () => {
    // Practice has a credentials override — but training should still use
    // the default [14, 7, 3, 1] schedule.
    const { user, practice } = await seedPracticeWithOwner("isolation", {
      credentials: [120, 90],
    });
    const course = await seedTrainingCourse("Isolation");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        // 10 days out → matches default training milestone 14 only.
        // If credentials override leaked, we'd fire on 120/90 (no match)
        // and produce zero. The assertion that ONE fires confirms isolation.
        dueDate: new Date(Date.now() + 10 * DAY_MS + HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingDueSoonNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
        practice.reminderSettings,
      ),
    );

    // Default training milestones: [14, 7, 3, 1]. days=10 → only m=14 fires.
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("TRAINING_DUE_SOON");
    expect(p.entityKey).toContain(":14");
  });

  // -------------------------------------------------------------------------
  // 5) Smoke tests — the 3 new categories actually flow through.
  // -------------------------------------------------------------------------

  it("cmsEnrollment override flows through to generateCmsEnrollmentNotifications", async () => {
    const { user, practice } = await seedPracticeWithOwner("cms-override", {
      cmsEnrollment: [180, 90],
    });
    const ctId = await seedCmsCredentialType(
      "MEDICARE_PECOS_ENROLLMENT",
      "Medicare PECOS",
    );
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        title: "PECOS Override",
        // 150 days → matches override 180 only (150<=180, 150>90).
        // Default [90,60,30,7] would emit zero (150 > 90).
        expiryDate: new Date(Date.now() + 150 * DAY_MS + HOUR_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCmsEnrollmentNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
        practice.reminderSettings,
      ),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.entityKey).toBe(`cms-enrollment:${cred.id}:milestone:180`);
    expect(p.type).toBe("CMS_ENROLLMENT_EXPIRING");
  });

  it("trainingExpiring override flows through to generateTrainingExpiringNotifications", async () => {
    const { user, practice } = await seedPracticeWithOwner("trainexp-override", {
      trainingExpiring: [60],
    });
    const course = await seedTrainingCourse("TrainExp Override");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 92,
        passed: true,
        completedAt: new Date(Date.now() - 305 * DAY_MS),
        // 45 days out → matches override 60 only.
        // Default [30,14,7] would emit zero (45 > 30).
        expiresAt: new Date(Date.now() + 45 * DAY_MS + HOUR_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingExpiringNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
        practice.reminderSettings,
      ),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.entityKey).toBe(`training-expiring:${completion.id}:60`);
    expect(p.type).toBe("TRAINING_EXPIRING");
  });

  it("policyReview override flows through to generatePolicyReviewDueNotifications", async () => {
    const { user, practice } = await seedPracticeWithOwner("policy-override", {
      policyReview: [120],
    });
    // lastReviewedAt = 365-120 days ago → due in ~120 days.
    // Default [90, 60, 30] would emit zero (120 > 90).
    const policy = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        lastReviewedAt: new Date(
          Date.now() - (365 - 120) * DAY_MS + HOUR_MS,
        ),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyReviewDueNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
        practice.reminderSettings,
      ),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.entityKey).toBe(`policy:${policy.id}:milestone:120`);
    expect(p.type).toBe("POLICY_REVIEW_DUE");
  });
});
