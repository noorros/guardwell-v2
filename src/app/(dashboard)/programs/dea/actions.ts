// src/app/(dashboard)/programs/dea/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectDeaInventoryRecorded } from "@/lib/events/projections/dea";

const ItemSchema = z.object({
  drugName: z.string().min(1).max(200),
  ndc: z.string().max(50).nullable().optional(),
  schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
  strength: z.string().max(100).nullable().optional(),
  quantity: z.number().int().min(0),
  unit: z.string().min(1).max(50),
});

const InventoryInput = z.object({
  asOfDate: z.string().datetime(),
  // Phase B accepts a free-text witness label rather than a user picker;
  // wired through to the witnessUserId scalar so future phases can
  // upgrade to a real user-id ref without a schema change.
  witnessUserId: z.string().min(1).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(ItemSchema).min(1),
});

export async function recordInventoryAction(
  input: z.infer<typeof InventoryInput>,
): Promise<{ inventoryId: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = InventoryInput.parse(input);

  const inventoryId = randomUUID();
  const payload = {
    inventoryId,
    asOfDate: parsed.asOfDate,
    conductedByUserId: user.id,
    witnessUserId: parsed.witnessUserId ?? null,
    notes: parsed.notes ?? null,
    items: parsed.items.map((it) => ({
      drugName: it.drugName,
      ndc: it.ndc ?? null,
      schedule: it.schedule,
      strength: it.strength ?? null,
      quantity: it.quantity,
      unit: it.unit,
    })),
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "DEA_INVENTORY_RECORDED",
      payload,
      // Deterministic per submission: dedupes retried server-action
      // calls so the projection's deaInventory.create() never sees a
      // duplicate ID and 500s on conflict (per Phase A code-review note).
      idempotencyKey: `dea-inventory-${inventoryId}`,
    },
    async (tx) =>
      projectDeaInventoryRecorded(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/dea");
  revalidatePath("/dashboard");
  revalidatePath("/modules/dea");
  return { inventoryId };
}
