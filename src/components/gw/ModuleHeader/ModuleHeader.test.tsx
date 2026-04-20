// src/components/gw/ModuleHeader/ModuleHeader.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShieldCheck } from "lucide-react";
import { ModuleHeader } from ".";

describe("<ModuleHeader>", () => {
  it("renders name as an h1 heading", () => {
    render(<ModuleHeader icon={ShieldCheck} name="HIPAA Privacy Rule" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "HIPAA Privacy Rule" });
    expect(h1).toBeInTheDocument();
  });

  it("renders the icon with aria-hidden", () => {
    const { container } = render(<ModuleHeader icon={ShieldCheck} name="X" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a citation when passed", () => {
    render(
      <ModuleHeader icon={ShieldCheck} name="HIPAA Privacy" citation="45 CFR §164.500" />,
    );
    expect(screen.getByText("45 CFR §164.500")).toBeInTheDocument();
  });

  it("renders the citation as a link when citationHref is passed", () => {
    render(
      <ModuleHeader
        icon={ShieldCheck}
        name="HIPAA Privacy"
        citation="45 CFR §164.500"
        citationHref="https://ecfr.gov"
      />,
    );
    const link = screen.getByRole("link", { name: /45 CFR/ });
    expect(link).toHaveAttribute("href", "https://ecfr.gov");
  });

  it("shows a ScoreRing when score is passed", () => {
    render(<ModuleHeader icon={ShieldCheck} name="HIPAA Privacy" score={82} />);
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("omits the ScoreRing when score is undefined", () => {
    const { container } = render(<ModuleHeader icon={ShieldCheck} name="X" />);
    // ScoreRing renders a SECOND svg (the icon is the first). No ring means exactly 1 svg.
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("renders jurisdiction badges as a strip", () => {
    render(
      <ModuleHeader
        icon={ShieldCheck}
        name="HIPAA Privacy"
        jurisdictions={["Federal", "AZ", "CA"]}
      />,
    );
    expect(screen.getByText("Federal")).toBeInTheDocument();
    expect(screen.getByText("AZ")).toBeInTheDocument();
    expect(screen.getByText("CA")).toBeInTheDocument();
  });
});
