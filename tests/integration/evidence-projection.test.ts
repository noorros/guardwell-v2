// tests/integration/evidence-projection.test.ts
//
// Covers the 3 Evidence event projections:
//   EVIDENCE_UPLOAD_REQUESTED — creates Evidence row (PENDING)
//   EVIDENCE_UPLOAD_CONFIRMED — flips to UPLOADED
//   EVIDENCE_DELETED          — flips to DELETED (soft-delete)
//
// Also verifies dev no-op behavior: requestUpload returns uploadUrl:null
// when GCS_EVIDENCE_BUCKET is unset.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectEvidenceUploadRequested,
  projectEvidenceUploadConfirmed,
  projectEvidenceDeleted,
} from "@/lib/events/projections/evidence";
import { requestUpload } from "@/lib/storage/evidence";

// ── Seed helper ───────────────────────────────────────────────────────────────

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: `ev-${Math.random().toString(36).slice(2, 10)}`,
      email: `ev-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Evidence Test Clinic", primaryState: "AZ" },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice, pu };
}

// ── EVIDENCE_UPLOAD_REQUESTED ──────────────────────────────────────────────

describe("projectEvidenceUploadRequested", () => {
  it("creates an Evidence row with status PENDING", async () => {
    const { user, practice, pu } = await seed();
    const evidenceId = randomUUID();
    const gcsKey = `practices/${practice.id}/DESTRUCTION_LOG/dl-1/abc-cert.pdf`;

    const payload = {
      evidenceId,
      entityType: "DESTRUCTION_LOG",
      entityId: "dl-1",
      fileName: "cert.pdf",
      gcsKey,
      mimeType: "application/pdf",
      fileSizeBytes: 98304,
      uploadedById: pu.id,
    };

    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "EVIDENCE_UPLOAD_REQUESTED",
        payload,
      },
      async (tx) =>
        projectEvidenceUploadRequested(tx, {
          practiceId: practice.id,
          payload,
        }),
    );

    const row = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(row.entityType).toBe("DESTRUCTION_LOG");
    expect(row.fileName).toBe("cert.pdf");
    expect(row.status).toBe("PENDING");
    expect(row.confirmedAt).toBeNull();
    expect(row.deletedAt).toBeNull();
  });

  it("is idempotent on gcsKey (upsert — second call doesn't duplicate)", async () => {
    const { user, practice, pu } = await seed();
    const evidenceId = randomUUID();
    const gcsKey = `practices/${practice.id}/DESTRUCTION_LOG/dl-dup/file.pdf`;

    const payload = {
      evidenceId,
      entityType: "DESTRUCTION_LOG",
      entityId: "dl-dup",
      fileName: "dup.pdf",
      gcsKey,
      mimeType: "application/pdf",
      fileSizeBytes: 100,
      uploadedById: pu.id,
    };

    for (let i = 0; i < 2; i++) {
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "EVIDENCE_UPLOAD_REQUESTED",
          payload,
        },
        async (tx) =>
          projectEvidenceUploadRequested(tx, {
            practiceId: practice.id,
            payload,
          }),
      );
    }

    const rows = await db.evidence.findMany({ where: { gcsKey } });
    expect(rows).toHaveLength(1);
  });
});

// ── EVIDENCE_UPLOAD_CONFIRMED ──────────────────────────────────────────────

describe("projectEvidenceUploadConfirmed", () => {
  it("flips status from PENDING to UPLOADED and sets confirmedAt", async () => {
    const { user, practice, pu } = await seed();
    const evidenceId = randomUUID();
    const gcsKey = `practices/${practice.id}/DESTRUCTION_LOG/dl-2/conf.pdf`;

    // First: create as PENDING
    const reqPayload = {
      evidenceId,
      entityType: "DESTRUCTION_LOG",
      entityId: "dl-2",
      fileName: "conf.pdf",
      gcsKey,
      mimeType: "application/pdf",
      fileSizeBytes: 50000,
      uploadedById: pu.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "EVIDENCE_UPLOAD_REQUESTED",
        payload: reqPayload,
      },
      async (tx) =>
        projectEvidenceUploadRequested(tx, {
          practiceId: practice.id,
          payload: reqPayload,
        }),
    );

    // Then confirm
    const confPayload = { evidenceId };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "EVIDENCE_UPLOAD_CONFIRMED",
        payload: confPayload,
      },
      async (tx) =>
        projectEvidenceUploadConfirmed(tx, {
          practiceId: practice.id,
          payload: confPayload,
        }),
    );

    const row = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(row.status).toBe("UPLOADED");
    expect(row.confirmedAt).not.toBeNull();
  });

  it("is idempotent when already UPLOADED", async () => {
    const { user, practice, pu } = await seed();
    const evidenceId = randomUUID();
    const gcsKey = `practices/${practice.id}/DESTRUCTION_LOG/dl-3/idem.pdf`;

    const reqPayload = {
      evidenceId,
      entityType: "DESTRUCTION_LOG",
      entityId: "dl-3",
      fileName: "idem.pdf",
      gcsKey,
      mimeType: "application/pdf",
      fileSizeBytes: 200,
      uploadedById: pu.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "EVIDENCE_UPLOAD_REQUESTED",
        payload: reqPayload,
      },
      async (tx) =>
        projectEvidenceUploadRequested(tx, {
          practiceId: practice.id,
          payload: reqPayload,
        }),
    );

    const confPayload = { evidenceId };
    // Call confirm twice — should not throw
    for (let i = 0; i < 2; i++) {
      await appendEventAndApply(
        {
          practiceId: practice.id,
          actorUserId: user.id,
          type: "EVIDENCE_UPLOAD_CONFIRMED",
          payload: confPayload,
        },
        async (tx) =>
          projectEvidenceUploadConfirmed(tx, {
            practiceId: practice.id,
            payload: confPayload,
          }),
      );
    }

    const row = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(row.status).toBe("UPLOADED");
  });
});

// ── EVIDENCE_DELETED ─────────────────────────────────────────────────────────

describe("projectEvidenceDeleted", () => {
  it("soft-deletes the row (status=DELETED, deletedAt set)", async () => {
    const { user, practice, pu } = await seed();
    const evidenceId = randomUUID();
    const gcsKey = `practices/${practice.id}/DESTRUCTION_LOG/dl-4/del.pdf`;

    const reqPayload = {
      evidenceId,
      entityType: "DESTRUCTION_LOG",
      entityId: "dl-4",
      fileName: "del.pdf",
      gcsKey,
      mimeType: "application/pdf",
      fileSizeBytes: 300,
      uploadedById: pu.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "EVIDENCE_UPLOAD_REQUESTED",
        payload: reqPayload,
      },
      async (tx) =>
        projectEvidenceUploadRequested(tx, {
          practiceId: practice.id,
          payload: reqPayload,
        }),
    );

    const delPayload = { evidenceId, reason: "test cleanup" };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "EVIDENCE_DELETED",
        payload: delPayload,
      },
      async (tx) =>
        projectEvidenceDeleted(tx, {
          practiceId: practice.id,
          payload: delPayload,
        }),
    );

    const row = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(row.status).toBe("DELETED");
    expect(row.deletedAt).not.toBeNull();
  });

  it("rejects cross-practice delete", async () => {
    const { user, practice, pu } = await seed();
    const { practice: otherPractice } = await seed();
    const evidenceId = randomUUID();
    const gcsKey = `practices/${practice.id}/DESTRUCTION_LOG/dl-5/xp.pdf`;

    const reqPayload = {
      evidenceId,
      entityType: "DESTRUCTION_LOG",
      entityId: "dl-5",
      fileName: "xp.pdf",
      gcsKey,
      mimeType: "application/pdf",
      fileSizeBytes: 400,
      uploadedById: pu.id,
    };
    await appendEventAndApply(
      {
        practiceId: practice.id,
        actorUserId: user.id,
        type: "EVIDENCE_UPLOAD_REQUESTED",
        payload: reqPayload,
      },
      async (tx) =>
        projectEvidenceUploadRequested(tx, {
          practiceId: practice.id,
          payload: reqPayload,
        }),
    );

    // Attempt to delete from a different practice — should throw
    const delPayload = { evidenceId };
    await expect(
      appendEventAndApply(
        {
          practiceId: otherPractice.id,
          actorUserId: user.id,
          type: "EVIDENCE_DELETED",
          payload: delPayload,
        },
        async (tx) =>
          projectEvidenceDeleted(tx, {
            practiceId: otherPractice.id,
            payload: delPayload,
          }),
      ),
    ).rejects.toThrow();
  });
});

// ── Dev no-op: requestUpload returns null uploadUrl when bucket unset ────────

describe("requestUpload dev no-op", () => {
  it("returns uploadUrl: null when GCS_EVIDENCE_BUCKET is unset", async () => {
    const { user, practice, pu } = await seed();

    // GCS_EVIDENCE_BUCKET is unset in test environment (no .env.local for tests)
    const result = await requestUpload({
      practiceId: practice.id,
      practiceUserId: pu.id,
      actorUserId: user.id,
      entityType: "DESTRUCTION_LOG",
      entityId: "dl-devnoop",
      fileName: "test.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 1024,
    });

    expect(result.uploadUrl).toBeNull();
    expect(result.reason).toContain("dev no-op");
    expect(result.evidenceId).toBeTruthy();
    expect(result.gcsKey).toContain("DESTRUCTION_LOG");

    // Evidence row was created with PENDING status
    const row = await db.evidence.findUniqueOrThrow({
      where: { id: result.evidenceId },
    });
    expect(row.status).toBe("PENDING");
  });
});
