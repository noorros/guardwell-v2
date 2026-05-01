// src/app/(dashboard)/programs/risk/items/[id]/RiskItemActions.test.tsx
//
// Phase 5 PR 5 — DOM coverage for the RiskItem detail-page client
// controls. Server actions are mocked via vi.mock("./actions") so the
// tests run without a DB. router.refresh is a no-op in jsdom; we just
// check the mock was called with the right input.
//
// Cases:
//   - Status select renders all four options and reflects initial value
//   - Changing status calls updateRiskItemStatusAction with the new value
//   - "Create CAP" button is disabled (PR 5 stub)
//   - jest-axe scan (default render)

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

const updateStatusMock = vi.fn();
const updateNotesMock = vi.fn();

vi.mock("./actions", () => ({
  updateRiskItemStatusAction: (...args: unknown[]) =>
    updateStatusMock(...args),
  updateRiskItemNotesAction: (...args: unknown[]) => updateNotesMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { RiskItemActions } from "./RiskItemActions";

describe("<RiskItemActions>", () => {
  beforeEach(() => {
    updateStatusMock.mockReset();
    updateNotesMock.mockReset();
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

  it("'Create CAP' button is disabled in PR 5", () => {
    render(
      <RiskItemActions
        riskItemId="r1"
        initialStatus="OPEN"
        initialNotes={null}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /Create corrective action/i,
    });
    expect(btn).toBeDisabled();
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
