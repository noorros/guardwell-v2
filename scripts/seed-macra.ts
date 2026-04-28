// scripts/seed-macra.ts
//
// Seeds the MACRA / MIPS compliance framework — the eighth v2 framework,
// completing federal framework coverage (HIPAA · OSHA · OIG · DEA · CMS ·
// CLIA · TCPA · MACRA).
//
// PR 6 (2026-04-28): Five activity-log-driven derivation rules + one
// cross-framework SRA reuse + two manual-only stubs. Logging an activity
// via /modules/macra now flips the matching ComplianceItem.
//
//   MACRA_MIPS_EXEMPTION_VERIFIED      ≥1 QUALITY activity for the year
//   MACRA_QUALITY_MEASURES             STUB (Phase 9+ — QPP catalog)
//   MACRA_IMPROVEMENT_ACTIVITIES       ≥2 IMPROVEMENT activities for the year
//   MACRA_PROMOTING_INTEROPERABILITY   ≥1 PI activity for the year
//   MACRA_SECURITY_RISK_ANALYSIS       cross-framework — completed HIPAA SRA
//   MACRA_CERTIFIED_EHR_TECHNOLOGY     STUB (Phase 9+ — TechAsset CEHRT)
//   MACRA_ANNUAL_DATA_SUBMISSION       ≥1 SUBMISSION activity for the year
//
// V1 carryover: v1's MACRA module has 30 Improvement Activities + 6
// Promoting Interoperability measures + exemption assessment — collapsed
// here to the 7 MIPS performance categories + operational gates. The full
// IA catalog + PI measures + exemption calculator are deferred as
// operational surfaces.

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

const MACRA_REQUIREMENTS: RequirementFixture[] = [
  {
    code: "MACRA_MIPS_EXEMPTION_VERIFIED",
    title: "MIPS low-volume threshold checked",
    citation: "42 CFR §414.1305 (low-volume threshold)",
    severity: "STANDARD",
    weight: 1,
    description:
      "Verify the practice's MIPS eligibility status annually. Practices are exempt if they meet any single low-volume criterion: ≤$90K Medicare Part B charges, ≤200 beneficiaries, OR ≤200 covered professional services in the performance year. Document determination on the QPP Participation Status tool.",
    acceptedEvidenceTypes: ["MACRA_ACTIVITY:LOGGED"],
    sortOrder: 10,
  },
  {
    code: "MACRA_QUALITY_MEASURES",
    title: "Quality category — report ≥6 measures",
    citation: "42 CFR §414.1330 (Quality performance category)",
    severity: "CRITICAL",
    weight: 2,
    description:
      "Report on at least 6 quality measures (including at least one outcome or high-priority measure) for the performance year. Measures collected and submitted via QPP-approved method (CQM, eCQM, registry, QCDR, or administrative claims). Quality is the largest MIPS performance-category weight (default 30%).",
    // Manual-only at launch; QPP measure catalog integration deferred to Phase 9+.
    acceptedEvidenceTypes: [],
    sortOrder: 20,
  },
  {
    code: "MACRA_IMPROVEMENT_ACTIVITIES",
    title: "Improvement Activities — minimum 40 points",
    citation: "42 CFR §414.1355 (Improvement Activities category)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Attest to improvement activities totaling at least 40 points. High-weighted activities count as 20 points; medium-weighted as 10. Small practices (≤15 clinicians) and practices in rural/HPSA areas count activities at 2x. Minimum 90 continuous days per activity.",
    acceptedEvidenceTypes: ["MACRA_ACTIVITY:LOGGED"],
    sortOrder: 30,
  },
  {
    code: "MACRA_PROMOTING_INTEROPERABILITY",
    title: "Promoting Interoperability — all required PI measures reported",
    citation: "42 CFR §414.1375 (Promoting Interoperability category)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Report PI measures: e-Prescribing, Health Information Exchange (HIE), Provide Patient Access, Support Electronic Referral Loops, and Public Health/Clinical Data Exchange (including Immunization Registry). Security Risk Analysis is required as a yes/no gate. Minimum 180-day reporting period.",
    acceptedEvidenceTypes: ["MACRA_ACTIVITY:LOGGED"],
    sortOrder: 40,
  },
  {
    code: "MACRA_SECURITY_RISK_ANALYSIS",
    title: "Annual Security Risk Analysis completed",
    citation: "45 CFR §164.308(a)(1)(ii)(A) (cross-referenced by PI)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Conduct or review a Security Risk Analysis (SRA) in accordance with HIPAA requirements during the MIPS performance period. SRA is a required yes/no attestation in the PI category — no SRA = automatic zero in PI. Cross-checks with HIPAA_SRA; completing the HIPAA SRA also satisfies this.",
    // Cross-framework: completing the HIPAA SRA also satisfies this MIPS PI gate.
    acceptedEvidenceTypes: ["SRA_COMPLETED"],
    sortOrder: 50,
  },
  {
    code: "MACRA_CERTIFIED_EHR_TECHNOLOGY",
    title: "Certified EHR Technology (CEHRT 2015+) in use",
    citation: "42 CFR §414.1400",
    severity: "STANDARD",
    weight: 1,
    description:
      "Use EHR technology certified to the 2015 Edition Cures Update (or later) ONC criteria for the entire performance year. CEHRT is required for PI category reporting. Document certification number from the ONC CHPL for audit defensibility.",
    // Manual-only at launch; TechAsset CEHRT certification tracking deferred to Phase 9+.
    acceptedEvidenceTypes: [],
    sortOrder: 60,
  },
  {
    code: "MACRA_ANNUAL_DATA_SUBMISSION",
    title: "QPP annual data submission by March 31",
    citation: "42 CFR §414.1325",
    severity: "CRITICAL",
    weight: 2,
    description:
      "Submit MIPS data for the performance year via the Quality Payment Program portal by March 31 of the following year. Late submissions lose MIPS payment adjustment credit. Maintain proof of submission (confirmation email + submission report).",
    acceptedEvidenceTypes: ["MACRA_ACTIVITY:LOGGED"],
    sortOrder: 70,
  },
];

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "MACRA" },
    update: {
      name: "MACRA / MIPS",
      shortName: "MACRA",
      description:
        "Medicare Access and CHIP Reauthorization Act — Merit-based Incentive Payment System (MIPS). Four performance categories (Quality, Cost, Improvement Activities, Promoting Interoperability) with annual data submission to the Quality Payment Program. Required for eligible clinicians above the low-volume threshold.",
      citation: "42 CFR Part 414 Subpart O",
      jurisdiction: "federal",
      weightDefault: 0.05,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "BarChart2",
      colorKey: "gw-color-good",
      sortOrder: 80,
    },
    create: {
      code: "MACRA",
      name: "MACRA / MIPS",
      shortName: "MACRA",
      description:
        "Medicare Access and CHIP Reauthorization Act — Merit-based Incentive Payment System (MIPS). Four performance categories (Quality, Cost, Improvement Activities, Promoting Interoperability) with annual data submission to the Quality Payment Program. Required for eligible clinicians above the low-volume threshold.",
      citation: "42 CFR Part 414 Subpart O",
      jurisdiction: "federal",
      weightDefault: 0.05,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "BarChart2",
      colorKey: "gw-color-good",
      sortOrder: 80,
    },
  });

  let upsertedReqs = 0;
  for (const r of MACRA_REQUIREMENTS) {
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
    `Seed MACRA: framework id=${framework.id}, ${upsertedReqs} requirements upserted, ${activations} practice activations.`,
  );

  await backfillFrameworkDerivations(db, "MACRA");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
