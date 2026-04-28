// src/lib/storage/reaper.ts
//
// Reaper: hard-deletes GCS objects + Evidence DB rows for any evidence that
// was soft-deleted (status=DELETED) more than 30 days ago.
//
// Design:
//   - Never called inline (slow). Called only from /api/cron/evidence-reaper.
//   - Per-row GCS failures are caught and counted but do NOT abort the
//     remaining rows — a failed GCS delete is logged; the GCS lifecycle rule
//     (365-day hard-delete) provides a safety net.
//   - DB rows are hard-deleted after the GCS attempt (success or fail) so the
//     reaper doesn't accumulate a backlog.
//   - No PHI in logs — logs only evidence IDs and gcsKey (which is
//     practices/<practiceId>/<entityType>/<entityId>/<safe-filename>).

import { db } from "@/lib/db";
import { deleteFile } from "./gcs";

const RETENTION_DAYS = 30;

export interface ReaperResult {
  /** Number of Evidence rows hard-deleted from DB. */
  purged: number;
  /** Number of GCS object deletions that failed (logged, not thrown). */
  errors: number;
}

/**
 * Scan Evidence rows with deletedAt < now() - 30 days.
 * For each row: attempt GCS delete, then hard-delete the DB row.
 */
export async function runReaper(): Promise<ReaperResult> {
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const stale = await db.evidence.findMany({
    where: {
      status: "DELETED",
      deletedAt: { lt: cutoff },
    },
    select: { id: true, gcsKey: true, deletedAt: true },
  });

  let purged = 0;
  let errors = 0;

  for (const row of stale) {
    try {
      await deleteFile(row.gcsKey);
    } catch (err) {
      errors++;
      console.error(
        `[evidence-reaper] GCS delete failed for evidence ${row.id} key=${row.gcsKey}:`,
        err instanceof Error ? err.message : err,
      );
    }
    // Hard-delete the DB row regardless of GCS outcome.
    await db.evidence.delete({ where: { id: row.id } });
    purged++;
  }

  return { purged, errors };
}
