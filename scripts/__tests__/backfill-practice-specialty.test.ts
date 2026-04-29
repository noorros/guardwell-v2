import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { backfillPracticeSpecialty } from "../backfill-practice-specialty";

describe("backfillPracticeSpecialty", () => {
  beforeEach(async () => {
    await db.practiceComplianceProfile.deleteMany({});
    await db.practiceUser.deleteMany({});
    await db.practice.deleteMany({});
  });

  async function seedPractice(
    overrides: Partial<{
      specialty: string | null;
      bucket: string | null;
    }> = {},
  ) {
    const p = await db.practice.create({
      data: {
        name: `t-${Math.random().toString(36).slice(2, 8)}`,
        primaryState: "AZ",
        specialty: overrides.specialty ?? null,
      },
    });
    if (overrides.bucket !== undefined) {
      await db.practiceComplianceProfile.create({
        data: {
          practiceId: p.id,
          specialtyCategory: overrides.bucket,
        },
      });
    }
    return p;
  }

  it("maps PRIMARY_CARE bucket to Family Medicine", async () => {
    const p = await seedPractice({ bucket: "PRIMARY_CARE" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Family Medicine");
  });

  it("maps DENTAL to Dental — General", async () => {
    const p = await seedPractice({ bucket: "DENTAL" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Dental — General");
  });

  it("maps BEHAVIORAL to Behavioral Health", async () => {
    const p = await seedPractice({ bucket: "BEHAVIORAL" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Behavioral Health");
  });

  it("maps ALLIED to Physical Therapy", async () => {
    const p = await seedPractice({ bucket: "ALLIED" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Physical Therapy");
  });

  it("maps SPECIALTY bucket to Other (too broad to guess)", async () => {
    const p = await seedPractice({ bucket: "SPECIALTY" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Other");
  });

  it("maps OTHER bucket to Other", async () => {
    const p = await seedPractice({ bucket: "OTHER" });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Other");
  });

  it("skips practices that already have specialty set", async () => {
    const p = await seedPractice({
      specialty: "Cardiology",
      bucket: "PRIMARY_CARE",
    });
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBe("Cardiology"); // unchanged
  });

  it("skips practices with no PracticeComplianceProfile (specialty stays null)", async () => {
    const p = await seedPractice(); // no profile
    await backfillPracticeSpecialty();
    const updated = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(updated.specialty).toBeNull();
  });

  it("is idempotent (re-running produces no change)", async () => {
    const p = await seedPractice({ bucket: "PRIMARY_CARE" });
    await backfillPracticeSpecialty();
    const first = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    await backfillPracticeSpecialty();
    const second = await db.practice.findUniqueOrThrow({ where: { id: p.id } });
    expect(second.specialty).toBe(first.specialty);
  });
});
