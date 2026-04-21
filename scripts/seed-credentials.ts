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

async function main() {
  const fixturePath = path.resolve(
    __dirname,
    "_v1-credential-types-export.json",
  );
  const fixtures: CredentialTypeFixture[] = JSON.parse(
    readFileSync(fixturePath, "utf8"),
  );

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
      },
      create: {
        code: f.code,
        name: f.name,
        category: f.category,
        description: f.description,
        renewalPeriodDays: f.renewalPeriodDays,
        sortOrder,
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
