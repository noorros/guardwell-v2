// src/app/(dashboard)/programs/credentials/actions.ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectCredentialUpserted,
  projectCredentialRemoved,
} from "@/lib/events/projections/credential";
import { db } from "@/lib/db";

const isoOrEmpty = z.string().optional().nullable();

const AddInput = z.object({
  credentialTypeCode: z.string().min(1),
  holderId: z.string().min(1).optional().nullable(),
  title: z.string().min(1).max(200),
  licenseNumber: z.string().max(100).optional().nullable(),
  issuingBody: z.string().max(200).optional().nullable(),
  issueDate: isoOrEmpty,    // YYYY-MM-DD from <input type="date">
  expiryDate: isoOrEmpty,
  notes: z.string().max(2000).optional().nullable(),
});

const RemoveInput = z.object({
  credentialId: z.string().min(1),
});

function toIso(date: string | null | undefined): string | null {
  if (!date) return null;
  // <input type="date"> yields "YYYY-MM-DD"; turn it into an ISO at noon UTC
  // to avoid TZ-drift edge cases.
  return `${date}T12:00:00.000Z`;
}

async function verifyHolderInPractice(holderId: string, practiceId: string) {
  const pu = await db.practiceUser.findUnique({ where: { id: holderId } });
  if (!pu || pu.practiceId !== practiceId) {
    throw new Error("Unauthorized: holder not in your practice");
  }
  if (pu.removedAt) {
    throw new Error("Cannot assign a credential to a removed user");
  }
}

async function verifyCredentialInPractice(credentialId: string, practiceId: string) {
  const c = await db.credential.findUnique({ where: { id: credentialId } });
  if (!c || c.practiceId !== practiceId) {
    throw new Error("Unauthorized: credential not in your practice");
  }
  return c;
}

export async function addCredentialAction(input: z.infer<typeof AddInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = AddInput.parse(input);

  if (parsed.holderId) {
    await verifyHolderInPractice(parsed.holderId, pu.practiceId);
  }

  const credentialId = randomUUID();
  const payload = {
    credentialId,
    credentialTypeCode: parsed.credentialTypeCode,
    holderId: parsed.holderId ?? null,
    title: parsed.title,
    licenseNumber: parsed.licenseNumber ?? null,
    issuingBody: parsed.issuingBody ?? null,
    issueDate: toIso(parsed.issueDate),
    expiryDate: toIso(parsed.expiryDate),
    notes: parsed.notes ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "CREDENTIAL_UPSERTED",
      payload,
    },
    async (tx) =>
      projectCredentialUpserted(tx, { practiceId: pu.practiceId, payload }),
  );

  revalidatePath("/programs/credentials");
}

export async function removeCredentialAction(input: z.infer<typeof RemoveInput>) {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  const parsed = RemoveInput.parse(input);
  const existing = await verifyCredentialInPractice(parsed.credentialId, pu.practiceId);
  if (existing.retiredAt) return;

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "CREDENTIAL_REMOVED",
      payload: { credentialId: parsed.credentialId },
    },
    async (tx) =>
      projectCredentialRemoved(tx, {
        practiceId: pu.practiceId,
        payload: { credentialId: parsed.credentialId },
      }),
  );

  revalidatePath("/programs/credentials");
}
