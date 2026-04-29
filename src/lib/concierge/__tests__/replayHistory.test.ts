// src/lib/concierge/__tests__/replayHistory.test.ts
//
// Pure-logic unit tests for replayThreadHistory. No DB. No jsdom.
// Synthetic ConversationMessageRow inputs in, UIMessage[] outputs asserted.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  replayThreadHistory,
  type ConversationMessageRow,
} from "@/lib/concierge/replayHistory";

// Minimal payload factory matching the shape projectConciergeToolInvoked
// writes to the TOOL row's payload column (see
// src/lib/events/projections/conciergeThread.ts).
function toolPayload(overrides: {
  toolInvocationId: string;
  toolName: string;
  latencyMs: number;
  error: string | null;
}) {
  return {
    toolInvocationId: overrides.toolInvocationId,
    threadId: "thread_1",
    messageId: overrides.toolInvocationId,
    toolName: overrides.toolName,
    toolInput: { foo: "bar" },
    toolOutput: { ok: true },
    latencyMs: overrides.latencyMs,
    error: overrides.error,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replayThreadHistory", () => {
  it("returns an empty array for empty input", () => {
    expect(replayThreadHistory([])).toEqual([]);
  });

  it("emits a single UserMessage for a USER-only row", () => {
    const rows: ConversationMessageRow[] = [
      { id: "u1", role: "USER", content: "hello", payload: {} },
    ];
    const out = replayThreadHistory(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: "u1",
      role: "user",
      content: "hello",
    });
  });

  it("emits USER + ASSISTANT (no tools) → UserMessage + AssistantMessage with single text part", () => {
    const rows: ConversationMessageRow[] = [
      { id: "u1", role: "USER", content: "hi", payload: {} },
      {
        id: "a1",
        role: "ASSISTANT",
        content: "hello back",
        payload: {},
      },
    ];
    const out = replayThreadHistory(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "u1",
      role: "user",
      content: "hi",
    });
    expect(out[1]).toEqual({
      id: "a1",
      role: "assistant",
      parts: [{ kind: "text", text: "hello back" }],
      streaming: false,
    });
  });

  it("groups USER + TOOL + TOOL + ASSISTANT into a single AssistantMessage with [tool, tool, text] parts", () => {
    const rows: ConversationMessageRow[] = [
      { id: "u1", role: "USER", content: "score?", payload: {} },
      {
        id: "t1",
        role: "TOOL",
        content: "list_frameworks",
        payload: toolPayload({
          toolInvocationId: "t1",
          toolName: "list_frameworks",
          latencyMs: 42,
          error: null,
        }),
      },
      {
        id: "t2",
        role: "TOOL",
        content: "get_compliance_score",
        payload: toolPayload({
          toolInvocationId: "t2",
          toolName: "get_compliance_score",
          latencyMs: 88,
          error: null,
        }),
      },
      {
        id: "a1",
        role: "ASSISTANT",
        content: "Your HIPAA score is 92.",
        payload: {},
      },
    ];
    const out = replayThreadHistory(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "u1", role: "user" });
    expect(out[1]?.role).toBe("assistant");
    if (out[1]?.role !== "assistant") throw new Error("expected assistant");
    const assistant = out[1];
    expect(assistant.streaming).toBe(false);
    expect(assistant.parts).toHaveLength(3);
    expect(assistant.parts[0]).toEqual({
      kind: "tool",
      toolUseId: "t1",
      toolName: "list_frameworks",
      status: "done",
      latencyMs: 42,
      errorMessage: null,
    });
    expect(assistant.parts[1]).toEqual({
      kind: "tool",
      toolUseId: "t2",
      toolName: "get_compliance_score",
      status: "done",
      latencyMs: 88,
      errorMessage: null,
    });
    expect(assistant.parts[2]).toEqual({
      kind: "text",
      text: "Your HIPAA score is 92.",
    });
  });

  it("renders TOOL rows with non-null error as status: 'error' chips with errorMessage", () => {
    const rows: ConversationMessageRow[] = [
      { id: "u1", role: "USER", content: "show incidents", payload: {} },
      {
        id: "t1",
        role: "TOOL",
        content: "list_incidents",
        payload: toolPayload({
          toolInvocationId: "t1",
          toolName: "list_incidents",
          latencyMs: 15,
          error: "Database connection lost",
        }),
      },
      {
        id: "a1",
        role: "ASSISTANT",
        content: "I couldn't fetch incidents.",
        payload: {},
      },
    ];
    const out = replayThreadHistory(rows);
    expect(out).toHaveLength(2);
    if (out[1]?.role !== "assistant") throw new Error("expected assistant");
    const assistant = out[1];
    expect(assistant.parts[0]).toEqual({
      kind: "tool",
      toolUseId: "t1",
      toolName: "list_incidents",
      status: "error",
      latencyMs: 15,
      errorMessage: "Database connection lost",
    });
    expect(assistant.parts[1]).toEqual({
      kind: "text",
      text: "I couldn't fetch incidents.",
    });
  });

  it("groups multi-turn conversations into per-turn assistant bubbles correctly", () => {
    const rows: ConversationMessageRow[] = [
      { id: "u1", role: "USER", content: "q1", payload: {} },
      {
        id: "t1",
        role: "TOOL",
        content: "tool_a",
        payload: toolPayload({
          toolInvocationId: "t1",
          toolName: "tool_a",
          latencyMs: 10,
          error: null,
        }),
      },
      { id: "a1", role: "ASSISTANT", content: "answer 1", payload: {} },
      { id: "u2", role: "USER", content: "q2", payload: {} },
      {
        id: "t2",
        role: "TOOL",
        content: "tool_b",
        payload: toolPayload({
          toolInvocationId: "t2",
          toolName: "tool_b",
          latencyMs: 20,
          error: null,
        }),
      },
      {
        id: "t3",
        role: "TOOL",
        content: "tool_c",
        payload: toolPayload({
          toolInvocationId: "t3",
          toolName: "tool_c",
          latencyMs: 30,
          error: null,
        }),
      },
      { id: "a2", role: "ASSISTANT", content: "answer 2", payload: {} },
    ];
    const out = replayThreadHistory(rows);
    expect(out).toHaveLength(4);
    // Turn 1: USER + ASSISTANT(1 tool, text)
    expect(out[0]).toMatchObject({ id: "u1", role: "user" });
    if (out[1]?.role !== "assistant") throw new Error("expected assistant");
    expect(out[1].parts).toHaveLength(2);
    expect(out[1].parts[0]).toMatchObject({
      kind: "tool",
      toolName: "tool_a",
    });
    expect(out[1].parts[1]).toEqual({ kind: "text", text: "answer 1" });
    // Turn 2: USER + ASSISTANT(2 tools, text)
    expect(out[2]).toMatchObject({ id: "u2", role: "user" });
    if (out[3]?.role !== "assistant") throw new Error("expected assistant");
    expect(out[3].parts).toHaveLength(3);
    expect(out[3].parts[0]).toMatchObject({
      kind: "tool",
      toolName: "tool_b",
    });
    expect(out[3].parts[1]).toMatchObject({
      kind: "tool",
      toolName: "tool_c",
    });
    expect(out[3].parts[2]).toEqual({ kind: "text", text: "answer 2" });
  });

  it("warns + skips a TOOL row whose payload is missing required fields, but still renders the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows: ConversationMessageRow[] = [
      { id: "u1", role: "USER", content: "q", payload: {} },
      {
        id: "t_bad",
        role: "TOOL",
        content: "garbage",
        // Missing toolName — Zod safeParse will fail.
        payload: {
          toolInvocationId: "t_bad",
          latencyMs: 5,
          error: null,
        },
      },
      {
        id: "t_good",
        role: "TOOL",
        content: "tool_ok",
        payload: toolPayload({
          toolInvocationId: "t_good",
          toolName: "tool_ok",
          latencyMs: 12,
          error: null,
        }),
      },
      { id: "a1", role: "ASSISTANT", content: "done", payload: {} },
    ];
    const out = replayThreadHistory(rows);
    expect(warn).toHaveBeenCalled();
    // The warn call should reference the bad row's id.
    const calls = warn.mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => s.includes("t_bad"))).toBe(true);
    // Output: USER + ASSISTANT with one tool chip (the good one) + text.
    expect(out).toHaveLength(2);
    if (out[1]?.role !== "assistant") throw new Error("expected assistant");
    expect(out[1].parts).toHaveLength(2);
    expect(out[1].parts[0]).toMatchObject({
      kind: "tool",
      toolName: "tool_ok",
    });
    expect(out[1].parts[1]).toEqual({ kind: "text", text: "done" });
  });

  it("warns + drops trailing TOOL rows that have no closing ASSISTANT, but still emits prior messages", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows: ConversationMessageRow[] = [
      { id: "u1", role: "USER", content: "q", payload: {} },
      { id: "a1", role: "ASSISTANT", content: "answer", payload: {} },
      { id: "u2", role: "USER", content: "q2", payload: {} },
      {
        id: "t_dangling",
        role: "TOOL",
        content: "tool_x",
        payload: toolPayload({
          toolInvocationId: "t_dangling",
          toolName: "tool_x",
          latencyMs: 9,
          error: null,
        }),
      },
      // NO closing ASSISTANT for the second turn — interrupted stream.
    ];
    const out = replayThreadHistory(rows);
    expect(warn).toHaveBeenCalled();
    // Output: u1, a1 (with text only), u2. No assistant bubble for the
    // interrupted second turn — the dangling tool is dropped.
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "u1", role: "user" });
    expect(out[1]).toMatchObject({ id: "a1", role: "assistant" });
    if (out[1]?.role !== "assistant") throw new Error("expected assistant");
    expect(out[1].parts).toEqual([{ kind: "text", text: "answer" }]);
    expect(out[2]).toMatchObject({ id: "u2", role: "user" });
  });

  it("warns + drops a TOOL row that appears before any USER (broken ordering)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows: ConversationMessageRow[] = [
      {
        id: "t_orphan",
        role: "TOOL",
        content: "tool_x",
        payload: toolPayload({
          toolInvocationId: "t_orphan",
          toolName: "tool_x",
          latencyMs: 5,
          error: null,
        }),
      },
      { id: "u1", role: "USER", content: "q", payload: {} },
      { id: "a1", role: "ASSISTANT", content: "answer", payload: {} },
    ];
    const out = replayThreadHistory(rows);
    expect(warn).toHaveBeenCalled();
    // The orphan is flushed when USER arrives. The remaining USER +
    // ASSISTANT pair renders normally with no tool chip.
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "u1", role: "user" });
    if (out[1]?.role !== "assistant") throw new Error("expected assistant");
    expect(out[1].parts).toEqual([{ kind: "text", text: "answer" }]);
  });
});
