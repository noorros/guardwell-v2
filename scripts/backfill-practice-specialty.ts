// scripts/backfill-practice-specialty.ts
//
// One-shot migration: for each Practice where specialty is null and a
// PracticeComplianceProfile row exists, derive a default specific specialty
// from the legacy 6-bucket specialtyCategory. Idempotent.
//
// Run via: npx tsx scripts/backfill-practice-specialty.ts

import { db } from "@/lib/db";

const BUCKET_TO_SPECIFIC: Record<string, string> = {
  PRIMARY_CARE: "Family Medicine",
  DENTAL: "Dental — General",
  BEHAVIORAL: "Behavioral Health",
  ALLIED: "Physical Therapy",
  SPECIALTY: "Other", // too broad to guess
  OTHER: "Other",
};

export async function backfillPracticeSpecialty(): Promise<{
  updated: number;
  skipped: number;
}> {
  const candidates = await db.practice.findMany({
    where: { specialty: null },
    include: { complianceProfile: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const p of candidates) {
    if (!p.complianceProfile?.specialtyCategory) {
      skipped++;
      continue;
    }
    const target = BUCKET_TO_SPECIFIC[p.complianceProfile.specialtyCategory];
    if (!target) {
      skipped++;
      continue;
    }
    await db.practice.update({
      where: { id: p.id },
      data: { specialty: target },
    });
    updated++;
  }

  return { updated, skipped };
}

// Run as CLI when invoked directly
if (require.main === module) {
  backfillPracticeSpecialty()
    .then(({ updated, skipped }) => {
      console.log(`Done. updated=${updated} skipped=${skipped}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
