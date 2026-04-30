/**
 * One-off fix script for PR #226's unique index pre-flight (audit #21).
 *
 * The unique index `@@unique([practiceId, credentialTypeId, holderId,
 * licenseNumber])` applies regardless of `retiredAt` — Prisma `@@unique`
 * doesn't have a WHERE clause. So even soft-retired duplicates block the
 * index creation at `prisma db push`.
 *
 * Strategy: for each duplicate group (rows with same composite key,
 * licenseNumber NOT NULL), keep the canonical row's licenseNumber and
 * suffix all OTHER rows' licenseNumber with `-DUP-{shortId}` so they
 * remain unique. Canonical = the non-retired row with earliest createdAt
 * (or simply earliest createdAt if all retired).
 *
 * Idempotent: re-running after a successful run finds zero groups (the
 * suffixes are unique by id, so they can't collide).
 *
 * Usage:
 *   npx tsx scripts/dedup-credentials-fix.ts          # dry-run (default)
 *   APPLY=1 npx tsx scripts/dedup-credentials-fix.ts  # actually update rows
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === "1";

interface DupRow {
  practiceId: string;
  credentialTypeId: string;
  holderId: string | null;
  licenseNumber: string;
  ct: bigint;
  ids: string[];
  retiredFlags: boolean[];
}

async function main() {
  console.log(
    `Audit #21 #226 dedup-fix (${APPLY ? "APPLY mode" : "dry-run — pass APPLY=1 to actually update rows"})`,
  );
  console.log("======================================");

  // All composite-key collisions, regardless of retiredAt.
  const groups = await prisma.$queryRaw<DupRow[]>`
    SELECT
      "practiceId",
      "credentialTypeId",
      "holderId",
      "licenseNumber",
      COUNT(*) AS ct,
      ARRAY_AGG("id" ORDER BY ("retiredAt" IS NOT NULL), "createdAt" ASC) AS ids,
      ARRAY_AGG(("retiredAt" IS NOT NULL) ORDER BY ("retiredAt" IS NOT NULL), "createdAt" ASC) AS "retiredFlags"
    FROM "Credential"
    WHERE "licenseNumber" IS NOT NULL
    GROUP BY "practiceId", "credentialTypeId", "holderId", "licenseNumber"
    HAVING COUNT(*) > 1
    ORDER BY ct DESC
  `;

  if (groups.length === 0) {
    console.log("✅ No duplicates. Safe to merge PR #226.");
    process.exit(0);
  }

  console.log(`Found ${groups.length} duplicate group(s). Resolution plan:`);
  let toUpdate = 0;
  for (const g of groups) {
    const [keepId, ...dupIds] = g.ids;
    const keepRetired = g.retiredFlags[0];
    toUpdate += dupIds.length;
    console.log(
      `  group practice=${g.practiceId.slice(0, 8)}  license=${g.licenseNumber}  count=${g.ct}`,
    );
    console.log(
      `    keep:    ${keepId} ${keepRetired ? "(retired)" : "(active)"}`,
    );
    for (let i = 0; i < dupIds.length; i++) {
      const id = dupIds[i];
      const retired = g.retiredFlags[i + 1];
      const suffix = `-DUP-${id.slice(0, 8)}`;
      console.log(
        `    suffix:  ${id} ${retired ? "(retired)" : "(active)"} → ${g.licenseNumber}${suffix}`,
      );
    }
  }
  console.log(`\nTotal rows to update: ${toUpdate}`);

  if (!APPLY) {
    console.log("\nDry-run mode — no changes made. Re-run with APPLY=1 to apply.");
    process.exit(0);
  }

  console.log("\nApplying suffixes...");
  let updated = 0;
  for (const g of groups) {
    const [, ...dupIds] = g.ids;
    for (const id of dupIds) {
      const suffix = `-DUP-${id.slice(0, 8)}`;
      await prisma.credential.update({
        where: { id },
        data: { licenseNumber: `${g.licenseNumber}${suffix}` },
      });
      updated++;
    }
  }
  console.log(`✅ Updated ${updated} row(s). Safe to merge PR #226.`);
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
