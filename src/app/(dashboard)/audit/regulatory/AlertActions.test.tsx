// src/app/(dashboard)/audit/regulatory/AlertActions.test.tsx
//
// Phase 8 PR 6 — DOM regression for the alert actions toolbar.
// Server actions are mocked via vi.mock("./actions") so the tests run
// without a DB. router.refresh is a no-op in jsdom; we just check the
// mock was called with the right input.
//
// Cases:
//   - Buttons disabled when alert is acknowledged / dismissed
//   - Acknowledge click calls acknowledgeAlertAction
//   - Dismiss click calls dismissAlertAction
//   - Add to CAP form opens, validates, calls addAlertToCapAction
//   - Error from server action surfaces inline
//   - jest-axe scan (default render)

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

const acknowledgeAlertActionMock = vi.fn();
const dismissAlertActionMock = vi.fn();
const addAlertToCapActionMock = vi.fn();

vi.mock("./actions", () => ({
  acknowledgeAlertAction: (...args: unknown[]) =>
    acknowledgeAlertActionMock(...args),
  dismissAlertAction: (...args: unknown[]) =>
    dismissAlertActionMock(...args),
  addAlertToCapAction: (...args: unknown[]) =>
    addAlertToCapActionMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AlertActions } from "./AlertActions";

describe("<AlertActions>", () => {
  beforeEach(() => {
    acknowledgeAlertActionMock.mockReset();
    dismissAlertActionMock.mockReset();
    addAlertToCapActionMock.mockReset();
  });

  it("renders all three buttons when alert is unacknowledged + active", () => {
    render(
      <AlertActions
        alertId="alert-1"
        acknowledgedAtIso={null}
        dismissedAtIso={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Acknowledge" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add to my CAP" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  it("disables Acknowledge when already acknowledged", () => {
    render(
      <AlertActions
        alertId="alert-1"
        acknowledgedAtIso="2026-04-30T12:00:00.000Z"
        dismissedAtIso={null}
      />,
    );

    const ackBtn = screen.getByRole("button", { name: "Acknowledged" });
    expect(ackBtn).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  it("disables all three buttons when alert is dismissed", () => {
    render(
      <AlertActions
        alertId="alert-1"
        acknowledgedAtIso={null}
        dismissedAtIso="2026-04-30T12:00:00.000Z"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Acknowledge" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add to my CAP" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Dismissed" }),
    ).toBeDisabled();
  });

  it("calls acknowledgeAlertAction with the alertId on click", async () => {
    acknowledgeAlertActionMock.mockResolvedValue({ ok: true });
    render(
      <AlertActions
        alertId="alert-42"
        acknowledgedAtIso={null}
        dismissedAtIso={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor(() => {
      expect(acknowledgeAlertActionMock).toHaveBeenCalledTimes(1);
    });
    expect(acknowledgeAlertActionMock).toHaveBeenCalledWith({
      alertId: "alert-42",
    });
  });

  it("calls dismissAlertAction with the alertId on click", async () => {
    dismissAlertActionMock.mockResolvedValue({ ok: true });
    render(
      <AlertActions
        alertId="alert-7"
        acknowledgedAtIso={null}
        dismissedAtIso={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(dismissAlertActionMock).toHaveBeenCalledTimes(1);
    });
    expect(dismissAlertActionMock).toHaveBeenCalledWith({
      alertId: "alert-7",
    });
  });

  it("opens the CAP form, submits a description, and calls addAlertToCapAction", async () => {
    addAlertToCapActionMock.mockResolvedValue({
      ok: true,
      actionId: "act-1",
      capId: "cap-1",
    });
    render(
      <AlertActions
        alertId="alert-99"
        acknowledgedAtIso={null}
        dismissedAtIso={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to my CAP" }));

    const textarea = screen.getByLabelText("Action description");
    fireEvent.change(textarea, {
      target: { value: "Review HIPAA Security Rule" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save action" }));

    await waitFor(() => {
      expect(addAlertToCapActionMock).toHaveBeenCalledTimes(1);
    });
    expect(addAlertToCapActionMock).toHaveBeenCalledWith({
      alertId: "alert-99",
      description: "Review HIPAA Security Rule",
      dueDate: null,
    });
  });

  it("surfaces server-action error messages inline", async () => {
    acknowledgeAlertActionMock.mockResolvedValue({
      ok: false,
      error: "Cross-tenant access denied",
    });
    render(
      <AlertActions
        alertId="alert-1"
        acknowledgedAtIso={null}
        dismissedAtIso={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor(() => {
      expect(
        screen.getByText("Cross-tenant access denied"),
      ).toBeInTheDocument();
    });
  });

  it("axe-clean (default render)", async () => {
    const { container } = render(
      <AlertActions
        alertId="alert-1"
        acknowledgedAtIso={null}
        dismissedAtIso={null}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
