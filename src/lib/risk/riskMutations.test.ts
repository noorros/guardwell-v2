// @vitest-environment node
//
// src/lib/risk/riskMutations.test.ts
//
// Phase 5 PR 5 — coverage for the lib-helper layer that backs the
// /programs/risk/items/[id] server actions. Real DB. Each test seeds
// its own User + Practice + RiskItem; afterEach (in tests/setup.ts)
// cleans cleanup.
//
// Cases:
//   1. updateRiskItem stamps notes on the happy path
//   2. updateRiskItem cross-tenant throws "Cross-tenant access denied"
//   3. updateRiskItem status MITIGATED stamps resolvedAt + resolvedByUserId
//   4. updateRiskItem status OPEN clears resolvedAt + resolvedByUserId
//   5. createManualRiskItem creates a row with a synthetic MANUAL_*
//      sourceCode and returns its id
//   6. (regression) Two consecutive createManualRiskItem calls do NOT
//      collide on the @@unique([practiceId, source, sourceCode, sourceRefId]) constraint

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { updateRiskItem, createManualRiskItem } from "./riskMutations";

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedRiskItem(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: rid("rm-uid"),
      email: `${rid("rm")}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `RiskMutations Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const riskItem = await db.riskItem.create({
    data: {
      practiceId: practice.id,
      source: "SRA",
      sourceCode: `SRA_TEST_${label}`,
      sourceRefId: rid("ref"),
      category: "ADMINISTRATIVE",
      severity: "MEDIUM",
      title: `Test risk ${label}`,
      description: "Seeded risk for mutation tests",
      status: "OPEN",
    },
  });
  return { user, practice, riskItem };
}

describe("updateRiskItem", () => {
  it("stamps notes on the happy path", async () => {
    const { user, practice, riskItem } = await seedRiskItem("notes-happy");

    await updateRiskItem(
      riskItem.id,
      practice.id,
      { notes: "accepted because controls offset the risk" },
      user.id,
    );

    const after = await db.riskItem.findUnique({ where: { id: riskItem.id } });
    expect(after?.notes).toBe("accepted because controls offset the risk");
    expect(after?.status).toBe("OPEN");
    expect(after?.resolvedAt).toBeNull();
  });

  it("throws 'Cross-tenant access denied' when practiceId mismatches", async () => {
    const a = await seedRiskItem("cross-a");
    const b = await seedRiskItem("cross-b");

    await expect(
      updateRiskItem(
        b.riskItem.id,
        a.practice.id,
        { notes: "hostile patch" },
        a.user.id,
      ),
    ).rejects.toThrow(/Cross-tenant access denied/);

    const after = await db.riskItem.findUnique({
      where: { id: b.riskItem.id },
    });
    expect(after?.notes).toBeNull();
  });

  it("stamps resolvedAt + resolvedByUserId when status flips to MITIGATED", async () => {
    const { user, practice, riskItem } = await seedRiskItem("mitigate");

    await updateRiskItem(
      riskItem.id,
      practice.id,
      { status: "MITIGATED" },
      user.id,
    );

    const after = await db.riskItem.findUnique({ where: { id: riskItem.id } });
    expect(after?.status).toBe("MITIGATED");
    expect(after?.resolvedAt).toBeInstanceOf(Date);
    expect(after?.resolvedByUserId).toBe(user.id);
  });

  it("clears resolvedAt + resolvedByUserId when status flips back to OPEN", async () => {
    const { user, practice, riskItem } = await seedRiskItem("reopen");

    // First mitigate, then reopen.
    await updateRiskItem(
      riskItem.id,
      practice.id,
      { status: "MITIGATED" },
      user.id,
    );
    await updateRiskItem(
      riskItem.id,
      practice.id,
      { status: "OPEN" },
      user.id,
    );

    const after = await db.riskItem.findUnique({ where: { id: riskItem.id } });
    expect(after?.status).toBe("OPEN");
    expect(after?.resolvedAt).toBeNull();
    expect(after?.resolvedByUserId).toBeNull();
  });
});

describe("createManualRiskItem", () => {
  it("creates a row with a synthetic MANUAL_* sourceCode and returns its id", async () => {
    const { practice } = await seedRiskItem("manual-create");

    const result = await createManualRiskItem(practice.id, {
      category: "ADMINISTRATIVE",
      severity: "HIGH",
      title: "Annual SRA overdue",
      description: "Last SRA was completed >12 months ago",
      notes: "follow up next quarter",
    });

    expect(result.id).toBeTruthy();

    const row = await db.riskItem.findUnique({ where: { id: result.id } });
    expect(row?.source).toBe("MANUAL");
    expect(row?.sourceCode).toMatch(/^MANUAL_\d+_[a-z0-9]+$/);
    expect(row?.sourceRefId).toBeNull();
    expect(row?.title).toBe("Annual SRA overdue");
    expect(row?.severity).toBe("HIGH");
    expect(row?.category).toBe("ADMINISTRATIVE");
    expect(row?.notes).toBe("follow up next quarter");
    expect(row?.status).toBe("OPEN");
  });

  it("two consecutive createManualRiskItem calls do not collide on the unique index", async () => {
    const { practice } = await seedRiskItem("manual-dup");

    const a = await createManualRiskItem(practice.id, {
      category: "TECHNICAL",
      severity: "MEDIUM",
      title: "Same title",
      description: "Same description",
    });
    const b = await createManualRiskItem(practice.id, {
      category: "TECHNICAL",
      severity: "MEDIUM",
      title: "Same title",
      description: "Same description",
    });

    expect(a.id).not.toBe(b.id);
    const rowA = await db.riskItem.findUnique({ where: { id: a.id } });
    const rowB = await db.riskItem.findUnique({ where: { id: b.id } });
    expect(rowA?.sourceCode).not.toBe(rowB?.sourceCode);
  });
});
