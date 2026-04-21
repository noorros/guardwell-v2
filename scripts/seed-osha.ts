// scripts/seed-osha.ts
//
// Idempotent seeder for the OSHA regulatory framework — the second
// framework after HIPAA. Validates ADR-0004 "modules as data": adding a
// new framework is an INSERT + zero code changes to the framework-
// rendering stack.
//
// Ships 8 canonical requirements scoped for healthcare practices.
// acceptedEvidenceTypes intentionally empty for launch — derivation
// rules wire in later when operational surfaces (OSHA training courses,
// inspections log, sharps injury log) exist. Users can still assert
// COMPLIANT manually via the /modules/osha radios.
//
// Also activates OSHA for every existing Practice by upserting a
// PracticeFramework(enabled=true, scoreCache=0) row. This makes the
// framework appear in the "My Compliance" sidebar immediately. New
// practices created after this seed will activate on first status event
// via the recomputeFrameworkScore helper (same pattern HIPAA uses).
//
// Usage:
//   npm run db:seed:osha

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

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

const OSHA_REQUIREMENTS: RequirementFixture[] = [
  {
    code: "OSHA_BBP_EXPOSURE_CONTROL",
    title: "Bloodborne Pathogens Exposure Control Plan",
    citation: "29 CFR §1910.1030(c)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Written plan identifying job classifications with exposure risk, methods of compliance, HBV vaccination program, post-exposure evaluation, and annual review. Required for any practice with occupational exposure to blood or OPIM.",
    acceptedEvidenceTypes: ["POLICY:OSHA_BBP_EXPOSURE_CONTROL_PLAN"],
    sortOrder: 10,
  },
  {
    code: "OSHA_BBP_TRAINING",
    title: "Annual Bloodborne Pathogens training",
    citation: "29 CFR §1910.1030(g)(2)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Annual training on the exposure control plan for all workforce members with occupational exposure. Records retained for 3 years.",
    acceptedEvidenceTypes: [],
    sortOrder: 20,
  },
  {
    code: "OSHA_HAZCOM",
    title: "Hazard Communication program (SDS + chemical inventory)",
    citation: "29 CFR §1910.1200",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Written HazCom program, current Safety Data Sheets for every hazardous chemical on-site, maintained chemical inventory, and HazCom training for exposed workforce.",
    acceptedEvidenceTypes: ["POLICY:OSHA_HAZCOM_PROGRAM"],
    sortOrder: 30,
  },
  {
    code: "OSHA_EMERGENCY_ACTION_PLAN",
    title: "Emergency Action Plan (evacuation, fire, medical)",
    citation: "29 CFR §1910.38",
    severity: "STANDARD",
    weight: 1,
    description:
      "Written EAP covering evacuation procedures, exit routes, fire prevention, reporting emergencies, and employee training on emergency responsibilities.",
    acceptedEvidenceTypes: ["POLICY:OSHA_EMERGENCY_ACTION_PLAN"],
    sortOrder: 40,
  },
  {
    code: "OSHA_300_LOG",
    title: "OSHA 300 Log + 300A Annual Summary + 301 Incident Report",
    citation: "29 CFR Part 1904",
    severity: "STANDARD",
    weight: 1,
    description:
      "Maintain OSHA 300 log of work-related injuries/illnesses. Post 300A Annual Summary Feb 1–Apr 30 each year. 301 Incident Reports within 7 days of incident. Applies to practices with 10+ employees; others keep sharps injury log per §1910.1030.",
    acceptedEvidenceTypes: [],
    sortOrder: 50,
  },
  {
    code: "OSHA_REQUIRED_POSTERS",
    title: "Required workplace posters (federal + state)",
    citation: "29 CFR §1903.2",
    severity: "STANDARD",
    weight: 1,
    description:
      "OSHA Job Safety & Health \"It's the Law\" poster in a conspicuous location. State Workers' Compensation poster. State-specific postings (minimum wage, FMLA, etc.) where applicable.",
    acceptedEvidenceTypes: [],
    sortOrder: 60,
  },
  {
    code: "OSHA_PPE",
    title: "Personal Protective Equipment program",
    citation: "29 CFR §1910.132",
    severity: "STANDARD",
    weight: 1,
    description:
      "Hazard assessment identifying required PPE, employer-provided PPE at no cost to employees, training on proper use, and documentation of both assessment and training.",
    acceptedEvidenceTypes: [],
    sortOrder: 70,
  },
  {
    code: "OSHA_GENERAL_DUTY",
    title: "General Duty Clause compliance",
    citation: "OSH Act §5(a)(1)",
    severity: "STANDARD",
    weight: 1,
    description:
      "Furnish a workplace free from recognized hazards that are likely to cause death or serious physical harm. Used by OSHA where no specific standard applies (workplace violence, ergonomics, heat stress, etc.).",
    acceptedEvidenceTypes: [],
    sortOrder: 80,
  },
];

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "OSHA" },
    update: {
      name: "Occupational Safety and Health Administration",
      shortName: "OSHA",
      description:
        "Federal workplace safety obligations — bloodborne pathogens, hazard communication, emergency action plans, injury/illness recordkeeping, required postings, and the General Duty Clause.",
      citation: "29 CFR Parts 1903, 1904, 1910",
      jurisdiction: "federal",
      weightDefault: 0.2,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "HardHat",
      colorKey: "gw-color-warn",
      sortOrder: 20,
    },
    create: {
      code: "OSHA",
      name: "Occupational Safety and Health Administration",
      shortName: "OSHA",
      description:
        "Federal workplace safety obligations — bloodborne pathogens, hazard communication, emergency action plans, injury/illness recordkeeping, required postings, and the General Duty Clause.",
      citation: "29 CFR Parts 1903, 1904, 1910",
      jurisdiction: "federal",
      weightDefault: 0.2,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "HardHat",
      colorKey: "gw-color-warn",
      sortOrder: 20,
    },
  });

  let upsertedReqs = 0;
  for (const r of OSHA_REQUIREMENTS) {
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

  // Activate OSHA for every existing practice so it shows in the sidebar
  // immediately. scoreCache=0 reflects "no requirements compliant yet".
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
        // Don't clobber a live scoreCache/scoreLabel — leave those alone if
        // they're already set by prior status events. Just ensure enabled.
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
    `Seed OSHA: framework id=${framework.id}, ${upsertedReqs} requirements upserted, ${activations} practice activations.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
