// tests/integration/credential-bulk-import.test.ts
//
// Audit #21 (2026-04-30) PR-B2: bulk-import correctness. Three closely
// related fixes:
//
//   - CR-5: malformed dates no longer crash the entire batch — Zod refine
//     + per-row try/catch report INVALID for the bad row, batch continues.
//   - IM-4: dedup key now includes holderEmail so two staff with the
//     same title (e.g. "BLS card") aren't false-positive collisions.
//   - IM-5: re-uploading the same CSV is idempotent — lookup by
//     (practiceId, credentialTypeId, holderId, licenseNumber) yields
//     ALREADY_EXISTS / UPDATED / INSERTED appropriately.
//
// Each test seeds a fresh practice + OWNER user, mocks the auth cookie
// path, then exercises bulkImportCredentialsAction directly.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import type { CredentialType, Practice, User } from "@prisma/client";

declare global {
  var __bulkImportTestUser:
    | { id: string; email: string; firebaseUid: string }
    | null;
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<object>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => {
      if (!globalThis.__bulkImportTestUser) return null;
      return db.user.findUnique({
        where: { id: globalThis.__bulkImportTestUser.id },
      });
    },
    requireUser: async () => {
      if (!globalThis.__bulkImportTestUser) throw new Error("Unauthorized");
      return db.user.findUniqueOrThrow({
        where: { id: globalThis.__bulkImportTestUser.id },
      });
    },
  };
});

// The action calls revalidatePath at the end — no-op it so the test
// runner doesn't need a Next.js request context.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

// getPracticeUser reads the selected-practice cookie. We don't set the
// cookie in tests; the fallback-to-oldest-membership branch handles us.
vi.mock("@/lib/practice-cookie", () => ({
  getSelectedPracticeId: async () => null,
}));

beforeEach(() => {
  globalThis.__bulkImportTestUser = null;
});

// The shared `tests/setup.ts` afterEach doesn't include
// `db.credential.deleteMany()` and the local Postgres has a stale
// RESTRICT constraint on `Credential.holderId → PracticeUser` (the
// schema declares SetNull but the live DB picks that up at deploy via
// cloudbuild's prisma db push step). Without this hook, every bulk-
// import test that resolves a holderEmail leaks rows that block the
// global PracticeUser cleanup. Run BEFORE the global hook (vitest runs
// file-local afterEach before the setup-file afterEach).
afterEach(async () => {
  await db.credential.deleteMany();
});

