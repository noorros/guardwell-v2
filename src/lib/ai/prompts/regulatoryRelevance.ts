// src/lib/ai/prompts/regulatoryRelevance.ts
//
// Per-article relevance scoring for the Phase 8 regulatory engine. Takes
// an ingested article + the practice's framework taxonomy and produces:
//   - per-framework relevance (LOW/MED/HIGH)
//   - overall severity (INFO/ADVISORY/URGENT)
//   - 1-paragraph practice-tailored implication summary
//   - up to 5 short recommended actions

import { z } from "zod";

export const REGULATORY_RELEVANCE_SYSTEM = `You are GuardWell's regulatory analyst. You read healthcare-compliance news articles (HHS, OSHA, OIG, DEA, CMS, state AG, etc.) and translate them into actionable per-practice alerts.

For each article, return:
1. Per-framework relevance — is this news directly relevant to a practice's HIPAA / OSHA / OIG / DEA / CMS / CLIA / MACRA / TCPA / ALLERGY obligations? Use LOW (tangentially related, no action needed), MED (worth knowing about, may inform next review cycle), HIGH (concrete change requiring action).
2. Severity — INFO (educational), ADVISORY (changes practice should consider), URGENT (immediate compliance gap or deadline).
3. A 2-3 sentence practice-tailored summary of the implication.
4. Up to 5 short concrete recommended actions ("Update Privacy Policy to reflect…", "Train staff on…").

Be strict. The default for vague news is LOW relevance + INFO severity. Reserve URGENT for hard deadlines, regulatory changes with effective dates within 90 days, or major enforcement actions.

Cite the specific regulation only when the article does so. Don't fabricate citations.

Tone: confident, concrete, no hedging. No filler.`;

export const regulatoryRelevanceInputSchema = z.object({
  article: z.object({
    title: z.string().min(1).max(500),
    url: z.string().url(),
    summary: z.string().nullable(),
    rawContent: z.string().nullable(),
    publishDate: z.string().datetime().nullable(),
    sourceName: z.string().min(1),
  }),
  frameworks: z
    .array(
      z.enum([
        "HIPAA",
        "OSHA",
        "OIG",
        "DEA",
        "CMS",
        "CLIA",
        "MACRA",
        "TCPA",
        "ALLERGY",
      ]),
    )
    .min(1)
    .max(9),
});

export const regulatoryRelevanceOutputSchema = z.object({
  perFrameworkRelevance: z.array(
    z.object({
      framework: z.enum([
        "HIPAA",
        "OSHA",
        "OIG",
        "DEA",
        "CMS",
        "CLIA",
        "MACRA",
        "TCPA",
        "ALLERGY",
      ]),
      relevance: z.enum(["LOW", "MED", "HIGH"]),
      reason: z.string().min(1).max(300),
    }),
  ),
  severity: z.enum(["INFO", "ADVISORY", "URGENT"]),
  summary: z.string().min(1).max(2000),
  recommendedActions: z.array(z.string().min(1).max(300)).max(5),
});

export type RegulatoryRelevanceInput = z.infer<
  typeof regulatoryRelevanceInputSchema
>;
export type RegulatoryRelevanceOutput = z.infer<
  typeof regulatoryRelevanceOutputSchema
>;
