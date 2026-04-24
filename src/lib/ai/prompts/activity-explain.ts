// src/lib/ai/prompts/activity-explain.ts
//
// Inline AI explanation for a single activity-log event. Takes the
// event type + a serialized payload preview + the human-readable
// summary the activity feed already shows, returns a 2-3 sentence
// "what just happened + why it matters for compliance" explanation
// targeted at non-technical practice owners.
//
// Use case: practice owner sees POLICY_REVIEWED in the activity log
// and clicks "Explain this." AI says: "Your Privacy Officer just
// attested they reviewed the Privacy Policy. HIPAA §164.530(i)(2)
// expects this annually — the next review is now due in 12 months.
// This counts toward your HIPAA_POLICIES_REVIEW_CURRENT requirement."

import { z } from "zod";

export const activityExplainInputSchema = z.object({
  eventType: z.string().min(1).max(80),
  // The same headline string the activity-log row shows. Helps anchor
  // the AI to the same phrasing the user already saw.
  summary: z.string().min(1).max(500),
  // Subset of the EventLog payload, JSON-stringified. Keep small
  // (the prompt has a token budget) — typically the most-relevant
  // 2-4 fields.
  payloadPreview: z.string().max(2000).optional(),
  // When known, the human's first name — improves "your X" phrasing.
  actorFirstName: z.string().max(60).optional(),
  practiceState: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
});

export const activityExplainOutputSchema = z.object({
  // 2-3 sentence plain-English explanation. Reads like a colleague,
  // not a legal disclaimer.
  explanation: z.string().min(1).max(700),
  // Optional related-citation badge — e.g., "HIPAA §164.530(i)(2)" —
  // when the event ties to a specific regulation.
  relatedCitation: z.string().max(120).optional(),
  // Optional next-action link if the event suggests a follow-up
  // (e.g. "Set the next review reminder").
  nextAction: z
    .object({
      label: z.string().min(1).max(60),
      href: z.string().min(1).max(200),
    })
    .optional(),
});

export type ActivityExplainInput = z.infer<typeof activityExplainInputSchema>;
export type ActivityExplainOutput = z.infer<typeof activityExplainOutputSchema>;

export const ACTIVITY_EXPLAIN_SYSTEM = `You are the GuardWell AI Concierge helping a small healthcare practice owner understand a single entry in their compliance activity log.

Rules:
1. Answer in <= 700 characters. Prefer 2-3 short sentences. The owner is busy; they want to know "what just happened + why it matters" not a textbook explanation.
2. Lead with the action that just happened, in plain English. Avoid jargon when a normal word will do.
3. Anchor to a specific regulation IF the event clearly ties to one. Examples:
   - POLICY_REVIEWED → HIPAA §164.530(i)(2) (annual policy review)
   - TRAINING_COMPLETED with HIPAA course → HIPAA §164.530(b)(1)
   - INCIDENT_BREACH_DETERMINED → HIPAA §164.402 (breach risk assessment)
   - INCIDENT_NOTIFIED_HHS → HIPAA §164.408 (HHS notice)
   - SRA_COMPLETED → HIPAA §164.308(a)(1)(ii)(A)
   - PHISHING_DRILL_LOGGED → HIPAA §164.308(a)(5)(ii)(B)
   - MFA_ENROLLMENT_RECORDED → HIPAA §164.308(a)(5)(ii)(D)
   - BACKUP_VERIFICATION_LOGGED → HIPAA §164.308(a)(7) (contingency)
   - DESTRUCTION_LOGGED → HIPAA §164.530(j) (record retention)
   - TECH_ASSET_UPSERTED → HIPAA §164.310/.312
   - VENDOR_BAA_EXECUTED → HIPAA §164.308(b)(1)
   - AUDIT_PREP_PACKET_GENERATED → no specific citation; explain it's the audit-ready packet
4. Never claim legal certainty. Use "typically", "most covered entities", "expected".
5. Tailor to the practice's state when relevant (state breach laws, state retention rules).
6. Suggest a nextAction same-origin path ONLY when there's an obvious follow-up:
   - POLICY_ADOPTED → /programs/policies (set the review reminder)
   - INCIDENT_REPORTED for an unresolved breach → /programs/incidents
   - SRA_DRAFT_SAVED → /programs/risk (finish + complete the SRA)
   - PHISHING_DRILL_LOGGED with click rate > 10% → /programs/training (assign Phishing Recognition)
   - TRAINING_COMPLETED that covers all 4 cyber courses for one user → null (no follow-up)
   Do not invent paths.
7. Use the activity_explain_v1 tool to return structured output.
8. If the event is purely administrative (e.g. PRACTICE_PROFILE_UPDATED) and has no compliance angle, just describe what changed — skip relatedCitation + nextAction.`;
