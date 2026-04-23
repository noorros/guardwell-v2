// scripts/seed-tcpa.ts
//
// Seeds the TCPA (Telephone Consumer Protection Act) compliance framework —
// the seventh v2 framework after HIPAA, OSHA, OIG, DEA, CMS, and CLIA.
//
// Zero derivations at launch. TCPA compliance is consent/opt-out/DNC-driven
// and requires its own operational surfaces (PatientConsentRecord, DncEntry,
// opt-out queue) that are deferred from v1 for this launch. All 7
// requirements are manual-override at launch via /modules/tcpa radios.
//
// V1 carryover: requirements ported from src/app/(dashboard)/tcpa/page.tsx
// TCPA_REQUIREMENTS. V1's operational surface (consent records, DNC list,
// TCPA vendors, opt-out queue) is deliberately deferred — see
// v2-deferred-roadmap.md once TCPA consent tracking is productized.

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

const TCPA_REQUIREMENTS: RequirementFixture[] = [
  {
    code: "TCPA_WRITTEN_CONSENT_POLICY",
    title: "Written TCPA consent policy",
    citation: "47 USC §227 / 47 CFR §64.1200",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "A written policy documenting TCPA consent requirements for all patient communication channels (calls, texts, emails). Policy must distinguish informational (treatment/billing) from marketing messages, define consent collection and revocation procedures, and set record-keeping standards.",
    acceptedEvidenceTypes: [],
    sortOrder: 10,
  },
  {
    code: "TCPA_MARKETING_CONSENT",
    title: "Prior express written consent for marketing",
    citation: "47 CFR §64.1200(a)(2)",
    severity: "CRITICAL",
    weight: 2,
    description:
      "Patients provide prior express written consent before receiving any marketing-related calls or texts. Marketing communications require a signed consent disclosure that the patient agrees to receive automated messages identifying who will call and the purpose.",
    acceptedEvidenceTypes: [],
    sortOrder: 20,
  },
  {
    code: "TCPA_INFORMATIONAL_CONSENT",
    title: "Prior express consent for informational calls",
    citation: "47 CFR §64.1200(a)(1)",
    severity: "STANDARD",
    weight: 1.5,
    description:
      "Prior express consent (written or verbal) is obtained for informational automated calls and texts (appointment reminders, prescription refills). Collect cell phone numbers with consent at point of data capture.",
    acceptedEvidenceTypes: [],
    sortOrder: 30,
  },
  {
    code: "TCPA_OPT_OUT_MECHANISM",
    title: "Opt-out mechanism + 10-business-day processing",
    citation: "47 CFR §64.1200(a)(10)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Every automated call/text includes an easy opt-out mechanism. Texts must include 'Reply STOP to opt out' or equivalent. Calls must provide automated opt-out. Process opt-outs within 10 business days and update DNC lists immediately.",
    acceptedEvidenceTypes: [],
    sortOrder: 40,
  },
  {
    code: "TCPA_DNC_COMPLIANCE",
    title: "National Do Not Call Registry compliance",
    citation: "47 CFR §64.1200(c)",
    severity: "CRITICAL",
    weight: 1.5,
    description:
      "Subscribe to the National Do Not Call Registry and scrub marketing call lists against the Registry every 31 days. Maintain an internal DNC list for patients who have opted out of practice communications.",
    acceptedEvidenceTypes: [],
    sortOrder: 50,
  },
  {
    code: "TCPA_CONSENT_RECORDS",
    title: "Consent records maintained (5-year retention)",
    citation: "47 CFR §64.1200(a)(2)",
    severity: "STANDARD",
    weight: 1,
    description:
      "Patient consent records for calls and texts are maintained and retrievable in the event of a complaint or litigation. Records should show date of consent, method, and specific language used. Retain for the duration of the patient relationship plus 5 years.",
    acceptedEvidenceTypes: [],
    sortOrder: 60,
  },
  {
    code: "TCPA_CALLING_HOURS",
    title: "Calling hours restrictions (8 AM – 9 PM local)",
    citation: "47 CFR §64.1200(c)(1)",
    severity: "STANDARD",
    weight: 1,
    description:
      "Outbound calls to patients are only made between 8 AM and 9 PM local time of the called party. Configure auto-dialers and reminder systems to respect the patient's local time zone. Document the time-zone detection method.",
    acceptedEvidenceTypes: [],
    sortOrder: 70,
  },
];

async function main() {
  const framework = await db.regulatoryFramework.upsert({
    where: { code: "TCPA" },
    update: {
      name: "Telephone Consumer Protection Act",
      shortName: "TCPA",
      description:
        "Federal TCPA rules governing automated patient communications — written consent policy, prior express written consent for marketing, informational-call consent, opt-out mechanisms, Do Not Call Registry compliance, consent records retention, and calling-hour restrictions.",
      citation: "47 USC §227 · 47 CFR §64.1200",
      jurisdiction: "federal",
      weightDefault: 0.04,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "Phone",
      colorKey: "gw-color-warn",
      sortOrder: 70,
    },
    create: {
      code: "TCPA",
      name: "Telephone Consumer Protection Act",
      shortName: "TCPA",
      description:
        "Federal TCPA rules governing automated patient communications — written consent policy, prior express written consent for marketing, informational-call consent, opt-out mechanisms, Do Not Call Registry compliance, consent records retention, and calling-hour restrictions.",
      citation: "47 USC §227 · 47 CFR §64.1200",
      jurisdiction: "federal",
      weightDefault: 0.04,
      scoringStrategy: "STANDARD_CHECKLIST",
      iconKey: "Phone",
      colorKey: "gw-color-warn",
      sortOrder: 70,
    },
  });

  let upsertedReqs = 0;
  for (const r of TCPA_REQUIREMENTS) {
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
    `Seed TCPA: framework id=${framework.id}, ${upsertedReqs} requirements upserted, ${activations} practice activations.`,
  );

  await backfillFrameworkDerivations(db, "TCPA");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
