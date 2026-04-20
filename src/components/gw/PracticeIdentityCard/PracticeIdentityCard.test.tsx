// src/components/gw/PracticeIdentityCard/PracticeIdentityCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PracticeIdentityCard } from ".";

describe("<PracticeIdentityCard>", () => {
  it("renders name + state", () => {
    render(<PracticeIdentityCard name="Noorros Internal Medicine" primaryState="AZ" />);
    expect(screen.getByRole("heading", { name: /Noorros Internal Medicine/ })).toBeInTheDocument();
    expect(screen.getByText("AZ")).toBeInTheDocument();
  });

  it("renders specialty when passed", () => {
    render(
      <PracticeIdentityCard
        name="X"
        primaryState="AZ"
        specialty="Internal Medicine"
      />,
    );
    expect(screen.getByText("Internal Medicine")).toBeInTheDocument();
  });

  it("renders role badge when passed", () => {
    render(<PracticeIdentityCard name="X" primaryState="AZ" role="OWNER" />);
    expect(screen.getByText(/owner/i)).toBeInTheDocument();
  });

  it("renders each officer role in the badge strip", () => {
    render(
      <PracticeIdentityCard
        name="X"
        primaryState="AZ"
        officerRoles={["Privacy Officer", "Security Officer"]}
      />,
    );
    expect(screen.getByText("Privacy Officer")).toBeInTheDocument();
    expect(screen.getByText("Security Officer")).toBeInTheDocument();
  });

  it("omits setup progress line when setupProgress is undefined", () => {
    render(<PracticeIdentityCard name="X" primaryState="AZ" />);
    expect(screen.queryByText(/setup/i)).toBeNull();
  });

  it("shows setup-progress chip when setupProgress is passed (0-100)", () => {
    render(<PracticeIdentityCard name="X" primaryState="AZ" setupProgress={65} />);
    expect(screen.getByText(/65%/)).toBeInTheDocument();
    expect(screen.getByText(/setup/i)).toBeInTheDocument();
  });

  it("setup-progress chip at 100 shows a 'complete' label/icon (redundant signal)", () => {
    render(<PracticeIdentityCard name="X" primaryState="AZ" setupProgress={100} />);
    expect(screen.getByText(/complete/i)).toBeInTheDocument();
  });

  it("clamps setupProgress to [0, 100]", () => {
    const { rerender } = render(
      <PracticeIdentityCard name="X" primaryState="AZ" setupProgress={150} />,
    );
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    rerender(<PracticeIdentityCard name="X" primaryState="AZ" setupProgress={-5} />);
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });
});
