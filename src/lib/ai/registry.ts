// src/lib/ai/registry.ts
//
// THE SOURCE OF TRUTH for every LLM prompt. Adding or changing a prompt:
//   1. Create / edit src/lib/ai/prompts/<id-with-hyphens>.ts
//   2. Add an entry to PROMPTS below
//   3. Write a fixture under tests/fixtures/prompts/<id>/<name>.json
//   4. Add an assertion in scripts/eval-prompts.ts
//
// Prompt ids are dot-namespaced (e.g. "hipaa.assess.v1"). Tool names in
// Anthropic messages cannot contain dots, so we derive toolName by
// replacing "." with "_".

import { z } from "zod";
import {
  HIPAA_ASSESS_SYSTEM,
  hipaaAssessInputSchema,
  hipaaAssessOutputSchema,
} from "./prompts/hipaa-assess";

export interface PromptDef<
  TIn extends z.ZodTypeAny = z.ZodTypeAny,
  TOut extends z.ZodTypeAny = z.ZodTypeAny,
> {
  id: string;
  version: number;
  model: string;
  system: string;
  inputSchema: TIn;
  outputSchema: TOut;
  /** Tool name must match ^[a-zA-Z0-9_-]{1,64}$ for Anthropic's API. */
  toolName: string;
  toolDescription: string;
  /** Maximum tokens the model may emit. Prevents runaway cost. */
  maxTokens: number;
}

function idToToolName(id: string): string {
  return id.replace(/\./g, "_");
}

export const PROMPTS = {
  "hipaa.assess.v1": {
    id: "hipaa.assess.v1",
    version: 1,
    model: "claude-opus-4-7",
    system: HIPAA_ASSESS_SYSTEM,
    inputSchema: hipaaAssessInputSchema,
    outputSchema: hipaaAssessOutputSchema,
    toolName: idToToolName("hipaa.assess.v1"),
    toolDescription:
      "Return a best-guess status (COMPLIANT | GAP | NOT_STARTED) and reason for each requested HIPAA requirement code.",
    maxTokens: 2048,
  },
} as const satisfies Record<string, PromptDef>;

export type PromptId = keyof typeof PROMPTS;

export function getPrompt<T extends PromptId>(id: T): (typeof PROMPTS)[T] {
  const p = PROMPTS[id];
  if (!p) throw new Error(`Unknown prompt id: ${id}`);
  return p;
}
