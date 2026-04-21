// src/components/gw/EmptyState/EmptyState.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Users } from "lucide-react";
import { EmptyState } from ".";

describe("<EmptyState>", () => {
  it("renders title + description", () => {
    render(<EmptyState title="No staff yet" description="Invite your first user." />);
    expect(screen.getByRole("heading", { name: "No staff yet" })).toBeInTheDocument();
    expect(screen.getByText("Invite your first user.")).toBeInTheDocument();
  });

  it("uses a default icon when none is passed, marked aria-hidden", () => {
    const { container } = render(<EmptyState title="Empty" />);
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("respects a custom icon", () => {
    const { container } = render(<EmptyState icon={Users} title="No users" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders an action button and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: "Add first item", onClick }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add first item" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a link when action.href is passed (no onClick required)", () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: "Go home", href: "/dashboard" }}
      />,
    );
    const link = screen.getByRole("link", { name: "Go home" });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("has a status/region landmark so SR users hear the empty state", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders a disabled ghost-styled button when action.disabled is true", () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: "Coming soon", href: "#", disabled: true }}
      />,
    );
    // Disabled → we render a <button disabled> rather than an <a>, so there's
    // no link in the DOM.
    expect(screen.queryByRole("link", { name: "Coming soon" })).toBeNull();
    const btn = screen.getByRole("button", { name: "Coming soon" });
    expect(btn).toBeDisabled();
  });
});
