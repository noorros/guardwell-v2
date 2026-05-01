// tests/integration/risk-cap-lifecycle.test.ts
//
// Phase 5 PR 7 — RiskItem -> CAP lifecycle coverage at the lib-helper
// layer. Pins the master-plan decision that completing every linked CAP
// does NOT auto-mitigate the parent RiskItem; the user must explicitly
// flip status to MITIGATED. Also pins the riskMutations.updateRiskItem
// resolved-fields stamping behavior.
//
// No auth mocks needed — these helpers are called directly with
// (riskItemId, practiceId, ...) so the caller is responsible for the
// rbac gate. Both updateRiskItem and updateCapStatus do their own
// per-target practiceId guard, which is covered by the per-helper tests
// in src/lib/risk/*.test.ts.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { createCap, updateCapStatus } from "@/lib/risk/capMutations";
import { updateRiskItem } from "@/lib/risk/riskMutations";

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seed() {
  const user = await db.user.create({
    data: {
      firebaseUid: rid("rcl-uid"),
      email: `${rid("rcl")}@test.test`,
      firstName: "Owner",
      lastName: "Lifecycle",
    },
  });
  const practice = await db.practice.create({
    data: { name: `RiskCapLifecycle ${rid("p")}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  // MANUAL-source RiskItem keeps the seed independent of the SRA / TA
  // question fixtures. Mirrors createManualRiskItem's synthetic
  // sourceCode strategy so the @@unique guard doesn't bite.
  const sourceCode = `MANUAL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const riskItem = await db.riskItem.create({
    data: {
      practiceId: practice.id,
      source: "MANUAL",
      sourceCode,
      sourceRefId: null,
      category: "Operational",
      severity: "MEDIUM",
      title: "Manual lifecycle risk",
      description: "Seeded by risk-cap-lifecycle.test.ts",
    },
  });
  return { user, practice, riskItem };
}

describe("RiskItem -> CAP lifecycle", () => {
  it("RiskItem with 2 linked CAPs: complete both, then manually mitigate the risk", async () => {
    const { user, practice, riskItem } = await seed();

    // Create 2 CAPs linked to the risk item.
    const cap1 = await createCap(practice.id, {
      riskItemId: riskItem.id,
      description: "Action 1",
    });
    const cap2 = await createCap(practice.id, {
      riskItemId: riskItem.id,
      description: "Action 2",
    });

    // Both start PENDING.
    const initialCaps = await db.correctiveAction.findMany({
      where: { riskItemId: riskItem.id },
      orderBy: { createdAt: "asc" },
    });
    expect(initialCaps).toHaveLength(2);
    expect(initialCaps.every((c) => c.status === "PENDING")).toBe(true);

    // Complete both.
    await updateCapStatus(cap1.id, practice.id, "COMPLETED", user.id);
    await updateCapStatus(cap2.id, practice.id, "COMPLETED", user.id);

    // Risk item still OPEN — no auto-mitigate per master plan decision.
    // The product principle is that completing all linked CAPs is
    // necessary but not sufficient evidence; the user must affirm the
    // risk is mitigated.
    const beforeMitigate = await db.riskItem.findUnique({
      where: { id: riskItem.id },
    });
    expect(beforeMitigate?.status).toBe("OPEN");
    expect(beforeMitigate?.resolvedAt).toBeNull();
    expect(beforeMitigate?.resolvedByUserId).toBeNull();

    // Manually mitigate.
    await updateRiskItem(
      riskItem.id,
      practice.id,
      { status: "MITIGATED" },
      user.id,
    );

    // Verify resolved fields stamp.
    const afterMitigate = await db.riskItem.findUnique({
      where: { id: riskItem.id },
    });
    expect(afterMitigate?.status).toBe("MITIGATED");
    expect(afterMitigate?.resolvedAt).toBeInstanceOf(Date);
    expect(afterMitigate?.resolvedByUserId).toBe(user.id);

    // Both CAPs still COMPLETED — mitigating the parent doesn't roll
    // back the children.
    const finalCaps = await db.correctiveAction.findMany({
      where: { riskItemId: riskItem.id },
    });
    expect(finalCaps).toHaveLength(2);
    expect(finalCaps.every((c) => c.status === "COMPLETED")).toBe(true);
    expect(finalCaps.every((c) => c.completedAt instanceof Date)).toBe(true);
    expect(finalCaps.every((c) => c.completedByUserId === user.id)).toBe(true);
  });

  it("Reopening a MITIGATED risk clears resolvedAt + resolvedByUserId", async () => {
    const { user, practice, riskItem } = await seed();

    // Mitigate first.
    await updateRiskItem(
      riskItem.id,
      practice.id,
      { status: "MITIGATED" },
      user.id,
    );
    const mitigated = await db.riskItem.findUnique({
      where: { id: riskItem.id },
    });
    expect(mitigated?.status).toBe("MITIGATED");
    expect(mitigated?.resolvedAt).toBeInstanceOf(Date);
    expect(mitigated?.resolvedByUserId).toBe(user.id);

    // Reopen.
    await updateRiskItem(
      riskItem.id,
      practice.id,
      { status: "OPEN" },
      user.id,
    );
    const reopened = await db.riskItem.findUnique({
      where: { id: riskItem.id },
    });
    expect(reopened?.status).toBe("OPEN");
    // updateRiskItem nulls these specifically when status flips back to
    // OPEN — verifies the asymmetric branch in the helper.
    expect(reopened?.resolvedAt).toBeNull();
    expect(reopened?.resolvedByUserId).toBeNull();
  });

  it("Marking a risk ACCEPTED also stamps resolved fields (terminal-state symmetry)", async () => {
    // The updateRiskItem helper treats every non-OPEN status as
    // terminal — resolvedAt + resolvedByUserId are stamped for
    // MITIGATED, ACCEPTED, and TRANSFERRED. Lock that in so future
    // changes don't accidentally narrow it to MITIGATED only.
    const { user, practice, riskItem } = await seed();
    await updateRiskItem(
      riskItem.id,
      practice.id,
      { status: "ACCEPTED" },
      user.id,
    );
    const after = await db.riskItem.findUnique({
      where: { id: riskItem.id },
    });
    expect(after?.status).toBe("ACCEPTED");
    expect(after?.resolvedAt).toBeInstanceOf(Date);
    expect(after?.resolvedByUserId).toBe(user.id);
  });
});
