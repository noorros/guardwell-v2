// src/components/gw/PracticeProfileForm/types.ts
//
// Shared types for the unified PracticeProfileForm consumed by both
// /settings/practice (mode="settings") and /onboarding/compliance-profile
// (mode="onboarding").

export interface PracticeProfileInput {
  // Identity
  name: string;
  npiNumber: string | null;
  entityType: "COVERED_ENTITY" | "BUSINESS_ASSOCIATE";
  // Location
  primaryState: string;
  operatingStates: string[];
  addressStreet: string | null;
  addressSuite: string | null;
  addressCity: string | null;
  addressZip: string | null;
  // Practice
  specialty: string | null;
  providerCount: "SOLO" | "SMALL_2_5" | "MEDIUM_6_15" | "LARGE_16_PLUS";
  ehrSystem: string | null;
  // Settings-only (hidden in onboarding)
  staffHeadcount: number | null;
  phone: string | null;
}

export interface PracticeProfileFormProps {
  mode: "onboarding" | "settings";
  initial: PracticeProfileInput;
  onSubmit: (next: PracticeProfileInput) => Promise<{ ok: boolean; error?: string }>;
  submitLabel?: string;
  /**
   * Optional callback fired whenever the user changes the specialty pick.
   * Parents who own related state (e.g. compliance toggles in the
   * onboarding flow) subscribe to this to react to specialty bucket
   * changes — for example, untoggling MACRA/MIPS when DENTAL or ALLIED
   * is picked.
   */
  onSpecialtyChange?: (specialty: string | null) => void;
}
