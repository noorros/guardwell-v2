import { config } from "dotenv";
config({ path: ".env" });

// Short-circuit Upstash rate-limiting in tests — the integration suite
// hits a real Postgres but must NOT reach an external Redis. Matches the
// escape hatch defined in src/lib/ai/rateLimit.ts.
process.env.UPSTASH_DISABLE = "1";

import { afterEach, beforeAll } from "vitest";
import { db } from "@/lib/db";

beforeAll(async () => {
  await db.$connect();
});

afterEach(async () => {
  await db.llmCall.deleteMany();
  await db.eventLog.deleteMany();
  // Evidence references PracticeUser — must be deleted before PracticeUser.
  await db.evidence.deleteMany();
  // Allergy module tables reference PracticeUser — must be deleted first.
  await db.allergyEquipmentCheck.deleteMany();
  await db.allergyDrill.deleteMany();
  await db.allergyCompetency.deleteMany();
  await db.allergyQuizAttempt.deleteMany();
  // DEA models reference Practice (via FK) and PracticeUser (no FK; just
  // userId scalars). Cascade-on-Practice handles cleanup, but explicit
  // deletes here keep test setup deterministic.
  await db.deaInventoryItem.deleteMany();
  await db.deaInventory.deleteMany();
  await db.deaOrderRecord.deleteMany();
  await db.deaDisposalRecord.deleteMany();
  await db.deaTheftLossReport.deleteMany();
  // CEU + reminder configs reference Credential (cascade) and
  // PracticeUser (no FK). Explicit deletes keep test setup deterministic.
  await db.ceuActivity.deleteMany();
  await db.credentialReminderConfig.deleteMany();
  await db.practiceUser.deleteMany();
  await db.complianceItem.deleteMany();
  await db.practiceFramework.deleteMany();
  await db.practice.deleteMany();
  await db.user.deleteMany();
});
