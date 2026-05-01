// src/app/(dashboard)/programs/risk/cap/[id]/CapActions.test.tsx
//
// Phase 5 PR 6 — DOM coverage for the CAP detail-page client controls.
// Server actions are mocked via vi.mock("./actions") so the tests run
// without a DB. router.refresh is a vi.fn() so we can verify it fires
// after a successful action.
//
// Cases:
//   - renders the current status + notes from props
//   - changing status fires updateCapStatusAction + refreshes the router
//   - clicking "Save notes" fires updateCapNotesAction + refreshes
//   - error from server action surfaces via role="alert"
//   - jest-axe scan passes

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

const updateStatusMock = vi.fn();
const updateNotesMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("./actions", () => ({
  updateCapStatusAction: (...args: unknown[]) => updateStatusMock(...args),
  updateCapNotesAction: (...args: unknown[]) => updateNotesMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

import { CapActions } from "./CapActions";

describe("<CapActions>", () => {
  beforeEach(() => {
    updateStatusMock.mockReset();
    updateNotesMock.mockReset();
    refreshMock.mockReset();
  });

  it("renders the current status and notes from props", () => {
    render(
      <CapActions
        capId="cap-1"
        currentStatus="IN_PROGRESS"
        currentNotes="Started on Monday"
      />,
    );
    const select = screen.getByLabelText(
      "Corrective action status",
    ) as HTMLSelectElement;
    expect(select.value).toBe("IN_PROGRESS");
    expect(
      (screen.getByLabelText("Corrective action notes") as HTMLTextAreaElement)
        .value,
    ).toBe("Started on Monday");
  });

  it("changing status fires updateCapStatusAction with the new value and refreshes", async () => {
    updateStatusMock.mockResolvedValue({ ok: true });
    render(
      <CapActions
        capId="cap-7"
        currentStatus="PENDING"
        currentNotes={null}
      />,
    );

    fireEvent.change(screen.getByLabelText("Corrective action status"), {
      target: { value: "IN_PROGRESS" },
    });

    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledTimes(1);
    });
    expect(updateStatusMock).toHaveBeenCalledWith({
      capId: "cap-7",
      newStatus: "IN_PROGRESS",
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("clicking 'Save notes' fires updateCapNotesAction with the textarea value", async () => {
    updateNotesMock.mockResolvedValue({ ok: true });
    render(
      <CapActions
        capId="cap-9"
        currentStatus="PENDING"
        currentNotes={null}
      />,
    );

    fireEvent.change(screen.getByLabelText("Corrective action notes"), {
      target: { value: "Reviewed with manager" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save notes/i }));

    await waitFor(() => {
      expect(updateNotesMock).toHaveBeenCalledTimes(1);
    });
    expect(updateNotesMock).toHaveBeenCalledWith({
      capId: "cap-9",
      notes: "Reviewed with manager",
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces server-action error messages inline via role='alert'", async () => {
    updateStatusMock.mockResolvedValue({
      ok: false,
      error: "Cross-tenant access denied",
    });
    render(
      <CapActions
        capId="cap-1"
        currentStatus="PENDING"
        currentNotes={null}
      />,
    );

    fireEvent.change(screen.getByLabelText("Corrective action status"), {
      target: { value: "COMPLETED" },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("alert"),
      ).toHaveTextContent("Cross-tenant access denied");
    });
    // Optimistic update should have rolled back to PENDING.
    const select = screen.getByLabelText(
      "Corrective action status",
    ) as HTMLSelectElement;
    expect(select.value).toBe("PENDING");
  });

  it("axe-clean (default render)", async () => {
    const { container } = render(
      <CapActions
        capId="cap-1"
        currentStatus="PENDING"
        currentNotes={null}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
