// tests/integration/dea-projection.test.ts
//
// Projection tests for the 4 DEA event types — verify the create-side
// of the schema lands correct rows.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectDeaInventoryRecorded,
  projectDeaOrderReceived,
  projectDeaDisposalCompleted,
  projectDeaTheftLossReported,
} from "@/lib/events/projections/dea";

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2, 10)}`,
      email: `dea-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Pat",
      lastName: "Smith",
    },
  });
  const practice = await db.practice.create({
    data: { name: "DEA Projection Test", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

describe("DEA projections", () => {
  it("DEA_INVENTORY_RECORDED creates parent inventory + items", async () => {
    const { user, practice } = await seed();
    const inventoryId = randomUUID();
    const payload = {
      inventoryId,
      asOfDate: new Date("2026-04-15T10:00:00Z").toISOString(),
      conductedByUserId: user.id,
      witnessUserId: null,
      notes: "Q2 biennial inventory",
      items: [
        {
          drugName: "Hydrocodone/APAP",
          ndc: "0093-3358-01",
          schedule: "CII" as const,
          strength: "5mg/325mg",
          quantity: 100,
          unit: "tablets",
        },
        {
          drugName: "Lorazepam",
          ndc: null,
          schedule: "CIV" as const,
          strength: "1mg",
          quantity: 30,
          unit: "tablets",
        },
      ],
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_INVENTORY_RECORDED",
        payload,
      },
      async (tx) =>
        projectDeaInventoryRecorded(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const inv = await db.deaInventory.findUnique({
      where: { id: inventoryId },
      include: { items: true },
    });
    expect(inv).not.toBeNull();
    expect(inv?.items).toHaveLength(2);
    expect(inv?.items.map((i) => i.drugName).sort()).toEqual([
      "Hydrocodone/APAP",
      "Lorazepam",
    ]);
  });

  it("DEA_ORDER_RECEIVED creates an order record", async () => {
    const { user, practice } = await seed();
    const orderRecordId = randomUUID();
    const payload = {
      orderRecordId,
      orderedByUserId: user.id,
      supplierName: "Cardinal Health",
      supplierDeaNumber: "PC1234567",
      orderedAt: new Date("2026-04-10T09:00:00Z").toISOString(),
      receivedAt: new Date("2026-04-12T14:00:00Z").toISOString(),
      form222Number: "0012345-A",
      drugName: "Oxycodone",
      ndc: "0228-2879-50",
      schedule: "CII" as const,
      strength: "5mg",
      quantity: 50,
      unit: "tablets",
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_ORDER_RECEIVED",
        payload,
      },
      async (tx) =>
        projectDeaOrderReceived(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const ord = await db.deaOrderRecord.findUnique({
      where: { id: orderRecordId },
    });
    expect(ord?.supplierName).toBe("Cardinal Health");
    expect(ord?.form222Number).toBe("0012345-A");
    expect(ord?.schedule).toBe("CII");
  });

  it("DEA_DISPOSAL_COMPLETED creates a disposal record", async () => {
    const { user, practice } = await seed();
    const disposalRecordId = randomUUID();
    const payload = {
      disposalRecordId,
      disposedByUserId: user.id,
      witnessUserId: null,
      reverseDistributorName: "Stericycle",
      reverseDistributorDeaNumber: "RC7654321",
      disposalDate: new Date("2026-04-20T15:00:00Z").toISOString(),
      disposalMethod: "REVERSE_DISTRIBUTOR" as const,
      drugName: "Expired Hydrocodone",
      ndc: "0093-3358-01",
      schedule: "CII" as const,
      strength: "5mg/325mg",
      quantity: 12,
      unit: "tablets",
      form41Filed: true,
      notes: "Expired stock from Q1",
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_DISPOSAL_COMPLETED",
        payload,
      },
      async (tx) =>
        projectDeaDisposalCompleted(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const disp = await db.deaDisposalRecord.findUnique({
      where: { id: disposalRecordId },
    });
    expect(disp?.reverseDistributorName).toBe("Stericycle");
    expect(disp?.form41Filed).toBe(true);
    expect(disp?.disposalMethod).toBe("REVERSE_DISTRIBUTOR");
  });

  it("DEA_THEFT_LOSS_REPORTED creates a theft/loss report", async () => {
    const { user, practice } = await seed();
    const reportId = randomUUID();
    const payload = {
      reportId,
      incidentId: null,
      reportedByUserId: user.id,
      discoveredAt: new Date("2026-04-18T08:00:00Z").toISOString(),
      lossType: "THEFT" as const,
      drugName: "Oxycodone",
      ndc: "0228-2879-50",
      schedule: "CII" as const,
      strength: "5mg",
      quantityLost: 60,
      unit: "tablets",
      methodOfDiscovery: "Daily count discrepancy",
      lawEnforcementNotified: true,
      lawEnforcementAgency: "Phoenix PD",
      lawEnforcementCaseNumber: "2026-04-18-447",
      deaNotifiedAt: new Date("2026-04-18T11:00:00Z").toISOString(),
      form106SubmittedAt: new Date("2026-04-18T16:00:00Z").toISOString(),
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_THEFT_LOSS_REPORTED",
        payload,
      },
      async (tx) =>
        projectDeaTheftLossReported(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const rpt = await db.deaTheftLossReport.findUnique({
      where: { id: reportId },
    });
    expect(rpt?.lossType).toBe("THEFT");
    expect(rpt?.quantityLost).toBe(60);
    expect(rpt?.lawEnforcementAgency).toBe("Phoenix PD");
    expect(rpt?.form106SubmittedAt).not.toBeNull();
  });
});
