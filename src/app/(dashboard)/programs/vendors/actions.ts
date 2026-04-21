// src/app/(dashboard)/programs/vendors/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectVendorUpserted,
  projectVendorBaaExecuted,
  projectVendorRemoved,
} from "@/lib/events/projections/vendor";
import { db } from "@/lib/db";

const AddInput = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(50).optional().nullable(),
  service: z.string().max(500).optional().nullable(),
  contact: z.string().max(200).optional().nullable(),
  email: z
    .string()
    .email()
    .or(z.literal(""))
    .optional()
    .nullable(),
  notes: z.string().max(2000).optional().nullable(),
  processesPhi: z.boolean(),
});

const BaaInput = z.object({
  vendorId: z.string().min(1),
});

const RemoveInput = z.object({
  vendorId: z.string().min(1),
});

async function verifyVendorInPractice(vendorId: string, practiceId: string) {
  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.practiceId !== practiceId) {
    throw new Error("Unauthorized: vendor not in your practice");
  }
  return vendor;
}

export async function addVendorAction(input: z.infer<typeof AddInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = AddInput.parse(input);
  const vendorId = randomUUID();

  const payload = {
    vendorId,
    name: parsed.name,
    type: parsed.type ?? null,
    service: parsed.service ?? null,
    contact: parsed.contact ?? null,
    email: parsed.email ?? null,
    notes: parsed.notes ?? null,
    processesPhi: parsed.processesPhi,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "VENDOR_UPSERTED",
      payload,
    },
    async (tx) =>
      projectVendorUpserted(tx, { practiceId: pu.practiceId, payload }),
  );

  revalidatePath("/programs/vendors");
  revalidatePath("/modules/hipaa");
}

export async function markBaaExecutedAction(input: z.infer<typeof BaaInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = BaaInput.parse(input);
  await verifyVendorInPractice(parsed.vendorId, pu.practiceId);

  const payload = {
    vendorId: parsed.vendorId,
    executedAt: new Date().toISOString(),
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "VENDOR_BAA_EXECUTED",
      payload,
    },
    async (tx) =>
      projectVendorBaaExecuted(tx, { practiceId: pu.practiceId, payload }),
  );

  revalidatePath("/programs/vendors");
  revalidatePath("/modules/hipaa");
}

export async function removeVendorAction(input: z.infer<typeof RemoveInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = RemoveInput.parse(input);
  const vendor = await verifyVendorInPractice(parsed.vendorId, pu.practiceId);
  if (vendor.retiredAt) return;

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "VENDOR_REMOVED",
      payload: { vendorId: parsed.vendorId },
    },
    async (tx) =>
      projectVendorRemoved(tx, {
        practiceId: pu.practiceId,
        payload: { vendorId: parsed.vendorId },
      }),
  );

  revalidatePath("/programs/vendors");
  revalidatePath("/modules/hipaa");
}
