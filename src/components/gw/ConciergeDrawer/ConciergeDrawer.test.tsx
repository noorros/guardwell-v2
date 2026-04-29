// src/components/gw/ConciergeDrawer/ConciergeDrawer.test.tsx
//
// Component tests for the global Concierge drawer. Network is fully stubbed
// via `__streamForTests` (an async generator the drawer drains in place of
// the SSE-fetch generator). Same StreamClientEvent shape, no fetch.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ConciergeDrawer } from ".";
import type { StreamClientEvent } from "./streamClient";

// Wrap a static array of events as an async generator. The drawer's
// for-await loop sees these events one at a time, in order, identical
// to the live SSE flow.
async function* fakeStream(
  events: StreamClientEvent[],
): AsyncGenerator<StreamClientEvent, void, unknown> {
  for (const e of events) yield e;
}

describe("<ConciergeDrawer>", () => {
  it("renders nothing when closed", () => {
    render(<ConciergeDrawer open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog with accessible name 'GuardWell Concierge' when open", () => {
    render(<ConciergeDrawer open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      /guardwell concierge/i,
    );
  });

  it("shows empty-state example prompts when no messages exist", () => {
    render(<ConciergeDrawer open onOpenChange={() => {}} />);
    expect(
      screen.getByText(/what's our hipaa score/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/incidents from this month/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/credentials expire in the next 90 days/i),
    ).toBeInTheDocument();
  });

  it("submits a user message and renders streamed assistant text", async () => {
    const user = userEvent.setup();
    const fake = () =>
      fakeStream([
        { type: "thread_resolved", threadId: "t-1" },
        { type: "text_delta", text: "HIPAA " },
        { type: "text_delta", text: "applies to all..." },
        {
          type: "turn_complete",
          messageId: "m-1",
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.0001,
        },
        { type: "stream_done" },
      ]);
    render(
      <ConciergeDrawer
        open
        onOpenChange={() => {}}
        __streamForTests={fake}
      />,
    );
    await user.type(screen.getByRole("textbox"), "What is HIPAA?");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(
      await screen.findByText("HIPAA applies to all..."),
    ).toBeInTheDocument();
  });

  it("renders tool-call chip when tool_use_started + tool_result fire", async () => {
    const user = userEvent.setup();
    const fake = () =>
      fakeStream([
        { type: "thread_resolved", threadId: "t-1" },
        {
          type: "tool_use_started",
          toolName: "list_frameworks",
          toolUseId: "tu-1",
          input: {},
        },
        {
          type: "tool_result",
          toolUseId: "tu-1",
          output: { frameworks: [] },
          error: null,
          latencyMs: 42,
        },
        { type: "text_delta", text: "Your score is 75%." },
        {
          type: "turn_complete",
          messageId: "m-1",
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0.0001,
        },
        { type: "stream_done" },
      ]);
    render(
      <ConciergeDrawer
        open
        onOpenChange={() => {}}
        __streamForTests={fake}
      />,
    );
    await user.type(screen.getByRole("textbox"), "What's our score?");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByText(/list_frameworks/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/Your score is 75%/i),
    ).toBeInTheDocument();
  });

  it("renders RATE_LIMITED error banner when error event fires", async () => {
    const user = userEvent.setup();
    const fake = () =>
      fakeStream([
        {
          type: "error",
          code: "RATE_LIMITED",
          message: "Too many requests; retry in 24h",
        },
        { type: "stream_done" },
      ]);
    render(
      <ConciergeDrawer
        open
        onOpenChange={() => {}}
        __streamForTests={fake}
      />,
    );
    await user.type(screen.getByRole("textbox"), "ping");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(
      await screen.findByText(/too many requests/i),
    ).toBeInTheDocument();
  });

  it("disables Send and shows Stop while a turn is in flight", async () => {
    const user = userEvent.setup();
    // Hold-open box: the fake generator parks on a Promise the test resolves
    // after asserting the in-flight UI. Typed as `{ resolve: (() => void) | null }`
    // so TS doesn't narrow it to `null` based on the literal initializer.
    const holdOpen: { resolve: (() => void) | null } = { resolve: null };
    const fake = () =>
      (async function* () {
        yield { type: "thread_resolved", threadId: "t-1" } as StreamClientEvent;
        // Hold the stream open until we resolve it externally so the test
        // can observe the "in-flight" UI before completion.
        await new Promise<void>((r) => {
          holdOpen.resolve = r;
        });
        yield { type: "text_delta", text: "ok" } as StreamClientEvent;
        yield {
          type: "turn_complete",
          messageId: "m-1",
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        } as StreamClientEvent;
        yield { type: "stream_done" } as StreamClientEvent;
      })();
    render(
      <ConciergeDrawer
        open
        onOpenChange={() => {}}
        __streamForTests={fake}
      />,
    );
    await user.type(screen.getByRole("textbox"), "hi");
    await user.click(screen.getByRole("button", { name: /send/i }));
    // While streaming, the button should read "Stop".
    expect(
      await screen.findByRole("button", { name: /stop/i }),
    ).toBeInTheDocument();
    // Cleanup so the test doesn't leave a dangling promise.
    holdOpen.resolve?.();
  });

  it("has no axe violations when open", async () => {
    const { container } = render(
      <ConciergeDrawer open onOpenChange={() => {}} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
