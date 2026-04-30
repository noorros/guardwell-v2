// @vitest-environment jsdom
//
// Audit #21 MN-6: when the page passes `initialEvidence={null}` (the
// signal it uses to mark "STAFF/VIEWER — restricted"), CredentialDetail
// must hide the upload + download list and render a "Restricted"
// placeholder instead. The page-level gate lives in
// src/app/(dashboard)/programs/credentials/[id]/page.tsx.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PracticeTimezoneProvider } from "@/lib/timezone/PracticeTimezoneContext";
import { CredentialDetail } from "./CredentialDetail";

// Server actions imported by CredentialDetail are noop in this render
// test — we never invoke them, but the import itself pulls Next.js
// server bits. Stub revalidation so it doesn't trip.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

const baseProps = {
  credentialId: "cred-1",
  credentialType: {
    name: "DEA registration",
    ceuRequirementHours: null,
    ceuRequirementWindowMonths: null,
    requiresEvidenceByDefault: true,
  },
  credential: {
    title: "DEA cert",
    licenseNumber: "DEA-123",
    issuingBody: "DEA",
    issueDate: null,
    expiryDate: null,
    notes: null,
  },
  ceuActivities: [],
  reminderConfig: null,
};

describe("CredentialDetail evidence isolation (audit #21 MN-6)", () => {
  it("renders Restricted placeholder when initialEvidence is null (STAFF/VIEWER)", () => {
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <CredentialDetail
          {...baseProps}
          canManage={false}
          initialEvidence={null}
        />
      </PracticeTimezoneProvider>,
    );

    // Restricted placeholder is visible…
    const placeholder = screen.getByTestId("evidence-restricted");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveTextContent(/restricted/i);

    // …and the upload affordance + the "no files" or list copy is NOT.
    expect(screen.queryByLabelText(/upload file/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no files attached yet/i)).not.toBeInTheDocument();

    // The "expects evidence" hint is suppressed for restricted viewers
    // — they can't act on it anyway.
    expect(
      screen.queryByText(/this credential type expects evidence/i),
    ).not.toBeInTheDocument();
  });

  it("renders the upload + list when initialEvidence is an array (OWNER/ADMIN)", () => {
    render(
      <PracticeTimezoneProvider value="America/Phoenix">
        <CredentialDetail
          {...baseProps}
          canManage={true}
          initialEvidence={[]}
        />
      </PracticeTimezoneProvider>,
    );

    // Restricted placeholder NOT present.
    expect(screen.queryByTestId("evidence-restricted")).not.toBeInTheDocument();
    // Upload affordance IS present.
    expect(screen.getByLabelText(/upload file/i)).toBeInTheDocument();
    // And the credential-type evidence hint is shown for managers.
    expect(
      screen.getByText(/this credential type expects evidence/i),
    ).toBeInTheDocument();
  });
});
