// src/lib/audit/format.ts
//
// Practice-aware date formatters. Replaces every `.toISOString().slice(0, 10)`
// call site so audit-defense PDFs, notification email bodies, and UI badges
// render dates in the practice's timezone (set via Practice.timezone).
//
// Implementation detail: native Intl.DateTimeFormat is used (V8-backed in
// Node 20+, identical in browsers). No `date-fns-tz` dependency.

const DATE_FALLBACK_TZ = "UTC";

const validTzCache = new Map<string, boolean>();

/**
 * Returns true when `tz` is a valid IANA zone accepted by V8/Intl.
 * Cached per process for hot-path call sites (notifications + PDF rows).
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  const cached = validTzCache.get(tz);
  if (cached !== undefined) return cached;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    validTzCache.set(tz, true);
    return true;
  } catch {
    validTzCache.set(tz, false);
    return false;
  }
}

function resolveTimezone(tz: string | null | undefined): string {
  if (!tz) return DATE_FALLBACK_TZ;
  return isValidTimezone(tz) ? tz : DATE_FALLBACK_TZ;
}

/**
 * Format `date` as YYYY-MM-DD in the practice's `tz`. Replaces every
 * `.toISOString().slice(0, 10)` call site. Null/invalid tz falls back to UTC.
 *
 * Locale "en-CA" natively renders YYYY-MM-DD (no manual part-piecing).
 */
export function formatPracticeDate(
  date: Date,
  tz: string | null | undefined,
): string {
  const zone = resolveTimezone(tz);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Format `date` as "Apr 29, 2026" in the practice's `tz`.
 * For UI badges + email body where a friendlier surface is needed.
 */
export function formatPracticeDateLong(
  date: Date,
  tz: string | null | undefined,
): string {
  const zone = resolveTimezone(tz);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Format `date` as "2026-04-29 15:42 MST" — date + 24h time + zone abbr.
 * Used for audit-trail PDF rows where a precise timestamp matters.
 */
export function formatPracticeDateTime(
  date: Date,
  tz: string | null | undefined,
): string {
  const zone = resolveTimezone(tz);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const datePart = `${get("year")}-${get("month")}-${get("day")}`;
  const timePart = `${get("hour")}:${get("minute")}`;
  const zoneAbbr = get("timeZoneName");
  return `${datePart} ${timePart} ${zoneAbbr}`;
}
