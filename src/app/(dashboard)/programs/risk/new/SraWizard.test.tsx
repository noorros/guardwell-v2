// src/app/(dashboard)/programs/risk/new/SraWizard.test.tsx
//
// Audit B-1 (HIPAA findings, 2026-04-29): the wizard previously only
// saved drafts on step transition. A user answering Q1 + adding a note
// + reloading would lose everything because no save fired. Phase 5 will
// expand the SRA from 20 → 80 questions, so losing 30+ minutes to a
// misclick was an active risk.
//
// These tests assert that draft-save fires automatically after a user
// changes any answer or note — debounced so we don't hammer the server
// on every keystroke.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../actions", () => ({
  saveSraDraftAction: vi.fn(),
  completeSraAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { SraWizard } from "./SraWizard";
import { saveSraDraftAction } from "../actions";

const Q1 = {
  code: "ADMIN_Q1",
  category: "ADMINISTRATIVE" as const,
  subcategory: "Security Management Process",
  title: "Risk analysis on file",
  description: "Have you conducted an annual risk analysis?",
  guidance: null,
  lookFor: [],
};

describe("<SraWizard> auto-save (B-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveSraDraftAction).mockResolvedValue({
      assessmentId: "draft-test-1",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves draft automatically after the user picks an answer (debounced)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<SraWizard questions={[Q1]} />);

    // Pick an answer for Q1 — does NOT advance to next step.
    await user.click(screen.getByLabelText(/Yes — addressed/i));

    // No save yet — debounce is in flight.
    expect(saveSraDraftAction).not.toHaveBeenCalled();

    // Advance past the debounce window. 2.5s is comfortably past any
    // reasonable debounce; the fix uses ~1.5s.
    await vi.advanceTimersByTimeAsync(2500);

    // The auto-save MUST have fired with the answer included.
    expect(saveSraDraftAction).toHaveBeenCalled();
    const callArg = vi.mocked(saveSraDraftAction).mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    expect(callArg!.answers).toEqual([
      { questionCode: "ADMIN_Q1", answer: "YES", notes: null },
    ]);
  });

  it("saves draft after a notes-only edit (no answer change)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<SraWizard questions={[Q1]} />);

    // First an answer so subsequent saves include it.
    await user.click(screen.getByLabelText(/Partial/i));
    await vi.advanceTimersByTimeAsync(2500);
    expect(saveSraDraftAction).toHaveBeenCalled();
    vi.mocked(saveSraDraftAction).mockClear();

    // Now type into the notes textarea and confirm a save fires.
    const textarea = screen.getByPlaceholderText(/Optional notes/i);
    await user.click(textarea);
    await user.keyboard("evidence: SOC2 report");
    await vi.advanceTimersByTimeAsync(2500);

    expect(saveSraDraftAction).toHaveBeenCalled();
    const lastCall =
      vi.mocked(saveSraDraftAction).mock.calls.at(-1)?.[0];
    expect(lastCall!.answers[0]?.notes).toBe("evidence: SOC2 report");
  });

  it("does NOT save before the user has answered anything (no event spam on mount)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<SraWizard questions={[Q1]} />);
    await vi.advanceTimersByTimeAsync(5000);

    // Empty draft — no point burning a save event.
    expect(saveSraDraftAction).not.toHaveBeenCalled();
  });
});
