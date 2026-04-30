// tests/integration/training-notifications.test.ts
//
// Phase 4 PR 8 — coverage for the four assignment-driven training
// notification generators:
//   - generateTrainingAssignedNotifications      (TRAINING_ASSIGNED)
//   - generateTrainingDueSoonNotifications       (TRAINING_DUE_SOON)
//   - generateTrainingOverdueAssignmentNotifications (TRAINING_OVERDUE)
//   - generateTrainingExpiringNotifications      (TRAINING_EXPIRING)
//
// Each describe block tests the generator in isolation: happy path +
// negative cases (excluded user, revoked assignment, superseding pass,
// out-of-window). Closes with an end-to-end dedup test running
// runNotificationDigest twice. Mirrors the seed/assertion shape from
// tests/integration/notification-completeness-a.test.ts and
// tests/integration/credential-renewal-reminders.test.ts.

import { afterEach, describe, it, expect, vi } from "vitest";
import { db } from "@/lib/db";
import {
  generateTrainingAssignedNotifications,
  generateTrainingDueSoonNotifications,
  generateTrainingOverdueAssignmentNotifications,
  generateTrainingExpiringNotifications,
} from "@/lib/notifications/generators";
import { runNotificationDigest } from "@/lib/notifications/run-digest";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `train-notif-${Math.random().toString(36).slice(2, 10)}`,
      email: `train-notif-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `Train-Notif Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedStaff(practiceId: string, label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `train-notif-staff-${Math.random().toString(36).slice(2, 10)}`,
      email: `train-notif-staff-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Staff",
      lastName: label,
    },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "STAFF" },
  });
  return user;
}

async function seedTrainingCourse(label: string) {
  return db.trainingCourse.create({
    data: {
      code: `TN_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: `Training ${label}`,
      type: "HIPAA",
      lessonContent: "Test lesson",
    },
  });
}

// -------------------------------------------------------------------------
// generateTrainingAssignedNotifications
// -------------------------------------------------------------------------

describe("generateTrainingAssignedNotifications", () => {
  it("fires once per (assignment, user) for a single-user assignment", async () => {
    const { user, practice } = await seedPracticeWithOwner("assigned-direct");
    const course = await seedTrainingCourse("HIPAA Basics");
    const dueDate = new Date(Date.now() + 30 * DAY_MS);
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate,
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingAssignedNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("TRAINING_ASSIGNED");
    expect(p.severity).toBe("INFO");
    expect(p.userId).toBe(user.id);
    expect(p.entityKey).toBe(`training-assigned:${assignment.id}:${user.id}`);
    expect(p.href).toBe(`/programs/training/${course.id}`);
    expect(p.title).toContain("HIPAA Basics");
    expect(p.body).toContain("HIPAA Basics");
    expect(p.body).toContain("Due ");
  });

  it("fires for every STAFF user when assignedToRole=STAFF", async () => {
    const { practice, user: owner } = await seedPracticeWithOwner("assigned-role");
    const staffA = await seedStaff(practice.id, "alice");
    const staffB = await seedStaff(practice.id, "bob");
    const course = await seedTrainingCourse("OSHA Refresh");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        dueDate: new Date(Date.now() + 14 * DAY_MS),
        createdByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingAssignedNotifications(
        tx,
        practice.id,
        [owner.id, staffA.id, staffB.id],
        "UTC",
      ),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(staffA.id)).toBe(true);
    expect(recipientIds.has(staffB.id)).toBe(true);
    // Owner has role OWNER, doesn't match STAFF assignment.
    expect(recipientIds.has(owner.id)).toBe(false);
  });

  it("excluded user does NOT receive a proposal even when role-matched", async () => {
    const { practice, user: owner } = await seedPracticeWithOwner("assigned-excl");
    const staffA = await seedStaff(practice.id, "incl");
    const staffB = await seedStaff(practice.id, "excl");
    const course = await seedTrainingCourse("BBP");
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToRole: "STAFF",
        dueDate: new Date(Date.now() + 14 * DAY_MS),
        createdByUserId: owner.id,
      },
    });
    await db.assignmentExclusion.create({
      data: {
        assignmentId: assignment.id,
        userId: staffB.id,
        reason: "On leave",
        excludedByUserId: owner.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingAssignedNotifications(
        tx,
        practice.id,
        [owner.id, staffA.id, staffB.id],
        "UTC",
      ),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(staffA.id)).toBe(true);
    expect(recipientIds.has(staffB.id)).toBe(false);
  });

  it("revoked assignment emits nothing", async () => {
    const { user, practice } = await seedPracticeWithOwner("assigned-revoked");
    const course = await seedTrainingCourse("HIPAA Privacy");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        createdByUserId: user.id,
        revokedAt: new Date(),
        revokedByUserId: user.id,
        revokedReason: "No longer required",
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingAssignedNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("user with passing-non-expired completion does NOT receive a proposal", async () => {
    const { user, practice } = await seedPracticeWithOwner("assigned-already-done");
    const course = await seedTrainingCourse("HIPAA Done");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 95,
        passed: true,
        completedAt: new Date(Date.now() - 30 * DAY_MS),
        expiresAt: new Date(Date.now() + 335 * DAY_MS),
      },
    });
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingAssignedNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("body says 'No due date set.' when assignment has no dueDate", async () => {
    const { user, practice } = await seedPracticeWithOwner("assigned-no-due");
    const course = await seedTrainingCourse("Optional");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        // No dueDate.
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingAssignedNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.body).toContain("No due date set.");
  });
});

