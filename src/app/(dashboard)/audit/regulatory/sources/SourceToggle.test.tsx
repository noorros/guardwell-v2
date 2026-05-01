// src/app/(dashboard)/audit/regulatory/sources/SourceToggle.test.tsx
//
// Phase 8 PR 6 — DOM regression for the per-source toggle button.
//
// Cases:
//   - Renders "Disable" when isActive=true
//   - Renders "Enable" when isActive=false
//   - Click calls toggleSourceAction with the inverted flag
//   - Server-action error surfaces inline

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const toggleSourceActionMock = vi.fn();

vi.mock("../actions", () => ({
  toggleSourceAction: (...args: unknown[]) =>
    toggleSourceActionMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { SourceToggle } from "./SourceToggle";

describe("<SourceToggle>", () => {
  beforeEach(() => {
    toggleSourceActionMock.mockReset();
  });

  it("renders 'Disable' when source is active", () => {
    render(
      <SourceToggle
        sourceId="src-1"
        sourceName="HHS OCR Breach Portal"
        isActive={true}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Disable");
  });

  it("renders 'Enable' when source is disabled", () => {
    render(
      <SourceToggle
        sourceId="src-1"
        sourceName="HHS OCR Breach Portal"
        isActive={false}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Enable");
  });

  it("click on an active source calls toggleSourceAction with isActive=false", async () => {
    toggleSourceActionMock.mockResolvedValue({ ok: true });
    render(
      <SourceToggle
        sourceId="src-1"
        sourceName="HHS OCR Breach Portal"
        isActive={true}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(toggleSourceActionMock).toHaveBeenCalledTimes(1);
    });
    expect(toggleSourceActionMock).toHaveBeenCalledWith({
      sourceId: "src-1",
      isActive: false,
    });
  });

  it("surfaces server-action error messages inline", async () => {
    toggleSourceActionMock.mockResolvedValue({
      ok: false,
      error: "Requires OWNER role or higher",
    });
    render(
      <SourceToggle
        sourceId="src-1"
        sourceName="HHS OCR Breach Portal"
        isActive={true}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(
        screen.getByText("Requires OWNER role or higher"),
      ).toBeInTheDocument();
    });
  });
});
