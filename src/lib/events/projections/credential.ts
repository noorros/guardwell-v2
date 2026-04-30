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
import { assertProjectionPracticeOwned } from "./guards";

type UpsertedPayload = PayloadFor<"CREDENTIAL_UPSERTED", 1>;
type RemovedPayload = PayloadFor<"CREDENTIAL_REMOVED", 1>;
type CeuLoggedPayload = PayloadFor<"CEU_ACTIVITY_LOGGED", 1>;
type CeuRemovedPayload = PayloadFor<"CEU_ACTIVITY_REMOVED", 1>;
type ReminderConfigPayload = PayloadFor<
  "CREDENTIAL_REMINDER_CONFIG_UPDATED",
  1
>;

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

  // Audit C-1: refuse a forged CREDENTIAL_UPSERTED carrying another
  // practice's credentialId — without this guard, holderId / dates /
  // retiredAt on Practice B's row could be overwritten.
  const existing = await tx.credential.findUnique({
    where: { id: payload.credentialId },
    select: { practiceId: true },
  });
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "credential",
    id: payload.credentialId,
  });

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
  // Audit C-1: refuse a forged CREDENTIAL_REMOVED carrying another
  // practice's credentialId — without this guard, the row could be
  // soft-deleted AND the caller's framework score mis-rederived from
  // the foreign credential type.
  const existing = await tx.credential.findUnique({
    where: { id: payload.credentialId },
    select: { credentialTypeId: true, practiceId: true },
  });
  if (!existing) return;
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "credential",
    id: payload.credentialId,
  });

  await tx.credential.update({
    where: { id: payload.credentialId },
    data: { retiredAt: new Date() },
  });

  await rederiveForCredential(tx, practiceId, existing.credentialTypeId);
}

// ────────────────────────────────────────────────────────────────────────
// CEU / CME tracking + renewal-reminder configuration
// ────────────────────────────────────────────────────────────────────────

export async function projectCeuActivityLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: CeuLoggedPayload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: gate on credentialId — without this guard, a CEU row
  // would be created in the caller's practice but pointing to another
  // practice's credential (FK invariant break) AND poison the caller's
  // CEU progress totals.
  const credential = await tx.credential.findUnique({
    where: { id: payload.credentialId },
    select: { practiceId: true },
  });
  if (!credential) {
    throw new Error(
      `CEU_ACTIVITY_LOGGED refused: credential ${payload.credentialId} not found`,
    );
  }
  assertProjectionPracticeOwned(credential, practiceId, {
    table: "credential",
    id: payload.credentialId,
  });

  await tx.ceuActivity.create({
    data: {
      id: payload.ceuActivityId,
      practiceId,
      credentialId: payload.credentialId,
      activityName: payload.activityName,
      provider: payload.provider ?? null,
      activityDate: new Date(payload.activityDate),
      hoursAwarded: payload.hoursAwarded,
      category: payload.category ?? null,
      certificateEvidenceId: payload.certificateEvidenceId ?? null,
      notes: payload.notes ?? null,
    },
  });
}

export async function projectCeuActivityRemoved(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: CeuRemovedPayload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: refuse a forged CEU_ACTIVITY_REMOVED carrying another
  // practice's ceuActivityId — without this guard, any CEU activity in
  // any practice could be soft-deleted.
  const existing = await tx.ceuActivity.findUnique({
    where: { id: payload.ceuActivityId },
    select: { practiceId: true },
  });
  if (!existing) return;
  assertProjectionPracticeOwned(existing, practiceId, {
    table: "ceuActivity",
    id: payload.ceuActivityId,
  });

  await tx.ceuActivity.update({
    where: { id: payload.ceuActivityId },
    data: { retiredAt: new Date() },
  });
}

export async function projectCredentialReminderConfigUpdated(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: ReminderConfigPayload },
): Promise<void> {
  const { practiceId, payload } = args;

  // Audit C-1: gate on credentialId — without this guard, a forged
  // event could create reminder-spam rows tied to another practice's
  // credential.
  const credential = await tx.credential.findUnique({
    where: { id: payload.credentialId },
    select: { practiceId: true },
  });
  if (!credential) {
    throw new Error(
      `CREDENTIAL_REMINDER_CONFIG_UPDATED refused: credential ${payload.credentialId} not found`,
    );
  }
  assertProjectionPracticeOwned(credential, practiceId, {
    table: "credential",
    id: payload.credentialId,
  });

  await tx.credentialReminderConfig.upsert({
    where: { credentialId: payload.credentialId },
    create: {
      id: payload.configId,
      practiceId,
      credentialId: payload.credentialId,
      enabled: payload.enabled,
      milestoneDays: payload.milestoneDays,
    },
    update: {
      enabled: payload.enabled,
      milestoneDays: payload.milestoneDays,
    },
  });
}
