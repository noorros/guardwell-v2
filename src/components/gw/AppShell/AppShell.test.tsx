// src/components/gw/AppShell/AppShell.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("<AppShell>", () => {
  it("renders the practice name in the top bar", () => {
    render(
      <AppShell
        practice={{ name: "Acme Primary Care" }}
        user={{ email: "jane@acme.test" }}
        myComplianceItems={[]}
      >
        <div>page-content</div>
      </AppShell>,
    );
    expect(screen.getByText("Acme Primary Care")).toBeInTheDocument();
  });

  it("renders the user email in the top bar", () => {
    render(
      <AppShell
        practice={{ name: "Acme" }}
        user={{ email: "jane@acme.test" }}
        myComplianceItems={[]}
      >
        <div>page-content</div>
      </AppShell>,
    );
    expect(screen.getByText("jane@acme.test")).toBeInTheDocument();
  });

  it("renders children inside <main id='main'>", () => {
    const { container } = render(
      <AppShell
        practice={{ name: "Acme" }}
        user={{ email: "jane@acme.test" }}
        myComplianceItems={[]}
      >
        <div data-testid="child-slot">hello</div>
      </AppShell>,
    );
    const main = container.querySelector("main#main");
    expect(main).not.toBeNull();
    expect(main).toContainElement(screen.getByTestId("child-slot"));
  });

  it("renders the sidebar framework nav items", () => {
    render(
      <AppShell
        practice={{ name: "Acme" }}
        user={{ email: "jane@acme.test" }}
        myComplianceItems={[
          { code: "HIPAA", name: "HIPAA", score: 82 },
          { code: "OSHA", name: "OSHA", score: 54 },
        ]}
      >
        <div>page-content</div>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: /hipaa/i })).toHaveAttribute(
      "href",
      "/modules/hipaa",
    );
    expect(screen.getByRole("link", { name: /osha/i })).toHaveAttribute(
      "href",
      "/modules/osha",
    );
  });

  it("includes a sign-out form with submit button in the top bar", () => {
    render(
      <AppShell
        practice={{ name: "Acme" }}
        user={{ email: "jane@acme.test" }}
        myComplianceItems={[]}
      >
        <div>page-content</div>
      </AppShell>,
    );
    const signOut = screen.getByRole("button", { name: /sign out/i });
    expect(signOut).toHaveAttribute("type", "submit");
    expect(signOut.closest("form")).not.toBeNull();
  });
});
