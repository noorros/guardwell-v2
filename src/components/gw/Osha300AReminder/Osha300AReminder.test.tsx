// src/components/gw/Osha300AReminder/Osha300AReminder.test.tsx
//
// Phase 2 B1 (v2 feature recovery): the reminder banner must:
//   - render only Feb 1 00:00 → May 1 00:00 in the practice's timezone
//   - use TZ-aware boundaries so DST + Pacific tenants don't drift on
//     the Jan-31/Feb-1 + Apr-30/May-1 edges
//   - escalate severity color as the deadline approaches
//   - return null cleanly out-of-window so the page stays uncluttered
//   - be axe-clean

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Osha300AReminder } from ".";

const PST = "America/Los_Angeles";

describe("<Osha300AReminder> — date-window math", () => {
  it("renders ON Feb 1 00:00 in practice TZ (Pacific)", () => {
    // Feb 1 00:00 PST = Feb 1 08:00 UTC. In-window (inclusive lower bound).
    const now = new Date("2026-02-01T08:00:00Z");
    render(<Osha300AReminder now={now} tz={PST} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders ON Apr 30 23:59 in practice TZ (Pacific)", () => {
    // Apr 30 23:59 PDT = May 1 06:59 UTC. Still in-window (Apr 30 is the
    // last in-window calendar day; window ends at May 1 00:00 local).
    const now = new Date("2026-05-01T06:59:00Z");
    render(<Osha300AReminder now={now} tz={PST} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("hides ON Jan 31 23:59 in practice TZ (Pacific)", () => {
    // Jan 31 23:59 PST = Feb 1 07:59 UTC — one minute before the local
    // window opens. Banner must NOT render.
    const now = new Date("2026-02-01T07:59:00Z");
    const { container } = render(<Osha300AReminder now={now} tz={PST} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides ON May 1 00:00 in practice TZ (Pacific)", () => {
    // May 1 00:00 PDT = May 1 07:00 UTC — first instant past the window.
    // Banner must NOT render (upper bound is exclusive).
    const now = new Date("2026-05-01T07:00:00Z");
    const { container } = render(<Osha300AReminder now={now} tz={PST} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides in mid-July (clearly out of window)", () => {
    const { container } = render(
      <Osha300AReminder now={new Date("2026-07-15T12:00:00Z")} tz={PST} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hides in early January (before Feb 1)", () => {
    const { container } = render(
      <Osha300AReminder now={new Date("2026-01-15T12:00:00Z")} tz={PST} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("<Osha300AReminder> — copy + content", () => {
  it("references §1904.32(b)(6) in the headline", () => {
    render(
      <Osha300AReminder now={new Date("2026-02-15T12:00:00Z")} tz={PST} />,
    );
    expect(screen.getByText(/§1904\.32\(b\)\(6\)/)).toBeInTheDocument();
  });

  it("includes the prior calendar year in the body (form covers prior year)", () => {
    // Mid-Feb 2026: prior year = 2025.
    render(
      <Osha300AReminder now={new Date("2026-02-15T12:00:00Z")} tz={PST} />,
    );
    expect(screen.getByText(/2025/)).toBeInTheDocument();
  });

  it("renders the deadline as a <time> element with ISO datetime", () => {
    const { container } = render(
      <Osha300AReminder now={new Date("2026-04-15T12:00:00Z")} tz={PST} />,
    );
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBeTruthy();
  });

  it("renders the CTA link when href is provided", () => {
    render(
      <Osha300AReminder
        now={new Date("2026-02-15T12:00:00Z")}
        tz={PST}
        href="/api/audit/osha-300"
      />,
    );
    const link = screen.getByRole("link", { name: /generate form 300/i });
    expect(link).toHaveAttribute("href", "/api/audit/osha-300");
  });

  it("omits the CTA link when href is absent", () => {
    render(
      <Osha300AReminder now={new Date("2026-02-15T12:00:00Z")} tz={PST} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("<Osha300AReminder> — accessibility", () => {
  it("has no axe violations in-window", async () => {
    const { container } = render(
      <Osha300AReminder
        now={new Date("2026-02-15T12:00:00Z")}
        tz={PST}
        href="/api/audit/osha-300"
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no axe violations out-of-window (renders nothing)", async () => {
    const { container } = render(
      <Osha300AReminder now={new Date("2026-07-15T12:00:00Z")} tz={PST} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
