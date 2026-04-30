// tests/unit/storage/contentTypeAllowlist.test.ts
//
// Tests for the per-entityType MIME allowlist. The pure isAllowedMime
// helper covers the truth table; the requestUpload-based tests confirm
// the rejection error is correctly surfaced from the high-level entry
// point.
import { describe, it, expect } from "vitest";
import { isAllowedMime, getMaxBytes, requestUpload } from "@/lib/storage/evidence";

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

  it("rejects video/mp4 on document/photo entityTypes (only TRAINING_VIDEO accepts video)", () => {
    expect(isAllowedMime("CREDENTIAL", "video/mp4")).toBe(false);
    expect(isAllowedMime("DESTRUCTION_LOG", "video/mp4")).toBe(false);
    expect(isAllowedMime("INCIDENT", "video/mp4")).toBe(false);
    expect(isAllowedMime("VENDOR", "video/mp4")).toBe(false);
  });

  it("accepts video MIME types on TRAINING_VIDEO (Phase 4 PR 6 BYOV)", () => {
    expect(isAllowedMime("TRAINING_VIDEO", "video/mp4")).toBe(true);
    expect(isAllowedMime("TRAINING_VIDEO", "video/webm")).toBe(true);
    expect(isAllowedMime("TRAINING_VIDEO", "video/quicktime")).toBe(true);
  });

  it("rejects pdfs/images on TRAINING_VIDEO (videos only)", () => {
    expect(isAllowedMime("TRAINING_VIDEO", "application/pdf")).toBe(false);
    expect(isAllowedMime("TRAINING_VIDEO", "image/png")).toBe(false);
    expect(isAllowedMime("TRAINING_VIDEO", "image/jpeg")).toBe(false);
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

describe("getMaxBytes (Phase 4 PR 6 — per-entityType file-size cap)", () => {
  it("returns 25 MB for default entityTypes", () => {
    expect(getMaxBytes("CREDENTIAL")).toBe(25 * 1024 * 1024);
    expect(getMaxBytes("INCIDENT")).toBe(25 * 1024 * 1024);
    expect(getMaxBytes("DESTRUCTION_LOG")).toBe(25 * 1024 * 1024);
    expect(getMaxBytes("UNKNOWN_FUTURE_TYPE")).toBe(25 * 1024 * 1024);
  });

  it("returns 500 MB for TRAINING_VIDEO (BYOV long-form lessons)", () => {
    expect(getMaxBytes("TRAINING_VIDEO")).toBe(500 * 1024 * 1024);
  });
});
