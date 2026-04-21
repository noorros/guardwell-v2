// src/components/gw/AiAssistDrawer/actions.ts
"use server";

import { z } from "zod";
import { getPracticeUser } from "@/lib/rbac";
import { runLlm } from "@/lib/ai";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";

const Input = z.object({
  route: z.string().min(1).max(200),
  summary: z.string().max(500).optional(),
  question: z.string().min(1).max(1000),
});

export type AskAiResult =
  | { ok: true; answer: string; suggestNextAction?: { label: string; href: string } }
  | { ok: false; error: string };

export async function askAiAssistantAction(input: z.infer<typeof Input>): Promise<AskAiResult> {
  const pu = await getPracticeUser();
  if (!pu) return { ok: false, error: "Unauthorized" };
  try {
    await assertMonthlyCostBudget();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "cost guard" };
  }

  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INPUT_SCHEMA" };

  try {
    const res = await runLlm("assistant.page-help.v1", parsed.data, {
      practiceId: pu.practiceId,
      actorUserId: pu.userId,
    });
    return {
      ok: true,
      answer: res.output.answer,
      suggestNextAction: res.output.suggestNextAction,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
