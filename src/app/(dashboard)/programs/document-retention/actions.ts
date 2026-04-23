// src/app/(dashboard)/programs/document-retention/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectDestructionLogged } from "@/lib/events/projections/destructionLogged";

const Input = z.object({
  documentType: z.enum([
    "MEDICAL_RECORDS",
    "BILLING",
    "HR",
    "EMAIL_BACKUPS",
    "OTHER",
  ]),
  description: z.string().min(1).max(2000),
  volumeEstimate: z.string().max(200).optional(),
  method: z.enum([
    "SHREDDING",
    "SECURE_WIPE",
    "DEIDENTIFICATION",
    "INCINERATION",
    "OTHER",
  ]),
  witnessedByUserId: z.string().optional(),
  certificateUrl: z.string().max(500).optional(),
  destroyedAt: z.string().min(1), // YYYY-MM-DD
  notes: z.string().max(2000).optional(),
});

export async function recordDestructionAction(input: z.infer<typeof Input>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = Input.parse(input);

  // Normalize date input — `<input type="date">` gives a YYYY-MM-DD string.
  // Treat it as midnight UTC of that day.
  const destroyedAt = new Date(`${parsed.destroyedAt}T00:00:00.000Z`);
  if (Number.isNaN(destroyedAt.getTime())) {
    throw new Error("Invalid destroyedAt date.");
  }

  const destructionLogId = randomUUID();
  const payload = {
    destructionLogId,
    documentType: parsed.documentType,
    description: parsed.description,
    volumeEstimate: parsed.volumeEstimate ?? null,
    method: parsed.method,
    performedByUserId: user.id,
    witnessedByUserId: parsed.witnessedByUserId ?? null,
    certificateUrl: parsed.certificateUrl ?? null,
    destroyedAt: destroyedAt.toISOString(),
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "DESTRUCTION_LOGGED",
      payload,
    },
    async (tx) =>
      projectDestructionLogged(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/document-retention");
  revalidatePath("/modules/hipaa");
  revalidatePath("/audit/overview");
}
