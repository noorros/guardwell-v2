// src/lib/ai/__tests__/rateLimit.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@upstash/ratelimit", () => {
  class MockRatelimit {
    static slidingWindow(_max: number, _window: string) {
      return { max: _max, window: _window };
    }
    limit = vi.fn();
  }
  return { Ratelimit: MockRatelimit };
});

vi.mock("@upstash/redis", () => {
  class Redis {
    static fromEnv() {
      return new Redis();
    }
  }
  return { Redis };
});

describe("assertAssessmentRateLimit", () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    process.env.UPSTASH_DISABLE = "";
    vi.resetModules();
  });

  it("passes through when UPSTASH_DISABLE=1 (test default)", async () => {
    process.env.UPSTASH_DISABLE = "1";
    const { assertAssessmentRateLimit } = await import("@/lib/ai/rateLimit");
    await expect(assertAssessmentRateLimit("prac_1")).resolves.toBeUndefined();
  });

  it("throws RATE_LIMITED when the ratelimiter says not success", async () => {
    process.env.UPSTASH_DISABLE = "";
    const { Ratelimit } = await import("@upstash/ratelimit");
    const inst = new (Ratelimit as unknown as { new (): { limit: ReturnType<typeof vi.fn> } })();
    inst.limit.mockResolvedValueOnce({ success: false, reset: Date.now() + 86400_000 });
    const { __setRatelimiterForTests, assertAssessmentRateLimit } = await import(
      "@/lib/ai/rateLimit"
    );
    __setRatelimiterForTests(inst as unknown as { limit: (k: string) => Promise<{ success: boolean; reset: number }> });
    await expect(assertAssessmentRateLimit("prac_rl")).rejects.toThrow(/RATE_LIMITED/);
  });

  it("does NOT throw when success=true", async () => {
    process.env.UPSTASH_DISABLE = "";
    const { Ratelimit } = await import("@upstash/ratelimit");
    const inst = new (Ratelimit as unknown as { new (): { limit: ReturnType<typeof vi.fn> } })();
    inst.limit.mockResolvedValueOnce({ success: true, reset: Date.now() + 1000 });
    const { __setRatelimiterForTests, assertAssessmentRateLimit } = await import(
      "@/lib/ai/rateLimit"
    );
    __setRatelimiterForTests(inst as unknown as { limit: (k: string) => Promise<{ success: boolean; reset: number }> });
    await expect(assertAssessmentRateLimit("prac_ok")).resolves.toBeUndefined();
  });
});
