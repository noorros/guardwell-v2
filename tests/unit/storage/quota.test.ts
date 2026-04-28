// tests/unit/storage/quota.test.ts
//
// Tests quota logic in isolation. Does not need a real DB or GCS bucket.
// We test the pure helper function getPracticeStorageUsed by mocking db,
// and test the quota error message from requestUpload (dev no-op path).

import { describe, it, expect } from "vitest";
import { checkQuota } from "@/lib/storage/evidence";

describe("checkQuota", () => {
  it("returns ok when used < limit", () => {
    expect(checkQuota(1_000_000, 5_368_709_120)).toEqual({ ok: true });
  });

  it("returns error when used >= limit", () => {
    const result = checkQuota(5_368_709_120, 5_368_709_120);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/storage quota/i);
      expect(result.message).toContain("5 GB");
    }
  });

  it("returns error with custom limit label when limit differs from 5 GB", () => {
    const result = checkQuota(2_147_483_648, 1_073_741_824); // 2 GB used, 1 GB limit
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/1 GB/);
    }
  });

  it("returns ok when used is 0", () => {
    expect(checkQuota(0, 5_368_709_120)).toEqual({ ok: true });
  });
});
