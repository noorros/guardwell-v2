// src/lib/compliance/policy-prereqs.ts
//
// Maps each PracticePolicy.policyCode to the TrainingCourse codes a
// user must complete (passed + non-expired) before they can sign the
// acknowledgment. v1 audit-defense feature port: courses gate
// signatures so "I read the policy" attestation is backed by
// "and I took the course that explains it."
//
// Map keys are PracticePolicy.policyCode (matches POLICY_METADATA core
// codes + PolicyTemplate library codes). Map values are arrays of
// TrainingCourse.code strings. An empty array means "no prerequisites
// — user can acknowledge directly."
//
// Adding a new pair: edit this file. The acknowledgePolicyAction does
// the lookup at sign time.

export const POLICY_PREREQ_COURSES: Record<string, string[]> = {
  // ── Core 9 v2 codes ────────────────────────────────────────────
  HIPAA_PRIVACY_POLICY: ["HIPAA_BASICS"],
  HIPAA_SECURITY_POLICY: ["HIPAA_SECURITY_AWARENESS"],
  HIPAA_BREACH_RESPONSE_POLICY: ["BREACH_NOTIFICATION_TRAINING"],
  HIPAA_MINIMUM_NECESSARY_POLICY: ["MINIMUM_NECESSARY_STANDARD"],
  HIPAA_NPP_POLICY: ["PATIENT_RIGHTS_UNDER_HIPAA"],
  HIPAA_WORKSTATION_POLICY: [
    "CYBERSECURITY_MEDICAL_OFFICES",
    "MFA_AUTHENTICATION_HYGIENE",
  ],
  OSHA_BBP_EXPOSURE_CONTROL_PLAN: ["BLOODBORNE_PATHOGEN_TRAINING"],
  OSHA_HAZCOM_PROGRAM: ["HAZCOM_TRAINING"],
  OSHA_EMERGENCY_ACTION_PLAN: ["FIRE_SAFETY_EVACUATION"],

  // ── Selected high-leverage library template codes ──────────────
  // Cyber-related templates from the v1 catalog port (PR #112)
  HIPAA_MULTI_FACTOR_AUTHENTICATION_POLICY: ["MFA_AUTHENTICATION_HYGIENE"],
  HIPAA_ENCRYPTION_POLICY: ["CYBERSECURITY_MEDICAL_OFFICES"],
  HIPAA_DATA_BACKUP_AND_RECOVERY_POLICY: ["RANSOMWARE_DEFENSE_PLAYBOOK"],
  HIPAA_PATIENT_PORTAL_PRIVACY_AND_SECURITY_POLICY: [
    "HIPAA_BASICS",
    "PHI_CLOUD_MOBILE",
  ],
  HIPAA_MOBILE_DEVICE_AND_BYOD_POLICY: ["PHI_CLOUD_MOBILE"],
  HIPAA_TELEHEALTH_POLICY: ["TELEHEALTH_HIPAA_COMPLIANCE"],
  HIPAA_SOCIAL_MEDIA_POLICY: ["HIPAA_SOCIAL_MEDIA"],

  // OSHA-related library templates
  OSHA_EXPOSURE_CONTROL_PLAN: ["BLOODBORNE_PATHOGEN_TRAINING"],
  OSHA_BLOODBORNE_PATHOGEN_TRAINING_POLICY: ["BLOODBORNE_PATHOGEN_TRAINING"],
  OSHA_PERSONAL_PROTECTIVE_EQUIPMENT_PPE_SELECTION_AND_USE_POLICY: [
    "PPE_SELECTION_USE",
  ],
  OSHA_HAZARD_COMMUNICATION_PROGRAM: ["HAZCOM_TRAINING"],
  OSHA_HAZCOM_EMPLOYEE_TRAINING_POLICY: ["HAZCOM_TRAINING"],
  OSHA_EMERGENCY_ACTION_PLAN_LIBRARY: ["FIRE_SAFETY_EVACUATION"],
  OSHA_INJURY_AND_ILLNESS_PREVENTION_PROGRAM_IIPP: [
    "WORKPLACE_SAFETY_FUNDAMENTALS",
  ],
  OSHA_WORKPLACE_VIOLENCE_PREVENTION_POLICY: ["WORKPLACE_VIOLENCE_PREVENTION"],
  OSHA_INFECTION_CONTROL_AND_PREVENTION_POLICY: [
    "INFECTION_CONTROL_PREVENTION",
  ],
  OSHA_MEDICAL_WASTE_DISPOSAL_POLICY: ["MEDICAL_WASTE_MANAGEMENT"],
  OSHA_OSHA_INJURY_AND_ILLNESS_RECORDKEEPING_POLICY: ["OSHA_RECORDKEEPING"],
  OSHA_ELECTRICAL_SAFETY_POLICY: ["ELECTRICAL_SAFETY"],
  OSHA_ANTI_HARASSMENT_AND_NON_DISCRIMINATION_POLICY: [
    "DISCRIMINATION_HARASSMENT_PREVENTION",
  ],
  OSHA_DRUG_FREE_WORKPLACE_POLICY: ["DRUG_FREE_WORKPLACE"],
  OSHA_ANAPHYLAXIS_EMERGENCY_RESPONSE_PROTOCOL: ["ANAPHYLAXIS_RESPONSE"],
  GENERAL_USP_797_SEC21_ALLERGEN_EXTRACT_MIXING_COMPETENCY_POLICY: [
    "USP_797_ALLERGEN_COMPOUNDING",
  ],
};

/** Returns the required course codes for a given policy code, or [] if
 * none are mapped. Stable + safe for unknown codes. */
export function getRequiredCourseCodesForPolicy(policyCode: string): string[] {
  return POLICY_PREREQ_COURSES[policyCode] ?? [];
}

/** Inverse lookup: given a course code, which policies REQUIRE it? Used
 * by the user dashboard "completing this course unlocks 2 policies"
 * messaging. */
export function getPoliciesRequiringCourse(courseCode: string): string[] {
  const out: string[] = [];
  for (const [policyCode, courses] of Object.entries(POLICY_PREREQ_COURSES)) {
    if (courses.includes(courseCode)) out.push(policyCode);
  }
  return out;
}
