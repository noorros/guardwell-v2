// src/lib/events/projections/dea.ts
//
// Projections for DEA controlled-substance events. Each projection runs
// inside the appendEventAndApply transaction; failure rolls back the
// EventLog write per ADR-0001.
//
// Event-shape conventions:
//   DEA_INVENTORY_RECORDED     — fires once per inventory snapshot;
//                                payload carries an items[] list
//                                (parent + children written atomically).
//   DEA_ORDER_RECEIVED         — fires once per drug. Multi-drug Form 222
//                                orders share an orderBatchId.
//   DEA_DISPOSAL_COMPLETED     — fires once per drug. Multi-drug disposals
//                                share a disposalBatchId (Form 41).
//   DEA_THEFT_LOSS_REPORTED    — fires once per drug. Multi-drug theft/loss
//                                events share a reportBatchId (Form 106).

import type { Prisma } from "@prisma/client";
import type { PayloadFor } from "../registry";

type InventoryRecordedPayload = PayloadFor<"DEA_INVENTORY_RECORDED", 1>;
type OrderReceivedPayload = PayloadFor<"DEA_ORDER_RECEIVED", 1>;
type DisposalCompletedPayload = PayloadFor<"DEA_DISPOSAL_COMPLETED", 1>;
type TheftLossReportedPayload = PayloadFor<"DEA_THEFT_LOSS_REPORTED", 1>;

export async function projectDeaInventoryRecorded(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: InventoryRecordedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.deaInventory.create({
    data: {
      id: payload.inventoryId,
      practiceId,
      asOfDate: new Date(payload.asOfDate),
      conductedByUserId: payload.conductedByUserId,
      witnessUserId: payload.witnessUserId ?? null,
      notes: payload.notes ?? null,
      items: {
        create: payload.items.map((it) => ({
          drugName: it.drugName,
          ndc: it.ndc ?? null,
          schedule: it.schedule,
          strength: it.strength ?? null,
          quantity: it.quantity,
          unit: it.unit,
        })),
      },
    },
  });
}

export async function projectDeaOrderReceived(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: OrderReceivedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.deaOrderRecord.create({
    data: {
      id: payload.orderRecordId,
      practiceId,
      orderBatchId: payload.orderBatchId ?? null,
      orderedByUserId: payload.orderedByUserId,
      supplierName: payload.supplierName,
      supplierDeaNumber: payload.supplierDeaNumber ?? null,
      orderedAt: new Date(payload.orderedAt),
      receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : null,
      form222Number: payload.form222Number ?? null,
      drugName: payload.drugName,
      ndc: payload.ndc ?? null,
      schedule: payload.schedule,
      strength: payload.strength ?? null,
      quantity: payload.quantity,
      unit: payload.unit,
      notes: payload.notes ?? null,
    },
  });
}

export async function projectDeaDisposalCompleted(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: DisposalCompletedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.deaDisposalRecord.create({
    data: {
      id: payload.disposalRecordId,
      practiceId,
      disposalBatchId: payload.disposalBatchId ?? null,
      disposedByUserId: payload.disposedByUserId,
      witnessUserId: payload.witnessUserId ?? null,
      reverseDistributorName: payload.reverseDistributorName,
      reverseDistributorDeaNumber: payload.reverseDistributorDeaNumber ?? null,
      disposalDate: new Date(payload.disposalDate),
      disposalMethod: payload.disposalMethod,
      drugName: payload.drugName,
      ndc: payload.ndc ?? null,
      schedule: payload.schedule,
      strength: payload.strength ?? null,
      quantity: payload.quantity,
      unit: payload.unit,
      form41Filed: payload.form41Filed,
      notes: payload.notes ?? null,
    },
  });
}

export async function projectDeaTheftLossReported(
  tx: Prisma.TransactionClient,
  args: { practiceId: string; payload: TheftLossReportedPayload },
): Promise<void> {
  const { practiceId, payload } = args;
  await tx.deaTheftLossReport.create({
    data: {
      id: payload.reportId,
      practiceId,
      reportBatchId: payload.reportBatchId ?? null,
      incidentId: payload.incidentId ?? null,
      reportedByUserId: payload.reportedByUserId,
      discoveredAt: new Date(payload.discoveredAt),
      lossType: payload.lossType,
      drugName: payload.drugName,
      ndc: payload.ndc ?? null,
      schedule: payload.schedule,
      strength: payload.strength ?? null,
      quantityLost: payload.quantityLost,
      unit: payload.unit,
      methodOfDiscovery: payload.methodOfDiscovery ?? null,
      lawEnforcementNotified: payload.lawEnforcementNotified,
      lawEnforcementAgency: payload.lawEnforcementAgency ?? null,
      lawEnforcementCaseNumber: payload.lawEnforcementCaseNumber ?? null,
      deaNotifiedAt: payload.deaNotifiedAt
        ? new Date(payload.deaNotifiedAt)
        : null,
      form106SubmittedAt: payload.form106SubmittedAt
        ? new Date(payload.form106SubmittedAt)
        : null,
      notes: payload.notes ?? null,
    },
  });
}

// DEA PDF audit-trail event — emitted on every DEA PDF read (Inventory,
// Form 41, Form 106). EventLog row IS the audit trail; no projection
// state to update. Same shape as projectIncidentBreachMemoGenerated and
// projectIncidentOshaLogGenerated.
export async function projectDeaPdfGenerated(): Promise<void> {
  // intentional no-op
}
