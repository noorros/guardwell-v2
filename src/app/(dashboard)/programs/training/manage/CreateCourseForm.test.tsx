// src/app/(dashboard)/programs/training/manage/CreateCourseForm.test.tsx
//
// Phase 4 PR 4 — DOM regression for the Dialog form. We mock the
// createCustomCourseAction so this test stays presentational; the
// action itself is exercised by tests/integration/training-actions.test.ts.
//
// Phase 4 PR 6 — adds video upload coverage. The EvidenceUploader is
// mocked since its 3-step fetch flow is exercised by its own tests.

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { CreateCourseForm } from "./CreateCourseForm";

const createMock = vi.fn();
vi.mock("../actions", () => ({
  createCustomCourseAction: (...args: unknown[]) => createMock(...args),
}));

// Mock the EvidenceUploader so we don't have to drive its 3-step fetch
// flow. The test trigger button calls onUploaded with a fake evidenceId
// to simulate a successful upload.
vi.mock("@/components/gw/EvidenceUploader", () => ({
  EvidenceUploader: (props: { onUploaded: (id: string) => void }) => (
    <button
      type="button"
      data-testid="evidence-uploader-mock"
      onClick={() => props.onUploaded("ev-uploaded-id")}
    >
      Mock upload trigger
    </button>
  ),
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

  it("shows 'Code is required' (not the regex message) for an empty Code", async () => {
    // Phase 4 PR 4 review I-1: validate() must check empty/length BEFORE
    // regex so a blank Code surfaces the helpful "Code is required" rather
    // than the misleading "uppercase letters, digits, or underscore" error.
    //
    // The Code <input> has required, so a real browser would block this
    // submit at the HTML5 layer before our handler runs. We bypass that
    // by dispatching the submit event directly via fireEvent — this
    // mirrors what happens if a user disables JS-side validation, and
    // also exercises validate() as the defense-in-depth backstop.
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    const form = screen
      .getByRole("button", { name: /create course/i })
      .closest("form")!;
    fireEvent.submit(form);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/code is required/i);
    expect(alert.textContent).not.toMatch(/uppercase letters/i);
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

  it("submits with videoEvidenceId + videoDurationSec when a video is uploaded (Phase 4 PR 6)", async () => {
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await fillRequiredFields(user)();
    // Simulate the EvidenceUploader's successful upload
    await user.click(screen.getByTestId("evidence-uploader-mock"));
    // Now the duration input should be visible
    const dur = screen.getByLabelText(/video duration/i);
    await user.type(dur, "600");
    await user.click(screen.getByRole("button", { name: /create course/i }));
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0];
    expect(call.videoEvidenceId).toBe("ev-uploaded-id");
    expect(call.videoDurationSec).toBe(600);
  });

  it("submits with videoEvidenceId=null when no video is uploaded", async () => {
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await fillRequiredFields(user)();
    await user.click(screen.getByRole("button", { name: /create course/i }));
    const call = createMock.mock.calls[0]![0];
    expect(call.videoEvidenceId).toBeNull();
    expect(call.videoDurationSec).toBeNull();
  });

  it("blocks submit when a video is uploaded but duration is empty", async () => {
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await fillRequiredFields(user)();
    await user.click(screen.getByTestId("evidence-uploader-mock"));
    // Don't fill the duration — submit should fail validation.
    const form = screen
      .getByRole("button", { name: /create course/i })
      .closest("form")!;
    fireEvent.submit(form);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/video duration.*required/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("removes the video upload when user clicks Remove (resets duration too)", async () => {
    render(<CreateCourseForm onSuccess={vi.fn()} />);
    const user = userEvent.setup();
    await fillRequiredFields(user)();
    await user.click(screen.getByTestId("evidence-uploader-mock"));
    const dur = screen.getByLabelText(/video duration/i) as HTMLInputElement;
    await user.type(dur, "600");
    expect(dur.value).toBe("600");
    // Click Remove
    await user.click(screen.getByRole("button", { name: /^remove$/i }));
    // Duration field is gone; uploader is back
    expect(screen.queryByLabelText(/video duration/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("evidence-uploader-mock")).toBeInTheDocument();
    // Submit succeeds with no video
    await user.click(screen.getByRole("button", { name: /create course/i }));
    const call = createMock.mock.calls[0]![0];
    expect(call.videoEvidenceId).toBeNull();
    expect(call.videoDurationSec).toBeNull();
  });
});
