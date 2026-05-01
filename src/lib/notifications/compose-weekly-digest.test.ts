// src/lib/notifications/compose-weekly-digest.test.ts
//
// Phase 7 PR 7 — composeWeeklyDigest unit tests.
//
// Pure-unit: vi.mock("@/lib/ai") so we never hit Claude or the DB. The
// helper has two paths:
//   1. Happy path — pass runLlm output through verbatim.
//   2. Fail-soft fallback — runLlm throws → fallbackTemplate renders a
//      plain summary so the digest email still ships even when the
//      LLM provider is down or the cost-guard tripped.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock must be hoisted; declare shared mock functions used by all cases.
const runLlmMock = vi.fn();
vi.mock("@/lib/ai", () => ({
  runLlm: (...args: unknown[]) => runLlmMock(...args),
}));

const assertMonthlyCostBudgetMock = vi.fn();
vi.mock("@/lib/ai/costGuard", () => ({
  assertMonthlyCostBudget: (...args: unknown[]) =>
    assertMonthlyCostBudgetMock(...args),
}));

import { composeWeeklyDigest } from "./compose-weekly-digest";
import type { NotificationWeeklyDigestInput } from "@/lib/ai/prompts/notificationWeeklyDigest";

const baseInput: NotificationWeeklyDigestInput = {
  practiceName: "Test Dental",
  userRole: "ADMIN",
  notifications: [
    {
      title: "Renew DEA registration",
      severity: "WARNING",
      type: "DEA_RENEWAL_DUE",
      body: "Expires in 21 days",
    },
  ],
  scoreChange: { previous: 80, current: 84 },
};

const ctx = { practiceId: "p1", actorUserId: "u1" };

describe("composeWeeklyDigest", () => {
  beforeEach(() => {
    runLlmMock.mockReset();
    assertMonthlyCostBudgetMock.mockReset();
    // Default: cost guard passes. Tests that need the throw override this.
    assertMonthlyCostBudgetMock.mockResolvedValue(undefined);
  });

  it("returns the runLlm output verbatim on the happy path", async () => {
    runLlmMock.mockResolvedValue({
      output: { summary: "test summary", topAction: "test action" },
      llmCallId: "call_1",
      latencyMs: 200,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    const result = await composeWeeklyDigest(baseInput, ctx);

    expect(result).toEqual({
      summary: "test summary",
      topAction: "test action",
    });
    expect(runLlmMock).toHaveBeenCalledTimes(1);
    expect(runLlmMock).toHaveBeenCalledWith(
      "notification.weekly-digest.v1",
      baseInput,
      expect.objectContaining({
        practiceId: "p1",
        actorUserId: "u1",
        allowPHI: true,
      }),
    );
  });

  it("falls back to a template when runLlm throws", async () => {
    runLlmMock.mockRejectedValue(new Error("api down"));

    const result = await composeWeeklyDigest(baseInput, ctx);

    expect(result.topAction).toBeNull();
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('uses the "quiet week" copy when there are zero notifications', async () => {
    runLlmMock.mockRejectedValue(new Error("api down"));

    const input: NotificationWeeklyDigestInput = {
      ...baseInput,
      notifications: [],
    };

    const result = await composeWeeklyDigest(input, ctx);

    expect(result.topAction).toBeNull();
    expect(result.summary.toLowerCase()).toContain("quiet");
    expect(result.summary).toContain("Test Dental");
  });

  it("falls back to template when the cost guard is tripped (does not call runLlm)", async () => {
    assertMonthlyCostBudgetMock.mockRejectedValue(
      new Error("COST_BUDGET_EXCEEDED: $20.00 used this month (budget $10.00)"),
    );

    const result = await composeWeeklyDigest(baseInput, ctx);

    // Cost guard short-circuits before runLlm is invoked.
    expect(runLlmMock).not.toHaveBeenCalled();
    // Falls back to the template shape.
    expect(result.topAction).toBeNull();
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary).toContain("Test Dental");
  });

  it("counts items by type in the fallback summary", async () => {
    runLlmMock.mockRejectedValue(new Error("cost guard tripped"));

    const input: NotificationWeeklyDigestInput = {
      ...baseInput,
      notifications: [
        {
          title: "Renew DEA",
          severity: "WARNING",
          type: "DEA_RENEWAL_DUE",
          body: "x",
        },
        {
          title: "DEA again",
          severity: "WARNING",
          type: "DEA_RENEWAL_DUE",
          body: "y",
        },
        {
          title: "Policy ack",
          severity: "INFO",
          type: "POLICY_ACK_PENDING",
          body: "z",
        },
        {
          title: "Policy ack 2",
          severity: "INFO",
          type: "POLICY_ACK_PENDING",
          body: "z",
        },
        {
          title: "Sharps log overdue",
          severity: "CRITICAL",
          type: "SHARPS_LOG_OVERDUE",
          body: "w",
        },
      ],
    };

    const result = await composeWeeklyDigest(input, ctx);

    expect(result.topAction).toBeNull();
    // Total count + practice name show up.
    expect(result.summary).toContain("5 items");
    expect(result.summary).toContain("Test Dental");
    // Each type and its count must appear.
    expect(result.summary).toContain("2 DEA_RENEWAL_DUE");
    expect(result.summary).toContain("2 POLICY_ACK_PENDING");
    expect(result.summary).toContain("1 SHARPS_LOG_OVERDUE");
  });
});
