// scripts/eval-prompts.ts
//
// Usage:
//   npm run eval:prompts
//
// Runs every fixture under tests/fixtures/prompts/<promptId>/*.json against
// its prompt via runLlm(). Assertions are either shared per-prompt (e.g.
// hipaa.assess.v1 rejects unknown codes) or fixture-scoped
// (fixture.assertions). Exits non-zero if any assertion fails.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env" });

import { runLlm } from "../src/lib/ai/runLlm";
import { PROMPTS, type PromptId } from "../src/lib/ai/registry";

type Fixture = {
  name: string;
  input: unknown;
  assertions?: {
    minSuggestions?: number;
    maxSuggestions?: number;
    allCodesMustBeInInput?: boolean;
    noDuplicateCodes?: boolean;
    reasonMinChars?: number;
    maxCompliantRatio?: number;
    everyStatusAllowed?: string[];
  };
};

async function runFixture(promptId: PromptId, fix: Fixture): Promise<string[]> {
  const errors: string[] = [];
  const result = await runLlm(promptId, fix.input as never);
  const out = result.output as {
    suggestions: Array<{ requirementCode: string; likelyStatus: string; reason: string }>;
  };

  // Shared assertions for hipaa.assess.v1:
  if (promptId === "hipaa.assess.v1") {
    const inputCodes = new Set(
      (fix.input as { requirementCodes: string[] }).requirementCodes,
    );
    const seen = new Set<string>();
    for (const s of out.suggestions) {
      if (!inputCodes.has(s.requirementCode)) {
        errors.push(`[${fix.name}] hallucinated code: ${s.requirementCode}`);
      }
      if (seen.has(s.requirementCode)) {
        errors.push(`[${fix.name}] duplicate code: ${s.requirementCode}`);
      }
      seen.add(s.requirementCode);
    }
  }

  // Fixture assertions:
  const a = fix.assertions ?? {};
  if (typeof a.minSuggestions === "number" && out.suggestions.length < a.minSuggestions) {
    errors.push(
      `[${fix.name}] expected >= ${a.minSuggestions} suggestions, got ${out.suggestions.length}`,
    );
  }
  if (typeof a.maxSuggestions === "number" && out.suggestions.length > a.maxSuggestions) {
    errors.push(
      `[${fix.name}] expected <= ${a.maxSuggestions} suggestions, got ${out.suggestions.length}`,
    );
  }
  if (typeof a.reasonMinChars === "number") {
    for (const s of out.suggestions) {
      if (s.reason.length < a.reasonMinChars) {
        errors.push(`[${fix.name}] reason too short for ${s.requirementCode}: "${s.reason}"`);
      }
    }
  }
  if (a.everyStatusAllowed) {
    for (const s of out.suggestions) {
      if (!a.everyStatusAllowed.includes(s.likelyStatus)) {
        errors.push(
          `[${fix.name}] disallowed status ${s.likelyStatus} for ${s.requirementCode}`,
        );
      }
    }
  }
  if (typeof a.maxCompliantRatio === "number") {
    const compliant = out.suggestions.filter((s) => s.likelyStatus === "COMPLIANT").length;
    const ratio = compliant / out.suggestions.length;
    if (ratio > a.maxCompliantRatio) {
      errors.push(
        `[${fix.name}] too many COMPLIANT (${ratio.toFixed(2)} > ${a.maxCompliantRatio})`,
      );
    }
  }
  if (a.noDuplicateCodes) {
    const codes = new Set<string>();
    for (const s of out.suggestions) {
      if (codes.has(s.requirementCode)) {
        errors.push(`[${fix.name}] duplicate code: ${s.requirementCode}`);
      }
      codes.add(s.requirementCode);
    }
  }

  return errors;
}

async function main() {
  const root = path.join(process.cwd(), "tests", "fixtures", "prompts");
  const allErrors: string[] = [];
  let totalFixtures = 0;

  for (const promptId of Object.keys(PROMPTS) as PromptId[]) {
    const dir = path.join(root, promptId);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      console.log(`[eval] no fixtures for ${promptId} (skipping)`);
      continue;
    }
    for (const file of files) {
      totalFixtures += 1;
      const raw = readFileSync(path.join(dir, file), "utf8");
      const fix = JSON.parse(raw) as Fixture;
      process.stdout.write(`[eval] ${promptId} > ${fix.name} ... `);
      try {
        const errors = await runFixture(promptId, fix);
        if (errors.length === 0) {
          process.stdout.write("PASS\n");
        } else {
          process.stdout.write("FAIL\n");
          for (const e of errors) console.log(`       ${e}`);
          allErrors.push(...errors);
        }
      } catch (err) {
        process.stdout.write("ERROR\n");
        allErrors.push(`[${fix.name}] ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`\n[eval] ran ${totalFixtures} fixture(s); ${allErrors.length} error(s).`);
  process.exitCode = allErrors.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
