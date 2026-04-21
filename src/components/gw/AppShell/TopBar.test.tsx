// src/components/gw/AppShell/TopBar.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";

describe("<TopBar>", () => {
  it("renders the practice name", () => {
    render(<TopBar practiceName="Acme Primary Care" userEmail="jane@acme.test" />);
    expect(screen.getByText("Acme Primary Care")).toBeInTheDocument();
  });

  it("renders the user email", () => {
    render(<TopBar practiceName="Acme Primary Care" userEmail="jane@acme.test" />);
    expect(screen.getByText("jane@acme.test")).toBeInTheDocument();
  });

  it("renders a Sign out submit button inside a form", () => {
    render(<TopBar practiceName="Acme" userEmail="jane@acme.test" />);
    const button = screen.getByRole("button", { name: /sign out/i });
    expect(button).toHaveAttribute("type", "submit");
    // Nearest ancestor form should point at the sign-out route.
    const form = button.closest("form");
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute("action");
  });

  it("renders the mobile sidebar trigger slot when passed", () => {
    render(
      <TopBar
        practiceName="Acme"
        userEmail="jane@acme.test"
        mobileTrigger={<span data-testid="mobile-trigger" />}
      />,
    );
    expect(screen.getByTestId("mobile-trigger")).toBeInTheDocument();
  });
});
