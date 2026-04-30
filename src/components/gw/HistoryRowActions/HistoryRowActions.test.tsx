// src/components/gw/HistoryRowActions/HistoryRowActions.test.tsx
//
// Audit #15 (2026-04-30): regression guard for the shared history-row
// edit/delete affordance. Confirms the canManage gate hides the entire
// component for non-admins and that delete is gated by window.confirm.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { HistoryRowActions } from "./HistoryRowActions";

describe("<HistoryRowActions>", () => {
  it("renders nothing when canManage=false", () => {
    const { container } = render(
      <HistoryRowActions
        canManage={false}
        onEdit={() => {}}
        onDelete={async () => {}}
        deleteConfirmText="Confirm?"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("invokes onEdit when the Edit button is clicked", async () => {
    const onEdit = vi.fn();
    render(
      <HistoryRowActions
        canManage={true}
        onEdit={onEdit}
        onDelete={async () => {}}
        deleteConfirmText="Confirm delete?"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("invokes onDelete only after window.confirm() approval", async () => {
    const onDelete = vi.fn(async () => {});
    const confirmSpy = vi.spyOn(window, "confirm");

    confirmSpy.mockReturnValueOnce(false);
    render(
      <HistoryRowActions
        canManage={true}
        onEdit={() => {}}
        onDelete={onDelete}
        deleteConfirmText="Sure?"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).not.toHaveBeenCalled();

    // Approve on the second click.
    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledOnce();

    confirmSpy.mockRestore();
  });

  it("surfaces the onDelete error message inline", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true);
    const onDelete = vi.fn(async () => {
      throw new Error("Boom");
    });
    render(
      <HistoryRowActions
        canManage={true}
        onEdit={() => {}}
        onDelete={onDelete}
        deleteConfirmText="Sure?"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(await screen.findByText("Boom")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("axe-clean (canManage=true)", async () => {
    const { container } = render(
      <HistoryRowActions
        canManage={true}
        onEdit={() => {}}
        onDelete={async () => {}}
        deleteConfirmText="Confirm?"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
