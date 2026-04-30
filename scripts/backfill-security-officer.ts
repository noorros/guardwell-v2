// scripts/backfill-security-officer.ts
//
// One-shot migration: emit OFFICER_DESIGNATED for officerRole=SECURITY
// against every Practice that doesn't already have one. The OWNER is
// designated by default. Idempotent — practices with an existing
// SECURITY designation event (or whose OWNER's isSecurityOfficer flag
// is already true) are skipped.
//
// Closes audit #21 Chrome CHROME-5: practices created BEFORE PR #205
// (the Audit-#18 quick-win that defaulted SECURITY on practice
// creation) have no SECURITY officer event and therefore show GAP for
// HIPAA_SECURITY_OFFICER even though the OWNER is implicitly that
// role.
//
// Usage:
//   npx tsx scripts/backfill-security-officer.ts --dry-run
//   npx tsx scripts/backfill-security-officer.ts
//
// Idempotency: a second run produces 0 emissions because we filter on
// the existence of an OFFICER_DESIGNATED(SECURITY, designated=true)
// event-log row OR the PracticeUser.isSecurityOfficer flag (the audit
// #18 default-creation path sets the flag directly without emitting
// an event, so we honor either signal as "already designated").

import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectOfficerDesignated } from "@/lib/events/projections/officerDesignated";

export interface BackfillSecurityOfficerOptions {
  dryRun?: boolean;
  /** Override stdout for tests. Defaults to console.log. */
  log?: (message: string) => void;
}

export interface BackfillSecurityOfficerResult {
  checked: number;
  alreadyDesignated: number;
  backfilled: number;
  skippedNoOwner: number;
}

/**
 * Determine whether a Practice already has a Security Officer.
 *
 * Two signals — either qualifies:
 *
 *   1. An OFFICER_DESIGNATED event in the EventLog for this practice
 *      with payload.officerRole = SECURITY AND payload.designated =
 *      true AND no later toggle-off. (Walk most-recent-first; the
 *      first SECURITY event wins.)
 *
 *   2. Any active PracticeUser in this practice has
 *      isSecurityOfficer = true. The audit-#18 default-creation path
 *      (PR #205) sets this flag directly inside a transaction WITHOUT
 *      emitting an event, so practices created post-PR-205 have the
 *      flag but no event. We honor the flag as "already designated"
 *      to keep the backfill idempotent across both code paths.
 */
async function practiceHasSecurityOfficer(practiceId: string): Promise<boolean> {
  // Signal 2 first — cheap O(1) PracticeUser scan.
  const designatedUser = await db.practiceUser.findFirst({
    where: {
      practiceId,
      removedAt: null,
      isSecurityOfficer: true,
    },
    select: { id: true },
  });
  if (designatedUser) return true;

  // Signal 1 — walk SECURITY events most-recent-first; current state =
  // most recent event's `designated` flag.
  const events = await db.eventLog.findMany({
    where: {
      practiceId,
      type: "OFFICER_DESIGNATED",
      AND: [
        { payload: { path: ["officerRole"], equals: "SECURITY" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const last = events[0];
  if (!last) return false;
  const payload = last.payload as { designated?: boolean } | null;
  return payload?.designated === true;
}

export async function backfillSecurityOfficer(
  options: BackfillSecurityOfficerOptions = {},
): Promise<BackfillSecurityOfficerResult> {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? ((m: string) => console.log(m));

  const practices = await db.practice.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  let checked = 0;
  let alreadyDesignated = 0;
  let backfilled = 0;
  let skippedNoOwner = 0;

  for (const practice of practices) {
    checked++;

    if (await practiceHasSecurityOfficer(practice.id)) {
      alreadyDesignated++;
      log(
        `[skip] ${practice.id} (${practice.name}) — already has Security Officer.`,
      );
      continue;
    }

    // Pick the OWNER. Oldest non-removed OWNER by joinedAt.
    const owner = await db.practiceUser.findFirst({
      where: {
        practiceId: practice.id,
        role: "OWNER",
        removedAt: null,
      },
      orderBy: { joinedAt: "asc" },
      select: { id: true, userId: true },
    });

    if (!owner) {
      skippedNoOwner++;
      log(
        `[warn] ${practice.id} (${practice.name}) — no active OWNER; skipping.`,
      );
      continue;
    }

    if (dryRun) {
      log(
        `[dry-run] ${practice.id} (${practice.name}) — would designate practiceUserId=${owner.id} (userId=${owner.userId}) as Security Officer.`,
      );
      backfilled++;
      continue;
    }

    // System-generated backfill: actorUserId = OWNER (same convention
    // used elsewhere when no human triggered the write but the action
    // is "on behalf of" a known principal).
    const payload = {
      practiceUserId: owner.id,
      userId: owner.userId,
      officerRole: "SECURITY" as const,
      designated: true,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: owner.userId,
        type: "OFFICER_DESIGNATED",
        payload,
      },
      async (tx) =>
        projectOfficerDesignated(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    backfilled++;
    log(
      `[ok] ${practice.id} (${practice.name}) — designated practiceUserId=${owner.id} (userId=${owner.userId}) as Security Officer.`,
    );
  }

  return { checked, alreadyDesignated, backfilled, skippedNoOwner };
}

// CLI entrypoint
if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("Running in --dry-run mode (no DB writes).");
  }
  backfillSecurityOfficer({ dryRun })
    .then((r) => {
      console.log(
        `Done. checked=${r.checked} alreadyDesignated=${r.alreadyDesignated} backfilled=${r.backfilled} skippedNoOwner=${r.skippedNoOwner}${dryRun ? " (DRY RUN — no writes)" : ""}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
