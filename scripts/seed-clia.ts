// scripts/seed-clia.ts
//
// Seeds the CLIA (Clinical Laboratory Improvement Amendments) compliance
// framework — the sixth v2 framework after HIPAA, OSHA, OIG, DEA, and CMS.
//
// One credential-derived requirement at launch:
//   CLIA_CERTIFICATE ← CREDENTIAL_TYPE:CLIA_WAIVER_CERTIFICATE
//
// Other 7 are manual-override at launch until the matching operational
// surfaces ship (lab test menu, QC logs, competency assessments, PT
// enrollment — all deferred from v1's heavyweight lab-operations module).
//
// V1 carryover: requirements ported from src/app/(dashboard)/clia/page.tsx
// CLIA_CHECKLIST, scoped to items that apply to ALL certificate levels plus
// the WAIVER-only items (most physician-office labs hold a Certificate of
// Waiver). Non-waived-only items (proficiency testing, calibration, written
// SOPs) omitted at launch — add when CliaLevel is introduced on Practice.

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

const CLIA_REQUIREMENTS: RequirementFixture[] = [
  {
    code: "CLIA_CERTIFICATE",
    title: "Current CLIA certificate on file",
    citation: "42 CFR §493.43",
    severity: "CRITICAL",
    weight: 2,
    description:
      "Every laboratory testing human specimens must hold a current CLIA certificate matching the complexity of tests performed (Waiver, Provider-Performed Microscopy, or Certificate of Accreditation/Compliance). Certificates renew every 2 years and must be displayed in the lab.",
    acceptedEvidenceTypes: ["CREDENTIAL_TYPE:CLIA_WAIVER_CERTIFICATE"],
    sortOrder: 10,
  },
  {
    code: "CLIA_LAB_DIRECTOR",
    title: "Laboratory Director designated",
    citation: "42 CFR §493.1407 / §493.1441",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "A qualified Laboratory Director must be designated in writing and meet CLIA personnel qualifications for the certificate level. Certificate of Waiver: any licensed provider may direct. Non-waived: director must meet specific education + experience requirements.",
    // TODO(Phase 9+): Add LAB_DIRECTOR to OFFICER_ROLES enum + new
    // PracticeUser.isLabDirector boolean column (additive schema migration)
    // and wire ["OFFICER_DESIGNATION:LAB_DIRECTOR"] here. Deferred to keep
    // PR 7 scoped to seed-level cleanup; CLIA personnel qualifications are
    // verified manually at launch via the /modules/clia radio.
    acceptedEvidenceTypes: [],
    sortOrder: 20,
  },
  {
    code: "CLIA_PATIENT_RESULTS",
    title: "Patient result reporting and retention",
    citation: "42 CFR §493.1291 / §493.1105",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Report patient test results with reference ranges, units, and interpretation flags. Retain patient result records for at least 2 years (some states require longer). Maintain a log of corrected reports and document any changes to the original result.",
    acceptedEvidenceTypes: [],
    sortOrder: 30,
  },
  {
    code: "CLIA_INSPECTION_READINESS",
    title: "Inspection readiness",
    citation: "42 CFR §493.1773",
    severity: "STANDARD",
    weight: 1,
    description:
      "Maintain all required records readily accessible for unannounced CMS or deemed-authority inspections. Address all deficiencies from prior inspections. Conduct annual self-assessments using CMS CLIA checklists.",
    acceptedEvidenceTypes: [],
    sortOrder: 40,
  },
  {
    code: "CLIA_TEST_LIST",
    title: "Approved test list maintained",
    citation: "42 CFR §493.15",
    severity: "STANDARD",
    weight: 1,
    description:
      "Maintain a current list of every test performed on site. For Certificate of Waiver labs, every test on the list must appear on the CMS/FDA waived test list and be within the scope of the Waiver. Update the list whenever tests are added or removed.",
    acceptedEvidenceTypes: [],
    sortOrder: 50,
  },
  {
    code: "CLIA_MFR_INSTRUCTIONS",
    title: "Manufacturer instructions followed",
    citation: "42 CFR §493.15(e)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "All waived tests must be performed strictly according to manufacturer instructions without modifications. Any deviation from the package insert (specimen type, procedure, timing, interpretation) may reclassify the test as non-waived. Keep current package inserts accessible at the point of testing.",
    acceptedEvidenceTypes: [],
    sortOrder: 60,
  },
  {
    code: "CLIA_STAFF_TRAINING",
    title: "Staff training on each test performed",
    citation: "42 CFR §493.1423 / §493.1451",
    severity: "STANDARD",
    weight: 1,
    description:
      "Document initial and annual competency for each staff member on each test performed. Training must cover specimen collection, procedure, quality control, result interpretation, and reporting. Maintain dated, signed training records.",
    // TODO(Phase 4): Seed a CLIA_LAB_BASICS training course in seed-training.ts,
    // then wire ["TRAINING:CLIA_LAB_BASICS"] here so the existing
    // courseCompletionThresholdRule pattern (see oig.ts OIG_TRAINING_EDUCATION)
    // can flip this requirement automatically.
    acceptedEvidenceTypes: [],
    sortOrder: 70,
  },
  {
    code: "CLIA_QUALITY_CONTROL",
    title: "Quality control performed per manufacturer instructions",
    citation: "42 CFR §493.1256",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Run quality control as specified by the test manufacturer (typically with each new lot, new shipment, or per package insert). Document all QC results. Do not report patient results when QC fails — investigate and correct before resuming testing.",
    acceptedEvidenceTypes: [],
    sortOrder: 80,
  },
];

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "CLIA" },
    update: {
      name: "Clinical Laboratory Improvement Amendments",
      shortName: "CLIA",
      description:
        "Federal CLIA standards for laboratories testing human specimens — certificate scope, qualified laboratory direction, patient result reporting, inspection readiness, test-list maintenance, manufacturer-instruction adherence, staff competency, and quality control. Applies to any practice running point-of-care or in-office testing.",
      citation: "42 CFR Part 493",
      jurisdiction: "federal",
      weightDefault: 0.08,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "FlaskConical",
      colorKey: "gw-color-warn",
      sortOrder: 60,
    },
    create: {
      code: "CLIA",
      name: "Clinical Laboratory Improvement Amendments",
      shortName: "CLIA",
      description:
        "Federal CLIA standards for laboratories testing human specimens — certificate scope, qualified laboratory direction, patient result reporting, inspection readiness, test-list maintenance, manufacturer-instruction adherence, staff competency, and quality control. Applies to any practice running point-of-care or in-office testing.",
      citation: "42 CFR Part 493",
      jurisdiction: "federal",
      weightDefault: 0.08,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "FlaskConical",
      colorKey: "gw-color-warn",
      sortOrder: 60,
    },
  });

  let upsertedReqs = 0;
  for (const r of CLIA_REQUIREMENTS) {
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
    `Seed CLIA: framework id=${framework.id}, ${upsertedReqs} requirements upserted, ${activations} practice activations.`,
  );

  await backfillFrameworkDerivations(db, "CLIA");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
