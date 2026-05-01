// tests/integration/regulatory-ingest.test.ts
//
// Phase 8 PR 3 — integration coverage for runRegulatoryIngest. Real DB
// for RegulatorySource + RegulatoryArticle. parseRssFeed is mocked so
// the test is offline + deterministic; we're verifying the orchestration
// (dedup, lastIngestedAt, error isolation, SCRAPE skip), not RSS parsing.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/regulatory/parsers/rss", () => ({
  parseRssFeed: vi.fn(),
}));

import { db } from "@/lib/db";
import { parseRssFeed } from "@/lib/regulatory/parsers/rss";
import { runRegulatoryIngest } from "@/lib/regulatory/ingest";
import type { ParsedArticle } from "@/lib/regulatory/types";

const mockParseRssFeed = vi.mocked(parseRssFeed);

beforeEach(async () => {
  mockParseRssFeed.mockReset();
  // PR 2 seeded 10 RegulatorySource rows that persist across test runs
  // (no beforeAll cleanup in tests/setup.ts). Wipe them up-front so this
  // suite can assert exact source counts. afterEach in setup.ts handles
  // post-test cleanup.
  await db.regulatoryArticle.deleteMany();
  await db.regulatorySource.deleteMany();
});

async function seedSource(opts: {
  name: string;
  url: string;
  feedType: "RSS" | "ATOM" | "SCRAPE";
  isActive?: boolean;
}) {
  return db.regulatorySource.create({
    data: {
      name: opts.name,
      url: opts.url,
      feedType: opts.feedType,
      isActive: opts.isActive ?? true,
      defaultFrameworks: [],
    },
  });
}

function fakeArticles(prefix: string, n: number): ParsedArticle[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `${prefix} article ${i + 1}`,
    url: `https://example.com/${prefix}/${i + 1}`,
    summary: `Summary for ${prefix} ${i + 1}`,
    rawContent: `Full content for ${prefix} ${i + 1}`,
    publishDate: new Date("2026-04-15T10:00:00Z"),
  }));
}

