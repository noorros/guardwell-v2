// tests/integration/credentials-evidence-isolation.test.ts
//
// Audit #21 MN-6: STAFF/VIEWER could enumerate credential ids from the
// activity log (CR-3 — fixed in PR #215) and pull evidence files for
// HR-sensitive credentials (DEA cert PDFs, malpractice insurance certs,
// license cards). PR-C7 closes the second half by:
//   1. Hiding the evidence list on the credential detail page for
//      STAFF/VIEWER.
//   2. Returning 403 from /api/evidence/[id]/download when the evidence
//      row is attached to a CREDENTIAL and the viewer role is STAFF or
//      VIEWER.
//
// Other entityTypes (POLICY, INCIDENT, etc.) keep their existing role
// contracts — this gate is narrow on purpose.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

declare global {
  var __credentialsEvidenceTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => globalThis.__credentialsEvidenceTestUser ?? null,
    requireUser: async () => {
      if (!globalThis.__credentialsEvidenceTestUser) {
        throw new Error("Unauthorized");
      }
      return globalThis.__credentialsEvidenceTestUser;
    },
  };
});

beforeEach(() => {
  globalThis.__credentialsEvidenceTestUser = null;
});

async function seed(role: "OWNER" | "ADMIN" | "STAFF" | "VIEWER") {
  const user = await db.user.create({
    data: {
      firebaseUid: `cev-${Math.random().toString(36).slice(2, 10)}`,
      email: `cev-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `CEV ${role} Practice`, primaryState: "AZ" },
  });
  // Seed an OWNER first so the practice has a captain.
  const ownerUser = await db.user.create({
    data: {
      firebaseUid: `cev-owner-${Math.random().toString(36).slice(2, 10)}`,
      email: `cev-owner-${Math.random().toString(36).slice(2, 8)}@test.test`,
    },
  });
  await db.practiceUser.create({
    data: { userId: ownerUser.id, practiceId: practice.id, role: "OWNER" },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role },
  });
  globalThis.__credentialsEvidenceTestUser = {
    id: user.id,
    email: user.email,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice, pu, ownerUser };
}

async function seedEvidence(args: {
  practiceId: string;
  uploadedById: string;
  entityType: "CREDENTIAL" | "POLICY";
  entityId?: string;
}) {
  const evidenceId = randomUUID();
  const entityId = args.entityId ?? randomUUID();
  const gcsKey = `practices/${args.practiceId}/${args.entityType}/${entityId}/${evidenceId.slice(0, 12)}-test.pdf`;
  await db.evidence.create({
    data: {
      id: evidenceId,
      practiceId: args.practiceId,
      uploadedById: args.uploadedById,
      entityType: args.entityType,
      entityId,
      fileName: "test.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 1024,
      gcsKey,
      status: "UPLOADED",
      confirmedAt: new Date(),
    },
  });
  return { evidenceId, entityId, gcsKey };
}

describe("Credentials evidence isolation (audit #21 MN-6)", () => {
  // ────────────────────────────────────────────────────────────────────
  // /api/evidence/[id]/download role gate (entityType=CREDENTIAL only)
  // ────────────────────────────────────────────────────────────────────

  it("STAFF GET /api/evidence/[id]/download for CREDENTIAL → 403", async () => {
    const { practice, ownerUser } = await seed("STAFF");
    // Seed an OWNER PracticeUser row so the credential has an uploader.
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: ownerUser.id, practiceId: practice.id },
    });
    const { evidenceId } = await seedEvidence({
      practiceId: practice.id,
      uploadedById: ownerPu.id,
      entityType: "CREDENTIAL",
    });

    const { GET } = await import(
      "@/app/api/evidence/[id]/download/route"
    );
    const res = await GET(
      new Request(`http://test.test/api/evidence/${evidenceId}/download`),
      { params: Promise.resolve({ id: evidenceId }) },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Forbidden");
  });

  it("VIEWER GET /api/evidence/[id]/download for CREDENTIAL → 403", async () => {
    const { practice, ownerUser } = await seed("VIEWER");
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: ownerUser.id, practiceId: practice.id },
    });
    const { evidenceId } = await seedEvidence({
      practiceId: practice.id,
      uploadedById: ownerPu.id,
      entityType: "CREDENTIAL",
    });

    const { GET } = await import(
      "@/app/api/evidence/[id]/download/route"
    );
    const res = await GET(
      new Request(`http://test.test/api/evidence/${evidenceId}/download`),
      { params: Promise.resolve({ id: evidenceId }) },
    );
    expect(res.status).toBe(403);
  });

  it("STAFF GET /api/evidence/[id]/download for POLICY → not 403 (gate is CREDENTIAL-scoped)", async () => {
    // POLICY ack evidence is intentionally accessible to STAFF (they're
    // the ones who upload it). This test confirms the role gate added
    // for audit #21 MN-6 doesn't bleed into other entityTypes.
    //
    // GCS isn't configured in tests, so the route returns 503 (not 200);
    // the assertion that matters is "not 403" — STAFF reached the
    // download path rather than being blocked.
    const { practice, ownerUser } = await seed("STAFF");
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: ownerUser.id, practiceId: practice.id },
    });
    const { evidenceId } = await seedEvidence({
      practiceId: practice.id,
      uploadedById: ownerPu.id,
      entityType: "POLICY",
    });

    const { GET } = await import(
      "@/app/api/evidence/[id]/download/route"
    );
    const res = await GET(
      new Request(`http://test.test/api/evidence/${evidenceId}/download`),
      { params: Promise.resolve({ id: evidenceId }) },
    );
    expect(res.status).not.toBe(403);
    // Concrete: dev no-op returns 503 because GCS_EVIDENCE_BUCKET unset.
    expect(res.status).toBe(503);
  });

  it("ADMIN GET /api/evidence/[id]/download for CREDENTIAL → not 403 (happy path)", async () => {
    const { practice, ownerUser } = await seed("ADMIN");
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: ownerUser.id, practiceId: practice.id },
    });
    const { evidenceId } = await seedEvidence({
      practiceId: practice.id,
      uploadedById: ownerPu.id,
      entityType: "CREDENTIAL",
    });

    const { GET } = await import(
      "@/app/api/evidence/[id]/download/route"
    );
    const res = await GET(
      new Request(`http://test.test/api/evidence/${evidenceId}/download`),
      { params: Promise.resolve({ id: evidenceId }) },
    );
    expect(res.status).not.toBe(403);
    // GCS_EVIDENCE_BUCKET unset → 503 (would be 302 in prod).
    expect(res.status).toBe(503);
  });

  it("OWNER GET /api/evidence/[id]/download for CREDENTIAL → not 403 (happy path)", async () => {
    const { practice, ownerUser } = await seed("OWNER");
    const ownerPu = await db.practiceUser.findFirstOrThrow({
      where: { userId: ownerUser.id, practiceId: practice.id },
    });
    const { evidenceId } = await seedEvidence({
      practiceId: practice.id,
      uploadedById: ownerPu.id,
      entityType: "CREDENTIAL",
    });

    const { GET } = await import(
      "@/app/api/evidence/[id]/download/route"
    );
    const res = await GET(
      new Request(`http://test.test/api/evidence/${evidenceId}/download`),
      { params: Promise.resolve({ id: evidenceId }) },
    );
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503);
  });

  // ────────────────────────────────────────────────────────────────────
  // Cross-tenant: existing tenancy guard still applies (sanity check)
  // ────────────────────────────────────────────────────────────────────

  it("STAFF GET /api/evidence/[id]/download for cross-tenant CREDENTIAL → 404 (not 403)", async () => {
    // The role gate only fires when the evidence row belongs to the
    // viewer's practice. A different-practice id should trip the
    // pre-existing 'Evidence not found' guard, not return 403.
    await seed("STAFF");
    // Seed a separate practice + evidence on it.
    const otherUser = await db.user.create({
      data: {
        firebaseUid: `other-${Math.random().toString(36).slice(2, 10)}`,
        email: `other-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const otherPractice = await db.practice.create({
      data: { name: "Other Practice", primaryState: "TX" },
    });
    const otherPu = await db.practiceUser.create({
      data: { userId: otherUser.id, practiceId: otherPractice.id, role: "OWNER" },
    });
    const { evidenceId } = await seedEvidence({
      practiceId: otherPractice.id,
      uploadedById: otherPu.id,
      entityType: "CREDENTIAL",
    });

    const { GET } = await import(
      "@/app/api/evidence/[id]/download/route"
    );
    const res = await GET(
      new Request(`http://test.test/api/evidence/${evidenceId}/download`),
      { params: Promise.resolve({ id: evidenceId }) },
    );
    expect(res.status).toBe(404);
  });
});
