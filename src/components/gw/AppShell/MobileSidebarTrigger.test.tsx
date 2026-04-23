// src/components/gw/AppShell/MobileSidebarTrigger.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileSidebarTrigger } from "./MobileSidebarTrigger";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("<MobileSidebarTrigger>", () => {
  it("renders a hamburger button with an accessible label", () => {
    render(<MobileSidebarTrigger myComplianceItems={[]} />);
    expect(
      screen.getByRole("button", { name: /open navigation/i }),
    ).toBeInTheDocument();
  });

  it("opens the sidebar sheet on click", async () => {
    const user = userEvent.setup();
    render(
      <MobileSidebarTrigger
        myComplianceItems={[{ code: "HIPAA", name: "HIPAA", score: 70, assessed: true }]}
      />,
    );
    // Before clicking, the sheet content is not present.
    expect(screen.queryByRole("link", { name: /hipaa/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /open navigation/i }));
    // After opening, the framework link from the inner Sidebar is present.
    expect(screen.getByRole("link", { name: /hipaa/i })).toBeInTheDocument();
  });
});
