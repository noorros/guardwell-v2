// src/components/client-islands-a11y.test.tsx
//
// Axe-core accessibility audit over the new client islands shipped in
// sessions 27–30 (notification bell, onboarding compliance profile, breach
// determination wizard, staff invite/remove/resend/revoke flows, incident
// badges, activity timestamp). Mirrors the gw/ gallery axe pattern but
// targets app-route components instead of design-system primitives.
//
// Failure messages name the exact axe rule (color contrast, missing label,
// aria-allowed-role, etc.) so fixes are targeted.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";

// SpecialtyCombobox uses Radix Popover (needs pointer-capture) and cmdk
// (needs ResizeObserver). Polyfill both for jsdom.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import { NotificationBell } from "./gw/AppShell/NotificationBell";
import { ComplianceProfileForm } from "@/app/onboarding/compliance-profile/ComplianceProfileForm";
import { BreachDeterminationWizard } from "@/app/(dashboard)/programs/incidents/[id]/BreachDeterminationWizard";
import { InviteMemberForm } from "@/app/(dashboard)/programs/staff/InviteMemberForm";
import { RemoveMemberButton } from "@/app/(dashboard)/programs/staff/RemoveMemberButton";
import { ResendButton } from "@/app/(dashboard)/programs/staff/ResendButton";
import { RevokeButton } from "@/app/(dashboard)/programs/staff/RevokeButton";
import {
  IncidentStatusBadge,
  IncidentBreachBadge,
} from "@/app/(dashboard)/programs/incidents/IncidentBadges";
import { ActivityTimestamp } from "@/app/(dashboard)/audit/activity/ActivityTimestamp";

// Server actions are imported transitively by some islands (router.refresh,
// startTransition wrappers). They never run during these renders, so we mock
// the action modules to inert no-ops to keep jsdom from pulling server-only
// deps.
vi.mock("@/app/(dashboard)/settings/notifications/actions", () => ({
  markNotificationReadAction: vi.fn(),
}));
vi.mock("@/app/onboarding/compliance-profile/actions", () => ({
  saveComplianceProfileAction: vi.fn(),
}));
vi.mock("@/app/(dashboard)/programs/incidents/actions", () => ({
  completeBreachDeterminationAction: vi.fn(),
}));
vi.mock("@/app/(dashboard)/programs/staff/invitation-actions", () => ({
  inviteTeamMemberAction: vi.fn(),
  removeMemberAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/dashboard",
}));

const AXE_OPTS = {
  rules: {
    // Same rationale as gallery.test.tsx: landmark/region rules only make
    // sense for full-page renders; isolated component renders never satisfy
    // them. The page-level render path is exercised by Chrome verification.
    region: { enabled: false },
  },
};

const NOTIFICATION_ITEMS = [
  {
    id: "n-1",
    type: "INCIDENT_PENDING_DETERMINATION",
    severity: "CRITICAL",
    title: "Incident awaiting breach determination",
    body: "RN needlestick incident is open with no breach determination after 0d.",
    href: "/programs/incidents/inc-1",
    createdAtIso: "2026-04-23T10:00:00.000Z",
    readAt: null,
  },
  {
    id: "n-2",
    type: "DIGEST_WEEKLY",
    severity: "INFO",
    title: "Weekly digest ready",
    body: "Your weekly compliance digest is available.",
    href: "/audit/overview",
    createdAtIso: "2026-04-22T14:00:00.000Z",
    readAt: "2026-04-22T15:00:00.000Z",
  },
];

const COMPLIANCE_PROFILE_INITIAL = {
  hasInHouseLab: false,
  dispensesControlledSubstances: true,
  medicareParticipant: true,
  billsMedicaid: false,
  subjectToMacraMips: false,
  sendsAutomatedPatientMessages: true,
  compoundsAllergens: false,
  specialty: "Family Medicine",
  providerCount: 3,
} as const;

