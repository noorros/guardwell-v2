// src/lib/ai/runLlm.ts
//
// The ONLY path for calling Claude (ADR-0003). Every call is:
//   (1) input-validated by Zod
//   (2) executed via the prompt's registered tool (structured output)
//   (3) output-validated by Zod
//   (4) persisted to LlmCall for observability + cost tracking
//
// Never import the Anthropic SDK directly elsewhere.

import crypto from "node:crypto";
import { getAnthropic } from "./client";
import { getPrompt, type PromptId, PROMPTS } from "./registry";
import { z } from "zod";
import { zodToJsonSchema } from "./zodToJsonSchema";
import { estimateCostUsd } from "./pricing";
import { writeLlmCall } from "./llmCallLog";

function stableHash(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

export interface RunLlmOptions {
  practiceId?: string | null;
  actorUserId?: string | null;
  /** Opt-in PHI flag. Logged on LlmCall row. Defaults to false. */
  allowPHI?: boolean;
}

export interface RunLlmResult<TOut> {
  output: TOut;
  llmCallId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export async function runLlm<T extends PromptId>(
  promptId: T,
  input: z.infer<(typeof PROMPTS)[T]["inputSchema"]>,
  options: RunLlmOptions = {},
): Promise<RunLlmResult<z.infer<(typeof PROMPTS)[T]["outputSchema"]>>> {
  const prompt = getPrompt(promptId);
  const containsPHI = options.allowPHI === true;

  // 1) Validate input.
  const parsedInput = prompt.inputSchema.safeParse(input);
  if (!parsedInput.success) {
    // Do NOT write an LlmCall row — we never reached the provider. Bad input
    // is a caller bug, not observed AI behavior.
    throw new Error(`INPUT_SCHEMA: ${parsedInput.error.message}`);
  }

  const inputHash = stableHash(parsedInput.data);
  const started = Date.now();
  const client = getAnthropic();

  // 2) Call Claude with tool-use as the structured-output mechanism.
  let resp:
    | {
        id: string;
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: unknown }
        >;
        usage: { input_tokens: number; output_tokens: number };
        model: string;
        stop_reason: string;
      }
    | null = null;
  try {
    resp = (await client.messages.create({
      model: prompt.model,
      system: prompt.system,
      max_tokens: prompt.maxTokens,
      tools: [
        {
          name: prompt.toolName,
          description: prompt.toolDescription,
          // Prompt outputSchemas are always Zod objects, so our converter
          // returns { type: "object", ... }. Cast to satisfy the SDK's
          // InputSchema type without dragging the full JSON-schema type into
          // the converter.
          input_schema: zodToJsonSchema(prompt.outputSchema) as {
            type: "object";
            properties?: Record<string, unknown>;
            required?: string[];
          },
        },
      ],
      tool_choice: { type: "tool", name: prompt.toolName },
      messages: [
        {
          role: "user",
          content: JSON.stringify(parsedInput.data),
        },
      ],
    })) as unknown as typeof resp;
  } catch (err) {
    const latency = Date.now() - started;
    await writeLlmCall({
      promptId: prompt.id,
      promptVersion: prompt.version,
      model: prompt.model,
      practiceId: options.practiceId,
      actorUserId: options.actorUserId,
      inputHash,
      latencyMs: latency,
      costUsd: null,
      success: false,
      errorCode: "UPSTREAM",
      containsPHI,
    });
    throw err instanceof Error ? err : new Error("UPSTREAM");
  }

  const latencyMs = Date.now() - started;
  const inputTokens = resp!.usage.input_tokens;
  const outputTokens = resp!.usage.output_tokens;
  const costUsd = estimateCostUsd(resp!.model, inputTokens, outputTokens);

  // 3) Extract tool input.
  const toolBlock = resp!.content.find(
    (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
      b.type === "tool_use",
  );
  if (!toolBlock) {
    await writeLlmCall({
      promptId: prompt.id,
      promptVersion: prompt.version,
      model: resp!.model,
      practiceId: options.practiceId,
      actorUserId: options.actorUserId,
      inputHash,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd,
      success: false,
      errorCode: "NO_TOOL_USE",
      containsPHI,
    });
    throw new Error("NO_TOOL_USE: Claude response contained no tool_use block");
  }

  // 4) Validate output.
  const parsedOutput = prompt.outputSchema.safeParse(toolBlock.input);
  if (!parsedOutput.success) {
    await writeLlmCall({
      promptId: prompt.id,
      promptVersion: prompt.version,
      model: resp!.model,
      practiceId: options.practiceId,
      actorUserId: options.actorUserId,
      inputHash,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd,
      success: false,
      errorCode: "OUTPUT_SCHEMA",
      containsPHI,
    });
    throw new Error(`OUTPUT_SCHEMA: ${parsedOutput.error.message}`);
  }

  // 5) Success LlmCall row.
  const llmCallId = await writeLlmCall({
    promptId: prompt.id,
    promptVersion: prompt.version,
    model: resp!.model,
    practiceId: options.practiceId,
    actorUserId: options.actorUserId,
    inputHash,
    inputTokens,
    outputTokens,
    latencyMs,
    costUsd,
    success: true,
    containsPHI,
  });

  return {
    // Cast through unknown: safeParse returns `z.output<TOutput>` for the
    // concrete schema, but TS cannot narrow through the generic index type
    // `(typeof PROMPTS)[T]["outputSchema"]`. We already validated at runtime.
    output: parsedOutput.data as unknown as z.infer<(typeof PROMPTS)[T]["outputSchema"]>,
    llmCallId,
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd,
  };
}
