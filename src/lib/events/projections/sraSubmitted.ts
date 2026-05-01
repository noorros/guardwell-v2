// src/lib/events/projections/sraSubmitted.ts
//
// Phase 5 — SRA_SUBMITTED projection. Currently a no-op; the existing
// sraCompleted projection still handles flipping isDraft + stamping
// completedAt + computing score. PR 5 will extend this projection to
// auto-create RiskItem rows for every NO/PARTIAL answer.

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type Payload = PayloadFor<"SRA_SUBMITTED", 1>;

export async function projectSraSubmitted(
  _tx: Prisma.TransactionClient,
  _args: { practiceId: string; payload: Payload },
): Promise<void> {
  // Intentional no-op in PR 3. PR 5 wires auto-RiskItem creation here.
}
