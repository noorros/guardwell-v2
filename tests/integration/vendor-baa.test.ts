// tests/integration/vendor-baa.test.ts
//
// End-to-end: emit VENDOR_UPSERTED / VENDOR_BAA_EXECUTED / VENDOR_REMOVED
// and assert the derivation engine flips HIPAA_BAAS based on the
// "100% of active PHI vendors have a non-expired BAA" rule.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectVendorUpserted,
  projectVendorBaaExecuted,
  projectVendorRemoved,
} from "@/lib/events/projections/vendor";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPracticeWithHipaa() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const framework = await db.regulatoryFramework.findUniqueOrThrow({
    where: { code: "HIPAA" },
    include: { requirements: true },
  });
  const baaReq = framework.requirements.find((r) => r.code === "HIPAA_BAAS");
  if (!baaReq) {
    throw new Error("HIPAA_BAAS requirement missing — run `npm run db:seed:hipaa`.");
  }
  return { user, practice, baaReq };
}

async function upsert({
  practiceId,
  userId,
  vendorId,
  name,
  processesPhi,
}: {
  practiceId: string;
  userId: string;
  vendorId: string;
  name: string;
  processesPhi: boolean;
}) {
  const payload = { vendorId, name, processesPhi };
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "VENDOR_UPSERTED",
      payload,
    },
    async (tx) => projectVendorUpserted(tx, { practiceId, payload }),
  );
}

async function signBaa({
  practiceId,
  userId,
  vendorId,
  executedAt,
  expiresAt,
}: {
  practiceId: string;
  userId: string;
  vendorId: string;
  executedAt: Date;
  expiresAt?: Date | null;
}) {
  const payload = {
    vendorId,
    executedAt: executedAt.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "VENDOR_BAA_EXECUTED",
      payload,
    },
    async (tx) => projectVendorBaaExecuted(tx, { practiceId, payload }),
  );
}

async function remove({
  practiceId,
  userId,
  vendorId,
}: {
  practiceId: string;
  userId: string;
  vendorId: string;
}) {
  const payload = { vendorId };
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "VENDOR_REMOVED",
      payload,
    },
    async (tx) => projectVendorRemoved(tx, { practiceId, payload }),
  );
}

async function statusOf(practiceId: string, requirementId: string) {
  const ci = await db.complianceItem.findUnique({
    where: { practiceId_requirementId: { practiceId, requirementId } },
  });
  return ci?.status ?? "NOT_STARTED";
}

describe("Vendor events → HIPAA_BAAS derivation", () => {
  it("adding a PHI vendor with no BAA sets the requirement to GAP", async () => {
    const { user, practice, baaReq } = await seedPracticeWithHipaa();
    expect(await statusOf(practice.id, baaReq.id)).toBe("NOT_STARTED");

    await upsert({
      practiceId: practice.id,
      userId: user.id,
      vendorId: randomUUID(),
      name: "Athena EHR",
      processesPhi: true,
    });

    expect(await statusOf(practice.id, baaReq.id)).toBe("GAP");
  });

  it("all PHI vendors have perpetual BAAs → COMPLIANT", async () => {
    const { user, practice, baaReq } = await seedPracticeWithHipaa();
    const v1 = randomUUID();
    const v2 = randomUUID();

    await upsert({ practiceId: practice.id, userId: user.id, vendorId: v1, name: "EHR Co", processesPhi: true });
    await upsert({ practiceId: practice.id, userId: user.id, vendorId: v2, name: "Clearinghouse", processesPhi: true });
    await signBaa({ practiceId: practice.id, userId: user.id, vendorId: v1, executedAt: new Date() });
    await signBaa({ practiceId: practice.id, userId: user.id, vendorId: v2, executedAt: new Date() });

    expect(await statusOf(practice.id, baaReq.id)).toBe("COMPLIANT");
  });

  it("one PHI vendor is missing a BAA → GAP", async () => {
    const { user, practice, baaReq } = await seedPracticeWithHipaa();
    const v1 = randomUUID();
    const v2 = randomUUID();

    await upsert({ practiceId: practice.id, userId: user.id, vendorId: v1, name: "EHR Co", processesPhi: true });
    await upsert({ practiceId: practice.id, userId: user.id, vendorId: v2, name: "Billing", processesPhi: true });
    await signBaa({ practiceId: practice.id, userId: user.id, vendorId: v1, executedAt: new Date() });

    expect(await statusOf(practice.id, baaReq.id)).toBe("GAP");
  });

  it("non-PHI vendors are ignored by the rule", async () => {
    const { user, practice, baaReq } = await seedPracticeWithHipaa();
    const phi = randomUUID();
    const nonPhi = randomUUID();

    await upsert({ practiceId: practice.id, userId: user.id, vendorId: phi, name: "EHR Co", processesPhi: true });
    await upsert({ practiceId: practice.id, userId: user.id, vendorId: nonPhi, name: "Office Supplies", processesPhi: false });
    await signBaa({ practiceId: practice.id, userId: user.id, vendorId: phi, executedAt: new Date() });
    // Non-PHI vendor has no BAA — doesn't matter.

    expect(await statusOf(practice.id, baaReq.id)).toBe("COMPLIANT");
  });

  it("expired BAA → GAP, then re-executing with future expiry → COMPLIANT", async () => {
    const { user, practice, baaReq } = await seedPracticeWithHipaa();
    const v = randomUUID();

    await upsert({ practiceId: practice.id, userId: user.id, vendorId: v, name: "EHR Co", processesPhi: true });
    // BAA signed last year, expired yesterday.
    await signBaa({
      practiceId: practice.id,
      userId: user.id,
      vendorId: v,
      executedAt: new Date(Date.now() - 366 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    expect(await statusOf(practice.id, baaReq.id)).toBe("GAP");

    // Re-execute with a future expiry.
    await signBaa({
      practiceId: practice.id,
      userId: user.id,
      vendorId: v,
      executedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * DAY_MS),
    });
    expect(await statusOf(practice.id, baaReq.id)).toBe("COMPLIANT");
  });

  it("removing the last uncovered PHI vendor → COMPLIANT", async () => {
    const { user, practice, baaReq } = await seedPracticeWithHipaa();
    const v1 = randomUUID();
    const v2 = randomUUID();

    await upsert({ practiceId: practice.id, userId: user.id, vendorId: v1, name: "EHR Co", processesPhi: true });
    await upsert({ practiceId: practice.id, userId: user.id, vendorId: v2, name: "Uncovered Vendor", processesPhi: true });
    await signBaa({ practiceId: practice.id, userId: user.id, vendorId: v1, executedAt: new Date() });
    expect(await statusOf(practice.id, baaReq.id)).toBe("GAP");

    await remove({ practiceId: practice.id, userId: user.id, vendorId: v2 });
    expect(await statusOf(practice.id, baaReq.id)).toBe("COMPLIANT");
  });
});
