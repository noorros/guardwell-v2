// src/lib/ai/rateLimit.ts
//
// 1 AI assessment per practice per 24h + 60 Concierge messages per user per
// 24h. Two separate Upstash sliding-window limiters with distinct prefixes
// so they don't collide. In tests we inject a fake limiter via the
// __setRatelimiterForTests / __setConciergeLimiterForTests setters; in
// production the `@upstash/*` libs read config from env.
//
// Why per-USER (not per-practice) for Concierge: a single user across
// multiple practice memberships shares one rate budget — prevents one
// account from chatting 60×N where N = practice count.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

interface Limiter {
  limit(key: string): Promise<{ success: boolean; reset: number }>;
}

let limiter: Limiter | null = null;
let conciergeLimiter: Limiter | null = null;

function getLimiter(): Limiter {
  if (limiter) return limiter;
  limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(1, "24 h"),
    prefix: "gw:ai:assess",
  }) as unknown as Limiter;
  return limiter;
}

function getConciergeLimiter(): Limiter {
  if (conciergeLimiter) return conciergeLimiter;
  conciergeLimiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(60, "24 h"),
    prefix: "gw:ai:concierge",
  }) as unknown as Limiter;
  return conciergeLimiter;
}

export function __setRatelimiterForTests(next: Limiter | null): void {
  limiter = next;
}

export function __setConciergeLimiterForTests(next: Limiter | null): void {
  conciergeLimiter = next;
}

/** Throws RATE_LIMITED if the practice already ran an assessment in the
 *  last 24h. Soft-skip when UPSTASH_DISABLE=1 (CI / unit tests). */
export async function assertAssessmentRateLimit(practiceId: string): Promise<void> {
  if (process.env.UPSTASH_DISABLE === "1") return;
  const res = await getLimiter().limit(practiceId);
  if (!res.success) {
    const resetAt = new Date(res.reset).toISOString();
    throw new Error(`RATE_LIMITED: next allowed after ${resetAt}`);
  }
}

/** Throws RATE_LIMITED if this user has already sent 60 Concierge messages
 *  within the trailing 24h sliding window. Soft-skip when UPSTASH_DISABLE=1
 *  (CI / unit tests). */
export async function assertConciergeRateLimit(userId: string): Promise<void> {
  if (process.env.UPSTASH_DISABLE === "1") return;
  const res = await getConciergeLimiter().limit(userId);
  if (!res.success) {
    const resetAt = new Date(res.reset).toISOString();
    throw new Error(`RATE_LIMITED: next allowed after ${resetAt}`);
  }
}
