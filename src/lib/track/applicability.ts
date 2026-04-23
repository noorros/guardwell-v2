// src/lib/track/applicability.ts
//
// Picks the right Track template for a practice given its compliance
// profile. Templates are keyed by specialtyCategory. Unknown / null /
// non-mappable values fall through to GENERIC.

export type TrackTemplateCode =
  | "GENERAL_PRIMARY_CARE"
  | "DENTAL"
  | "BEHAVIORAL"
  | "GENERIC";

export function pickTemplateForProfile(profile: {
  specialtyCategory: string | null;
}): TrackTemplateCode {
  switch (profile.specialtyCategory) {
    case "PRIMARY_CARE":
      return "GENERAL_PRIMARY_CARE";
    case "DENTAL":
      return "DENTAL";
    case "BEHAVIORAL":
      return "BEHAVIORAL";
    default:
      return "GENERIC";
  }
}