// -------------------------------------------------------------------------
// generateTrainingDueSoonNotifications
// -------------------------------------------------------------------------

describe("generateTrainingDueSoonNotifications", () => {
  it("fires for milestone 14 only when assignment is 10 days out", async () => {
    const { user, practice } = await seedPracticeWithOwner("dueSoon-10d");
    const course = await seedTrainingCourse("Due Soon 10d");
    // +1h buffer so Math.floor((10d+1h)/DAY_MS) = 10, not 9.
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() + 10 * DAY_MS + HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingDueSoonNotifications(tx, practice.id, [user.id], "UTC"),
    );

    // days=10 → matches m=14 only (10>7, 10>3, 10>1).
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("TRAINING_DUE_SOON");
    expect(p.severity).toBe("INFO");
    expect(p.entityKey).toBe(
      `training-due-soon:${assignment.id}:${user.id}:14`,
    );
    expect(p.userId).toBe(user.id);
    expect(p.href).toBe(`/programs/training/${course.id}`);
  });

  it("fires for 14, 7, and 3 milestones at days=2 (every milestone where days <= m)", async () => {
    const { user, practice } = await seedPracticeWithOwner("dueSoon-2d");
    const course = await seedTrainingCourse("Due Soon 2d");
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() + 2 * DAY_MS + HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingDueSoonNotifications(tx, practice.id, [user.id], "UTC"),
    );

    // days=2 → matches m=14, 7, 3 (not 1, since 2 > 1).
    expect(proposals).toHaveLength(3);
    expect(proposals.map((p) => p.entityKey).sort()).toEqual(
      [
        `training-due-soon:${assignment.id}:${user.id}:14`,
        `training-due-soon:${assignment.id}:${user.id}:7`,
        `training-due-soon:${assignment.id}:${user.id}:3`,
      ].sort(),
    );
    // Severity: m=3 is WARNING, m=7+ is INFO.
    const m3 = proposals.find((p) => p.entityKey?.endsWith(":3"));
    const m7 = proposals.find((p) => p.entityKey?.endsWith(":7"));
    const m14 = proposals.find((p) => p.entityKey?.endsWith(":14"));
    expect(m3?.severity).toBe("WARNING");
    expect(m7?.severity).toBe("INFO");
    expect(m14?.severity).toBe("INFO");
  });

  it("emits nothing for a past-due assignment (overdue generator handles)", async () => {
    const { user, practice } = await seedPracticeWithOwner("dueSoon-past");
    const course = await seedTrainingCourse("Already Past");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() - 1 * DAY_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingDueSoonNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing for an assignment 30 days out (outside the 14-day window)", async () => {
    const { user, practice } = await seedPracticeWithOwner("dueSoon-30d");
    const course = await seedTrainingCourse("Far Out");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() + 30 * DAY_MS + HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingDueSoonNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("user with passing-non-expired completion does NOT receive a proposal", async () => {
    const { user, practice } = await seedPracticeWithOwner("dueSoon-done");
    const course = await seedTrainingCourse("Already Done");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 95,
        passed: true,
        completedAt: new Date(Date.now() - 30 * DAY_MS),
        expiresAt: new Date(Date.now() + 335 * DAY_MS),
      },
    });
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingDueSoonNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// generateTrainingOverdueAssignmentNotifications
// -------------------------------------------------------------------------

describe("generateTrainingOverdueAssignmentNotifications", () => {
  it("fires at weekIndex=0 for an assignment 1 day past dueDate", async () => {
    const { user, practice } = await seedPracticeWithOwner("ovdAsn-1d");
    const course = await seedTrainingCourse("Ovd 1d");
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() - 1 * DAY_MS - HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueAssignmentNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("TRAINING_OVERDUE");
    expect(p.severity).toBe("WARNING");
    expect(p.entityKey).toBe(
      `training-overdue-assignment:${assignment.id}:${user.id}:0`,
    );
    expect(p.userId).toBe(user.id);
    expect(p.href).toBe(`/programs/training/${course.id}`);
    expect(p.title).toContain("overdue");
  });

  it("fires at weekIndex=1 for an assignment 8 days past dueDate", async () => {
    const { user, practice } = await seedPracticeWithOwner("ovdAsn-8d");
    const course = await seedTrainingCourse("Ovd 8d");
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() - 8 * DAY_MS - HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueAssignmentNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.entityKey).toBe(
      `training-overdue-assignment:${assignment.id}:${user.id}:1`,
    );
  });

  it("escalates to CRITICAL severity at weekIndex >= 4 (29+ days past due)", async () => {
    const { user, practice } = await seedPracticeWithOwner("ovdAsn-29d");
    const course = await seedTrainingCourse("Ovd 29d");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() - 29 * DAY_MS - HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueAssignmentNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.severity).toBe("CRITICAL");
    // weekIndex = floor(29/7) = 4
    expect(proposals[0]?.entityKey).toMatch(/:4$/);
  });

  it("revoked assignment emits nothing even when past due", async () => {
    const { user, practice } = await seedPracticeWithOwner("ovdAsn-revoked");
    const course = await seedTrainingCourse("Ovd Revoked");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() - 5 * DAY_MS),
        createdByUserId: user.id,
        revokedAt: new Date(),
        revokedByUserId: user.id,
        revokedReason: "removed",
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueAssignmentNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("user with passing-non-expired completion does NOT receive a proposal", async () => {
    const { user, practice } = await seedPracticeWithOwner("ovdAsn-done");
    const course = await seedTrainingCourse("Ovd Done");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 95,
        passed: true,
        completedAt: new Date(Date.now() - 30 * DAY_MS),
        expiresAt: new Date(Date.now() + 335 * DAY_MS),
      },
    });
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() - 5 * DAY_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueAssignmentNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing when assignment has no dueDate", async () => {
    const { user, practice } = await seedPracticeWithOwner("ovdAsn-no-due");
    const course = await seedTrainingCourse("Ovd No Due");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        // No dueDate.
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueAssignmentNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("entityKey is disjoint from generateTrainingOverdueNotifications (training-overdue-assignment: vs training-completion:)", async () => {
    const { user, practice } = await seedPracticeWithOwner("ovdAsn-disjoint");
    const course = await seedTrainingCourse("Disjoint");
    const assignment = await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() - 1 * DAY_MS - HOUR_MS),
        createdByUserId: user.id,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingOverdueAssignmentNotifications(
        tx,
        practice.id,
        [user.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.entityKey).toMatch(
      /^training-overdue-assignment:/,
    );
    expect(proposals[0]?.entityKey).not.toMatch(/^training-completion:/);
    // Sanity check the assignment id is embedded verbatim.
    expect(proposals[0]?.entityKey).toContain(assignment.id);
  });
});

