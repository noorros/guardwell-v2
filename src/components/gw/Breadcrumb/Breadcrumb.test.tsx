// src/components/gw/Breadcrumb/Breadcrumb.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb } from ".";

describe("<Breadcrumb>", () => {
  it("renders all items' labels in order", () => {
    render(
      <Breadcrumb
        items={[
          { label: "My Compliance", href: "/modules" },
          { label: "HIPAA Privacy" },
        ]}
      />,
    );
    expect(screen.getByText("My Compliance")).toBeInTheDocument();
    expect(screen.getByText("HIPAA Privacy")).toBeInTheDocument();
  });

  it("renders the last item as plain text (not a link)", () => {
    render(
      <Breadcrumb
        items={[
          { label: "My Compliance", href: "/modules" },
          { label: "HIPAA Privacy" },
        ]}
      />,
    );
    // First item is a link.
    expect(screen.getByRole("link", { name: "My Compliance" })).toHaveAttribute(
      "href",
      "/modules",
    );
    // Last item is NOT a link.
    expect(
      screen.queryByRole("link", { name: "HIPAA Privacy" }),
    ).not.toBeInTheDocument();
  });

  it("uses a nav with aria-label='Breadcrumb'", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Section" },
        ]}
      />,
    );
    expect(
      screen.getByRole("navigation", { name: /breadcrumb/i }),
    ).toBeInTheDocument();
  });

  it("marks the current page with aria-current='page'", () => {
    render(
      <Breadcrumb
        items={[
          { label: "My Compliance", href: "/modules" },
          { label: "HIPAA Privacy" },
        ]}
      />,
    );
    const current = screen.getByText("HIPAA Privacy");
    expect(current).toHaveAttribute("aria-current", "page");
  });
});
