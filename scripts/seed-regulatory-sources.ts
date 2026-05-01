// scripts/seed-regulatory-sources.ts
//
// Idempotent seeder for the Phase 8 regulatory intelligence engine.
// Upserts the 10 starter sources from _v2-regulatory-sources.json by URL.
// On re-seed, name + feedType + defaultFrameworks are refreshed but
// isActive is preserved (admins may have toggled it from the
// /audit/regulatory/sources page after PR 6 ships).
//
// Usage:
//   npm run db:seed:regulatory
//   # or directly
//   npx tsx scripts/seed-regulatory-sources.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });
const db = new PrismaClient();

interface SourceFixture {
  name: string;
  url: string;
  feedType: "RSS" | "ATOM" | "SCRAPE";
  isActive: boolean;
  defaultFrameworks: string[];
  scrapeConfig?: unknown;
}

async function main() {
  const fixturesPath = path.resolve(
    __dirname,
    "_v2-regulatory-sources.json",
  );
  const fixtures: SourceFixture[] = JSON.parse(
    readFileSync(fixturesPath, "utf-8"),
  );

  for (const fixture of fixtures) {
    await db.regulatorySource.upsert({
      where: { url: fixture.url },
      update: {
        name: fixture.name,
        feedType: fixture.feedType,
        // Don't overwrite isActive on re-seed — admin may have toggled it
        defaultFrameworks: fixture.defaultFrameworks,
      },
      create: {
        name: fixture.name,
        url: fixture.url,
        feedType: fixture.feedType,
        isActive: fixture.isActive,
        defaultFrameworks: fixture.defaultFrameworks,
        scrapeConfig: fixture.scrapeConfig as never,
      },
    });
    console.log(`  ✓ ${fixture.name}`);
  }
  console.log(`Seed regulatory sources: ${fixtures.length} sources upserted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
