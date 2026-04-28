// scripts/seed-oig.ts
//
// Idempotent seeder for the HHS OIG Compliance Program framework — the
// third v2 framework after HIPAA and OSHA.
//
// Seeds the seven elements of an effective compliance program per the
// HHS OIG Compliance Program Guidance for Individual and Small Group
// Physician Practices (65 FR 59434, 2000).
//
// One derivation rule wired at launch:
//   OIG_COMPLIANCE_OFFICER ← OFFICER_DESIGNATION:COMPLIANCE (existing
//   PracticeUser.isComplianceOfficer flag). Toggling a compliance
//   officer on /programs/staff now flips the OIG requirement too.
//
// Usage:
//   npm run db:seed:oig

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

// HHS OIG 7 elements — order matches the published guidance.
const OIG_REQUIREMENTS: RequirementFixture[] = [
  {
    code: "OIG_WRITTEN_POLICIES",
    title: "Written policies, procedures, and standards of conduct",
    citation: "65 FR 59434 Element 1",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Develop and distribute written standards of conduct and written policies and procedures that promote the practice's commitment to compliance and address specific areas of potential fraud and abuse (billing, coding, reasonable-and-necessary services, documentation, improper inducements).",
    acceptedEvidenceTypes: [
      // Element 1 anchors on Standards of Conduct adoption per OIG
      // guidance text. The other two policy codes flow through Elements
      // 4 (anonymous reporting) and 6 (discipline) to avoid double-
      // counting. See oigWrittenPoliciesRule rationale.
      "POLICY:OIG_STANDARDS_OF_CONDUCT_POLICY",
    ],
    sortOrder: 10,
  },
  {
    code: "OIG_COMPLIANCE_OFFICER",
    title: "Designated compliance officer or contact",
    citation: "65 FR 59434 Element 2",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Designate a compliance officer or contact (or, in a small practice, a team of contacts) to monitor compliance efforts and enforce practice standards. The officer should have the authority, resources, and autonomy to operate effectively.",
    acceptedEvidenceTypes: ["OFFICER_DESIGNATION:COMPLIANCE"],
    sortOrder: 20,
  },
  {
    code: "OIG_TRAINING_EDUCATION",
    title: "Effective training and education",
    citation: "65 FR 59434 Element 3",
    severity: "STANDARD",
    weight: 1,
    description:
      "Conduct effective training and education programs for practitioners and staff on compliance-program requirements, coding and billing, and federal health-care-program requirements. Training should be at hire, annually, and as-needed upon material changes.",
    acceptedEvidenceTypes: ["TRAINING:OIG_COMPLIANCE_TRAINING"],
    sortOrder: 30,
  },
  {
    code: "OIG_COMMUNICATION_LINES",
    title: "Open lines of communication",
    citation: "65 FR 59434 Element 4",
    severity: "STANDARD",
    weight: 1,
    description:
      "Develop open lines of communication — such as a hotline, anonymous reporting mechanism, or designated contact — between the compliance officer and all practitioners and employees to receive questions, reports of potential misconduct, and feedback.",
    acceptedEvidenceTypes: ["POLICY:OIG_ANONYMOUS_REPORTING_POLICY"],
    sortOrder: 40,
  },
  {
    code: "OIG_AUDITING_MONITORING",
    title: "Internal auditing and monitoring",
    citation: "65 FR 59434 Element 5",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Conduct appropriate internal monitoring and auditing. At minimum, periodic reviews of coding accuracy, documentation sufficiency, billing practices, and adherence to the practice's written compliance policies.",
    acceptedEvidenceTypes: ["EVENT:OIG_ANNUAL_REVIEW_SUBMITTED"],
    sortOrder: 50,
  },
  {
    code: "OIG_ENFORCEMENT_DISCIPLINE",
    title: "Enforcement of standards through disciplinary guidelines",
    citation: "65 FR 59434 Element 6",
    severity: "STANDARD",
    weight: 1,
    description:
      "Enforce disciplinary standards through well-publicized guidelines. Sanctions should be applied consistently for failure to comply, misconduct, and failure to report detected misconduct.",
    // Phase 1: derives from discipline policy alone.
    // TODO(Phase 11): Extend to also verify LeieScreening cadence is maintained.
    acceptedEvidenceTypes: ["POLICY:OIG_DISCIPLINE_POLICY"],
    sortOrder: 60,
  },
  {
    code: "OIG_RESPONSE_VIOLATIONS",
    title: "Prompt response to detected violations + corrective action",
    citation: "65 FR 59434 Element 7",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Respond promptly to detected violations through the investigation of allegations and the disclosure of incidents to appropriate government entities. Develop corrective action initiatives to address identified weaknesses.",
    // OigCorrectiveAction model deferred to Phase 9 — EventLog IS the evidence.
    acceptedEvidenceTypes: ["EVENT:OIG_CORRECTIVE_ACTION_RESOLVED"],
    sortOrder: 70,
  },
];

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "OIG" },
    update: {
      name: "HHS OIG Compliance Program",
      shortName: "OIG",
      description:
        "The seven elements of an effective compliance program for individual and small group physician practices, per the HHS OIG Compliance Program Guidance (65 FR 59434, 2000).",
      citation: "65 FR 59434",
      jurisdiction: "federal",
      weightDefault: 0.15,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "Scale",
      colorKey: "gw-color-good",
      sortOrder: 30,
    },
    create: {
      code: "OIG",
      name: "HHS OIG Compliance Program",
      shortName: "OIG",
      description:
        "The seven elements of an effective compliance program for individual and small group physician practices, per the HHS OIG Compliance Program Guidance (65 FR 59434, 2000).",
      citation: "65 FR 59434",
      jurisdiction: "federal",
      weightDefault: 0.15,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "Scale",
      colorKey: "gw-color-good",
      sortOrder: 30,
    },
  });

  let upsertedReqs = 0;
  for (const r of OIG_REQUIREMENTS) {
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
    `Seed OIG: framework id=${framework.id}, ${upsertedReqs} requirements upserted, ${activations} practice activations.`,
  );

  await backfillFrameworkDerivations(db, "OIG");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
