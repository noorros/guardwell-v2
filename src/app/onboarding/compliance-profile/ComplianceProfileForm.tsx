// src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx
//
// Onboarding step 2 wrapper. Combines the 7 framework toggles (CLIA /
// DEA / CMS / MACRA / ALLERGY / TCPA) with the unified
// <PracticeProfileForm> (mode="onboarding"), which renders the Identity
// / Location / Practice sections and owns the primary submit button.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { PracticeProfileForm } from "@/components/gw/PracticeProfileForm";
import type { PracticeProfileInput } from "@/components/gw/PracticeProfileForm/types";
import { saveComplianceProfileAction } from "./actions";

export interface ComplianceProfileFormProps {
  initial: {
    hasInHouseLab: boolean;
    dispensesControlledSubstances: boolean;
    medicareParticipant: boolean;
    billsMedicaid: boolean;
    subjectToMacraMips: boolean;
    sendsAutomatedPatientMessages: boolean;
    compoundsAllergens: boolean;
    profile: PracticeProfileInput;
  };
  redirectTo: Route;
  /**
   * Where the "Set this up later" escape-hatch sends the user. The
   * profile still gets saved (with whatever values are currently in the
   * form) so the dashboard layout doesn't redirect-loop.
   * Defaults to /dashboard when omitted.
   */
  escapeHatchHref?: Route;
  submitLabel: string;
}

interface ToggleDef {
  key: keyof Pick<
    ComplianceProfileFormProps["initial"],
    | "hasInHouseLab"
    | "dispensesControlledSubstances"
    | "medicareParticipant"
    | "billsMedicaid"
    | "subjectToMacraMips"
    | "sendsAutomatedPatientMessages"
    | "compoundsAllergens"
  >;
  title: string;
  description: string;
  enables: string;
}

const TOGGLES: ToggleDef[] = [
  {
    key: "hasInHouseLab",
    title: "In-house laboratory",
    description:
      "You perform any lab tests onsite (waived or non-waived) that fall under CLIA.",
    enables: "CLIA",
  },
  {
    key: "dispensesControlledSubstances",
    title: "Dispenses controlled substances",
    description:
      "You prescribe or administer Schedule II–V controlled substances at a DEA-registered location.",
    enables: "DEA",
  },
  {
    key: "medicareParticipant",
    title: "Medicare participant",
    description: "Your practice bills Medicare or participates in Part B.",
    enables: "CMS",
  },
  {
    key: "billsMedicaid",
    title: "Bills Medicaid",
    description: "Your practice submits claims to any state Medicaid program.",
    enables: "CMS",
  },
  {
    key: "subjectToMacraMips",
    title: "Subject to MACRA/MIPS",
    description:
      "Your clinicians are eligible MIPS reporters — above the low-volume threshold and not qualifying as APM participants.",
    enables: "MACRA",
  },
  {
    key: "compoundsAllergens",
    title: "Compounds allergen extracts",
    description:
      "You mix or dilute allergen extracts on-site for skin testing or immunotherapy. Subject to USP 797 §21.",
    enables: "ALLERGY",
  },
  {
    key: "sendsAutomatedPatientMessages",
    title: "Automated patient communications",
    description:
      "You send automated text, voice, or email reminders, appointment confirmations, or marketing to patients.",
    enables: "TCPA",
  },
];

export function ComplianceProfileForm({
  initial,
  redirectTo,
  escapeHatchHref,
  submitLabel,
}: ComplianceProfileFormProps) {
  const [toggles, setToggles] = useState({
    hasInHouseLab: initial.hasInHouseLab,
    dispensesControlledSubstances: initial.dispensesControlledSubstances,
    medicareParticipant: initial.medicareParticipant,
    billsMedicaid: initial.billsMedicaid,
    subjectToMacraMips: initial.subjectToMacraMips,
    sendsAutomatedPatientMessages: initial.sendsAutomatedPatientMessages,
    compoundsAllergens: initial.compoundsAllergens,
  });
  const [profileSnapshot, setProfileSnapshot] = useState<PracticeProfileInput>(
    initial.profile,
  );
  const [escaping, startEscape] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const updateToggle = (key: keyof typeof toggles, next: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: next }));
  };

  const onSubmitProfile = async (
    next: PracticeProfileInput,
  ): Promise<{ ok: boolean; error?: string }> => {
    setError(null);
    setProfileSnapshot(next);
    try {
      await saveComplianceProfileAction({
        ...toggles,
        name: next.name,
        npiNumber: next.npiNumber,
        entityType: next.entityType,
        primaryState: next.primaryState,
        operatingStates: next.operatingStates,
        addressStreet: next.addressStreet,
        addressSuite: next.addressSuite,
        addressCity: next.addressCity,
        addressZip: next.addressZip,
        specialty: next.specialty,
        providerCount: next.providerCount,
        ehrSystem: next.ehrSystem,
      });
      router.push(redirectTo);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setError(message);
      return { ok: false, error: message };
    }
  };

  const handleEscape = () => {
    setError(null);
    const next = profileSnapshot;
    startEscape(async () => {
      try {
        await saveComplianceProfileAction({
          ...toggles,
          name: next.name,
          npiNumber: next.npiNumber,
          entityType: next.entityType,
          primaryState: next.primaryState,
          operatingStates: next.operatingStates,
          addressStreet: next.addressStreet,
          addressSuite: next.addressSuite,
          addressCity: next.addressCity,
          addressZip: next.addressZip,
          specialty: next.specialty,
          providerCount: next.providerCount,
          ehrSystem: next.ehrSystem,
        });
        router.push(escapeHatchHref ?? ("/dashboard" as Route));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        {TOGGLES.map((t) => (
          <label
            key={t.key}
            className="flex items-start gap-3 rounded-md border p-3 text-sm text-foreground"
          >
            <input
              type="checkbox"
              checked={toggles[t.key]}
              onChange={(e) => updateToggle(t.key, e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="flex-1">
              <span className="font-medium">{t.title}</span>
              <span className="block text-xs text-muted-foreground">
                {t.description}
              </span>
              <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                enables {t.enables}
              </span>
            </span>
          </label>
        ))}
      </section>

      {error && (
        <p className="text-xs text-[color:var(--gw-color-risk)]" role="alert">
          {error}
        </p>
      )}

      <PracticeProfileForm
        mode="onboarding"
        initial={initial.profile}
        onSubmit={onSubmitProfile}
        submitLabel={submitLabel}
      />

      <div className="flex justify-start">
        <button
          type="button"
          onClick={handleEscape}
          disabled={escaping}
          className="text-xs text-muted-foreground underline disabled:opacity-50"
        >
          {escaping ? "Saving…" : "Set this up later →"}
        </button>
      </div>
    </div>
  );
}
