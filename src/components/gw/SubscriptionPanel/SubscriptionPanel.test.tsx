import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubscriptionPanel } from "./index";

// The portal action is called server-side via form action — for these tests,
// we're rendering the panel and asserting the visual state.
vi.mock("@/lib/billing/portal", () => ({
  openBillingPortalAction: vi.fn(),
}));

describe("SubscriptionPanel", () => {
  const baseProps = {
    subscriptionStatus: "ACTIVE" as const,
    currentPeriodEnd: new Date("2026-05-29T00:00:00Z"),
    trialEndsAt: null,
    stripeCustomerId: "cus_xxx",
    cardLast4: "4242",
    planLabel: "GuardWell · Monthly · $249",
  };

  it("renders ACTIVE badge + next billing date + last4", () => {
    render(<SubscriptionPanel {...baseProps} />);
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    expect(screen.getByText(/may 29, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/4242/)).toBeInTheDocument();
  });

  it("renders TRIALING badge + days remaining", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
    render(
      <SubscriptionPanel
        {...baseProps}
        subscriptionStatus="TRIALING"
        currentPeriodEnd={null}
        trialEndsAt={future}
      />,
    );
    expect(screen.getByText(/trial/i)).toBeInTheDocument();
    // "5 days" or "4 days" depending on rounding edge — accept 4 or 5
    expect(screen.getByText(/[45] days/i)).toBeInTheDocument();
  });

  it("renders PAST_DUE badge with destructive variant + Update payment CTA", () => {
    render(
      <SubscriptionPanel {...baseProps} subscriptionStatus="PAST_DUE" />,
    );
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update payment/i })).toBeInTheDocument();
  });

  it("renders CANCELED badge + Reactivate CTA", () => {
    render(
      <SubscriptionPanel {...baseProps} subscriptionStatus="CANCELED" />,
    );
    expect(screen.getByText(/canceled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reactivate/i })).toBeInTheDocument();
  });

  it("renders Manage subscription button when stripeCustomerId is set", () => {
    render(<SubscriptionPanel {...baseProps} />);
    expect(screen.getByRole("button", { name: /manage subscription/i })).toBeInTheDocument();
  });

  it("hides Manage subscription button when no stripeCustomerId", () => {
    render(
      <SubscriptionPanel {...baseProps} stripeCustomerId={null} />,
    );
    expect(screen.queryByRole("button", { name: /manage subscription/i })).not.toBeInTheDocument();
  });
});
