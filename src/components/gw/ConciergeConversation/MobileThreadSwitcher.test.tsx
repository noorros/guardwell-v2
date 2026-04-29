// src/components/gw/ConciergeConversation/MobileThreadSwitcher.test.tsx
//
// Smoke tests for the /concierge mobile thread switcher (A6.5). The Sheet
// component renders inside a Radix Portal at document.body — assertions on
// the open state must search the whole document rather than the container
// returned by render(). Server actions imported transitively via ThreadList
// are stubbed (real ones reach Firebase auth + Prisma which we don't want
// under jsdom).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MobileThreadSwitcher } from "./MobileThreadSwitcher";

vi.mock("@/app/(dashboard)/concierge/actions", () => ({
  renameThreadAction: vi.fn(async () => ({ ok: true as const })),
  archiveThreadAction: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const SAMPLE_THREADS = [
  {
    id: "t-1",
    title: "First thread",
    lastMessageAt: new Date("2026-04-28T12:00:00Z"),
    archivedAt: null,
  },
  {
    id: "t-2",
    title: "Second thread",
    lastMessageAt: new Date("2026-04-28T11:00:00Z"),
    archivedAt: null,
  },
];

describe("<MobileThreadSwitcher>", () => {
  it("renders trigger button with thread count", () => {
    render(
      <MobileThreadSwitcher
        threads={SAMPLE_THREADS}
        activeThreadId="t-1"
        showArchived={false}
      />,
    );
    // Trigger is in the dom even when sheet is closed.
    expect(
      screen.getByRole("button", { name: /open thread list/i }),
    ).toBeInTheDocument();
    // Count is rendered inside the button label.
    expect(screen.getByText(/all threads \(2\)/i)).toBeInTheDocument();
  });

  it("opens the Sheet on click", async () => {
    const user = userEvent.setup();
    render(
      <MobileThreadSwitcher
        threads={SAMPLE_THREADS}
        activeThreadId="t-1"
        showArchived={false}
      />,
    );
    // Before clicking, the dialog is not rendered.
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: /open thread list/i }),
    );

    // After opening: a dialog with accessible name "Threads" is mounted
    // (the SheetTitle wires SheetContent's aria-labelledby), AND the inner
    // ThreadList content (thread titles, "New thread" link) is visible.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(/threads/i);
    expect(screen.getByText("First thread")).toBeInTheDocument();
    expect(screen.getByText("Second thread")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /new thread/i }),
    ).toBeInTheDocument();
  });

  it("closes when ESC is pressed", async () => {
    const user = userEvent.setup();
    render(
      <MobileThreadSwitcher
        threads={SAMPLE_THREADS}
        activeThreadId="t-1"
        showArchived={false}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /open thread list/i }),
    );
    // Sanity: sheet is open.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Radix Dialog listens for Escape on the dialog content; dispatching
    // on document picks up the bubble.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    });

    // Sheet content unmounts on close.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders an empty-count trigger when threads is empty", () => {
    render(
      <MobileThreadSwitcher
        threads={[]}
        activeThreadId={null}
        showArchived={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /open thread list/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/all threads \(0\)/i)).toBeInTheDocument();
  });

  it("passes axe a11y audit when the Sheet is open", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(
      <MobileThreadSwitcher
        threads={SAMPLE_THREADS}
        activeThreadId="t-1"
        showArchived={false}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /open thread list/i }),
    );
    // Sheet content portals into document.body — audit baseElement (the
    // body) so the open dialog is included in the scan.
    const results = await axe(baseElement, {
      rules: { region: { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
