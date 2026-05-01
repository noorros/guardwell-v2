// src/app/(dashboard)/programs/risk/items/[id]/RiskItemActions.test.tsx
//
// Phase 5 PR 5 — DOM coverage for the RiskItem detail-page client
// controls. Server actions are mocked via vi.mock("./actions") so the
// tests run without a DB.
//
// Phase 5 PR 6 — drop the "stub disabled" assertion (the Create-CAP
// button is now functional) and add coverage for the inline create-CAP
// form: open, submit, and route on success.
//
// Cases:
//   - Status select renders all four options and reflects initial value
//   - Changing status calls updateRiskItemStatusAction with the new value
//   - "Create CAP" button opens the inline form on click
//   - Submitting the form calls createCapForRiskAction and routes to
//     /programs/risk/cap/{id} on success
//   - Form validation: empty description shows an inline error
//   - jest-axe scan (default render)

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

const updateStatusMock = vi.fn();
const updateNotesMock = vi.fn();
const createCapMock = vi.fn();
const pushMock = vi.fn();

vi.mock("./actions", () => ({
  updateRiskItemStatusAction: (...args: unknown[]) =>
    updateStatusMock(...args),
  updateRiskItemNotesAction: (...args: unknown[]) => updateNotesMock(...args),
  createCapForRiskAction: (...args: unknown[]) => createCapMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: pushMock }),
}));

import { RiskItemActions } from "./RiskItemActions";

describe("<RiskItemActions>", () => {
  beforeEach(() => {
    updateStatusMock.mockReset();
    updateNotesMock.mockReset();
    createCapMock.mockReset();
    pushMock.mockReset();
  });

  it("renders all four status options and reflects the initial value", () => {
    render(
      <RiskItemActions
        riskItemId="r1"
        initialStatus="OPEN"
        initialNotes={null}
      />,
    );
    const select = screen.getByLabelText("Risk item status") as HTMLSelectElement;
    expect(select.value).toBe("OPEN");
    expect(screen.getByRole("option", { name: "Open" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Mitigated" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Accepted" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Transferred" }),
    ).toBeInTheDocument();
  });

  it("changing status calls updateRiskItemStatusAction with the new value", async () => {
    updateStatusMock.mockResolvedValue({ ok: true });
    render(
      <RiskItemActions
        riskItemId="r-42"
        initialStatus="OPEN"
        initialNotes={null}
      />,
    );

    fireEvent.change(screen.getByLabelText("Risk item status"), {
      target: { value: "MITIGATED" },
    });

    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledTimes(1);
    });
    expect(updateStatusMock).toHaveBeenCalledWith({
      riskItemId: "r-42",
      status: "MITIGATED",
    });
  });

  it("'Create CAP' button opens the inline form on click", () => {
    render(
      <RiskItemActions
        riskItemId="r1"
        initialStatus="OPEN"
        initialNotes={null}
      />,
    );

    // Form is hidden initially.
    expect(
      screen.queryByLabelText("Corrective action description"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Create corrective action/i }),
    );

    expect(
      screen.getByLabelText("Corrective action description"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Corrective action due date"),
    ).toBeInTheDocument();
  });

  it("submitting the create-CAP form calls createCapForRiskAction and routes to the new CAP detail page", async () => {
    createCapMock.mockResolvedValue({ ok: true, capId: "cap-new-1" });
    render(
      <RiskItemActions
        riskItemId="r-99"
        initialStatus="OPEN"
        initialNotes={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Create corrective action/i }),
    );

    fireEvent.change(
      screen.getByLabelText("Corrective action description"),
      { target: { value: "Patch the encryption gap" } },
    );
    fireEvent.change(screen.getByLabelText("Corrective action due date"), {
      target: { value: "2026-06-15" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createCapMock).toHaveBeenCalledTimes(1);
    });
    expect(createCapMock).toHaveBeenCalledWith({
      riskItemId: "r-99",
      description: "Patch the encryption gap",
      dueDate: "2026-06-15",
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/programs/risk/cap/cap-new-1");
    });
  });

  it("disables the Create button when description is empty", () => {
    render(
      <RiskItemActions
        riskItemId="r-100"
        initialStatus="OPEN"
        initialNotes={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Create corrective action/i }),
    );

    const submit = screen.getByRole("button", { name: "Create" });
    expect(submit).toBeDisabled();
  });

  it("axe-clean (default render)", async () => {
    const { container } = render(
      <RiskItemActions
        riskItemId="r1"
        initialStatus="OPEN"
        initialNotes={null}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
