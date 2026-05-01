// src/lib/regulatory/analyzeArticle.test.ts
//
// Phase 8 PR 4 — analyzeArticle unit tests.
//
// Pure-unit: vi.mock("@/lib/ai") + vi.mock("@/lib/ai/costGuard") so we
// never hit Claude or the DB. The wrapper has three paths:
//   1. Happy path — return runLlm output verbatim.
//   2. runLlm throws — fail-soft to null (no rethrow).
//   3. cost guard throws COST_BUDGET_EXCEEDED — fail-soft to null
//      (runLlm never called).

import { describe, it, expect, vi, beforeEach } from "vitest";

const runLlmMock = vi.fn();
vi.mock("@/lib/ai", () => ({
  runLlm: (...args: unknown[]) => runLlmMock(...args),
}));

const assertMonthlyCostBudgetMock = vi.fn();
vi.mock("@/lib/ai/costGuard", () => ({
  assertMonthlyCostBudget: (...args: unknown[]) =>
    assertMonthlyCostBudgetMock(...args),
}));

import { analyzeArticle } from "./analyzeArticle";
import type {
  RegulatoryRelevanceInput,
  RegulatoryRelevanceOutput,
} from "@/lib/ai/prompts/regulatoryRelevance";

const baseInput: RegulatoryRelevanceInput = {
  article: {
    title: "HHS finalizes new HIPAA Security Rule update",
    url: "https://example.com/hhs/rule",
    summary: "Final rule strengthens encryption requirements.",
    rawContent: null,
    publishDate: "2026-04-15T00:00:00Z",
    sourceName: "HHS OCR",
  },
  frameworks: ["HIPAA", "OSHA"],
};

const baseOutput: RegulatoryRelevanceOutput = {
  perFrameworkRelevance: [
    {
      framework: "HIPAA",
      relevance: "HIGH",
      reason: "Direct HIPAA Security Rule change",
    },
    {
      framework: "OSHA",
      relevance: "LOW",
      reason: "No OSHA touchpoint",
    },
  ],
  severity: "ADVISORY",
  summary:
    "HHS has updated the HIPAA Security Rule encryption baseline. Practices should review their Security Rule controls.",
  recommendedActions: [
    "Review Security Rule technical safeguards",
    "Update Privacy Policy if needed",
  ],
};

const ctx = { practiceId: "p1", actorUserId: "u1" };

describe("analyzeArticle", () => {
  beforeEach(() => {
    runLlmMock.mockReset();
    assertMonthlyCostBudgetMock.mockReset();
    // Default: cost guard passes. Failure-path tests override this.
    assertMonthlyCostBudgetMock.mockResolvedValue(undefined);
  });

  it("returns the parsed runLlm output verbatim on the happy path", async () => {
    runLlmMock.mockResolvedValue({
      output: baseOutput,
      llmCallId: "call_1",
      latencyMs: 250,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    const result = await analyzeArticle(baseInput, ctx);

    expect(result).toEqual(baseOutput);
    expect(runLlmMock).toHaveBeenCalledTimes(1);
    expect(runLlmMock).toHaveBeenCalledWith(
      "analyzer.regulatory-relevance.v1",
      baseInput,
      expect.objectContaining({
        practiceId: "p1",
        actorUserId: "u1",
      }),
    );
  });

  it("returns null without rethrowing when runLlm throws", async () => {
    runLlmMock.mockRejectedValue(new Error("UPSTREAM"));

    const result = await analyzeArticle(baseInput, ctx);

    expect(result).toBeNull();
    expect(runLlmMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the cost guard trips (does not call runLlm)", async () => {
    assertMonthlyCostBudgetMock.mockRejectedValue(
      new Error("COST_BUDGET_EXCEEDED: $20.00 used this month (budget $10.00)"),
    );

    const result = await analyzeArticle(baseInput, ctx);

    expect(result).toBeNull();
    // Cost guard short-circuits before runLlm is invoked.
    expect(runLlmMock).not.toHaveBeenCalled();
  });
});
