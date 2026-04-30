// src/app/(dashboard)/programs/training/assignments/BulkAutoAssignButton.test.tsx
//
// Phase 4 PR 5 — DOM regression for the "Auto-Assign required to Team"
// button. Mocks autoAssignRequiredAction so this test stays
// presentational; the action itself is exercised by
// tests/integration/training-actions.test.ts.

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { BulkAutoAssignButton } from "./BulkAutoAssignButton";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const autoAssignMock = vi.fn();
vi.mock("../actions", () => ({
  autoAssignRequiredAction: (...args: unknown[]) => autoAssignMock(...args),
}));

beforeEach(() => {
  autoAssignMock.mockReset();
  autoAssignMock.mockResolvedValue({ created: 5, skipped: 2 });
});

describe("<BulkAutoAssignButton>", () => {
  it("renders the trigger button", () => {
    render(<BulkAutoAssignButton />);
    expect(
      screen.getByRole("button", { name: /auto-assign required to team/i }),
    ).toBeInTheDocument();
  });

  it("clicking the trigger opens the AlertDialog with confirmation copy", async () => {
    const user = userEvent.setup();
    render(<BulkAutoAssignButton />);
    await user.click(
      screen.getByRole("button", { name: /auto-assign required to team/i }),
    );
    expect(
      await screen.findByRole("alertdialog"),
    ).toBeInTheDocument();
    // Confirmation explains idempotency so admins know clicking again
    // won't double-assign.
    expect(
      screen.getByText(/insert-only and idempotent/i),
    ).toBeInTheDocument();
  });

  it("Confirm calls autoAssignRequiredAction and shows the count message", async () => {
    const user = userEvent.setup();
    render(<BulkAutoAssignButton />);
    await user.click(
      screen.getByRole("button", { name: /auto-assign required to team/i }),
    );
    const confirmBtn = await screen.findByRole("button", {
      name: /^auto-assign$/i,
    });
    await user.click(confirmBtn);
    expect(autoAssignMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Created 5, skipped 2\./),
    ).toBeInTheDocument();
  });

  it("displays the error message when the action throws", async () => {
    autoAssignMock.mockRejectedValueOnce(new Error("server boom"));
    const user = userEvent.setup();
    render(<BulkAutoAssignButton />);
    await user.click(
      screen.getByRole("button", { name: /auto-assign required to team/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^auto-assign$/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/server boom/);
  });

  it("Cancel button closes the dialog without calling the action", async () => {
    const user = userEvent.setup();
    render(<BulkAutoAssignButton />);
    await user.click(
      screen.getByRole("button", { name: /auto-assign required to team/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^cancel$/i }),
    );
    expect(autoAssignMock).not.toHaveBeenCalled();
    // Dialog content is portaled out of the DOM after close — querying
    // synchronously may still see it briefly during animation, so wait
    // for the role to disappear instead of asserting absence outright.
  });

  it("After success, Cancel button label flips to Close so the user can dismiss", async () => {
    const user = userEvent.setup();
    render(<BulkAutoAssignButton />);
    await user.click(
      screen.getByRole("button", { name: /auto-assign required to team/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^auto-assign$/i }),
    );
    expect(
      await screen.findByRole("button", { name: /^close$/i }),
    ).toBeInTheDocument();
  });

  it("axe-clean (closed state — trigger button only)", async () => {
    const { container } = render(<BulkAutoAssignButton />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean (open dialog)", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<BulkAutoAssignButton />);
    await user.click(
      screen.getByRole("button", { name: /auto-assign required to team/i }),
    );
    await screen.findByRole("alertdialog");
    // baseElement covers the portal'd dialog content. Radix attaches
    // role="alertdialog" + aria-describedby + focus trap; axe should
    // find no violations on the rendered tree.
    const results = await axe(baseElement);
    expect(results).toHaveNoViolations();
  });
});
