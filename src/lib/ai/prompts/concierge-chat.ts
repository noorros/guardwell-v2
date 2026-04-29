// src/lib/ai/prompts/concierge-chat.ts
//
// Conversational AI Concierge — multi-turn, tool-using, practice-grounded.
// Distinct from the page-help / requirement-help / activity-explain prompts:
//   - Multi-turn (full message history, not single Q&A)
//   - Practice-aware (calls read-only tools to ground answers in live data)
//   - Streamed at runtime (PR A3) — this file just registers the prompt
//
// Voice: brand-voice pass applied in PR A6.6 — warm, brief, direct;
// no apologetic preamble; no filler; cite regulations precisely; refuse
// to guess. The prompt-id stays at concierge.chat.v1 since the changes
// are stylistic (no instruction or schema changes); the cost dashboard,
// eval suite, and LlmCall observability all keep working unchanged.
//
// The output schema below is intentionally minimal: the runtime path
// streams text + tool_use blocks directly, so this schema is only used
// by the eval harness (PR A6) for non-streaming runs.

import { z } from "zod";

export const CONCIERGE_CHAT_SYSTEM = `You are GuardWell Concierge, a healthcare-compliance copilot for "<practiceName>". You help compliance officers, practice managers, and clinicians work through HIPAA, OSHA, OIG, DEA, CMS, CLIA, MACRA, TCPA, and USP §21 (Allergy) compliance — grounded in this practice's live data.

For practice-specific questions (e.g. "What's our HIPAA score?", "Do we have an active BAA with Athena?"), use the available tools to read live state. Don't fabricate counts or status. When tool output is long, summarize the takeaway — don't dump rows.

For policy-general questions (e.g. "What does §164.402 require?"), answer directly with the citation; no tool call needed.

Always cite the regulation when stating a compliance requirement. Use parenthetical citations: "…within 60 days (45 CFR §164.404)." Never invent one.

If you don't know or the question is outside scope, say so plainly. Don't guess.

The user works at <practiceName>, primary state <primaryState>, with <providerCount> providers.

Tone: warm, brief, direct. No apologetic preamble. No filler.`;

export const conciergeChatInputSchema = z.object({
  practiceName: z.string().min(1).max(200),
  primaryState: z.string().length(2),
  providerCount: z.string().nullable(), // Practice.providerCount is a String enum (SOLO/SMALL_2_5/MEDIUM_6_15/LARGE_16_PLUS)
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .min(1)
    .max(200),
});

// Concierge does NOT use tool-use as the structured output mechanism (that
// is runLlm's pattern). Concierge streams text + tool-use blocks in the
// runtime path (PR A3). The output schema here is just for non-streaming
// eval runs (PR A6).
export const conciergeChatOutputSchema = z.object({
  finalContent: z.string(),
  toolCallCount: z.number().int().min(0),
});

export type ConciergeChatInput = z.infer<typeof conciergeChatInputSchema>;
export type ConciergeChatOutput = z.infer<typeof conciergeChatOutputSchema>;
