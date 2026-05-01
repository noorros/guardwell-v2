// src/lib/regulatory/ingest.ts
//
// Phase 8 PR 3 — daily ingest. Walks every active RegulatorySource,
// parses the feed (RSS/ATOM only in v1), dedups by URL, inserts new
// RegulatoryArticle rows, and stamps lastIngestedAt on success.
//
// Errors on a single source are caught + recorded; OTHER sources still
// process. The cron route surfaces the summary so Cloud Logging shows
// per-source pass/fail at a glance.

import { db } from "@/lib/db";
import { parseRssFeed } from "./parsers/rss";
import type { ParsedArticle } from "./types";

export interface IngestRunSummary {
  sourcesScanned: number;
  articlesIngested: number;
  errors: Array<{ sourceId?: string; sourceName?: string; message: string }>;
}

export async function runRegulatoryIngest(): Promise<IngestRunSummary> {
  const summary: IngestRunSummary = {
    sourcesScanned: 0,
    articlesIngested: 0,
    errors: [],
  };

  const sources = await db.regulatorySource.findMany({
    where: { isActive: true },
  });

  for (const source of sources) {
    summary.sourcesScanned += 1;
    try {
      let parsed: ParsedArticle[] = [];
      if (source.feedType === "RSS" || source.feedType === "ATOM") {
        parsed = await parseRssFeed(source.url);
      } else {
        // SCRAPE feedType — not supported in v1. Skip + log.
        summary.errors.push({
          sourceId: source.id,
          sourceName: source.name,
          message: "SCRAPE feedType not yet supported",
        });
        continue;
      }

      // Dedup against existing URLs in the DB.
      const urls = parsed.map((p) => p.url);
      const existing = await db.regulatoryArticle.findMany({
        where: { url: { in: urls } },
        select: { url: true },
      });
      const existingUrls = new Set(existing.map((e) => e.url));
      const fresh = parsed.filter((p) => !existingUrls.has(p.url));

      if (fresh.length > 0) {
        await db.regulatoryArticle.createMany({
          data: fresh.map((p) => ({
            sourceId: source.id,
            title: p.title.slice(0, 500),
            url: p.url.slice(0, 1000),
            summary: p.summary?.slice(0, 5000) ?? null,
            rawContent: p.rawContent?.slice(0, 50_000) ?? null,
            publishDate: p.publishDate ?? null,
          })),
        });
        summary.articlesIngested += fresh.length;
      }

      await db.regulatorySource.update({
        where: { id: source.id },
        data: { lastIngestedAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({
        sourceId: source.id,
        sourceName: source.name,
        message,
      });
    }
  }

  return summary;
}
