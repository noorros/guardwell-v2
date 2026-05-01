// src/app/(dashboard)/programs/tech-assessment/new/TechWizard.test.tsx
//
// Phase 5 PR 4 — 35q Tech Assessment wizard tests. Mirrors the SRA
// wizard's coverage:
//   1. Renders 6 tabs (one per category)
//   2. Selecting an answer triggers debounced save
//   3. Debounce coalesces rapid changes
//   4. Submit button disabled until all answered (walks all 6 tabs)
//   5. Submit calls completeTechAssessmentAction and routes
//   6. Error banner via role="alert" on action failure
//   7. C1 — notes-only typing keeps submit disabled
//   8. C2 — overlapping saves use the SAME pre-allocated assessmentId
//   9. jest-axe scan on default render
//
// Fixture: 12 questions (2 per category) — small enough to assert
// against quickly, big enough to exercise the 6-Tab shell.

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
  answerTechQuestionAction: vi.fn(),
  completeTechAssessmentAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

import { TechWizard, type TechWizardQuestion } from "./TechWizard";
import {
  answerTechQuestionAction,
  completeTechAssessmentAction,
} from "../actions";

const QUESTIONS: TechWizardQuestion[] = [
  // NETWORK × 2
  {
    id: "qn1",
    code: "TECH_NETWORK_FIREWALL",
    category: "NETWORK",
    sortOrder: 10,
    riskWeight: "HIGH",
    title: "Firewall configuration",
    description: "Firewall make/model + last rule review date?",
    guidance: null,
    sraQuestionCode: "TECH_NETWORK_SECURITY",
  },
  {
    id: "qn2",
    code: "TECH_NETWORK_SEGMENTATION",
    category: "NETWORK",
    sortOrder: 20,
    riskWeight: "MEDIUM",
    title: "Network segmentation",
    description: "VLANs separating clinical from guest traffic?",
    guidance: null,
    sraQuestionCode: null,
  },
  // ENDPOINT × 2
  {
    id: "qe1",
    code: "TECH_ENDPOINT_AV",
    category: "ENDPOINT",
    sortOrder: 10,
    riskWeight: "HIGH",
    title: "Endpoint anti-malware",
    description: "EDR / AV product on every workstation?",
    guidance: null,
    sraQuestionCode: null,
  },
  {
    id: "qe2",
    code: "TECH_ENDPOINT_PATCH",
    category: "ENDPOINT",
    sortOrder: 20,
    riskWeight: "HIGH",
    title: "Patch management",
    description: "Patches applied within 30 days of release?",
    guidance: null,
    sraQuestionCode: null,
  },
  // CLOUD × 2
  {
    id: "qc1",
    code: "TECH_CLOUD_BAA",
    category: "CLOUD",
    sortOrder: 10,
    riskWeight: "HIGH",
    title: "Cloud BAA coverage",
    description: "BAA signed with every PHI cloud vendor?",
    guidance: null,
    sraQuestionCode: null,
  },
  {
    id: "qc2",
    code: "TECH_CLOUD_ENCRYPTION",
    category: "CLOUD",
    sortOrder: 20,
    riskWeight: "HIGH",
    title: "Cloud encryption at rest",
    description: "All cloud-stored PHI encrypted at rest?",
    guidance: null,
    sraQuestionCode: null,
  },
  // ACCESS × 2
  {
    id: "qa1",
    code: "TECH_ACCESS_MFA",
    category: "ACCESS",
    sortOrder: 10,
    riskWeight: "HIGH",
    title: "MFA on remote access",
    description: "MFA required on all remote access?",
    guidance: null,
    sraQuestionCode: null,
  },
  {
    id: "qa2",
    code: "TECH_ACCESS_PASSWORD",
    category: "ACCESS",
    sortOrder: 20,
    riskWeight: "MEDIUM",
    title: "Password policy",
    description: "Strong password policy enforced?",
    guidance: null,
    sraQuestionCode: null,
  },
  // MONITORING × 2
  {
    id: "qm1",
    code: "TECH_MONITORING_LOGS",
    category: "MONITORING",
    sortOrder: 10,
    riskWeight: "MEDIUM",
    title: "Centralized log collection",
    description: "Logs forwarded to a central system?",
    guidance: null,
    sraQuestionCode: null,
  },
  {
    id: "qm2",
    code: "TECH_MONITORING_REVIEW",
    category: "MONITORING",
    sortOrder: 20,
    riskWeight: "LOW",
    title: "Log review cadence",
    description: "Logs reviewed at least monthly?",
    guidance: null,
    sraQuestionCode: null,
  },
  // BACKUP × 2
  {
    id: "qb1",
    code: "TECH_BACKUP_FREQ",
    category: "BACKUP",
    sortOrder: 10,
    riskWeight: "HIGH",
    title: "Backup frequency",
    description: "Daily backups of all PHI systems?",
    guidance: null,
    sraQuestionCode: null,
  },
  {
    id: "qb2",
    code: "TECH_BACKUP_RESTORE",
    category: "BACKUP",
    sortOrder: 20,
    riskWeight: "HIGH",
    title: "Restore testing",
    description: "Restore tested in last 90 days?",
    guidance: null,
    sraQuestionCode: null,
  },
];

