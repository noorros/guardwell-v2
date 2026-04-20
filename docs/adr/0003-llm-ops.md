# ADR-0003: LLM ops layer from day one

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Noorros, Engineering
**Related:** [ADR-0001 — Event sourcing](0001-event-sourcing.md)

## Context

GuardWell uses Claude (Anthropic) heavily — AI Concierge, regulatory
analyzer, policy template personalization, training course generation,
breach wizard four-factor reasoning. v1 calls the SDK directly from
scattered server actions with no observability, no prompt versioning,
and no eval harness. Two consequences observed in v1:

1. **Regulatory poisoning incident risk**: a malicious feed could (and
   nearly did, before Phase 6 hardening) inject instructions that altered
   policy templates. v1 added prompt sanitization + a circuit breaker as
   reactive patches; v2 should make safety structural.
2. **Prompt drift is invisible**: which prompt produced what answer
   isn't recorded, so when a customer reports a bad answer there's no
   way to reproduce it.

For a compliance product where AI mistakes have legal consequences, this
needs first-class infrastructure.

## Decision

Build a thin LLM ops layer in `src/lib/ai/` that wraps every Anthropic
call with:

1. **Prompt versioning in code.** Each prompt is an exported constant
   like `PROMPT_REGULATORY_ANALYZER_V3`. Prompts never get edited in
   place — bumping a version means a new constant and a new entry in the
   prompt registry. Every LLM call records which prompt version it used.
2. **Structured outputs by default** via Zod schemas + Anthropic's
   tool-use-as-output pattern. No more "parse the markdown out of the
   response."
3. **Eval harness** — every prompt has at least one `*.eval.ts` file
   defining input/expected-shape pairs that run against the prompt
   weekly via cron and on every PR that touches the prompt registry.
4. **Observability**: every call logs (prompt version, input hash, model,
   latency, token counts, cost estimate, structured output) to a
   `LlmCall` table. Optional integration with Helicone or Langfuse via
   `LLM_OPS_PROVIDER` env var when configured.
5. **PII guards**: a single `redactPHI()` step runs on inputs by default;
   server actions opt out only with explicit `{ allowPHI: true }` and
   that flag is logged.
6. **Per-user rate limiting** via Upstash on the wrapper, not in each
   call site.

## Options considered

- **Direct SDK calls (v1 status quo)**: Lowest friction, observed to fail.
- **Vercel AI SDK only**: Provides streaming + tools but no
  ops/eval/versioning.
- **External LLM ops platform (Langfuse, Helicone)**: Use as
  observability backend, but our wrapper still needs to enforce
  versioning and structured outputs because the platform doesn't.
- **Build our own thin wrapper + optional external observability**
  (chosen): Right balance of control and avoiding NIH.

## Consequences

### Easier
- "What prompt produced this hallucinated answer?" → query `LlmCall` by
  user, get the version, reproduce locally.
- Regression tests for prompts are first-class.
- Cost tracking + per-customer cost attribution → admin Customer Health
  dashboard can show actual AI cost per practice.

### Harder
- Adding a new AI feature requires: write the prompt, write the Zod
  schema, write at least one eval, register in the prompt registry.
  Friction is intentional — v1's free-for-all is what we're moving
  away from.

### Revisit
- After 50 customers: re-evaluate whether to bring eval datasets out of
  the codebase into a separate eval store.
- If prompt count exceeds ~30: consider a YAML/JSON registry generated
  into the constants at build time rather than hand-edited TypeScript.

## Action items

- [ ] `src/lib/ai/registry.ts` — exported prompt constants + version map
- [ ] `src/lib/ai/call.ts` — `aiCall<TOutputSchema>(promptId, input)` wrapper
- [ ] `src/lib/ai/redact.ts` — `redactPHI(text)` heuristic + tests
- [ ] `prisma/schema.prisma` — `LlmCall` model
- [ ] `scripts/run-evals.ts` — runs all `*.eval.ts` files
- [ ] First prompt + eval: regulatory analyzer (port from v1)
