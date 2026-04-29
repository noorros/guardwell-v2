// src/lib/ai/streamConciergeTurn.ts
//
// The ONLY path for streaming Concierge responses. Multi-turn tool loop:
//   1. Resume conversation from ConversationMessage history (USER + ASSISTANT
//      rows; TOOL rows are NOT replayed because tool_use + tool_result blocks
//      must live inside the assistant turn that produced them — we don't
//      reconstruct that here. Pair-based FIFO compaction is implemented at
//      the history-load step. TOOL-row replay for the UI is implemented in
//      `src/lib/concierge/replayHistory.ts`; this generator's history-load
//      step still skips TOOL rows because the SDK requires tool_use+tool_result
//      blocks to live INSIDE the assistant turn that produced them —
//      replay-back-to-Claude would require richer reconstruction, which is
//      out of scope.)
//   2. Call Anthropic messages.stream() with the 8 read-only tools registered
//      in PR A2 (src/lib/ai/conciergeTools.ts)
//   3. On tool_use block: invoke tool handler via invokeTool(), append a
//      tool_result content block, continue the conversation
//   4. Stream text_delta + tool_use_started + tool_result events to the
//      caller via async generator
//   5. On end_turn (or hitting the iteration cap): write
//      CONCIERGE_MESSAGE_ASSISTANT_PRODUCED with the final assistant text,
//      tokens, cost, model, and stop reason.
//
// runLlm (src/lib/ai/runLlm.ts) handles single-turn structured output;
// streamConciergeTurn handles multi-turn streaming with tool actions. They
// share src/lib/ai/client.ts (Anthropic singleton + test stub) and
// src/lib/ai/rateLimit.ts (separate per-user limiter for Concierge).
//
// PRE-FLIGHT: The route handler at /api/concierge/chat performs cost-guard +
// rate-limit checks BEFORE invoking this generator AND before persisting the
// user message. Other callers (eval scripts, future server actions) MUST do
// the same — this generator does not re-check.
//
// Intermediate-iteration text (text emitted BEFORE a tool_use within the same
// iteration) is streamed to the client but NOT persisted; only the FINAL
// non-tool turn's text lands in the assistant ConversationMessage.

import { createHash, randomUUID } from "node:crypto";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { db } from "@/lib/db";
import { getAnthropic } from "./client";
import { getPrompt } from "./registry";
import { getAnthropicToolDefinitions, invokeTool } from "./conciergeTools";
import { estimateCostUsd } from "./pricing";
import { writeLlmCall, type LlmCallErrorCode } from "./llmCallLog";
import { appendEventAndApply } from "@/lib/events";
import {
  projectConciergeMessageAssistantProduced,
  projectConciergeToolInvoked,
} from "@/lib/events/projections/conciergeThread";

export type ConciergeStreamEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_use_started";
      toolName: string;
      toolUseId: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      output: unknown;
      error: string | null;
      latencyMs: number;
    }
  | {
      type: "turn_complete";
      messageId: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
    }
  | { type: "error"; code: string; message: string };

export interface StreamConciergeTurnArgs {
  practiceId: string;
  practice: {
    name: string;
    primaryState: string;
    providerCount: string | null;
    timezone?: string | null;
  };
  threadId: string;
  actorUserId: string;
  /** Aborted when the client disconnects. Generator yields ABORTED error and
   *  exits; in-flight Anthropic stream is also aborted (passed via SDK
   *  RequestOptions.signal). */
  signal?: AbortSignal;
}

const MAX_TOOL_LOOP_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 200;
const DEFAULT_THREAD_MAX_INPUT_TOKENS = 50_000;

// Narrow the SDK's loose stream-event union to the three event types we
// inspect. The SDK exports event objects whose `type` discriminator is the
// only thing TS can narrow on, so these helpers exist purely to make the
// per-event branches typecheck without sprinkling `as` everywhere.
function isMessageStartEvent(
  e: unknown,
): e is { type: "message_start"; message: { usage: { input_tokens: number }; model: string } } {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { type?: unknown }).type === "message_start"
  );
}
function isContentBlockTextDelta(
  e: unknown,
): e is { type: "content_block_delta"; delta: { type: "text_delta"; text: string } } {
  if (
    typeof e !== "object" ||
    e === null ||
    (e as { type?: unknown }).type !== "content_block_delta"
  ) {
    return false;
  }
  const delta = (e as { delta?: { type?: unknown } }).delta;
  return (
    typeof delta === "object" &&
    delta !== null &&
    (delta as { type?: unknown }).type === "text_delta"
  );
}
function isMessageDeltaEvent(
  e: unknown,
): e is {
  type: "message_delta";
  delta: { stop_reason: string | null };
  usage: { output_tokens: number };
} {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { type?: unknown }).type === "message_delta"
  );
}

