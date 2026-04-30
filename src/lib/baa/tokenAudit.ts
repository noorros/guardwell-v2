// src/lib/baa/tokenAudit.ts
//
// Shared helpers for the public BAA token surfaces. Two responsibilities:
//
//   1. extractClientIp(headers) — pulls the client IP from the first
//      x-forwarded-for, falling back to x-real-ip, with a null when
//      both are absent. Matches the existing inline logic in
//      src/app/accept-baa/[token]/actions.ts but de-duplicates it across
//      the three call sites (page.tsx, actions.ts, baa-document route).
//
//   2. hashTokenForAudit(token) — sha256-then-first-12-hex-chars of the
//      raw token. Used in audit log payloads so we have a stable,
//      correlatable identifier WITHOUT persisting the plaintext token.
//      A 12-hex-char prefix gives ~48 bits of entropy — enough to dedup
//      across an attacker's enumeration burst, far short of useful for
//      reversing back to the live token.
//
// Audit #21 M-5 (2026-04-30).

import { createHash } from "node:crypto";

interface HeaderLike {
  get(name: string): string | null;
}

export function extractClientIp(headers: HeaderLike): string | null {
  const xForwardedFor = headers.get("x-forwarded-for") ?? "";
  const xRealIp = headers.get("x-real-ip") ?? "";
  const ip = xForwardedFor.split(",")[0]?.trim() || xRealIp || null;
  return ip;
}

export function hashTokenForAudit(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}
