// src/components/gw/AiAssistDrawer/AiAssistDrawer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiAssistDrawer } from ".";

describe("<AiAssistDrawer>", () => {
  it("renders nothing (no dialog) when closed", () => {
    render(
      <AiAssistDrawer
        open={false}
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a dialog with an accessible name when open", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(/ai concierge/i);
  });

  it("shows the current route in the header area", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/modules/hipaa-privacy" }}
      />,
    );
    expect(screen.getByText("/modules/hipaa-privacy")).toBeInTheDocument();
  });

  it("surfaces the summary if passed (preferring summary over route in greeting)", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/modules/hipaa-privacy", summary: "HIPAA Privacy Rule module" }}
      />,
    );
    expect(screen.getByText(/HIPAA Privacy Rule module/)).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <AiAssistDrawer
        open
        onOpenChange={onOpenChange}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    // Shadcn's SheetContent provides a built-in close button with aria-label "Close"
    const closeBtn = screen.getByRole("button", { name: /close/i });
    await user.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <AiAssistDrawer
        open
        onOpenChange={onOpenChange}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders the 'Coming in week 5' stub in the footer with a disabled textarea", () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("traps focus within the drawer when open (first focusable is inside dialog)", async () => {
    render(
      <AiAssistDrawer
        open
        onOpenChange={() => {}}
        pageContext={{ route: "/dashboard" }}
      />,
    );
    // Radix sets initial focus inside the dialog automatically.
    // We assert that document.activeElement is contained by the dialog.
    const dialog = screen.getByRole("dialog");
    // Give Radix one microtask tick to apply focus management.
    await Promise.resolve();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