async function seedOwner(): Promise<{
  user: User;
  practice: Practice;
  credType: CredentialType;
}> {
  const tag = Math.random().toString(36).slice(2, 10);
  const user = await db.user.create({
    data: {
      firebaseUid: `bi-${tag}`,
      email: `bi-owner-${tag}@test.test`,
    },
  });
  const practice = await db.practice.create({
    data: { name: `Bulk Import ${tag}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const credType = await db.credentialType.upsert({
    where: { code: "BI_TEST_BLS" },
    update: {},
    create: {
      code: "BI_TEST_BLS",
      name: "BLS Certification",
      category: "CLINICAL_LICENSE",
    },
  });
  globalThis.__bulkImportTestUser = {
    id: user.id,
    email: user.email!,
    firebaseUid: user.firebaseUid,
  };
  return { user, practice, credType };
}

async function seedStaffUser(
  practiceId: string,
  emailLocalPart: string,
): Promise<string> {
  const tag = Math.random().toString(36).slice(2, 8);
  const u = await db.user.create({
    data: {
      firebaseUid: `staff-${tag}`,
      email: `${emailLocalPart}-${tag}@test.test`,
    },
  });
  await db.practiceUser.create({
    data: { userId: u.id, practiceId, role: "STAFF" },
  });
  return u.email!;
}

describe("bulkImportCredentialsAction (audit #21 PR-B2)", () => {
  // ─── CR-5 ───────────────────────────────────────────────────────────────
  it("CR-5: malformed date doesn't crash the batch — other rows succeed", async () => {
    const { practice } = await seedOwner();
    const goodEmail1 = await seedStaffUser(practice.id, "good-a");
    const goodEmail2 = await seedStaffUser(practice.id, "good-b");
    const { bulkImportCredentialsAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );

    const result = await bulkImportCredentialsAction({
      rows: [
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: goodEmail1,
          title: "BLS — Good Row One",
          licenseNumber: "GOOD-1",
          issueDate: "2026-01-15",
        },
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: goodEmail2,
          title: "BLS — Bad Date Row",
          licenseNumber: "BAD-DATE",
          issueDate: "garbage",
        },
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: null,
          title: "BLS — Good Row Two (practice-level)",
          licenseNumber: "GOOD-2",
          issueDate: "2026-02-15",
        },
      ],
    });

    expect(result.insertedCount).toBe(2);
    expect(result.perRowResults).toHaveLength(3);
    expect(result.perRowResults[0]?.status).toBe("INSERTED");
    expect(result.perRowResults[1]?.status).toBe("INVALID");
    expect(result.perRowResults[1]?.reason).toMatch(/date/i);
    expect(result.perRowResults[2]?.status).toBe("INSERTED");

    // Both good rows actually persisted.
    const persisted = await db.credential.findMany({
      where: { practiceId: practice.id, retiredAt: null },
      orderBy: { licenseNumber: "asc" },
    });
    expect(persisted).toHaveLength(2);
    expect(persisted.map((c) => c.licenseNumber)).toEqual(["GOOD-1", "GOOD-2"]);
  });

  // ─── IM-4 ───────────────────────────────────────────────────────────────
  it("IM-4: two staff with same title + no license → both succeed", async () => {
    const { practice } = await seedOwner();
    const aliceEmail = await seedStaffUser(practice.id, "alice");
    const bobEmail = await seedStaffUser(practice.id, "bob");
    const { bulkImportCredentialsAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );

    const result = await bulkImportCredentialsAction({
      rows: [
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: aliceEmail,
          title: "BLS card",
          licenseNumber: null,
        },
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: bobEmail,
          title: "BLS card",
          licenseNumber: null,
        },
      ],
    });

    expect(result.insertedCount).toBe(2);
    const dupes = result.perRowResults.filter(
      (r) => r.status === "DUPLICATE_IN_BATCH",
    );
    expect(dupes).toHaveLength(0);

    const persisted = await db.credential.findMany({
      where: { practiceId: practice.id, retiredAt: null },
    });
    expect(persisted).toHaveLength(2);
    const holderIds = new Set(persisted.map((c) => c.holderId));
    expect(holderIds.size).toBe(2); // distinct holders
  });

  it("IM-4 negative: same staff + same title + no license → second is DUPLICATE_IN_BATCH", async () => {
    const { practice } = await seedOwner();
    const aliceEmail = await seedStaffUser(practice.id, "alice");
    const { bulkImportCredentialsAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );

    const result = await bulkImportCredentialsAction({
      rows: [
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: aliceEmail,
          title: "BLS card",
          licenseNumber: null,
        },
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: aliceEmail,
          title: "BLS card",
          licenseNumber: null,
        },
      ],
    });

    expect(result.insertedCount).toBe(1);
    expect(result.perRowResults[0]?.status).toBe("INSERTED");
    expect(result.perRowResults[1]?.status).toBe("DUPLICATE_IN_BATCH");
  });

  // ─── IM-5 ───────────────────────────────────────────────────────────────
  it("IM-5: re-uploading the identical CSV emits ALREADY_EXISTS, no duplicates", async () => {
    const { practice } = await seedOwner();
    const aliceEmail = await seedStaffUser(practice.id, "alice");
    const { bulkImportCredentialsAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );

    const rows = [
      {
        credentialTypeCode: "BI_TEST_BLS",
        holderEmail: aliceEmail,
        title: "Alice — BLS",
        licenseNumber: "ALICE-BLS-1",
        issueDate: "2026-03-01",
        expiryDate: "2028-03-01",
      },
      {
        credentialTypeCode: "BI_TEST_BLS",
        holderEmail: null,
        title: "Office BLS Manikin Cert",
        licenseNumber: null,
        issueDate: "2026-04-01",
      },
    ];

    const first = await bulkImportCredentialsAction({ rows });
    expect(first.insertedCount).toBe(2);
    expect(first.updatedCount).toBe(0);
    const afterFirst = await db.credential.findMany({
      where: { practiceId: practice.id, retiredAt: null },
    });
    expect(afterFirst).toHaveLength(2);

    const second = await bulkImportCredentialsAction({ rows });
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(0);
    expect(second.perRowResults.every((r) => r.status === "ALREADY_EXISTS")).toBe(
      true,
    );

    // No duplicates: row count unchanged.
    const afterSecond = await db.credential.findMany({
      where: { practiceId: practice.id, retiredAt: null },
    });
    expect(afterSecond).toHaveLength(2);
    expect(new Set(afterSecond.map((c) => c.id))).toEqual(
      new Set(afterFirst.map((c) => c.id)),
    );
  });

  it("IM-5: re-upload with one changed field emits UPDATED + writes the new value", async () => {
    const { practice } = await seedOwner();
    const aliceEmail = await seedStaffUser(practice.id, "alice");
    const { bulkImportCredentialsAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );

    const baseRow = {
      credentialTypeCode: "BI_TEST_BLS",
      holderEmail: aliceEmail,
      title: "Alice — BLS",
      licenseNumber: "ALICE-BLS-RENEW",
      issueDate: "2026-03-01",
      expiryDate: "2028-03-01",
    };

    const first = await bulkImportCredentialsAction({ rows: [baseRow] });
    expect(first.insertedCount).toBe(1);

    const second = await bulkImportCredentialsAction({
      rows: [{ ...baseRow, expiryDate: "2030-03-01" }], // renewed
    });
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(1);
    expect(second.perRowResults[0]?.status).toBe("UPDATED");

    // Same row is updated in-place — only ONE credential exists, with
    // the new expiry.
    const persisted = await db.credential.findMany({
      where: { practiceId: practice.id, retiredAt: null },
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.expiryDate?.toISOString()).toContain("2030-03-01");
    expect(persisted[0]!.licenseNumber).toBe("ALICE-BLS-RENEW");
  });

  // ─── Mixed-batch combination ────────────────────────────────────────────
  it("mixed batch: new + duplicate + invalid + existing → each gets the correct status", async () => {
    const { practice } = await seedOwner();
    const aliceEmail = await seedStaffUser(practice.id, "alice");
    const bobEmail = await seedStaffUser(practice.id, "bob");
    const { bulkImportCredentialsAction } = await import(
      "@/app/(dashboard)/programs/credentials/actions"
    );

    // Pre-existing row: Alice already has BLS license PRE-1.
    await bulkImportCredentialsAction({
      rows: [
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: aliceEmail,
          title: "Alice — BLS",
          licenseNumber: "PRE-1",
          issueDate: "2026-01-01",
        },
      ],
    });

    const result = await bulkImportCredentialsAction({
      rows: [
        // 0: identical re-upload of Alice's existing → ALREADY_EXISTS
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: aliceEmail,
          title: "Alice — BLS",
          licenseNumber: "PRE-1",
          issueDate: "2026-01-01",
        },
        // 1: new insert for Bob
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: bobEmail,
          title: "Bob — BLS",
          licenseNumber: "NEW-1",
        },
        // 2: malformed date → INVALID, batch continues
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: bobEmail,
          title: "Bob — Bad Date",
          licenseNumber: "BAD-DATE",
          issueDate: "not-a-date",
        },
        // 3: in-batch duplicate of #1 (same holderEmail + license + type)
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: bobEmail,
          title: "Bob — BLS",
          licenseNumber: "NEW-1",
        },
        // 4: unknown type code → INVALID
        {
          credentialTypeCode: "UNKNOWN_TYPE_CODE",
          holderEmail: aliceEmail,
          title: "Bogus type",
        },
        // 5: re-upload of Alice with changed expiry → UPDATED
        {
          credentialTypeCode: "BI_TEST_BLS",
          holderEmail: aliceEmail,
          title: "Alice — BLS",
          licenseNumber: "PRE-1",
          issueDate: "2026-01-01",
          expiryDate: "2030-01-01",
        },
      ],
    });

    expect(result.perRowResults[0]?.status).toBe("ALREADY_EXISTS");
    expect(result.perRowResults[1]?.status).toBe("INSERTED");
    expect(result.perRowResults[2]?.status).toBe("INVALID");
    expect(result.perRowResults[3]?.status).toBe("DUPLICATE_IN_BATCH");
    expect(result.perRowResults[4]?.status).toBe("INVALID");
    // Row 5 conflicts with row 0's already-existed match → seenInBatch
    // suppresses it as DUPLICATE_IN_BATCH. (Same Alice + PRE-1 + BLS as
    // row 0.) The intra-batch dedup runs before the DB lookup, so the
    // final result is DUPLICATE_IN_BATCH not UPDATED. This is the
    // existing semantics — adding the row twice in one batch is a CSV
    // bug, not a renewal.
    expect(result.perRowResults[5]?.status).toBe("DUPLICATE_IN_BATCH");

    expect(result.insertedCount).toBe(1);
    expect(result.updatedCount).toBe(0);

    const persisted = await db.credential.findMany({
      where: { practiceId: practice.id, retiredAt: null },
    });
    // Alice's PRE-1 + Bob's NEW-1 = 2 distinct rows.
    expect(persisted).toHaveLength(2);
  });
});
