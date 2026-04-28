// tests/unit/storage/contentTypeAllowlist.test.ts
//
// Tests for the per-entityType MIME allowlist. The pure isAllowedMime
// helper covers the truth table; the requestUpload-based tests confirm
// the rejection error is correctly surfaced from the high-level entry
// point.
import { describe, it, expect } from "vitest";
import { isAllowedMime, requestUpload } from "@/lib/storage/evidence";

describe("isAllowedMime (pure helper)", () => {
  it("accepts application/pdf for any known entityType", () => {
    expect(isAllowedMime("CREDENTIAL", "application/pdf")).toBe(true);
    expect(isAllowedMime("INCIDENT", "application/pdf")).toBe(true);
    expect(isAllowedMime("DESTRUCTION_LOG", "application/pdf")).toBe(true);
  });

  it("accepts HEIC photo evidence on entityTypes that take photo evidence", () => {
    expect(isAllowedMime("CREDENTIAL", "image/heic")).toBe(true);
    expect(isAllowedMime("INCIDENT", "image/heic")).toBe(true);
    expect(isAllowedMime("DESTRUCTION_LOG", "image/heic")).toBe(true);
    expect(isAllowedMime("VENDOR", "image/heic")).toBe(true);
    expect(isAllowedMime("TECH_ASSET", "image/heic")).toBe(true);
    expect(isAllowedMime("TRAINING_COMPLETION", "image/heic")).toBe(true);
  });

  it("rejects video/mp4 on every entityType seeded today (BYOV is Phase 4)", () => {
    expect(isAllowedMime("CREDENTIAL", "video/mp4")).toBe(false);
    expect(isAllowedMime("DESTRUCTION_LOG", "video/mp4")).toBe(false);
    expect(isAllowedMime("INCIDENT", "video/mp4")).toBe(false);
    expect(isAllowedMime("VENDOR", "video/mp4")).toBe(false);
  });

  it("rejects text/csv on every known entityType (no spreadsheet uploads)", () => {
    expect(isAllowedMime("CREDENTIAL", "text/csv")).toBe(false);
    expect(isAllowedMime("DESTRUCTION_LOG", "text/csv")).toBe(false);
  });

  it("falls back to DEFAULT (application/pdf only) for unknown entityType", () => {
    expect(isAllowedMime("UNKNOWN_FUTURE_TYPE", "application/pdf")).toBe(true);
    expect(isAllowedMime("UNKNOWN_FUTURE_TYPE", "image/png")).toBe(false);
    expect(isAllowedMime("UNKNOWN_FUTURE_TYPE", "video/mp4")).toBe(false);
  });
});

describe("requestUpload content-type rejection", () => {
  it("throws a descriptive error for video/mp4 on a CREDENTIAL entityType", async () => {
    await expect(
      requestUpload({
        practiceId: "test-practice",
        practiceUserId: "test-pu",
        actorUserId: "test-user",
        entityType: "CREDENTIAL",
        entityId: "cred-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSizeBytes: 1024,
      }),
    ).rejects.toThrow(/video\/mp4.*is not allowed/i);
  });

  it("throws for text/csv on a DESTRUCTION_LOG entityType", async () => {
    await expect(
      requestUpload({
        practiceId: "test-practice",
        practiceUserId: "test-pu",
        actorUserId: "test-user",
        entityType: "DESTRUCTION_LOG",
        entityId: "dl-1",
        fileName: "log.csv",
        mimeType: "text/csv",
        fileSizeBytes: 512,
      }),
    ).rejects.toThrow(/text\/csv.*is not allowed/i);
  });

  it("throws for image/png on an unknown entityType (DEFAULT only allows pdf)", async () => {
    await expect(
      requestUpload({
        practiceId: "test-practice",
        practiceUserId: "test-pu",
        actorUserId: "test-user",
        entityType: "UNKNOWN_FUTURE_TYPE",
        entityId: "x-1",
        fileName: "img.png",
        mimeType: "image/png",
        fileSizeBytes: 2048,
      }),
    ).rejects.toThrow(/image\/png.*is not allowed/i);
  });
});
