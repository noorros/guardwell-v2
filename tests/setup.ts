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
  // Allergy module tables reference PracticeUser — must be deleted first.
  await db.allergyEquipmentCheck.deleteMany();
  await db.allergyDrill.deleteMany();
  await db.allergyCompetency.deleteMany();
  await db.allergyQuizAttempt.deleteMany();
  await db.practiceUser.deleteMany();
  await db.complianceItem.deleteMany();
  await db.practiceFramework.deleteMany();
  await db.practice.deleteMany();
  await db.user.deleteMany();
});
