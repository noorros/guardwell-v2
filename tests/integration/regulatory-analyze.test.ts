// tests/integration/regulatory-analyze.test.ts
//
// Phase 8 PR 4 — integration coverage for runRegulatoryAnalyze. Real DB
// for RegulatorySource + RegulatoryArticle + Practice + RegulatoryAlert.
// analyzeArticle is mocked so tests are offline + deterministic; we're
// verifying the orchestration (per-practice fan-out, framework
// intersection, replay safety, batch limit, fail-soft), not Claude calls.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/regulatory/analyzeArticle", () => ({
  analyzeArticle: vi.fn(),
}));

import { db } from "@/lib/db";
import { analyzeArticle } from "@/lib/regulatory/analyzeArticle";
import { runRegulatoryAnalyze } from "@/lib/regulatory/runAnalyze";
import type { RegulatoryRelevanceOutput } from "@/lib/ai/prompts/regulatoryRelevance";

const mockAnalyzeArticle = vi.mocked(analyzeArticle);

beforeEach(() => {
  mockAnalyzeArticle.mockReset();
});

async function ensureFramework(code: string, name: string) {
  return db.regulatoryFramework.upsert({
    where: { code },
    update: {},
    create: {
      code,
      name,
      description: `${code} test framework`,
      sortOrder: 0,
    },
  });
}

async function seedSource(name = "Test source") {
  return db.regulatorySource.create({
    data: {
      name,
      url: `https://example.com/${Math.random().toString(36).slice(2, 10)}.xml`,
      feedType: "RSS",
      isActive: true,
      defaultFrameworks: [],
    },
  });
}

async function seedArticle(opts: {
  sourceId: string;
  title?: string;
  url?: string;
}) {
  return db.regulatoryArticle.create({
    data: {
      sourceId: opts.sourceId,
      title: opts.title ?? "Test article",
      url: opts.url ?? `https://example.com/${Math.random().toString(36).slice(2, 12)}`,
      summary: "Test summary",
      rawContent: "Test raw content",
      publishDate: new Date("2026-04-15T10:00:00Z"),
    },
  });
}

async function seedPractice(label: string, frameworks: string[]) {
  const practice = await db.practice.create({
    data: { name: `Analyze Test ${label}`, primaryState: "AZ" },
  });
  for (const code of frameworks) {
    const fw = await ensureFramework(code, code);
    await db.practiceFramework.create({
      data: {
        practiceId: practice.id,
        frameworkId: fw.id,
        enabled: true,
      },
    });
  }
  return practice;
}

function output(opts: {
  hipaa?: "LOW" | "MED" | "HIGH";
  osha?: "LOW" | "MED" | "HIGH";
  severity?: "INFO" | "ADVISORY" | "URGENT";
  summary?: string;
  actions?: string[];
}): RegulatoryRelevanceOutput {
  return {
    perFrameworkRelevance: [
      {
        framework: "HIPAA",
        relevance: opts.hipaa ?? "LOW",
        reason: "test reason",
      },
      {
        framework: "OSHA",
        relevance: opts.osha ?? "LOW",
        reason: "test reason",
      },
      { framework: "OIG", relevance: "LOW", reason: "test reason" },
      { framework: "DEA", relevance: "LOW", reason: "test reason" },
      { framework: "CMS", relevance: "LOW", reason: "test reason" },
      { framework: "CLIA", relevance: "LOW", reason: "test reason" },
      { framework: "MACRA", relevance: "LOW", reason: "test reason" },
      { framework: "TCPA", relevance: "LOW", reason: "test reason" },
      { framework: "ALLERGY", relevance: "LOW", reason: "test reason" },
    ],
    severity: opts.severity ?? "ADVISORY",
    summary: opts.summary ?? "Test summary",
    recommendedActions: opts.actions ?? ["Test action 1", "Test action 2"],
  };
}

