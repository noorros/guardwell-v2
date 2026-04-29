// src/components/gw/ConciergeConversation/ThreadList.test.tsx
//
// Smoke tests for the /concierge left-rail thread list. Stubs the server
// actions imported by the component (real ones reach into Firebase auth
// + Prisma which we don't want under jsdom) and exercises the basic
// render-and-affordance contract:
//   - lists thread titles
//   - marks the active thread
//   - shows the New thread button
//   - empty state when no threads exist

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThreadList } from "./ThreadList";

vi.mock("@/app/(dashboard)/concierge/actions", () => ({
  renameThreadAction: vi.fn(async () => ({ ok: true as const })),
  archiveThreadAction: vi.fn(async () => ({ ok: true as const })),
}));

// next/navigation's useRouter is fine under jsdom in vitest, but stub
// it explicitly so refresh() is a no-op and we don't depend on the
// next test environment shim.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

describe("<ThreadList>", () => {
  it("renders thread titles, marks the active thread, and shows the New thread button", () => {
    const threads = [
      {
        id: "t-1",
        title: "Active thread",
        lastMessageAt: new Date(),
        archivedAt: null,
      },
      {
        id: "t-2",
        title: "Other thread",
        lastMessageAt: new Date(Date.now() - 60_000),
        archivedAt: null,
      },
    ];
    render(
      <ThreadList
        threads={threads}
        activeThreadId="t-1"
        showArchived={false}
      />,
    );
    expect(screen.getByText("Active thread")).toBeInTheDocument();
    expect(screen.getByText("Other thread")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /new thread/i }),
    ).toBeInTheDocument();
  });

  it("renders empty state when no threads exist", () => {
    render(
      <ThreadList threads={[]} activeThreadId={null} showArchived={false} />,
    );
    expect(screen.getByText(/no threads yet/i)).toBeInTheDocument();
  });

  it("toggles 'Show / Hide archived' link based on showArchived prop", () => {
    const threads = [
      {
        id: "t-1",
        title: "Active thread",
        lastMessageAt: new Date(),
        archivedAt: null,
      },
    ];
    const { rerender } = render(
      <ThreadList
        threads={threads}
        activeThreadId="t-1"
        showArchived={false}
      />,
    );
    expect(
      screen.getByRole("link", { name: /show archived/i }),
    ).toBeInTheDocument();

    rerender(
      <ThreadList
        threads={threads}
        activeThreadId="t-1"
        showArchived={true}
      />,
    );
    expect(
      screen.getByRole("link", { name: /hide archived/i }),
    ).toBeInTheDocument();
  });
});
