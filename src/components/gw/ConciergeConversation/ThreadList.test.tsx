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
//   - rename invokes renameThreadAction with trimmed title
//   - archive invokes archiveThreadAction with the threadId

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadList } from "./ThreadList";
import {
  renameThreadAction,
  archiveThreadAction,
} from "@/app/(dashboard)/concierge/actions";

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

beforeEach(() => {
  vi.mocked(renameThreadAction).mockClear();
  vi.mocked(archiveThreadAction).mockClear();
});

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

  it("invokes renameThreadAction with trimmed title when rename submits", async () => {
    const user = userEvent.setup();
    const threads = [
      {
        id: "t-1",
        title: "Original",
        lastMessageAt: new Date(),
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

    // Hit the rename pencil to enter edit mode (the affordance is
    // labeled "Rename thread: <title>").
    await user.click(
      screen.getByRole("button", { name: /rename thread:/i }),
    );

    // Inline input is now mounted. Clear and retype with whitespace
    // padding to pin the trim contract. Use getByRole("textbox") since
    // /thread title/i also matches the "Save thread title" button.
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "  Renamed thread  ");
    await user.click(screen.getByRole("button", { name: /save thread title/i }));

    expect(renameThreadAction).toHaveBeenCalledTimes(1);
    expect(renameThreadAction).toHaveBeenCalledWith({
      threadId: "t-1",
      title: "Renamed thread",
    });
  });

  it("invokes archiveThreadAction with threadId when Archive is clicked", async () => {
    const user = userEvent.setup();
    const threads = [
      {
        id: "t-1",
        title: "Active thread",
        lastMessageAt: new Date(),
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

    await user.click(
      screen.getByRole("button", { name: /archive thread:/i }),
    );

    expect(archiveThreadAction).toHaveBeenCalledTimes(1);
    expect(archiveThreadAction).toHaveBeenCalledWith({ threadId: "t-1" });
  });
});
