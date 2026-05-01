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
  PAGE_HELP_SYSTEM,
  pageHelpInputSchema,
  pageHelpOutputSchema,
} from "./prompts/assistant-page-help";
import {
  REQUIREMENT_HELP_SYSTEM,
  requirementHelpInputSchema,
  requirementHelpOutputSchema,
} from "./prompts/requirement-help";
import {
  ACTIVITY_EXPLAIN_SYSTEM,
  activityExplainInputSchema,
  activityExplainOutputSchema,
} from "./prompts/activity-explain";
import {
  CONCIERGE_CHAT_SYSTEM,
  conciergeChatInputSchema,
  conciergeChatOutputSchema,
} from "./prompts/concierge-chat";
import {
  NOTIFICATION_WEEKLY_DIGEST_SYSTEM,
  notificationWeeklyDigestInputSchema,
  notificationWeeklyDigestOutputSchema,
} from "./prompts/notificationWeeklyDigest";
import {
  REGULATORY_RELEVANCE_SYSTEM,
  regulatoryRelevanceInputSchema,
  regulatoryRelevanceOutputSchema,
} from "./prompts/regulatoryRelevance";

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


export const PROMPTS = {
  "assistant.page-help.v1": {
    id: "assistant.page-help.v1",
    version: 1,
    model: "claude-sonnet-4-6",
    system: PAGE_HELP_SYSTEM,
    inputSchema: pageHelpInputSchema,
    outputSchema: pageHelpOutputSchema,
    toolName: "assistant_page_help_v1",
    toolDescription:
      "Return a concise markdown-safe answer and optional in-product next-action link.",
    maxTokens: 1024,
  },
  "requirement.help.v1": {
    id: "requirement.help.v1",
    version: 1,
    model: "claude-sonnet-4-6",
    system: REQUIREMENT_HELP_SYSTEM,
    inputSchema: requirementHelpInputSchema,
    outputSchema: requirementHelpOutputSchema,
    toolName: "requirement_help_v1",
    toolDescription:
      "Return a concise next-step answer for one specific compliance requirement.",
    maxTokens: 1024,
  },
  "activity.explain.v1": {
    id: "activity.explain.v1",
    version: 1,
    model: "claude-sonnet-4-6",
    system: ACTIVITY_EXPLAIN_SYSTEM,
    inputSchema: activityExplainInputSchema,
    outputSchema: activityExplainOutputSchema,
    toolName: "activity_explain_v1",
    toolDescription:
      "Explain a single activity-log event in plain English, anchored to the regulation it satisfies.",
    maxTokens: 1024,
  },
  "concierge.chat.v1": {
    id: "concierge.chat.v1",
    version: 1,
    model: "claude-sonnet-4-6",
    system: CONCIERGE_CHAT_SYSTEM,
    inputSchema: conciergeChatInputSchema,
    outputSchema: conciergeChatOutputSchema,
    toolName: "concierge_chat_v1", // unused by streaming runtime but required by the PromptDef type
    toolDescription: "Concierge final-output tool (eval-only path).",
    maxTokens: 4096,
  },
  "notification.weekly-digest.v1": {
    id: "notification.weekly-digest.v1",
    version: 1,
    model: "claude-sonnet-4-6",
    system: NOTIFICATION_WEEKLY_DIGEST_SYSTEM,
    inputSchema: notificationWeeklyDigestInputSchema,
    outputSchema: notificationWeeklyDigestOutputSchema,
    toolName: "notification_weekly_digest_v1",
    toolDescription:
      "Return the weekly notification digest summary paragraph plus an optional top-action call-out.",
    maxTokens: 768,
  },
  "analyzer.regulatory-relevance.v1": {
    id: "analyzer.regulatory-relevance.v1",
    version: 1,
    model: "claude-sonnet-4-6",
    system: REGULATORY_RELEVANCE_SYSTEM,
    inputSchema: regulatoryRelevanceInputSchema,
    outputSchema: regulatoryRelevanceOutputSchema,
    toolName: "analyzer_regulatory_relevance_v1",
    toolDescription:
      "Score a regulatory news article for per-framework relevance, severity, summary, and recommended actions.",
    maxTokens: 1500,
  },
} as const satisfies Record<string, PromptDef>;

export type PromptId = keyof typeof PROMPTS;

export function getPrompt<T extends PromptId>(id: T): (typeof PROMPTS)[T] {
  const p = PROMPTS[id];
  if (!p) throw new Error(`Unknown prompt id: ${id}`);
  return p;
}
