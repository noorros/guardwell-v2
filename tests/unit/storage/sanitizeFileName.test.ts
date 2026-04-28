// tests/unit/storage/sanitizeFileName.test.ts
import { describe, it, expect } from "vitest";
import { sanitizeFileName } from "@/lib/storage/gcs";

describe("sanitizeFileName", () => {
  it("strips path traversal sequences", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFileName("../secret.pdf")).not.toContain("..");
  });

  it("strips leading slashes", () => {
    const result = sanitizeFileName("/etc/passwd.pdf");
    expect(result).not.toMatch(/^\//);
  });

  it("replaces special characters with underscores", () => {
    const result = sanitizeFileName("my file (1).pdf");
    // spaces, parens should be replaced
    expect(result).not.toContain(" ");
    expect(result).not.toContain("(");
  });

  it("preserves allowed characters: a-z A-Z 0-9 . - _", () => {
    const result = sanitizeFileName("valid-file_name.123.pdf");
    expect(result).toBe("valid-file_name.123.pdf");
  });

  it("trims to 255 characters max", () => {
    const long = "a".repeat(300) + ".pdf";
    expect(sanitizeFileName(long).length).toBeLessThanOrEqual(255);
  });

  it("returns a non-empty string even for a junk input", () => {
    const result = sanitizeFileName("!!@@##");
    expect(result.length).toBeGreaterThan(0);
  });
});
