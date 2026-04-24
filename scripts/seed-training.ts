// scripts/seed-training.ts
//
// Idempotent seeder for the canonical Training catalog. Each course has a
// stable `code` (e.g. "HIPAA_BASICS") that is the natural upsert key and
// also the evidence-type suffix (TRAINING:<code>) used by derivation.
//
// Content is loaded from JSON fixtures under scripts/ so it's easy to
// diff and review. Quiz questions are synced by (courseId, order) —
// running the seeder after editing a question's text updates in place.
//
// Usage:
//   npm run db:seed:training

import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });

const db = new PrismaClient();

interface QuizFixture {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
  order: number;
}

interface CourseFixture {
  code: string;
  title: string;
  description?: string | null;
  type: string;
  durationMinutes?: number | null;
  passingScore: number;
  isRequired: boolean;
  roles: string[];
  sortOrder: number;
  version: number;
  lessonContent: string;
  quizQuestions: QuizFixture[];
}

async function upsertCourse(fixture: CourseFixture) {
  const course = await db.trainingCourse.upsert({
    where: { code: fixture.code },
    update: {
      title: fixture.title,
      description: fixture.description ?? null,
      type: fixture.type,
      durationMinutes: fixture.durationMinutes ?? null,
      passingScore: fixture.passingScore,
      isRequired: fixture.isRequired,
      roles: fixture.roles,
      sortOrder: fixture.sortOrder,
      version: fixture.version,
      lessonContent: fixture.lessonContent,
    },
    create: {
      code: fixture.code,
      title: fixture.title,
      description: fixture.description ?? null,
      type: fixture.type,
      durationMinutes: fixture.durationMinutes ?? null,
      passingScore: fixture.passingScore,
      isRequired: fixture.isRequired,
      roles: fixture.roles,
      sortOrder: fixture.sortOrder,
      version: fixture.version,
      lessonContent: fixture.lessonContent,
    },
  });

  // Sync quiz questions: upsert by (courseId, order). Delete any stale rows
  // whose order is beyond the current fixture length.
  const existing = await db.quizQuestion.findMany({
    where: { courseId: course.id },
    orderBy: { order: "asc" },
  });
  for (const q of fixture.quizQuestions) {
    const match = existing.find((e) => e.order === q.order);
    if (match) {
      await db.quizQuestion.update({
        where: { id: match.id },
        data: {
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation ?? null,
        },
      });
    } else {
      await db.quizQuestion.create({
        data: {
          courseId: course.id,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation ?? null,
          order: q.order,
        },
      });
    }
  }
  const staleIds = existing
    .filter((e) => !fixture.quizQuestions.some((q) => q.order === e.order))
    .map((e) => e.id);
  if (staleIds.length > 0) {
    await db.quizQuestion.deleteMany({ where: { id: { in: staleIds } } });
  }
  return course;
}

// v1 HIPAA 101 export — one course per file, code forced to HIPAA_BASICS
// because derivation is hard-coded to that canonical identifier.
interface LegacyV1Course {
  title: string;
  description: string | null;
  type: string;
  duration: number | null;
  passingScore: number;
  isRequired: boolean;
  roles: string[];
  lessonContent: string;
  quizQuestions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string | null;
    order: number;
  }>;
}

function loadHipaaBasics(filePath: string): CourseFixture {
  const raw: LegacyV1Course = JSON.parse(readFileSync(filePath, "utf8"));
  return {
    code: "HIPAA_BASICS",
    title: raw.title,
    description: raw.description,
    type: "HIPAA",
    durationMinutes: raw.duration,
    passingScore: raw.passingScore,
    isRequired: raw.isRequired,
    roles: raw.roles,
    sortOrder: 10,
    version: 1,
    lessonContent: raw.lessonContent,
    quizQuestions: raw.quizQuestions,
  };
}

// v1 additional-courses export — array of multiple courses, codes embedded.
interface V1CourseWithCode extends LegacyV1Course {
  code: string;
}

