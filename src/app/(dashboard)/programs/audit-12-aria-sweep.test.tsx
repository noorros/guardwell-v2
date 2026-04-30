// src/app/(dashboard)/programs/audit-12-aria-sweep.test.tsx
//
// Audit #12 (2026-04-29) — ARIA / form labelling sweep.
// Each form was rewritten to use explicit <label htmlFor>/id pairs (and
// role="radiogroup" + aria-labelledby on radio groups). These tests
// run jest-axe against each form to lock the WCAG 2.1 AA compliance in.
//
// Reference pattern: client-islands-a11y.test.tsx (the BreachDeterminationWizard
// case there already covers that wizard — this file picks up the rest).

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { axe } from "jest-axe";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/dashboard",
}));

vi.mock("@/app/(dashboard)/programs/risk/actions", () => ({
  saveSraDraftAction: vi.fn(),
  completeSraAction: vi.fn(),
}));

vi.mock("@/app/(dashboard)/programs/incidents/actions", () => ({
  reportIncidentAction: vi.fn(),
  updateIncidentOshaOutcomeAction: vi.fn(),
}));

vi.mock("@/app/(dashboard)/programs/credentials/actions", () => ({
  addCredentialAction: vi.fn(),
}));

vi.mock("@/app/(dashboard)/programs/document-retention/actions", () => ({
  recordDestructionAction: vi.fn(),
}));

vi.mock("@/app/(dashboard)/programs/policies/actions", () => ({
  acknowledgePolicyAction: vi.fn(),
}));

vi.mock("@/app/accept-baa/[token]/actions", () => ({
  executeBaaAction: vi.fn(),
}));

vi.mock("@/app/(dashboard)/programs/cybersecurity/actions", () => ({
  logPhishingDrillAction: vi.fn(),
  logBackupVerificationAction: vi.fn(),
  recordMfaEnrollmentAction: vi.fn(),
}));

vi.mock("@/app/(dashboard)/programs/allergy/actions", () => ({
  logDrillAction: vi.fn(),
  updateDrillAction: vi.fn(),
  deleteDrillAction: vi.fn(),
}));

import { SraWizard, type SraWizardQuestion } from "./risk/new/SraWizard";
import { IncidentReportForm } from "./incidents/new/IncidentReportForm";
import { OshaOutcomePanel } from "./incidents/[id]/OshaOutcomePanel";
import { AddCredentialForm } from "./credentials/AddCredentialForm";
import { NewDestructionForm } from "./document-retention/NewDestructionForm";
import { AcknowledgeForm } from "./policies/[id]/AcknowledgeForm";
import { AcceptBaaForm } from "@/app/accept-baa/[token]/AcceptBaaForm";
import { PhishingDrillForm } from "./cybersecurity/PhishingDrillForm";
import { BackupVerificationForm } from "./cybersecurity/BackupVerificationForm";
import { LogDrillForm } from "./allergy/DrillTab";

const AXE_OPTS = {
  rules: {
    region: { enabled: false },
  },
};

const SRA_QUESTIONS: SraWizardQuestion[] = [
  {
    code: "ADMIN_001",
    category: "ADMINISTRATIVE",
    subcategory: "Risk Management",
    title: "Risk analysis",
    description: "Have you conducted an annual risk analysis?",
    guidance: null,
    lookFor: ["Documented analysis", "Updated within last 12 months"],
  },
  {
    code: "ADMIN_002",
    category: "ADMINISTRATIVE",
    subcategory: "Workforce Security",
    title: "Workforce sanctions policy",
    description: "Sanction policy for workforce members who violate HIPAA?",
    guidance: null,
    lookFor: [],
  },
];

