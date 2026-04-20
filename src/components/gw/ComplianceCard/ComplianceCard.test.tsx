import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComplianceCard } from ".";

describe("<ComplianceCard>", () => {
  it("renders the title as a heading", () => {
    render(<ComplianceCard title="HIPAA Privacy Rule" score={80} />);
    expect(screen.getByRole("heading", { name: "HIPAA Privacy Rule" })).toBeInTheDocument();
  });

  it("renders the subtitle when provided", () => {
    render(
      <ComplianceCard
        title="HIPAA Privacy"
        subtitle="45 CFR Part 164, Subpart E"
        score={80}
      />,
    );
    expect(screen.getByText("45 CFR Part 164, Subpart E")).toBeInTheDocument();
  });

  it("includes a ScoreRing with the given score", () => {
    render(<ComplianceCard title="X" score={88} />);
    expect(screen.getByText("88")).toBeInTheDocument();
  });

  it("renders a status chip with label from scoreToLabel (e.g. 'Good' at 75)", () => {
    render(<ComplianceCard title="X" score={75} />);
    // Status appears in the card body (as a chip), not just the SR-only line.
    // We look in the chip container via role or text — chip text is visible.
    const matches = screen.getAllByText("Good");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("wraps content in an anchor when href is passed", () => {
    render(<ComplianceCard title="HIPAA Privacy" score={80} href="/modules/hipaa-privacy" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/modules/hipaa-privacy");
    // And it still contains the title
    expect(link).toHaveTextContent("HIPAA Privacy");
  });

  it("renders footer slot content when provided", () => {
    render(
      <ComplianceCard
        title="X"
        score={80}
        footer={<span data-testid="footer-slot">7 gaps</span>}
      />,
    );
    expect(screen.getByTestId("footer-slot")).toBeInTheDocument();
  });
});
