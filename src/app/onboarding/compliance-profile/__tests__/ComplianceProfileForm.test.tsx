import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Route } from "next";
import { ComplianceProfileForm } from "../ComplianceProfileForm";
import type { PracticeProfileInput } from "@/components/gw/PracticeProfileForm/types";

// Mock the server action so the integration test never tries to hit the
// real db / event pipeline. We only care about the cross-component
// interaction here, not persistence.
vi.mock("../actions", () => ({
  saveComplianceProfileAction: vi.fn(async () => undefined),
}));

// next/navigation's useRouter is required by the component for the
// post-save redirect.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// Same Radix/cmdk polyfills as the SpecialtyCombobox + PracticeProfileForm
// tests — without these the popover trigger never fires in jsdom.
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

const baseProfile: PracticeProfileInput = {
  name: "Acme Family Medicine",
  npiNumber: null,
  entityType: "COVERED_ENTITY",
  primaryState: "AZ",
  operatingStates: [],
  timezone: null,
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

const baseInitial = {
  hasInHouseLab: false,
  dispensesControlledSubstances: false,
  medicareParticipant: true,
  billsMedicaid: true,
  subjectToMacraMips: true,
  sendsAutomatedPatientMessages: true,
  compoundsAllergens: false,
  profile: baseProfile,
};

describe("ComplianceProfileForm — specialty-driven MACRA toggle", () => {
  it("auto-untoggles MACRA/MIPS when a DENTAL specialty is picked", async () => {
    const user = userEvent.setup();
    render(
      <ComplianceProfileForm
        initial={baseInitial}
        redirectTo={"/onboarding/first-run" as Route}
        submitLabel="Continue"
      />,
    );

    // MACRA/MIPS starts ON (initial.subjectToMacraMips = true).
    const macraCheckbox = screen.getByRole("checkbox", {
      name: /subject to macra\/mips/i,
    });
    expect(macraCheckbox).toBeChecked();

    // Open the SpecialtyCombobox and pick a DENTAL specialty.
    const specialtyTrigger = screen.getByRole("combobox", {
      name: /select specialty/i,
    });
    await user.click(specialtyTrigger);
    const dentalItem = await screen.findByText("Dental — General");
    await user.click(dentalItem);

    // The MACRA toggle should have flipped off.
    await waitFor(() => {
      expect(macraCheckbox).not.toBeChecked();
    });
  });

  it("auto-untoggles MACRA/MIPS when an ALLIED specialty is picked", async () => {
    const user = userEvent.setup();
    render(
      <ComplianceProfileForm
        initial={baseInitial}
        redirectTo={"/onboarding/first-run" as Route}
        submitLabel="Continue"
      />,
    );

    const macraCheckbox = screen.getByRole("checkbox", {
      name: /subject to macra\/mips/i,
    });
    expect(macraCheckbox).toBeChecked();

    const specialtyTrigger = screen.getByRole("combobox", {
      name: /select specialty/i,
    });
    await user.click(specialtyTrigger);
    const ptItem = await screen.findByText("Physical Therapy");
    await user.click(ptItem);

    await waitFor(() => {
      expect(macraCheckbox).not.toBeChecked();
    });
  });

  it("leaves MACRA/MIPS untouched when a PRIMARY_CARE specialty is picked", async () => {
    const user = userEvent.setup();
    render(
      <ComplianceProfileForm
        initial={baseInitial}
        redirectTo={"/onboarding/first-run" as Route}
        submitLabel="Continue"
      />,
    );

    const macraCheckbox = screen.getByRole("checkbox", {
      name: /subject to macra\/mips/i,
    });
    expect(macraCheckbox).toBeChecked();

    const specialtyTrigger = screen.getByRole("combobox", {
      name: /select specialty/i,
    });
    await user.click(specialtyTrigger);
    const familyMedItem = await screen.findByText("Family Medicine");
    await user.click(familyMedItem);

    // MACRA stays on for primary care — no auto-untoggle.
    expect(macraCheckbox).toBeChecked();
  });
});
