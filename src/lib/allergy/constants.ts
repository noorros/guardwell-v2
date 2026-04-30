// src/lib/allergy/constants.ts
//
// Single source of truth for the time-window constants used by the
// USP §21 / allergy module. Audit #21 / Allergy MIN-1 + MIN-2: prior
// to consolidation, `SIX_MONTHS_MS` was defined in three files with
// two different values (180 vs 183 days), and `KIT_WINDOW_MS` /
// `FRIDGE_WINDOW_MS` were duplicated as inline magic constants in
// derivation rules. Centralizing here keeps the derivation pipeline,
// the page-level history truncation, the inactivity-banner check, and
// any future surface aligned to one canonical window.
//
// All values are expressed in milliseconds (multiplied by `DAY_MS`)
// so callers can compose them directly with `Date.now()` /
// `new Date().getTime()` arithmetic without re-converting.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * USP §21.5 inactivity threshold for compounding-personnel competency.
 * 183 days matches v1's authoritative computation and the projection
 * layer's existing constant. Page-level history truncation previously
 * used 180; both surfaces now share this single value.
 */
export const SIX_MONTHS_MS = 183 * DAY_MS;

/**
 * USP §21.4 emergency-kit verification cadence: a kit check older than
 * 90 days drops `ALLERGY_EMERGENCY_KIT_CURRENT` to GAP regardless of
 * `allItemsPresent` state.
 */
export const KIT_WINDOW_MS = 90 * DAY_MS;

/**
 * USP §21.4 refrigerator-temperature log cadence: derivation only
 * considers fridge readings within the last 30 days when scoring
 * `ALLERGY_REFRIGERATOR_LOG`.
 */
export const FRIDGE_WINDOW_MS = 30 * DAY_MS;

/**
 * USP §21.6 annual-drill rule: anaphylaxis drill must occur within the
 * trailing 365 days for `ALLERGY_ANNUAL_DRILL` to be COMPLIANT.
 */
export const DRILL_WINDOW_MS = 365 * DAY_MS;
