// scripts/seed-cms.ts
//
// Seeds the CMS (Medicare/Medicaid) compliance framework — the fifth v2
// framework after HIPAA, OSHA, OIG, and DEA.
//
// PR 4 wires 3 additional requirements + 1 policy-driven stub:
//   CMS_PECOS_ENROLLMENT            ← CREDENTIAL_TYPE:MEDICARE_PECOS_ENROLLMENT
//   CMS_NPI_REGISTRATION            ← CREDENTIAL_TYPE:NPI_REGISTRATION
//   CMS_MEDICARE_PROVIDER_ENROLLMENT ← CREDENTIAL_TYPE:MEDICARE_PROVIDER_ENROLLMENT
//   CMS_EMERGENCY_PREPAREDNESS      ← POLICY:CMS_EMERGENCY_PREPAREDNESS_POLICY
//   CMS_STARK_AKS_COMPLIANCE        ← POLICY:CMS_STARK_AKS_COMPLIANCE_POLICY
//   CMS_BILLING_COMPLIANCE          ← POLICY:CMS_BILLING_COMPLIANCE_POLICY
//   CMS_OVERPAYMENT_REFUND          ← EVENT:OVERPAYMENT_REPORTED

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

const CMS_REQUIREMENTS: RequirementFixture[] = [
  {
    code: "CMS_PECOS_ENROLLMENT",
    title: "Current PECOS enrollment",
    citation: "42 CFR §424.500-545",
    severity: "CRITICAL",
    weight: 2,
    description:
      "Providers Enrollment, Chain, and Ownership System enrollment must be current for any practice billing Medicare. Revalidate every 3 years for physicians/non-physician practitioners and every 5 years for DMEPOS suppliers.",
    acceptedEvidenceTypes: ["CREDENTIAL_TYPE:MEDICARE_PECOS_ENROLLMENT"],
    sortOrder: 10,
  },
  {
    code: "CMS_NPI_REGISTRATION",
    title: "National Provider Identifier (NPI) current",
    citation: "45 CFR §162.406",
    severity: "CRITICAL",
    weight: 2,
    description:
      "Every individual practitioner and practice organization that bills federal health programs must have a current NPI. Update NPPES whenever practice location, taxonomy, or ownership changes within 30 days.",
    acceptedEvidenceTypes: ["CREDENTIAL_TYPE:NPI_REGISTRATION"],
    sortOrder: 20,
  },
  {
    code: "CMS_MEDICARE_PROVIDER_ENROLLMENT",
    title: "Active Medicare billing privileges",
    citation: "42 CFR §424.510",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Active enrollment in the Medicare program via Form CMS-855 (individual, group, or institutional variant). Enrollment must be maintained for any practice billing Medicare or accepting assignment.",
    acceptedEvidenceTypes: ["CREDENTIAL_TYPE:MEDICARE_PROVIDER_ENROLLMENT"],
    sortOrder: 30,
  },
  {
    code: "CMS_EMERGENCY_PREPAREDNESS",
    title: "Emergency Preparedness program (written plan + annual training + drills)",
    citation: "42 CFR §482.15 / §485.68 (Final Rule CMS-3178-F)",
    severity: "STANDARD",
    weight: 1,
    description:
      "Written emergency preparedness plan + risk assessment + communication plan + annual training program + two exercises annually (one full-scale if feasible). Applies to 17 CMS-certified provider types; office-based practices not subject but benefit from voluntary alignment.",
    acceptedEvidenceTypes: ["POLICY:CMS_EMERGENCY_PREPAREDNESS_POLICY"],
    sortOrder: 40,
  },
  {
    code: "CMS_STARK_AKS_COMPLIANCE",
    title: "Stark Law + Anti-Kickback Statute compliance",
    citation: "42 USC §1395nn / 42 USC §1320a-7b",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Annual review of all financial relationships with referring physicians for Stark (physician self-referral) compliance. Safe-harbor analysis for any arrangement potentially implicating the Anti-Kickback Statute. Maintain documented self-disclosure process for identified violations.",
    acceptedEvidenceTypes: ["POLICY:CMS_STARK_AKS_COMPLIANCE_POLICY"],
    sortOrder: 50,
  },
  {
    code: "CMS_BILLING_COMPLIANCE",
    title: "Billing accuracy + documentation sufficiency",
    citation: "42 USC §1320a-7a",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Claims submitted to Medicare/Medicaid must reflect services actually rendered, be supported by contemporaneous documentation in the medical record, and use correct CPT/HCPCS/ICD-10 coding. Periodic internal coding audits required under OIG guidance.",
    acceptedEvidenceTypes: ["POLICY:CMS_BILLING_COMPLIANCE_POLICY"],
    sortOrder: 60,
  },
  {
    code: "CMS_OVERPAYMENT_REFUND",
    title: "60-day overpayment refund process",
    citation: "42 USC §1320a-7k(d)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Identified Medicare/Medicaid overpayments must be refunded within 60 days of identification or the date any corresponding cost report was due. Practices must have a documented process for identifying, quantifying, and refunding overpayments.",
    acceptedEvidenceTypes: ["EVENT:OVERPAYMENT_REPORTED"],
    sortOrder: 70,
  },
];

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "CMS" },
    update: {
      name: "Medicare & Medicaid (CMS)",
      shortName: "CMS",
      description:
        "Centers for Medicare & Medicaid Services obligations for practices billing federal health programs — enrollment, NPI, emergency preparedness, fraud/abuse compliance (Stark + AKS), billing accuracy, and overpayment refunds.",
      citation: "42 CFR Parts 424, 482, 485; 42 USC §§1320a-7a, 1320a-7b, 1320a-7k, 1395nn",
      jurisdiction: "federal",
      weightDefault: 0.12,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "Stethoscope",
      colorKey: "gw-color-good",
      sortOrder: 50,
    },
    create: {
      code: "CMS",
      name: "Medicare & Medicaid (CMS)",
      shortName: "CMS",
      description:
        "Centers for Medicare & Medicaid Services obligations for practices billing federal health programs — enrollment, NPI, emergency preparedness, fraud/abuse compliance (Stark + AKS), billing accuracy, and overpayment refunds.",
      citation: "42 CFR Parts 424, 482, 485; 42 USC §§1320a-7a, 1320a-7b, 1320a-7k, 1395nn",
      jurisdiction: "federal",
      weightDefault: 0.12,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "Stethoscope",
      colorKey: "gw-color-good",
      sortOrder: 50,
    },
  });

  let upsertedReqs = 0;
  for (const r of CMS_REQUIREMENTS) {
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
    `Seed CMS: framework id=${framework.id}, ${upsertedReqs} requirements upserted, ${activations} practice activations.`,
  );

  await backfillFrameworkDerivations(db, "CMS");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
