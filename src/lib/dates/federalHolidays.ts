// src/lib/dates/federalHolidays.ts
//
// US Federal-holiday awareness for business-day arithmetic. Used by the
// HIPAA breach-clock derivation (audit #21 HIPAA M-3, Wave-4 D4) so the
// CA-15-business-day window — and any other state with `useBusinessDays:
// true` — correctly extends across federal holidays. Without this, a
// breach discovered on a Friday before Memorial Day weekend would be
// counted against the practice three days too early.
//
// Scope deliberately narrow:
//   - 11 US federal holidays per 5 U.S.C. § 6103.
//   - Observed-date rule per 5 U.S.C. § 6103(b)(2): Saturday → preceding
//     Friday, Sunday → following Monday. Applied only to fixed-date
//     holidays (NYD / Juneteenth / Indep. Day / Veterans Day / Christmas).
//   - "Floating" Monday/Thursday holidays (MLK / Presidents' / Memorial /
//     Labor / Columbus / Thanksgiving) never fall on a weekend, so they
//     have no observed-date adjustment.
//
// Out of scope:
//   - State holidays (CA Cesar Chavez Day, etc.). The breach-clock rules
//     that use this helper are state-AG-notification windows; CA's 15-
//     business-day rule (Health & Safety Code §1280.15(b)) does not
//     reference state holidays in the statute.
//   - Religious observances, executive-order one-off closures (e.g.,
//     2018 Christmas Eve closure).
//   - Non-US calendars.

const NEW_YEARS_DAY = { month: 0, day: 1 } as const;        // Jan 1
const JUNETEENTH = { month: 5, day: 19 } as const;          // Jun 19
const INDEPENDENCE_DAY = { month: 6, day: 4 } as const;     // Jul 4
const VETERANS_DAY = { month: 10, day: 11 } as const;       // Nov 11
const CHRISTMAS_DAY = { month: 11, day: 25 } as const;      // Dec 25

const FIXED_DATE_HOLIDAYS = [
  NEW_YEARS_DAY,
  JUNETEENTH,
  INDEPENDENCE_DAY,
  VETERANS_DAY,
  CHRISTMAS_DAY,
];

/**
 * UTC year/month/day extraction. Internal helper; we operate in UTC
 * throughout because the breach-clock callers anchor everything to UTC
 * midnight.
 */
function ymd(d: Date): { y: number; m: number; day: number; dow: number } {
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    day: d.getUTCDate(),
    dow: d.getUTCDay(), // 0 = Sun, 6 = Sat
  };
}

function makeUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/**
 * Returns the Nth weekday-of-month (1-indexed, weekday 0=Sun … 6=Sat).
 * Used for Monday/Thursday-anchored federal holidays.
 */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number,
): Date {
  const first = makeUtcDate(year, month, 1);
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return makeUtcDate(year, month, 1 + offset + (n - 1) * 7);
}

/** Last weekday-of-month (last Monday for Memorial Day). */
function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
): Date {
  // Start at the last day of the month, walk backward.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const last = makeUtcDate(year, month, lastDay);
  const lastWeekday = last.getUTCDay();
  const back = (lastWeekday - weekday + 7) % 7;
  return makeUtcDate(year, month, lastDay - back);
}

/**
 * Apply the federal observed-date rule (5 U.S.C. § 6103(b)(2)) to a
 * fixed-date holiday: Saturday → preceding Friday, Sunday → following
 * Monday. Returns the actual weekday on which federal employees observe
 * the holiday.
 */
function observedDate(holidayDate: Date): Date {
  const { dow, y, m, day } = ymd(holidayDate);
  if (dow === 0) return makeUtcDate(y, m, day + 1); // Sunday → Monday
  if (dow === 6) return makeUtcDate(y, m, day - 1); // Saturday → Friday
  return holidayDate;
}

/**
 * Compute every observed federal-holiday date for the given calendar
 * year. Returns 11 dates (one per holiday). Does NOT pre-cache across
 * years — callers typically operate within a single year window so
 * computing on demand is cheap (microseconds per call).
 */
export function getUsFederalHolidaysForYear(year: number): Date[] {
  const holidays: Date[] = [];

  // Fixed-date holidays with observed-date adjustment.
  for (const h of FIXED_DATE_HOLIDAYS) {
    holidays.push(observedDate(makeUtcDate(year, h.month, h.day)));
  }

  // Floating holidays — anchored to a specific weekday of the month, so
  // they never need observed-date adjustment.
  // MLK Day — 3rd Monday of January.
  holidays.push(nthWeekdayOfMonth(year, 0, 1, 3));
  // Presidents' Day — 3rd Monday of February.
  holidays.push(nthWeekdayOfMonth(year, 1, 1, 3));
  // Memorial Day — last Monday of May.
  holidays.push(lastWeekdayOfMonth(year, 4, 1));
  // Labor Day — 1st Monday of September.
  holidays.push(nthWeekdayOfMonth(year, 8, 1, 1));
  // Columbus Day — 2nd Monday of October.
  holidays.push(nthWeekdayOfMonth(year, 9, 1, 2));
  // Thanksgiving — 4th Thursday of November.
  holidays.push(nthWeekdayOfMonth(year, 10, 4, 4));

  return holidays.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * True when `date` falls on an observed US federal holiday. Only the
 * Y/M/D are compared (UTC) — the time component of `date` is ignored.
 */
export function isUsFederalHoliday(date: Date): boolean {
  const { y, m, day } = ymd(date);
  const holidays = getUsFederalHolidaysForYear(y);
  return holidays.some((h) => {
    const hYmd = ymd(h);
    return hYmd.y === y && hYmd.m === m && hYmd.day === day;
  });
}

/**
 * Add `days` business days to `start`, returning the resulting Date.
 * Skips Saturdays and Sundays unconditionally; when `opts.skipHolidays`
 * is true, also skips observed US federal holidays.
 *
 * Operates in UTC. The HIPAA breach-clock callers all anchor to UTC
 * midnight so this matches their convention.
 *
 * Edge cases:
 *   - `days = 0` returns a clone of `start` even if start itself is a
 *     non-business day. We never decide compliance on a `days = 0`
 *     window; this matches the prior implementation.
 *   - Negative `days` is not supported (existing callers always add).
 */
export function addBusinessDays(
  start: Date,
  days: number,
  opts: { skipHolidays?: boolean } = {},
): Date {
  const result = new Date(start);
  if (days <= 0) return result;
  let added = 0;
  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dow = result.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekend
    if (opts.skipHolidays && isUsFederalHoliday(result)) continue;
    added += 1;
  }
  return result;
}
