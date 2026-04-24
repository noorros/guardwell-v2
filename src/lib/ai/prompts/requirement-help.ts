// src/lib/ai/prompts/requirement-help.ts
//
// Inline AI suggestion for a single compliance requirement. Takes the
// requirement code + title + framework + current status, returns a
// 2-4 sentence answer + an optional first-step link the user can click
// to take action. Tighter scope than the page-help prompt — never
// answers questions outside the requirement at hand.

import { z } from "zod";

export const requirementHelpInputSchema = z.object({
  frameworkCode: z.string().min(1).max(40),
  requirementCode: z.string().min(1).max(80),
  requirementTitle: z.string().min(1).max(200),
  requirementDescription: z.string().max(2000).optional(),
  currentStatus: z
    .enum(["NOT_STARTED", "IN_PROGRESS", "COMPLIANT", "GAP", "NOT_APPLICABLE"])
    .optional(),
  practiceState: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
  specialty: z
    .enum([
      "PRIMARY_CARE",
      "SPECIALTY",
      "DENTAL",
      "BEHAVIORAL",
      "ALLIED",
      "OTHER",
    ])
    .nullable()
    .optional(),
});

export const requirementHelpOutputSchema = z.object({
  answer: z.string().min(1).max(800),
  firstStep: z
    .object({
      label: z.string().min(1).max(60),
      href: z.string().min(1).max(200),
    })
    .optional(),
});

export type RequirementHelpInput = z.infer<typeof requirementHelpInputSchema>;
export type RequirementHelpOutput = z.infer<typeof requirementHelpOutputSchema>;

export const REQUIREMENT_HELP_SYSTEM = `You are the GuardWell AI Concierge helping a small healthcare practice work through ONE specific compliance requirement.

Rules:
1. Answer in <= 800 characters. Prefer 2-4 short sentences. The user wants the most likely first step, not an exhaustive walkthrough.
2. Only address the requirement at hand. If the user has another question, suggest opening the full Concierge.
3. Never claim legal certainty. Use phrases like "typically", "most covered entities", etc.
4. Tailor to the practice's state + specialty when set.
5. If a single in-product action is the obvious first step, include firstStep with a same-origin path:
   - Designate-officer requirements → /programs/staff
   - Policy-adoption requirements → /programs/policies
   - Training requirements → /programs/training
   - SRA → /programs/risk
   - Vendors / BAA → /programs/vendors
   - Credentials → /programs/credentials
   - Incidents → /programs/incidents
   - Document retention → /programs/document-retention
   - Security assets → /programs/security-assets
6. Use the requirement_help_v1 tool to return structured output. Do not return free-form text.`;
