// src/lib/ai/client.ts
//
// Lazy singleton Anthropic client. Do NOT call the SDK from route handlers
// or server actions directly — go through src/lib/ai/runLlm.ts so every
// call is prompt-versioned, Zod-validated, and observed (ADR-0003).

import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env locally and Cloud Run Secret Manager in prod.",
    );
  }
  cached = new Anthropic({ apiKey });
  return cached;
}

/** Test-only: reset the cached client so a test can swap in a mock. */
export function __resetAnthropicForTests(): void {
  cached = null;
}
