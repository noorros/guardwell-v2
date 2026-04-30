/**
 * One-off pre-flight check for the unique index added in audit #21 PR #226:
 *   @@unique([practiceId, credentialTypeId, holderId, licenseNumber])
 *
 * Postgres NULLs-distinct semantics let multiple null-license rows coexist —
 * so the constraint only validates rows where licenseNumber IS NOT NULL.
 *
 * If this script reports any rows, prisma db push will FAIL on PR #226's
 * merge build. Resolve the duplicates first (via a separate dedup-fix
 * script that retains the lowest id per group + retires the rest) before
 * merging.
 *
 * Usage:
 *   npx tsx scripts/dedup-credentials-check.ts
 *
 * Exit code: 0 on success (zero or non-zero duplicates), prints summary.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DupRow {
  practiceId: string;
  credentialTypeId: string;
  holderId: string | null;
  licenseNumber: string | null;
  ct: bigint;
  ids: string[];
}

async function main() {
  console.log("Audit #21 #226 dedup pre-flight check");
  console.log("======================================");

  const rows = await prisma.$queryRaw<DupRow[]>`
    SELECT
      "practiceId",
      "credentialTypeId",
      "holderId",
      "licenseNumber",
      COUNT(*) AS ct,
      ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS ids
    FROM "Credential"
    WHERE "licenseNumber" IS NOT NULL
    GROUP BY "practiceId", "credentialTypeId", "holderId", "licenseNumber"
    HAVING COUNT(*) > 1
    ORDER BY ct DESC
  `;

  if (rows.length === 0) {
    console.log("✅ Zero duplicates. PR #226 unique index is safe to apply.");
    process.exit(0);
  }

  console.log(`⚠️  ${rows.length} duplicate group(s) found:`);
  for (const r of rows) {
    console.log(
      `  practice=${r.practiceId.slice(0, 8)}  type=${r.credentialTypeId.slice(0, 8)}  holder=${r.holderId?.slice(0, 8) ?? "—"}  license=${r.licenseNumber}  count=${r.ct}  ids=[${r.ids.map((i) => i.slice(0, 8)).join(",")}]`,
    );
  }
  console.log(
    `\n→ Resolve duplicates before merging PR #226. The lowest-createdAt row in each group should be kept; others retired/removed. The unique index will fail at prisma db push otherwise.`,
  );
  process.exit(0);
}

main()
  .catch((err) => {
    console.error("dedup-check failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
