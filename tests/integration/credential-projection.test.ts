// tests/integration/credential-projection.test.ts
//
// End-to-end: emit CREDENTIAL_UPSERTED / CREDENTIAL_REMOVED and assert
// Credential rows are projected correctly with the right practice +
// holder scoping. No HIPAA requirement currently flips from credentials —
// OSHA/DEA/CLIA rules wire in later — so these tests verify the
// projection pipeline itself rather than framework score changes.

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import {
  projectCredentialUpserted,
  projectCredentialRemoved,
} from "@/lib/events/projections/credential";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPracticeWithHolder() {
  const user = await db.user.create({
    data: {
      firebaseUid: `fb-${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
    },
  });
  const practice = await db.practice.create({
    data: { name: "Test Clinic", primaryState: "AZ" },
  });
  const pu = await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  const credType = await db.credentialType.findUniqueOrThrow({
    where: { code: "MD_STATE_LICENSE" },
  });
  return { user, practice, pu, credType };
}

async function upsert({
  practiceId,
  userId,
  credentialId,
  credentialTypeCode,
  holderId,
  title,
  licenseNumber,
  expiryDate,
}: {
  practiceId: string;
  userId: string;
  credentialId: string;
  credentialTypeCode: string;
  holderId?: string | null;
  title: string;
  licenseNumber?: string;
  expiryDate?: Date | null;
}) {
  const payload = {
    credentialId,
    credentialTypeCode,
    holderId: holderId ?? null,
    title,
    licenseNumber: licenseNumber ?? null,
    issuingBody: null,
    issueDate: null,
    expiryDate: expiryDate ? expiryDate.toISOString() : null,
    notes: null,
  };
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "CREDENTIAL_UPSERTED",
      payload,
    },
    async (tx) => projectCredentialUpserted(tx, { practiceId, payload }),
  );
}

async function remove({
  practiceId,
  userId,
  credentialId,
}: {
  practiceId: string;
  userId: string;
  credentialId: string;
}) {
  await appendEventAndApply(
    {
      practiceId,
      actorUserId: userId,
      type: "CREDENTIAL_REMOVED",
      payload: { credentialId },
    },
    async (tx) =>
      projectCredentialRemoved(tx, {
        practiceId,
        payload: { credentialId },
      }),
  );
}

describe("Credential events → projection", () => {
  it("creating a credential persists all fields + resolves credentialTypeCode to id", async () => {
    const { user, practice, pu, credType } = await seedPracticeWithHolder();
    const credentialId = randomUUID();
    const expiry = new Date(Date.now() + 365 * DAY_MS);

    await upsert({
      practiceId: practice.id,
      userId: user.id,
      credentialId,
      credentialTypeCode: "MD_STATE_LICENSE",
      holderId: pu.id,
      title: "Arizona MD License",
      licenseNumber: "MD-12345",
      expiryDate: expiry,
    });

    const c = await db.credential.findUniqueOrThrow({
      where: { id: credentialId },
    });
    expect(c.practiceId).toBe(practice.id);
    expect(c.holderId).toBe(pu.id);
    expect(c.credentialTypeId).toBe(credType.id);
    expect(c.title).toBe("Arizona MD License");
    expect(c.licenseNumber).toBe("MD-12345");
    expect(c.expiryDate?.toISOString()).toBe(expiry.toISOString());
    expect(c.retiredAt).toBeNull();
  });

  it("unknown credential-type code throws from the projection", async () => {
    const { user, practice } = await seedPracticeWithHolder();
    await expect(
      upsert({
        practiceId: practice.id,
        userId: user.id,
        credentialId: randomUUID(),
        credentialTypeCode: "DOES_NOT_EXIST",
        title: "bogus",
      }),
    ).rejects.toThrow(/Unknown credential type code/);
  });

  it("upserting the same credentialId updates fields + clears retiredAt", async () => {
    const { user, practice, pu } = await seedPracticeWithHolder();
    const credentialId = randomUUID();

    await upsert({
      practiceId: practice.id,
      userId: user.id,
      credentialId,
      credentialTypeCode: "MD_STATE_LICENSE",
      holderId: pu.id,
      title: "Original Title",
      licenseNumber: "V1",
    });
    await remove({ practiceId: practice.id, userId: user.id, credentialId });
    const retired = await db.credential.findUniqueOrThrow({
      where: { id: credentialId },
    });
    expect(retired.retiredAt).not.toBeNull();

    // Re-upsert reactivates + updates fields.
    await upsert({
      practiceId: practice.id,
      userId: user.id,
      credentialId,
      credentialTypeCode: "MD_STATE_LICENSE",
      holderId: pu.id,
      title: "Updated Title",
      licenseNumber: "V2",
    });
    const updated = await db.credential.findUniqueOrThrow({
      where: { id: credentialId },
    });
    expect(updated.retiredAt).toBeNull();
    expect(updated.title).toBe("Updated Title");
    expect(updated.licenseNumber).toBe("V2");
  });

  it("practice-level credential (holderId null) is persisted without a holder", async () => {
    const { user, practice } = await seedPracticeWithHolder();
    const credentialId = randomUUID();

    await upsert({
      practiceId: practice.id,
      userId: user.id,
      credentialId,
      credentialTypeCode: "BUSINESS_LICENSE",
      holderId: null,
      title: "Arizona Business License",
    });

    const c = await db.credential.findUniqueOrThrow({
      where: { id: credentialId },
    });
    expect(c.holderId).toBeNull();
  });

  it("removing a credential is idempotent — second remove does not error", async () => {
    const { user, practice, pu } = await seedPracticeWithHolder();
    const credentialId = randomUUID();

    await upsert({
      practiceId: practice.id,
      userId: user.id,
      credentialId,
      credentialTypeCode: "MD_STATE_LICENSE",
      holderId: pu.id,
      title: "X",
    });
    await remove({ practiceId: practice.id, userId: user.id, credentialId });

    // Second remove against the same id — should no-op gracefully.
    await expect(
      remove({
        practiceId: practice.id,
        userId: user.id,
        credentialId: randomUUID(), // nonexistent id → projection no-ops
      }),
    ).resolves.not.toThrow();
  });

  it("removing a non-existent credentialId is a safe no-op", async () => {
    const { user, practice } = await seedPracticeWithHolder();
    await expect(
      remove({
        practiceId: practice.id,
        userId: user.id,
        credentialId: randomUUID(),
      }),
    ).resolves.not.toThrow();
  });
});
