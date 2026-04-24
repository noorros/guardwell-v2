// scripts/seed-state-overlays.ts
//
// State-overlay requirements per ADR-0002 "Per-state overlays: same
// framework, filter requirements by jurisdictionFilter at query time."
//
// Overlay requirements live inside their parent federal framework
// (e.g. a California HIPAA overlay sits in the HIPAA framework with
// `jurisdictionFilter: ["CA"]`) so practices see a single unified
// requirement list filtered by their primaryState + operatingStates.
//
// Naming convention: <FRAMEWORK>_<STATE>_<ruleName>. The state segment
// keeps codes collision-free against federal siblings and makes the
// origin readable in activity feeds (e.g. "Auto-derived from
// HIPAA_CA_BREACH_NOTIFICATION_72HR").
//
// Build-out is incremental: batch 1 covered the 10 highest-customer-
// volume states (CA, TX, NY, FL, IL, WA, MA, CO, VA, NJ). Batch 2
// extended coverage to the next 10 (OR, NV, UT, GA, NC, OH, MI, PA, MD,
// MN). Batch 3 added 10 more (AZ, CT, TN, IN, WI, KY, LA, IA, MO, AL).
// Batch 4 (2026-04-24 evening) completes 50-state + DC coverage with
// the remaining 21 jurisdictions — every state now has at minimum a
// breach-notification overlay. Most are "most expedient" rules; a few
// have specific windows (ME 30d, NM 45d, RI 45d, SD 60d).

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { backfillFrameworkDerivations } from "./lib/backfill-derivations";

config({ path: ".env" });

const db = new PrismaClient();

interface StateOverlayFixture {
  frameworkCode: string;
  code: string;
  title: string;
  citation: string;
  severity: "CRITICAL" | "STANDARD" | "OPTIONAL";
  weight: number;
  description: string;
  jurisdictionFilter: string[];
  acceptedEvidenceTypes: string[];
  sortOrder: number;
}

