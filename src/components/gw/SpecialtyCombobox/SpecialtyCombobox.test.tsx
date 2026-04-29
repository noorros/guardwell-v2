import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SpecialtyCombobox } from "./index";

// Pointer-capture polyfill for Radix in jsdom (same pattern as PR 1's UserMenu test)
// + ResizeObserver polyfill for cmdk
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("SpecialtyCombobox", () => {
  it("renders the trigger with placeholder when value is empty", () => {
    render(<SpecialtyCombobox value="" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent(/select specialty/i);
  });

  it("renders the trigger with the selected value", () => {
    render(<SpecialtyCombobox value="Cardiology" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Cardiology");
  });

  it("opens the popover and shows known specialties", async () => {
    const user = userEvent.setup();
    render(<SpecialtyCombobox value="" onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Family Medicine")).toBeInTheDocument();
      expect(screen.getByText("Cardiology")).toBeInTheDocument();
      expect(screen.getByText("Other")).toBeInTheDocument();
    });
  });

  it("filters by search input", async () => {
    const user = userEvent.setup();
    render(<SpecialtyCombobox value="" onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox"));
    const search = await screen.findByPlaceholderText(/search/i);
    await user.type(search, "card");
    await waitFor(() => {
      expect(screen.getByText("Cardiology")).toBeInTheDocument();
      expect(screen.queryByText("Pediatrics")).not.toBeInTheDocument();
    });
  });

  it("calls onChange with the selected specialty value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SpecialtyCombobox value="" onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    const item = await screen.findByText("Family Medicine");
    await user.click(item);
    expect(onChange).toHaveBeenCalledWith("Family Medicine");
  });

  it("passes axe a11y audit", async () => {
    const { container } = render(
      <SpecialtyCombobox value="Cardiology" onChange={vi.fn()} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
