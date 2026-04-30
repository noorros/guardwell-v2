// src/app/(dashboard)/programs/credentials/[id]/CredentialMetadataPanel.test.tsx
//
// Audit #21 IM-2 (2026-04-30) — Renew form must default the new expiry
// date from the credential type's `renewalPeriodDays` (3yr DEA, 2yr
// CPR/BLS, …), not a hardcoded 365 days. Falls back to 365 when null.
//
// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../actions", () => ({
  updateCredentialAction: vi.fn(),
  removeCredentialAction: vi.fn(),
}));

import {
  CredentialMetadataPanel,
  type CredentialMetadataValue,
} from "./CredentialMetadataPanel";

// Helper: add `days` to a YYYY-MM-DD ISO date string (UTC arithmetic to
// match the production code path, which uses setUTCDate).
function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const BASE_VALUE: CredentialMetadataValue = {
  title: "Arizona Medical License",
  licenseNumber: "MD-12345",
  issuingBody: "Arizona Medical Board",
  issueDate: "2024-05-01T00:00:00.000Z",
  expiryDate: "2026-05-01T00:00:00.000Z",
  notes: null,
};

describe("<CredentialMetadataPanel> Renew form", () => {
  it("defaults expiry to base + renewalPeriodDays (DEA 3-year cycle)", async () => {
    const user = userEvent.setup();
    render(
      <CredentialMetadataPanel
        credentialId="cred-1"
        canManage={true}
        value={BASE_VALUE}
        renewalPeriodDays={1095}
      />,
    );

    await user.click(screen.getByRole("button", { name: /renew/i }));

    const expiryInput = screen.getByLabelText(
      /new expiry date/i,
    ) as HTMLInputElement;
    expect(expiryInput.value).toBe(addDaysIso(BASE_VALUE.expiryDate!, 1095));
    // Sanity-check it is NOT the buggy +365-days value.
    expect(expiryInput.value).not.toBe(addDaysIso(BASE_VALUE.expiryDate!, 365));
  });

  it("defaults expiry to base + 365 days when renewalPeriodDays is null", async () => {
    const user = userEvent.setup();
    render(
      <CredentialMetadataPanel
        credentialId="cred-1"
        canManage={true}
        value={BASE_VALUE}
        renewalPeriodDays={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /renew/i }));

    const expiryInput = screen.getByLabelText(
      /new expiry date/i,
    ) as HTMLInputElement;
    expect(expiryInput.value).toBe(addDaysIso(BASE_VALUE.expiryDate!, 365));
  });

  it("defaults expiry to base + renewalPeriodDays (CPR/BLS 2-year cycle)", async () => {
    const user = userEvent.setup();
    render(
      <CredentialMetadataPanel
        credentialId="cred-1"
        canManage={true}
        value={BASE_VALUE}
        renewalPeriodDays={730}
      />,
    );

    await user.click(screen.getByRole("button", { name: /renew/i }));

    const expiryInput = screen.getByLabelText(
      /new expiry date/i,
    ) as HTMLInputElement;
    expect(expiryInput.value).toBe(addDaysIso(BASE_VALUE.expiryDate!, 730));
  });
});
