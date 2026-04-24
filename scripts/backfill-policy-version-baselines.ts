// scripts/backfill-policy-version-baselines.ts
//
// One-time backfill: PR #121 introduced the PolicyVersion table +
// updated projectPolicyAdopted to write a v1 baseline row on every
// new adoption. PracticePolicy rows that existed BEFORE PR #121
// deployed don't have a baseline — meaning the /history page shows
// "0 versions" and the diff view can't compare against v1.
//
// This script walks every PracticePolicy and inserts a baseline
// PolicyVersion row at (policyId, current version) if one isn't
// already there. Idempotent — safe to re-run.
//
// Usage:
//   npm run db:backfill:policy-version-baselines

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });

const db = new PrismaClient();

async function main() {
  const policies = await db.practicePolicy.findMany({
    select: { id: true, version: true, content: true, policyCode: true },
  });

  let created = 0;
  let skipped = 0;
  for (const p of policies) {
    const exists = await db.policyVersion.findUnique({
      where: {
        practicePolicyId_version: {
          practicePolicyId: p.id,
          version: p.version,
        },
      },
      select: { id: true },
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    await db.policyVersion.create({
      data: {
        practicePolicyId: p.id,
        version: p.version,
        content: p.content,
        savedByUserId: null,
        changeNote: "Backfilled baseline for pre-PR-121 adoption",
      },
    });
    created += 1;
  }

  console.log(
    `Backfill PolicyVersion baselines: created=${created}, skipped=${skipped} (already had baseline).`,
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
