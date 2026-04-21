// src/components/gw/ModuleActivityFeed/ModuleActivityFeed.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModuleActivityFeed, type ModuleActivityEvent } from ".";

describe("<ModuleActivityFeed>", () => {
  it("renders an EmptyState when events is empty", () => {
    render(<ModuleActivityFeed events={[]} />);
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
        actorEmail: "alice@example.com",
        reason: null,
      },
      {
        id: "e2",
        createdAt: oneDayAgo,
        requirementTitle: "Document workforce training",
        nextStatus: "GAP",
        actorEmail: null,
        reason: "Training records missing for Q1 hires",
      },
      {
        id: "e3",
        createdAt: threeDaysAgo,
        requirementTitle: "Adopt NPP policy",
        nextStatus: "NOT_STARTED",
        actorEmail: "bob@example.com",
        reason: null,
      },
    ];
    render(<ModuleActivityFeed events={events} />);

    // Three distinct titles render.
    expect(screen.getByText("Designate Privacy Officer")).toBeInTheDocument();
    expect(screen.getByText("Document workforce training")).toBeInTheDocument();
    expect(screen.getByText("Adopt NPP policy")).toBeInTheDocument();

    // Actor emails render (and null becomes "AI").
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
});
