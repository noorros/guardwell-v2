// src/app/(dashboard)/programs/incidents/[id]/page.test.tsx
//
// Audit #21 (OSHA C-2 / B-4) — the breach determination wizard renders
// only on PRIVACY/SECURITY incidents. OSHA recordables, near misses,
// DEA theft/loss, etc. were previously seeing the HIPAA §164.402
// 4-factor wizard rendered at the bottom of their detail page, which
// was conceptual noise + a regulatory mismatch.
//
// Strategy: stub `getPracticeUser`, `db.incident.findUnique`, and
// `db.practiceUser.findMany`, then call the server component and
// render its returned JSX. Assert presence/absence of the wizard.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Incident } from "@prisma/client";

// `next/navigation`'s notFound() throws by default, which is the desired
// behavior for the "not-my-practice" branch — but we never hit that branch
// in these tests since the seeded incident matches the seeded practice.
// The wizard + ResolveButton client islands also call useRouter().
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound called");
  },
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/programs/incidents/inc-1",
}));

// next/link as a passthrough. Server components import `Link` and the
// jsdom render of the resolved JSX needs a no-op stand-in.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

// Module-level stubs the test cases mutate before invoking the page.
let mockIncident: Partial<Incident> | null = null;
const mockPracticeUser = {
  practiceId: "practice-1",
  role: "OWNER" as const,
  practice: {
    id: "practice-1",
    name: "Test Practice",
    primaryState: "AZ",
    timezone: "America/Phoenix",
  },
};

vi.mock("@/lib/rbac", () => ({
  getPracticeUser: vi.fn(async () => mockPracticeUser),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    incident: {
      findUnique: vi.fn(async () => mockIncident),
    },
    practiceUser: {
      findMany: vi.fn(async () => []),
    },
  },
}));

// Server actions imported transitively; mock to inert so jsdom doesn't
// pull server-only deps.
vi.mock("@/app/(dashboard)/programs/incidents/actions", () => ({
  completeBreachDeterminationAction: vi.fn(),
  resolveIncidentAction: vi.fn(),
  recordIncidentNotificationAction: vi.fn(),
  reportIncidentAction: vi.fn(),
  updateIncidentOshaOutcomeAction: vi.fn(),
}));

// Audit format helpers depend on Intl/timezone; pass through.
vi.mock("@/lib/audit/format", () => ({
  formatPracticeDate: (d: Date) => d.toISOString(),
}));

// import after mocks so the page resolves them.
import IncidentDetailPage from "./page";

// Build a minimal Incident row that satisfies what the page reads.
function makeIncident(overrides: Partial<Incident>): Partial<Incident> {
  return {
    id: "inc-1",
    practiceId: "practice-1",
    title: "Test incident",
    description: "Test description",
    type: "PRIVACY",
    severity: "MEDIUM",
    phiInvolved: false,
    discoveredAt: new Date("2026-04-01T00:00:00.000Z"),
    resolvedAt: null,
    affectedCount: null,
    isBreach: null,
    overallRiskScore: null,
    factor1Score: null,
    factor2Score: null,
    factor3Score: null,
    factor4Score: null,
    breachDeterminationMemo: null,
    ocrNotifyRequired: false,
    ocrNotifiedAt: null,
    affectedIndividualsNotifiedAt: null,
    mediaNotifiedAt: null,
    stateAgNotifiedAt: null,
    patientState: null,
    status: "OPEN",
    oshaBodyPart: null,
    oshaInjuryNature: null,
    oshaOutcome: null,
    oshaDaysAway: null,
    oshaDaysRestricted: null,
    sharpsDeviceType: null,
    injuredUserId: null,
    ...overrides,
  };
}

describe("Audit #21 (OSHA C-2 / B-4) — IncidentDetailPage breach-wizard gate", () => {
  it("renders the BreachDeterminationWizard for PRIVACY incidents", async () => {
    mockIncident = makeIncident({ type: "PRIVACY" });
    const ui = await IncidentDetailPage({ params: Promise.resolve({ id: "inc-1" }) });
    const { queryByText, queryByRole } = render(ui);
    // The wizard renders the four-factor analysis and a "Submit determination" button.
    expect(queryByRole("button", { name: /submit determination/i })).toBeInTheDocument();
    expect(queryByText(/factor 1\./i)).toBeInTheDocument();
  });

  it("renders the BreachDeterminationWizard for SECURITY incidents", async () => {
    mockIncident = makeIncident({ type: "SECURITY" });
    const ui = await IncidentDetailPage({ params: Promise.resolve({ id: "inc-1" }) });
    const { queryByRole } = render(ui);
    expect(queryByRole("button", { name: /submit determination/i })).toBeInTheDocument();
  });

  it("does NOT render the BreachDeterminationWizard for OSHA_RECORDABLE incidents", async () => {
    mockIncident = makeIncident({
      type: "OSHA_RECORDABLE",
      oshaBodyPart: "Finger",
      oshaInjuryNature: "Needlestick",
      oshaOutcome: "FIRST_AID",
    });
    const ui = await IncidentDetailPage({ params: Promise.resolve({ id: "inc-1" }) });
    const { queryByText, queryByRole } = render(ui);
    expect(queryByRole("button", { name: /submit determination/i })).not.toBeInTheDocument();
    expect(queryByText(/factor 1\./i)).not.toBeInTheDocument();
    // Page still renders core incident chrome.
    expect(queryByText(/Test incident/)).toBeInTheDocument();
  });

  it("does NOT render the BreachDeterminationWizard for NEAR_MISS incidents", async () => {
    mockIncident = makeIncident({ type: "NEAR_MISS" });
    const ui = await IncidentDetailPage({ params: Promise.resolve({ id: "inc-1" }) });
    const { queryByRole } = render(ui);
    expect(queryByRole("button", { name: /submit determination/i })).not.toBeInTheDocument();
  });
});
