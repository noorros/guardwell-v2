// scripts/eval-weekly-digest.ts
//
// Opt-in eval harness for the weekly digest prompt. Reads fixtures
// from tests/fixtures/prompts/notification.weekly-digest/, runs each
// through composeWeeklyDigest (real Claude calls — costs money), and
// asserts expectedSubstrings appear + forbiddenSubstrings don't.
//
// Usage: npm run eval:weekly-digest
// Requires: ANTHROPIC_API_KEY, DATABASE_URL

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { composeWeeklyDigest } from "../src/lib/notifications/compose-weekly-digest";
import type { NotificationWeeklyDigestInput } from "../src/lib/ai/prompts/notificationWeeklyDigest";

config({ path: ".env" });

const FIXTURE_DIR = path.resolve(
  __dirname,
  "..",
  "tests",
  "fixtures",
  "prompts",
  "notification.weekly-digest",
);

interface Fixture {
  input: NotificationWeeklyDigestInput;
  expectedSubstrings: string[];
  forbiddenSubstrings: string[];
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required");
    process.exit(1);
  }
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  // Lightweight context (no real practice — composeWeeklyDigest accepts any string ids)
  const context = { practiceId: "eval-practice", actorUserId: "eval-user" };

  for (const file of files) {
    const fixturePath = path.join(FIXTURE_DIR, file);
    const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    try {
      const result = await composeWeeklyDigest(fixture.input, context);
      const text = `${result.summary} ${result.topAction ?? ""}`.toLowerCase();
      const missing = fixture.expectedSubstrings.filter(
        (s) => !text.includes(s.toLowerCase()),
      );
      const forbidden = fixture.forbiddenSubstrings.filter((s) =>
        text.includes(s.toLowerCase()),
      );
      if (missing.length === 0 && forbidden.length === 0) {
        console.log(`pass: ${file}`);
        pass += 1;
      } else {
        console.log(`fail: ${file}`);
        if (missing.length > 0) console.log(`  missing: ${missing.join(", ")}`);
        if (forbidden.length > 0)
          console.log(`  forbidden: ${forbidden.join(", ")}`);
        fail += 1;
        failures.push(file);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`fail: ${file}  (error: ${msg})`);
      fail += 1;
      failures.push(file);
    }
  }

  console.log(`\n${pass}/${pass + fail} fixtures passed.`);
  if (fail > 0) {
    console.log(`Failures: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    // No DB connections here — composeWeeklyDigest only calls runLlm.
  });
