// src/app/(dashboard)/programs/risk/new/SraWizard.test.tsx
//
// Phase 5 PR 3 — 80q SRA wizard. Tests cover the per-question
// debounced autosave (audit #4 pattern, now firing answerSraQuestionAction
// instead of saveSraDraftAction), the Tabs render, the disabled-until-
// all-answered submit button, the success / error paths through
// completeSraAction, and a jest-axe scan of the default render.
//
// Fixture: 9 questions (3 per category) — small enough to assert
// against in a test, big enough to exercise the Tabs + Accordion
// shells.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

const pushMock = vi.fn();

vi.mock("../actions", () => ({
  answerSraQuestionAction: vi.fn(),
  completeSraAction: vi.fn(),
  saveSraDraftAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

import { SraWizard, type SraWizardQuestion } from "./SraWizard";
import {
  answerSraQuestionAction,
  completeSraAction,
} from "../actions";

const QUESTIONS: SraWizardQuestion[] = [
  // ADMINISTRATIVE × 3
  {
    id: "qa1",
    code: "ADMIN_001",
    category: "ADMINISTRATIVE",
    subcategory: "Risk Management",
    sortOrder: 10,
    riskWeight: "HIGH",
    title: "Risk analysis",
    description: "Annual risk analysis documented?",
    guidance: null,
    lookFor: [],
    citation: "§164.308(a)(1)(ii)(A)",
    cites2026: false,
  },
  {
    id: "qa2",
    code: "ADMIN_002",
    category: "ADMINISTRATIVE",
    subcategory: "Risk Management",
    sortOrder: 20,
    riskWeight: "MEDIUM",
    title: "Risk management process",
    description: "Risk management plan in place?",
    guidance: null,
    lookFor: [],
    citation: null,
    cites2026: false,
  },
  {
    id: "qa3",
    code: "ADMIN_003",
    category: "ADMINISTRATIVE",
    subcategory: "Workforce Security",
    sortOrder: 30,
    riskWeight: "LOW",
    title: "Sanction policy",
    description: "Workforce sanction policy?",
    guidance: null,
    lookFor: [],
    citation: null,
    cites2026: false,
  },
  // PHYSICAL × 3
  {
    id: "qp1",
    code: "PHYS_001",
    category: "PHYSICAL",
    subcategory: "Facility Access",
    sortOrder: 10,
    riskWeight: "HIGH",
    title: "Facility access controls",
    description: "Procedures to limit physical access?",
    guidance: null,
    lookFor: [],
    citation: null,
    cites2026: false,
  },
  {
    id: "qp2",
    code: "PHYS_002",
    category: "PHYSICAL",
    subcategory: "Facility Access",
    sortOrder: 20,
    riskWeight: "MEDIUM",
    title: "Facility security plan",
    description: "Documented physical security plan?",
    guidance: null,
    lookFor: [],
    citation: null,
    cites2026: false,
  },
  {
    id: "qp3",
    code: "PHYS_003",
    category: "PHYSICAL",
    subcategory: "Workstation Security",
    sortOrder: 30,
    riskWeight: "LOW",
    title: "Workstation use policy",
    description: "Workstation use restricted?",
    guidance: null,
    lookFor: [],
    citation: null,
    cites2026: false,
  },
  // TECHNICAL × 3
  {
    id: "qt1",
    code: "TECH_001",
    category: "TECHNICAL",
    subcategory: "Access Control",
    sortOrder: 10,
    riskWeight: "HIGH",
    title: "Unique user identification",
    description: "Each workforce member has a unique account?",
    guidance: null,
    lookFor: [],
    citation: null,
    cites2026: false,
  },
  {
    id: "qt2",
    code: "TECH_002",
    category: "TECHNICAL",
    subcategory: "Access Control",
    sortOrder: 20,
    riskWeight: "HIGH",
    title: "Automatic logoff",
    description: "Sessions auto-logoff after inactivity?",
    guidance: null,
    lookFor: [],
    citation: null,
    cites2026: false,
  },
  {
    id: "qt3",
    code: "TECH_003",
    category: "TECHNICAL",
    subcategory: "Audit Controls",
    sortOrder: 30,
    riskWeight: "MEDIUM",
    title: "Audit log review",
    description: "Audit logs reviewed regularly?",
    guidance: null,
    lookFor: [],
    citation: null,
    cites2026: false,
  },
];

describe("<SraWizard>", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(answerSraQuestionAction).mockResolvedValue({
      ok: true,
      assessmentId: "fresh-assessment-id",
    });
    vi.mocked(completeSraAction).mockResolvedValue({
      assessmentId: "completed-id",
      overallScore: 100,
      addressedCount: 9,
      totalCount: 9,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    pushMock.mockClear();
  });

  it("renders one tab per category", () => {
    render(<SraWizard questions={QUESTIONS} />);
    expect(
      screen.getByRole("tab", { name: /Administrative/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Physical/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Technical/i }),
    ).toBeInTheDocument();
  });

  it("debounces a single SRA_QUESTION_ANSWERED save 800ms after a radio click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SraWizard questions={QUESTIONS} />);

    // Click the YES radio for ADMIN_001. Each radio's accessible name
    // is just the answer label ("Yes" / "Partial" / etc.), so query by
    // id which is unique per (question, answer).
    const radio = document.getElementById("q-ADMIN_001-YES")!;
    await user.click(radio);
    expect(answerSraQuestionAction).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(answerSraQuestionAction).toHaveBeenCalledOnce();
    const arg = vi.mocked(answerSraQuestionAction).mock.calls[0]?.[0];
    expect(arg?.questionCode).toBe("ADMIN_001");
    expect(arg?.answer).toBe("YES");
    // C2 fix — assessmentId is pre-allocated synchronously on mount.
    // It should be a non-empty UUID-shaped string, not undefined.
    expect(arg?.assessmentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("coalesces rapid changes on the same question into a single save", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SraWizard questions={QUESTIONS} />);

    await user.click(document.getElementById("q-ADMIN_001-YES")!);
    await user.click(document.getElementById("q-ADMIN_001-PARTIAL")!);
    await user.click(document.getElementById("q-ADMIN_001-NO")!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(answerSraQuestionAction).toHaveBeenCalledOnce();
    expect(
      vi.mocked(answerSraQuestionAction).mock.calls[0]?.[0]?.answer,
    ).toBe("NO");
  });

  it("disables the submit button until all questions are answered", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SraWizard questions={QUESTIONS} />);

    const submit = screen.getByRole("button", { name: /Submit assessment/i });
    expect(submit).toBeDisabled();

    // Radix Tabs only mounts the active tab's content. Walk through all
    // three tabs, click YES on every visible question.
    for (const cat of ["ADMINISTRATIVE", "PHYSICAL", "TECHNICAL"] as const) {
      await user.click(screen.getByRole("tab", { name: new RegExp(cat, "i") }));
      const visible = QUESTIONS.filter((q) => q.category === cat);
      for (const q of visible) {
        const r = document.getElementById(`q-${q.code}-YES`);
        if (r) {
          await user.click(r);
        }
      }
    }

    expect(submit).not.toBeDisabled();
  });

  it("submits via completeSraAction and routes to the assessment page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <SraWizard
        questions={QUESTIONS}
        initialState={{
          assessmentId: "draft-1",
          answers: Object.fromEntries(
            QUESTIONS.map((q) => [q.code, { answer: "YES" as const, notes: null }]),
          ),
        }}
      />,
    );

    const submit = screen.getByRole("button", { name: /Submit assessment/i });
    expect(submit).not.toBeDisabled();

    await user.click(submit);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(completeSraAction).toHaveBeenCalledOnce();
    const arg = vi.mocked(completeSraAction).mock.calls[0]?.[0];
    expect(arg?.assessmentId).toBe("draft-1");
    expect(arg?.answers).toHaveLength(9);
    expect(pushMock).toHaveBeenCalledWith("/programs/risk/completed-id");
  });

  it("surfaces a completeSraAction error in the role=alert banner", async () => {
    vi.mocked(completeSraAction).mockRejectedValueOnce(
      new Error("Server is sad"),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <SraWizard
        questions={QUESTIONS}
        initialState={{
          assessmentId: "draft-1",
          answers: Object.fromEntries(
            QUESTIONS.map((q) => [q.code, { answer: "YES" as const, notes: null }]),
          ),
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Submit assessment/i }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Server is sad/i);
  });

  // ─────────────────────────────────────────────────────────────────
  // Phase 5 PR 3 polish — review-pass regression coverage.
  // ─────────────────────────────────────────────────────────────────

  it("does NOT enable submit (and does NOT save) when the user only types notes without picking radios (C1 phantom-YES guard)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SraWizard questions={QUESTIONS} />);

    // Type notes for every question across all three categories WITHOUT
    // ever clicking a radio. Pre-fix this would (a) save phantom-YES
    // rows via answerSraQuestionAction and (b) light up the submit
    // button because answeredQuestions.length === questions.length.
    for (const cat of ["ADMINISTRATIVE", "PHYSICAL", "TECHNICAL"] as const) {
      await user.click(screen.getByRole("tab", { name: new RegExp(cat, "i") }));
      const visible = QUESTIONS.filter((q) => q.category === cat);
      for (const q of visible) {
        const notes = document.getElementById(`q-${q.code}-notes`) as
          | HTMLTextAreaElement
          | null;
        if (notes) {
          await user.type(notes, "evidence link");
        }
      }
    }

    // Flush any debounced timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    // No save fired — the setAnswer guard is `if (merged.answer)`, and
    // with C1 fixed merged.answer is null when only notes was patched.
    expect(answerSraQuestionAction).not.toHaveBeenCalled();

    // Submit button still disabled — answeredQuestions filter rejects
    // rows with null answer, so score.totalCount < questions.length.
    expect(
      screen.getByRole("button", { name: /Submit assessment/i }),
    ).toBeDisabled();
  });

  it("uses the same pre-allocated assessmentId across two overlapping per-question saves (C2 TOCTOU guard)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Capture every assessmentId that the action receives. Pre-fix,
    // overlapping first-saves both went out with assessmentId=undefined
    // and the action minted two distinct UUIDs (orphan drafts). With
    // the wizard pre-allocating a client UUID, BOTH calls must carry
    // the SAME assessmentId.
    const receivedIds: (string | undefined)[] = [];
    vi.mocked(answerSraQuestionAction).mockImplementation(async (input) => {
      receivedIds.push(input.assessmentId);
      return { ok: true, assessmentId: input.assessmentId ?? "fallback-id" };
    });

    render(<SraWizard questions={QUESTIONS} />);

    // Click two different questions before any debounce fires. With
    // independent debounce windows per question code, both timers
    // expire at +800ms and fire two parallel saves.
    await user.click(document.getElementById("q-ADMIN_001-YES")!);
    await user.click(document.getElementById("q-ADMIN_002-NO")!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(answerSraQuestionAction).toHaveBeenCalledTimes(2);
    expect(receivedIds).toHaveLength(2);
    expect(receivedIds[0]).toBeDefined();
    expect(receivedIds[1]).toBeDefined();
    expect(receivedIds[0]).toBe(receivedIds[1]);
    expect(receivedIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("passes a jest-axe scan with no violations on default render", async () => {
    const { container } = render(<SraWizard questions={QUESTIONS} />);
    // Disable region rule — Tabs/Accordion render <ol> + <ul> which
    // jest-axe sometimes flags as missing landmarks at the leaf level.
    const results = await axe(container, {
      rules: { region: { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
