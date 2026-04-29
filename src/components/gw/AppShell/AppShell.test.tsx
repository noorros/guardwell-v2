// src/components/gw/AppShell/AppShell.test.tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("@/app/(auth)/sign-out/actions", () => ({
  signOutAction: vi.fn(async () => undefined),
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
});

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
          { code: "HIPAA", name: "HIPAA", score: 82, assessed: true },
          { code: "OSHA", name: "OSHA", score: 54, assessed: true },
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

  it("renders the avatar in the top bar", () => {
    render(
      <AppShell
        practice={{ name: "Acme" }}
        user={{ email: "jane@acme.test" }}
        myComplianceItems={[]}
      >
        <div>page-content</div>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: /open user menu/i })).toBeInTheDocument();
  });
});
