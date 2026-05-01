// src/lib/regulatory/practiceFrameworks.test.ts
//
// Phase 8 PR 1 — coverage for getActiveFrameworksForPractice.
// Real DB. Each test seeds its own User + Practice + framework rows.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { getActiveFrameworksForPractice } from "./practiceFrameworks";

async function ensureFramework(code: string, name: string) {
  return db.regulatoryFramework.upsert({
    where: { code },
    update: {},
    create: {
      code,
      name,
      description: `${code} test framework`,
      sortOrder: 0,
    },
  });
}

async function seed(label: string) {
  const user = await db.user.create({
    data: {
      firebaseUid: `pf-${Math.random().toString(36).slice(2, 10)}`,
      email: `pf-${Math.random().toString(36).slice(2, 8)}@test.test`,
      firstName: "Owner",
      lastName: label,
    },
  });
  const practice = await db.practice.create({
    data: { name: `PracticeFrameworks Test ${label}`, primaryState: "AZ" },
  });
  await db.practiceUser.create({
    data: { userId: user.id, practiceId: practice.id, role: "OWNER" },
  });
  return { user, practice };
}

describe("getActiveFrameworksForPractice", () => {
  it("returns the framework codes when HIPAA + OSHA are enabled", async () => {
    const hipaa = await ensureFramework("HIPAA", "HIPAA");
    const osha = await ensureFramework("OSHA", "OSHA");
    const { practice } = await seed("both-enabled");

    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: hipaa.id,
        enabled: true,
      },
    });
    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: osha.id,
        enabled: true,
      },
    });

    const codes = await getActiveFrameworksForPractice(practice.id);
    expect(codes).toHaveLength(2);
    expect(codes.sort()).toEqual(["HIPAA", "OSHA"]);
  });

  it("returns only HIPAA when OSHA is disabled", async () => {
    const hipaa = await ensureFramework("HIPAA", "HIPAA");
    const osha = await ensureFramework("OSHA", "OSHA");
    const { practice } = await seed("osha-disabled");

    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: hipaa.id,
        enabled: true,
      },
    });
    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: osha.id,
        enabled: false,
      },
    });

    const codes = await getActiveFrameworksForPractice(practice.id);
    expect(codes).toEqual(["HIPAA"]);
  });

  it("returns an empty array when the practice has no enabled frameworks", async () => {
    const { practice } = await seed("none-enabled");
    const codes = await getActiveFrameworksForPractice(practice.id);
    expect(codes).toEqual([]);
  });
});
