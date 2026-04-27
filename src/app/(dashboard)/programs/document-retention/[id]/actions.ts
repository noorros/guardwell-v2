"use server";
// src/app/(dashboard)/programs/document-retention/[id]/actions.ts

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { softDelete } from "@/lib/storage/evidence";

/**
 * Server action for deleting an Evidence row from the DestructionLog
 * detail page. Wraps the softDelete helper; revalidates the detail page
 * cache so the evidence list refreshes after deletion.
 */
export async function deleteEvidenceAction(evidenceId: string): Promise<void> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");

  await softDelete({
    practiceId: pu.practiceId,
    actorUserId: user.id,
    evidenceId,
  });

  revalidatePath("/programs/document-retention/[id]", "page");
}
