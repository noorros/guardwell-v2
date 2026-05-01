// src/lib/notifications/compose-weekly-digest.ts
//
// Calls Claude (via runLlm) to produce the summary + topAction for a
// user's weekly digest. Returns a structured object the email-rendering
// layer can use. Fails-soft: on Claude error / cost-guard tripped, falls
// back to a plain template summary so the email still gets delivered.

import { runLlm } from "@/lib/ai";
import {
  type NotificationWeeklyDigestInput,
  type NotificationWeeklyDigestOutput,
} from "@/lib/ai/prompts/notificationWeeklyDigest";

export async function composeWeeklyDigest(
  input: NotificationWeeklyDigestInput,
  context: { practiceId: string; actorUserId: string },
): Promise<NotificationWeeklyDigestOutput> {
  try {
    const result = await runLlm("notification.weekly-digest.v1", input, {
      practiceId: context.practiceId,
      actorUserId: context.actorUserId,
      // Notification bodies may include patient identifiers when they
      // surface incident / breach detail. Mark the LlmCall row as
      // PHI-touching so the observability layer stays honest.
      allowPHI: true,
    });
    return result.output;
  } catch {
    // Fail-soft: if Claude is down or cost-guard tripped, fall back to
    // a plain template so the digest email still ships.
    return fallbackTemplate(input);
  }
}

function fallbackTemplate(
  input: NotificationWeeklyDigestInput,
): NotificationWeeklyDigestOutput {
  if (input.notifications.length === 0) {
    return {
      summary: `Your week at ${input.practiceName} was quiet — no new compliance items.`,
      topAction: null,
    };
  }
  const itemsByType = new Map<string, number>();
  for (const n of input.notifications) {
    itemsByType.set(n.type, (itemsByType.get(n.type) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [type, count] of itemsByType.entries()) {
    lines.push(`${count} ${type}`);
  }
  const total = input.notifications.length;
  const summary = `${total} item${total === 1 ? "" : "s"} from this week at ${input.practiceName}: ${lines.join(", ")}.`;
  return { summary, topAction: null };
}
