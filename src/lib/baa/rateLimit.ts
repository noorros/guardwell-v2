// src/lib/baa/rateLimit.ts
//
// Rate-limiting for the public, no-auth `/accept-baa/[token]` and
// `/api/baa-document/[token]` surfaces. Token possession is the only
// authorization, so an attacker can attempt enumeration at unlimited
// rate without this guard. Audit #21 C-4 (2026-04-30).
//
// Design — keyed on IP, NOT on token:
//   * Keying on IP rate-limits the attacker, not the legitimate vendor
//     who's clicking the link from their email.
//   * 10 attempts per 5 minutes is generous for a single user (enough
//     for a few mistyped emails on the e-signature form) but tight
//     enough to make blind enumeration impractical.
//   * Same dual-injection pattern as src/lib/ai/rateLimit.ts so tests
//     can swap in a mock limiter via __setBaaRatelimiterForTests.
//
// Why the limiter lives here (not in /lib/ai): the BAA flow is not
// AI-related and lives outside the dashboard's auth boundary. Co-locating
// with src/lib/baa keeps the audit trail tidy.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

interface Limiter {
  limit(key: string): Promise<{ success: boolean; reset: number }>;
}

let limiter: Limiter | null = null;

function getLimiter(): Limiter {
  if (limiter) return limiter;
  limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, "5 m"),
    prefix: "gw:baa:token",
  }) as unknown as Limiter;
  return limiter;
}

export function __setBaaRatelimiterForTests(next: Limiter | null): void {
  limiter = next;
}

/** Throws RATE_LIMITED when the IP has hit 10 token-related attempts in
 *  the last 5 minutes. Soft-skips when UPSTASH_DISABLE=1 (CI / unit tests).
 *
 *  `ip` may be null (origin headers stripped, internal cron, etc.) — in
 *  that case we key on the literal string "unknown" so all such requests
 *  share one bucket. That's deliberate: a request without a resolvable
 *  IP is exactly the case where an attacker would also try to evade the
 *  limiter, so collapsing them all into one bucket is the safer choice. */
export async function assertBaaTokenRateLimit(ip: string | null): Promise<void> {
  if (process.env.UPSTASH_DISABLE === "1") return;
  const key = ip && ip.length > 0 ? ip : "unknown";
  const res = await getLimiter().limit(key);
  if (!res.success) {
    const resetAt = new Date(res.reset).toISOString();
    throw new Error(`RATE_LIMITED: next allowed after ${resetAt}`);
  }
}
