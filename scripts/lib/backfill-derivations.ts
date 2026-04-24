// scripts/lib/backfill-derivations.ts
//
// Retroactively trigger rederive for every (practice × evidence code)
// that a given framework's requirements accept. Fixes the gotcha where
// seeding a new framework with acceptedEvidenceTypes that reference
// already-existing evidence (officer flags, adopted policies, completed
// training) does NOT flip ComplianceItems — rederiveRequirementStatus
// only runs from projections on new events.
//
// Call at the end of each framework seed script AFTER upserting the
// framework + requirements + practice activations. Safe to re-run: the
// no-op guards in rederive skip identical states, and the USER-override
// guard protects manual radio choices from being clobbered.

import type { PrismaClient } from "@prisma/client";
import { rederiveRequirementStatus } from "../../src/lib/compliance/derivation/rederive";

export async function backfillFrameworkDerivations(
  db: PrismaClient,
  frameworkCode: string,
): Promise<void> {
  const requirements = await db.regulatoryRequirement.findMany({
    where: { framework: { code: frameworkCode } },
    select: { acceptedEvidenceTypes: true, code: true },
  });

  // Gather the distinct evidence codes this framework cares about.
  const evidenceCodes = new Set<string>();
  for (const r of requirements) {
    for (const c of r.acceptedEvidenceTypes) evidenceCodes.add(c);
  }

  if (evidenceCodes.size === 0) {
    console.log(
      `  Backfill ${frameworkCode}: no acceptedEvidenceTypes across ${requirements.length} requirements — nothing to backfill.`,
    );
    return;
  }

  const practices = await db.practice.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  let totalRederived = 0;
  // Bump transaction timeout from default 5s. Across 47+ evidence codes
  // and Cloud SQL proxy latency, the per-practice walk routinely takes
  // 5-15s. Maximum interactive transaction window in Postgres is much
  // larger; we cap at 60s to keep a clear ceiling.
  for (const p of practices) {
    await db.$transaction(
      async (tx) => {
        for (const code of evidenceCodes) {
          const { rederived } = await rederiveRequirementStatus(tx, p.id, code);
          totalRederived += rederived;
        }
      },
      { timeout: 60_000, maxWait: 5_000 },
    );
  }

  console.log(
    `  Backfill ${frameworkCode}: walked ${practices.length} practice(s) × ${evidenceCodes.size} evidence code(s) → ${totalRederived} ComplianceItem flip(s).`,
  );
}
