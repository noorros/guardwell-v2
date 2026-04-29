import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { StateMultiSelect } from "./index";

expect.extend(toHaveNoViolations);

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

describe("StateMultiSelect", () => {
  it("renders an empty placeholder when no states selected", () => {
    render(<StateMultiSelect selectedStates={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent(/add states/i);
  });

  it("renders chips for selected states with full names", () => {
    render(
      <StateMultiSelect selectedStates={["AZ", "CA"]} onChange={vi.fn()} />,
    );
    expect(screen.getByText("Arizona")).toBeInTheDocument();
    expect(screen.getByText("California")).toBeInTheDocument();
  });

  it("calls onChange with new state appended on selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<StateMultiSelect selectedStates={[]} onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    const arizona = await screen.findByText("Arizona");
    await user.click(arizona);
    expect(onChange).toHaveBeenCalledWith(["AZ"]);
  });

  it("calls onChange with state removed when chip ✕ clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <StateMultiSelect selectedStates={["AZ", "CA"]} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: /remove arizona/i }));
    expect(onChange).toHaveBeenCalledWith(["CA"]);
  });

  it("excludes already-selected states from the dropdown options", async () => {
    const user = userEvent.setup();
    render(<StateMultiSelect selectedStates={["AZ"]} onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox"));
    await waitFor(() => {
      // California available
      expect(screen.getByText("California")).toBeInTheDocument();
    });
    // Arizona only appears as a chip (above), not as a dropdown option.
    // Count text: should only see "Arizona" once (in chip).
    const arizonaMatches = screen.getAllByText("Arizona");
    expect(arizonaMatches).toHaveLength(1);
  });

  it("excludes states from excludeStates prop (e.g. primary state)", async () => {
    const user = userEvent.setup();
    render(
      <StateMultiSelect
        selectedStates={[]}
        excludeStates={["TX"]}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.queryByText("Texas")).not.toBeInTheDocument();
      expect(screen.getByText("California")).toBeInTheDocument();
    });
  });

  it("filters dropdown by search input", async () => {
    const user = userEvent.setup();
    render(<StateMultiSelect selectedStates={[]} onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox"));
    const search = await screen.findByPlaceholderText(/search states/i);
    await user.type(search, "cal");
    await waitFor(() => {
      expect(screen.getByText("California")).toBeInTheDocument();
      expect(screen.queryByText("Arizona")).not.toBeInTheDocument();
    });
  });

  it("passes axe a11y audit", async () => {
    const { container } = render(
      <StateMultiSelect selectedStates={["AZ", "CA"]} onChange={vi.fn()} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
