import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PracticeProfileForm } from "./index";
import type { PracticeProfileInput } from "./types";

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

const baseInitial: PracticeProfileInput = {
  name: "Acme Family Medicine",
  npiNumber: null,
  entityType: "COVERED_ENTITY",
  primaryState: "AZ",
  operatingStates: [],
  addressStreet: null,
  addressSuite: null,
  addressCity: null,
  addressZip: null,
  specialty: null,
  providerCount: "SOLO",
  ehrSystem: null,
  staffHeadcount: null,
  phone: null,
};

describe("PracticeProfileForm", () => {
  it("renders Identity, Location, Practice section headings", () => {
    render(<PracticeProfileForm mode="onboarding" initial={baseInitial} onSubmit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /identity/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /location/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^practice$/i })).toBeInTheDocument();
  });

  it("hides staff headcount + phone in onboarding mode", () => {
    render(<PracticeProfileForm mode="onboarding" initial={baseInitial} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText(/staff headcount/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^phone/i)).not.toBeInTheDocument();
  });

  it("shows staff headcount + phone in settings mode", () => {
    render(<PracticeProfileForm mode="settings" initial={baseInitial} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/staff headcount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^phone/i)).toBeInTheDocument();
  });

  it("rejects submit when NPI is invalid (10 digits but bad checksum)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PracticeProfileForm mode="settings" initial={baseInitial} onSubmit={onSubmit} />,
    );
    const npi = screen.getByLabelText(/npi/i);
    await user.clear(npi);
    await user.type(npi, "1234567890"); // bad checksum
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid npi/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects submit when zip is not 5 digits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PracticeProfileForm
        mode="settings"
        initial={{ ...baseInitial, addressZip: "123" }}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/zip must be 5 digits/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits successfully with valid input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <PracticeProfileForm
        mode="settings"
        initial={{ ...baseInitial, name: "Acme" }}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]![0].name).toBe("Acme");
  });

  it("displays the error returned by onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: "Server boom" });
    render(
      <PracticeProfileForm mode="settings" initial={baseInitial} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText("Server boom")).toBeInTheDocument();
    });
  });

  it("calls onSpecialtyChange when specialty is picked", async () => {
    const user = userEvent.setup();
    const onSpecialtyChange = vi.fn();
    render(
      <PracticeProfileForm
        mode="settings"
        initial={baseInitial}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onSpecialtyChange={onSpecialtyChange}
      />,
    );
    // Open the SpecialtyCombobox (its trigger has aria-label "Select specialty"
    // when empty, vs "Specialty: <value>" when filled — narrow by name).
    const specialtyTrigger = screen.getByRole("combobox", {
      name: /select specialty/i,
    });
    await user.click(specialtyTrigger);
    // Click "Family Medicine"
    const item = await screen.findByText("Family Medicine");
    await user.click(item);
    expect(onSpecialtyChange).toHaveBeenCalledWith("Family Medicine");
  });
});
