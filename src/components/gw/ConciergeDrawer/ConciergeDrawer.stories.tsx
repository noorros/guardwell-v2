// src/components/gw/ConciergeDrawer/ConciergeDrawer.stories.tsx
//
// Stories for the local component-gallery view (the project doesn't ship
// Storybook itself; sibling stories use this same `stories` export shape).
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConciergeDrawer } from ".";
import type { StreamClientEvent } from "./streamClient";

async function* delayedStream(
  events: StreamClientEvent[],
): AsyncGenerator<StreamClientEvent, void, unknown> {
  for (const e of events) {
    await new Promise((r) => setTimeout(r, 100));
    yield e;
  }
}

function Demo({
  fakeStream,
}: {
  fakeStream?: (message: string) => AsyncGenerator<StreamClientEvent, void, unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Open GuardWell Concierge
      </Button>
      <ConciergeDrawer
        open={open}
        onOpenChange={setOpen}
        __streamForTests={fakeStream}
      />
    </>
  );
}

const streamingEvents: StreamClientEvent[] = [
  { type: "thread_resolved", threadId: "t-demo" },
  { type: "text_delta", text: "Looking up your HIPAA framework... " },
  {
    type: "tool_use_started",
    toolName: "list_frameworks",
    toolUseId: "tu-1",
    input: {},
  },
  {
    type: "tool_result",
    toolUseId: "tu-1",
    output: { frameworks: [{ code: "HIPAA", score: 75 }] },
    error: null,
    latencyMs: 42,
  },
  { type: "text_delta", text: "Your HIPAA score is 75%." },
  {
    type: "turn_complete",
    messageId: "m-1",
    inputTokens: 100,
    outputTokens: 30,
    costUsd: 0.00075,
  },
  { type: "stream_done" },
];

export const stories = {
  Empty: <Demo />,
  WithStreamingResponse: (
    <Demo
      fakeStream={() => delayedStream(streamingEvents)}
    />
  ),
};
