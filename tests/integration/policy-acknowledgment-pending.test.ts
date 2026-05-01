// tests/integration/policy-acknowledgment-pending.test.ts
//
// Phase 7 PR 3 — coverage for generatePolicyAcknowledgmentPendingNotifications.
// Each `it` exercises the generator in isolation: seed practice, members,
// policies (+ optional acknowledgments / training prereqs), call the
// generator, assert the proposals.
//
// Mirrors the inline-seed shape from
// tests/integration/training-notifications.test.ts.

import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { generatePolicyAcknowledgmentPendingNotifications } from "@/lib/notifications/generators";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `pol-ack-${Math.random().toString(36).slice(2, 10)}`,
      email: `pol-ack-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `PolicyAck Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedStaff(practiceId: string, label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `pol-ack-staff-${Math.random().toString(36).slice(2, 10)}`,
      email: `pol-ack-staff-${Math.random().toString(36).slice(2, 8)}@test.test`,
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
      code: `PA_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: `Training ${label}`,
      type: "HIPAA",
      lessonContent: "Test lesson",
    },
  });
}

describe("generatePolicyAcknowledgmentPendingNotifications", () => {
  it("fires for every active member when an adopted policy has no acks", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("no-acks");
    const staff = await seedStaff(practice.id, "no-acks");
    const policy = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        version: 1,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyAcknowledgmentPendingNotifications(
        tx,
        practice.id,
        [owner.id, staff.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(2);
    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(staff.id)).toBe(true);
    for (const p of proposals) {
      expect(p.type).toBe("POLICY_ACKNOWLEDGMENT_PENDING");
      expect(p.severity).toBe("WARNING");
      expect(p.entityKey).toBe(
        `policy-ack-pending:${policy.id}:1:${p.userId}`,
      );
      expect(p.title).toContain("HIPAA_PRIVACY_POLICY");
      expect(p.body).toContain("v1");
      expect(p.href).toBe(`/programs/policies/${policy.id}`);
    }
  });

  it("does NOT fire for a user who already acknowledged the current version", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("acked-current");
    const staff = await seedStaff(practice.id, "acked-current");
    const policy = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_SECURITY_POLICY",
        version: 1,
      },
    });
    // Owner has already signed v1; staff has not.
    await db.policyAcknowledgment.create({
      data: {
        practicePolicyId: policy.id,
        userId: owner.id,
        policyVersion: 1,
        signatureText: "I have read",
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyAcknowledgmentPendingNotifications(
        tx,
        practice.id,
        [owner.id, staff.id],
        "UTC",
      ),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(false);
    expect(recipientIds.has(staff.id)).toBe(true);
  });

  it("DOES fire for a user who acknowledged an OLDER version (v1) when current is v2", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("acked-stale");
    const policy = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_BREACH_POLICY",
        version: 2,
      },
    });
    // Owner signed v1 — but current is v2, so they need to re-sign.
    await db.policyAcknowledgment.create({
      data: {
        practicePolicyId: policy.id,
        userId: owner.id,
        policyVersion: 1,
        signatureText: "I have read v1",
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyAcknowledgmentPendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.userId).toBe(owner.id);
    expect(p.entityKey).toBe(`policy-ack-pending:${policy.id}:2:${owner.id}`);
    expect(p.body).toContain("v2");
  });

  it("does NOT fire when the policy has an unfulfilled training prereq", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("prereq-missing");
    const course = await seedTrainingCourse("Privacy Basics");
    const policy = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        version: 1,
      },
    });
    await db.policyTrainingPrereq.create({
      data: {
        practicePolicyId: policy.id,
        trainingCourseId: course.id,
      },
    });
    // No completion record at all → prereq not met.

    const proposals = await db.$transaction((tx) =>
      generatePolicyAcknowledgmentPendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("DOES fire when the prereq training is completed (passed + not expired)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("prereq-met");
    const course = await seedTrainingCourse("Privacy Done");
    const policy = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_SECURITY_POLICY",
        version: 1,
      },
    });
    await db.policyTrainingPrereq.create({
      data: {
        practicePolicyId: policy.id,
        trainingCourseId: course.id,
      },
    });
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: owner.id,
        courseId: course.id,
        courseVersion: 1,
        score: 95,
        passed: true,
        completedAt: new Date(Date.now() - 30 * DAY_MS),
        expiresAt: new Date(Date.now() + 335 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyAcknowledgmentPendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.userId).toBe(owner.id);
  });

  it("does NOT fire when the prereq completion has expired", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("prereq-expired");
    const course = await seedTrainingCourse("Privacy Expired");
    const policy = await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_PRIVACY_POLICY",
        version: 1,
      },
    });
    await db.policyTrainingPrereq.create({
      data: {
        practicePolicyId: policy.id,
        trainingCourseId: course.id,
      },
    });
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: owner.id,
        courseId: course.id,
        courseVersion: 1,
        score: 95,
        passed: true,
        completedAt: new Date(Date.now() - 400 * DAY_MS),
        expiresAt: new Date(Date.now() - 30 * DAY_MS), // Already expired
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyAcknowledgmentPendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("does NOT fire for a retired policy", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("retired");
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_BREACH_POLICY",
        version: 1,
        retiredAt: new Date(),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyAcknowledgmentPendingNotifications(
        tx,
        practice.id,
        [owner.id],
        "UTC",
      ),
    );

    expect(proposals).toHaveLength(0);
  });

  it("does NOT fire for a removed/excluded user (PracticeUser.removedAt set)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("removed");
    const removed = await seedStaff(practice.id, "gone");
    // Mark the staff member as removed.
    await db.practiceUser.updateMany({
      where: { practiceId: practice.id, userId: removed.id },
      data: { removedAt: new Date() },
    });
    await db.practicePolicy.create({
      data: {
        practiceId: practice.id,
        policyCode: "HIPAA_SECURITY_POLICY",
        version: 1,
      },
    });

    const proposals = await db.$transaction((tx) =>
      generatePolicyAcknowledgmentPendingNotifications(
        tx,
        practice.id,
        [owner.id, removed.id],
        "UTC",
      ),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(removed.id)).toBe(false);
  });
});