export async function* streamConciergeTurn(
  args: StreamConciergeTurnArgs,
): AsyncGenerator<ConciergeStreamEvent, void, unknown> {
  // Latency timer covers the full generator lifecycle: history load +
  // tool loop + final persistence. Logged on every LlmCall row (success
  // or failure) for the cost-dashboard latency-percentile view.
  const started = Date.now();
  const prompt = getPrompt("concierge.chat.v1");

  // Stable correlation hash. NOT a content hash — we deliberately avoid
  // hashing user message content because it may contain PHI and the
  // generator's `containsPHI` flag is hardcoded false for now (Concierge
  // is read-only and grounded in tool data, but user prompts are
  // free-text). The hash gives us a per-thread+turn correlation key
  // that's safe to store in the LlmCall.inputHash column without
  // accidentally landing PHI there. If we ever opt-in to PHI mode, swap
  // this for a real content hash.
  const inputHashSeed = JSON.stringify({
    threadId: args.threadId,
    practiceId: args.practiceId,
    actorUserId: args.actorUserId,
    startedAt: started,
  });
  const inputHash = createHash("sha256")
    .update(inputHashSeed)
    .digest("hex");

  // Helper closure so the 5+ LlmCall write sites all use the same
  // promptId/version/model/practice/actor/inputHash/PHI defaults. Returns
  // the new LlmCall.id (or null on a write failure — never throws so the
  // generator can keep yielding terminal error events).
  async function logLlmCall(opts: {
    success: boolean;
    errorCode?: LlmCallErrorCode | null;
  }): Promise<string | null> {
    try {
      return await writeLlmCall({
        promptId: prompt.id,
        promptVersion: prompt.version,
        model: modelReturned,
        practiceId: args.practiceId,
        actorUserId: args.actorUserId,
        inputHash,
        inputTokens: totalInput || null,
        outputTokens: totalOutput || null,
        latencyMs: Date.now() - started,
        costUsd: estimateCostUsd(modelReturned, totalInput, totalOutput),
        success: opts.success,
        errorCode: opts.errorCode ?? null,
        containsPHI: false,
      });
    } catch (err) {
      // LlmCall persistence is best-effort; if it fails (DB outage, etc.)
      // we don't want to mask the original error path or break streaming.
      // Surface a console.warn so a DB-blip-causing-silent-degradation is
      // visible in Cloud Run logs.
      console.warn(
        `[concierge] LlmCall write failed (practice=${args.practiceId} thread=${args.threadId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // 1) Pre-flight is OWNED BY THE ROUTE HANDLER. See
  //    src/app/api/concierge/chat/route.ts — it calls assertMonthlyCostBudget
  //    + assertConciergeRateLimit BEFORE invoking this generator (and before
  //    persisting the user message, so a rate-limited request doesn't leave
  //    an orphan user message in the thread).
  //
  //    Bail early on client disconnect.
  if (args.signal?.aborted) {
    yield { type: "error", code: "ABORTED", message: "Client disconnected" };
    return;
  }

  // 2) Load thread history (oldest-first, capped). Selecting role +
  //    content + inputTokens — inputTokens drives FIFO compaction below
  //    so the cumulative token cost across a long thread stays under
  //    the env-configured budget.
  const history = await db.conversationMessage.findMany({
    where: { threadId: args.threadId },
    orderBy: { createdAt: "asc" },
    take: MAX_HISTORY_MESSAGES,
    select: { role: true, content: true, inputTokens: true },
  });

  // 3) Build Anthropic messages array. USER + ASSISTANT rows only; TOOL
  //    rows are not replayed (see header comment).
  //
  //    Accumulate the per-row inputTokens so we can drop oldest USER+
  //    ASSISTANT pairs FIFO when the thread exceeds the budget.
  type MessageWithTokens = { msg: MessageParam; inputTokens: number };
  const annotated: MessageWithTokens[] = [];
  for (const m of history) {
    const tokens = m.inputTokens ?? 0;
    if (m.role === "USER") {
      annotated.push({ msg: { role: "user", content: m.content }, inputTokens: tokens });
    } else if (m.role === "ASSISTANT") {
      annotated.push({ msg: { role: "assistant", content: m.content }, inputTokens: tokens });
    }
  }

  // FIFO per-thread token compaction. We always keep the LAST entry
  // intact (the new user message just persisted by the route handler);
  // older USER+ASSISTANT pairs are dropped two-at-a-time from the front
  // until the cumulative inputTokens drops under the budget. Read the
  // env each call so live config changes don't require a redeploy.
  //
  // Tradeoff: this is FIFO compaction (chronological). It's coarse but
  // safe — no semantic loss for the most-recent context. A smarter
  // strategy (summarize-and-replace) is out of scope for A6.
  const parsedMax = Number(process.env.CONCIERGE_THREAD_MAX_INPUT_TOKENS);
  const threadMaxInputTokens =
    Number.isFinite(parsedMax) && parsedMax > 0
      ? parsedMax
      : DEFAULT_THREAD_MAX_INPUT_TOKENS;
  let totalThreadTokens = annotated.reduce((s, a) => s + a.inputTokens, 0);
  while (totalThreadTokens > threadMaxInputTokens && annotated.length > 1) {
    // Drop the oldest entry; if it's a USER and the next entry is an
    // ASSISTANT, drop that too (so we never strand a USER without its
    // ASSISTANT response).
    const dropped = annotated.shift()!;
    totalThreadTokens -= dropped.inputTokens;
    if (
      dropped.msg.role === "user" &&
      annotated.length > 1 &&
      annotated[0]!.msg.role === "assistant"
    ) {
      const droppedAssistant = annotated.shift()!;
      totalThreadTokens -= droppedAssistant.inputTokens;
    }
  }
  if (totalThreadTokens > threadMaxInputTokens) {
    // Couldn't compact further — only the new user message remains and
    // its inputTokens already exceed the budget. Anthropic will reject
    // if the actual prompt is too big; a console.warn surfaces this
    // pathological case in Cloud Run logs.
    console.warn(
      `[concierge] thread ${args.threadId} exceeds CONCIERGE_THREAD_MAX_INPUT_TOKENS ` +
        `(${totalThreadTokens} > ${threadMaxInputTokens}) and cannot be compacted further.`,
    );
  }

  const messages: MessageParam[] = annotated.map((a) => a.msg);

  if (messages.length === 0) {
    yield {
      type: "error",
      code: "EMPTY_HISTORY",
      message: "No user message found in thread to respond to.",
    };
    return;
  }

  const systemFilled = prompt.system
    .replaceAll("<practiceName>", args.practice.name)
    .replaceAll("<primaryState>", args.practice.primaryState)
    .replaceAll(
      "<providerCount>",
      args.practice.providerCount !== null
        ? args.practice.providerCount
        : "an unknown number of",
    );

  const client = getAnthropic();
  const tools = getAnthropicToolDefinitions();

  let totalInput = 0;
  let totalOutput = 0;
  let assistantText = "";
  // The registry types model as a string-literal (`claude-sonnet-4-6`) due
  // to the `as const satisfies` in registry.ts. Widen to plain string here
  // so we can assign whatever model string the SDK actually returned in
  // message_start (which can drift if Anthropic does a model alias rewrite).
  let modelReturned: string = prompt.model;

  // Track the last iteration's outcome so we can (a) persist the actual
  // stopReason rather than a hardcoded value and (b) detect the cap-reached
  // case (last iter still wanted tool_use but the loop budget ran out).
  let lastStopReason: string | null = null;
  let lastToolCallCount = 0;

  // 4) Tool-use loop with hard iteration cap. The cap prevents a runaway
  //    cost loop if the model keeps emitting tool_use blocks. After the
  //    cap, whatever final text the model produced in iteration N is
  //    persisted; the loop simply stops issuing more tool calls.
  for (let iter = 0; iter < MAX_TOOL_LOOP_ITERATIONS; iter++) {
    if (args.signal?.aborted) {
      yield { type: "error", code: "ABORTED", message: "Client disconnected" };
      return;
    }

    let stream: ReturnType<typeof client.messages.stream>;
    try {
      // SDK 0.78: messages.stream accepts a second RequestOptions arg whose
      // `signal` is forwarded to the underlying fetch. When the route's
      // request.signal aborts (closed tab), Anthropic's stream errors out
      // and the consumer disconnects mid-stream.
      stream = client.messages.stream(
        {
          model: prompt.model,
          system: systemFilled,
          max_tokens: prompt.maxTokens,
          tools,
          messages,
        },
        args.signal ? { signal: args.signal } : undefined,
      );
    } catch (err) {
      await logLlmCall({ success: false, errorCode: "UPSTREAM" });
      yield {
        type: "error",
        code: "UPSTREAM",
        message:
          err instanceof Error ? err.message : "Anthropic stream open failed",
      };
      return;
    }

    let stopReason: string | null = null;
    // Only the FINAL turn's text is persisted to the assistant message —
    // intermediate iterations exist only to drive tool calls. Reset each
    // loop and accumulate; the `assistantText` we keep at exit is whatever
    // the loop's last iteration produced.
    let iterText = "";

    try {
      for await (const event of stream) {
        // Defensive belt-and-suspenders abort check — the SDK's signal-
        // forwarding should already have torn the for-await iterator
        // down, but if a future SDK version regresses on that, this
        // ensures we still bail cleanly.
        if (args.signal?.aborted) {
          yield {
            type: "error",
            code: "ABORTED",
            message: "Client disconnected",
          };
          return;
        }
        if (isContentBlockTextDelta(event)) {
          iterText += event.delta.text;
          yield { type: "text_delta", text: event.delta.text };
        } else if (isMessageStartEvent(event)) {
          totalInput += event.message.usage.input_tokens;
          modelReturned = event.message.model;
        } else if (isMessageDeltaEvent(event)) {
          totalOutput += event.usage.output_tokens;
          stopReason = event.delta.stop_reason ?? stopReason;
        }
      }
    } catch (err) {
      // If the abort fired, surface ABORTED rather than a generic UPSTREAM —
      // the SDK throws APIUserAbortError when the AbortSignal trips. Aborts
      // are user-initiated and NOT logged as LlmCall failures.
      if (args.signal?.aborted) {
        yield {
          type: "error",
          code: "ABORTED",
          message: "Client disconnected",
        };
        return;
      }
      await logLlmCall({ success: false, errorCode: "UPSTREAM" });
      yield {
        type: "error",
        code: "UPSTREAM",
        message:
          err instanceof Error ? err.message : "Anthropic stream read failed",
      };
      return;
    }

    // The SDK's FinalMessage return is parametric (ParsedMessage<ParsedT>);
    // we only inspect `.content`, so a narrow cast to that shape suffices.
    let finalMsg: { content: unknown[] };
    try {
      finalMsg = (await stream.finalMessage()) as { content: unknown[] };
    } catch (err) {
      if (args.signal?.aborted) {
        yield {
          type: "error",
          code: "ABORTED",
          message: "Client disconnected",
        };
        return;
      }
      await logLlmCall({ success: false, errorCode: "UPSTREAM" });
      yield {
        type: "error",
        code: "UPSTREAM",
        message:
          err instanceof Error ? err.message : "Anthropic finalMessage failed",
      };
      return;
    }

    const blocks = finalMsg.content as Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    const toolCalls = blocks.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
        b.type === "tool_use",
    );

    lastStopReason = stopReason;
    lastToolCallCount = toolCalls.length;

    if (toolCalls.length === 0 || stopReason === "end_turn") {
      // No more tools to call; conversation is complete. Persist this
      // iteration's text as the final assistant message.
      assistantText = iterText;
      break;
    }

    // 5) Execute each tool_use in order, persist + stream events.
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];

    for (const call of toolCalls) {
      if (args.signal?.aborted) {
        yield {
          type: "error",
          code: "ABORTED",
          message: "Client disconnected",
        };
        return;
      }

      yield {
        type: "tool_use_started",
        toolName: call.name,
        toolUseId: call.id,
        input: call.input,
      };

      const { output, error, latencyMs } = await invokeTool({
        toolName: call.name,
        practiceId: args.practiceId,
        practiceTimezone: args.practice.timezone ?? "UTC",
        input: call.input,
      });

      // Reuse toolInvocationId as messageId — TOOL ConversationMessage rows
      // are 1:1 with their event.
      const toolInvocationId = randomUUID();
      try {
        await appendEventAndApply(
          {
            practiceId: args.practiceId,
            actorUserId: args.actorUserId,
            type: "CONCIERGE_TOOL_INVOKED",
            payload: {
              toolInvocationId,
              threadId: args.threadId,
              messageId: toolInvocationId,
              toolName: call.name,
              toolInput: call.input,
              toolOutput: output,
              latencyMs,
              error,
            },
          },
          async (tx) =>
            projectConciergeToolInvoked(tx, {
              practiceId: args.practiceId,
              payload: {
                toolInvocationId,
                threadId: args.threadId,
                messageId: toolInvocationId,
                toolName: call.name,
                toolInput: call.input,
                toolOutput: output,
                latencyMs,
                error,
              },
            }),
        );
      } catch (err) {
        // Persistence failure on a tool invocation is logged-but-not-fatal —
        // the tool result is still useful to the conversation. Surface as a
        // soft warning via the error event, but keep streaming.
        yield {
          type: "error",
          code: "TOOL_PERSISTENCE",
          message:
            err instanceof Error ? err.message : "Tool persistence failed",
        };
      }

      yield {
        type: "tool_result",
        toolUseId: call.id,
        output,
        error,
        latencyMs,
      };

      const resultText = error ? `ERROR: ${error}` : JSON.stringify(output);
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: resultText,
      });
    }

    // 6) Append assistant turn (raw blocks) + tool_result user turn for
    //    the next iteration. The SDK's MessageParam.content accepts
    //    string | Array<ContentBlockParam>, so passing the model's own
    //    blocks back unmodified is the documented pattern for tool use.
    messages.push({
      role: "assistant",
      content: blocks as unknown as MessageParam["content"],
    });
    messages.push({
      role: "user",
      content: toolResults as unknown as MessageParam["content"],
    });
  }

  // Cap-reached detection: the loop exited but the last iteration still
  // wanted to use tools (stopReason="tool_use" + at least one tool_use
  // block in the final message). The model's final answer is incomplete;
  // surface this distinct from a normal end_turn so the UI can warn.
  const capReached =
    lastStopReason === "tool_use" && lastToolCallCount > 0;
  if (capReached) {
    yield {
      type: "error",
      code: "ITERATION_CAP_REACHED",
      message: `Concierge hit the ${MAX_TOOL_LOOP_ITERATIONS}-iteration tool budget; final answer may be incomplete.`,
    };
  }

  // 7) Write the LlmCall row BEFORE persisting the assistant message —
  //    we want the LlmCall.id available to embed in both the event
  //    payload and the ConversationMessage row, so an audit can trace
  //    back from a user-visible message to the exact AI call that
  //    produced it. logLlmCall swallows write errors so a logging
  //    failure can't take down the response.
  const llmCallId = await logLlmCall({ success: true });

  // 8) Persist the final assistant message.
  const messageId = randomUUID();
  const costUsd = estimateCostUsd(modelReturned, totalInput, totalOutput);

  // Map the SDK's stop_reason to the registry's enum. We only persist the
  // four registered values; anything else (e.g. SDK adding "pause_turn"
  // later) falls back to "end_turn" to avoid Zod-failing the projection.
  const allowedStopReasons = new Set([
    "end_turn",
    "max_tokens",
    "tool_use",
    "stop_sequence",
  ]);
  const persistedStopReason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" =
    capReached
      ? "tool_use"
      : lastStopReason !== null && allowedStopReasons.has(lastStopReason)
        ? (lastStopReason as "end_turn" | "max_tokens" | "tool_use" | "stop_sequence")
        : "end_turn";

  try {
    await appendEventAndApply(
      {
        practiceId: args.practiceId,
        actorUserId: args.actorUserId,
        type: "CONCIERGE_MESSAGE_ASSISTANT_PRODUCED",
        payload: {
          messageId,
          threadId: args.threadId,
          content: assistantText,
          inputTokens: totalInput,
          outputTokens: totalOutput,
          costUsd,
          llmCallId,
          model: modelReturned,
          stopReason: persistedStopReason,
        },
      },
      async (tx) =>
        projectConciergeMessageAssistantProduced(tx, {
          practiceId: args.practiceId,
          payload: {
            messageId,
            threadId: args.threadId,
            content: assistantText,
            inputTokens: totalInput,
            outputTokens: totalOutput,
            costUsd,
            llmCallId,
            model: modelReturned,
            stopReason: persistedStopReason,
          },
        }),
    );
  } catch (err) {
    // The AI call succeeded; only the projection write failed. The
    // success LlmCall row above ALREADY captured the call — we don't
    // double-write a second row here, otherwise the cost dashboard
    // would over-count the same Anthropic invocation. The PERSISTENCE
    // surface on the error event is what differentiates this case.
    yield {
      type: "error",
      code: "PERSISTENCE",
      message:
        err instanceof Error ? err.message : "Final message persistence failed",
    };
    return;
  }

  yield {
    type: "turn_complete",
    messageId,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    costUsd,
  };
}
