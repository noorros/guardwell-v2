// src/app/(dashboard)/programs/dea/actions.ts
"use server";

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
  // Client-generated cuid/uuid. Server uses this as the idempotency key
  // so a fast double-click of Submit (which would generate two separate
  // server-side UUIDs) cannot create two rows for the same submission.
  inventoryId: z.string().min(1).max(60),
  asOfDate: z
    .string()
    .datetime()
    .refine((s) => new Date(s).getTime() <= Date.now() + 24 * 60 * 60 * 1000, {
      message: "as-of date cannot be in the future",
    }),
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
  // Server-side role gate: only OWNER + ADMIN can record a regulatory
  // inventory snapshot. The InventoryTab UI hides the form for non-admins,
  // but the action is exposed via "use server" — direct callers must hit
  // the same gate.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  const parsed = InventoryInput.parse(input);

  const payload = {
    inventoryId: parsed.inventoryId,
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
      // Deterministic per submission. Dedupes retried server-action
      // calls AND fast double-clicks (since the client generated the
      // inventoryId once and reuses it on retry).
      idempotencyKey: `dea-inventory-${parsed.inventoryId}`,
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
  return { inventoryId: parsed.inventoryId };
}
