// src/app/(dashboard)/settings/reminders/RemindersForm.test.tsx
//
// Phase 7 PR 8 — DOM tests for the reminders form. Mocks the server
// action so this test stays presentational; the action itself is
// exercised by tests/integration/reminders-action.test.ts.
//
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { RemindersForm } from "./RemindersForm";

const saveMock = vi.fn();
vi.mock("./actions", () => ({
  saveReminderSettingsAction: (...args: unknown[]) => saveMock(...args),
}));

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockResolvedValue({ ok: true, changedCategories: [] });
});

describe("<RemindersForm>", () => {
  it("renders all 9 categories with their default schedules", () => {
    render(<RemindersForm initialSettings={null} />);
    // legend text should appear once per category
    expect(screen.getByText(/credential renewal/i)).toBeInTheDocument();
    expect(screen.getByText(/training due-soon/i)).toBeInTheDocument();
    expect(screen.getByText(/training expiring/i)).toBeInTheDocument();
    expect(screen.getByText(/policy acknowledgment/i)).toBeInTheDocument();
    expect(screen.getByText(/policy annual review/i)).toBeInTheDocument();
    expect(screen.getByText(/vendor baa/i)).toBeInTheDocument();
    expect(screen.getByText(/incident deadlines/i)).toBeInTheDocument();
    expect(screen.getByText(/dea biennial inventory/i)).toBeInTheDocument();
    expect(screen.getByText(/cms enrollment renewal/i)).toBeInTheDocument();
    // Submit button visible
    expect(
      screen.getByRole("button", { name: /save reminders/i }),
    ).toBeInTheDocument();
  });

  it("hydrates per-category override values from initialSettings", () => {
    render(
      <RemindersForm
        initialSettings={{
          credentials: [120, 30, 7],
          training: [21, 7],
        }}
      />,
    );
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    // Find the credentials + training inputs by name.
    const credentials = inputs.find((i) => i.name === "credentials")!;
    const training = inputs.find((i) => i.name === "training")!;
    expect(credentials.value).toBe("120, 30, 7");
    expect(training.value).toBe("21, 7");
  });

  it("calls saveReminderSettingsAction with parsed milestones on submit", async () => {
    render(<RemindersForm initialSettings={null} />);
    const user = userEvent.setup();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const credentials = inputs.find((i) => i.name === "credentials")!;
    await user.clear(credentials);
    await user.type(credentials, "100, 50, 10");
    await user.click(screen.getByRole("button", { name: /save reminders/i }));
    expect(saveMock).toHaveBeenCalledTimes(1);
    const call = saveMock.mock.calls[0]![0];
    expect(call.reminderSettings.credentials).toEqual([100, 50, 10]);
    // Other categories should still come through with their default values.
    expect(call.reminderSettings.training).toEqual([14, 7, 3, 1]);
  });

  it("blocks submit + shows form-level error when a value is non-integer", async () => {
    render(<RemindersForm initialSettings={null} />);
    const user = userEvent.setup();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const incidents = inputs.find((i) => i.name === "incidents")!;
    await user.clear(incidents);
    await user.type(incidents, "abc, 30");
    await user.click(screen.getByRole("button", { name: /save reminders/i }));
    expect(saveMock).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/fix the errors/i);
  });

  it("blocks submit when a value is out of [1, 1825]", async () => {
    render(<RemindersForm initialSettings={null} />);
    const user = userEvent.setup();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const baa = inputs.find((i) => i.name === "baa")!;
    await user.clear(baa);
    await user.type(baa, "0, 30");
    await user.click(screen.getByRole("button", { name: /save reminders/i }));
    expect(saveMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("rejects values above the new 1825 boundary (I-2)", async () => {
    render(<RemindersForm initialSettings={null} />);
    const user = userEvent.setup();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const cms = inputs.find((i) => i.name === "cmsEnrollment")!;
    await user.clear(cms);
    // 1826 is one above the new 1825 max -> form blocks submit.
    await user.type(cms, "1826");
    await user.click(screen.getByRole("button", { name: /save reminders/i }));
    expect(saveMock).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/fix the errors/i);
  });

  it("accepts 1825 (5-year boundary, I-2)", async () => {
    // 1825 is the new max — submitting it must pass client-side
    // validation and reach the action. Covers the CMS Medicare 5-year
    // revalidation use case.
    render(<RemindersForm initialSettings={null} />);
    const user = userEvent.setup();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const cms = inputs.find((i) => i.name === "cmsEnrollment")!;
    await user.clear(cms);
    await user.type(cms, "1825, 365");
    await user.click(screen.getByRole("button", { name: /save reminders/i }));
    expect(saveMock).toHaveBeenCalledTimes(1);
    const call = saveMock.mock.calls[0]![0];
    expect(call.reminderSettings.cmsEnrollment).toEqual([1825, 365]);
  });

  it("Reset to defaults restores the default schedule for that section only", async () => {
    render(
      <RemindersForm
        initialSettings={{
          credentials: [200, 100],
          training: [50, 10],
        }}
      />,
    );
    const user = userEvent.setup();
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const credentials = inputs.find((i) => i.name === "credentials")!;
    const training = inputs.find((i) => i.name === "training")!;
    expect(credentials.value).toBe("200, 100");
    // Reset only the credentials section.
    const resetButtons = screen.getAllByRole("button", {
      name: /reset to defaults/i,
    });
    // Click the first one (credentials, top of the form).
    await user.click(resetButtons[0]!);
    expect(credentials.value).toBe("90, 60, 30, 7");
    // Training should remain unchanged.
    expect(training.value).toBe("50, 10");
  });

  it("submitting unchanged form shows 'No changes to save'", async () => {
    saveMock.mockResolvedValue({ ok: true, changedCategories: [] });
    render(<RemindersForm initialSettings={null} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /save reminders/i }));
    // Action gets called (server is the source of truth for diff)
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent(
      /no changes to save/i,
    );
  });

  it("axe-clean (default render)", async () => {
    const { container } = render(<RemindersForm initialSettings={null} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("axe-clean with validation errors visible", async () => {
    const { container } = render(<RemindersForm initialSettings={null} />);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const incidents = inputs.find((i) => i.name === "incidents")!;
    fireEvent.change(incidents, { target: { value: "abc" } });
    const form = screen
      .getByRole("button", { name: /save reminders/i })
      .closest("form")!;
    fireEvent.submit(form);
    // Wait for the error to render.
    await screen.findByRole("alert");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