describe("Audit #12 ARIA / form labelling sweep", () => {
  describe("<SraWizard>", () => {
    it("default render — no answers", async () => {
      const { container } = render(<SraWizard questions={SRA_QUESTIONS} />);
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("with initial state hydrated (resumed draft)", async () => {
      const { container } = render(
        <SraWizard
          questions={SRA_QUESTIONS}
          initialState={{
            assessmentId: "asmt-1",
            currentStep: 0,
            answers: { ADMIN_001: "YES" },
            notes: { ADMIN_001: "Documented in /docs/sra.pdf" },
          }}
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<IncidentReportForm>", () => {
    it("default (PRIVACY type — no OSHA fields)", async () => {
      const { container } = render(
        <IncidentReportForm
          primaryState="AZ"
          operatingStates={[]}
          memberOptions={[
            { userId: "u-1", label: "Alice (CLINICIAN)" },
            { userId: "u-2", label: "Bob (STAFF)" },
          ]}
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("multi-state — patient state select rendered when PHI involved", async () => {
      const { container } = render(
        <IncidentReportForm
          primaryState="AZ"
          operatingStates={["CA", "TX"]}
          memberOptions={[]}
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<AddCredentialForm>", () => {
    it("default render with credential types and holders", async () => {
      const { container } = render(
        <AddCredentialForm
          holders={[
            { id: "u-1", name: "Alice" },
            { id: "u-2", name: "Bob" },
          ]}
          credentialTypes={[
            {
              code: "MD_STATE_LICENSE",
              name: "MD State License",
              category: "MEDICAL_LICENSE",
              renewalPeriodDays: 365,
            },
            {
              code: "DEA_REGISTRATION",
              name: "DEA Registration",
              category: "DEA",
              renewalPeriodDays: 1095,
            },
          ]}
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("empty type list still renders without violations", async () => {
      const { container } = render(
        <AddCredentialForm holders={[]} credentialTypes={[]} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<NewDestructionForm>", () => {
    it("default render", async () => {
      const { container } = render(<NewDestructionForm />);
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<OshaOutcomePanel>", () => {
    // Audit #21 / OSHA I-5 (2026-04-30): edit form must have proper
    // ARIA — <fieldset>/<legend>, aria-required, label/htmlFor pairs.
    // The panel ships a view mode and an edit mode toggled via an Edit
    // button; both modes are audited here.
    const BASE_INITIAL = {
      oshaBodyPart: "Hand",
      oshaInjuryNature: "Needlestick",
      oshaOutcome: "RESTRICTED" as const,
      oshaDaysAway: 0,
      oshaDaysRestricted: 5,
      sharpsDeviceType: "Needle",
      injuredUserId: "u-1",
    };
    const MEMBERS = [
      { userId: "u-1", label: "Alice (CLINICIAN)" },
      { userId: "u-2", label: "Bob (STAFF)" },
    ];

    it("view mode — admin canManage", async () => {
      const { container } = render(
        <OshaOutcomePanel
          incidentId="inc-1"
          canManage={true}
          memberOptions={MEMBERS}
          initial={BASE_INITIAL}
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("view mode — non-admin canManage=false (no Edit button)", async () => {
      const { container } = render(
        <OshaOutcomePanel
          incidentId="inc-1"
          canManage={false}
          memberOptions={MEMBERS}
          initial={BASE_INITIAL}
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("edit mode — fieldset/legend, labels, aria-required all clean", async () => {
      const { container, getByRole } = render(
        <OshaOutcomePanel
          incidentId="inc-1"
          canManage={true}
          memberOptions={MEMBERS}
          initial={BASE_INITIAL}
        />,
      );
      // Open edit mode so the form is rendered.
      fireEvent.click(getByRole("button", { name: /edit/i }));
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("edit mode — with offboarded employee (still axe-clean)", async () => {
      const { container, getByRole } = render(
        <OshaOutcomePanel
          incidentId="inc-1"
          canManage={true}
          memberOptions={[{ userId: "u-3", label: "Carol (ADMIN)" }]}
          injuredUserLabel="Alice Smith"
          initial={{ ...BASE_INITIAL, injuredUserId: "u-1" }}
        />,
      );
      fireEvent.click(getByRole("button", { name: /edit/i }));
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  // ── Batch 2 (PR-B10) ──────────────────────────────────────────────────────
  // Five forms shipped post-PR-#212 without the audit-12 ARIA pattern.
  // This sweep brings them up to spec.

  describe("<AcknowledgeForm>", () => {
    it("not yet acknowledged, no prereqs — sign panel collapsed", async () => {
      const { container } = render(
        <AcknowledgeForm
          practicePolicyId="pp-1"
          policyTitle="Information Security Policy"
          policyVersion={3}
          alreadyAcknowledged={false}
          acknowledgedAt={null}
          prerequisites={[]}
          defaultSignature="Alice Smith"
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("with prerequisites listed", async () => {
      const { container } = render(
        <AcknowledgeForm
          practicePolicyId="pp-1"
          policyTitle="Information Security Policy"
          policyVersion={3}
          alreadyAcknowledged={false}
          acknowledgedAt={null}
          prerequisites={[
            { courseCode: "HIPAA_BASICS", courseTitle: "HIPAA Basics", completed: true },
            { courseCode: "INFOSEC_101", courseTitle: "InfoSec 101", completed: false },
          ]}
          defaultSignature="Alice Smith"
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("already acknowledged — confirmation card", async () => {
      const { container } = render(
        <AcknowledgeForm
          practicePolicyId="pp-1"
          policyTitle="Information Security Policy"
          policyVersion={3}
          alreadyAcknowledged={true}
          acknowledgedAt="2026-04-01T00:00:00Z"
          prerequisites={[]}
          defaultSignature="Alice Smith"
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<AcceptBaaForm>", () => {
    it("default render with recipient email", async () => {
      const { container } = render(
        <AcceptBaaForm
          token="tok-123"
          baaRequestId="baa-1"
          tokenId="tokid-1"
          recipientEmail="vendor@example.com"
          practiceName="Smith Family Practice"
          vendorName="Acme IT Services LLC"
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("default render without recipient email pin", async () => {
      const { container } = render(
        <AcceptBaaForm
          token="tok-123"
          baaRequestId="baa-1"
          tokenId="tokid-1"
          recipientEmail={null}
          practiceName="Smith Family Practice"
          vendorName="Acme IT Services LLC"
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<PhishingDrillForm>", () => {
    it("expanded form — all fields rendered", async () => {
      const { container, getByRole } = render(<PhishingDrillForm />);
      await act(async () => {
        getByRole("button", { name: /log a phishing drill/i }).click();
      });
      expect(container.querySelector("#phishing-conducted-at")).not.toBeNull();
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<BackupVerificationForm>", () => {
    it("expanded form — all fields rendered", async () => {
      const { container, getByRole } = render(<BackupVerificationForm />);
      await act(async () => {
        getByRole("button", { name: /log a backup test/i }).click();
      });
      expect(container.querySelector("#backup-verified-at")).not.toBeNull();
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<LogDrillForm>", () => {
    it("default render with members", async () => {
      const { container } = render(
        <LogDrillForm
          members={[
            {
              id: "u-1",
              name: "Alice Doe",
              role: "CLINICIAN",
              email: "alice@clinic.com",
              requiresAllergyCompetency: true,
            },
            {
              id: "u-2",
              name: "Bob Smith",
              role: "STAFF",
              email: null,
              requiresAllergyCompetency: false,
            },
          ]}
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("empty members list", async () => {
      const { container } = render(<LogDrillForm members={[]} />);
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });
});

// Audit #21 / CHROME-1 (2026-04-30): when an incident's injuredUserId
// points to a user no longer in memberOptions (offboarded since the
// incident was reported), the panel must render a "(removed)" option
// using injuredUserLabel and pre-select it so the stored value isn't
// silently dropped on save.
describe("Audit #21 — OshaOutcomePanel pre-selects offboarded injured user", () => {
  const BASE_INITIAL = {
    oshaBodyPart: null,
    oshaInjuryNature: null,
    oshaOutcome: null,
    oshaDaysAway: null,
    oshaDaysRestricted: null,
    sharpsDeviceType: null,
    injuredUserId: "u-removed",
  };

  it("renders the original employee as a (removed) option pre-selected", () => {
    const { getByRole, getByLabelText } = render(
      <OshaOutcomePanel
        incidentId="inc-1"
        canManage={true}
        memberOptions={[{ userId: "u-active", label: "Bob Active" }]}
        injuredUserLabel="Alice Smith"
        initial={BASE_INITIAL}
      />,
    );
    fireEvent.click(getByRole("button", { name: /edit/i }));
    const select = getByLabelText(/injured staff member/i) as HTMLSelectElement;
    expect(select.value).toBe("u-removed");
    // The option text must mark the user as removed so the admin
    // understands the name represents a former employee.
    const matchingOption = Array.from(select.options).find(
      (o) => o.value === "u-removed",
    );
    expect(matchingOption).toBeTruthy();
    expect(matchingOption?.textContent).toMatch(/Alice Smith/);
    expect(matchingOption?.textContent).toMatch(/removed/i);
  });

  it("falls back to a generic label when injuredUserLabel is null", () => {
    const { getByRole, getByLabelText } = render(
      <OshaOutcomePanel
        incidentId="inc-1"
        canManage={true}
        memberOptions={[{ userId: "u-active", label: "Bob Active" }]}
        injuredUserLabel={null}
        initial={BASE_INITIAL}
      />,
    );
    fireEvent.click(getByRole("button", { name: /edit/i }));
    const select = getByLabelText(/injured staff member/i) as HTMLSelectElement;
    expect(select.value).toBe("u-removed");
    const matchingOption = Array.from(select.options).find(
      (o) => o.value === "u-removed",
    );
    expect(matchingOption?.textContent).toMatch(/removed/i);
  });

  it("does NOT inject a removed option when stored id is in memberOptions", () => {
    const { getByRole, getByLabelText } = render(
      <OshaOutcomePanel
        incidentId="inc-1"
        canManage={true}
        memberOptions={[
          { userId: "u-removed", label: "Alice Smith" },
          { userId: "u-active", label: "Bob Active" },
        ]}
        injuredUserLabel="Alice Smith"
        initial={BASE_INITIAL}
      />,
    );
    fireEvent.click(getByRole("button", { name: /edit/i }));
    const select = getByLabelText(/injured staff member/i) as HTMLSelectElement;
    // Only the placeholder + 2 active members, no extra "(removed)" option.
    const removedOptions = Array.from(select.options).filter((o) =>
      /removed/i.test(o.textContent ?? ""),
    );
    expect(removedOptions).toHaveLength(0);
  });

  it("does NOT inject a removed option for a NEW incident (no injuredUserId)", () => {
    const { getByRole, getByLabelText } = render(
      <OshaOutcomePanel
        incidentId="inc-2"
        canManage={true}
        memberOptions={[{ userId: "u-active", label: "Bob Active" }]}
        injuredUserLabel={null}
        initial={{ ...BASE_INITIAL, injuredUserId: null }}
      />,
    );
    fireEvent.click(getByRole("button", { name: /edit/i }));
    const select = getByLabelText(/injured staff member/i) as HTMLSelectElement;
    // Empty stored value means dropdown should default to the placeholder
    // "" and never inject a removed option even if an active member list
    // happens to be small.
    expect(select.value).toBe("");
    const removedOptions = Array.from(select.options).filter((o) =>
      /removed/i.test(o.textContent ?? ""),
    );
    expect(removedOptions).toHaveLength(0);
  });
});