// -------------------------------------------------------------------------
// generateTrainingExpiringNotifications
// -------------------------------------------------------------------------

describe("generateTrainingExpiringNotifications", () => {
  it("fires only milestone 30 for a completion expiring in 20 days", async () => {
    const { user, practice } = await seedPracticeWithOwner("exp-20d");
    const course = await seedTrainingCourse("Exp 20d");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 90,
        passed: true,
        completedAt: new Date(Date.now() - 345 * DAY_MS),
        expiresAt: new Date(Date.now() + 20 * DAY_MS + HOUR_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingExpiringNotifications(tx, practice.id, [user.id], "UTC"),
    );

    // days=20 → matches m=30 only (20>14, 20>7).
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("TRAINING_EXPIRING");
    expect(p.severity).toBe("INFO");
    expect(p.entityKey).toBe(`training-expiring:${completion.id}:30`);
    expect(p.userId).toBe(user.id);
    expect(p.href).toBe(`/programs/training/${course.id}`);
    expect(p.title).toContain("Exp 20d");
  });

  it("fires 30, 14, and 7 milestones at days=5 (every m where days <= m)", async () => {
    const { user, practice } = await seedPracticeWithOwner("exp-5d");
    const course = await seedTrainingCourse("Exp 5d");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 95,
        passed: true,
        completedAt: new Date(Date.now() - 360 * DAY_MS),
        expiresAt: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingExpiringNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(3);
    expect(proposals.map((p) => p.entityKey).sort()).toEqual(
      [
        `training-expiring:${completion.id}:30`,
        `training-expiring:${completion.id}:14`,
        `training-expiring:${completion.id}:7`,
      ].sort(),
    );
    // Severity: m=7 → WARNING, m=14/30 → INFO.
    const m7 = proposals.find((p) => p.entityKey?.endsWith(":7"));
    const m14 = proposals.find((p) => p.entityKey?.endsWith(":14"));
    const m30 = proposals.find((p) => p.entityKey?.endsWith(":30"));
    expect(m7?.severity).toBe("WARNING");
    expect(m14?.severity).toBe("INFO");
    expect(m30?.severity).toBe("INFO");
  });

  it("emits nothing for a completion already past expiry (TRAINING_OVERDUE handles)", async () => {
    const { user, practice } = await seedPracticeWithOwner("exp-past");
    const course = await seedTrainingCourse("Exp Past");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 90,
        passed: true,
        completedAt: new Date(Date.now() - 366 * DAY_MS),
        expiresAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingExpiringNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits nothing for a completion expiring in 60 days (outside the 30-day horizon)", async () => {
    const { user, practice } = await seedPracticeWithOwner("exp-60d");
    const course = await seedTrainingCourse("Exp 60d");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 90,
        passed: true,
        completedAt: new Date(Date.now() - 305 * DAY_MS),
        expiresAt: new Date(Date.now() + 60 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingExpiringNotifications(tx, practice.id, [user.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("uses the LATEST passing completion when multiple exist for (user, course)", async () => {
    const { user, practice } = await seedPracticeWithOwner("exp-multi");
    const course = await seedTrainingCourse("Exp Multi");
    // Older completion expiring 5 days out.
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 80,
        passed: true,
        completedAt: new Date(Date.now() - 360 * DAY_MS),
        expiresAt: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
      },
    });
    // Newer completion expiring 200 days out — outside the horizon, so
    // the generator should emit nothing despite the older 5-day row.
    const newer = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 95,
        passed: true,
        completedAt: new Date(Date.now() - 165 * DAY_MS),
        expiresAt: new Date(Date.now() + 200 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingExpiringNotifications(tx, practice.id, [user.id], "UTC"),
    );

    // Both are in the findMany result (since expiresAt < horizon for the
    // older row); the latest-wins map keeps `newer` because it has the
    // larger expiresAt. With days≈200, no milestone matches.
    expect(proposals).toHaveLength(0);
    // Confirm we didn't accidentally key on the older completion id.
    expect(proposals.find((p) => p.entityKey?.includes(newer.id))).toBeFalsy();
  });

  it("recipient is the user who completed, not admins", async () => {
    const { practice, user: owner } = await seedPracticeWithOwner("exp-staff");
    const staff = await seedStaff(practice.id, "alice");
    const course = await seedTrainingCourse("Exp Staff");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 90,
        passed: true,
        completedAt: new Date(Date.now() - 360 * DAY_MS),
        expiresAt: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingExpiringNotifications(
        tx,
        practice.id,
        [owner.id, staff.id],
        "UTC",
      ),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(staff.id)).toBe(true);
    expect(recipientIds.has(owner.id)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// End-to-end dedup — runNotificationDigest twice should produce one row
// per (user, type, entityKey) for each new generator.
// -------------------------------------------------------------------------

describe("end-to-end dedup for Phase 4 PR 8 generators", () => {
  it("running runNotificationDigest twice for TRAINING_ASSIGNED produces a single row", async () => {
    const { user, practice } = await seedPracticeWithOwner("dedup-assigned");
    const course = await seedTrainingCourse("Dedup Assigned");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() + 30 * DAY_MS),
        createdByUserId: user.id,
      },
    });
    // Suppress SRA_DUE so the digest doesn't compose stuff we don't care about.
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

    const rows = await db.notification.findMany({
      where: { userId: user.id, type: "TRAINING_ASSIGNED" },
    });
    expect(rows).toHaveLength(1);
  });

  it("running runNotificationDigest twice for TRAINING_DUE_SOON produces one row per milestone", async () => {
    const { user, practice } = await seedPracticeWithOwner("dedup-dueSoon");
    const course = await seedTrainingCourse("Dedup DueSoon");
    await db.trainingAssignment.create({
      data: {
        practiceId: practice.id,
        courseId: course.id,
        assignedToUserId: user.id,
        dueDate: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
        createdByUserId: user.id,
      },
    });
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

    const rows = await db.notification.findMany({
      where: { userId: user.id, type: "TRAINING_DUE_SOON" },
    });
    // days=5 → matches 14 and 7 → 2 rows.
    expect(rows).toHaveLength(2);
  });

  it("running runNotificationDigest twice for TRAINING_EXPIRING produces one row per milestone", async () => {
    const { user, practice } = await seedPracticeWithOwner("dedup-expiring");
    const course = await seedTrainingCourse("Dedup Expiring");
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: user.id,
        courseId: course.id,
        courseVersion: 1,
        score: 90,
        passed: true,
        completedAt: new Date(Date.now() - 360 * DAY_MS),
        expiresAt: new Date(Date.now() + 5 * DAY_MS + HOUR_MS),
      },
    });
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

    const rows = await db.notification.findMany({
      where: { userId: user.id, type: "TRAINING_EXPIRING" },
    });
    // days=5 → matches 30, 14, 7 → 3 rows.
    expect(rows).toHaveLength(3);
  });
});
