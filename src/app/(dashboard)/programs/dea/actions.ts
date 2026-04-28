// src/app/(dashboard)/programs/dea/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectDeaInventoryRecorded,
  projectDeaOrderReceived,
  projectDeaDisposalCompleted,
  projectDeaTheftLossReported,
} from "@/lib/events/projections/dea";

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

// ── Orders ────────────────────────────────────────────────────────────────────

const OrderInput = z.object({
  // Client-generated cuid/uuid. Server uses this as the idempotency key
  // so a fast double-click of Submit cannot create two rows for the
  // same submission. Same pattern as recordInventoryAction.
  orderRecordId: z.string().min(1).max(60),
  // Optional batch grouping. Phase C ships single-drug per submission;
  // this field exists so future multi-drug Form 222 PDF generation can
  // pull every line item sharing one orderBatchId without a schema
  // migration.
  orderBatchId: z.string().min(1).max(60).nullable().optional(),
  supplierName: z.string().min(1).max(200),
  supplierDeaNumber: z.string().max(50).nullable().optional(),
  orderedAt: z
    .string()
    .datetime()
    .refine((s) => new Date(s).getTime() <= Date.now() + 24 * 60 * 60 * 1000, {
      message: "ordered date cannot be in the future",
    }),
  receivedAt: z.string().datetime().nullable().optional(),
  form222Number: z.string().max(50).nullable().optional(),
  drugName: z.string().min(1).max(200),
  ndc: z.string().max(50).nullable().optional(),
  schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
  strength: z.string().max(100).nullable().optional(),
  quantity: z.number().int().min(1),
  unit: z.string().min(1).max(50),
  notes: z.string().max(2000).nullable().optional(),
});

