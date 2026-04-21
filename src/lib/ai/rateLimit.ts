// src/lib/ai/rateLimit.ts
//
// 1 AI assessment per practice per 24h. Upstash Redis sliding window. In
// tests we inject a fake ratelimiter via __setRatelimiterForTests; in
// production the `@upstash/*` libs read config from env.

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
    limiter: Ratelimit.slidingWindow(1, "24 h"),
    prefix: "gw:ai:assess",
  }) as unknown as Limiter;
  return limiter;
}

export function __setRatelimiterForTests(next: Limiter | null): void {
  limiter = next;
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
