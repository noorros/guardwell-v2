// src/lib/specialties.ts
//
// Curated specialty list (30 specifics + "Other"). The user picks a specific;
// the legacy 6-bucket category is DERIVED from that pick. Bucket drives
// compliance defaults (e.g. DENTAL/ALLIED → MACRA/MIPS exemption); the user
// never sees the bucket name.

export type SpecialtyCategory =
  | "PRIMARY_CARE"
  | "SPECIALTY"
  | "DENTAL"
  | "BEHAVIORAL"
  | "ALLIED"
  | "OTHER";

export interface SpecialtyEntry {
  value: string;
  bucket: SpecialtyCategory;
}

/** Alphabetical curated list (30 specifics + "Other" tail). */
export const SPECIALTIES: readonly SpecialtyEntry[] = [
  { value: "Allergy & Immunology", bucket: "SPECIALTY" },
  { value: "Behavioral Health", bucket: "BEHAVIORAL" },
  { value: "Cardiology", bucket: "SPECIALTY" },
  { value: "Chiropractic", bucket: "ALLIED" },
  { value: "Dental — General", bucket: "DENTAL" },
  { value: "Dental — Specialty", bucket: "DENTAL" },
  { value: "Dermatology", bucket: "SPECIALTY" },
  { value: "Emergency Medicine", bucket: "SPECIALTY" },
  { value: "Endocrinology", bucket: "SPECIALTY" },
  { value: "Family Medicine", bucket: "PRIMARY_CARE" },
  { value: "Gastroenterology", bucket: "SPECIALTY" },
  { value: "General Surgery", bucket: "SPECIALTY" },
  { value: "Internal Medicine", bucket: "PRIMARY_CARE" },
  { value: "Nephrology", bucket: "SPECIALTY" },
  { value: "Neurology", bucket: "SPECIALTY" },
  { value: "Obstetrics & Gynecology", bucket: "SPECIALTY" },
  { value: "Occupational Therapy", bucket: "ALLIED" },
  { value: "Oncology", bucket: "SPECIALTY" },
  { value: "Ophthalmology", bucket: "SPECIALTY" },
  { value: "Orthopedics", bucket: "SPECIALTY" },
  { value: "Otolaryngology (ENT)", bucket: "SPECIALTY" },
  { value: "Pediatrics", bucket: "PRIMARY_CARE" },
  { value: "Physical Therapy", bucket: "ALLIED" },
  { value: "Plastic Surgery", bucket: "SPECIALTY" },
  { value: "Podiatry", bucket: "ALLIED" },
  { value: "Psychiatry", bucket: "BEHAVIORAL" },
  { value: "Pulmonology", bucket: "SPECIALTY" },
  { value: "Radiology", bucket: "SPECIALTY" },
  { value: "Speech-Language Pathology", bucket: "ALLIED" },
  { value: "Urology", bucket: "SPECIALTY" },
  { value: "Other", bucket: "OTHER" },
] as const;

const SPECIALTY_TO_BUCKET: ReadonlyMap<string, SpecialtyCategory> = new Map(
  SPECIALTIES.map((s) => [s.value, s.bucket]),
);

/**
 * Derive the legacy 6-bucket category from a specific specialty value.
 * Returns OTHER for any value not in the curated list (including empty,
 * null, undefined, or freeform entries).
 */
export function deriveSpecialtyCategory(
  specialty: string | null | undefined,
): SpecialtyCategory {
  if (!specialty) return "OTHER";
  return SPECIALTY_TO_BUCKET.get(specialty) ?? "OTHER";
}
