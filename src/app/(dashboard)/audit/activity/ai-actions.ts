// src/app/(dashboard)/audit/activity/ai-actions.ts
"use server";

import { z } from "zod";
import { getPracticeUser } from "@/lib/rbac";
import { runLlm } from "@/lib/ai";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";
import { activityExplainInputSchema } from "@/lib/ai/prompts/activity-explain";

export type ActivityExplainResult =
  | {
      ok: true;
      explanation: string;
      relatedCitation?: string;
      nextAction?: { label: string; href: string };
    }
  | { ok: false; error: string };

export async function askActivityExplainAction(
  input: z.infer<typeof activityExplainInputSchema>,
): Promise<ActivityExplainResult> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "Unauthorized" };
  try {
    await assertMonthlyCostBudget();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "cost guard" };
  }

  const parsed = activityExplainInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INPUT_SCHEMA" };

  try {
    const res = await runLlm("activity.explain.v1", parsed.data, {
      practiceId: pu.practiceId,
      actorUserId: pu.userId,
    });
    return {
      ok: true,
      explanation: res.output.explanation,
      relatedCitation: res.output.relatedCitation,
      nextAction: res.output.nextAction,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
