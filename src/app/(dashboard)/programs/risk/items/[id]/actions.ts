// src/app/(dashboard)/programs/risk/items/[id]/actions.ts
//
// Phase 5 PR 5 — server actions for the RiskItem detail page. Status
// changes and notes saves both delegate to the IDOR-safe lib helper at
// src/lib/risk/riskMutations.ts. Server-action layer handles auth +
// validation + revalidatePath.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/rbac";
import { requireUser } from "@/lib/auth";
import { updateRiskItem } from "@/lib/risk/riskMutations";

const StatusInput = z.object({
  riskItemId: z.string().min(1),
  status: z.enum(["OPEN", "MITIGATED", "ACCEPTED", "TRANSFERRED"]),
});

const NotesInput = z.object({
  riskItemId: z.string().min(1),
  notes: z.string().max(5000).nullable(),
});

export async function updateRiskItemStatusAction(
  input: z.infer<typeof StatusInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    const pu = await requireRole("ADMIN");
    const parsed = StatusInput.parse(input);
    await updateRiskItem(
      parsed.riskItemId,
      pu.practiceId,
      { status: parsed.status },
      user.id,
    );
    revalidatePath("/programs/risk");
    revalidatePath(`/programs/risk/items/${parsed.riskItemId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export async function updateRiskItemNotesAction(
  input: z.infer<typeof NotesInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    const pu = await requireRole("ADMIN");
    const parsed = NotesInput.parse(input);
    await updateRiskItem(
      parsed.riskItemId,
      pu.practiceId,
      { notes: parsed.notes },
      user.id,
    );
    revalidatePath("/programs/risk");
    revalidatePath(`/programs/risk/items/${parsed.riskItemId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
