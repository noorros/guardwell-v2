// src/app/(dashboard)/programs/risk/manualAdd.ts
//
// Phase 5 PR 5 — server action to create a manually-entered RiskItem.
// Distinct from the auto-generated rows from SRA/TA submits; these
// surface as `source = "MANUAL"` with a synthetic sourceCode so the
// (practiceId, source, sourceCode, sourceRefId) unique index doesn't
// reject duplicates with the same title.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/rbac";
import { createManualRiskItem } from "@/lib/risk/riskMutations";

const Schema = z.object({
  category: z.string().min(1).max(100),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
});

export async function createManualRiskAction(
  input: z.infer<typeof Schema>,
): Promise<{ ok: true; riskItemId: string } | { ok: false; error: string }> {
  try {
    const pu = await requireRole("ADMIN");
    const parsed = Schema.parse(input);
    const result = await createManualRiskItem(pu.practiceId, parsed);
    revalidatePath("/programs/risk");
    return { ok: true, riskItemId: result.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
