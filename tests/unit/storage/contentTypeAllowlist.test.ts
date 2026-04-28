// tests/unit/storage/contentTypeAllowlist.test.ts
//
// Validates that requestUpload throws on disallowed MIME types without
// needing a real DB (we check the thrown error message in dev no-op mode).
import { describe, it, expect } from "vitest";
import { requestUpload } from "@/lib/storage/evidence";

// In CI (no DB), requestUpload throws for bad content types BEFORE
// touching the DB — we can catch those errors here.
describe("content-type allowlist in requestUpload", () => {
  it("throws for video/mp4 on a CREDENTIAL entityType", async () => {
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

  it("throws for unknown entityType with non-PDF mime type", async () => {
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

  it("does NOT throw content-type error for application/pdf on unknown entityType", async () => {
    // application/pdf passes the allowlist check for any entityType (DEFAULT fallback).
    // The call will throw for a different reason (no DB in unit test context)
    // but NOT for content-type validation.
    try {
      await requestUpload({
        practiceId: "test-practice",
        practiceUserId: "test-pu",
        actorUserId: "test-user",
        entityType: "UNKNOWN_FUTURE_TYPE",
        entityId: "x-2",
        fileName: "doc.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 2048,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/is not allowed/i);
    }
  });
});
