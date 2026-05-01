// scripts/seed-tech-assessment.ts
//
// Seeds the Phase 5 Technical Security Assessment question bank — 35
// questions across 6 categories (Network, Endpoint, Cloud, Access,
// Monitoring, Backup). Ported from v1.
//
// Idempotent upsert by code.
//
// Usage:
//   npm run db:seed:tech-assessment

import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });
const db = new PrismaClient();

interface QFixture {
  code: string;
  category:
    | "NETWORK"
    | "ENDPOINT"
    | "CLOUD"
    | "ACCESS"
    | "MONITORING"
    | "BACKUP";
  title: string;
  description: string;
  guidance: string;
  sraQuestionCode: string | null;
  riskWeight: "LOW" | "MEDIUM" | "HIGH";
  sortOrder: number;
}

async function main() {
  const fixturesPath = path.resolve(
    __dirname,
    "_v2-tech-assessment-questions.json",
  );
  const fixtures: QFixture[] = JSON.parse(
    readFileSync(fixturesPath, "utf-8"),
  );

  for (const q of fixtures) {
    await db.techAssessmentQuestion.upsert({
      where: { code: q.code },
      update: {
        category: q.category,
        title: q.title,
        description: q.description,
        guidance: q.guidance,
        sraQuestionCode: q.sraQuestionCode,
        riskWeight: q.riskWeight,
        sortOrder: q.sortOrder,
      },
      create: {
        code: q.code,
        category: q.category,
        title: q.title,
        description: q.description,
        guidance: q.guidance,
        sraQuestionCode: q.sraQuestionCode,
        riskWeight: q.riskWeight,
        sortOrder: q.sortOrder,
      },
    });
  }
  console.log(`Tech assessment seed: ${fixtures.length} questions upserted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
