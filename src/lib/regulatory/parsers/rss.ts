// src/lib/regulatory/parsers/rss.ts
//
// Wraps rss-parser to produce our internal ParsedArticle shape. Handles
// both RSS and Atom feeds (rss-parser auto-detects).

import Parser from "rss-parser";
import type { ParsedArticle } from "./types";

const parser = new Parser({
  timeout: 15_000, // 15s per feed — kills slow servers fast
  headers: {
    "User-Agent": "GuardWell Regulatory Engine/1.0 (+https://gwcomp.com)",
  },
});

// `<guid isPermaLink="false">` is allowed to carry any URN-shaped string
// (e.g. `tag:hhs.gov,2024:breach/123`). We only fall back to it when it
// looks like a real http(s) URL — otherwise downstream consumers (clickable
// links in PR 6 UI, the analyzer prompt in PR 4) would see opaque tags.
function asHttpUrlOrNull(s: string | undefined): string | null {
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;
}

export async function parseRssFeed(feedUrl: string): Promise<ParsedArticle[]> {
  const feed = await parser.parseURL(feedUrl);
  return (feed.items ?? []).map((item) => ({
    title: item.title ?? "(untitled)",
    url: item.link ?? asHttpUrlOrNull(item.guid) ?? feedUrl,
    summary: item.contentSnippet ?? item.summary ?? undefined,
    rawContent: item.content ?? item.contentSnippet ?? undefined,
    publishDate: item.isoDate ? new Date(item.isoDate) : undefined,
  }));
}
