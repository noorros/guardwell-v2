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

// California HIPAA overlays. These layer on top of federal HIPAA — a
// California practice sees these alongside the 10 federal HIPAA
// requirements; non-California practices don't see them at all.
const OVERLAYS: StateOverlayFixture[] = [
  {
    frameworkCode: "HIPAA",
    code: "HIPAA_CA_BREACH_NOTIFICATION_72HR",
    title: "Breach notification within 15 business days (CA)",
    citation: "Cal. Civil Code §56.36 · Health & Safety Code §1280.15",
    severity: "CRITICAL",
    weight: 2,
    description:
      "California requires notice of medical-information breaches within 15 business days to both the affected individual and the California Department of Public Health — a stricter timeline than HIPAA's 60-day ceiling. Practices must meet both: the 15-business-day state clock supersedes the federal one whenever CA law applies.",
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
      "The Confidentiality of Medical Information Act requires signed, specific patient authorization before disclosing medical information for most non-treatment purposes. California's authorization requirements are broader than HIPAA's — for example, CMIA covers employer-held medical info that HIPAA does not.",
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
      "For California residents, the CCPA/CPRA grants access, deletion, correction, and opt-out rights over personal information held outside the HIPAA treatment/payment/operations scope (marketing lists, patient portal analytics, vendor sharing). Practices must publish a privacy notice, honor verified consumer requests, and track fulfillment within 45 days.",
    jurisdictionFilter: ["CA"],
    acceptedEvidenceTypes: ["POLICY:CA_CCPA_PRIVACY_NOTICE"],
    sortOrder: 220,
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
