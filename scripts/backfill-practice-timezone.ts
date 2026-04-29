// scripts/backfill-practice-timezone.ts
//
// One-shot migration: for every Practice with timezone null, set
// timezone = defaultTimezoneForState(primaryState). Idempotent.
//
// Run via: npx tsx scripts/backfill-practice-timezone.ts

import { db } from "@/lib/db";
import { defaultTimezoneForState } from "@/lib/timezone/stateDefaults";

export async function backfillPracticeTimezone(): Promise<{
  updated: number;
  skipped: number;
}> {
  const candidates = await db.practice.findMany({
    where: { timezone: null },
    select: { id: true, primaryState: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const p of candidates) {
    const tz = defaultTimezoneForState(p.primaryState);
    if (!tz) {
      skipped++;
      continue;
    }
    await db.practice.update({
      where: { id: p.id },
      data: { timezone: tz },
    });
    updated++;
  }

  return { updated, skipped };
}

if (require.main === module) {
  backfillPracticeTimezone()
    .then(({ updated, skipped }) => {
      console.log(`Done. updated=${updated} skipped=${skipped}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
