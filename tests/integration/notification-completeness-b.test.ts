// tests/integration/notification-completeness-b.test.ts
//
// Phase B coverage for chunk 8 launch readiness — two
// notification-scan escalation generators:
//   - TRAINING_ESCALATION
//   - CREDENTIAL_ESCALATION
//
// These introduce a new "scan-then-cross-check" pattern (see the
// doc-comment block in src/lib/notifications/generators.ts above
// generateTrainingEscalationNotifications): scan the Notification table
// for old + unread rows of a specific type, then cross-check the
// underlying domain record before emitting an escalation. Tests cover
// happy path + negative cases (newer pass / renewed credential / read
// notification / under-threshold age) and a single end-to-end dedup
// run through runNotificationDigest.
//
// Mirrors the seeding + assertion shape from
// tests/integration/notification-completeness-a.test.ts.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import {
  generateTrainingEscalationNotifications,
  generateCredentialEscalationNotifications,
} from "@/lib/notifications/generators";
import { runNotificationDigest } from "@/lib/notifications/run-digest";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPracticeWithOwner(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `notif-b-${Math.random().toString(36).slice(2, 10)}`,
      email: `notif-b-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `Notif-B Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedStaff(practiceId: string, firstName: string, lastName: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `notif-b-staff-${Math.random().toString(36).slice(2, 10)}`,
      email: `notif-b-staff-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName,
      lastName,
    },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId, role: "STAFF" },
  });
  return { user, practiceUser: pu };
}

async function seedCredentialType(label: string): Promise<string> {
  const t = await db.credentialType.create({
    data: {
      code: `ESC_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `Test ${label}`,
      category: "CLINICAL_LICENSE",
    },
  });
  return t.id;
}

