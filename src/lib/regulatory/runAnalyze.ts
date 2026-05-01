// src/lib/regulatory/runAnalyze.ts
//
// Pulls unanalyzed RegulatoryArticle rows, scores them via Claude (once
// per article, framework-agnostic), then fans out per-practice
// RegulatoryAlert rows where the article's relevant frameworks intersect
// the practice's enabled frameworks.

import { db } from "@/lib/db";
import { analyzeArticle } from "./analyzeArticle";
import { ALL_FRAMEWORK_CODES, type FrameworkCode } from "./types";

export interface AnalyzeRunSummary {
  articlesAnalyzed: number;
  alertsCreated: number;
  practicesScanned: number;
  errors: Array<{
    articleId?: string;
    practiceId?: string;
    message: string;
  }>;
}

const ANALYZE_BATCH_LIMIT = 50;

const KNOWN_CODES = new Set<string>(ALL_FRAMEWORK_CODES);

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

export async function runRegulatoryAnalyze(): Promise<AnalyzeRunSummary> {
  const summary: AnalyzeRunSummary = {
    articlesAnalyzed: 0,
    alertsCreated: 0,
    practicesScanned: 0,
    errors: [],
  };

  const articles = await db.regulatoryArticle.findMany({
    where: { analyzedAt: null },
    include: { source: { select: { name: true } } },
    orderBy: { ingestedAt: "asc" },
    take: ANALYZE_BATCH_LIMIT,
  });

  if (articles.length === 0) return summary;

  const practices = await db.practice.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  summary.practicesScanned = practices.length;

  // Bulk-fetch every active PracticeFramework once before the article
  // loop so the per-(article, practice) intersection check is a Map
  // lookup instead of a DB query. At 50 articles × 100 practices that
  // collapses 5,000 queries into one.
  const enabledByPractice = new Map<string, FrameworkCode[]>();
  if (practices.length > 0) {
    const fwRows = await db.practiceFramework.findMany({
      where: {
        practiceId: { in: practices.map((p) => p.id) },
        enabled: true,
      },
      select: { practiceId: true, framework: { select: { code: true } } },
    });
    for (const row of fwRows) {
      const code = row.framework.code;
      if (!KNOWN_CODES.has(code)) continue;
      const list = enabledByPractice.get(row.practiceId) ?? [];
      list.push(code as FrameworkCode);
      enabledByPractice.set(row.practiceId, list);
    }
  }

  for (const article of articles) {
    try {
      const analyzerInput = {
        article: {
          title: article.title,
          url: article.url,
          summary: article.summary,
          rawContent: article.rawContent
            ? article.rawContent.slice(0, 30_000)
            : null,
          publishDate: article.publishDate?.toISOString() ?? null,
          sourceName: article.source.name,
        },
        // ALL_FRAMEWORK_CODES is a readonly tuple (PR 1 polish). Spread
        // into a fresh mutable array so the Zod input schema's
        // FrameworkCode[] expectation type-checks.
        frameworks: [...ALL_FRAMEWORK_CODES],
      };

      // Regulatory analyzer is a system-level call — no per-practice
      // attribution. LlmCall.practiceId is nullable for exactly this.
      // Passing null also avoids the lexically-first-practice cost-skew
      // that an arbitrary platformPracticeId would create.
      const output = await analyzeArticle(analyzerInput, {
        practiceId: null,
        actorUserId: null,
      });

      if (!output) {
        summary.errors.push({
          articleId: article.id,
          message: "analyzer returned null",
        });
        continue;
      }

      // Defense-in-depth: the output schema's framework enum accepts all
      // 9 codes regardless of input, so a hallucinated entry would
      // otherwise survive into the DB. Drop anything not in the input
      // frameworks set.
      const relevantFrameworks = output.perFrameworkRelevance
        .filter((r) => KNOWN_CODES.has(r.framework))
        .filter((r) => r.relevance === "MED" || r.relevance === "HIGH")
        .map((r) => r.framework);

      // Partial-fan-out semantics: if a non-P2002 throw happens mid-loop
      // (e.g. transient DB drop on practice 47/100), we still continue
      // the loop AND mark the article analyzed at the end. Practices
      // that didn't get an alert in this run will NOT retry — but every
      // alert that DID land is unique by (practiceId, articleId), so we
      // can never duplicate. The trade-off favors retry-safety over
      // exhaustive fan-out.
      for (const practice of practices) {
        const enabled = enabledByPractice.get(practice.id) ?? [];
        const matched = relevantFrameworks.filter((f) => enabled.includes(f));
        if (matched.length === 0) continue;

        try {
          await db.regulatoryAlert.create({
            data: {
              practiceId: practice.id,
              articleId: article.id,
              alertBody: output.summary,
              recommendedActions: output.recommendedActions,
              severity: output.severity,
              matchedFrameworks: matched,
            },
          });
          summary.alertsCreated += 1;
        } catch (err) {
          // P2002 = duplicate (practice, article) — silent on replay.
          if (isUniqueViolation(err)) continue;
          summary.errors.push({
            articleId: article.id,
            practiceId: practice.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await db.regulatoryArticle.update({
        where: { id: article.id },
        data: {
          analyzedAt: new Date(),
          relevantFrameworks,
        },
      });
      summary.articlesAnalyzed += 1;
    } catch (err) {
      summary.errors.push({
        articleId: article.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