describe("Client island accessibility audit (axe-core)", () => {
  describe("<NotificationBell>", () => {
    it("trigger button (closed) — empty state", async () => {
      const { container } = render(
        <NotificationBell unreadCount={0} recent={[]} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("trigger button (closed) — with unread badge", async () => {
      const { container } = render(
        <NotificationBell unreadCount={5} recent={NOTIFICATION_ITEMS} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("trigger button (closed) — capped 99+ badge", async () => {
      const { container } = render(
        <NotificationBell unreadCount={150} recent={NOTIFICATION_ITEMS} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("popover open — empty state", async () => {
      const { getByRole } = render(
        <NotificationBell unreadCount={0} recent={[]} />,
      );
      fireEvent.click(getByRole("button", { name: /notifications/i }));
      // Radix portals popover content to body, so audit the whole body.
      const results = await axe(document.body, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("popover open — mixed read/unread items", async () => {
      const { getByRole } = render(
        <NotificationBell unreadCount={1} recent={NOTIFICATION_ITEMS} />,
      );
      fireEvent.click(getByRole("button", { name: /notifications/i }));
      const results = await axe(document.body, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<ComplianceProfileForm>", () => {
    it("default render", async () => {
      const { container } = render(
        <ComplianceProfileForm
          initial={COMPLIANCE_PROFILE_INITIAL}
          redirectTo={"/dashboard" as never}
          submitLabel="Save and continue"
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("empty initial (all toggles off, no specialty)", async () => {
      const { container } = render(
        <ComplianceProfileForm
          initial={{
            hasInHouseLab: false,
            dispensesControlledSubstances: false,
            medicareParticipant: false,
            billsMedicaid: false,
            subjectToMacraMips: false,
            sendsAutomatedPatientMessages: false,
            compoundsAllergens: false,
            specialty: null,
            providerCount: null,
          }}
          redirectTo={"/dashboard" as never}
          submitLabel="Save"
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<BreachDeterminationWizard>", () => {
    it("default render (no factors scored)", async () => {
      const { container } = render(
        <BreachDeterminationWizard incidentId="inc-1" defaultAffectedCount={0} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("default render with non-zero affected count", async () => {
      const { container } = render(
        <BreachDeterminationWizard
          incidentId="inc-1"
          defaultAffectedCount={750}
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<InviteMemberForm>", () => {
    it("canInvite=true — full form rendered", async () => {
      const { container } = render(<InviteMemberForm canInvite={true} />);
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("canInvite=false — restricted message", async () => {
      const { container } = render(<InviteMemberForm canInvite={false} />);
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<RemoveMemberButton>", () => {
    it("collapsed (Remove button)", async () => {
      const { container } = render(
        <RemoveMemberButton
          practiceUserId="pu-1"
          memberLabel="alice@example.com"
        />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("confirming (Cancel + Confirm)", async () => {
      const { container, getByRole } = render(
        <RemoveMemberButton
          practiceUserId="pu-1"
          memberLabel="alice@example.com"
        />,
      );
      fireEvent.click(getByRole("button", { name: /remove/i }));
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<ResendButton>", () => {
    it("default render", async () => {
      const { container } = render(<ResendButton invitationId="inv-1" />);
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<RevokeButton>", () => {
    it("default render", async () => {
      const { container } = render(<RevokeButton invitationId="inv-1" />);
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<IncidentStatusBadge>", () => {
    const STATUSES = [
      "OPEN",
      "UNDER_INVESTIGATION",
      "RESOLVED",
      "CLOSED",
    ];
    for (const status of STATUSES) {
      it(`status=${status}`, async () => {
        const { container } = render(<IncidentStatusBadge status={status} />);
        const results = await axe(container, AXE_OPTS);
        expect(results).toHaveNoViolations();
      });
    }
  });

  describe("<IncidentBreachBadge>", () => {
    it("undetermined (isBreach=null)", async () => {
      const { container } = render(
        <IncidentBreachBadge isBreach={null} affectedCount={0} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("not a breach", async () => {
      const { container } = render(
        <IncidentBreachBadge isBreach={false} affectedCount={5} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("regular breach (<500 affected)", async () => {
      const { container } = render(
        <IncidentBreachBadge isBreach={true} affectedCount={42} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("major breach (>=500 affected)", async () => {
      const { container } = render(
        <IncidentBreachBadge isBreach={true} affectedCount={1234} />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });

  describe("<ActivityTimestamp>", () => {
    it("recent ISO timestamp", async () => {
      const { container } = render(
        <ActivityTimestamp iso="2026-04-23T10:00:00.000Z" />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });

    it("older ISO timestamp", async () => {
      const { container } = render(
        <ActivityTimestamp iso="2025-10-01T08:00:00.000Z" />,
      );
      const results = await axe(container, AXE_OPTS);
      expect(results).toHaveNoViolations();
    });
  });
});