async function seedTrainingCourse(label: string) {
  return db.trainingCourse.create({
    data: {
      code: `TE_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: `Training ${label}`,
      type: "HIPAA",
      lessonContent: "Test lesson",
    },
  });
}

// -------------------------------------------------------------------------
// TRAINING_ESCALATION
// -------------------------------------------------------------------------

describe("generateTrainingEscalationNotifications", () => {
  it("emits an escalation when a TRAINING_OVERDUE notification is 15 days old + unread + completion still overdue", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("train-esc");
    const { user: staff } = await seedStaff(practice.id, "Alice", "Cooper");
    const course = await seedTrainingCourse("HIPAA Basics");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 100) * DAY_MS),
        expiresAt: new Date(Date.now() - 100 * DAY_MS),
      },
    });
    // Stale, unread TRAINING_OVERDUE notification 15 days old.
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "TRAINING_OVERDUE",
        severity: "INFO",
        title: "Training overdue: HIPAA Basics",
        body: "Old overdue training",
        href: `/training/${course.id}`,
        entityKey: `training-completion:${completion.id}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("TRAINING_ESCALATION");
    expect(p.severity).toBe("WARNING");
    expect(p.entityKey).toBe(`training-escalation:${completion.id}`);
    expect(p.userId).toBe(owner.id); // recipient is the manager, not the staff
    expect(p.href).toBe(`/training/staff/${staff.id}`);
    expect(p.title).toContain("Alice Cooper");
    expect(p.title).toContain("HIPAA Basics");
    expect(p.body).toContain("14+ days");
  });

  it("emits no proposal when a newer passing completion exists (overdue resolved)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("train-esc-fresh");
    const { user: staff } = await seedStaff(practice.id, "Bob", "Dylan");
    const course = await seedTrainingCourse("OSHA Basics");
    const oldCompletion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 100) * DAY_MS),
        expiresAt: new Date(Date.now() - 100 * DAY_MS),
      },
    });
    // Newer pass — supersedes the overdue completion.
    await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 90,
        passed: true,
        completedAt: new Date(Date.now() - 30 * DAY_MS),
        expiresAt: new Date(Date.now() + 335 * DAY_MS),
      },
    });
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "TRAINING_OVERDUE",
        severity: "INFO",
        title: "Training overdue: OSHA Basics",
        body: "Old overdue training",
        href: `/training/${course.id}`,
        entityKey: `training-completion:${oldCompletion.id}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits no proposal when the source TRAINING_OVERDUE notification has been read", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("train-esc-read");
    const { user: staff } = await seedStaff(practice.id, "Carl", "Sagan");
    const course = await seedTrainingCourse("BBP Refresher");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 100) * DAY_MS),
        expiresAt: new Date(Date.now() - 100 * DAY_MS),
      },
    });
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "TRAINING_OVERDUE",
        severity: "INFO",
        title: "Training overdue: BBP Refresher",
        body: "Old overdue training",
        href: `/training/${course.id}`,
        entityKey: `training-completion:${completion.id}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
        readAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits no proposal when the source TRAINING_OVERDUE is only 13 days old (under threshold)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("train-esc-young");
    const { user: staff } = await seedStaff(practice.id, "Dani", "Filth");
    const course = await seedTrainingCourse("Privacy 101");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 100) * DAY_MS),
        expiresAt: new Date(Date.now() - 100 * DAY_MS),
      },
    });
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "TRAINING_OVERDUE",
        severity: "INFO",
        title: "Training overdue: Privacy 101",
        body: "Recent overdue training",
        href: `/training/${course.id}`,
        entityKey: `training-completion:${completion.id}`,
        createdAt: new Date(Date.now() - 13 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("excludes a TRAINING_OVERDUE notification created exactly 14 days ago (boundary — strict less-than)", async () => {
    // Code uses `createdAt: { lt: cutoff }` where cutoff = now - 14d, so a
    // row whose createdAt is at-or-after the cutoff must NOT trigger an
    // escalation. We give the row a 1-second forward buffer so the test is
    // robust against microsecond drift between Date.now() in seed and
    // Date.now() in the generator (the generator runs slightly later, so
    // its cutoff is slightly older — without the buffer the seeded row
    // would actually be 14d + ε old and ironically pass `lt: cutoff`).
    const { user: owner, practice } = await seedPracticeWithOwner("train-esc-boundary");
    const { user: staff } = await seedStaff(practice.id, "Dion", "Boundary");
    const course = await seedTrainingCourse("Boundary Training");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 100) * DAY_MS),
        expiresAt: new Date(Date.now() - 100 * DAY_MS),
      },
    });
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "TRAINING_OVERDUE",
        severity: "INFO",
        title: "Training overdue: Boundary Training",
        body: "Boundary overdue training",
        href: `/training/${course.id}`,
        entityKey: `training-completion:${completion.id}`,
        createdAt: new Date(Date.now() - 14 * DAY_MS + 1000),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("targets owners + admins (not the staff member who has the overdue training)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("train-esc-recipients");
    const { user: staff } = await seedStaff(practice.id, "Edith", "Wharton");
    const course = await seedTrainingCourse("HIPAA Privacy");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 100) * DAY_MS),
        expiresAt: new Date(Date.now() - 100 * DAY_MS),
      },
    });
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "TRAINING_OVERDUE",
        severity: "INFO",
        title: "Training overdue: HIPAA Privacy",
        body: "Old overdue training",
        href: `/training/${course.id}`,
        entityKey: `training-completion:${completion.id}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateTrainingEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    const recipientIds = new Set(proposals.map((p) => p.userId));
    expect(recipientIds.has(owner.id)).toBe(true);
    expect(recipientIds.has(staff.id)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// CREDENTIAL_ESCALATION
// -------------------------------------------------------------------------

describe("generateCredentialEscalationNotifications", () => {
  it("emits an escalation when a CREDENTIAL_EXPIRING notification is 15 days old + unread + credential unchanged", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("cred-esc");
    const { practiceUser: staffPu, user: staff } = await seedStaff(
      practice.id,
      "Frida",
      "Kahlo",
    );
    const ctId = await seedCredentialType("MD License");
    const expiryDate = new Date(Date.now() + 5 * DAY_MS);
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        holderId: staffPu.id,
        title: "Frida MD License",
        expiryDate,
      },
    });
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "CREDENTIAL_EXPIRING",
        severity: "WARNING",
        title: "MD License expires in 20 days",
        body: "Original expiring notification",
        href: "/programs/credentials",
        entityKey: `credential:${cred.id}:${expiryStr}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    if (!p) throw new Error("expected one proposal");
    expect(p.type).toBe("CREDENTIAL_ESCALATION");
    expect(p.severity).toBe("WARNING");
    expect(p.entityKey).toBe(`credential-escalation:${cred.id}`);
    expect(p.userId).toBe(owner.id);
    expect(p.href).toBe(`/credentials/${cred.id}`);
    expect(p.title).toContain("Frida Kahlo");
    expect(p.body).toContain("14 days");
  });

  it("emits no proposal when the credential has been retired", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("cred-esc-retired");
    const { practiceUser: staffPu, user: staff } = await seedStaff(
      practice.id,
      "Greg",
      "Brady",
    );
    const ctId = await seedCredentialType("MD License Retired");
    const expiryDate = new Date(Date.now() + 5 * DAY_MS);
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        holderId: staffPu.id,
        title: "Greg MD License",
        expiryDate,
        retiredAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "CREDENTIAL_EXPIRING",
        severity: "WARNING",
        title: "MD License expires soon",
        body: "Original expiring notification",
        href: "/programs/credentials",
        entityKey: `credential:${cred.id}:${expiryStr}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits no proposal when the credential was renewed in place (expiryDate pushed forward)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("cred-esc-renewed");
    const { practiceUser: staffPu, user: staff } = await seedStaff(
      practice.id,
      "Henri",
      "Cartier",
    );
    const ctId = await seedCredentialType("MD License Renewed");
    const originalExpiry = new Date(Date.now() + 5 * DAY_MS);
    // Credential was renewed: expiryDate is now well in the future.
    const newExpiry = new Date(Date.now() + 365 * DAY_MS);
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        holderId: staffPu.id,
        title: "Henri MD License",
        expiryDate: newExpiry,
      },
    });
    const originalDateStr = originalExpiry.toISOString().slice(0, 10);
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "CREDENTIAL_EXPIRING",
        severity: "WARNING",
        title: "MD License was expiring soon",
        body: "Original expiring notification",
        href: "/programs/credentials",
        entityKey: `credential:${cred.id}:${originalDateStr}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits no proposal when the source CREDENTIAL_EXPIRING has been read", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("cred-esc-read");
    const { practiceUser: staffPu, user: staff } = await seedStaff(
      practice.id,
      "Iris",
      "Murdoch",
    );
    const ctId = await seedCredentialType("MD License Read");
    const expiryDate = new Date(Date.now() + 5 * DAY_MS);
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        holderId: staffPu.id,
        title: "Iris MD License",
        expiryDate,
      },
    });
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "CREDENTIAL_EXPIRING",
        severity: "WARNING",
        title: "MD License expires soon",
        body: "Original expiring notification",
        href: "/programs/credentials",
        entityKey: `credential:${cred.id}:${expiryStr}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
        readAt: new Date(Date.now() - 1 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("emits no proposal when source notification is only 13 days old (under threshold)", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("cred-esc-young");
    const { practiceUser: staffPu, user: staff } = await seedStaff(
      practice.id,
      "Jack",
      "Kerouac",
    );
    const ctId = await seedCredentialType("MD License Young");
    const expiryDate = new Date(Date.now() + 5 * DAY_MS);
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        holderId: staffPu.id,
        title: "Jack MD License",
        expiryDate,
      },
    });
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "CREDENTIAL_EXPIRING",
        severity: "WARNING",
        title: "MD License expires soon",
        body: "Recent expiring notification",
        href: "/programs/credentials",
        entityKey: `credential:${cred.id}:${expiryStr}`,
        createdAt: new Date(Date.now() - 13 * DAY_MS),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });

  it("excludes a CREDENTIAL_EXPIRING notification created exactly 14 days ago (boundary — strict less-than)", async () => {
    // Code uses `createdAt: { lt: cutoff }` where cutoff = now - 14d, so a
    // row whose createdAt is at-or-after the cutoff must NOT trigger an
    // escalation. 1-second forward buffer guards against microsecond drift
    // between seed-time Date.now() and generator-time Date.now() (see
    // matching TRAINING boundary test for the full explanation).
    const { user: owner, practice } = await seedPracticeWithOwner("cred-esc-boundary");
    const { practiceUser: staffPu, user: staff } = await seedStaff(
      practice.id,
      "Kira",
      "Boundary",
    );
    const ctId = await seedCredentialType("MD License Boundary");
    const expiryDate = new Date(Date.now() + 5 * DAY_MS);
    const cred = await db.credential.create({
      data: {
        practiceId: practice.id,
        credentialTypeId: ctId,
        holderId: staffPu.id,
        title: "Kira MD License",
        expiryDate,
      },
    });
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "CREDENTIAL_EXPIRING",
        severity: "WARNING",
        title: "MD License expires soon",
        body: "Boundary expiring notification",
        href: "/programs/credentials",
        entityKey: `credential:${cred.id}:${expiryStr}`,
        createdAt: new Date(Date.now() - 14 * DAY_MS + 1000),
      },
    });

    const proposals = await db.$transaction((tx) =>
      generateCredentialEscalationNotifications(tx, practice.id, [owner.id, staff.id], "UTC"),
    );

    expect(proposals).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// End-to-end dedup — runNotificationDigest twice should produce one row
// per escalation entityKey.
// -------------------------------------------------------------------------

describe("end-to-end dedup for Phase B escalation generators", () => {
  it("running runNotificationDigest twice produces one TRAINING_ESCALATION row", async () => {
    const { user: owner, practice } = await seedPracticeWithOwner("dedup-train-esc");
    const { user: staff } = await seedStaff(practice.id, "Karen", "Carpenter");
    const course = await seedTrainingCourse("HIPAA Dedup");
    const completion = await db.trainingCompletion.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        courseId: course.id,
        courseVersion: 1,
        score: 85,
        passed: true,
        completedAt: new Date(Date.now() - (365 + 100) * DAY_MS),
        expiresAt: new Date(Date.now() - 100 * DAY_MS),
      },
    });
    await db.notification.create({
      data: {
        practiceId: practice.id,
        userId: staff.id,
        type: "TRAINING_OVERDUE",
        severity: "INFO",
        title: "Training overdue: HIPAA Dedup",
        body: "Old overdue training",
        href: `/training/${course.id}`,
        entityKey: `training-completion:${completion.id}`,
        createdAt: new Date(Date.now() - 15 * DAY_MS),
      },
    });
    // SRA already on file so we don't get an SRA_DUE nudge for the owner.
    await db.practiceSraAssessment.create({
      data: {
        practiceId: practice.id,
        completedByUserId: owner.id,
        completedAt: new Date(),
        overallScore: 100,
        addressedCount: 20,
        totalCount: 20,
        isDraft: false,
      },
    });

    await runNotificationDigest();
    await runNotificationDigest();

    const escalations = await db.notification.findMany({
      where: {
        practiceId: practice.id,
        userId: owner.id,
        type: "TRAINING_ESCALATION",
      },
    });
    expect(escalations).toHaveLength(1);
    const note = escalations[0];
    if (!note) throw new Error("expected one notification");
    expect(note.entityKey).toBe(`training-escalation:${completion.id}`);
  });
});
