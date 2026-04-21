// src/lib/events/projections/credential.ts
//
// Projects Credential events into the Credential table and rederives
// any requirement that accepts CREDENTIAL:<category> evidence. No HIPAA
// requirements currently use credentials — the hooks are wired so that
// when OSHA / DEA / CLIA frameworks ship, their derivation rules pick up
// credential events automatically.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type UpsertedPayload = PayloadFor<"CREDENTIAL_UPSERTED", 1>;
type RemovedPayload = PayloadFor<"CREDENTIAL_REMOVED", 1>;

async function rederiveForCredential(
  tx: Prisma.TransactionClient,
  practiceId: string,
  credentialTypeId: string,
): Promise<void> {
  const type = await tx.credentialType.findUnique({
    where: { id: credentialTypeId },
    select: { category: true, code: true },
  });
  if (!type) return;
  // Two evidence codes: the category (CREDENTIAL:CLINICAL_LICENSE) and the
  // specific type (CREDENTIAL_TYPE:MD_STATE_LICENSE) so future rules can
  // target whichever granularity they need.
  await rederiveRequirementStatus(tx, practiceId, `CREDENTIAL:${type.category}`);
  await rederiveRequirementStatus(
    tx,
    practiceId,
    `CREDENTIAL_TYPE:${type.code}`,
  );
}

export async function projectCredentialUpserted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: UpsertedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const credType = await tx.credentialType.findUnique({
    where: { code: payload.credentialTypeCode },
    select: { id: true },
  });
  if (!credType) {
    throw new Error(
      `Unknown credential type code: ${payload.credentialTypeCode}`,
    );
  }

  await tx.credential.upsert({
    where: { id: payload.credentialId },
    update: {
      credentialTypeId: credType.id,
      holderId: payload.holderId ?? null,
      title: payload.title,
      licenseNumber: payload.licenseNumber ?? null,
      issuingBody: payload.issuingBody ?? null,
      issueDate: payload.issueDate ? new Date(payload.issueDate) : null,
      expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : null,
      notes: payload.notes ?? null,
      retiredAt: null,
    },
    create: {
      id: payload.credentialId,
      practiceId,
      credentialTypeId: credType.id,
      holderId: payload.holderId ?? null,
      title: payload.title,
      licenseNumber: payload.licenseNumber ?? null,
      issuingBody: payload.issuingBody ?? null,
      issueDate: payload.issueDate ? new Date(payload.issueDate) : null,
      expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : null,
      notes: payload.notes ?? null,
    },
  });

  await rederiveForCredential(tx, practiceId, credType.id);
}

export async function projectCredentialRemoved(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: RemovedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  const existing = await tx.credential.findUnique({
    where: { id: payload.credentialId },
    select: { credentialTypeId: true },
  });
  if (!existing) return;

  await tx.credential.update({
    where: { id: payload.credentialId },
    data: { retiredAt: new Date() },
  });

  await rederiveForCredential(tx, practiceId, existing.credentialTypeId);
}
