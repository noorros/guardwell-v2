// scripts/seed-hipaa.ts
//
// Idempotent: re-running upserts every row keyed by its natural unique
// (framework.code, requirement.(frameworkId, code)). Produces 1
// RegulatoryFramework + 10 RegulatoryRequirement rows for HIPAA.
//
// Usage:
//   npm run db:seed:hipaa
//
// Adding a module (e.g. OSHA) later is a sibling script with the same
// shape — no platform code changes (ADR-0004).

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { backfillFrameworkDerivations } from "./lib/backfill-derivations";

config({ path: ".env" });

const db = new PrismaClient();

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "HIPAA" },
    update: {
      name: "Health Insurance Portability and Accountability Act",
      shortName: "HIPAA",
      description:
        "Federal privacy, security, and breach-notification obligations for covered entities and business associates.",
      citation: "45 CFR Parts 160, 162, and 164",
      jurisdiction: "federal",
      weightDefault: 0.25,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "ShieldCheck",
      colorKey: "gw-color-good",
      sortOrder: 10,
    },
    create: {
      code: "HIPAA",
      name: "Health Insurance Portability and Accountability Act",
      shortName: "HIPAA",
      description:
        "Federal privacy, security, and breach-notification obligations for covered entities and business associates.",
      citation: "45 CFR Parts 160, 162, and 164",
      jurisdiction: "federal",
      weightDefault: 0.25,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "ShieldCheck",
      colorKey: "gw-color-good",
      sortOrder: 10,
    },
  });

  const requirements = [
    {
      code: "HIPAA_PRIVACY_OFFICER",
      title: "Designate a Privacy Officer",
      citation: "45 CFR §164.530(a)(1)(i)",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "A covered entity must designate a Privacy Officer responsible for the development and implementation of the policies and procedures.",
      acceptedEvidenceTypes: ["OFFICER_DESIGNATION:PRIVACY"],
      sortOrder: 10,
    },
    {
      code: "HIPAA_SECURITY_OFFICER",
      title: "Designate a Security Officer",
      citation: "45 CFR §164.308(a)(2)",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "Identify the security official responsible for developing and implementing the required policies and procedures.",
      acceptedEvidenceTypes: ["OFFICER_DESIGNATION:SECURITY"],
      sortOrder: 20,
    },
    {
      code: "HIPAA_SRA",
      title: "Conduct a Security Risk Assessment",
      citation: "45 CFR §164.308(a)(1)(ii)(A)",
      severity: "CRITICAL",
      weight: 2,
      description:
        "Perform an accurate and thorough assessment of risks and vulnerabilities to the confidentiality, integrity, and availability of ePHI. Requires a current asset inventory (≥1 PHI-processing asset on /programs/security-assets) plus a completed SRA wizard within the last 365 days.",
      acceptedEvidenceTypes: ["SRA_COMPLETED", "TECH_ASSET:UPSERTED"],
      sortOrder: 30,
    },
    {
      code: "HIPAA_POLICIES_PROCEDURES",
      title: "Written HIPAA policies and procedures",
      citation: "45 CFR §164.530(i)(1)",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "Implement policies and procedures with respect to protected health information to comply with the Privacy and Security Rules.",
      acceptedEvidenceTypes: [
        "POLICY:HIPAA_PRIVACY_POLICY",
        "POLICY:HIPAA_SECURITY_POLICY",
        "POLICY:HIPAA_BREACH_RESPONSE_POLICY",
      ],
      sortOrder: 40,
    },
    {
      code: "HIPAA_POLICIES_REVIEW_CURRENT",
      title: "Review policies + procedures within the last 12 months",
      citation: "45 CFR §164.530(i)(2)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Periodically review and update policies and procedures. Annual review is the de-facto standard. Review attestation logged via the Review button on each policy at /programs/policies — bumps lastReviewedAt.",
      acceptedEvidenceTypes: ["POLICY_REVIEW:CURRENT"],
      sortOrder: 45,
    },
    {
      code: "HIPAA_DOCUMENTATION_RETENTION",
      title: "Active document destruction cadence",
      citation: "45 CFR §164.530(j)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Maintain a destruction cadence for retired documents — paper shredding, secure media wipe, deidentification. Log each batch at /programs/document-retention; the rule flips COMPLIANT once ≥1 destruction event lands in the last 365 days. Mark NOT_APPLICABLE if your practice genuinely has nothing destroyed in a year.",
      acceptedEvidenceTypes: ["DESTRUCTION:LOGGED"],
      sortOrder: 47,
    },
    {
      code: "HIPAA_WORKFORCE_TRAINING",
      title: "Train all workforce members on HIPAA",
      citation: "45 CFR §164.530(b)(1)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Train all members of the workforce on policies and procedures with respect to PHI, as necessary and appropriate for them to carry out their function.",
      acceptedEvidenceTypes: ["TRAINING:HIPAA_BASICS"],
      sortOrder: 50,
    },
    {
      code: "HIPAA_BAAS",
      title: "Execute Business Associate Agreements",
      citation: "45 CFR §164.308(b)(1)",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "Obtain satisfactory assurances from business associates that they will appropriately safeguard PHI.",
      acceptedEvidenceTypes: ["BAA_EXECUTED"],
      sortOrder: 60,
    },
    {
      code: "HIPAA_MINIMUM_NECESSARY",
      title: "Minimum-necessary use and disclosure policy",
      citation: "45 CFR §164.502(b)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Limit uses, disclosures, and requests of PHI to the minimum necessary to accomplish the intended purpose.",
      acceptedEvidenceTypes: ["POLICY:HIPAA_MINIMUM_NECESSARY_POLICY"],
      sortOrder: 70,
    },
    {
      code: "HIPAA_NPP",
      title: "Notice of Privacy Practices available to patients",
      citation: "45 CFR §164.520(a)(1)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Provide a notice of privacy practices describing how PHI may be used and disclosed, and the individual's rights.",
      acceptedEvidenceTypes: ["POLICY:HIPAA_NPP_POLICY"],
      sortOrder: 80,
    },
    {
      code: "HIPAA_BREACH_RESPONSE",
      title: "Written breach response procedure",
      citation: "45 CFR §164.404",
      severity: "CRITICAL",
      weight: 1.5,
      description:
        "Maintain a documented procedure for investigating, assessing, and notifying affected individuals of breaches of unsecured PHI.",
      acceptedEvidenceTypes: ["POLICY:HIPAA_BREACH_RESPONSE_POLICY"],
      sortOrder: 90,
    },
    {
      code: "HIPAA_WORKSTATION_USE",
      title: "Workstation use and security policy",
      citation: "45 CFR §164.310(b)-(c)",
      severity: "STANDARD",
      weight: 1,
      description:
        "Implement policies and procedures that specify the proper functions to be performed and the physical safeguards for workstations that access ePHI.",
      acceptedEvidenceTypes: ["POLICY:HIPAA_WORKSTATION_POLICY"],
      sortOrder: 100,
    },
  ];

  let upserted = 0;
  for (const r of requirements) {
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
    upserted += 1;
  }

  console.log(
    `Seed HIPAA: framework id=${framework.id}, ${upserted} requirements upserted.`,
  );

  await backfillFrameworkDerivations(db, "HIPAA");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
