// scripts/eval-regulatory-relevance.ts
//
// Opt-in eval harness for the regulatory relevance prompt. Reads
// fixtures from tests/fixtures/prompts/regulatory.relevance/, runs each
// through analyzeArticle (real Claude calls — costs money), and asserts
// expectedSubstrings appear + forbiddenSubstrings don't.
//
// Usage: npm run eval:regulatory-relevance
// Requires: ANTHROPIC_API_KEY, DATABASE_URL

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { analyzeArticle } from "../src/lib/regulatory/analyzeArticle";
import type { RegulatoryRelevanceInput } from "../src/lib/ai/prompts/regulatoryRelevance";

config({ path: ".env" });

const FIXTURE_DIR = path.resolve(
  __dirname,
  "..",
  "tests",
  "fixtures",
  "prompts",
  "regulatory.relevance",
);

interface Fixture {
  input: RegulatoryRelevanceInput;
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

  // Lightweight context (no real practice — analyzeArticle accepts any string ids)
  const context = { practiceId: "eval-practice", actorUserId: "eval-user" };

  for (const file of files) {
    const fixturePath = path.join(FIXTURE_DIR, file);
    const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
    try {
      const result = await analyzeArticle(fixture.input, context);
      if (result === null) {
        console.log(`fail: ${file}  (analyzer returned null)`);
        fail += 1;
        failures.push(file);
        continue;
      }
      const flatRelevance = result.perFrameworkRelevance
        .filter((p) => p.relevance === "MED" || p.relevance === "HIGH")
        .map((p) => p.framework)
        .join(" ");
      const text =
        `${result.summary} ${result.recommendedActions.join(" ")} ${result.severity} ${flatRelevance}`.toLowerCase();
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
    // No DB connections here — analyzeArticle only calls runLlm.
  });