// State overlays seeded in batches. Batch 1 covers the 10 highest-
// customer-volume states with their key delta(s) from federal HIPAA —
// usually breach-notification timing tighter than 60 days, or a
// privacy/consent statute broader than HIPAA. Non-applicable practices
// never see these (jurisdictionFilter gates rendering + scoring).
//
// Severity is mostly STANDARD (these aren't federal-level CRITICAL
// unless the state timeline is strict enough to trigger enforcement
// quickly — CA 15-biz-day, IL BIPA written consent, NY SHIELD
// reasonable security).
const OVERLAYS: StateOverlayFixture[] = [
  // ─── California (CA) ─────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_CA_BREACH_NOTIFICATION_72HR",
    title: "Breach notification within 15 business days (CA)",
    citation: "Cal. Civil Code §56.36 · Health & Safety Code §1280.15",
    severity: "CRITICAL",
    weight: 2,
    description:
      "California requires notice of medical-information breaches within 15 business days to both the affected individual and the California Department of Public Health — a stricter timeline than HIPAA's 60-day ceiling. Practices must meet both.",
    jurisdictionFilter: ["CA"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_15_BIZ_DAYS"],
    sortOrder: 200,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_CA_CMIA_AUTHORIZATION",
    title: "CMIA-compliant patient authorization (CA)",
    citation: "Confidentiality of Medical Information Act — Cal. Civil Code §56.11",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "The Confidentiality of Medical Information Act requires signed, specific patient authorization before disclosing medical information for most non-treatment purposes. Broader than HIPAA authorization.",
    jurisdictionFilter: ["CA"],
    acceptedEvidenceTypes: ["POLICY:CA_CMIA_AUTHORIZATION"],
    sortOrder: 210,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_CA_CCPA_PATIENT_RIGHTS",
    title: "CCPA/CPRA patient data rights acknowledgment (CA)",
    citation: "California Consumer Privacy Act — Cal. Civil Code §1798.100 et seq.",
    severity: "STANDARD",
    weight: 1,
    description:
      "For California residents, CCPA/CPRA grants access, deletion, correction, and opt-out rights over personal information held outside the HIPAA treatment/payment/operations scope. Privacy notice required; 45-day response window for verified consumer requests.",
    jurisdictionFilter: ["CA"],
    acceptedEvidenceTypes: ["POLICY:CA_CCPA_PRIVACY_NOTICE"],
    sortOrder: 220,
  },

  // ─── Texas (TX) ─────────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_TX_HB300_TRAINING",
    title: "Texas HB 300 workforce training (every 2 years)",
    citation: "Tex. Health & Safety Code §181.101",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Texas HB 300 requires every covered entity to train each workforce member on state + federal privacy rules within 90 days of hire and at least every two years. Training must cover the broader TX definition of a 'covered entity' (any person who receives PHI) — stricter than HIPAA's definition.",
    jurisdictionFilter: ["TX"],
    acceptedEvidenceTypes: ["TRAINING:TX_HB300_PRIVACY"],
    sortOrder: 300,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_TX_BREACH_60DAY",
    title: "Texas breach notification within 60 days (max)",
    citation: "Tex. Bus. & Com. Code §521.053",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Texas Identity Theft Enforcement Act requires practices to notify affected residents within 60 days of breach discovery — matches HIPAA's ceiling, but applies to any covered entity under the broader TX definition. AG notice is required when the breach affects 250+ Texans.",
    jurisdictionFilter: ["TX"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_60_DAYS"],
    sortOrder: 310,
  },

  // ─── New York (NY) ──────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NY_SHIELD_SECURITY",
    title: "NY SHIELD reasonable security program",
    citation: "NY Gen. Bus. Law §899-bb",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "New York's SHIELD Act requires a documented information security program with administrative, technical, and physical safeguards. Broader scope than HIPAA — covers private information (name + SSN / driver's license / biometric / account info) even when HIPAA doesn't apply.",
    jurisdictionFilter: ["NY"],
    acceptedEvidenceTypes: ["POLICY:NY_SHIELD_SECURITY_PROGRAM"],
    sortOrder: 400,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NY_BREACH_EXPEDIENT",
    title: "NY breach notification — 'most expedient time possible' (NY)",
    citation: "NY Gen. Bus. Law §899-aa",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "NY requires notice 'in the most expedient time possible and without unreasonable delay.' No fixed window, but the courts have read this strictly — effectively tighter than HIPAA's 60-day ceiling for most breaches. AG + consumer-protection-board notice also required.",
    jurisdictionFilter: ["NY"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 410,
  },

  // ─── Florida (FL) ───────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_FL_FIPA_30DAY",
    title: "FIPA breach notification within 30 days (FL)",
    citation: "Fla. Stat. §501.171",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Florida Information Protection Act requires breach notification within 30 days of discovery — the tightest fixed window of the major states. AG notice required when 500+ Floridians are affected.",
    jurisdictionFilter: ["FL"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_30_DAYS"],
    sortOrder: 500,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_FL_RECORDS_RETENTION",
    title: "Florida medical records retention — 5 years",
    citation: "Fla. Stat. §456.057(13)",
    severity: "STANDARD",
    weight: 1,
    description:
      "Florida licensed practitioners must maintain medical records for at least 5 years from the date of the last patient encounter. Longer than HIPAA's 6-year policy-retention rule for some record types; plan retention to the longer of the two.",
    jurisdictionFilter: ["FL"],
    acceptedEvidenceTypes: ["POLICY:FL_RECORDS_RETENTION"],
    sortOrder: 510,
  },

  // ─── Illinois (IL) ─────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_IL_BIPA_CONSENT",
    title: "BIPA written consent for biometric data (IL)",
    citation: "740 ILCS 14/15",
    severity: "CRITICAL",
    weight: 2,
    description:
      "Illinois's Biometric Information Privacy Act requires written informed consent before collecting fingerprints, retina/iris scans, voiceprints, face geometry, or similar biometric identifiers. Each non-compliant collection is an individual statutory violation ($1,000-$5,000 per). Applies in clinical practice to any biometric check-in or identity-verification tool.",
    jurisdictionFilter: ["IL"],
    acceptedEvidenceTypes: ["POLICY:IL_BIPA_CONSENT"],
    sortOrder: 600,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_IL_PIPA_BREACH",
    title: "Illinois PIPA breach notification (IL)",
    citation: "815 ILCS 530",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Illinois Personal Information Protection Act requires breach notice 'in the most expedient time possible and without unreasonable delay.' Must include the type of information breached, what steps are being taken, and how the recipient can protect themselves. AG notice when 500+ Illinois residents are affected.",
    jurisdictionFilter: ["IL"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 610,
  },

  // ─── Washington (WA) ───────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_WA_MYHEALTH_MYDATA",
    title: "WA My Health My Data consumer consent (WA)",
    citation: "Wash. Rev. Code §19.373",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Washington's My Health My Data Act covers health information NOT regulated by HIPAA — app/device-sourced data, location tied to health services, consumer-facing telehealth. Requires opt-in consent, authorization for any third-party sharing, and a right to deletion. Separate privacy policy required.",
    jurisdictionFilter: ["WA"],
    acceptedEvidenceTypes: ["POLICY:WA_MHMD_PRIVACY_NOTICE"],
    sortOrder: 700,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_WA_BREACH_30DAY",
    title: "Washington breach notification within 30 days (WA)",
    citation: "Wash. Rev. Code §19.255",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Washington requires breach notice to affected residents within 30 days. AG notice required when 500+ Washington residents are affected.",
    jurisdictionFilter: ["WA"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_30_DAYS"],
    sortOrder: 710,
  },

  // ─── Massachusetts (MA) ────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MA_201CMR_WISP",
    title: "MA 201 CMR 17.00 Written Information Security Program",
    citation: "201 CMR 17.00",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Massachusetts requires a comprehensive Written Information Security Program (WISP) covering personal information of any MA resident. Specific controls: encryption of data at rest and in transit over public networks, secure user authentication, access control, annual review. Stricter technical floor than HIPAA's addressable-specifications approach.",
    jurisdictionFilter: ["MA"],
    acceptedEvidenceTypes: ["POLICY:MA_201CMR_WISP"],
    sortOrder: 800,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MA_BREACH_ASAP",
    title: "MA breach notification — 'as soon as practicable' (MA)",
    citation: "Mass. Gen. Laws ch. 93H §3",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Massachusetts requires breach notice 'as soon as practicable and without unreasonable delay.' Also requires filing with the Office of Consumer Affairs + AG within the same window. No fixed number of days — courts interpret strictly.",
    jurisdictionFilter: ["MA"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 810,
  },

  // ─── Colorado (CO) ─────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_CO_CPA_CONSUMER_RIGHTS",
    title: "Colorado Privacy Act consumer rights (CO)",
    citation: "Colo. Rev. Stat. §6-1-1301",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Colorado Privacy Act grants consumers rights to access, correct, delete, and opt out of certain processing of their personal data. Covered entities must publish a privacy notice, honor requests within 45 days, and support a universal opt-out mechanism. Applies to practices with 100k+ CO consumers annually OR selling data of 25k+.",
    jurisdictionFilter: ["CO"],
    acceptedEvidenceTypes: ["POLICY:CO_CPA_PRIVACY_NOTICE"],
    sortOrder: 900,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_CO_BREACH_30DAY",
    title: "Colorado breach notification within 30 days (CO)",
    citation: "Colo. Rev. Stat. §6-1-716",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Colorado requires breach notice to affected residents within 30 days. AG notice when 500+ CO residents are affected.",
    jurisdictionFilter: ["CO"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_30_DAYS"],
    sortOrder: 910,
  },

  // ─── Virginia (VA) ─────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_VA_CDPA_CONSUMER_RIGHTS",
    title: "Virginia CDPA consumer rights (VA)",
    citation: "Va. Code §59.1-575 et seq.",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Virginia Consumer Data Protection Act grants rights to access, correct, delete, and opt out of processing for sale or targeted advertising. Privacy notice + 45-day response window. Applies to practices processing data of 100k+ VA consumers annually OR 25k+ when deriving ≥50% revenue from data sale.",
    jurisdictionFilter: ["VA"],
    acceptedEvidenceTypes: ["POLICY:VA_CDPA_PRIVACY_NOTICE"],
    sortOrder: 1000,
  },

  // ─── New Jersey (NJ) ───────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NJ_BREACH_EXPEDIENT",
    title: "NJ breach notification — most expedient (NJ)",
    citation: "N.J.S.A. 56:8-161 to 166",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "New Jersey Identity Theft Prevention Act requires breach notice 'in the most expedient time possible and without unreasonable delay.' Division of State Police notice required before consumer notice — unusual sequencing vs other states.",
    jurisdictionFilter: ["NJ"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 1100,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NJ_MEDICAL_RECORDS_7YR",
    title: "New Jersey medical records retention — 7 years",
    citation: "N.J.A.C. 13:35-6.5",
    severity: "STANDARD",
    weight: 1,
    description:
      "NJ licensed physicians must retain medical records for at least 7 years from the date of the most recent entry. Longer retention than HIPAA's general policy window for documentation.",
    jurisdictionFilter: ["NJ"],
    acceptedEvidenceTypes: ["POLICY:NJ_RECORDS_RETENTION"],
    sortOrder: 1110,
  },

  // ─── Oregon (OR) ───────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_OR_BREACH_45DAY",
    title: "Oregon breach notification within 45 days (OR)",
    citation: "Or. Rev. Stat. §646A.604",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Oregon Identity Theft Protection Act requires breach notice to affected residents within 45 days of discovery — tighter than HIPAA's 60-day ceiling. AG notice and credit bureau notice required when 250+ Oregonians are affected.",
    jurisdictionFilter: ["OR"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 1200,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_OR_OCPA_CONSUMER_RIGHTS",
    title: "Oregon Consumer Privacy Act consumer rights (OR)",
    citation: "Or. Rev. Stat. §646A.570 et seq.",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Oregon Consumer Privacy Act (effective July 2024) grants consumers rights to access, delete, correct, and opt out of sale or targeted advertising. 45-day response window. Applies to entities controlling/processing data of 100k+ OR consumers OR 25k+ when ≥25% revenue from data sale.",
    jurisdictionFilter: ["OR"],
    acceptedEvidenceTypes: ["POLICY:OR_OCPA_PRIVACY_NOTICE"],
    sortOrder: 1210,
  },

  // ─── Nevada (NV) ───────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NV_BREACH_EXPEDIENT",
    title: "Nevada breach notification — most expedient (NV)",
    citation: "Nev. Rev. Stat. §603A.220",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Nevada requires breach notice 'in the most expedient time possible and without unreasonable delay.' AG notice required when 1,000+ Nevadans are affected. Encryption-of-data-at-rest safe harbor available.",
    jurisdictionFilter: ["NV"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 1300,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NV_ONLINE_PRIVACY_NOTICE",
    title: "Nevada online privacy notice + sale opt-out (NV)",
    citation: "Nev. Rev. Stat. §603A.300-360",
    severity: "STANDARD",
    weight: 1,
    description:
      "Nevada requires a privacy notice for any operator collecting personal information from NV residents through a website or online service, and an opt-out mechanism for the sale of covered information. 60-day response window for opt-out requests.",
    jurisdictionFilter: ["NV"],
    acceptedEvidenceTypes: ["POLICY:NV_ONLINE_PRIVACY_NOTICE"],
    sortOrder: 1310,
  },

  // ─── Utah (UT) ─────────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_UT_UCPA_CONSUMER_RIGHTS",
    title: "Utah Consumer Privacy Act consumer rights (UT)",
    citation: "Utah Code §13-61-101 et seq.",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Utah Consumer Privacy Act grants consumers rights to access, delete, and opt out of targeted advertising or sale of personal data. 45-day response window. Applies to controllers with $25M+ annual revenue that process data of 100k+ UT consumers OR 25k+ when ≥50% revenue is from data sale.",
    jurisdictionFilter: ["UT"],
    acceptedEvidenceTypes: ["POLICY:UT_UCPA_PRIVACY_NOTICE"],
    sortOrder: 1400,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_UT_BREACH_EXPEDIENT",
    title: "Utah breach notification — most expedient (UT)",
    citation: "Utah Code §13-44-202",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Utah Protection of Personal Information Act requires breach notice 'in the most expedient time possible and without unreasonable delay.' AG notice required when 500+ Utah residents are affected.",
    jurisdictionFilter: ["UT"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 1410,
  },

  // ─── Georgia (GA) ──────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_GA_BREACH_EXPEDIENT",
    title: "Georgia breach notification — most expedient (GA)",
    citation: "Ga. Code §10-1-912",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Georgia Personal Identity Protection Act requires breach notice 'in the most expedient time possible and without unreasonable delay.' Information brokers face heightened obligations including consumer-reporting-agency notice when 10,000+ GA residents are affected.",
    jurisdictionFilter: ["GA"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 1500,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_GA_MEDICAL_RECORDS_10YR",
    title: "Georgia medical records retention — 10 years (GA)",
    citation: "Ga. Comp. R. & Regs. 360-3-.02",
    severity: "STANDARD",
    weight: 1,
    description:
      "Georgia physicians must retain adult medical records for at least 10 years from the date of the last patient encounter; minor records until the patient reaches age 28. Longer than HIPAA's 6-year policy retention floor — set retention to the longer of the two.",
    jurisdictionFilter: ["GA"],
    acceptedEvidenceTypes: ["POLICY:GA_RECORDS_RETENTION"],
    sortOrder: 1510,
  },

  // ─── North Carolina (NC) ───────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NC_BREACH_EXPEDIENT",
    title: "NC breach notification — without unreasonable delay (NC)",
    citation: "N.C. Gen. Stat. §75-65",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "North Carolina Identity Theft Protection Act requires breach notice without unreasonable delay. Notice to the Consumer Protection Division of the AG's office is required for any breach affecting NC residents — no minimum threshold like other states.",
    jurisdictionFilter: ["NC"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 1600,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NC_MEDICAL_RECORDS_11YR",
    title: "NC medical records retention — 11 years (NC)",
    citation: "21 NCAC 32M .0102",
    severity: "STANDARD",
    weight: 1,
    description:
      "North Carolina physicians must retain medical records for at least 11 years from the date of patient discharge or the most recent treatment. Significantly longer than HIPAA's 6-year retention floor for policies.",
    jurisdictionFilter: ["NC"],
    acceptedEvidenceTypes: ["POLICY:NC_RECORDS_RETENTION"],
    sortOrder: 1610,
  },

  // ─── Ohio (OH) ─────────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_OH_DATA_PROTECTION_SAFE_HARBOR",
    title: "Ohio Data Protection Act safe-harbor program (OH)",
    citation: "Ohio Rev. Code §1354",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Ohio's Data Protection Act provides an affirmative defense in breach litigation when a practice maintains a written cybersecurity program that reasonably conforms to a recognized framework (NIST CSF, NIST 800-171, ISO 27001, HIPAA Security Rule, PCI DSS, etc.). Effectively requires a documented and audited program.",
    jurisdictionFilter: ["OH"],
    acceptedEvidenceTypes: ["POLICY:OH_CYBERSECURITY_PROGRAM"],
    sortOrder: 1700,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_OH_BREACH_45DAY",
    title: "Ohio breach notification within 45 days (OH)",
    citation: "Ohio Rev. Code §1349.19",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Ohio requires breach notice within 45 days of discovery — tighter than HIPAA's 60-day ceiling. Substitute notice via email/website permitted only above cost-and-volume thresholds defined in statute.",
    jurisdictionFilter: ["OH"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 1710,
  },

  // ─── Michigan (MI) ─────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MI_BREACH_EXPEDIENT",
    title: "Michigan breach notification — without unreasonable delay (MI)",
    citation: "Mich. Comp. Laws §445.72",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Michigan Identity Theft Protection Act requires breach notice without unreasonable delay following discovery. AG notice required when 1,000+ Michigan residents are affected; consumer-reporting-agency notice also triggered at that threshold.",
    jurisdictionFilter: ["MI"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 1800,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MI_MEDICAL_RECORDS_ACCESS",
    title: "MI Medical Records Access Act (MI)",
    citation: "Mich. Comp. Laws §333.26261 et seq.",
    severity: "STANDARD",
    weight: 1,
    description:
      "Michigan's Medical Records Access Act gives patients the right to access records within 30 days of a written request, with a specific statutory copy fee schedule. Broader than HIPAA's right of access — also reaches non-HIPAA-covered providers operating in MI.",
    jurisdictionFilter: ["MI"],
    acceptedEvidenceTypes: ["POLICY:MI_RECORDS_ACCESS"],
    sortOrder: 1810,
  },

  // ─── Pennsylvania (PA) ─────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_PA_BREACH_EXPEDIENT",
    title: "PA breach notification — without unreasonable delay (PA)",
    citation: "73 Pa.C.S. §2301-2329",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Pennsylvania Breach of Personal Information Notification Act requires breach notice without unreasonable delay. 2023 amendment added AG-notice obligation when 500+ PA residents are affected and tightened required notice contents (incident description, type of info breached, mitigation steps).",
    jurisdictionFilter: ["PA"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 1900,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_PA_MEDICAL_RECORDS_7YR",
    title: "Pennsylvania medical records retention — 7 years (PA)",
    citation: "49 Pa. Code §16.95",
    severity: "STANDARD",
    weight: 1,
    description:
      "Pennsylvania physicians must retain medical records for at least 7 years from the date of last service for adult patients (longer for minors — until at least age 28). Longer than HIPAA's 6-year policy retention.",
    jurisdictionFilter: ["PA"],
    acceptedEvidenceTypes: ["POLICY:PA_RECORDS_RETENTION"],
    sortOrder: 1910,
  },

  // ─── Maryland (MD) ─────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MD_PIPA_45DAY",
    title: "Maryland PIPA breach notification within 45 days (MD)",
    citation: "Md. Comm. Law §14-3504",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Maryland Personal Information Protection Act requires breach notice within 45 days of discovery — tighter than HIPAA's 60-day ceiling. Pre-notice AG submission required when 500+ MD residents are affected, with the AG able to extend the consumer-notice deadline.",
    jurisdictionFilter: ["MD"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 2000,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MD_CMRA_AUTHORIZATION",
    title: "MD Confidentiality of Medical Records Act authorization (MD)",
    citation: "Md. Health-Gen. §4-301 et seq.",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Maryland's Confidentiality of Medical Records Act requires specific written authorization for disclosure of mental-health, HIV, and genetic information beyond the HIPAA baseline. Form requirements (signature, expiration, purpose) are stricter than the HIPAA 164.508 authorization.",
    jurisdictionFilter: ["MD"],
    acceptedEvidenceTypes: ["POLICY:MD_CMRA_AUTHORIZATION"],
    sortOrder: 2010,
  },

  // ─── Minnesota (MN) ────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MN_HEALTH_RECORDS_AUTH",
    title: "MN Health Records Act consent (MN)",
    citation: "Minn. Stat. §144.291 et seq.",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Minnesota Health Records Act requires written patient consent for release of health records in more situations than HIPAA — including for many treatment-related disclosures that would be permitted federally without authorization. Patients must receive records within 30 days of request; specific copy fee schedule applies.",
    jurisdictionFilter: ["MN"],
    acceptedEvidenceTypes: ["POLICY:MN_HEALTH_RECORDS_CONSENT"],
    sortOrder: 2100,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MN_BREACH_EXPEDIENT",
    title: "Minnesota breach notification — most expedient (MN)",
    citation: "Minn. Stat. §325E.61",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Minnesota requires breach notice 'in the most expedient time possible and without unreasonable delay.' AG notice required when 500+ Minnesota residents are affected; consumer-reporting-agency notice triggered at the same threshold.",
    jurisdictionFilter: ["MN"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 2110,
  },

  // ──────────────────────────────────────────────────────────────────
  // Batch 3 (2026-04-24) — 10 more states' breach-notification rules
  // ──────────────────────────────────────────────────────────────────

  // ─── Arizona (AZ) ──────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_AZ_BREACH_45DAY",
    title: "Arizona breach notification within 45 days (AZ)",
    citation: "A.R.S. §18-552",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Arizona's data breach notification statute requires notice to affected residents within 45 days of breach determination — tighter than HIPAA's 60-day ceiling. AG + 3 nationwide consumer reporting agencies notice required when 1,000+ Arizona residents are affected.",
    jurisdictionFilter: ["AZ"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 2200,
  },

  // ─── Connecticut (CT) ──────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_CT_BREACH_60DAY_AG",
    title: "Connecticut breach notification within 60 days + AG notice (CT)",
    citation: "Conn. Gen. Stat. §36a-701b",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Connecticut requires breach notice to affected residents within 60 days of discovery + simultaneous notice to the CT Attorney General. CT's law also requires the practice to offer affected residents 24 months of free identity-theft prevention service when breach involves SSNs.",
    jurisdictionFilter: ["CT"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_60_DAYS"],
    sortOrder: 2300,
  },

  // ─── Tennessee (TN) ────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_TN_BREACH_45DAY",
    title: "Tennessee breach notification within 45 days (TN)",
    citation: "Tenn. Code Ann. §47-18-2107",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Tennessee Identity Theft Deterrence Act requires breach notice within 45 days of discovery. Encryption safe harbor: notice not required if breached data was encrypted using industry-standard methods. Consumer-reporting-agency notice required when 1,000+ Tennessee residents are affected.",
    jurisdictionFilter: ["TN"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 2400,
  },

  // ─── Indiana (IN) ──────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_IN_BREACH_EXPEDIENT",
    title: "Indiana breach notification — without unreasonable delay (IN)",
    citation: "Ind. Code §24-4.9",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Indiana Disclosure of Security Breach Act requires notice without unreasonable delay following breach discovery. AG notice required when any IN resident is affected — no minimum threshold. Consumer-reporting-agency notice triggered when 1,000+ IN residents are affected.",
    jurisdictionFilter: ["IN"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 2500,
  },

  // ─── Wisconsin (WI) ────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_WI_BREACH_45DAY",
    title: "Wisconsin breach notification within 45 days (WI)",
    citation: "Wis. Stat. §134.98",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Wisconsin requires breach notice to affected residents within 45 days of discovery — tighter than HIPAA's 60-day ceiling. Encryption + redaction safe harbor available. Consumer-reporting-agency notice required when 1,000+ WI residents are affected.",
    jurisdictionFilter: ["WI"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 2600,
  },

  // ─── Kentucky (KY) ─────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_KY_BREACH_EXPEDIENT",
    title: "Kentucky breach notification — most expedient (KY)",
    citation: "Ky. Rev. Stat. §365.732",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Kentucky's data-breach notification statute requires notice 'in the most expedient time possible and without unreasonable delay.' Consumer-reporting-agency notice required when 1,000+ KY residents are affected. The 2014 KY HB 232 expanded coverage to include health information held by non-HIPAA entities.",
    jurisdictionFilter: ["KY"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 2700,
  },

  // ─── Louisiana (LA) ────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_LA_BREACH_60DAY",
    title: "Louisiana breach notification within 60 days (LA)",
    citation: "La. Rev. Stat. §51:3074",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Louisiana Database Security Breach Notification Law requires breach notice within 60 days of discovery — matches HIPAA's ceiling. AG notice required for any breach affecting LA residents (no minimum threshold), with a 10-day window from determining notice is required.",
    jurisdictionFilter: ["LA"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_60_DAYS"],
    sortOrder: 2800,
  },

  // ─── Iowa (IA) ─────────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_IA_BREACH_EXPEDIENT",
    title: "Iowa breach notification — most expedient (IA)",
    citation: "Iowa Code §715C",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Iowa's Personal Information Security Breach Protection Act requires breach notice 'in the most expedient manner possible and without unreasonable delay.' AG notice required within 5 business days of consumer notice when 500+ Iowa residents are affected. Maximum 60 days unless law-enforcement delay.",
    jurisdictionFilter: ["IA"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 2900,
  },

  // ─── Missouri (MO) ─────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MO_BREACH_EXPEDIENT",
    title: "Missouri breach notification — most expedient (MO)",
    citation: "Mo. Rev. Stat. §407.1500",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Missouri requires breach notice 'in the most expedient time possible and without unreasonable delay.' AG notice required when 1,000+ Missouri residents are affected — Missouri AG has issued multiple healthcare-specific enforcement actions for late notice. Consumer-reporting-agency notice triggered at same threshold.",
    jurisdictionFilter: ["MO"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3000,
  },

  // ─── Alabama (AL) ──────────────────────────────────────────────
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_AL_BREACH_45DAY",
    title: "Alabama breach notification within 45 days (AL)",
    citation: "Ala. Code §8-38-1 et seq.",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Alabama Data Breach Notification Act of 2018 requires breach notice within 45 days of discovery — Alabama was the last US state to enact a breach-notification law. AG notice required when 1,000+ AL residents are affected. Consumer-reporting-agency notice triggered at the same threshold.",
    jurisdictionFilter: ["AL"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 3100,
  },

  // ──────────────────────────────────────────────────────────────────
  // Batch 4 (2026-04-24 evening) — final 21 jurisdictions to complete
  // 50-state + DC breach-notification coverage
  // ──────────────────────────────────────────────────────────────────

  {
    frameworkCode: "HIPAA",
    code: "HIPAA_AK_BREACH_EXPEDIENT",
    title: "Alaska breach notification — most expedient (AK)",
    citation: "AS §45.48.010",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Alaska's Personal Information Protection Act requires breach notice 'in the most expeditious time possible and without unreasonable delay.' Substitute notice via email + posting permitted only above cost/volume thresholds.",
    jurisdictionFilter: ["AK"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3200,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_AR_BREACH_EXPEDIENT",
    title: "Arkansas breach notification — most expedient (AR)",
    citation: "Ark. Code §4-110-105",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Arkansas Personal Information Protection Act requires breach notice 'in the most expedient time and manner possible and without unreasonable delay.' AG notice required when 1,000+ AR residents are affected.",
    jurisdictionFilter: ["AR"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3210,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_DE_BREACH_EXPEDIENT",
    title: "Delaware breach notification — most expedient (DE)",
    citation: "6 Del. C. §12B-102",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Delaware requires breach notice 'in the most expedient time possible and without unreasonable delay.' AG notice required when 500+ DE residents are affected. Encryption + secure-deletion safe harbor available.",
    jurisdictionFilter: ["DE"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3220,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_DC_BREACH_EXPEDIENT",
    title: "DC breach notification — most expedient (DC)",
    citation: "D.C. Code §28-3852",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "District of Columbia requires breach notice 'in the most expedient time possible and without unreasonable delay.' AG notice required when 50+ DC residents are affected — lowest threshold of any US jurisdiction. CRA notice triggered at the same threshold.",
    jurisdictionFilter: ["DC"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3230,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_HI_BREACH_EXPEDIENT",
    title: "Hawaii breach notification — most expedient (HI)",
    citation: "HRS §487N-2",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Hawaii requires breach notice 'without unreasonable delay.' Office of Consumer Protection notice required when 1,000+ HI residents are affected. Consumer-reporting-agency notice triggered at the same threshold.",
    jurisdictionFilter: ["HI"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3240,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_ID_BREACH_EXPEDIENT",
    title: "Idaho breach notification — most expedient (ID)",
    citation: "Idaho Code §28-51-105",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Idaho requires breach notice to affected residents 'in the most expedient time possible and without unreasonable delay.' AG notice required for any breach affecting ID residents.",
    jurisdictionFilter: ["ID"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3250,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_KS_BREACH_EXPEDIENT",
    title: "Kansas breach notification — most expedient (KS)",
    citation: "K.S.A. §50-7a02",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Kansas requires breach notice 'in the most expedient time possible and without unreasonable delay.' Consumer-reporting-agency notice triggered when 1,000+ KS residents are affected.",
    jurisdictionFilter: ["KS"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3260,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_ME_BREACH_30DAY",
    title: "Maine breach notification within 30 days (ME)",
    citation: "10 MRS §1348",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Maine requires breach notice to affected residents within 30 days of discovery — among the tightest fixed windows of any state. State CRA + AG notice required when 1,000+ ME residents are affected.",
    jurisdictionFilter: ["ME"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_30_DAYS"],
    sortOrder: 3270,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MS_BREACH_EXPEDIENT",
    title: "Mississippi breach notification — most expedient (MS)",
    citation: "Miss. Code §75-24-29",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Mississippi requires breach notice 'without unreasonable delay.' No fixed deadline; courts read this strictly. No AG notice requirement under MS statute.",
    jurisdictionFilter: ["MS"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3280,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_MT_BREACH_EXPEDIENT",
    title: "Montana breach notification — most expedient (MT)",
    citation: "Mont. Code §30-14-1701 et seq.",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Montana requires breach notice 'without unreasonable delay.' AG notice required when any MT resident is affected. Encryption + redaction safe harbor available.",
    jurisdictionFilter: ["MT"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3290,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NE_BREACH_EXPEDIENT",
    title: "Nebraska breach notification — most expedient (NE)",
    citation: "Neb. Rev. Stat. §87-803",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Nebraska Financial Data Protection and Consumer Notification of Data Security Breach Act requires breach notice 'as soon as possible.' AG notice required when any NE resident is affected.",
    jurisdictionFilter: ["NE"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3300,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NH_BREACH_EXPEDIENT",
    title: "New Hampshire breach notification — most expedient (NH)",
    citation: "RSA §359-C:20",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "New Hampshire requires breach notice 'as quickly as possible.' AG + DOJ notice required for any breach affecting NH residents — no minimum threshold.",
    jurisdictionFilter: ["NH"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3310,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_NM_BREACH_45DAY",
    title: "New Mexico breach notification within 45 days (NM)",
    citation: "NMSA §57-12C-6",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "New Mexico Data Breach Notification Act requires notice within 45 days of discovery. AG + nationwide CRA notice required when 1,000+ NM residents are affected. Encryption safe harbor available.",
    jurisdictionFilter: ["NM"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 3320,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_ND_BREACH_EXPEDIENT",
    title: "North Dakota breach notification — most expedient (ND)",
    citation: "N.D.C.C. §51-30-02",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "North Dakota requires breach notice 'in the most expedient time possible and without unreasonable delay.' AG notice required when 250+ ND residents are affected.",
    jurisdictionFilter: ["ND"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3330,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_OK_BREACH_EXPEDIENT",
    title: "Oklahoma breach notification — most expedient (OK)",
    citation: "24 O.S. §163",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Oklahoma requires breach notice 'without unreasonable delay.' Substitute notice permitted only above $50,000 or 100,000-resident thresholds. No AG-notice requirement at the state level.",
    jurisdictionFilter: ["OK"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3340,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_RI_BREACH_45DAY",
    title: "Rhode Island breach notification within 45 days (RI)",
    citation: "R.I.G.L. §11-49.3-4",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Rhode Island Identity Theft Protection Act requires breach notice within 45 days of breach confirmation. AG + CRA notice required when 500+ RI residents are affected.",
    jurisdictionFilter: ["RI"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_45_DAYS"],
    sortOrder: 3350,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_SC_BREACH_EXPEDIENT",
    title: "South Carolina breach notification — most expedient (SC)",
    citation: "S.C. Code §39-1-90",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "South Carolina requires breach notice 'in the most expedient time possible and without unreasonable delay.' Department of Consumer Affairs notice required when 1,000+ SC residents are affected.",
    jurisdictionFilter: ["SC"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3360,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_SD_BREACH_60DAY",
    title: "South Dakota breach notification within 60 days (SD)",
    citation: "SDCL §22-40-22",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "South Dakota requires breach notice within 60 days of discovery — matches HIPAA's ceiling. AG notice required when 250+ SD residents are affected. Encryption safe harbor available.",
    jurisdictionFilter: ["SD"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_60_DAYS"],
    sortOrder: 3370,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_VT_BREACH_EXPEDIENT",
    title: "Vermont breach notification — most expedient (VT)",
    citation: "9 V.S.A. §2435",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Vermont Security Breach Notice Act requires preliminary AG notice within 14 days of discovery + consumer notice 'in the most expedient time possible and without unreasonable delay.' Maximum window 45 days. Among the tightest AG-notice timelines in the country.",
    jurisdictionFilter: ["VT"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3380,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_WV_BREACH_EXPEDIENT",
    title: "West Virginia breach notification — most expedient (WV)",
    citation: "W. Va. Code §46A-2A-102",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "West Virginia Breach of Security of Computerized Personal Information requires breach notice 'in the most expedient time possible and without unreasonable delay.' Substitute notice permitted only above $50,000 cost / 100,000-resident thresholds.",
    jurisdictionFilter: ["WV"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3390,
  },
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_WY_BREACH_EXPEDIENT",
    title: "Wyoming breach notification — most expedient (WY)",
    citation: "Wyo. Stat. §40-12-501 et seq.",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Wyoming requires breach notice 'in the most expedient time possible and without unreasonable delay.' No state-level AG notice requirement; consumer notice only.",
    jurisdictionFilter: ["WY"],
    acceptedEvidenceTypes: ["INCIDENT:BREACH_NOTIFIED_EXPEDIENT"],
    sortOrder: 3400,
  },
];

async function main() {
  const frameworkIds = new Map<string, string>();
  let upserted = 0;

  for (const o of OVERLAYS) {
    let frameworkId = frameworkIds.get(o.frameworkCode);
    if (!frameworkId) {
      const fw = await db.regulatoryFramework.findUnique({
        where: { code: o.frameworkCode },
        select: { id: true },
      });
      if (!fw) {
        throw new Error(
          `Framework ${o.frameworkCode} not seeded — run db:seed:${o.frameworkCode.toLowerCase()} first.`,
        );
      }
      frameworkId = fw.id;
      frameworkIds.set(o.frameworkCode, frameworkId);
    }

    await db.regulatoryRequirement.upsert({
      where: { frameworkId_code: { frameworkId, code: o.code } },
      update: {
        title: o.title,
        citation: o.citation,
        severity: o.severity,
        weight: o.weight,
        description: o.description,
        jurisdictionFilter: o.jurisdictionFilter,
        acceptedEvidenceTypes: o.acceptedEvidenceTypes,
        sortOrder: o.sortOrder,
      },
      create: {
        frameworkId,
        code: o.code,
        title: o.title,
        citation: o.citation,
        severity: o.severity,
        weight: o.weight,
        description: o.description,
        jurisdictionFilter: o.jurisdictionFilter,
        acceptedEvidenceTypes: o.acceptedEvidenceTypes,
        sortOrder: o.sortOrder,
      },
    });
    upserted += 1;
  }

  console.log(
    `Seed state overlays: ${upserted} overlay requirement(s) upserted across ${frameworkIds.size} framework(s).`,
  );

  // Backfill any matching framework so CA practices with existing
  // evidence events (future incident records, CMIA-authorization
  // policies) flip the overlay rows to COMPLIANT on seed.
  for (const frameworkCode of frameworkIds.keys()) {
    await backfillFrameworkDerivations(db, frameworkCode);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
