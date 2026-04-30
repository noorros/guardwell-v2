/**
 * One-off fix script for PR #226's unique index pre-flight (audit #21).
 *
 * If `dedup-credentials-check.ts` reports duplicates, this script resolves
 * them by retiring all but the lowest-createdAt row per group. Surviving
 * row keeps the original id + history; retired rows get retiredAt + a
 * retiredReason explaining the dedup.
 *
 * Idempotent — re-running after the fix is a no-op (retiredAt rows are
 * skipped by the duplicate query).
 *
 * Usage:
 *   npx tsx scripts/dedup-credentials-fix.ts          # dry-run by default
 *   APPLY=1 npx tsx scripts/dedup-credentials-fix.ts  # actually retire rows
 *
 * Exit code: 0 on success, 1 on error.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

interface DupRow {
  practiceId: string;
  credentialTypeId: string;
  holderId: string | null;
  licenseNumber: string | null;
  ct: bigint;
  ids: string[];
}

async function main() {
  console.log(
    `Audit #21 #226 dedup-fix (${APPLY ? "APPLY mode" : "dry-run — pass APPLY=1 to actually retire rows"})`,
  );
  console.log("======================================");

  // Same query as dedup-check, with retiredAt: null filter so we don't
  // re-retire already-retired duplicates on re-run.
  const groups = await prisma.$queryRaw<DupRow[]>`
    SELECT
      "practiceId",
      "credentialTypeId",
      "holderId",
      "licenseNumber",
      COUNT(*) AS ct,
      ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS ids
    FROM "Credential"
    WHERE "licenseNumber" IS NOT NULL
      AND "retiredAt" IS NULL
    GROUP BY "practiceId", "credentialTypeId", "holderId", "licenseNumber"
    HAVING COUNT(*) > 1
    ORDER BY ct DESC
  `;

  if (groups.length === 0) {
    console.log("✅ No active duplicates. Safe to merge PR #226.");
    process.exit(0);
  }

  console.log(`Found ${groups.length} duplicate group(s). Resolution plan:`);
  let toRetire = 0;
  for (const g of groups) {
    const [keepId, ...retireIds] = g.ids;
    toRetire += retireIds.length;
    console.log(
      `  group practice=${g.practiceId.slice(0, 8)}  license=${g.licenseNumber}  count=${g.ct}`,
    );
    console.log(`    keep:    ${keepId}`);
    for (const r of retireIds) console.log(`    retire:  ${r}`);
  }
  console.log(`\nTotal rows to retire: ${toRetire}`);

  if (!APPLY) {
    console.log("\nDry-run mode — no changes made. Re-run with APPLY=1 to retire.");
    process.exit(0);
  }

  console.log("\nApplying retirements...");
  const now = new Date();
  let retired = 0;
  for (const g of groups) {
    const [, ...retireIds] = g.ids;
    for (const id of retireIds) {
      await prisma.credential.update({
        where: { id },
        data: {
          retiredAt: now,
          retiredReason: `Audit #21 #226 dedup — duplicate of ${g.ids[0]}`,
        },
      });
      retired++;
    }
  }
  console.log(`✅ Retired ${retired} duplicate row(s). Safe to merge PR #226.`);
  process.exit(0);
}

main()
  .catch((err) => {
    console.error("dedup-fix failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
