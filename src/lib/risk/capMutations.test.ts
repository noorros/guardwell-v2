// @vitest-environment node
//
// src/lib/risk/capMutations.test.ts
//
// Phase 5 PR 6 — coverage for the lib-helper layer that backs the CAP
// detail server actions + the alert→CAP fan-out + the create-CAP-from-
// risk path. Real DB. Each test seeds its own User + Practice +
// (optionally) RiskItem + Evidence; afterEach (in tests/setup.ts) does
// cleanup.
//
// Cases:
//   1. createCap with riskItemId — happy path stamps fields
//   2. createCap with sourceAlertId only (standalone) — happy path
//   3. createCap cross-tenant riskItemId — throws "Cross-tenant access denied"
//   4. updateCapStatus PENDING → IN_PROGRESS stamps startedAt
//   5. updateCapStatus IN_PROGRESS → COMPLETED stamps completedAt + completedByUserId
//   6. updateCapStatus cross-tenant — throws
//   7. updateCapDetails patches description, ownerUserId, dueDate, notes selectively
//   8. attachEvidenceToCap creates the join row
//   9. attachEvidenceToCap with cross-tenant evidence — throws

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import {
  createCap,
  updateCapStatus,
  updateCapDetails,
  attachEvidenceToCap,
} from "./capMutations";

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedPractice(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: rid("cap-uid"),
      email: `${rid("cap")}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `CapMutations Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

async function seedRiskItem(practiceId: string, label: string) {
  return db.riskItem.create({
    data: {
      practiceId,
      source: "SRA",
      sourceCode: `SRA_TEST_${label}`,
      sourceRefId: rid("ref"),
      category: "ADMINISTRATIVE",
      severity: "MEDIUM",
      title: `Test risk ${label}`,
      description: "Seeded risk for cap mutation tests",
      status: "OPEN",
    },
  });
}

async function seedEvidence(practiceId: string, label: string) {
  return db.evidence.create({
    data: {
      practiceId,
      entityType: "OTHER",
      entityId: rid("ent"),
      gcsKey: rid(`gcs-${label}`),
      fileName: `${label}.pdf`,
      mimeType: "application/pdf",
      fileSizeBytes: 1024,
      status: "UPLOADED",
    },
  });
}

describe("createCap", () => {
  it("creates a CAP row linked to a riskItem with status=PENDING", async () => {
    const { practice } = await seedPractice("create-with-risk");
    const risk = await seedRiskItem(practice.id, "create");

    const dueDate = new Date("2026-06-01T12:00:00.000Z");
    const result = await createCap(practice.id, {
      riskItemId: risk.id,
      description: "Patch the encryption gap",
      dueDate,
    });

    expect(result.id).toBeTruthy();

    const row = await db.correctiveAction.findUnique({
      where: { id: result.id },
    });
    expect(row?.practiceId).toBe(practice.id);
    expect(row?.riskItemId).toBe(risk.id);
    expect(row?.sourceAlertId).toBeNull();
    expect(row?.description).toBe("Patch the encryption gap");
    expect(row?.dueDate?.toISOString()).toBe(dueDate.toISOString());
    expect(row?.status).toBe("PENDING");
    expect(row?.startedAt).toBeNull();
    expect(row?.completedAt).toBeNull();
  });

  it("creates a CAP row linked only to a sourceAlertId (standalone)", async () => {
    const { practice } = await seedPractice("create-standalone");
    const alertId = rid("alert"); // no actual RegulatoryAlert row needed —
    // sourceAlertId is a loose FK (no DB constraint), and createCap
    // doesn't dereference it. Phase 5 PR 6 spec: standalone CAPs from
    // regulatory alerts have riskItemId=null.

    const result = await createCap(practice.id, {
      sourceAlertId: alertId,
      description: "Review HIPAA Security Rule controls",
    });

    const row = await db.correctiveAction.findUnique({
      where: { id: result.id },
    });
    expect(row?.riskItemId).toBeNull();
    expect(row?.sourceAlertId).toBe(alertId);
    expect(row?.description).toBe("Review HIPAA Security Rule controls");
    expect(row?.status).toBe("PENDING");
  });

  it("throws 'Cross-tenant access denied' when riskItemId belongs to a different practice", async () => {
    const a = await seedPractice("cross-a");
    const b = await seedPractice("cross-b");
    const bRisk = await seedRiskItem(b.practice.id, "victim");

    await expect(
      createCap(a.practice.id, {
        riskItemId: bRisk.id,
        description: "Hostile CAP",
      }),
    ).rejects.toThrow(/Cross-tenant access denied/);

    // Confirm no CAP was created.
    const rows = await db.correctiveAction.findMany({
      where: { description: "Hostile CAP" },
    });
    expect(rows).toHaveLength(0);
  });
});

describe("updateCapStatus", () => {
  it("stamps startedAt when transitioning PENDING → IN_PROGRESS", async () => {
    const { user, practice } = await seedPractice("status-start");
    const risk = await seedRiskItem(practice.id, "status-start");
    const cap = await createCap(practice.id, {
      riskItemId: risk.id,
      description: "Start work",
    });

    const before = await db.correctiveAction.findUnique({
      where: { id: cap.id },
    });
    expect(before?.startedAt).toBeNull();

    await updateCapStatus(cap.id, practice.id, "IN_PROGRESS", user.id);

    const after = await db.correctiveAction.findUnique({
      where: { id: cap.id },
    });
    expect(after?.status).toBe("IN_PROGRESS");
    expect(after?.startedAt).toBeInstanceOf(Date);
    expect(after?.completedAt).toBeNull();
    expect(after?.completedByUserId).toBeNull();
  });

  it("stamps completedAt + completedByUserId when transitioning to COMPLETED", async () => {
    const { user, practice } = await seedPractice("status-complete");
    const risk = await seedRiskItem(practice.id, "status-complete");
    const cap = await createCap(practice.id, {
      riskItemId: risk.id,
      description: "Finish work",
    });

    await updateCapStatus(cap.id, practice.id, "IN_PROGRESS", user.id);
    await updateCapStatus(cap.id, practice.id, "COMPLETED", user.id);

    const after = await db.correctiveAction.findUnique({
      where: { id: cap.id },
    });
    expect(after?.status).toBe("COMPLETED");
    expect(after?.completedAt).toBeInstanceOf(Date);
    expect(after?.completedByUserId).toBe(user.id);
  });

  it("throws 'Cross-tenant access denied' when practiceId mismatches the CAP", async () => {
    const a = await seedPractice("status-cross-a");
    const b = await seedPractice("status-cross-b");
    const bRisk = await seedRiskItem(b.practice.id, "status-cross-b");
    const bCap = await createCap(b.practice.id, {
      riskItemId: bRisk.id,
      description: "Victim CAP",
    });

    await expect(
      updateCapStatus(bCap.id, a.practice.id, "COMPLETED", a.user.id),
    ).rejects.toThrow(/Cross-tenant access denied/);

    // Confirm the CAP was NOT mutated.
    const after = await db.correctiveAction.findUnique({
      where: { id: bCap.id },
    });
    expect(after?.status).toBe("PENDING");
    expect(after?.completedAt).toBeNull();
  });
});

describe("updateCapDetails", () => {
  it("patches description, ownerUserId, dueDate, and notes selectively", async () => {
    const { user, practice } = await seedPractice("details");
    const risk = await seedRiskItem(practice.id, "details");
    const cap = await createCap(practice.id, {
      riskItemId: risk.id,
      description: "Initial",
    });

    // Patch description only.
    await updateCapDetails(cap.id, practice.id, {
      description: "Updated description",
    });
    let row = await db.correctiveAction.findUnique({ where: { id: cap.id } });
    expect(row?.description).toBe("Updated description");
    expect(row?.ownerUserId).toBeNull();
    expect(row?.notes).toBeNull();

    // Patch ownerUserId + dueDate only — description unchanged.
    const dueDate = new Date("2026-07-15T12:00:00.000Z");
    await updateCapDetails(cap.id, practice.id, {
      ownerUserId: user.id,
      dueDate,
    });
    row = await db.correctiveAction.findUnique({ where: { id: cap.id } });
    expect(row?.description).toBe("Updated description"); // unchanged
    expect(row?.ownerUserId).toBe(user.id);
    expect(row?.dueDate?.toISOString()).toBe(dueDate.toISOString());

    // Patch notes only.
    await updateCapDetails(cap.id, practice.id, {
      notes: "Owner reviewed and approved",
    });
    row = await db.correctiveAction.findUnique({ where: { id: cap.id } });
    expect(row?.notes).toBe("Owner reviewed and approved");
    expect(row?.ownerUserId).toBe(user.id); // unchanged
  });
});

describe("attachEvidenceToCap", () => {
  it("creates a CorrectiveActionEvidence join row", async () => {
    const { user, practice } = await seedPractice("evidence-happy");
    const risk = await seedRiskItem(practice.id, "evidence-happy");
    const cap = await createCap(practice.id, {
      riskItemId: risk.id,
      description: "Attach evidence",
    });
    const evidence = await seedEvidence(practice.id, "happy");

    await attachEvidenceToCap(cap.id, practice.id, evidence.id, user.id);

    const link = await db.correctiveActionEvidence.findUnique({
      where: {
        capId_evidenceId: { capId: cap.id, evidenceId: evidence.id },
      },
    });
    expect(link).not.toBeNull();
    expect(link?.attachedByUserId).toBe(user.id);
    expect(link?.attachedAt).toBeInstanceOf(Date);
  });

  it("throws 'Cross-tenant access denied' when the evidence belongs to a different practice", async () => {
    const a = await seedPractice("evidence-cross-a");
    const b = await seedPractice("evidence-cross-b");
    const aRisk = await seedRiskItem(a.practice.id, "evidence-cross-a");
    const aCap = await createCap(a.practice.id, {
      riskItemId: aRisk.id,
      description: "A's CAP",
    });
    const bEvidence = await seedEvidence(b.practice.id, "victim");

    await expect(
      attachEvidenceToCap(aCap.id, a.practice.id, bEvidence.id, a.user.id),
    ).rejects.toThrow(/Cross-tenant access denied/);

    // Confirm no join row was created.
    const links = await db.correctiveActionEvidence.findMany({
      where: { capId: aCap.id },
    });
    expect(links).toHaveLength(0);
  });
});
