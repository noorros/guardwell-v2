// src/lib/events/projections/backupVerification.ts
//
// Projects BACKUP_VERIFICATION_LOGGED events: writes a BackupVerification
// row and rederives HIPAA_BACKUP_VERIFIED_RECENT.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"BACKUP_VERIFICATION_LOGGED", 1>;

export async function projectBackupVerificationLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.backupVerification.create({
    data: {
      id: payload.backupVerificationId,
      practiceId,
      verifiedAt: new Date(payload.verifiedAt),
      scope: payload.scope,
      success: payload.success,
      restoreTimeMinutes: payload.restoreTimeMinutes ?? null,
      loggedByUserId: payload.loggedByUserId,
      notes: payload.notes ?? null,
    },
  });
  await rederiveRequirementStatus(
    tx,
    practiceId,
    "BACKUP_VERIFICATION:LOGGED",
  );
}
