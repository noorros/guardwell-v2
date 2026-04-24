// scripts/seed-policy-templates.ts
//
// Idempotent seeder for the PolicyTemplate catalog. Source-of-truth is
// the v1 export at scripts/_v1-policy-templates-export.json (130 entries
// as of 2026-04-24). Re-running upserts each row keyed by `code`.
//
// Usage:
//   npm run db:seed:policy-templates

import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });

const db = new PrismaClient();

interface SourceEntry {
  code: string;
  title: string;
  framework: string;
  description: string;
  bodyMarkdown: string;
  applicableTo: { state?: string; specialty?: string } | null;
  sortOrder?: number;
}

async function main() {
  const filePath = path.resolve(
    __dirname,
    "_v1-policy-templates-export.json",
  );
  const raw: SourceEntry[] = JSON.parse(readFileSync(filePath, "utf8"));

  // Sanity dedup on code — first entry wins.
  const seenCodes = new Set<string>();
  const fixtures = raw.filter((e) => {
    if (seenCodes.has(e.code)) return false;
    seenCodes.add(e.code);
    return true;
  });

  let upserted = 0;
  for (const e of fixtures) {
    await db.policyTemplate.upsert({
      where: { code: e.code },
      update: {
        title: e.title,
        framework: e.framework,
        description: e.description,
        bodyMarkdown: e.bodyMarkdown,
        stateFilter: e.applicableTo?.state ?? null,
        specialtyFilter: e.applicableTo?.specialty ?? null,
        sortOrder: e.sortOrder ?? 100,
      },
      create: {
        code: e.code,
        title: e.title,
        framework: e.framework,
        description: e.description,
        bodyMarkdown: e.bodyMarkdown,
        stateFilter: e.applicableTo?.state ?? null,
        specialtyFilter: e.applicableTo?.specialty ?? null,
        sortOrder: e.sortOrder ?? 100,
      },
    });
    upserted += 1;
  }

  const byFw: Record<string, number> = {};
  for (const f of fixtures) byFw[f.framework] = (byFw[f.framework] ?? 0) + 1;
  console.log(`Seed PolicyTemplate: ${upserted} templates upserted.`);
  for (const [fw, n] of Object.entries(byFw)) {
    console.log(`  ${fw}: ${n}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
