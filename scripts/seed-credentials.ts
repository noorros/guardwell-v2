// scripts/seed-credentials.ts
//
// Idempotent seeder for CredentialType reference data. Ports v1's 52
// system-wide credential types across 12 categories (clinical licenses,
// DEA registration, board certs, BLS/ACLS, vaccinations, malpractice
// insurance, facility licenses, Medicare/Medicaid, OSHA training,
// HIPAA training, background checks, custom).
//
// Usage:
//   npm run db:seed:credentials

import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env" });

const db = new PrismaClient();

interface CredentialTypeFixture {
  code: string;
  name: string;
  category:
    | "CLINICAL_LICENSE"
    | "DEA_REGISTRATION"
    | "BOARD_CERTIFICATION"
    | "CPR_BLS_ACLS"
    | "VACCINATION"
    | "MALPRACTICE_INSURANCE"
    | "FACILITY_LICENSE"
    | "MEDICARE_MEDICAID"
    | "OSHA_TRAINING"
    | "HIPAA_TRAINING"
    | "BACKGROUND_CHECK"
    | "CUSTOM";
  description: string | null;
  renewalPeriodDays: number | null;
  // Optional CEU/CME fields (chunk 5 Phase A). Leave undefined for types
  // whose CEU defaults aren't yet known — customer demand will surface
  // the right values post-launch.
  ceuRequirementHours?: number | null;
  ceuRequirementWindowMonths?: number | null;
  requiresEvidenceByDefault?: boolean;
}

const CATEGORY_ORDER: CredentialTypeFixture["category"][] = [
  "CLINICAL_LICENSE",
  "DEA_REGISTRATION",
  "BOARD_CERTIFICATION",
  "CPR_BLS_ACLS",
  "VACCINATION",
  "MALPRACTICE_INSURANCE",
  "FACILITY_LICENSE",
  "MEDICARE_MEDICAID",
  "OSHA_TRAINING",
  "HIPAA_TRAINING",
  "BACKGROUND_CHECK",
  "CUSTOM",
];

// Additional fixtures injected at runtime — kept here (vs the v1 JSON
// export) so we can attach CEU/evidence metadata without touching the
// frozen v1 export. Add new types here when customer demand surfaces.
// Other categories (CLINICAL_LICENSE renewals, etc.) can be filled in
// post-launch once the CEU UI ships.
const EXTRA_FIXTURES: CredentialTypeFixture[] = [
  {
    code: "MEDICAL_ASSISTANT_CERT",
    name: "Certified Medical Assistant (CMA)",
    category: "BOARD_CERTIFICATION",
    description:
      "AAMA / AMT / NCMA / NHA certification with 30 hours CEU per 5 years.",
    renewalPeriodDays: 5 * 365,
    ceuRequirementHours: 30,
    ceuRequirementWindowMonths: 60,
    requiresEvidenceByDefault: true,
  },
];

async function main() {
  const fixturePath = path.resolve(
    __dirname,
    "_v1-credential-types-export.json",
  );
  const v1Fixtures: CredentialTypeFixture[] = JSON.parse(
    readFileSync(fixturePath, "utf8"),
  );
  const fixtures: CredentialTypeFixture[] = [...v1Fixtures, ...EXTRA_FIXTURES];

  let upserted = 0;
  for (const f of fixtures) {
    const sortOrder =
      CATEGORY_ORDER.indexOf(f.category) * 100 + (upserted % 100);
    await db.credentialType.upsert({
      where: { code: f.code },
      update: {
        name: f.name,
        category: f.category,
        description: f.description,
        renewalPeriodDays: f.renewalPeriodDays,
        sortOrder,
        ceuRequirementHours: f.ceuRequirementHours ?? null,
        ceuRequirementWindowMonths: f.ceuRequirementWindowMonths ?? null,
        requiresEvidenceByDefault: f.requiresEvidenceByDefault ?? false,
      },
      create: {
        code: f.code,
        name: f.name,
        category: f.category,
        description: f.description,
        renewalPeriodDays: f.renewalPeriodDays,
        sortOrder,
        ceuRequirementHours: f.ceuRequirementHours ?? null,
        ceuRequirementWindowMonths: f.ceuRequirementWindowMonths ?? null,
        requiresEvidenceByDefault: f.requiresEvidenceByDefault ?? false,
      },
    });
    upserted += 1;
  }

  console.log(`Seed credentials: ${upserted} credential types upserted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
