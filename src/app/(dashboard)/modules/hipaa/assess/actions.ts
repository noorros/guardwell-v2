// src/app/(dashboard)/modules/hipaa/assess/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { runLlm } from "@/lib/ai";
import { appendEventAndApply } from "@/lib/events";
import { projectRequirementStatusUpdated } from "@/lib/events/projections/requirementStatus";
import { assertAssessmentRateLimit } from "@/lib/ai/rateLimit";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";

export async function runAiAssessmentAction() {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");

  // Rate + cost guards (Task F1 + F2).
  await assertAssessmentRateLimit(pu.practiceId);
  await assertMonthlyCostBudget();

  const framework = await db.regulatoryFramework.findUnique({
    where: { code: "HIPAA" },
    include: { requirements: { orderBy: { sortOrder: "asc" } } },
  });
  if (!framework) {
    throw new Error("HIPAA framework is not seeded. Run `npm run db:seed`.");
  }
  const requirementsByCode = new Map(
    framework.requirements.map((r) => [r.code, r]),
  );

  const result = await runLlm(
    "hipaa.assess.v1",
    {
      practiceName: pu.practice.name,
      primaryState: pu.practice.primaryState,
      specialty: pu.practice.specialty ?? undefined,
      staffHeadcount: pu.practice.staffHeadcount ?? undefined,
      requirementCodes: framework.requirements.map((r) => r.code),
    },
    { practiceId: pu.practiceId, actorUserId: user.id },
  );

  // Dedup + drop codes the model hallucinated. Never trust the LLM to
  // produce known codes — filter against what we actually have.
  const seen = new Set<string>();
  let applied = 0;

  for (const s of result.output.suggestions) {
    if (seen.has(s.requirementCode)) continue;
    seen.add(s.requirementCode);
    const requirement = requirementsByCode.get(s.requirementCode);
    if (!requirement) continue;

    const existing = await db.complianceItem.findUnique({
      where: {
        practiceId_requirementId: {
          practiceId: pu.practiceId,
          requirementId: requirement.id,
        },
      },
    });
    // Never let AI DOWNGRADE a human-asserted COMPLIANT. If the item is
    // already COMPLIANT and AI says NOT_STARTED, we skip. Upgrading from
    // NOT_STARTED -> COMPLIANT is allowed but logged as AI_ASSESSMENT.
    if (existing?.status === "COMPLIANT" && s.likelyStatus !== "COMPLIANT") {
      continue;
    }

    const previous =
      (existing?.status as
        | "NOT_STARTED"
        | "IN_PROGRESS"
        | "COMPLIANT"
        | "GAP"
        | "NOT_APPLICABLE"
        | undefined) ?? "NOT_STARTED";

    await appendEventAndApply(
      {
        practiceId: pu.practiceId,
        actorUserId: user.id,
        type: "REQUIREMENT_STATUS_UPDATED",
        payload: {
          requirementId: requirement.id,
          frameworkCode: "HIPAA",
          requirementCode: requirement.code,
          previousStatus: previous,
          nextStatus: s.likelyStatus,
          source: "AI_ASSESSMENT",
          reason: s.reason,
        },
      },
      async (tx) =>
        projectRequirementStatusUpdated(tx, {
          practiceId: pu.practiceId,
          payload: {
            requirementId: requirement.id,
            frameworkCode: "HIPAA",
            requirementCode: requirement.code,
            previousStatus: previous,
            nextStatus: s.likelyStatus,
            source: "AI_ASSESSMENT",
            reason: s.reason,
          },
        }),
    );
    applied += 1;
  }

  revalidatePath("/modules/hipaa");
  return { applied, llmCallId: result.llmCallId };
}
