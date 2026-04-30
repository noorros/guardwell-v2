// tests/integration/training-course-lifecycle.test.ts
//
// Phase 4 PR 4 — server-action tests for retire/restore on a custom
// TrainingCourse. Each action is ADMIN-gated and must enforce a
// custom-for-this-practice tenancy guard via the courseTenancy
// helpers, so a practice admin cannot retire HIPAA_BASICS for the
// world (or another practice's custom course).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";

declare global {
  var __trainingLifecycleTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__trainingLifecycleTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__trainingLifecycleTestUser) throw new Error("Unauthorized");
      return globalThis.__trainingLifecycleTestUser;
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

beforeEach(() => {
  globalThis.__trainingLifecycleTestUser = null;
});

async function seed(role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER") {
  const user = await db.user.create({
    data: {
      firebaseUid: `tl-${Math.random().toString(36).slice(2, 10)}`,
      email: `tl-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `TL ${role} Practice`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  globalThis.__trainingLifecycleTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice };
}

async function seedCustomCourseFor(
  practiceId: string,
  opts: { sortOrder?: number } = {},
) {
  const code = `${practiceId}_TLC_${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
  return db.trainingCourse.create({
    data: {
      code,
      title: `Custom for ${practiceId.slice(0, 6)}`,
      type: "CUSTOM",
      lessonContent: "lesson body",
      durationMinutes: 30,
      passingScore: 80,
      isRequired: false,
      sortOrder: opts.sortOrder ?? 999,
    },
  });
}

async function seedSystemCourse() {
  const code = `TLC_SYS_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return db.trainingCourse.create({
    data: {
      code,
      title: "System Course",
      type: "HIPAA",
      lessonContent: "system body",
      durationMinutes: 30,
      passingScore: 80,
      isRequired: false,
      sortOrder: 5,
    },
  });
}

describe("retireTrainingCourseAction (Phase 4 PR 4)", () => {
  it("rejects STAFF callers (requires ADMIN)", async () => {
    const { practice } = await seed("STAFF");
    const course = await seedCustomCourseFor(practice.id);
    const { retireTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      retireTrainingCourseAction({ courseId: course.id }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("retires a custom course owned by this practice as ADMIN (sortOrder=9999)", async () => {
    const { practice } = await seed("ADMIN");
    const course = await seedCustomCourseFor(practice.id);
    const { retireTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    const result = await retireTrainingCourseAction({ courseId: course.id });
    expect(result.courseId).toBe(course.id);
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: course.id },
    });
    expect(row.sortOrder).toBe(9999);
  });

  it("rejects retiring a system course (would impact every practice)", async () => {
    await seed("ADMIN");
    const sysCourse = await seedSystemCourse();
    const { retireTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      retireTrainingCourseAction({ courseId: sysCourse.id }),
    ).rejects.toThrow(/system course/i);
    // Untouched
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: sysCourse.id },
    });
    expect(row.sortOrder).toBe(5);
  });

  it("rejects retiring another practice's custom course (does not leak existence)", async () => {
    await seed("ADMIN");
    // Spin up a separate practice and a course owned by it.
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    const otherCourse = await seedCustomCourseFor(otherPractice.id);
    const { retireTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      retireTrainingCourseAction({ courseId: otherCourse.id }),
    ).rejects.toThrow(/not found/i);
    // Untouched
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: otherCourse.id },
    });
    expect(row.sortOrder).toBe(999);
  });

  it("rejects retiring an already-retired course", async () => {
    const { practice } = await seed("ADMIN");
    const course = await seedCustomCourseFor(practice.id, { sortOrder: 9999 });
    const { retireTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      retireTrainingCourseAction({ courseId: course.id }),
    ).rejects.toThrow(/already retired/i);
  });
});

describe("restoreTrainingCourseAction (Phase 4 PR 4)", () => {
  it("rejects STAFF callers (requires ADMIN)", async () => {
    const { practice } = await seed("STAFF");
    const course = await seedCustomCourseFor(practice.id, { sortOrder: 9999 });
    const { restoreTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      restoreTrainingCourseAction({ courseId: course.id }),
    ).rejects.toThrow(/admin|owner|requires/i);
  });

  it("restores a retired custom course owned by this practice (sortOrder=999)", async () => {
    const { practice } = await seed("ADMIN");
    const course = await seedCustomCourseFor(practice.id, { sortOrder: 9999 });
    const { restoreTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    const result = await restoreTrainingCourseAction({ courseId: course.id });
    expect(result.courseId).toBe(course.id);
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: course.id },
    });
    expect(row.sortOrder).toBe(999);
  });

  it("rejects restoring a system course", async () => {
    await seed("ADMIN");
    const sysCourse = await seedSystemCourse();
    const { restoreTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      restoreTrainingCourseAction({ courseId: sysCourse.id }),
    ).rejects.toThrow(/system course/i);
  });

  it("rejects restoring an already-active course", async () => {
    const { practice } = await seed("ADMIN");
    // Active = sortOrder !== 9999
    const course = await seedCustomCourseFor(practice.id, { sortOrder: 999 });
    const { restoreTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      restoreTrainingCourseAction({ courseId: course.id }),
    ).rejects.toThrow(/already active/i);
  });

  it("rejects restoring another practice's custom course (does not leak)", async () => {
    await seed("ADMIN");
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice 2", primaryState: "TX" },
    });
    const otherCourse = await seedCustomCourseFor(otherPractice.id, {
      sortOrder: 9999,
    });
    const { restoreTrainingCourseAction } = await import(
      "@/app/(dashboard)/programs/training/actions"
    );
    await expect(
      restoreTrainingCourseAction({ courseId: otherCourse.id }),
    ).rejects.toThrow(/not found/i);
    const row = await db.trainingCourse.findUniqueOrThrow({
      where: { id: otherCourse.id },
    });
    expect(row.sortOrder).toBe(9999);
  });
});
