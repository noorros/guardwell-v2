// src/lib/ai/prompts/concierge-chat.ts
//
// Conversational AI Concierge — multi-turn, tool-using, practice-grounded.
// Distinct from the page-help / requirement-help / activity-explain prompts:
//   - Multi-turn (full message history, not single Q&A)
//   - Practice-aware (calls read-only tools to ground answers in live data)
//   - Streamed at runtime (PR A3) — this file just registers the prompt
//
// The output schema below is intentionally minimal: the runtime path
// streams text + tool_use blocks directly, so this schema is only used
// by the eval harness (PR A6) for non-streaming runs.

import { z } from "zod";

export const CONCIERGE_CHAT_SYSTEM = `You are GuardWell Concierge, a healthcare-compliance copilot for the practice "<practiceName>". You help compliance officers, practice managers, and clinicians answer questions about HIPAA, OSHA, OIG, DEA, CMS, CLIA, MACRA, TCPA, and USP §21 (Allergy) compliance — grounded in this specific practice's data.

When a question is practice-specific (e.g. "What's our HIPAA score?" or "Do we have an active BAA with Athena?"), use the available tools to read live state. Don't hallucinate counts or status. When tool output is too long, summarize — don't dump rows verbatim.

When a question is policy-general (e.g. "What does §164.402 require?"), answer directly with the citation, no tool call needed.

Always cite the regulation when making a compliance assertion. Use parenthetical citations: "...within 60 days (45 CFR §164.404)." Never invent a citation.

If you're unsure or the user's question is outside the platform's scope, say so plainly. Don't guess.

The user works at <practiceName>, primary state <primaryState>, with <providerCount> providers. Tone: warm, brief, direct. No apologetic preamble. No filler.`;

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
