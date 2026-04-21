// scripts/seed-training.ts
//
// Idempotent seeder for the canonical Training catalog. Each course has a
// stable `code` (e.g. "HIPAA_BASICS") that is the natural upsert key and
// also the evidence-type suffix (TRAINING:<code>) used by derivation.
//
// Content is loaded from JSON fixtures under scripts/training-content/ so
// it's easy to diff and review. Quiz questions are synced by (courseId, order) —
// running the seeder after editing a question's text updates it in place.
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
  const staleOrders = existing
    .filter((e) => !fixture.quizQuestions.some((q) => q.order === e.order))
    .map((e) => e.id);
  if (staleOrders.length > 0) {
    await db.quizQuestion.deleteMany({ where: { id: { in: staleOrders } } });
  }
  return course;
}

function loadV1Export(filePath: string): CourseFixture {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
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
  };
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

async function main() {
  const fixturePath = path.resolve(
    __dirname,
    "_v1-hipaa-101-export.json",
  );
  const hipaaBasics = loadV1Export(fixturePath);

  const course = await upsertCourse(hipaaBasics);
  console.log(
    `Seed training: course code=${course.code} id=${course.id} version=${course.version}, ${hipaaBasics.quizQuestions.length} quiz questions.`,
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
