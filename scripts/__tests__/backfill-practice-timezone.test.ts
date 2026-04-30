import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { backfillPracticeTimezone } from "../backfill-practice-timezone";

describe("backfillPracticeTimezone", () => {
  beforeEach(async () => {
    await db.practiceUser.deleteMany({});
    await db.practice.deleteMany({});
  });

  it("backfills null timezones from primaryState defaults", async () => {
    await db.practice.create({
      data: { name: "AZ Practice", primaryState: "AZ" },
    });
    await db.practice.create({
      data: { name: "HI Practice", primaryState: "HI" },
    });
    await db.practice.create({
      data: { name: "Pre-set Practice", primaryState: "NY", timezone: "UTC" },
    });

    const result = await backfillPracticeTimezone();
    expect(result.updated).toBe(2);

    const az = await db.practice.findFirstOrThrow({ where: { name: "AZ Practice" } });
    const hi = await db.practice.findFirstOrThrow({ where: { name: "HI Practice" } });
    const preset = await db.practice.findFirstOrThrow({ where: { name: "Pre-set Practice" } });

    expect(az.timezone).toBe("America/Phoenix");
    expect(hi.timezone).toBe("Pacific/Honolulu");
    expect(preset.timezone).toBe("UTC");
  });

  it("is idempotent on a second run", async () => {
    await db.practice.create({
      data: { name: "Idempotent Test", primaryState: "TX" },
    });
    const first = await backfillPracticeTimezone();
    const second = await backfillPracticeTimezone();
    expect(first.updated).toBe(1);
    expect(second.updated).toBe(0);
  });
});
