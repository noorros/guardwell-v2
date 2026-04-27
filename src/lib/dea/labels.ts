// src/lib/dea/labels.ts
//
// Shared labels for DEA module UI + PDFs. Single source of truth so
// adding a new schedule (e.g. Cannabis rescheduling) is a 1-line
// change visible to all surfaces.

export type DeaSchedule =
  | "CI"
  | "CII"
  | "CIIN"
  | "CIII"
  | "CIIIN"
  | "CIV"
  | "CV";

export const SCHEDULE_VALUES: readonly DeaSchedule[] = [
  "CI",
  "CII",
  "CIIN",
  "CIII",
  "CIIIN",
  "CIV",
  "CV",
] as const;

export const SCHEDULE_LABELS: Record<DeaSchedule, string> = {
  CI: "Schedule I",
  CII: "Schedule II",
  CIIN: "Schedule II-N (Narcotic)",
  CIII: "Schedule III",
  CIIIN: "Schedule III-N (Narcotic)",
  CIV: "Schedule IV",
  CV: "Schedule V",
};

export const DISPOSAL_METHOD_LABELS: Record<string, string> = {
  REVERSE_DISTRIBUTOR: "Reverse distributor",
  DEA_TAKE_BACK: "DEA take-back program",
  DEA_DESTRUCTION: "DEA-witnessed destruction",
  OTHER: "Other (see notes)",
};

export const DISPOSAL_METHOD_VALUES = [
  "REVERSE_DISTRIBUTOR",
  "DEA_TAKE_BACK",
  "DEA_DESTRUCTION",
  "OTHER",
] as const;
