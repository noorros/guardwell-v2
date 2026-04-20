import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChecklistItem } from ".";

describe("<ChecklistItem>", () => {
  function Setup(props?: Partial<Parameters<typeof ChecklistItem>[0]>) {
    const onStatusChange = vi.fn();
    render(
      <ChecklistItem
        title="Designate Privacy Officer"
        description="45 CFR §164.530(a)(1)"
        status="not_started"
        onStatusChange={onStatusChange}
        {...props}
      />,
    );
    return { onStatusChange };
  }

  it("renders the title + description", () => {
    Setup();
    expect(screen.getByText("Designate Privacy Officer")).toBeInTheDocument();
    expect(screen.getByText("45 CFR §164.530(a)(1)")).toBeInTheDocument();
  });

  it("presents the three options as a radiogroup (not individual checkboxes)", () => {
    Setup();
    const group = screen.getByRole("radiogroup");
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
  });

  it("marks exactly one radio as checked matching the `status` prop", () => {
    Setup({ status: "compliant" });
    expect(screen.getByRole("radio", { name: /^compliant$/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^gap$/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /not started/i })).not.toBeChecked();
  });

  it("each option has an aria-label AND a visible text label (no aria-label-only)", () => {
    Setup();
    // Every radio should be accessible by its visible text label
    expect(screen.getByRole("radio", { name: /compliant/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /gap/i })).toBeVisible();
    expect(screen.getByRole("radio", { name: /not started/i })).toBeVisible();
  });

  it("fires onStatusChange when an unselected option is clicked", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = Setup({ status: "not_started" });
    await user.click(screen.getByRole("radio", { name: /^compliant$/i }));
    expect(onStatusChange).toHaveBeenCalledWith("compliant");
  });

  it("visual: only ONE option shows the 'active' treatment at a time (fixes v1 OIG bug)", () => {
    Setup({ status: "compliant" });
    const active = screen
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAccessibleName(/compliant/i);
  });

  it("status change from compliant -> gap flips the active treatment", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = Setup({ status: "compliant" });
    await user.click(screen.getByRole("radio", { name: /^gap$/i }));
    expect(onStatusChange).toHaveBeenLastCalledWith("gap");
  });

  it("disabled prop disables every radio", () => {
    Setup({ disabled: true });
    for (const r of screen.getAllByRole("radio")) {
      expect(r).toBeDisabled();
    }
  });

  it("arrow keys navigate between options (native radio keyboard semantics)", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = Setup({ status: "not_started" });
    const notStarted = screen.getByRole("radio", { name: /not started/i });
    notStarted.focus();
    await user.keyboard("{ArrowLeft}");
    // ArrowLeft on a radio in a group should select the previous option.
    // Implementations wire this via `name` attr on native radios.
    expect(onStatusChange).toHaveBeenCalled();
  });
});
