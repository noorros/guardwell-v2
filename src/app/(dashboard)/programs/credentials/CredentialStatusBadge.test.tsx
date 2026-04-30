// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import { CredentialStatusBadge } from "./CredentialStatusBadge";

describe("CredentialStatusBadge", () => {
  it("renders the AZ-local date when wrapped in PracticeTimezoneProvider", () => {
    // 2026-07-01T01:00:00Z = 2026-06-30 in MST (America/Phoenix, UTC-7, no DST)
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <CredentialStatusBadge
          status="EXPIRING_SOON"
          expiryDate="2026-07-01T01:00:00Z"
        />
      </PracticeTimezoneProvider>,
    );
    expect(screen.getByText(/Expiring Jun 30, 2026/i)).toBeInTheDocument();
  });

  it("falls back to UTC when no provider is mounted", () => {
    render(
      <CredentialStatusBadge
        status="EXPIRING_SOON"
        expiryDate="2026-07-01T01:00:00Z"
      />,
    );
    expect(screen.getByText(/Expiring Jul 1, 2026/i)).toBeInTheDocument();
  });
});
