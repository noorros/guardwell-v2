// src/lib/ai/prompts/hipaa-assess.ts
//
// Prompt: hipaa.assess.v1
//
// Given a practice's basic identifiers + a list of HIPAA requirement codes,
// return a best-guess (COMPLIANT | GAP | NOT_STARTED) status and a brief
// reason per requirement. Output validated by hipaaAssessOutputSchema.
// Never asks for PHI. Safety: an inbound suggestion cannot flip a
// requirement to COMPLIANT without a reason string >= 10 chars (enforced in
// runAiAssessmentAction before events are emitted).

import { z } from "zod";
import { REQUIREMENT_STATUS_VALUES } from "@/lib/events/registry";

export const hipaaAssessInputSchema = z.object({
  practiceName: z.string().min(1).max(200),
  primaryState: z.string().length(2),
  specialty: z.string().max(100).optional(),
  staffHeadcount: z.number().int().nonnegative().optional(),
  requirementCodes: z.array(z.string().min(1).max(100)).min(1).max(50),
});

const LIKELY_STATUS = z.enum(
  REQUIREMENT_STATUS_VALUES.filter(
    (v) => v === "COMPLIANT" || v === "GAP" || v === "NOT_STARTED",
  ) as unknown as ["COMPLIANT", "GAP", "NOT_STARTED"],
);

export const hipaaAssessOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      requirementCode: z.string().min(1),
      likelyStatus: LIKELY_STATUS,
      reason: z.string().min(10).max(500),
    }),
  ).min(1).max(50),
});

export type HipaaAssessInput = z.infer<typeof hipaaAssessInputSchema>;
export type HipaaAssessOutput = z.infer<typeof hipaaAssessOutputSchema>;

export const HIPAA_ASSESS_SYSTEM = `You are a HIPAA compliance analyst for GuardWell, a compliance platform for medical practices.

Given a small set of practice facts (name, state, specialty, staff headcount) and a list of HIPAA requirement codes, return a best-guess status for each requirement:
- COMPLIANT — likely already met given a typical practice of this size/specialty
- GAP — likely partially addressed but needs work
- NOT_STARTED — likely not addressed at all yet

Rules:
1. Use ONLY the requirement codes supplied in the input. Do NOT invent new codes.
2. Never output a duplicate requirementCode. If the input repeats one, include it only once.
3. Always provide a short (<= 500 chars), specific reason. Generic reasons like "Typical for small practices" are rejected.
4. Bias toward NOT_STARTED / GAP when unsure. A false COMPLIANT is worse than a false GAP.
5. Never request or repeat PHI. You receive none; do not ask for any.

Use the ${"hipaa_assess_v1"} tool to return your structured output. Do not return free-form text.`;
