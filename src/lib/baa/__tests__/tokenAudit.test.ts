// src/lib/baa/__tests__/tokenAudit.test.ts
//
// Unit tests for shared BAA token-audit helpers (audit #21 M-5,
// 2026-04-30). No DB / Next runtime dependency.

import { describe, it, expect } from "vitest";
import { extractClientIp, hashTokenForAudit } from "@/lib/baa/tokenAudit";

function fakeHeaders(map: Record<string, string | null>) {
  return {
    get: (name: string) => map[name.toLowerCase()] ?? null,
  };
}

describe("extractClientIp", () => {
  it("returns the first IP in x-forwarded-for, trimmed", () => {
    const h = fakeHeaders({
      "x-forwarded-for": "203.0.113.42, 198.51.100.7",
    });
    expect(extractClientIp(h)).toBe("203.0.113.42");
  });

  it("falls back to x-real-ip when x-forwarded-for is empty", () => {
    const h = fakeHeaders({
      "x-forwarded-for": "",
      "x-real-ip": "192.0.2.10",
    });
    expect(extractClientIp(h)).toBe("192.0.2.10");
  });

  it("returns null when neither header is present", () => {
    const h = fakeHeaders({});
    expect(extractClientIp(h)).toBeNull();
  });

  it("handles single-IP x-forwarded-for without commas", () => {
    const h = fakeHeaders({
      "x-forwarded-for": "203.0.113.42",
    });
    expect(extractClientIp(h)).toBe("203.0.113.42");
  });
});

describe("hashTokenForAudit", () => {
  it("produces a 12-char hex string", () => {
    const h = hashTokenForAudit("hello-baa-token");
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic for the same token", () => {
    const a = hashTokenForAudit("the-quick-brown-fox");
    const b = hashTokenForAudit("the-quick-brown-fox");
    expect(a).toBe(b);
  });

  it("is different for different tokens", () => {
    const a = hashTokenForAudit("token-a");
    const b = hashTokenForAudit("token-b");
    expect(a).not.toBe(b);
  });

  it("does NOT contain the plaintext token (or any prefix of it)", () => {
    const token = "secret-baa-12345";
    const h = hashTokenForAudit(token);
    expect(h).not.toContain(token);
    expect(token).not.toContain(h);
  });
});
