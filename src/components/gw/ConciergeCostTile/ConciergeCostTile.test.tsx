// src/components/gw/ConciergeCostTile/ConciergeCostTile.test.tsx
//
// Component tests for the dashboard "Concierge usage" tile. The tile is a
// React Server Component (async function) — tests render the resolved
// JSX directly via `await ConciergeCostTile({ ... })`, since RTL's
// `render` doesn't suspend on async server components under jsdom.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

vi.mock("@/lib/ai/conciergeMonthlySpend", () => ({
  getConciergeMonthlySpend: vi.fn(),
}));

import { ConciergeCostTile } from ".";
import { getConciergeMonthlySpend } from "@/lib/ai/conciergeMonthlySpend";

beforeEach(() => {
  vi.mocked(getConciergeMonthlySpend).mockReset();
});

describe("<ConciergeCostTile>", () => {
  it("renders nothing when there is no usage this month", async () => {
    vi.mocked(getConciergeMonthlySpend).mockResolvedValue({
      costUsd: 0,
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    const ui = await ConciergeCostTile({ practiceId: "p1" });
    const { container } = render(<>{ui}</>);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders dollar amount and message count when usage exists", async () => {
    vi.mocked(getConciergeMonthlySpend).mockResolvedValue({
      costUsd: 0.42,
      messageCount: 17,
      inputTokens: 1234,
      outputTokens: 567,
    });
    const ui = await ConciergeCostTile({ practiceId: "p1" });
    render(<>{ui}</>);
    expect(screen.getByText("$0.42")).toBeInTheDocument();
    expect(screen.getByText(/17 messages this month/i)).toBeInTheDocument();
  });

  it("uses singular 'message' when messageCount === 1", async () => {
    vi.mocked(getConciergeMonthlySpend).mockResolvedValue({
      costUsd: 0.05,
      messageCount: 1,
      inputTokens: 50,
      outputTokens: 25,
    });
    const ui = await ConciergeCostTile({ practiceId: "p1" });
    render(<>{ui}</>);
    expect(screen.getByText(/1 message this month/)).toBeInTheDocument();
    // Ensure we don't accidentally emit "1 messages"
    expect(screen.queryByText(/1 messages this month/)).toBeNull();
  });

  it("uses plural 'messages' when messageCount > 1", async () => {
    vi.mocked(getConciergeMonthlySpend).mockResolvedValue({
      costUsd: 0.5,
      messageCount: 5,
      inputTokens: 250,
      outputTokens: 125,
    });
    const ui = await ConciergeCostTile({ practiceId: "p1" });
    render(<>{ui}</>);
    expect(screen.getByText(/5 messages this month/i)).toBeInTheDocument();
  });

  it("renders an aria-label on the dollar amount for screen readers", async () => {
    vi.mocked(getConciergeMonthlySpend).mockResolvedValue({
      costUsd: 1.23,
      messageCount: 3,
      inputTokens: 100,
      outputTokens: 50,
    });
    const ui = await ConciergeCostTile({ practiceId: "p1" });
    render(<>{ui}</>);
    // The dollar-amount span carries an aria-label like "$1.23 this month".
    expect(
      screen.getByLabelText(/\$1\.23 this month/i),
    ).toBeInTheDocument();
  });

  it("links to /concierge", async () => {
    vi.mocked(getConciergeMonthlySpend).mockResolvedValue({
      costUsd: 0.1,
      messageCount: 2,
      inputTokens: 100,
      outputTokens: 50,
    });
    const ui = await ConciergeCostTile({ practiceId: "p1" });
    render(<>{ui}</>);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/concierge");
  });

  it("formats sub-cent costs as $0.00", async () => {
    vi.mocked(getConciergeMonthlySpend).mockResolvedValue({
      costUsd: 0.0001,
      messageCount: 1,
      inputTokens: 5,
      outputTokens: 2,
    });
    const ui = await ConciergeCostTile({ practiceId: "p1" });
    render(<>{ui}</>);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("passes axe a11y audit", async () => {
    vi.mocked(getConciergeMonthlySpend).mockResolvedValue({
      costUsd: 0.42,
      messageCount: 17,
      inputTokens: 1234,
      outputTokens: 567,
    });
    const ui = await ConciergeCostTile({ practiceId: "p1" });
    const { container } = render(<>{ui}</>);
    const results = await axe(container, {
      rules: { region: { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
