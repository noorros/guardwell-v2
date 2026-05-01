// tests/integration/regulatory-pipeline.test.ts
//
// Phase 8 PR 5 — end-to-end coverage of the 3-cron pipeline:
//   ingest (RegulatorySource → RegulatoryArticle)
//   → analyze (RegulatoryArticle → RegulatoryAlert)
//   → notify (RegulatoryAlert → Notification)
//
// Both AI seams are mocked (parseRssFeed for the RSS adapter,
// analyzeArticle for Claude). Real DB everywhere else. This is the
// integration confidence test that proves a single article flows from
// RSS feed → DB row → AI alert → email-bound Notification.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/regulatory/parsers/rss", () => ({
  parseRssFeed: vi.fn(),
}));
vi.mock("@/lib/regulatory/analyzeArticle", () => ({
  analyzeArticle: vi.fn(),
}));

import { db } from "@/lib/db";
import { parseRssFeed } from "@/lib/regulatory/parsers/rss";
import { analyzeArticle } from "@/lib/regulatory/analyzeArticle";
import { runRegulatoryIngest } from "@/lib/regulatory/ingest";
import { runRegulatoryAnalyze } from "@/lib/regulatory/runAnalyze";
import { runRegulatoryNotify } from "@/lib/regulatory/runNotify";

const mockParseRssFeed = vi.mocked(parseRssFeed);
const mockAnalyzeArticle = vi.mocked(analyzeArticle);

beforeEach(() => {
  mockParseRssFeed.mockReset();
  mockAnalyzeArticle.mockReset();
});

async function ensureFramework(code: string) {
  return db.regulatoryFramework.upsert({
    where: { code },
    update: {},
    create: {
      code,
      name: code,
      description: `${code} test framework`,
      sortOrder: 0,
    },
  });
}

describe("Regulatory pipeline (ingest → analyze → notify)", () => {
  it("propagates one article from RSS feed to per-practice Notification end-to-end", async () => {
    // 1. Seed: 1 active source + 1 practice with HIPAA enabled + 2 admins.
    await db.regulatorySource.create({
      data: {
        name: "HHS OCR Test",
        url: "https://example.com/hhs.xml",
        feedType: "RSS",
        isActive: true,
        defaultFrameworks: ["HIPAA"],
      },
    });
    const fw = await ensureFramework("HIPAA");
    const owner = await db.user.create({
      data: {
        firebaseUid: `pipe-owner-${Math.random().toString(36).slice(2, 10)}`,
        email: `owner-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const admin = await db.user.create({
      data: {
        firebaseUid: `pipe-admin-${Math.random().toString(36).slice(2, 10)}`,
        email: `admin-${Math.random().toString(36).slice(2, 8)}@test.test`,
      },
    });
    const practice = await db.practice.create({
      data: { name: "Pipeline Test", primaryState: "AZ" },
    });
    await db.practiceUser.create({
      data: { userId: owner.id, practiceId: practice.id, role: "OWNER" },
    });
    await db.practiceUser.create({
      data: { userId: admin.id, practiceId: practice.id, role: "ADMIN" },
    });
    await db.practiceFramework.create({
      data: { practiceId: practice.id, frameworkId: fw.id, enabled: true },
    });

    // 2. Mock parseRssFeed to return 1 article.
    const articleUrl = "https://hhs.gov/breach/test-1";
    mockParseRssFeed.mockResolvedValueOnce([
      {
        title: "OCR finalizes new breach notification rule",
        url: articleUrl,
        summary: "OCR has updated breach notification timing requirements.",
        rawContent: "Full article content...",
        publishDate: new Date("2026-04-15T10:00:00Z"),
      },
    ]);

    // 3. Mock analyzeArticle to flag HIPAA as HIGH severity URGENT.
    mockAnalyzeArticle.mockResolvedValueOnce({
      perFrameworkRelevance: [
        {
          framework: "HIPAA",
          relevance: "HIGH",
          reason: "Direct breach rule change",
        },
        { framework: "OSHA", relevance: "LOW", reason: "n/a" },
        { framework: "OIG", relevance: "LOW", reason: "n/a" },
        { framework: "DEA", relevance: "LOW", reason: "n/a" },
        { framework: "CMS", relevance: "LOW", reason: "n/a" },
        { framework: "CLIA", relevance: "LOW", reason: "n/a" },
        { framework: "MACRA", relevance: "LOW", reason: "n/a" },
        { framework: "TCPA", relevance: "LOW", reason: "n/a" },
        { framework: "ALLERGY", relevance: "LOW", reason: "n/a" },
      ],
      severity: "URGENT",
      summary:
        "Breach rule timing has tightened — review your incident response SOP.",
      recommendedActions: [
        "Update incident response SOP",
        "Train staff on new timing rules",
      ],
    });

    // 4. Run all three crons in sequence.
    const ingestResult = await runRegulatoryIngest();
    expect(ingestResult.articlesIngested).toBe(1);
    expect(ingestResult.errors).toEqual([]);

    const analyzeResult = await runRegulatoryAnalyze();
    expect(analyzeResult.articlesAnalyzed).toBe(1);
    expect(analyzeResult.alertsCreated).toBe(1);
    expect(analyzeResult.errors).toEqual([]);

    const notifyResult = await runRegulatoryNotify();
    expect(notifyResult.alertsScanned).toBe(1);
    expect(notifyResult.notificationsCreated).toBe(2); // owner + admin
    expect(notifyResult.errors).toEqual([]);

    // 5. Verify DB state end-to-end.
    const article = await db.regulatoryArticle.findUniqueOrThrow({
      where: { url: articleUrl },
    });
    expect(article.analyzedAt).not.toBeNull();
    expect(article.relevantFrameworks).toEqual(["HIPAA"]);

    const alert = await db.regulatoryAlert.findUniqueOrThrow({
      where: {
        practiceId_articleId: {
          practiceId: practice.id,
          articleId: article.id,
        },
      },
    });
    expect(alert.severity).toBe("URGENT");
    expect(alert.matchedFrameworks).toEqual(["HIPAA"]);
    expect(alert.sentAt).not.toBeNull();

    const notifications = await db.notification.findMany({
      where: { practiceId: practice.id, type: "REGULATORY_ALERT" },
      orderBy: { userId: "asc" },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications.every((n) => n.severity === "CRITICAL")).toBe(true); // URGENT → CRITICAL
    expect(notifications[0]!.title).toContain("OCR finalizes");
    expect(notifications[0]!.href).toBe(`/audit/regulatory/${alert.id}`);
  });
});
