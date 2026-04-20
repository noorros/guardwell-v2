// src/components/gw/EvidenceBadge/EvidenceBadge.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceBadge } from ".";

describe("<EvidenceBadge>", () => {
  it("renders the label text", () => {
    render(<EvidenceBadge kind="policy" label="Adopted from HIPAA Privacy Policy" />);
    expect(screen.getByText("Adopted from HIPAA Privacy Policy")).toBeInTheDocument();
  });

  it("renders a different icon per kind (policy vs training vs pending)", () => {
    const { rerender, container } = render(
      <EvidenceBadge kind="policy" label="Policy" />,
    );
    const policySvg = container.querySelector("svg")?.outerHTML;

    rerender(<EvidenceBadge kind="training" label="Training" />);
    const trainingSvg = container.querySelector("svg")?.outerHTML;

    rerender(<EvidenceBadge kind="acknowledgment-pending" label="Pending" />);
    const pendingSvg = container.querySelector("svg")?.outerHTML;

    expect(policySvg).not.toEqual(trainingSvg);
    expect(trainingSvg).not.toEqual(pendingSvg);
  });

  it("icons are aria-hidden (label carries the semantic content)", () => {
    const { container } = render(<EvidenceBadge kind="policy" label="x" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the count suffix for acknowledgment-pending", () => {
    render(
      <EvidenceBadge
        kind="acknowledgment-pending"
        label="Pending acknowledgment"
        count={7}
      />,
    );
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it("renders as a link when href is passed", () => {
    render(
      <EvidenceBadge
        kind="training"
        label="Satisfied by HIPAA Basics"
        href="/training/hipaa-basics"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/training/hipaa-basics");
  });

  it("pending-ack kind uses an amber/warning visual signal (not color alone — icon differs)", () => {
    // Redundant signal per ADR-0005: color + icon, never color alone.
    const { container, rerender } = render(
      <EvidenceBadge kind="policy" label="Policy" />,
    );
    const policyIcon = container.querySelector("svg")?.outerHTML;

    rerender(<EvidenceBadge kind="acknowledgment-pending" label="Pending" count={3} />);
    const pendingIcon = container.querySelector("svg")?.outerHTML;

    expect(policyIcon).not.toEqual(pendingIcon);
  });
});
