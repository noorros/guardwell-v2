// src/app/(dashboard)/programs/training/manage/CreateCourseForm.test.tsx
//
// Phase 4 PR 4 — DOM regression for the Dialog form. We mock the
// createCustomCourseAction so this test stays presentational; the
// action itself is exercised by tests/integration/training-actions.test.ts.

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { CreateCourseForm } from "./CreateCourseForm";

const createMock = vi.fn();
vi.mock("../actions", () => ({
  createCustomCourseAction: (...args: unknown[]) => createMock(...args),
}));

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue({
    courseId: "course-123",
    code: "practice-id_TEST",
  });
});

function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  return async () => {
    await user.type(screen.getByLabelText(/^code/i), "MY_CODE");
    await user.type(screen.getByLabelText(/^title/i), "My Course Title");
    // Type defaults to HIPAA via the select. Passing score defaults to 80.
    await user.type(
      screen.getByLabelText(/lesson content/i),
      "## Welcome\n\nLesson body.",
    );
    // First (only) question prompt + 2 options
    await user.type(
      screen.getByLabelText(/^prompt/i),
      "What is HIPAA?",
    );
    await user.type(
      screen.getByLabelText(/^question 1 option 1$/i),
      "A privacy law",
    );
    await user.type(
      screen.getByLabelText(/^question 1 option 2$/i),
      "A health plan",
    );
  };
}

describe("<CreateCourseForm>", () => {
  it("renders all top-level required fields", () => {
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    expect(screen.getByLabelText(/^code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/passing score/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/lesson content/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create course/i }),
    ).toBeInTheDocument();
  });

  it("does not call the action when code is empty (browser blocks invalid form)", async () => {
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /create course/i }));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("calls createCustomCourseAction with the parsed input on a valid submit", async () => {
    const onSuccess = vi.fn();
    render(<CreateCourseForm onSuccess={onSuccess} />);
    const user = userEvent.setup();
    await fillRequiredFields(user)();
    await user.click(screen.getByRole("button", { name: /create course/i }));
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0];
    expect(call.code).toBe("MY_CODE");
    expect(call.title).toBe("My Course Title");
    expect(call.type).toBe("HIPAA");
    expect(call.passingScore).toBe(80);
    expect(call.lessonContent).toContain("Welcome");
    expect(call.quizQuestions).toHaveLength(1);
    expect(call.quizQuestions[0].question).toBe("What is HIPAA?");
    expect(call.quizQuestions[0].options).toEqual([
      "A privacy law",
      "A health plan",
    ]);
    expect(call.quizQuestions[0].correctIndex).toBe(0);
    expect(call.quizQuestions[0].order).toBe(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("displays the error message when the action throws", async () => {
    createMock.mockRejectedValueOnce(new Error("duplicate code"));
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await fillRequiredFields(user)();
    await user.click(screen.getByRole("button", { name: /create course/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /duplicate code/i,
    );
  });

  it("uppercases & strips invalid characters typed into Code", async () => {
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    const codeInput = screen.getByLabelText(/^code/i) as HTMLInputElement;
    await user.type(codeInput, "my-code 1!");
    // Lowercase + space + dash + bang are stripped; resulting value is
    // uppercased and only letters/digits/underscore remain.
    expect(codeInput.value).toBe("MYCODE1");
  });

  it("axe-clean (default render)", async () => {
    const { container } = render(
      <CreateCourseForm onSuccess={vi.fn()} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
