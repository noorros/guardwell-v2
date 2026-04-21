// scripts/seed-dea.ts
//
// Seeds the DEA Controlled Substance Act compliance framework — the
// fourth v2 framework after HIPAA, OSHA, and OIG. First framework to
// derive from a Credential (not a policy, training, or officer flag):
// DEA_REGISTRATION ← CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION.
//
// Practices that already have a DEA credential on /programs/credentials
// will auto-flip DEA_REGISTRATION to COMPLIANT on seed thanks to the
// backfillFrameworkDerivations helper (PR #60).

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { backfillFrameworkDerivations } from "./lib/backfill-derivations";

config({ path: ".env" });

const db = new PrismaClient();

interface RequirementFixture {
  code: string;
  title: string;
  citation: string;
  severity: "CRITICAL" | "STANDARD" | "OPTIONAL";
  weight: number;
  description: string;
  acceptedEvidenceTypes: string[];
  sortOrder: number;
}

// 8 canonical DEA requirements for healthcare practices handling Schedule II–V
// controlled substances. Non-prescribing practices get a "not applicable"
// override per the v2 escape-hatch pattern on /modules/dea.
const DEA_REQUIREMENTS: RequirementFixture[] = [
  {
    code: "DEA_REGISTRATION",
    title: "Current DEA Controlled Substance Registration",
    citation: "21 CFR §1301.13",
    severity: "CRITICAL",
    weight: 2,
    description:
      "Each location dispensing or administering controlled substances must hold a current DEA Certificate of Registration (Form 224). Registrations renew every 3 years; renew at least 45 days before expiry to avoid a gap in authority.",
    acceptedEvidenceTypes: ["CREDENTIAL_TYPE:DEA_CONTROLLED_SUBSTANCE_REGISTRATION"],
    sortOrder: 10,
  },
  {
    code: "DEA_INVENTORY",
    title: "Biennial controlled substance inventory",
    citation: "21 CFR §1304.11",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Conduct a complete inventory of all controlled substances every 2 years from the date of the initial inventory. Record must include date, time of day, name/form/strength/quantity of each controlled substance. Retain for 2 years minimum.",
    acceptedEvidenceTypes: [],
    sortOrder: 20,
  },
  {
    code: "DEA_RECORDS",
    title: "Dispensing and administration records (2+ years)",
    citation: "21 CFR §1304.22",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Maintain records of every controlled-substance dispensing or administration: patient name, date, drug name, strength, form, quantity, and the prescriber. Schedule II records stored separately. Retain all records for at least 2 years.",
    acceptedEvidenceTypes: [],
    sortOrder: 30,
  },
  {
    code: "DEA_STORAGE",
    title: "Secure storage (substantially constructed, locked cabinet or safe)",
    citation: "21 CFR §1301.75",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Schedule II–V controlled substances must be stored in a securely locked, substantially constructed cabinet or safe. Practitioner offices typically use a steel safe or locked cabinet; larger inventories require increased-security vaults.",
    acceptedEvidenceTypes: [],
    sortOrder: 40,
  },
  {
    code: "DEA_PRESCRIPTION_SECURITY",
    title: "Prescription form security (tamper-resistant or e-prescribing)",
    citation: "21 CFR §1311",
    severity: "STANDARD",
    weight: 1,
    description:
      "Prescription pads stored securely; tamper-resistant prescriptions for Medicaid (CMS) and most state Schedule II–V rules; or equivalent electronic prescribing (EPCS) with two-factor authentication and an audit trail.",
    acceptedEvidenceTypes: [],
    sortOrder: 50,
  },
  {
    code: "DEA_EMPLOYEE_SCREENING",
    title: "Employee screening for controlled substance access",
    citation: "21 CFR §1301.90",
    severity: "STANDARD",
    weight: 1,
    description:
      "Question each applicant for positions giving access to controlled substances about conviction for a felony relating to controlled substances and unauthorized use of drugs. Document the response in the personnel file.",
    acceptedEvidenceTypes: [],
    sortOrder: 60,
  },
  {
    code: "DEA_LOSS_REPORTING",
    title: "Theft/significant-loss reporting (DEA Form 106 in 1 business day)",
    citation: "21 CFR §1301.76(b)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Upon discovery of a theft or significant loss of controlled substances, notify the DEA Field Division in writing within one business day using DEA Form 106. Also notify local law enforcement and, where required, state regulators.",
    acceptedEvidenceTypes: [],
    sortOrder: 70,
  },
  {
    code: "DEA_DISPOSAL",
    title: "Controlled substance disposal procedures",
    citation: "21 CFR Part 1317",
    severity: "STANDARD",
    weight: 1,
    description:
      "Dispose of expired, unused, or returned controlled substances only via authorized methods: transfer to a reverse distributor, DEA-authorized take-back event, or on-site destruction with two witnesses and DEA Form 41 documentation.",
    acceptedEvidenceTypes: [],
    sortOrder: 80,
  },
];

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "DEA" },
    update: {
      name: "DEA Controlled Substance Act",
      shortName: "DEA",
      description:
        "Federal Drug Enforcement Administration obligations for practices dispensing or administering Schedule II–V controlled substances — registration, inventory, records, secure storage, prescription security, employee screening, theft reporting, and disposal.",
      citation: "21 CFR Parts 1301, 1304, 1311, 1317",
      jurisdiction: "federal",
      weightDefault: 0.1,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "Pill",
      colorKey: "gw-color-warn",
      sortOrder: 40,
    },
    create: {
      code: "DEA",
      name: "DEA Controlled Substance Act",
      shortName: "DEA",
      description:
        "Federal Drug Enforcement Administration obligations for practices dispensing or administering Schedule II–V controlled substances — registration, inventory, records, secure storage, prescription security, employee screening, theft reporting, and disposal.",
      citation: "21 CFR Parts 1301, 1304, 1311, 1317",
      jurisdiction: "federal",
      weightDefault: 0.1,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "Pill",
      colorKey: "gw-color-warn",
      sortOrder: 40,
    },
  });

  let upsertedReqs = 0;
  for (const r of DEA_REQUIREMENTS) {
    await db.regulatoryRequirement.upsert({
      where: { frameworkId_code: { frameworkId: framework.id, code: r.code } },
      update: {
        title: r.title,
        citation: r.citation,
        severity: r.severity,
        weight: r.weight,
        description: r.description,
        acceptedEvidenceTypes: r.acceptedEvidenceTypes,
        sortOrder: r.sortOrder,
      },
      create: {
        frameworkId: framework.id,
        code: r.code,
        title: r.title,
        citation: r.citation,
        severity: r.severity,
        weight: r.weight,
        description: r.description,
        acceptedEvidenceTypes: r.acceptedEvidenceTypes,
        sortOrder: r.sortOrder,
      },
    });
    upsertedReqs += 1;
  }

  const practices = await db.practice.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  let activations = 0;
  const now = new Date();
  for (const p of practices) {
    await db.practiceFramework.upsert({
      where: {
        practiceId_frameworkId: {
          practiceId: p.id,
          frameworkId: framework.id,
        },
      },
      update: {
        enabled: true,
        disabledAt: null,
      },
      create: {
        practiceId: p.id,
        frameworkId: framework.id,
        enabled: true,
        enabledAt: now,
        scoreCache: 0,
        scoreLabel: "At Risk",
        lastScoredAt: now,
      },
    });
    activations += 1;
  }

  console.log(
    `Seed DEA: framework id=${framework.id}, ${upsertedReqs} requirements upserted, ${activations} practice activations.`,
  );

  await backfillFrameworkDerivations(db, "DEA");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
