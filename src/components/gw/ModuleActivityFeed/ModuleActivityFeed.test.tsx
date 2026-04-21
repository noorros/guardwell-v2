// src/components/gw/ModuleActivityFeed/ModuleActivityFeed.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModuleActivityFeed, type ModuleActivityEvent } from ".";

describe("<ModuleActivityFeed>", () => {
  it("renders an EmptyState when events is empty", () => {
    render(
      <ModuleActivityFeed
        events={[]}
        currentUserId="u1"
        distinctActorCount={0}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /no activity yet/i }),
    ).toBeInTheDocument();
  });

  it("renders a row per event with title, status, actor, and relative time", () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const events: ModuleActivityEvent[] = [
      {
        id: "e1",
        createdAt: twoHoursAgo,
        requirementTitle: "Designate Privacy Officer",
        nextStatus: "COMPLIANT",
        actorUserId: "u-alice",
        actorEmail: "alice@example.com",
        source: "USER",
        reason: null,
      },
      {
        id: "e2",
        createdAt: oneDayAgo,
        requirementTitle: "Document workforce training",
        nextStatus: "GAP",
        actorUserId: null,
        actorEmail: null,
        source: "AI_ASSESSMENT",
        reason: "Training records missing for Q1 hires",
      },
      {
        id: "e3",
        createdAt: threeDaysAgo,
        requirementTitle: "Adopt NPP policy",
        nextStatus: "NOT_STARTED",
        actorUserId: "u-bob",
        actorEmail: "bob@example.com",
        source: "USER",
        reason: null,
      },
    ];
    render(
      <ModuleActivityFeed
        events={events}
        currentUserId="u-unknown"
        distinctActorCount={3}
      />,
    );

    // Three distinct titles render.
    expect(screen.getByText("Designate Privacy Officer")).toBeInTheDocument();
    expect(screen.getByText("Document workforce training")).toBeInTheDocument();
    expect(screen.getByText("Adopt NPP policy")).toBeInTheDocument();

    // Actor emails render (and null becomes "AI" when source is AI_ASSESSMENT).
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/\bAI\b/)).toBeInTheDocument();

    // Relative times render.
    expect(screen.getAllByText(/ago/i).length).toBeGreaterThanOrEqual(3);

    // Reason text renders for the event that has one.
    expect(
      screen.getByText("Training records missing for Q1 hires"),
    ).toBeInTheDocument();

    // Status chips render.
    expect(screen.getByText(/compliant/i)).toBeInTheDocument();
    expect(screen.getByText(/^gap$/i)).toBeInTheDocument();
    expect(screen.getByText(/not started/i)).toBeInTheDocument();
  });

  it("hides the actor entirely when only one distinct actor is in the feed", () => {
    const now = new Date();
    const events: ModuleActivityEvent[] = [
      {
        id: "e1",
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
        requirementTitle: "Designate Privacy Officer",
        nextStatus: "COMPLIANT",
        actorUserId: "u-alice",
        actorEmail: "alice@example.com",
        source: "USER",
        reason: null,
      },
    ];
    render(
      <ModuleActivityFeed
        events={events}
        currentUserId="u-alice"
        distinctActorCount={1}
      />,
    );

    // Actor email is NOT rendered.
    expect(screen.queryByText(/alice@example\.com/)).not.toBeInTheDocument();
    // "Changed by" noise is gone too.
    expect(screen.queryByText(/changed by/i)).not.toBeInTheDocument();
    // Relative time still renders.
    expect(screen.getByText(/ago/i)).toBeInTheDocument();
  });

  it("shows 'You' for the current user when there are multiple actors", () => {
    const now = new Date();
    const events: ModuleActivityEvent[] = [
      {
        id: "e1",
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
        requirementTitle: "Designate Privacy Officer",
        nextStatus: "COMPLIANT",
        actorUserId: "u-alice",
        actorEmail: "alice@example.com",
        source: "USER",
        reason: null,
      },
      {
        id: "e2",
        createdAt: new Date(now.getTime() - 120 * 60 * 1000),
        requirementTitle: "Adopt NPP policy",
        nextStatus: "GAP",
        actorUserId: "u-bob",
        actorEmail: "bob@example.com",
        source: "USER",
        reason: null,
      },
    ];
    render(
      <ModuleActivityFeed
        events={events}
        currentUserId="u-alice"
        distinctActorCount={2}
      />,
    );

    // alice is "You", bob is shown by email.
    expect(screen.getByText(/\bYou\b/)).toBeInTheDocument();
    expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
    // alice's email should NOT appear (she's labeled "You" instead).
    expect(screen.queryByText(/alice@example\.com/)).not.toBeInTheDocument();
  });

  it("labels AI_ASSESSMENT events as 'AI' and system events as 'System'", () => {
    const now = new Date();
    const events: ModuleActivityEvent[] = [
      {
        id: "e1",
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
        requirementTitle: "A",
        nextStatus: "COMPLIANT",
        actorUserId: null,
        actorEmail: null,
        source: "AI_ASSESSMENT",
        reason: null,
      },
      {
        id: "e2",
        createdAt: new Date(now.getTime() - 120 * 60 * 1000),
        requirementTitle: "B",
        nextStatus: "GAP",
        actorUserId: null,
        actorEmail: null,
        source: "IMPORT",
        reason: null,
      },
      {
        id: "e3",
        createdAt: new Date(now.getTime() - 180 * 60 * 1000),
        requirementTitle: "C",
        nextStatus: "NOT_STARTED",
        actorUserId: "u-alice",
        actorEmail: "alice@example.com",
        source: "USER",
        reason: null,
      },
    ];
    render(
      <ModuleActivityFeed
        events={events}
        currentUserId="u-other"
        distinctActorCount={3}
      />,
    );

    expect(screen.getByText(/\bAI\b/)).toBeInTheDocument();
    expect(screen.getByText(/\bSystem\b/)).toBeInTheDocument();
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
  });
});
