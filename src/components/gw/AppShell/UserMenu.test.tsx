import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { UserMenu } from "./UserMenu";

expect.extend(toHaveNoViolations);

vi.mock("@/app/(auth)/sign-out/actions", () => ({
  signOutAction: vi.fn(async () => undefined),
}));

vi.mock("@/app/(dashboard)/settings/switch-practice/actions", () => ({
  switchPracticeAction: vi.fn(async () => undefined),
}));

// Radix DropdownMenu in jsdom needs these PointerEvent APIs that jsdom
// doesn't ship. Stub them so the trigger's pointer-down handler can run
// (Radix bails out otherwise and the menu never opens).
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
});

describe("UserMenu", () => {
  const baseProps = {
    userEmail: "alice@example.com",
    practiceName: "Acme Family Medicine",
    userInitials: "AL",
    memberships: [],
    currentPracticeId: "p1",
  };

  // Audit #7: a separate baseline with multi-practice memberships so the
  // switcher branch is exercised.
  const multiPracticeProps = {
    ...baseProps,
    currentPracticeId: "p1",
    memberships: [
      { practiceId: "p1", practiceName: "Acme Family Medicine", role: "OWNER" },
      { practiceId: "p2", practiceName: "Beta Clinic", role: "ADMIN" },
    ],
  };

  it("renders the avatar trigger with the initials", () => {
    render(<UserMenu {...baseProps} />);
    expect(screen.getByRole("button", { name: /open user menu/i })).toHaveTextContent("AL");
  });

  it("opens the menu and shows email + practice name in header", async () => {
    const user = userEvent.setup();
    render(<UserMenu {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Acme Family Medicine")).toBeInTheDocument();
  });

  it("renders 4 navigation items + sign out", async () => {
    const user = userEvent.setup();
    render(<UserMenu {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    expect(await screen.findByText(/practice profile/i)).toBeInTheDocument();
    expect(screen.getByText(/notifications/i)).toBeInTheDocument();
    expect(screen.getByText(/subscription/i)).toBeInTheDocument();
    expect(screen.getByText(/sign out/i)).toBeInTheDocument();
  });

  it("links Practice profile to /settings/practice", async () => {
    const user = userEvent.setup();
    render(<UserMenu {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    const link = await screen.findByText(/practice profile/i);
    expect(link.closest("a")).toHaveAttribute("href", "/settings/practice");
  });

  it("links Subscription to /settings/subscription", async () => {
    const user = userEvent.setup();
    render(<UserMenu {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    const link = await screen.findByText(/subscription/i);
    expect(link.closest("a")).toHaveAttribute("href", "/settings/subscription");
  });

  it("passes axe a11y audit when open", async () => {
    const user = userEvent.setup();
    const { container } = render(<UserMenu {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    await screen.findByText("alice@example.com");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // ────────────────────────────────────────────────────────────────────
  // Audit #7 — Practice switcher (HIPAA B-3)
  // ────────────────────────────────────────────────────────────────────

  it("does NOT render the Switch practice section when only 1 membership", async () => {
    const user = userEvent.setup();
    render(
      <UserMenu
        {...baseProps}
        memberships={[{ practiceId: "p1", practiceName: "Solo", role: "OWNER" }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    await screen.findByText("alice@example.com");
    expect(screen.queryByText(/switch practice/i)).not.toBeInTheDocument();
  });

  it("renders the Switch practice section when 2+ memberships", async () => {
    const user = userEvent.setup();
    render(<UserMenu {...multiPracticeProps} />);
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    expect(await screen.findByText(/switch practice/i)).toBeInTheDocument();
    // Both practice names rendered as buttons in the switcher.
    expect(screen.getByRole("button", { name: /acme family medicine/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /beta clinic/i })).toBeInTheDocument();
  });

  it("disables the current practice and enables the others", async () => {
    const user = userEvent.setup();
    render(<UserMenu {...multiPracticeProps} />);
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    await screen.findByText(/switch practice/i);
    const current = screen.getByRole("button", { name: /acme family medicine/i });
    const other = screen.getByRole("button", { name: /beta clinic/i });
    expect(current).toBeDisabled();
    expect(current).toHaveAttribute("aria-current", "true");
    expect(other).toBeEnabled();
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("renders each membership's role under the practice name", async () => {
    const user = userEvent.setup();
    render(<UserMenu {...multiPracticeProps} />);
    await user.click(screen.getByRole("button", { name: /open user menu/i }));
    await screen.findByText(/switch practice/i);
    expect(screen.getByText("OWNER")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
  });
});
