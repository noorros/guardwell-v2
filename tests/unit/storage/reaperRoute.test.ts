// tests/unit/storage/reaperRoute.test.ts
//
// Smoke test: the route 403s without the CRON_SECRET header and 200s
// when the secret matches. Uses mocked runReaper so no real DB is needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage/reaper", () => ({
  runReaper: vi.fn().mockResolvedValue({ purged: 3, errors: 0 }),
}));

// Simulate the route handler without Next.js runtime
async function callRoute(secret: string | undefined, configured = "test-secret") {
  // Temporarily set env
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = configured;

  // Dynamically import after env is set
  const { POST } = await import("@/app/api/cron/evidence-reaper/route");
  const headers = new Headers();
  if (secret !== undefined) headers.set("x-cron-secret", secret);
  const req = new Request("http://localhost/api/cron/evidence-reaper", {
    method: "POST",
    headers,
  });
  const res = await POST(req);

  process.env.CRON_SECRET = prev;
  return res;
}

describe("/api/cron/evidence-reaper", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns 403 when x-cron-secret is missing", async () => {
    const res = await callRoute(undefined);
    expect(res.status).toBe(403);
  });

  it("returns 403 when x-cron-secret is wrong", async () => {
    const res = await callRoute("wrong-secret");
    expect(res.status).toBe(403);
  });

  it("returns 200 + purge summary when secret matches", async () => {
    const res = await callRoute("test-secret");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.purged).toBe(3);
    expect(body.errors).toBe(0);
  });
});
