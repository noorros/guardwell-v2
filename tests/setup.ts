import { config } from "dotenv";
config({ path: ".env" });

import { afterEach, beforeAll } from "vitest";
import { db } from "@/lib/db";

beforeAll(async () => {
  await db.$connect();
});

afterEach(async () => {
  await db.eventLog.deleteMany();
  await db.practiceUser.deleteMany();
  await db.complianceItem.deleteMany();
  await db.practiceFramework.deleteMany();
  await db.practice.deleteMany();
  await db.user.deleteMany();
});
