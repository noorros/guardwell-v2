// scripts/seed-allergy.ts
//
// Idempotent seeder for the ALLERGY regulatory framework.
// Seeds 1 RegulatoryFramework + 9 RegulatoryRequirements + 44 AllergyQuizQuestions
// from _v1-allergy-quiz-export.json (if present).
//
// Usage:
//   npx tsx scripts/seed-allergy.ts

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });

const db = new PrismaClient();

const REQUIREMENTS = [
  // --- Manual policy attestations (5) ---
  {
    code: "ALLERGY_DESIGNATED_COMPOUNDING_AREA",
    title: "Designated compounding area (USP §21.1)",
    description:
      "A physically designated, low-traffic compounding area with a clean non-porous work surface disinfected before each session. No cleanroom required — §21 carve-out — but the area must be separated from patient flow and free of food/drink during compounding.",
    severity: "MEDIUM",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_COMPOUNDING_AREA_SOP"],
    sortOrder: 10,
  },
  {
    code: "ALLERGY_HAND_HYGIENE_GARBING",
    title: "Hand hygiene + garbing procedures (USP §21.2)",
    description:
      "Written SOP covering ≥30-second handwash, low-lint drying, sterile/low-particulate gloves, clean lab coat or scrub top, hair restraint, and IPA re-application any time hands contact a non-sterile surface. No artificial nails or jewelry on hands/wrists during compounding.",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_HAND_HYGIENE_GARBING_SOP"],
    sortOrder: 20,
  },
  {
    code: "ALLERGY_BUD_LABELING_PROCEDURE",
    title: "Beyond-Use Date (BUD) labeling SOP (USP §21.4)",
    description:
      "Written procedure for calculating BUD as the earlier of: (a) earliest component manufacturer expiry or (b) 1 year from compounding date. Every vial must carry its BUD. No practice action (additives, storage modifications) can extend the BUD beyond these limits.",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_BUD_LABELING_SOP"],
    sortOrder: 30,
  },
  {
    code: "ALLERGY_VIAL_LABELING_PROCEDURE",
    title: "Vial labeling SOP (USP §21.5)",
    description:
      "Written procedure ensuring every compounded vial carries: two patient identifiers (name + DOB), allergen contents + v/v concentration, vial color code, BUD, compounder identifier, and storage temperature (Refrigerate 2–8°C; do not freeze). Standardized AAAAI/ACAAI color coding strongly recommended.",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_VIAL_LABELING_SOP"],
    sortOrder: 40,
  },
  {
    code: "ALLERGY_RECORDS_RETENTION_3YR",
    title: "Compounding records retained ≥3 years (state pharmacy practice acts)",
    description:
      "Compounding batch records (patient, allergens, concentrations, volumes, lot numbers, compounder, verifier, BUD) retained for at least 3 years after the vial's BUD. Most state boards require 3–5 years; check your state's pharmacy practice act for the applicable minimum.",
    severity: "MEDIUM",
    weight: 1,
    acceptedEvidenceTypes: ["POLICY:ALLERGY_RECORDS_RETENTION_SOP"],
    sortOrder: 50,
  },
  // --- Derived requirements (4) — see src/lib/compliance/derivation/allergy.ts ---
  {
    code: "ALLERGY_COMPETENCY",
    title: "Annual 3-component competency for every compounder (USP §21.3)",
    description:
      "Every active compounder must complete all three components annually: (A) written knowledge assessment, (B) gloved fingertip + thumb sampling on TSA plates (no growth), and (C) media fill test (TSB incubated 14 days, no turbidity). Initial qualification requires 3 passes on component B. Inactive ≥6 months requires full re-evaluation. Derived from AllergyCompetency.isFullyQualified.",
    severity: "CRITICAL",
    weight: 2,
    acceptedEvidenceTypes: [],
    sortOrder: 60,
  },
  {
    code: "ALLERGY_EMERGENCY_KIT_CURRENT",
    title: "Emergency kit current (epi unexpired, all items present) within 90 days",
    description:
      "Epinephrine 1:1000 injectable plus full emergency kit (antihistamine, corticosteroid, airway adjuncts, BP cuff, pulse oximeter) verified unexpired and present within the last 90 days. Derived from an AllergyCheck of type EMERGENCY_KIT recorded within 90 days.",
    severity: "CRITICAL",
    weight: 2,
    acceptedEvidenceTypes: [],
    sortOrder: 70,
  },
  {
    code: "ALLERGY_REFRIGERATOR_LOG",
    title: "Refrigerator temp log within 30 days, in 2–8°C range",
    description:
      "Continuous or at-minimum daily refrigerator temperature monitoring with documented records. Most recent log entry within 30 days and no excursions above 8°C or below 2°C. Derived from AllergyCheck of type REFRIGERATOR_TEMP.",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: [],
    sortOrder: 80,
  },
  {
    code: "ALLERGY_ANNUAL_DRILL",
    title: "Anaphylaxis drill within last 365 days",
    description:
      "Full office anaphylaxis drill (simulated systemic reaction, epinephrine administration, 911 activation protocol) conducted within the last 365 days with documented attendance + debrief. Published best-practice: twice yearly. Derived from an AllergyCheck of type EMERGENCY_KIT with drill_conducted flag.",
    severity: "HIGH",
    weight: 1,
    acceptedEvidenceTypes: [],
    sortOrder: 90,
  },
];

