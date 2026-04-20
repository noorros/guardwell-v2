// src/components/gw/MajorBreachBanner/MajorBreachBanner.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MajorBreachBanner } from ".";

const NOW = new Date("2026-04-20T12:00:00Z");
const DEADLINE = new Date("2026-06-15T23:59:59Z");

describe("<MajorBreachBanner>", () => {
  it("returns null (renders nothing) when affectedCount < 500", () => {
    const { container } = render(
      <MajorBreachBanner affectedCount={499} reportingDeadline={DEADLINE} now={NOW} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the banner when affectedCount >= 500", () => {
    render(<MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("includes the affected count in the banner text", () => {
    render(<MajorBreachBanner affectedCount={1_234} reportingDeadline={DEADLINE} now={NOW} />);
    // Accept either "1,234" or "1234"
    expect(screen.getByText(/1[,]?234/)).toBeInTheDocument();
  });

  it("mentions the 500+ major-breach rule", () => {
    render(<MajorBreachBanner affectedCount={750} reportingDeadline={DEADLINE} now={NOW} />);
    expect(screen.getByText(/500\+|500 or more|major breach/i)).toBeInTheDocument();
  });

  it("shows the reporting deadline as a <time> element", () => {
    const { container } = render(
      <MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />,
    );
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBe(DEADLINE.toISOString());
  });

  it("uses the risk color token for the banner background (redundant with icon + copy)", () => {
    const { container } = render(
      <MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />,
    );
    const el = screen.getByRole("alert");
    const style = el.getAttribute("style") || "";
    expect(style).toContain("var(--gw-color-risk)");
  });

  it("includes an alert icon (redundant signal)", () => {
    const { container } = render(
      <MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders deadline as 'in N days' relative text", () => {
    // Deadline is 56 days after NOW
    render(<MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />);
    expect(screen.getByText(/56 days|in 56/i)).toBeInTheDocument();
  });

  it("when onDismiss is provided, renders an accessible dismiss button", () => {
    render(
      <MajorBreachBanner
        affectedCount={500}
        reportingDeadline={DEADLINE}
        now={NOW}
        onDismiss={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /dismiss/i });
    expect(btn).toBeInTheDocument();
  });

  it("when onDismiss is absent, no dismiss button appears (non-dismissable in prod)", () => {
    render(<MajorBreachBanner affectedCount={500} reportingDeadline={DEADLINE} now={NOW} />);
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });
});
