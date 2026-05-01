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

export async function parseRssFeed(url: string): Promise<ParsedArticle[]> {
  const feed = await parser.parseURL(url);
  return (feed.items ?? []).map((item) => ({
    title: item.title ?? "(untitled)",
    url: item.link ?? item.guid ?? url,
    summary: item.contentSnippet ?? item.summary ?? undefined,
    rawContent: item.content ?? item.contentSnippet ?? undefined,
    publishDate: item.isoDate ? new Date(item.isoDate) : undefined,
  }));
}
