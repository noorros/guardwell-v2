// src/app/(dashboard)/modules/[code]/ai-actions.ts
"use server";

import { z } from "zod";
import { getPracticeUser } from "@/lib/rbac";
import { runLlm } from "@/lib/ai";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";
import { requirementHelpInputSchema } from "@/lib/ai/prompts/requirement-help";

export type RequirementHelpResult =
  | {
      ok: true;
      answer: string;
      firstStep?: { label: string; href: string };
    }
  | { ok: false; error: string };

export async function askRequirementHelpAction(
  input: z.infer<typeof requirementHelpInputSchema>,
): Promise<RequirementHelpResult> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "Unauthorized" };
  try {
    await assertMonthlyCostBudget();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "cost guard" };
  }

  const parsed = requirementHelpInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INPUT_SCHEMA" };

  try {
    const res = await runLlm("requirement.help.v1", parsed.data, {
      practiceId: pu.practiceId,
      actorUserId: pu.userId,
    });
    return {
      ok: true,
      answer: res.output.answer,
      firstStep: res.output.firstStep,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