describe("<TechWizard>", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(answerTechQuestionAction).mockResolvedValue({
      ok: true,
      assessmentId: "fresh-assessment-id",
    });
    vi.mocked(completeTechAssessmentAction).mockResolvedValue({
      ok: true,
      assessmentId: "completed-id",
      overallScore: 100,
      addressedCount: 12,
      totalCount: 12,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    pushMock.mockClear();
  });

  it("renders one tab per category (6 categories)", () => {
    render(<TechWizard questions={QUESTIONS} />);
    expect(screen.getByRole("tab", { name: /Network/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Endpoint/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Cloud/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Access/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Monitoring/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Backup/i })).toBeInTheDocument();
  });

  it("debounces a single TECH_ASSESSMENT_QUESTION_ANSWERED save 800ms after a radio click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TechWizard questions={QUESTIONS} />);

    // NETWORK tab is the default — TECH_NETWORK_FIREWALL is visible.
    const radio = document.getElementById("q-TECH_NETWORK_FIREWALL-YES")!;
    await user.click(radio);
    expect(answerTechQuestionAction).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(answerTechQuestionAction).toHaveBeenCalledOnce();
    const arg = vi.mocked(answerTechQuestionAction).mock.calls[0]?.[0];
    expect(arg?.questionCode).toBe("TECH_NETWORK_FIREWALL");
    expect(arg?.answer).toBe("YES");
    // C2 — pre-allocated UUID, not undefined.
    expect(arg?.assessmentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("coalesces rapid changes on the same question into a single save", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TechWizard questions={QUESTIONS} />);

    await user.click(document.getElementById("q-TECH_NETWORK_FIREWALL-YES")!);
    await user.click(document.getElementById("q-TECH_NETWORK_FIREWALL-PARTIAL")!);
    await user.click(document.getElementById("q-TECH_NETWORK_FIREWALL-NO")!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(answerTechQuestionAction).toHaveBeenCalledOnce();
    expect(
      vi.mocked(answerTechQuestionAction).mock.calls[0]?.[0]?.answer,
    ).toBe("NO");
  });

  it("disables the submit button until all questions are answered", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TechWizard questions={QUESTIONS} />);

    const submit = screen.getByRole("button", { name: /Submit assessment/i });
    expect(submit).toBeDisabled();

    // Radix Tabs only mounts the active tab's content. Walk through all
    // 6 tabs, click YES on every visible question.
    const cats = ["NETWORK", "ENDPOINT", "CLOUD", "ACCESS", "MONITORING", "BACKUP"] as const;
    for (const cat of cats) {
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

  it("submits via completeTechAssessmentAction and routes to the assessment page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <TechWizard
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

    expect(completeTechAssessmentAction).toHaveBeenCalledOnce();
    const arg = vi.mocked(completeTechAssessmentAction).mock.calls[0]?.[0];
    expect(arg?.assessmentId).toBe("draft-1");
    expect(arg?.answers).toHaveLength(12);
    expect(pushMock).toHaveBeenCalledWith("/programs/tech-assessment/completed-id");
  });

  it("surfaces a completeTechAssessmentAction error in the role=alert banner", async () => {
    vi.mocked(completeTechAssessmentAction).mockResolvedValueOnce({
      ok: false,
      error: "Server is sad",
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <TechWizard
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
  // PR 3 polish, applied from the start of PR 4.
  // ─────────────────────────────────────────────────────────────────

  it("does NOT enable submit (and does NOT save) when the user only types notes without picking radios (C1 phantom-YES guard)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TechWizard questions={QUESTIONS} />);

    // Type notes for every question across all 6 categories WITHOUT
    // ever clicking a radio.
    const cats = ["NETWORK", "ENDPOINT", "CLOUD", "ACCESS", "MONITORING", "BACKUP"] as const;
    for (const cat of cats) {
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

    // No save fired — setAnswer guard is `if (merged.answer)` and with
    // C1 fixed merged.answer is null when only notes was patched.
    expect(answerTechQuestionAction).not.toHaveBeenCalled();

    // Submit still disabled — answeredQuestions filter rejects rows
    // with null answer.
    expect(
      screen.getByRole("button", { name: /Submit assessment/i }),
    ).toBeDisabled();
  });

  it("uses the same pre-allocated assessmentId across two overlapping per-question saves (C2 TOCTOU guard)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const receivedIds: (string | undefined)[] = [];
    vi.mocked(answerTechQuestionAction).mockImplementation(async (input) => {
      receivedIds.push(input.assessmentId);
      return { ok: true, assessmentId: input.assessmentId ?? "fallback-id" };
    });

    render(<TechWizard questions={QUESTIONS} />);

    // Click two different questions before any debounce fires. With
    // independent debounce windows per question code, both timers
    // expire at +800ms and fire two parallel saves.
    await user.click(document.getElementById("q-TECH_NETWORK_FIREWALL-YES")!);
    await user.click(document.getElementById("q-TECH_NETWORK_SEGMENTATION-NO")!);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(answerTechQuestionAction).toHaveBeenCalledTimes(2);
    expect(receivedIds).toHaveLength(2);
    expect(receivedIds[0]).toBeDefined();
    expect(receivedIds[1]).toBeDefined();
    expect(receivedIds[0]).toBe(receivedIds[1]);
    expect(receivedIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("passes a jest-axe scan with no violations on default render", async () => {
    const { container } = render(<TechWizard questions={QUESTIONS} />);
    const results = await axe(container, {
      rules: { region: { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
