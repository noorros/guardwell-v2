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

// Process-global Intl.DateTimeFormat cache keyed by "${zone}::${kind}".
// Bounded by (supported zones × 3 kinds) ≈ 30 entries for our supported list.
// Eliminates repeated ICU object construction on the notification-digest hot path.
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getDtf(
  zone: string,
  kind: "date" | "long" | "datetime" | "date-input",
): Intl.DateTimeFormat {
  const key = `${zone}::${kind}`;
  const hit = dtfCache.get(key);
  if (hit) return hit;
  let dtf: Intl.DateTimeFormat;
  if (kind === "date" || kind === "date-input") {
    // Same shape as the "date" formatter — kept as a separate cache key
    // so a future divergence (e.g. ISO-vs-locale) is a one-line change.
    dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } else if (kind === "long") {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } else {
    dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
  }
  dtfCache.set(key, dtf);
  return dtf;
}

/**
 * Returns true when `tz` is a valid IANA zone accepted by V8/Intl.
 * Accepts null/undefined (returns false). Cached per process for hot-path
 * call sites (notifications + PDF rows).
 */
export function isValidTimezone(tz: string | null | undefined): boolean {
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
  return getDtf(zone, "date").format(date);
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
  return getDtf(zone, "long").format(date);
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
  const parts = getDtf(zone, "datetime").formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const datePart = `${get("year")}-${get("month")}-${get("day")}`;
  const timePart = `${get("hour")}:${get("minute")}`;
  const zoneAbbr = get("timeZoneName");
  return `${datePart} ${timePart} ${zoneAbbr}`;
}

/**
 * Format `date` (Date or ISO string) as YYYY-MM-DD as observed in the
 * practice's `tz`. Suitable for the `value` attribute of `<input type="date">`.
 *
 * Distinct from `formatPracticeDate` only in input shape: this helper
 * accepts ISO strings + null and returns "" for null — the form-friendly
 * round-trip behavior the date-input element expects. The on-the-wire
 * format is identical (YYYY-MM-DD via en-CA locale).
 *
 * Replaces `.slice(0, 10)` and local `isoToYmd` helpers across edit
 * forms — a date entered in California now renders as the same calendar
 * day in a New York reviewer's preview, instead of the day before.
 */
export function formatPracticeDateForInput(
  date: Date | string | null | undefined,
  tz: string | null | undefined,
): string {
  if (date == null) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  // Guard against unparseable strings — returning "" matches the null path
  // and keeps the date input rendered in its empty state instead of "Invalid".
  if (Number.isNaN(d.getTime())) return "";
  const zone = resolveTimezone(tz);
  return getDtf(zone, "date-input").format(d);
}

/**
 * Returns [startUtc, endUtc) — the UTC instants that bracket the calendar
 * year `year` as observed in practice timezone `tz`. Use for SQL filters
 * like `where: { occurredAt: { gte: startUtc, lt: endUtc } }` so an
 * incident at 2026-12-31 23:00 Pacific is grouped with the 2026 form
 * (not 2027) — the regulator-relevant calendar year is the practice's
 * local year, not UTC.
 *
 * Strategy: find the first millisecond of Jan 1 in the target zone by
 * iterating UTC candidates with a binary-style probe — but for IANA zones
 * the offset is monotonic over a year boundary, so a single offset-aware
 * formatToParts round-trip is sufficient and accurate to the minute.
 */
export function practiceYearBoundsUtc(
  year: number,
  tz: string | null | undefined,
): { startUtc: Date; endUtc: Date } {
  return {
    startUtc: zonedYmdToUtc(year, 1, 1, tz),
    endUtc: zonedYmdToUtc(year + 1, 1, 1, tz),
  };
}

/**
 * Returns the UTC Date that corresponds to YYYY-MM-DD 00:00:00 in the
 * given timezone. Internal helper for `practiceYearBoundsUtc` — kept
 * non-exported until a second caller appears.
 *
 * Algorithm: pick a UTC candidate, ask Intl what zoned wall-clock that
 * represents, compute the offset, subtract it. Iterate once because DST
 * could put the first candidate on the wrong side of a transition; two
 * iterations always converge for a single midnight target.
 */
function zonedYmdToUtc(
  year: number,
  month: number,
  day: number,
  tz: string | null | undefined,
): Date {
  const zone = resolveTimezone(tz);
  // Initial candidate: treat the wall-clock as if it were UTC.
  let utcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = getZoneOffsetMinutes(new Date(utcMs), zone);
    const corrected = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMin * 60_000;
    if (corrected === utcMs) break;
    utcMs = corrected;
  }
  return new Date(utcMs);
}

function getZoneOffsetMinutes(at: Date, zone: string): number {
  // Use a fixed-format DTF that exposes year/month/day/hour/minute parts in
  // the target zone. Difference between the zoned wall clock (interpreted
  // as if UTC) and the actual UTC instant = offset in minutes.
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // Some ICU builds emit "24" for midnight at the boundary — normalize to 0.
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}
