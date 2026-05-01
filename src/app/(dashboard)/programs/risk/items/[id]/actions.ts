// src/app/(dashboard)/programs/risk/items/[id]/actions.ts
//
// Phase 5 PR 5 — server actions for the RiskItem detail page. Status
// changes and notes saves both delegate to the IDOR-safe lib helper at
// src/lib/risk/riskMutations.ts. Server-action layer handles auth +
// validation + revalidatePath.
//
// Phase 5 PR 6 — adds createCapForRiskAction so the "Create CAP" inline
// form on this page delegates to src/lib/risk/capMutations.ts (the same
// IDOR-safe helper used by the regulatory alert→CAP flow).

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/rbac";
import { requireUser } from "@/lib/auth";
import { updateRiskItem } from "@/lib/risk/riskMutations";
import { createCap } from "@/lib/risk/capMutations";

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

const CreateCapInput = z.object({
  riskItemId: z.string().min(1),
  description: z.string().min(1).max(5000),
  // YYYY-MM-DD from <input type="date">. Optional + nullable.
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .nullable()
    .optional(),
});

export async function createCapForRiskAction(
  input: z.infer<typeof CreateCapInput>,
): Promise<
  { ok: true; capId: string } | { ok: false; error: string }
> {
  try {
    const pu = await requireRole("ADMIN");
    const parsed = CreateCapInput.parse(input);
    // Phase 8 PR 6 precedent: anchor YYYY-MM-DD inputs at noon UTC so
    // they round-trip as the same calendar day across all U.S.
    // timezones (UTC-12 to UTC-4). v2 user base is U.S.-only at launch.
    const dueDate = parsed.dueDate
      ? new Date(`${parsed.dueDate}T12:00:00.000Z`)
      : null;
    const result = await createCap(pu.practiceId, {
      riskItemId: parsed.riskItemId,
      description: parsed.description,
      dueDate,
    });
    revalidatePath(`/programs/risk/items/${parsed.riskItemId}`);
    revalidatePath("/programs/risk");
    return { ok: true, capId: result.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
