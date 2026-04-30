// src/app/(dashboard)/programs/credentials/[id]/CredentialDetail/helpers.ts
//
// Pure helpers extracted from CredentialDetail.tsx (audit #21 MN-4
// — Wave-4 D4 file-organization). Kept type-only + computation-only so
// they can be unit-tested without React.

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Shape of a single CEU activity row returned by the page-level Prisma
 * query and rendered by the CEU panel + new-activity form.
 */
export interface CeuActivityRow {
  id: string;
  activityName: string;
  provider: string | null;
  activityDate: string; // ISO
  hoursAwarded: number;
  category: string | null;
  notes: string | null;
  certificateEvidence: {
    id: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    status: string;
  } | null;
}

/**
 * Internal CEU progress shape produced by computeCeuProgress and consumed
 * by the progress-bar UI. `bucket` drives the colour-coded label
 * (compliant / warning / risk).
 */
export interface CeuProgress {
  totalHours: number;
  requiredHours: number;
  windowStart: Date;
  pct: number; // 0..100+
  bucket: "low" | "mid" | "high";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * UUID generator with a degraded fallback for browsers (or test envs)
 * lacking `crypto.randomUUID`. Only used for client-allocated row ids.
 */
export function makeUuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Pure CEU progress reducer. Counts hours from activities whose
 * activityDate falls inside the rolling [now - windowMonths, now]
 * window. Returns 0% when requiredHours is 0 (no requirement defined).
 */
export function computeCeuProgress(
  activities: CeuActivityRow[],
  requiredHours: number,
  windowMonths: number,
): CeuProgress {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCMonth(windowStart.getUTCMonth() - windowMonths);
  const totalHours = activities.reduce((sum, a) => {
    const d = new Date(a.activityDate);
    return d >= windowStart ? sum + a.hoursAwarded : sum;
  }, 0);
  const pct = requiredHours > 0 ? (totalHours / requiredHours) * 100 : 0;
  const bucket: CeuProgress["bucket"] =
    pct >= 100 ? "high" : pct >= 50 ? "mid" : "low";
  return { totalHours, requiredHours, windowStart, pct, bucket };
}

// ── Form-input class strings ────────────────────────────────────────────────

/**
 * Shared input/textarea Tailwind class strings. Re-exported so the
 * extracted panel files render the same field styling as the original
 * monolithic CredentialDetail.tsx.
 */
export const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const TEXTAREA_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ── Reminder milestone helpers ──────────────────────────────────────────────

/**
 * Default milestone-day list rendered as the placeholder text in the
 * reminder-config form. Mirrors the cron-pipeline default in
 * `src/lib/notifications/generators.ts`.
 */
export const DEFAULT_MILESTONES = [90, 60, 30, 7];

/** Comma-separator for the milestones text input. */
export function formatMilestones(days: number[]): string {
  return days.join(", ");
}

/**
 * Parse the comma-separated milestones text input into a sorted, valid
 * `number[]`. Returns `{ error }` for any malformed entry so the form
 * can surface a precise message instead of swallowing the failure.
 */
export function parseMilestones(input: string): number[] | { error: string } {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return [];
  if (parts.length > 20) {
    return { error: "At most 20 milestone days." };
  }
  const result: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (!Number.isInteger(n) || n < 0 || n > 365 || `${n}` !== p) {
      return {
        error: `Each milestone must be a whole number between 0 and 365 (got "${p}").`,
      };
    }
    result.push(n);
  }
  return result;
}
