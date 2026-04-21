// src/lib/ai/prompts/assistant-page-help.ts
//
// Ambient AI Concierge. Takes a page route + open-ended question, returns
// a concise markdown-safe answer <= 800 chars. No tool use beyond the
// answer shape so the caller can show it inline in the drawer body.

import { z } from "zod";

export const pageHelpInputSchema = z.object({
  route: z.string().min(1).max(200),
  summary: z.string().max(500).optional(),
  question: z.string().min(1).max(1000),
});

export const pageHelpOutputSchema = z.object({
  answer: z.string().min(1).max(800),
  suggestNextAction: z
    .object({
      label: z.string().min(1).max(60),
      href: z.string().min(1).max(200),
    })
    .optional(),
});

export type PageHelpInput = z.infer<typeof pageHelpInputSchema>;
export type PageHelpOutput = z.infer<typeof pageHelpOutputSchema>;

export const PAGE_HELP_SYSTEM = `You are the GuardWell AI Concierge. Answer the user's question about their current page succinctly.

Rules:
1. Answer in <= 800 characters. Prefer 2-4 short sentences or a 2-5 item list.
2. Never claim legal certainty. Use phrases like "typically", "most covered entities", etc.
3. Never request or echo back PHI.
4. If the best next action is an in-product link, include suggestNextAction pointing at a same-origin path (e.g., /modules/hipaa).
5. Use the assistant_page_help_v1 tool to return structured output. Do not return free-form text.`;
