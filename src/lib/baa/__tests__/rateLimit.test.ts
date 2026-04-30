// src/lib/baa/__tests__/rateLimit.test.ts
//
// Unit tests for the BAA token rate-limiter (audit #21 C-4, 2026-04-30).
// Mirrors the AI assess limiter test pattern: vi.mock the upstash libs
// + inject a mock Limiter via __setBaaRatelimiterForTests.

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

describe("assertBaaTokenRateLimit", () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    process.env.UPSTASH_DISABLE = "";
    vi.resetModules();
  });

  it("passes through when UPSTASH_DISABLE=1 (test/CI default)", async () => {
    process.env.UPSTASH_DISABLE = "1";
    const { assertBaaTokenRateLimit } = await import("@/lib/baa/rateLimit");
    await expect(
      assertBaaTokenRateLimit("203.0.113.42"),
    ).resolves.toBeUndefined();
  });

  it("throws RATE_LIMITED when the limiter returns success=false", async () => {
    process.env.UPSTASH_DISABLE = "";
    const { Ratelimit } = await import("@upstash/ratelimit");
    const inst = new (Ratelimit as unknown as {
      new (): { limit: ReturnType<typeof vi.fn> };
    })();
    inst.limit.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 5 * 60_000,
    });
    const { __setBaaRatelimiterForTests, assertBaaTokenRateLimit } =
      await import("@/lib/baa/rateLimit");
    __setBaaRatelimiterForTests(
      inst as unknown as {
        limit: (k: string) => Promise<{ success: boolean; reset: number }>;
      },
    );
    await expect(
      assertBaaTokenRateLimit("203.0.113.99"),
    ).rejects.toThrow(/RATE_LIMITED/);
  });

  it("does NOT throw when success=true", async () => {
    process.env.UPSTASH_DISABLE = "";
    const { Ratelimit } = await import("@upstash/ratelimit");
    const inst = new (Ratelimit as unknown as {
      new (): { limit: ReturnType<typeof vi.fn> };
    })();
    inst.limit.mockResolvedValueOnce({ success: true, reset: Date.now() + 1000 });
    const { __setBaaRatelimiterForTests, assertBaaTokenRateLimit } =
      await import("@/lib/baa/rateLimit");
    __setBaaRatelimiterForTests(
      inst as unknown as {
        limit: (k: string) => Promise<{ success: boolean; reset: number }>;
      },
    );
    await expect(
      assertBaaTokenRateLimit("203.0.113.42"),
    ).resolves.toBeUndefined();
  });

  it("buckets null IP under the 'unknown' key (not a per-request bypass)", async () => {
    process.env.UPSTASH_DISABLE = "";
    const { Ratelimit } = await import("@upstash/ratelimit");
    const inst = new (Ratelimit as unknown as {
      new (): { limit: ReturnType<typeof vi.fn> };
    })();
    inst.limit.mockResolvedValue({ success: true, reset: Date.now() + 1000 });
    const { __setBaaRatelimiterForTests, assertBaaTokenRateLimit } =
      await import("@/lib/baa/rateLimit");
    __setBaaRatelimiterForTests(
      inst as unknown as {
        limit: (k: string) => Promise<{ success: boolean; reset: number }>;
      },
    );
    await assertBaaTokenRateLimit(null);
    await assertBaaTokenRateLimit("");
    expect(inst.limit).toHaveBeenCalledTimes(2);
    expect(inst.limit).toHaveBeenNthCalledWith(1, "unknown");
    expect(inst.limit).toHaveBeenNthCalledWith(2, "unknown");
  });

  it("keys distinct IPs into distinct buckets", async () => {
    process.env.UPSTASH_DISABLE = "";
    const { Ratelimit } = await import("@upstash/ratelimit");
    const inst = new (Ratelimit as unknown as {
      new (): { limit: ReturnType<typeof vi.fn> };
    })();
    inst.limit.mockResolvedValue({ success: true, reset: Date.now() + 1000 });
    const { __setBaaRatelimiterForTests, assertBaaTokenRateLimit } =
      await import("@/lib/baa/rateLimit");
    __setBaaRatelimiterForTests(
      inst as unknown as {
        limit: (k: string) => Promise<{ success: boolean; reset: number }>;
      },
    );
    await assertBaaTokenRateLimit("198.51.100.1");
    await assertBaaTokenRateLimit("198.51.100.2");
    expect(inst.limit).toHaveBeenNthCalledWith(1, "198.51.100.1");
    expect(inst.limit).toHaveBeenNthCalledWith(2, "198.51.100.2");
  });
});
