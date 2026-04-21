// src/components/gw/ModuleSummaryBand/ModuleSummaryBand.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModuleSummaryBand } from ".";

// Mock next/navigation's useRouter so the component can push query strings.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/modules/hipaa",
}));

describe("<ModuleSummaryBand>", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("renders all three stat cards with counts", () => {
    render(
      <ModuleSummaryBand
        compliantCount={7}
        totalRequirements={10}
        gapCount={2}
        deadlineCount={0}
      />,
    );
    expect(screen.getByText("7 of 10")).toBeInTheDocument();
    expect(screen.getByText(/compliant/i)).toBeInTheDocument();
    expect(screen.getByText(/deadlines this month/i)).toBeInTheDocument();
    expect(screen.getByText(/open gaps/i)).toBeInTheDocument();
  });

  it("clicking the compliant card pushes ?status=compliant", async () => {
    const user = userEvent.setup();
    render(
      <ModuleSummaryBand
        compliantCount={7}
        totalRequirements={10}
        gapCount={2}
        deadlineCount={0}
      />,
    );
    await user.click(screen.getByRole("button", { name: /7 of 10.*compliant/i }));
    expect(pushMock).toHaveBeenCalledWith("/modules/hipaa?status=compliant");
  });

  it("clicking the gap card pushes ?status=gap", async () => {
    const user = userEvent.setup();
    render(
      <ModuleSummaryBand
        compliantCount={7}
        totalRequirements={10}
        gapCount={2}
        deadlineCount={0}
      />,
    );
    await user.click(screen.getByRole("button", { name: /2 open gaps/i }));
    expect(pushMock).toHaveBeenCalledWith("/modules/hipaa?status=gap");
  });

  it("deadline card has a disabled tooltip and does not push", async () => {
    const user = userEvent.setup();
    render(
      <ModuleSummaryBand
        compliantCount={7}
        totalRequirements={10}
        gapCount={2}
        deadlineCount={0}
      />,
    );
    const deadlineEl = screen.getByText(/deadlines this month/i).closest("[title]");
    expect(deadlineEl).not.toBeNull();
    expect(deadlineEl).toHaveAttribute(
      "title",
      "Deadlines available once operational pages ship",
    );
    // Click should not trigger router.push since it's not wired.
    if (deadlineEl) {
      await user.click(deadlineEl);
    }
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("zero gaps state: gap card is rendered with 0 count", () => {
    render(
      <ModuleSummaryBand
        compliantCount={10}
        totalRequirements={10}
        gapCount={0}
        deadlineCount={0}
      />,
    );
    expect(screen.getByText("10 of 10")).toBeInTheDocument();
    expect(screen.getByText(/0 open gaps/i)).toBeInTheDocument();
  });

  it("all-gap state: compliant card shows 0 of N, gap card shows high count", () => {
    render(
      <ModuleSummaryBand
        compliantCount={0}
        totalRequirements={10}
        gapCount={10}
        deadlineCount={0}
      />,
    );
    expect(screen.getByText("0 of 10")).toBeInTheDocument();
    expect(screen.getByText(/10 open gaps/i)).toBeInTheDocument();
  });
});
