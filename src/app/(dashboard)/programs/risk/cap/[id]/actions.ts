// src/app/(dashboard)/programs/risk/cap/[id]/actions.ts
//
// Phase 5 PR 6 — server actions for the CAP detail page. Status changes
// and notes saves both delegate to the IDOR-safe lib helpers at
// src/lib/risk/capMutations.ts. Server-action layer handles auth +
// validation + revalidatePath; the lib helpers handle the DB write.

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/rbac";
import { requireUser } from "@/lib/auth";
import { updateCapStatus, updateCapDetails } from "@/lib/risk/capMutations";

const StatusInput = z.object({
  capId: z.string().min(1),
  newStatus: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]),
});

const NotesInput = z.object({
  capId: z.string().min(1),
  notes: z.string().max(5000),
});

export async function updateCapStatusAction(
  input: z.infer<typeof StatusInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    const pu = await requireRole("ADMIN");
    const parsed = StatusInput.parse(input);
    await updateCapStatus(
      parsed.capId,
      pu.practiceId,
      parsed.newStatus,
      user.id,
    );
    revalidatePath(`/programs/risk/cap/${parsed.capId}`);
    revalidatePath("/programs/risk");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export async function updateCapNotesAction(
  input: z.infer<typeof NotesInput>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pu = await requireRole("ADMIN");
    const parsed = NotesInput.parse(input);
    await updateCapDetails(parsed.capId, pu.practiceId, {
      notes: parsed.notes,
    });
    revalidatePath(`/programs/risk/cap/${parsed.capId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
