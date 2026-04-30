// tests/integration/credentials-removed-staff-orphan.test.ts
//
// Audit #21 / Credentials CR-4: when an operator off-boards a staff
// member (sets `PracticeUser.removedAt`), credentials assigned to that
// holder used to silently disappear from `/programs/credentials` —
// even though the rows stayed on the books and were still counted by
// framework derivation, audit PDFs, and CSV exports. The fix:
//
//   1. The page now queries holders without a `removedAt: null` filter
//      so removed users are still included when grouping credentials.
//   2. `buildCredentialGroups` puts active holders first, former staff
//      next under a "Former staff: <name>" heading, and practice-level
//      credentials last.
//
// This test exercises the same Prisma queries the page runs, then
// pipes them through the grouping helper, asserting that orphaned
// credentials remain visible.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import {
  buildCredentialGroups,
  type HolderForGrouping,
} from "@/app/(dashboard)/programs/credentials/grouping";

async function seedPractice() {
  const practice = await db.practice.create({
    data: { name: "CR-4 Practice", primaryState: "AZ" },
  });
  return practice;
}

async function seedPracticeUser({
  practiceId,
  email,
  firstName,
  lastName,
  role = "STAFF",
  removedAt = null,
}: {
  practiceId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role?: "OWNER" | "ADMIN" | "STAFF" | "VIEWER";
  removedAt?: Date | null;
}) {
  const user = await db.user.create({
    data: {
      firebaseUid: `cr4-${Math.random().toString(36).slice(2, 10)}`,
      email,
      firstName,
      lastName,
    },
  });
  return db.practiceUser.create({
    data: { userId: user.id, practiceId, role, removedAt },
  });
}

async function seedCredentialType(code: string) {
  return db.credentialType.upsert({
    where: { code },
    update: {},
    create: {
      code,
      name: `Type ${code}`,
      category: "CLINICAL_LICENSE",
    },
  });
}

async function seedCredential({
  practiceId,
  holderId,
  credentialTypeId,
  title,
}: {
  practiceId: string;
  holderId: string | null;
  credentialTypeId: string;
  title: string;
}) {
  return db.credential.create({
    data: {
      practiceId,
      holderId,
      credentialTypeId,
      title,
    },
  });
}

// Mirror of the queries `CredentialsPage` issues. Kept narrow and
// honest — if the page ever drifts, this test should drift with it.
async function loadGroupsForPractice(practiceId: string) {
  const [holders, credentials] = await Promise.all([
    db.practiceUser.findMany({
      where: { practiceId },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    }),
    db.credential.findMany({
      where: { practiceId, retiredAt: null },
      orderBy: [{ holderId: "asc" }, { expiryDate: "asc" }],
      include: {
        credentialType: { select: { code: true, name: true, category: true } },
      },
    }),
  ]);

  const holdersForGrouping: HolderForGrouping[] = holders.map((h) => {
    const full = [h.user.firstName, h.user.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return {
      id: h.id,
      displayName: full || h.user.email,
      removedAt: h.removedAt,
    };
  });

  return buildCredentialGroups(holdersForGrouping, credentials);
}

describe("Credentials page — removed-staff orphan (audit #21 CR-4)", () => {
  it("renders a credential whose holder PracticeUser has removedAt set, under a 'Former staff' group", async () => {
    const practice = await seedPractice();
    const owner = await seedPracticeUser({
      practiceId: practice.id,
      email: "owner@cr4.test",
      firstName: "Olive",
      lastName: "Owner",
      role: "OWNER",
    });
    const removed = await seedPracticeUser({
      practiceId: practice.id,
      email: "former@cr4.test",
      firstName: "Frank",
      lastName: "Former",
      role: "STAFF",
      removedAt: new Date("2026-04-15T12:00:00Z"),
    });

    const credType = await seedCredentialType("CR4_TYPE_DEA");
    const ownerCred = await seedCredential({
      practiceId: practice.id,
      holderId: owner.id,
      credentialTypeId: credType.id,
      title: "Olive's DEA Registration",
    });
    const orphanCred = await seedCredential({
      practiceId: practice.id,
      holderId: removed.id,
      credentialTypeId: credType.id,
      title: "Frank's DEA Registration",
    });

    const groups = await loadGroupsForPractice(practice.id);

    // Both credentials must be visible.
    const allCredIds = groups.flatMap((g) => g.credentials.map((c) => c.id));
    expect(allCredIds).toContain(ownerCred.id);
    expect(allCredIds).toContain(orphanCred.id);

    // Owner first, former staff second; former heading carries the name.
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      heading: "Olive Owner",
      isFormerStaff: false,
      isPracticeLevel: false,
    });
    expect(groups[1]).toMatchObject({
      heading: "Former staff: Frank Former",
      isFormerStaff: true,
      isPracticeLevel: false,
    });
    expect(groups[1]!.credentials.map((c) => c.id)).toEqual([orphanCred.id]);
  });

  it("renders practice-level credentials (holderId === null) under a 'Practice-level' group", async () => {
    const practice = await seedPractice();
    await seedPracticeUser({
      practiceId: practice.id,
      email: "owner2@cr4.test",
      firstName: "Olive",
      lastName: "Owner",
      role: "OWNER",
    });

    const credType = await seedCredentialType("CR4_TYPE_CLIA");
    const practiceLevelCred = await seedCredential({
      practiceId: practice.id,
      holderId: null,
      credentialTypeId: credType.id,
      title: "CLIA Waiver Certificate",
    });

    const groups = await loadGroupsForPractice(practice.id);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      heading: "Practice-level",
      isPracticeLevel: true,
      isFormerStaff: false,
    });
    expect(groups[0]!.credentials.map((c) => c.id)).toEqual([
      practiceLevelCred.id,
    ]);
  });

  it("renders an empty group list when no credentials exist (empty-state still works)", async () => {
    const practice = await seedPractice();
    await seedPracticeUser({
      practiceId: practice.id,
      email: "owner3@cr4.test",
      firstName: "Olive",
      lastName: "Owner",
      role: "OWNER",
    });

    const groups = await loadGroupsForPractice(practice.id);
    expect(groups).toEqual([]);
  });

  it("orders active staff, former staff, and practice-level in that sequence", async () => {
    const practice = await seedPractice();
    const owner = await seedPracticeUser({
      practiceId: practice.id,
      email: "owner4@cr4.test",
      firstName: "Olive",
      lastName: "Owner",
      role: "OWNER",
    });
    const removed = await seedPracticeUser({
      practiceId: practice.id,
      email: "former4@cr4.test",
      firstName: "Frank",
      lastName: "Former",
      role: "STAFF",
      removedAt: new Date("2026-04-15T12:00:00Z"),
    });
    const credType = await seedCredentialType("CR4_TYPE_ORDER");
    await seedCredential({
      practiceId: practice.id,
      holderId: owner.id,
      credentialTypeId: credType.id,
      title: "Owner cred",
    });
    await seedCredential({
      practiceId: practice.id,
      holderId: removed.id,
      credentialTypeId: credType.id,
      title: "Orphan cred",
    });
    await seedCredential({
      practiceId: practice.id,
      holderId: null,
      credentialTypeId: credType.id,
      title: "Practice cred",
    });

    const groups = await loadGroupsForPractice(practice.id);
    expect(groups.map((g) => g.heading)).toEqual([
      "Olive Owner",
      "Former staff: Frank Former",
      "Practice-level",
    ]);
  });
});
