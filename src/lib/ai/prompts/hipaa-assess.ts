// src/lib/ai/prompts/hipaa-assess.ts
//
// Stubbed in Chunk A so the registry imports resolve. Real prompt body,
// system message, and output schema get written in Task D1.

import { z } from "zod";

export const hipaaAssessInputSchema = z.object({
  practiceName: z.string().min(1),
  primaryState: z.string().length(2),
  specialty: z.string().optional(),
  staffHeadcount: z.number().int().nonnegative().optional(),
  requirementCodes: z.array(z.string().min(1)).min(1),
});

export const hipaaAssessOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      requirementCode: z.string().min(1),
      likelyStatus: z.enum(["COMPLIANT", "GAP", "NOT_STARTED"]),
      reason: z.string().min(1).max(500),
    }),
  ),
});

export type HipaaAssessInput = z.infer<typeof hipaaAssessInputSchema>;
export type HipaaAssessOutput = z.infer<typeof hipaaAssessOutputSchema>;

export const HIPAA_ASSESS_SYSTEM =
  "You are a HIPAA compliance analyst. Your role is filled in during Task D1.";
