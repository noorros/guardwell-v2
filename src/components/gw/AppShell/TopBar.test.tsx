// src/components/gw/AppShell/TopBar.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";

vi.mock("@/app/(auth)/sign-out/actions", () => ({
  signOutAction: vi.fn(async () => undefined),
}));

describe("<TopBar>", () => {
  it("renders the practice name", () => {
    render(
      <TopBar
        practiceName="Acme Primary Care"
        userEmail="jane@acme.test"
        userInitials="JA"
      />,
    );
    expect(screen.getByText("Acme Primary Care")).toBeInTheDocument();
  });

  it("renders the mobile sidebar trigger slot when passed", () => {
    render(
      <TopBar
        practiceName="Acme"
        userEmail="jane@acme.test"
        userInitials="JA"
        mobileTrigger={<span data-testid="mobile-trigger" />}
      />,
    );
    expect(screen.getByTestId("mobile-trigger")).toBeInTheDocument();
  });

  it("does not render email as a plain visible label in the top bar", () => {
    render(
      <TopBar
        practiceName="Acme"
        userEmail="alice@example.com"
        userInitials="AL"
      />,
    );
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
  });

  it("renders the avatar with the supplied initials", () => {
    render(
      <TopBar
        practiceName="Acme"
        userEmail="alice@example.com"
        userInitials="AL"
      />,
    );
    expect(screen.getByRole("button", { name: /open user menu/i })).toHaveTextContent("AL");
  });

  it("does not render a standalone Sign out button (it's inside the menu now)", () => {
    render(
      <TopBar
        practiceName="Acme"
        userEmail="alice@example.com"
        userInitials="AL"
      />,
    );
    // Top bar should not have a directly-visible "Sign out" button anymore.
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
  });
});
