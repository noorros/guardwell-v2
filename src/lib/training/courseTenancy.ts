// src/lib/training/courseTenancy.ts
//
// Phase 4 PR 4 — TrainingCourse tenancy helpers.
//
// TrainingCourse is GLOBAL — there is no `practiceId` column. System
// courses (HIPAA_BASICS etc.) and practice-authored custom courses share
// the same table. Custom courses are namespaced via the `code` column:
// `${practiceId}_${userCode}` per `createCustomCourseAction`. Practice
// IDs are cuids (lowercase letters + digits, ~25 chars) — system codes
// are uppercase like `HIPAA_BASICS`.
//
// These helpers exist so the Manage Courses admin sub-page (and any
// future surface that lists courses across practices) can answer two
// questions cheaply, in JS, without a SQL regex match:
//
//   1. "Is this code a custom course owned by THIS practice?"
//   2. "Is this code a system course (visible to every practice)?"
//
// The page query fetches every TrainingCourse row and applies
// `isSystemCourse(c.code) || isCustomForPractice(c.code, pu.practiceId)`
// — a practice never sees another practice's custom-course titles, which
// would otherwise be a privacy leak. The catalog is small (~30 courses)
// so client-side filtering is acceptable.

/**
 * sortOrder convention for TrainingCourse soft-retirement (Phase 4):
 * - System courses: seeded with their natural sort position (e.g. 1-100)
 * - Custom courses: created with sortOrder=999 (sorts after system)
 * - Retired courses: sortOrder=9999 (sorts last; treated as filtered-out
 *   by the catalog page)
 *
 * TODO(phase-4-followup): replace with a `retiredAt` column once the
 * schema migration lands. See projection/training.ts retire/restore
 * docstrings for the migration plan.
 */
export const RETIRED_SORT_ORDER = 9999;
export const DEFAULT_CUSTOM_SORT_ORDER = 999;

/** Cuid prefix detector: 'c' followed by 20+ lowercase-alphanum chars
 * then an underscore. Conservative — Prisma's default cuid is
 * `c[a-z0-9]{24}` (25 chars total) but we accept ≥20 for forward-compat
 * with shorter cuid variants. The ESLint rule's lint config doesn't
 * allow regex literals at top of files we want to share-import in tests,
 * so we keep this inline. */
// CUID v1 format: starts with `c` + 24 lowercase alphanumerics. Permissive
// at {20,} to accept legacy variants. If the schema's @default(cuid())
// migrates to cuid v2 / nanoid, update this regex AND the test fixtures
// in courseTenancy.test.ts. See prisma/schema.prisma model Practice.
const CUID_PREFIX_RE = /^c[a-z0-9]{20,}_/;

/**
 * True iff `code` is a custom-course code namespaced by `practiceId`.
 * Cheap string prefix test — exact match needed. A practice ID never
 * collides with a system-course prefix because system codes don't begin
 * with the cuid pattern (they're uppercase like HIPAA_BASICS).
 */
export function isCustomForPractice(
  code: string,
  practiceId: string,
): boolean {
  return code.startsWith(`${practiceId}_`);
}

/**
 * True iff `code` is a system course (visible to every practice).
 * A code is "system" when it does NOT match the cuid-prefix pattern that
 * identifies a practice-authored custom course. Edge case: a code like
 * "not_a_cuid_just_underscore" returns true — it's not custom-namespaced,
 * so it must be system. The strict CUID_PREFIX_RE prevents false positives
 * (e.g. "co_something" doesn't qualify because the lowercase-alphanum
 * length requirement isn't met).
 */
export function isSystemCourse(code: string): boolean {
  return !CUID_PREFIX_RE.test(code);
}
