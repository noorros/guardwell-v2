// src/components/gw/HistoryRowActions/HistoryRowActions.test.tsx
//
// Audit #15 (2026-04-30): regression guard for the shared history-row
// edit/delete affordance. Confirms the canManage gate hides the entire
// component for non-admins and that delete is gated by a confirm step.
//
// Audit #21 / Allergy IM-12 (2026-04-30): the confirm step now uses a
// shadcn AlertDialog (replacing native `window.confirm`). Tests updated
// to interact with the dialog content + buttons rather than the
// browser confirm.

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

  it("opens an AlertDialog instead of the native window.confirm", async () => {
    // Regression guard for IM-12: window.confirm must NOT be invoked.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <HistoryRowActions
        canManage={true}
        onEdit={() => {}}
        onDelete={async () => {}}
        deleteConfirmText="Sure?"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    // AlertDialog renders with role="alertdialog".
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("does not invoke onDelete when Cancel is clicked in the dialog", async () => {
    const onDelete = vi.fn(async () => {});
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
    const dialog = await screen.findByRole("alertdialog");
    const { getByRole } = await import("@testing-library/react").then((m) => ({
      getByRole: m.within(dialog).getByRole,
    }));
    await user.click(getByRole("button", { name: /cancel/i }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("invokes onDelete when the dialog's confirm button is clicked", async () => {
    const onDelete = vi.fn(async () => {});
    render(
      <HistoryRowActions
        canManage={true}
        onEdit={() => {}}
        onDelete={onDelete}
        deleteConfirmText="Sure?"
      />,
    );
    const user = userEvent.setup();
    // First click opens the dialog.
    await user.click(screen.getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("alertdialog");
    // Second click — the destructive action button inside the dialog.
    const { within } = await import("@testing-library/react");
    const confirmButton = within(dialog).getByRole("button", {
      name: /delete/i,
    });
    await user.click(confirmButton);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("surfaces the onDelete error message inline", async () => {
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
    const dialog = await screen.findByRole("alertdialog");
    const { within } = await import("@testing-library/react");
    await user.click(within(dialog).getByRole("button", { name: /delete/i }));
    expect(await screen.findByText("Boom")).toBeTruthy();
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
