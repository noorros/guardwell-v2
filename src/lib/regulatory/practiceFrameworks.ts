// src/lib/regulatory/practiceFrameworks.ts
//
// Resolves which RegulatoryFramework codes are enabled for a practice.
// Used by the analyze cron to fan out per-practice alerts: we only
// alert practices on regulatory news that touches a framework they've
// enabled.

import { db } from "@/lib/db";
import { ALL_FRAMEWORK_CODES, type FrameworkCode } from "./types";

const KNOWN_CODES = new Set<string>(ALL_FRAMEWORK_CODES);

export async function getActiveFrameworksForPractice(
  practiceId: string,
): Promise<FrameworkCode[]> {
  const rows = await db.practiceFramework.findMany({
    where: { practiceId, enabled: true },
    select: { framework: { select: { code: true } } },
  });
  return rows
    .map((r) => r.framework.code)
    .filter((c): c is FrameworkCode => KNOWN_CODES.has(c));
}
