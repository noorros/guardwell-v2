// src/lib/ai/client.ts
//
// Lazy singleton Anthropic client. Do NOT call the SDK from route handlers
// or server actions directly — go through src/lib/ai/runLlm.ts so every
// call is prompt-versioned, Zod-validated, and observed (ADR-0003). The
// streaming Concierge runtime (src/lib/ai/streamConciergeTurn.ts) is the
// one allowed exception, and it pulls the client through this module so
// tests can inject a stub via __setAnthropicForTests.

import Anthropic from "@anthropic-ai/sdk";

/** Subset of the Anthropic SDK surface area the streaming runtime touches.
 *  Tests provide a stub that implements only `messages.stream`; the rest of
 *  the SDK isn't reached. */
type AnthropicLike = Pick<InstanceType<typeof Anthropic>, "messages">;

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

/** Test-only: inject an Anthropic-shaped stub (typically just the
 *  `messages.stream` surface). The cast through `unknown` is intentional —
 *  tests don't reach the rest of the SDK. */
export function __setAnthropicForTests(stub: AnthropicLike | null): void {
  cached = stub as Anthropic | null;
}
