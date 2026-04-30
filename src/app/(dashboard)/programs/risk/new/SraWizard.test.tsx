// src/app/(dashboard)/programs/risk/new/SraWizard.test.tsx
//
// Audit item #4 (2026-04-29) — SRA wizard previously only saved a draft
// when the user navigated between steps. A user who answered Q1, typed
// a note, and reloaded their tab 8 seconds later lost both. The fix
// debounces an auto-save on every answer/note change.
//
// These tests use vitest fake timers to advance through the
// AUTOSAVE_DEBOUNCE_MS window deterministically.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../actions", () => ({
  saveSraDraftAction: vi.fn(),
  completeSraAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { SraWizard, type SraWizardQuestion } from "./SraWizard";
import { saveSraDraftAction } from "../actions";

const QUESTIONS: SraWizardQuestion[] = [
  {
    code: "ADMIN_001",
    category: "ADMINISTRATIVE",
    subcategory: "Risk Management",
    title: "Risk analysis",
    description: "Have you conducted an annual risk analysis?",
    guidance: null,
    lookFor: [],
  },
];

describe("<SraWizard> auto-save", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(saveSraDraftAction).mockResolvedValue({
      assessmentId: "test-assessment-id",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("saves a draft 800ms after a radio change (no step navigation)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SraWizard questions={QUESTIONS} />);

    // Answer the first question — this is the path that previously
    // would NOT have triggered any save.
    await user.click(screen.getByRole("radio", { name: "Yes — addressed" }));
    expect(saveSraDraftAction).not.toHaveBeenCalled();

    // Advance past the 800ms debounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(saveSraDraftAction).toHaveBeenCalledOnce();
    const arg = vi.mocked(saveSraDraftAction).mock.calls[0]?.[0];
    expect(arg?.currentStep).toBe(0);
    expect(arg?.answers).toHaveLength(1);
    expect(arg?.answers[0]?.answer).toBe("YES");
    expect(arg?.answers[0]?.questionCode).toBe("ADMIN_001");
  });

  it("coalesces rapid changes into a single save", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SraWizard questions={QUESTIONS} />);

    // Three quick clicks within the debounce window.
    await user.click(screen.getByRole("radio", { name: "Yes — addressed" }));
    await user.click(screen.getByRole("radio", { name: "Partial" }));
    await user.click(screen.getByRole("radio", { name: "No — gap" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    // One save with the final value, not three saves with intermediate ones.
    expect(saveSraDraftAction).toHaveBeenCalledOnce();
    expect(
      vi.mocked(saveSraDraftAction).mock.calls[0]?.[0]?.answers[0]?.answer,
    ).toBe("NO");
  });

  it("does not auto-save on initial render even when initialState is provided", async () => {
    render(
      <SraWizard
        questions={QUESTIONS}
        initialState={{
          assessmentId: "existing-id",
          currentStep: 0,
          answers: { ADMIN_001: "YES" },
          notes: {},
        }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(saveSraDraftAction).not.toHaveBeenCalled();
  });

  it("debounces note typing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SraWizard questions={QUESTIONS} />);

    // Need at least one answer for the save to fire (matches the
    // existing "no save when nothing answered" guard in persistDraft).
    await user.click(screen.getByRole("radio", { name: "Yes — addressed" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    vi.mocked(saveSraDraftAction).mockClear();

    // Type into the first textarea.
    const textarea = screen.getAllByPlaceholderText(/Optional notes/i)[0]!;
    await user.type(textarea, "Annual SRA documented in /docs/sra-2026.pdf");

    // Mid-typing — no save yet.
    expect(saveSraDraftAction).not.toHaveBeenCalled();

    // After debounce — exactly one save with the final notes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(saveSraDraftAction).toHaveBeenCalledOnce();
    expect(
      vi.mocked(saveSraDraftAction).mock.calls[0]?.[0]?.answers[0]?.notes,
    ).toBe("Annual SRA documented in /docs/sra-2026.pdf");
  });
});
