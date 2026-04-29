// src/lib/ai/__tests__/conciergeMonthlySpend.test.ts
//
// Integration tests for the dashboard cost tile helper. Hits real
// Postgres (matches the costGuard test harness one folder up). Each test
// seeds + asserts; tests/setup.ts cleans LlmCall/Practice between cases.

import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { getConciergeMonthlySpend } from "@/lib/ai/conciergeMonthlySpend";

const CONCIERGE_PROMPT_ID = "concierge.chat.v1";

async function seedPractice(name = "Test Practice") {
  return db.practice.create({
    data: { name, primaryState: "AZ" },
  });
}

interface SeedLlmCallArgs {
  practiceId: string;
  promptId?: string;
  costUsd?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  success?: boolean;
  createdAt?: Date;
}

async function seedLlmCall(args: SeedLlmCallArgs) {
  return db.llmCall.create({
    data: {
      practiceId: args.practiceId,
      promptId: args.promptId ?? CONCIERGE_PROMPT_ID,
      promptVersion: 1,
      model: "claude-sonnet-4-6",
      inputHash: "a".repeat(64),
      latencyMs: 10,
      success: args.success ?? true,
      // Prisma's Decimal column accepts JS numbers; cast through unknown to
      // satisfy the generated type without bringing the Decimal lib in.
      costUsd:
        args.costUsd === undefined
          ? (0.05 as unknown as null)
          : args.costUsd === null
            ? null
            : (args.costUsd as unknown as null),
      inputTokens: args.inputTokens ?? 0,
      outputTokens: args.outputTokens ?? 0,
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    },
  });
}

describe("getConciergeMonthlySpend", () => {
  it("returns all zeros when the practice has no LlmCall rows", async () => {
    const p = await seedPractice();
    const result = await getConciergeMonthlySpend({ practiceId: p.id });
    expect(result).toEqual({
      costUsd: 0,
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("sums costUsd, messageCount, and tokens for the current month", async () => {
    const p = await seedPractice();
    await seedLlmCall({
      practiceId: p.id,
      costUsd: 0.05,
      inputTokens: 100,
      outputTokens: 50,
    });
    await seedLlmCall({
      practiceId: p.id,
      costUsd: 0.1,
      inputTokens: 200,
      outputTokens: 75,
    });
    await seedLlmCall({
      practiceId: p.id,
      costUsd: 0.15,
      inputTokens: 300,
      outputTokens: 100,
    });

    const result = await getConciergeMonthlySpend({ practiceId: p.id });
    // Float arithmetic: 0.05 + 0.10 + 0.15 may not exactly equal 0.30,
    // assert close-enough.
    expect(result.costUsd).toBeCloseTo(0.3, 6);
    expect(result.messageCount).toBe(3);
    expect(result.inputTokens).toBe(600);
    expect(result.outputTokens).toBe(225);
  });

  it("filters by promptId — ignores rows for other prompts", async () => {
    const p = await seedPractice();
    // Two concierge rows
    await seedLlmCall({ practiceId: p.id, costUsd: 0.05 });
    await seedLlmCall({ practiceId: p.id, costUsd: 0.1 });
    // Two rows for a different prompt
    await seedLlmCall({
      practiceId: p.id,
      promptId: "hipaa.assess.v1",
      costUsd: 1.0,
    });
    await seedLlmCall({
      practiceId: p.id,
      promptId: "hipaa.assess.v1",
      costUsd: 2.0,
    });

    const result = await getConciergeMonthlySpend({ practiceId: p.id });
    expect(result.messageCount).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.15, 6);
  });

  it("filters by practiceId — ignores rows for other practices", async () => {
    const pA = await seedPractice("Practice A");
    const pB = await seedPractice("Practice B");
    // Practice A: 2 rows totaling $0.20
    await seedLlmCall({ practiceId: pA.id, costUsd: 0.05 });
    await seedLlmCall({ practiceId: pA.id, costUsd: 0.15 });
    // Practice B: 1 row, $5 (must NOT bleed into A's total)
    await seedLlmCall({ practiceId: pB.id, costUsd: 5.0 });

    const result = await getConciergeMonthlySpend({ practiceId: pA.id });
    expect(result.messageCount).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.2, 6);
  });

  it("excludes rows from prior months", async () => {
    const p = await seedPractice();
    // Last month — explicit UTC mid-month timestamp.
    const now = new Date();
    const lastMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12, 0, 0),
    );
    await seedLlmCall({
      practiceId: p.id,
      costUsd: 99.0,
      createdAt: lastMonth,
    });
    // This month
    await seedLlmCall({ practiceId: p.id, costUsd: 0.07 });

    const result = await getConciergeMonthlySpend({ practiceId: p.id });
    expect(result.messageCount).toBe(1);
    expect(result.costUsd).toBeCloseTo(0.07, 6);
  });

  it("counts failed rows (success=false, costUsd=null) toward messageCount but not the sum", async () => {
    const p = await seedPractice();
    await seedLlmCall({ practiceId: p.id, costUsd: 0.04 });
    await seedLlmCall({
      practiceId: p.id,
      success: false,
      costUsd: null,
    });

    const result = await getConciergeMonthlySpend({ practiceId: p.id });
    expect(result.messageCount).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.04, 6);
  });
});
