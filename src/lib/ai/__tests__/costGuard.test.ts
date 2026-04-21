// src/lib/ai/__tests__/costGuard.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { assertMonthlyCostBudget } from "@/lib/ai/costGuard";

async function seedPractice() {
  const practice = await db.practice.create({
    data: { name: "Test", primaryState: "AZ" },
  });
  return practice;
}

beforeEach(() => {
  process.env.LLM_MONTHLY_BUDGET_USD = "10";
});

describe("assertMonthlyCostBudget", () => {
  it("passes when total month cost < budget", async () => {
    const p = await seedPractice();
    await db.llmCall.create({
      data: {
        promptId: "x",
        promptVersion: 1,
        model: "claude-opus-4-7",
        inputHash: "a".repeat(64),
        latencyMs: 10,
        success: true,
        costUsd: 2 as unknown as null,
        practiceId: p.id,
      },
    });
    await expect(assertMonthlyCostBudget()).resolves.toBeUndefined();
  });

  it("throws COST_BUDGET_EXCEEDED when month cost >= budget", async () => {
    const p = await seedPractice();
    await db.llmCall.create({
      data: {
        promptId: "x",
        promptVersion: 1,
        model: "claude-opus-4-7",
        inputHash: "a".repeat(64),
        latencyMs: 10,
        success: true,
        costUsd: 10.5 as unknown as null,
        practiceId: p.id,
      },
    });
    await expect(assertMonthlyCostBudget()).rejects.toThrow(/COST_BUDGET_EXCEEDED/);
  });

  it("ignores LlmCall rows from prior months", async () => {
    const p = await seedPractice();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await db.llmCall.create({
      data: {
        promptId: "x",
        promptVersion: 1,
        model: "claude-opus-4-7",
        inputHash: "a".repeat(64),
        latencyMs: 10,
        success: true,
        costUsd: 50 as unknown as null,
        createdAt: lastMonth,
        practiceId: p.id,
      },
    });
    await expect(assertMonthlyCostBudget()).resolves.toBeUndefined();
  });

  it("passes through when LLM_MONTHLY_BUDGET_USD is unset", async () => {
    delete process.env.LLM_MONTHLY_BUDGET_USD;
    const p = await seedPractice();
    await db.llmCall.create({
      data: {
        promptId: "x",
        promptVersion: 1,
        model: "claude-opus-4-7",
        inputHash: "a".repeat(64),
        latencyMs: 10,
        success: true,
        costUsd: 9999 as unknown as null,
        practiceId: p.id,
      },
    });
    await expect(assertMonthlyCostBudget()).resolves.toBeUndefined();
  });
});
