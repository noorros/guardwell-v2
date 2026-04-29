import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EhrCombobox } from "./index";

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
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe("EhrCombobox", () => {
  it("renders the trigger with placeholder when empty", () => {
    render(<EhrCombobox value="" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent(/select ehr/i);
  });
  it("renders the trigger with selected EHR name", () => {
    render(<EhrCombobox value="Epic" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Epic");
  });
  it("opens to show known EHRs + Other", async () => {
    const user = userEvent.setup();
    render(<EhrCombobox value="" onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Epic")).toBeInTheDocument();
      expect(screen.getByText(/Cerner/i)).toBeInTheDocument();
      expect(screen.getByText("Other")).toBeInTheDocument();
    });
  });
  it("when 'Other' selected, reveals a free-text input + onChange called with input value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<EhrCombobox value="" onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Other"));
    rerender(<EhrCombobox value="Other" onChange={onChange} />);
    const freeText = await screen.findByPlaceholderText(/your ehr/i);
    await user.clear(freeText);
    await user.type(freeText, "MyCustomEHR");
    expect(onChange).toHaveBeenLastCalledWith("MyCustomEHR");
  });
  it("renders the trigger with a custom value as 'Other'", () => {
    render(<EhrCombobox value="MyCustomEHR" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("MyCustomEHR");
  });
});
