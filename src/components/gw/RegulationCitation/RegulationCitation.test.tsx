// src/components/gw/RegulationCitation/RegulationCitation.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegulationCitation } from ".";

describe("<RegulationCitation>", () => {
  it("renders the citation text verbatim", () => {
    render(<RegulationCitation citation="45 CFR §164.308(a)(1)(ii)(A)" />);
    expect(screen.getByText("45 CFR §164.308(a)(1)(ii)(A)")).toBeInTheDocument();
  });

  it("renders as plain text (no link) when href is absent", () => {
    render(<RegulationCitation citation="45 CFR §164.500" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders an external link when href is present, with rel=noopener noreferrer", () => {
    render(
      <RegulationCitation
        citation="45 CFR §164.500"
        href="https://www.ecfr.gov/current/title-45/section-164.500"
      />,
    );
    const link = screen.getByRole("link", { name: /45 CFR §164\.500/ });
    expect(link).toHaveAttribute("href", "https://www.ecfr.gov/current/title-45/section-164.500");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("uses a monospace / tabular font class for readability", () => {
    const { container } = render(<RegulationCitation citation="ARS §36-664" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toMatch(/font-mono|tabular-nums/);
  });
});
