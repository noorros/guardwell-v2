// src/components/gw/AppShell/Sidebar.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Sidebar, type MyComplianceItem } from "./Sidebar";
import { scoreToColorToken } from "@/lib/utils";

// Default pathname mock is a dashboard page; individual tests rewire as needed.
const pathnameMock = vi.fn<() => string>(() => "/dashboard");
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

function makeItems(): MyComplianceItem[] {
  return [
    { code: "HIPAA", name: "HIPAA", score: 82 },
    { code: "OSHA", name: "OSHA", shortName: "OSHA", score: 46 },
    { code: "OIG", name: "OIG Compliance", score: 10 },
  ];
}

describe("<Sidebar>", () => {
  it("renders the three section headers", () => {
    pathnameMock.mockReturnValue("/dashboard");
    render(<Sidebar myComplianceItems={makeItems()} />);
    expect(screen.getByText(/my compliance/i)).toBeInTheDocument();
    expect(screen.getByText(/my programs/i)).toBeInTheDocument();
    expect(screen.getByText(/audit & insights/i)).toBeInTheDocument();
  });

  it("renders one nav item per My Compliance framework with href /modules/<code>", () => {
    pathnameMock.mockReturnValue("/dashboard");
    render(<Sidebar myComplianceItems={makeItems()} />);
    const hipaaLink = screen.getByRole("link", { name: /hipaa/i });
    expect(hipaaLink).toHaveAttribute("href", "/modules/hipaa");
    const oshaLink = screen.getByRole("link", { name: /osha/i });
    expect(oshaLink).toHaveAttribute("href", "/modules/osha");
    const oigLink = screen.getByRole("link", { name: /oig/i });
    expect(oigLink).toHaveAttribute("href", "/modules/oig");
  });

  it("shows the score number inline for each My Compliance item", () => {
    pathnameMock.mockReturnValue("/dashboard");
    render(<Sidebar myComplianceItems={makeItems()} />);
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("46")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("colors the score dot using scoreToColorToken", () => {
    pathnameMock.mockReturnValue("/dashboard");
    const { container } = render(<Sidebar myComplianceItems={makeItems()} />);
    const dots = container.querySelectorAll<HTMLElement>("[data-slot='score-dot']");
    expect(dots).toHaveLength(3);
    const firstDot = dots[0];
    const thirdDot = dots[2];
    if (!firstDot || !thirdDot) throw new Error("Missing dot elements");
    expect(firstDot.style.backgroundColor || firstDot.getAttribute("style") || "").toContain(scoreToColorToken(82));
    expect(thirdDot.style.backgroundColor || thirdDot.getAttribute("style") || "").toContain(scoreToColorToken(10));
  });

  it("marks the active framework link with aria-current='page'", () => {
    pathnameMock.mockReturnValue("/modules/hipaa");
    render(<Sidebar myComplianceItems={makeItems()} />);
    const hipaaLink = screen.getByRole("link", { name: /hipaa/i });
    expect(hipaaLink).toHaveAttribute("aria-current", "page");
    const oshaLink = screen.getByRole("link", { name: /osha/i });
    expect(oshaLink).not.toHaveAttribute("aria-current");
  });

  it("renders My Programs items with a Soon badge", () => {
    pathnameMock.mockReturnValue("/dashboard");
    render(<Sidebar myComplianceItems={makeItems()} />);
    // Each of the operational programs has a "Soon" pill next to it.
    const soonBadges = screen.getAllByText(/soon/i);
    // 7 programs + 3 audit-and-insights items = 10 "Soon" badges total.
    expect(soonBadges.length).toBeGreaterThanOrEqual(10);
    // Specific program names should be visible as static labels.
    expect(screen.getByText(/staff/i)).toBeInTheDocument();
    expect(screen.getByText(/policies/i)).toBeInTheDocument();
    expect(screen.getByText(/training/i)).toBeInTheDocument();
    expect(screen.getByText(/incidents/i)).toBeInTheDocument();
    expect(screen.getByText(/credentials/i)).toBeInTheDocument();
    expect(screen.getByText(/vendors/i)).toBeInTheDocument();
    expect(screen.getByText(/risk/i)).toBeInTheDocument();
  });

  it("renders Audit & Insights items with a Soon badge", () => {
    pathnameMock.mockReturnValue("/dashboard");
    render(<Sidebar myComplianceItems={makeItems()} />);
    expect(screen.getByText(/overview/i)).toBeInTheDocument();
    expect(screen.getByText(/activity log/i)).toBeInTheDocument();
    expect(screen.getByText(/reports/i)).toBeInTheDocument();
  });

  it("calls onNavigate when a framework link is clicked (for mobile sheet close)", async () => {
    pathnameMock.mockReturnValue("/dashboard");
    const onNavigate = vi.fn();
    render(
      <Sidebar myComplianceItems={makeItems()} onNavigate={onNavigate} />,
    );
    const hipaaLink = screen.getByRole("link", { name: /hipaa/i });
    hipaaLink.click();
    expect(onNavigate).toHaveBeenCalled();
  });

  it("uses the item.shortName when present, otherwise name", () => {
    pathnameMock.mockReturnValue("/dashboard");
    render(
      <Sidebar
        myComplianceItems={[
          { code: "HIPAA", name: "HIPAA Privacy Rule", shortName: "HIPAA", score: 50 },
        ]}
      />,
    );
    // shortName should appear in the sidebar; the long name is not duplicated.
    const link = screen.getByRole("link", { name: /hipaa/i });
    const inLink = within(link);
    expect(inLink.getByText("HIPAA")).toBeInTheDocument();
    expect(inLink.queryByText("HIPAA Privacy Rule")).not.toBeInTheDocument();
  });

  it("renders an empty My Compliance state when no frameworks are enabled", () => {
    pathnameMock.mockReturnValue("/dashboard");
    render(<Sidebar myComplianceItems={[]} />);
    expect(screen.getByText(/no frameworks/i)).toBeInTheDocument();
  });
});
