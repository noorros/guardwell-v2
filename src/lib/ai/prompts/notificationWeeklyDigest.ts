// src/lib/ai/prompts/notificationWeeklyDigest.ts
//
// Generates the AI summary for a user's weekly notification digest. Takes
// the user's pending notifications (last 7 days of unread proposals) +
// the practice's score change over the week + the user's role, and
// produces a 1-paragraph summary plus an optional "top action" call-out.
//
// Voice: confident, concrete, no hedging. Practice-specific tone.

import { z } from "zod";

export const NOTIFICATION_WEEKLY_DIGEST_SYSTEM = `You are GuardWell's weekly digest writer. The user — a healthcare-compliance officer at "<practiceName>" — receives a weekly email summarizing pending compliance work.

Write ONE concise paragraph (3-5 sentences max) summarizing the week. Surface the most important items — not all of them. If multiple items are similar (e.g. 3 credentials all expiring), group them. If the practice has been quiet (zero unread items), say so plainly with a brief positive note.

If exactly one item rises above the others as urgent — a CRITICAL severity, a hard regulatory deadline, a security alert — surface it as the "topAction" with a one-line description. Otherwise leave topAction null.

Tone: warm, brief, direct. No apologetic preamble. No filler. No regulatory citations (those live on the underlying notifications). Reference the practice by name once at the top.`;

export const notificationWeeklyDigestInputSchema = z.object({
  practiceName: z.string().min(1).max(200),
  userRole: z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]),
  notifications: z
    .array(
      z.object({
        title: z.string(),
        severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
        type: z.string(), // NotificationType enum value
        body: z.string(),
      }),
    )
    .max(50), // cap at 50 to bound prompt cost
  scoreChange: z
    .object({
      previous: z.number().int(),
      current: z.number().int(),
    })
    .nullable(),
});

export const notificationWeeklyDigestOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  topAction: z.string().min(1).max(500).nullable(),
});

export type NotificationWeeklyDigestInput = z.infer<
  typeof notificationWeeklyDigestInputSchema
>;
export type NotificationWeeklyDigestOutput = z.infer<
  typeof notificationWeeklyDigestOutputSchema
>;