function loadFramework(
  filePath: string,
  type: string,
  baseSortOrder: number,
): CourseFixture[] {
  const raw: V1CourseWithCode[] = JSON.parse(readFileSync(filePath, "utf8"));
  return raw.map((r, idx) => ({
    code: r.code,
    title: r.title,
    description: r.description,
    type,
    durationMinutes: r.duration,
    passingScore: r.passingScore,
    isRequired: r.isRequired,
    roles: r.roles,
    sortOrder: baseSortOrder + idx * 10,
    version: 1,
    lessonContent: r.lessonContent,
    quizQuestions: r.quizQuestions,
  }));
}

// Mixed-type export — each course carries its own `type` field. Used for the
// v1 batch-2 port (HIPAA + OSHA in a single file) and for greenfield v2
// course collections that span frameworks.
interface V1CourseWithCodeAndType extends V1CourseWithCode {
  type: string;
}

interface MixedLoadOptions {
  /** Skip courses whose lessonContent is shorter than this. Used to drop
   *  placeholder rows that v1 had quizzes for but never authored content. */
  minLessonChars?: number;
}

function loadFrameworkMixed(
  filePath: string,
  baseSortOrder: number,
  options: MixedLoadOptions = {},
): CourseFixture[] {
  const raw: V1CourseWithCodeAndType[] = JSON.parse(
    readFileSync(filePath, "utf8"),
  );
  const minLen = options.minLessonChars ?? 0;
  const filtered = raw.filter((r) => (r.lessonContent?.length ?? 0) >= minLen);
  if (filtered.length < raw.length) {
    const skipped = raw
      .filter((r) => (r.lessonContent?.length ?? 0) < minLen)
      .map((r) => r.code);
    console.log(
      `  ⚠ skipping ${skipped.length} placeholder course(s): ${skipped.join(", ")}`,
    );
  }
  return filtered.map((r, idx) => ({
    code: r.code,
    title: r.title,
    description: r.description,
    type: r.type,
    durationMinutes: r.duration,
    passingScore: r.passingScore,
    isRequired: r.isRequired,
    roles: r.roles,
    sortOrder: baseSortOrder + idx * 10,
    version: 1,
    lessonContent: r.lessonContent,
    quizQuestions: r.quizQuestions,
  }));
}

async function main() {
  const basicsPath = path.resolve(__dirname, "_v1-hipaa-101-export.json");
  const hipaaAdditionalPath = path.resolve(
    __dirname,
    "_v1-hipaa-additional-courses-export.json",
  );
  const oshaPath = path.resolve(__dirname, "_v1-osha-training-export.json");
  // Batch 2 — mixed HIPAA + OSHA, ported from v1 in the v2 catalog
  // completion sweep (2026-04-23). Two courses (USP_797_ALLERGEN_COMPOUNDING,
  // ANAPHYLAXIS_RESPONSE) had quiz questions but only ~68 chars of lesson
  // content in v1; we skip them here and will author content in a follow-up.
  const batch2Path = path.resolve(
    __dirname,
    "_v1-training-batch-2-export.json",
  );

  const fixtures: CourseFixture[] = [
    loadHipaaBasics(basicsPath),
    ...loadFramework(hipaaAdditionalPath, "HIPAA", 20),
    ...loadFramework(oshaPath, "OSHA", 100),
    // Use sortOrder 200+ for the batch — keeps existing courses stable and
    // groups the new wave at the bottom of the catalog list.
    ...loadFrameworkMixed(batch2Path, 200, { minLessonChars: 500 }),
  ];

  let totalQuestions = 0;
  for (const f of fixtures) {
    const course = await upsertCourse(f);
    totalQuestions += f.quizQuestions.length;
    console.log(
      `  ✓ ${course.code} — ${f.quizQuestions.length} qs, ${f.lessonContent.length} chars`,
    );
  }

  console.log(
    `Seed training: ${fixtures.length} courses upserted, ${totalQuestions} total quiz questions.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