describe("runRegulatoryIngest", () => {
  it("ingests 3 articles from an active RSS source and stamps lastIngestedAt", async () => {
    const source = await seedSource({
      name: "Test RSS source",
      url: "https://example.com/rss.xml",
      feedType: "RSS",
    });
    mockParseRssFeed.mockResolvedValueOnce(fakeArticles("rss-3", 3));

    const start = new Date();
    const summary = await runRegulatoryIngest();

    expect(summary.sourcesScanned).toBe(1);
    expect(summary.articlesIngested).toBe(3);
    expect(summary.errors).toEqual([]);

    const articles = await db.regulatoryArticle.findMany({
      where: { sourceId: source.id },
      orderBy: { url: "asc" },
    });
    expect(articles).toHaveLength(3);
    expect(articles[0]!.title).toBe("rss-3 article 1");
    expect(articles[0]!.url).toBe("https://example.com/rss-3/1");
    expect(articles[0]!.summary).toBe("Summary for rss-3 1");

    const refreshed = await db.regulatorySource.findUniqueOrThrow({
      where: { id: source.id },
    });
    expect(refreshed.lastIngestedAt).not.toBeNull();
    expect(refreshed.lastIngestedAt!.getTime()).toBeGreaterThanOrEqual(
      start.getTime() - 1000,
    );
  });

  it("skips inactive sources entirely", async () => {
    await seedSource({
      name: "Disabled RSS source",
      url: "https://example.com/disabled.xml",
      feedType: "RSS",
      isActive: false,
    });

    const summary = await runRegulatoryIngest();

    expect(summary.sourcesScanned).toBe(0);
    expect(summary.articlesIngested).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(mockParseRssFeed).not.toHaveBeenCalled();
  });

  it("inserts 0 new rows on replay when articles already exist (dedup by URL)", async () => {
    const source = await seedSource({
      name: "Replay source",
      url: "https://example.com/replay.xml",
      feedType: "RSS",
    });
    const items = fakeArticles("replay", 2);

    mockParseRssFeed.mockResolvedValueOnce(items);
    const first = await runRegulatoryIngest();
    expect(first.articlesIngested).toBe(2);

    mockParseRssFeed.mockResolvedValueOnce(items);
    const second = await runRegulatoryIngest();
    expect(second.sourcesScanned).toBe(1);
    expect(second.articlesIngested).toBe(0);
    expect(second.errors).toEqual([]);

    const articles = await db.regulatoryArticle.findMany({
      where: { sourceId: source.id },
    });
    expect(articles).toHaveLength(2);
  });

  it("logs an error for SCRAPE sources without inserting or stamping lastIngestedAt", async () => {
    const source = await seedSource({
      name: "SCRAPE source",
      url: "https://example.com/scrape-target",
      feedType: "SCRAPE",
    });

    const summary = await runRegulatoryIngest();

    expect(summary.sourcesScanned).toBe(1);
    expect(summary.articlesIngested).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toEqual({
      sourceId: source.id,
      sourceName: "SCRAPE source",
      message: "SCRAPE feedType not yet supported",
    });
    expect(mockParseRssFeed).not.toHaveBeenCalled();

    const refreshed = await db.regulatorySource.findUniqueOrThrow({
      where: { id: source.id },
    });
    expect(refreshed.lastIngestedAt).toBeNull();
    const articles = await db.regulatoryArticle.findMany({
      where: { sourceId: source.id },
    });
    expect(articles).toHaveLength(0);
  });

  it("isolates failures: one source throws, the next still ingests", async () => {
    const failing = await seedSource({
      name: "Failing source",
      url: "https://example.com/fail.xml",
      feedType: "RSS",
    });
    const passing = await seedSource({
      name: "Passing source",
      url: "https://example.com/pass.xml",
      feedType: "RSS",
    });

    mockParseRssFeed
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(fakeArticles("pass", 2));

    const summary = await runRegulatoryIngest();

    expect(summary.sourcesScanned).toBe(2);
    expect(summary.articlesIngested).toBe(2);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]!.sourceId).toBe(failing.id);
    expect(summary.errors[0]!.message).toBe("network timeout");

    const failArticles = await db.regulatoryArticle.findMany({
      where: { sourceId: failing.id },
    });
    expect(failArticles).toHaveLength(0);

    const passArticles = await db.regulatoryArticle.findMany({
      where: { sourceId: passing.id },
    });
    expect(passArticles).toHaveLength(2);

    const failSource = await db.regulatorySource.findUniqueOrThrow({
      where: { id: failing.id },
    });
    expect(failSource.lastIngestedAt).toBeNull();
    const passSource = await db.regulatorySource.findUniqueOrThrow({
      where: { id: passing.id },
    });
    expect(passSource.lastIngestedAt).not.toBeNull();
  });

  it("truncates oversize fields to schema caps before insert", async () => {
    const source = await seedSource({
      name: "Big",
      url: "https://example.com/big.xml",
      feedType: "RSS",
    });
    const long = "x".repeat(60_000);
    mockParseRssFeed.mockResolvedValueOnce([
      {
        title: long,
        url: "https://example.com/big/1",
        summary: long,
        rawContent: long,
        publishDate: new Date("2026-04-15T10:00:00Z"),
      },
    ]);

    await runRegulatoryIngest();

    const [row] = await db.regulatoryArticle.findMany({
      where: { sourceId: source.id },
    });
    expect(row).toBeDefined();
    expect(row!.title).toHaveLength(500);
    expect(row!.summary).toHaveLength(5000);
    expect(row!.rawContent).toHaveLength(50_000);
    // url is short — verify not truncated below its true length.
    expect(row!.url).toBe("https://example.com/big/1");
  });
});
