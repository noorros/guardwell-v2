// src/lib/events/projections/phishingDrill.ts
//
// Projects PHISHING_DRILL_LOGGED events: writes a PhishingDrill row and
// rederives HIPAA_PHISHING_DRILL_RECENT.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

type Payload = PayloadFor<"PHISHING_DRILL_LOGGED", 1>;

export async function projectPhishingDrillLogged(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: Payload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.phishingDrill.create({
    data: {
      id: payload.phishingDrillId,
      practiceId,
      conductedAt: new Date(payload.conductedAt),
      vendor: payload.vendor ?? null,
      totalRecipients: payload.totalRecipients,
      clickedCount: payload.clickedCount,
      reportedCount: payload.reportedCount,
      attachmentUrl: payload.attachmentUrl ?? null,
      loggedByUserId: payload.loggedByUserId,
      notes: payload.notes ?? null,
    },
  });
  await rederiveRequirementStatus(tx, practiceId, "PHISHING_DRILL:LOGGED");
}