describe("runRegulatoryAnalyze", () => {
  it("fans out alerts only to practices whose enabled frameworks match the article's relevant frameworks", async () => {
    const source = await seedSource();
    const hipaaArticle = await seedArticle({
      sourceId: source.id,
      title: "HIPAA news",
    });
    const oshaArticle = await seedArticle({
      sourceId: source.id,
      title: "OSHA news",
    });

    const hipaaPractice = await seedPractice("hipaa-only", ["HIPAA"]);
    const oshaPractice = await seedPractice("osha-only", ["OSHA"]);
    const noFwPractice = await seedPractice("no-fw", []);

    mockAnalyzeArticle.mockImplementation(async (input) => {
      if (input.article.title === "HIPAA news") {
        return output({ hipaa: "HIGH", severity: "URGENT" });
      }
      return output({ osha: "MED", severity: "ADVISORY" });
    });

    const summary = await runRegulatoryAnalyze();

    expect(summary.articlesAnalyzed).toBe(2);
    expect(summary.alertsCreated).toBe(2); // 1 for HIPAA practice + 1 for OSHA practice
    expect(summary.practicesScanned).toBe(3);
    expect(summary.errors).toEqual([]);
    expect(mockAnalyzeArticle).toHaveBeenCalledTimes(2);

    // HIPAA practice gets exactly 1 alert (the HIPAA article)
    const hipaaAlerts = await db.regulatoryAlert.findMany({
      where: { practiceId: hipaaPractice.id },
    });
    expect(hipaaAlerts).toHaveLength(1);
    expect(hipaaAlerts[0]!.articleId).toBe(hipaaArticle.id);
    expect(hipaaAlerts[0]!.matchedFrameworks).toEqual(["HIPAA"]);
    expect(hipaaAlerts[0]!.severity).toBe("URGENT");

    // OSHA practice gets exactly 1 alert (the OSHA article)
    const oshaAlerts = await db.regulatoryAlert.findMany({
      where: { practiceId: oshaPractice.id },
    });
    expect(oshaAlerts).toHaveLength(1);
    expect(oshaAlerts[0]!.articleId).toBe(oshaArticle.id);
    expect(oshaAlerts[0]!.matchedFrameworks).toEqual(["OSHA"]);

    // No-framework practice gets 0 alerts.
    const noFwAlerts = await db.regulatoryAlert.findMany({
      where: { practiceId: noFwPractice.id },
    });
    expect(noFwAlerts).toHaveLength(0);

    // Both articles have analyzedAt stamped + relevantFrameworks set.
    const refreshedHipaa = await db.regulatoryArticle.findUniqueOrThrow({
      where: { id: hipaaArticle.id },
    });
    expect(refreshedHipaa.analyzedAt).not.toBeNull();
    expect(refreshedHipaa.relevantFrameworks).toEqual(["HIPAA"]);

    const refreshedOsha = await db.regulatoryArticle.findUniqueOrThrow({
      where: { id: oshaArticle.id },
    });
    expect(refreshedOsha.analyzedAt).not.toBeNull();
    expect(refreshedOsha.relevantFrameworks).toEqual(["OSHA"]);
  });

  it("creates no alerts when every framework comes back LOW (still marks article analyzed)", async () => {
    const source = await seedSource();
    const article = await seedArticle({ sourceId: source.id });
    await seedPractice("hipaa-only", ["HIPAA"]);

    mockAnalyzeArticle.mockResolvedValue(output({})); // all defaults = all LOW

    const summary = await runRegulatoryAnalyze();

    expect(summary.articlesAnalyzed).toBe(1);
    expect(summary.alertsCreated).toBe(0);
    expect(summary.errors).toEqual([]);

    const alerts = await db.regulatoryAlert.findMany({});
    expect(alerts).toHaveLength(0);

    const refreshed = await db.regulatoryArticle.findUniqueOrThrow({
      where: { id: article.id },
    });
    expect(refreshed.analyzedAt).not.toBeNull();
    expect(refreshed.relevantFrameworks).toEqual([]);
  });

  it("silently skips P2002 unique-violation when an alert for (practice, article) already exists", async () => {
    const source = await seedSource();
    const article = await seedArticle({ sourceId: source.id });
    const practice = await seedPractice("hipaa-only", ["HIPAA"]);

    // Pre-existing alert that the run will collide with.
    await db.regulatoryAlert.create({
      data: {
        practiceId: practice.id,
        articleId: article.id,
        alertBody: "pre-existing",
        recommendedActions: [],
        severity: "INFO",
        matchedFrameworks: ["HIPAA"],
      },
    });

    mockAnalyzeArticle.mockResolvedValue(
      output({ hipaa: "HIGH", severity: "URGENT" }),
    );

    const summary = await runRegulatoryAnalyze();

    // Article still gets analyzed; alert insert is silently skipped.
    expect(summary.articlesAnalyzed).toBe(1);
    expect(summary.alertsCreated).toBe(0);
    expect(summary.errors).toEqual([]);

    const alerts = await db.regulatoryAlert.findMany({
      where: { articleId: article.id },
    });
    // Still exactly 1 alert (the pre-existing one), not duplicated.
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.alertBody).toBe("pre-existing");
  });

  it("does NOT mark article analyzed when analyzer returns null; logs error in summary", async () => {
    const source = await seedSource();
    const article = await seedArticle({ sourceId: source.id });
    await seedPractice("hipaa-only", ["HIPAA"]);

    mockAnalyzeArticle.mockResolvedValue(null);

    const summary = await runRegulatoryAnalyze();

    expect(summary.articlesAnalyzed).toBe(0);
    expect(summary.alertsCreated).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toEqual({
      articleId: article.id,
      message: "analyzer returned null",
    });

    // analyzedAt remains null so the next run can retry.
    const refreshed = await db.regulatoryArticle.findUniqueOrThrow({
      where: { id: article.id },
    });
    expect(refreshed.analyzedAt).toBeNull();

    // No alerts created.
    const alerts = await db.regulatoryAlert.findMany({});
    expect(alerts).toHaveLength(0);
  });

  it("respects ANALYZE_BATCH_LIMIT (50) when more unanalyzed articles exist", async () => {
    const source = await seedSource();
    // Create 51 unanalyzed articles. Slight ingestedAt offset ensures
    // a deterministic order-by ascending sort (oldest first).
    const created: { id: string }[] = [];
    for (let i = 0; i < 51; i += 1) {
      const a = await db.regulatoryArticle.create({
        data: {
          sourceId: source.id,
          title: `batch article ${i + 1}`,
          url: `https://example.com/batch/${i + 1}`,
          summary: "x",
          rawContent: "x",
          publishDate: new Date("2026-04-15T10:00:00Z"),
          // Force ingestedAt to be increasing so the 51st (newest) is the
          // one left unanalyzed by the batch limit.
          ingestedAt: new Date(Date.now() + i * 10),
        },
      });
      created.push({ id: a.id });
    }
    await seedPractice("hipaa-only", ["HIPAA"]);

    mockAnalyzeArticle.mockResolvedValue(output({ hipaa: "HIGH" }));

    const summary = await runRegulatoryAnalyze();

    expect(summary.articlesAnalyzed).toBe(50);
    expect(mockAnalyzeArticle).toHaveBeenCalledTimes(50);

    // 50 of the 51 articles should now have analyzedAt stamped; exactly
    // one (the newest, by ingestedAt asc batch) remains unanalyzed.
    const stillPending = await db.regulatoryArticle.findMany({
      where: { analyzedAt: null },
    });
    expect(stillPending).toHaveLength(1);

    const analyzed = await db.regulatoryArticle.findMany({
      where: { analyzedAt: { not: null } },
    });
    expect(analyzed).toHaveLength(50);
  });
});
