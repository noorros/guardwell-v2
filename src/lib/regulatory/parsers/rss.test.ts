// src/lib/regulatory/parsers/rss.test.ts
//
// Phase 8 PR 3 — coverage for parseRssFeed. Stubs rss-parser so the
// test is deterministic + offline; what we verify is the mapping logic
// from rss-parser's Item shape to our ParsedArticle shape.

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockResponse: { items: unknown[] } = { items: [] };

vi.mock("rss-parser", () => {
  return {
    default: class MockParser {
      async parseURL(_url: string) {
        return mockResponse;
      }
    },
  };
});

import { parseRssFeed } from "./rss";

beforeEach(() => {
  mockResponse = { items: [] };
});

describe("parseRssFeed", () => {
  it("maps a 3-item feed into 3 ParsedArticle objects", async () => {
    mockResponse = {
      items: [
        {
          title: "Breach notice 1",
          link: "https://hhs.gov/breach/1",
          contentSnippet: "Summary 1",
          content: "Full content 1",
          isoDate: "2026-04-15T10:00:00Z",
        },
        {
          title: "Breach notice 2",
          link: "https://hhs.gov/breach/2",
          contentSnippet: "Summary 2",
          content: "Full content 2",
          isoDate: "2026-04-16T10:00:00Z",
        },
        {
          title: "Breach notice 3",
          link: "https://hhs.gov/breach/3",
          contentSnippet: "Summary 3",
          content: "Full content 3",
          isoDate: "2026-04-17T10:00:00Z",
        },
      ],
    };

    const result = await parseRssFeed("https://hhs.gov/feed.xml");

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      title: "Breach notice 1",
      url: "https://hhs.gov/breach/1",
      summary: "Summary 1",
      rawContent: "Full content 1",
      publishDate: new Date("2026-04-15T10:00:00Z"),
    });
    expect(result[2]!.url).toBe("https://hhs.gov/breach/3");
    expect(result[2]!.publishDate).toEqual(new Date("2026-04-17T10:00:00Z"));
  });

  it("defaults missing title to (untitled)", async () => {
    mockResponse = {
      items: [
        {
          // no title
          link: "https://example.com/missing-title",
          contentSnippet: "Has summary, no title",
          isoDate: "2026-04-15T10:00:00Z",
        },
      ],
    };

    const result = await parseRssFeed("https://example.com/feed.xml");

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("(untitled)");
    expect(result[0]!.url).toBe("https://example.com/missing-title");
  });

  it("leaves publishDate undefined when isoDate is missing", async () => {
    mockResponse = {
      items: [
        {
          title: "Dateless article",
          link: "https://example.com/no-date",
          contentSnippet: "No iso date here",
          // no isoDate
        },
      ],
    };

    const result = await parseRssFeed("https://example.com/feed.xml");

    expect(result).toHaveLength(1);
    expect(result[0]!.publishDate).toBeUndefined();
    expect(result[0]!.title).toBe("Dateless article");
  });
});
