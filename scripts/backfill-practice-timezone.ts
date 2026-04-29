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
}> {
  const candidates = await db.practice.findMany({
    where: { timezone: null },
    select: { id: true, primaryState: true },
  });

  let updated = 0;

  for (const p of candidates) {
    const tz = defaultTimezoneForState(p.primaryState);
    await db.practice.update({
      where: { id: p.id },
      data: { timezone: tz },
    });
    updated++;
  }

  return { updated };
}

if (require.main === module) {
  backfillPracticeTimezone()
    .then(({ updated }) => {
      console.log(`Done. updated=${updated}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
