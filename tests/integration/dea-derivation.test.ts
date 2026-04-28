// tests/integration/dea-derivation.test.ts
//
// Integration tests for DEA derivation rules (PR 3).
// Covers the 6 newly wired rules + 1 Phase-11 stub.
// Each test spins up an isolated practice with practiceUuid() suffixes so
// concurrent runs don't conflict.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectDeaInventoryRecorded } from "@/lib/events/projections/dea";
import { projectDeaDisposalCompleted } from "@/lib/events/projections/dea";
import { projectDeaOrderReceived } from "@/lib/events/projections/dea";
import { projectDeaTheftLossReported } from "@/lib/events/projections/dea";
import { projectPolicyAdopted } from "@/lib/events/projections/policyAdopted";
import { projectEpcsAttestation } from "@/lib/events/projections/epcsAttestation";
import { DEA_DERIVATION_RULES } from "@/lib/compliance/derivation/dea";
import { rederiveRequirementStatus } from "@/lib/compliance/derivation/rederive";

// ─── helpers ─────────────────────────────────────────────────────────────────

function practiceUuid() {
  return Math.random().toString(36).slice(2, 10);
}

async function seedDea() {
  const uid = practiceUuid();
  const user = await db.user.create({
    data: {
      firebaseUid: `dea-deriv-${uid}`,
      email: `dea-deriv-${uid}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `DEA Derivation Test Clinic ${uid}`, primaryState: "TX" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "DEA" },
  });
  const reqs = await db.regulatoryRequirement.findMany({
    where: { frameworkId: framework.id },
  });
  const byCode = new Map(reqs.map((r) => [r.code, r]));
  await db.practiceFramework.upsert({
    where: {
      practiceId_frameworkId: {
        practiceId: practice.id,
        frameworkId: framework.id,
      },
    },
    update: {},
    create: {
      practiceId: practice.id,
      frameworkId: framework.id,
      enabled: true,
      scoreCache: 0,
    },
  });
  return { user, practice, byCode };
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("DEA derivation rules", () => {
  // ── DEA_INVENTORY ──────────────────────────────────────────────────────────

  it("DEA_INVENTORY_RECORDED within 24 months flips DEA_INVENTORY to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_INVENTORY")!;
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");

    const inventoryId = randomUUID();
    const payload = {
      inventoryId,
      asOfDate: new Date().toISOString(),
      conductedByUserId: user.id,
      witnessUserId: null,
      notes: null,
      items: [
        {
          drugName: "Diazepam",
          schedule: "CIV" as const,
          quantity: 10,
          unit: "tablet",
          ndc: null,
          strength: null,
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
        projectDeaInventoryRecorded(tx, { practiceId: practice.id, payload }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── DEA_RECORDS ────────────────────────────────────────────────────────────

  it("DEA_RECORDS is COMPLIANT vacuously when no CS activity exists (zero events)", async () => {
    const { practice, byCode } = await seedDea();
    const req = byCode.get("DEA_RECORDS")!;
    // No events → vacuously COMPLIANT (zero records = zero activity = ok).
    // Trigger a manual rederive to simulate what happens after any DEA event.
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "DEA_RECORDS:ACTIVITY");
    });
    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("DEA_INVENTORY_RECORDED also flips DEA_RECORDS to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_RECORDS")!;

    const inventoryId = randomUUID();
    const payload = {
      inventoryId,
      asOfDate: new Date().toISOString(),
      conductedByUserId: user.id,
      witnessUserId: null,
      notes: null,
      items: [
        {
          drugName: "Hydrocodone",
          schedule: "CII" as const,
          quantity: 5,
          unit: "tablet",
          ndc: null,
          strength: null,
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
        projectDeaInventoryRecorded(tx, { practiceId: practice.id, payload }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── DEA_STORAGE ────────────────────────────────────────────────────────────

  it("Adopting DEA_SECURE_STORAGE_POLICY flips DEA_STORAGE to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_STORAGE")!;

    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POLICY_ADOPTED",
        payload: {
          practicePolicyId,
          policyCode: "DEA_SECURE_STORAGE_POLICY",
          version: 1,
        },
      },
      async (tx) =>
        projectPolicyAdopted(tx, {
          practiceId: practice.id,
          payload: {
            practicePolicyId,
            policyCode: "DEA_SECURE_STORAGE_POLICY",
            version: 1,
          },
        }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── DEA_PRESCRIPTION_SECURITY ──────────────────────────────────────────────

  it("Policy + EPCS_ATTESTATION within 365 days flips DEA_PRESCRIPTION_SECURITY to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_PRESCRIPTION_SECURITY")!;

    // Step 1: adopt policy
    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POLICY_ADOPTED",
        payload: {
          practicePolicyId,
          policyCode: "DEA_PRESCRIPTION_SECURITY_POLICY",
          version: 1,
        },
      },
      async (tx) =>
        projectPolicyAdopted(tx, {
          practiceId: practice.id,
          payload: {
            practicePolicyId,
            policyCode: "DEA_PRESCRIPTION_SECURITY_POLICY",
            version: 1,
          },
        }),
    );

    // Policy alone is not enough (no EPCS attestation yet).
    expect(await statusOf(practice.id, req.id)).toBe("GAP");

    // Step 2: emit EPCS attestation
    const attestationId = randomUUID();
    const epcsPayload = {
      attestationId,
      attestedByUserId: user.id,
      attestedAt: new Date().toISOString(),
      epcsVendor: "DrFirst",
      twoFactorEnabled: true,
      auditTrailConfirmed: true,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "EPCS_ATTESTATION",
        payload: epcsPayload,
      },
      async (tx) =>
        projectEpcsAttestation(tx, { practiceId: practice.id }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── DEA_LOSS_REPORTING ─────────────────────────────────────────────────────

  it("Loss-reporting policy with no theft events is COMPLIANT (vacuous)", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_LOSS_REPORTING")!;

    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POLICY_ADOPTED",
        payload: {
          practicePolicyId,
          policyCode: "DEA_LOSS_REPORTING_POLICY",
          version: 1,
        },
      },
      async (tx) =>
        projectPolicyAdopted(tx, {
          practiceId: practice.id,
          payload: {
            practicePolicyId,
            policyCode: "DEA_LOSS_REPORTING_POLICY",
            version: 1,
          },
        }),
    );

    // Policy adopted + no theft/loss events → vacuously COMPLIANT.
    // Trigger rederive on DEA_THEFT_LOSS:REPORTED to simulate what happens
    // when the rule is evaluated.
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(
        tx,
        practice.id,
        "DEA_THEFT_LOSS:REPORTED",
      );
    });

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("Theft event with form106SubmittedAt set keeps DEA_LOSS_REPORTING COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_LOSS_REPORTING")!;

    // Adopt policy first
    const practicePolicyId = randomUUID();
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "POLICY_ADOPTED",
        payload: {
          practicePolicyId,
          policyCode: "DEA_LOSS_REPORTING_POLICY",
          version: 1,
        },
      },
      async (tx) =>
        projectPolicyAdopted(tx, {
          practiceId: practice.id,
          payload: {
            practicePolicyId,
            policyCode: "DEA_LOSS_REPORTING_POLICY",
            version: 1,
          },
        }),
    );

    // Emit a theft/loss with form106SubmittedAt set
    const reportId = randomUUID();
    const theftPayload = {
      reportId,
      reportBatchId: null,
      incidentId: null,
      reportedByUserId: user.id,
      discoveredAt: new Date().toISOString(),
      lossType: "THEFT" as const,
      drugName: "Oxycodone",
      ndc: null,
      schedule: "CII" as const,
      strength: null,
      quantityLost: 10,
      unit: "tablet",
      methodOfDiscovery: null,
      lawEnforcementNotified: true,
      lawEnforcementAgency: null,
      lawEnforcementCaseNumber: null,
      deaNotifiedAt: new Date().toISOString(),
      form106SubmittedAt: new Date().toISOString(),
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_THEFT_LOSS_REPORTED",
        payload: theftPayload,
      },
      async (tx) =>
        projectDeaTheftLossReported(tx, {
          practiceId: practice.id,
          payload: theftPayload,
        }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── DEA_DISPOSAL ───────────────────────────────────────────────────────────

  it("DEA_DISPOSAL_COMPLETED flips DEA_DISPOSAL to COMPLIANT", async () => {
    const { user, practice, byCode } = await seedDea();
    const req = byCode.get("DEA_DISPOSAL")!;

    const disposalPayload = {
      disposalRecordId: randomUUID(),
      disposalBatchId: null,
      disposedByUserId: user.id,
      witnessUserId: null,
      reverseDistributorName: "PharmEco",
      reverseDistributorDeaNumber: null,
      disposalDate: new Date().toISOString(),
      disposalMethod: "REVERSE_DISTRIBUTOR" as const,
      drugName: "Diazepam",
      ndc: null,
      schedule: "CIV" as const,
      strength: null,
      quantity: 5,
      unit: "tablet",
      form41Filed: true,
      notes: null,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "DEA_DISPOSAL_COMPLETED",
        payload: disposalPayload,
      },
      async (tx) =>
        projectDeaDisposalCompleted(tx, {
          practiceId: practice.id,
          payload: disposalPayload,
        }),
    );

    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  it("DEA_DISPOSAL is vacuously COMPLIANT when no CS activity exists", async () => {
    const { practice, byCode } = await seedDea();
    const req = byCode.get("DEA_DISPOSAL")!;
    // No inventory, no orders, no disposals → vacuously COMPLIANT.
    await db.$transaction(async (tx) => {
      await rederiveRequirementStatus(tx, practice.id, "DEA_DISPOSAL:COMPLETED");
    });
    expect(await statusOf(practice.id, req.id)).toBe("COMPLIANT");
  });

  // ── DEA_EMPLOYEE_SCREENING (Phase 11 stub) ─────────────────────────────────

  it("DEA_EMPLOYEE_SCREENING stub returns null (no derived status — stays NOT_STARTED)", async () => {
    const { practice, byCode } = await seedDea();
    const req = byCode.get("DEA_EMPLOYEE_SCREENING")!;
    // The stub rule returns null → rederive does not flip the status.
    // We call rederive directly to confirm it's a no-op.
    await db.$transaction(async (tx) => {
      // There is no accepted evidence type for this requirement yet (stub).
      // We verify the status is unchanged after attempting a rederive.
      await rederiveRequirementStatus(tx, practice.id, "LEIE_SCREENING:CLEARED");
    });
    // Still NOT_STARTED because the stub returns null.
    expect(await statusOf(practice.id, req.id)).toBe("NOT_STARTED");
  });

  it("DEA_EMPLOYEE_SCREENING stub function returns null when invoked directly", async () => {
    // Per code review I2: the rederive-based test above can't reach the
    // stub function (empty acceptedEvidenceTypes). Invoke the stub
    // directly so a future regression that accidentally implements
    // employee screening before Phase 11 is caught.
    const { practice } = await seedDea();
    const stub = DEA_DERIVATION_RULES["DEA_EMPLOYEE_SCREENING"];
    expect(stub).toBeDefined();
    const result = await db.$transaction(async (tx) => stub!(tx, practice.id));
    expect(result).toBeNull();
  });
});
