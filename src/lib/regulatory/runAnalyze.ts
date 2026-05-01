// src/lib/regulatory/runAnalyze.ts
//
// Pulls unanalyzed RegulatoryArticle rows, scores them via Claude (once
// per article, framework-agnostic), then fans out per-practice
// RegulatoryAlert rows where the article's relevant frameworks intersect
// the practice's enabled frameworks.

import { db } from "@/lib/db";
import { analyzeArticle } from "./analyzeArticle";
import { getActiveFrameworksForPractice } from "./practiceFrameworks";
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

  const platformPracticeId = practices[0]?.id ?? "system";
  const platformActorId = "system";

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

      const output = await analyzeArticle(analyzerInput, {
        practiceId: platformPracticeId,
        actorUserId: platformActorId,
      });

      if (!output) {
        summary.errors.push({
          articleId: article.id,
          message: "analyzer returned null",
        });
        continue;
      }

      const relevantFrameworks = output.perFrameworkRelevance
        .filter((r) => r.relevance === "MED" || r.relevance === "HIGH")
        .map((r) => r.framework);

      for (const practice of practices) {
        const enabled = await getActiveFrameworksForPractice(practice.id);
        const matched = relevantFrameworks.filter((f) =>
          enabled.includes(f as FrameworkCode),
        );
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
          if (
            err instanceof Error &&
            "code" in err &&
            (err as { code: string }).code === "P2002"
          ) {
            continue;
          }
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