export async function recordOrderAction(
  input: z.infer<typeof OrderInput>,
): Promise<{ orderRecordId: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  // Server-side role gate: only OWNER + ADMIN can record a Form 222
  // receipt. UI hides the form for non-admins, but "use server" actions
  // are also reachable by direct callers.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  const parsed = OrderInput.parse(input);

  const payload = {
    orderRecordId: parsed.orderRecordId,
    orderBatchId: parsed.orderBatchId ?? null,
    orderedByUserId: user.id,
    supplierName: parsed.supplierName,
    supplierDeaNumber: parsed.supplierDeaNumber ?? null,
    orderedAt: parsed.orderedAt,
    receivedAt: parsed.receivedAt ?? null,
    form222Number: parsed.form222Number ?? null,
    drugName: parsed.drugName,
    ndc: parsed.ndc ?? null,
    schedule: parsed.schedule,
    strength: parsed.strength ?? null,
    quantity: parsed.quantity,
    unit: parsed.unit,
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "DEA_ORDER_RECEIVED",
      payload,
      idempotencyKey: `dea-order-${parsed.orderRecordId}`,
    },
    async (tx) =>
      projectDeaOrderReceived(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/dea");
  revalidatePath("/dashboard");
  revalidatePath("/modules/dea");
  return { orderRecordId: parsed.orderRecordId };
}

// ── Disposals ─────────────────────────────────────────────────────────────────

const DisposalInput = z.object({
  // Client-generated cuid/uuid for idempotency. Same pattern as the
  // other DEA actions.
  disposalRecordId: z.string().min(1).max(60),
  // Optional grouping for multi-drug pickups; Phase C ships single-drug.
  disposalBatchId: z.string().min(1).max(60).nullable().optional(),
  // Free-text witness label (matches Phase B inventory pattern). The
  // PDF renderer falls back to the raw value if no User row matches.
  witnessUserId: z.string().min(1).nullable().optional(),
  reverseDistributorName: z.string().min(1).max(200),
  reverseDistributorDeaNumber: z.string().max(50).nullable().optional(),
  disposalDate: z
    .string()
    .datetime()
    .refine((s) => new Date(s).getTime() <= Date.now() + 24 * 60 * 60 * 1000, {
      message: "disposal date cannot be in the future",
    }),
  disposalMethod: z.enum([
    "REVERSE_DISTRIBUTOR",
    "DEA_TAKE_BACK",
    "DEA_DESTRUCTION",
    "OTHER",
  ]),
  drugName: z.string().min(1).max(200),
  ndc: z.string().max(50).nullable().optional(),
  schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
  strength: z.string().max(100).nullable().optional(),
  quantity: z.number().int().min(1),
  unit: z.string().min(1).max(50),
  form41Filed: z.boolean(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function recordDisposalAction(
  input: z.infer<typeof DisposalInput>,
): Promise<{ disposalRecordId: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  // Server-side role gate: only OWNER + ADMIN can record a disposal /
  // Form 41 surrender. UI hides the form for non-admins, but the action
  // is still reachable by direct callers.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  const parsed = DisposalInput.parse(input);

  const payload = {
    disposalRecordId: parsed.disposalRecordId,
    disposalBatchId: parsed.disposalBatchId ?? null,
    disposedByUserId: user.id,
    witnessUserId: parsed.witnessUserId ?? null,
    reverseDistributorName: parsed.reverseDistributorName,
    reverseDistributorDeaNumber: parsed.reverseDistributorDeaNumber ?? null,
    disposalDate: parsed.disposalDate,
    disposalMethod: parsed.disposalMethod,
    drugName: parsed.drugName,
    ndc: parsed.ndc ?? null,
    schedule: parsed.schedule,
    strength: parsed.strength ?? null,
    quantity: parsed.quantity,
    unit: parsed.unit,
    form41Filed: parsed.form41Filed,
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "DEA_DISPOSAL_COMPLETED",
      payload,
      idempotencyKey: `dea-disposal-${parsed.disposalRecordId}`,
    },
    async (tx) =>
      projectDeaDisposalCompleted(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/dea");
  revalidatePath("/dashboard");
  revalidatePath("/modules/dea");
  return { disposalRecordId: parsed.disposalRecordId };
}

// ── Theft & Loss ──────────────────────────────────────────────────────────────

const TheftLossInput = z.object({
  // Client-generated cuid/uuid for idempotency. Same pattern as the
  // other DEA actions.
  reportId: z.string().min(1).max(60),
  // Optional grouping for multi-drug theft/loss events; Phase D ships
  // single-drug per submission.
  reportBatchId: z.string().min(1).max(60).nullable().optional(),
  // Optional link to a broader Incident if the practice already opened
  // one. Phase D's NewTheftLossForm doesn't expose this — a future
  // enhancement can wire it from the Incident detail page (Generate
  // Form 106 CTA).
  incidentId: z.string().min(1).max(60).nullable().optional(),
  discoveredAt: z
    .string()
    .datetime()
    .refine((s) => new Date(s).getTime() <= Date.now() + 24 * 60 * 60 * 1000, {
      message: "discovery date cannot be in the future",
    }),
  lossType: z.enum([
    "THEFT",
    "LOSS",
    "IN_TRANSIT_LOSS",
    "DESTRUCTION_DURING_THEFT",
  ]),
  drugName: z.string().min(1).max(200),
  ndc: z.string().max(50).nullable().optional(),
  schedule: z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]),
  strength: z.string().max(100).nullable().optional(),
  quantityLost: z.number().int().min(1),
  unit: z.string().min(1).max(50),
  methodOfDiscovery: z.string().max(2000).nullable().optional(),
  lawEnforcementNotified: z.boolean(),
  lawEnforcementAgency: z.string().max(200).nullable().optional(),
  lawEnforcementCaseNumber: z.string().max(100).nullable().optional(),
  deaNotifiedAt: z.string().datetime().nullable().optional(),
  form106SubmittedAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function recordTheftLossAction(
  input: z.infer<typeof TheftLossInput>,
): Promise<{ reportId: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  // Server-side role gate: only OWNER + ADMIN can file a Form 106
  // theft/loss report. UI hides the form for non-admins, but the action
  // is still reachable by direct callers.
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  const parsed = TheftLossInput.parse(input);

  const payload = {
    reportId: parsed.reportId,
    reportBatchId: parsed.reportBatchId ?? null,
    incidentId: parsed.incidentId ?? null,
    reportedByUserId: user.id,
    discoveredAt: parsed.discoveredAt,
    lossType: parsed.lossType,
    drugName: parsed.drugName,
    ndc: parsed.ndc ?? null,
    schedule: parsed.schedule,
    strength: parsed.strength ?? null,
    quantityLost: parsed.quantityLost,
    unit: parsed.unit,
    methodOfDiscovery: parsed.methodOfDiscovery ?? null,
    lawEnforcementNotified: parsed.lawEnforcementNotified,
    lawEnforcementAgency: parsed.lawEnforcementAgency ?? null,
    lawEnforcementCaseNumber: parsed.lawEnforcementCaseNumber ?? null,
    deaNotifiedAt: parsed.deaNotifiedAt ?? null,
    form106SubmittedAt: parsed.form106SubmittedAt ?? null,
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "DEA_THEFT_LOSS_REPORTED",
      payload,
      idempotencyKey: `dea-theft-loss-${parsed.reportId}`,
    },
    async (tx) =>
      projectDeaTheftLossReported(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/dea");
  revalidatePath("/dashboard");
  revalidatePath("/modules/dea");
  return { reportId: parsed.reportId };
}
