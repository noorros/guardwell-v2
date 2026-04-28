// src/app/(dashboard)/programs/track/SyncButton.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  syncTrackFromEvidenceAction: vi.fn(),
}));

import { SyncButton } from "./SyncButton";
import { syncTrackFromEvidenceAction } from "./actions";

describe("<SyncButton>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Sync' in idle state", () => {
    render(<SyncButton />);
    expect(screen.getByRole("button")).toHaveTextContent("Sync");
  });

  it("calls syncTrackFromEvidenceAction on click and shows result", async () => {
    vi.mocked(syncTrackFromEvidenceAction).mockResolvedValue({ closed: 2 });
    render(<SyncButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(syncTrackFromEvidenceAction).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Closed 2 tasks",
    );
  });

  it("shows 'Already up to date' when zero closed", async () => {
    vi.mocked(syncTrackFromEvidenceAction).mockResolvedValue({ closed: 0 });
    render(<SyncButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Already up to date",
    );
  });

  it("shows 'Closed 1 task' (singular) when closed=1", async () => {
    vi.mocked(syncTrackFromEvidenceAction).mockResolvedValue({ closed: 1 });
    render(<SyncButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Closed 1 task",
    );
  });

  it("shows error message when action throws", async () => {
    vi.mocked(syncTrackFromEvidenceAction).mockRejectedValue(
      new Error("boom"),
    );
    // Suppress the console.error from the component so jest output stays clean.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SyncButton />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sync failed — try again",
    );
    consoleSpy.mockRestore();
  });
});
