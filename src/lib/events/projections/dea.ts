// src/lib/events/projections/dea.ts
//
// Projections for DEA controlled-substance events. Each projection runs
// inside the appendEventAndApply transaction; failure rolls back the
// EventLog write per ADR-0001.

import type { Prisma } from "@prisma/client";

interface InventoryItemPayload {
  drugName: string;
  ndc?: string | null;
  schedule: "CI" | "CII" | "CIIN" | "CIII" | "CIIIN" | "CIV" | "CV";
  strength?: string | null;
  quantity: number;
  unit: string;
}

interface InventoryRecordedPayload {
  inventoryId: string;
  asOfDate: string;
  conductedByUserId: string;
  witnessUserId?: string | null;
  notes?: string | null;
  items: InventoryItemPayload[];
}

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

interface OrderReceivedPayload {
  orderRecordId: string;
  orderedByUserId: string;
  supplierName: string;
  supplierDeaNumber?: string | null;
  orderedAt: string;
  receivedAt?: string | null;
  form222Number?: string | null;
  drugName: string;
  ndc?: string | null;
  schedule: InventoryItemPayload["schedule"];
  strength?: string | null;
  quantity: number;
  unit: string;
  notes?: string | null;
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

interface DisposalCompletedPayload {
  disposalRecordId: string;
  disposedByUserId: string;
  witnessUserId?: string | null;
  reverseDistributorName: string;
  reverseDistributorDeaNumber?: string | null;
  disposalDate: string;
  disposalMethod:
    | "REVERSE_DISTRIBUTOR"
    | "DEA_TAKE_BACK"
    | "DEA_DESTRUCTION"
    | "OTHER";
  drugName: string;
  ndc?: string | null;
  schedule: InventoryItemPayload["schedule"];
  strength?: string | null;
  quantity: number;
  unit: string;
  form41Filed: boolean;
  notes?: string | null;
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

interface TheftLossReportedPayload {
  reportId: string;
  incidentId?: string | null;
  reportedByUserId: string;
  discoveredAt: string;
  lossType: "THEFT" | "LOSS" | "IN_TRANSIT_LOSS" | "DESTRUCTION_DURING_THEFT";
  drugName: string;
  ndc?: string | null;
  schedule: InventoryItemPayload["schedule"];
  strength?: string | null;
  quantityLost: number;
  unit: string;
  methodOfDiscovery?: string | null;
  lawEnforcementNotified: boolean;
  lawEnforcementAgency?: string | null;
  lawEnforcementCaseNumber?: string | null;
  deaNotifiedAt?: string | null;
  form106SubmittedAt?: string | null;
  notes?: string | null;
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
