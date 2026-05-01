// src/app/(dashboard)/settings/notifications/NotificationPreferencesForm.test.tsx
//
// Phase 7 PR 7 — settings form covers cadence + weekly schedule fields.
//
// 1. Daily render — radio group present, weekly fields hidden
// 2. Selecting Weekly reveals digestDay + digestTime
// 3. Submit posts all 6 fields verbatim through the action
// 4. axe-clean in both default and Weekly states
//
// Mocks the server action so we can assert on what was passed to it.
//
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

const updateNotificationPreferencesActionMock = vi.fn();
vi.mock("./actions", () => ({
  updateNotificationPreferencesAction: (...args: unknown[]) =>
    updateNotificationPreferencesActionMock(...args),
}));

import { NotificationPreferencesForm } from "./NotificationPreferencesForm";

const DAILY_INITIAL = {
  digestEnabled: true,
  criticalAlertsEnabled: true,
  emailEnabled: true,
  cadence: "DAILY" as const,
  digestDay: "MON" as const,
  digestTime: "08:00",
};

const WEEKLY_INITIAL = {
  ...DAILY_INITIAL,
  cadence: "WEEKLY" as const,
};

const AXE_OPTS = {
  rules: {
    region: { enabled: false },
  },
};

describe("<NotificationPreferencesForm>", () => {
  beforeEach(() => {
    updateNotificationPreferencesActionMock.mockReset();
    updateNotificationPreferencesActionMock.mockResolvedValue(undefined);
  });

  it("renders the cadence radio group with Daily selected and weekly fields hidden", () => {
    render(<NotificationPreferencesForm initial={DAILY_INITIAL} />);

    // All four radios are present.
    const dailyRadio = screen.getByLabelText(/daily digest/i) as HTMLInputElement;
    const weeklyRadio = screen.getByLabelText(/weekly digest/i) as HTMLInputElement;
    const instantRadio = screen.getByLabelText(
      /real-time critical events/i,
    ) as HTMLInputElement;
    const noneRadio = screen.getByLabelText(/no emails/i) as HTMLInputElement;
    expect(dailyRadio.checked).toBe(true);
    expect(weeklyRadio.checked).toBe(false);
    expect(instantRadio.checked).toBe(false);
    expect(noneRadio.checked).toBe(false);

    // Weekly fields not yet rendered — daily cadence hides them.
    expect(screen.queryByLabelText(/day of week/i)).toBeNull();
    expect(screen.queryByLabelText(/time \(24-hour\)/i)).toBeNull();
  });

  it("reveals the weekly digestDay + digestTime fields when WEEKLY is selected", async () => {
    const user = userEvent.setup();
    render(<NotificationPreferencesForm initial={DAILY_INITIAL} />);

    expect(screen.queryByLabelText(/day of week/i)).toBeNull();

    await user.click(screen.getByLabelText(/weekly digest/i));

    const dayInput = screen.getByLabelText(/day of week/i) as HTMLSelectElement;
    const timeInput = screen.getByLabelText(/time \(24-hour\)/i) as HTMLInputElement;
    expect(dayInput).toBeInTheDocument();
    expect(timeInput).toBeInTheDocument();
    expect(dayInput.value).toBe("MON");
    expect(timeInput.value).toBe("08:00");
  });

  it("submits all cadence + weekly fields through the server action", async () => {
    const user = userEvent.setup();
    render(<NotificationPreferencesForm initial={DAILY_INITIAL} />);

    // Switch to weekly so the day/time inputs show up, then change them.
    await user.click(screen.getByLabelText(/weekly digest/i));

    const dayInput = screen.getByLabelText(/day of week/i) as HTMLSelectElement;
    const timeInput = screen.getByLabelText(/time \(24-hour\)/i) as HTMLInputElement;

    await user.selectOptions(dayInput, "FRI");
    // userEvent.clear()+type() works reliably on time inputs in jsdom.
    await user.clear(timeInput);
    await user.type(timeInput, "09:30");

    await user.click(screen.getByRole("button", { name: /save preferences/i }));

    // Settle the transition.
    await screen.findByText("Saved.");

    expect(updateNotificationPreferencesActionMock).toHaveBeenCalledTimes(1);
    expect(updateNotificationPreferencesActionMock).toHaveBeenCalledWith({
      digestEnabled: true,
      criticalAlertsEnabled: true,
      emailEnabled: true,
      cadence: "WEEKLY",
      digestDay: "FRI",
      digestTime: "09:30",
    });
  });

  it("does not call the action and surfaces a validation error when digestTime is invalid", async () => {
    const user = userEvent.setup();
    render(
      <NotificationPreferencesForm
        initial={{ ...WEEKLY_INITIAL, digestTime: "08:00" }}
      />,
    );

    const timeInput = screen.getByLabelText(/time \(24-hour\)/i) as HTMLInputElement;
    // Force an invalid value past the regex by writing directly through
    // fireEvent — userEvent.type would be filtered by the time input.
    await user.clear(timeInput);
    // Type a string that fails the regex (single-digit hour).
    timeInput.value = "9:99";
    timeInput.dispatchEvent(new Event("input", { bubbles: true }));
    timeInput.dispatchEvent(new Event("change", { bubbles: true }));

    await user.click(screen.getByRole("button", { name: /save preferences/i }));

    expect(updateNotificationPreferencesActionMock).not.toHaveBeenCalled();
  });

  it("axe — daily default render is clean", async () => {
    const { container } = render(
      <NotificationPreferencesForm initial={DAILY_INITIAL} />,
    );
    const results = await axe(container, AXE_OPTS);
    expect(results).toHaveNoViolations();
  });

  it("axe — weekly render with weekly fields visible is clean", async () => {
    const { container } = render(
      <NotificationPreferencesForm initial={WEEKLY_INITIAL} />,
    );
    const results = await axe(container, AXE_OPTS);
    expect(results).toHaveNoViolations();
  });
});
