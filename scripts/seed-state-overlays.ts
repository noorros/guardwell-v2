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
// This initial pass ships 3 California HIPAA overlays as
// proof-of-architecture — enough to drive the UI chip, scoring filter,
// and integration tests end-to-end. Full 50-state matrix build-out
// happens in follow-up seed PRs.

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