async function main() {
  // 1. Upsert framework
  const fw = await db.regulatoryFramework.upsert({
    where: { code: "ALLERGY" },
    update: {
      name: "Allergy / USP 797 §21",
      shortName: "Allergy",
      description:
        "USP General Chapter 797 §21 carve-out governing allergen extract compounding in allergy/immunology practices. Covers designated compounding area, hand hygiene + garbing, annual three-component compounder competency (written quiz, gloved fingertip sampling, media fill), BUD labeling, vial labeling, and records retention. Effective November 1, 2023.",
      sortOrder: 100,
    },
    create: {
      code: "ALLERGY",
      name: "Allergy / USP 797 §21",
      shortName: "Allergy",
      description:
        "USP General Chapter 797 §21 carve-out governing allergen extract compounding in allergy/immunology practices. Covers designated compounding area, hand hygiene + garbing, annual three-component compounder competency (written quiz, gloved fingertip sampling, media fill), BUD labeling, vial labeling, and records retention. Effective November 1, 2023.",
      sortOrder: 100,
    },
  });
  console.log(`Framework: ${fw.code} (${fw.id})`);

  // 2. Upsert requirements
  let upsertedReqs = 0;
  for (const r of REQUIREMENTS) {
    await db.regulatoryRequirement.upsert({
      where: { frameworkId_code: { frameworkId: fw.id, code: r.code } },
      update: {
        title: r.title,
        description: r.description,
        severity: r.severity,
        weight: r.weight,
        acceptedEvidenceTypes: r.acceptedEvidenceTypes,
        sortOrder: r.sortOrder,
      },
      create: {
        frameworkId: fw.id,
        code: r.code,
        title: r.title,
        description: r.description,
        severity: r.severity,
        weight: r.weight,
        acceptedEvidenceTypes: r.acceptedEvidenceTypes,
        sortOrder: r.sortOrder,
      },
    });
    upsertedReqs += 1;
  }
  console.log(`Upserted ${upsertedReqs} requirements`);

  // 3. Seed quiz questions from _v1-allergy-quiz-export.json
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const exportPath = path.join("scripts", "_v1-allergy-quiz-export.json");

  try {
    const text = await fs.readFile(exportPath, "utf-8");
    const questions = JSON.parse(text) as Array<{
      questionText: string;
      options: Array<{ id: string; text: string }>;
      correctId: string;
      explanation?: string;
      category: string;
      displayOrder: number;
    }>;

    let upsertedQs = 0;
    for (const q of questions) {
      const stableId = `allergy-q-${q.category.toLowerCase()}-${q.displayOrder}`;
      await db.allergyQuizQuestion.upsert({
        where: { id: stableId },
        update: {
          questionText: q.questionText,
          options: q.options,
          correctId: q.correctId,
          explanation: q.explanation ?? null,
          category: q.category as never,
          displayOrder: q.displayOrder,
          isActive: true,
        },
        create: {
          id: stableId,
          questionText: q.questionText,
          options: q.options,
          correctId: q.correctId,
          explanation: q.explanation ?? null,
          category: q.category as never,
          displayOrder: q.displayOrder,
          isActive: true,
        },
      });
      upsertedQs += 1;
    }
    console.log(`Upserted ${upsertedQs} quiz questions`);
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") {
      console.log(
        "scripts/_v1-allergy-quiz-export.json not present — skipping quiz seed",
      );
    } else {
      throw err;
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
