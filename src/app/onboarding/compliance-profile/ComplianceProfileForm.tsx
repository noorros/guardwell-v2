// src/app/onboarding/compliance-profile/ComplianceProfileForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { SpecialtyCombobox } from "@/components/gw/SpecialtyCombobox";
import { deriveSpecialtyCategory } from "@/lib/specialties";
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
    /**
     * Specific specialty value (e.g. "Family Medicine"). The legacy
     * 6-bucket category is derived from this via deriveSpecialtyCategory.
     * Existing rows that pre-date this field will have null until the
     * user picks a specific.
     */
    specialty: string | null;
    providerCount: number | null;
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
  const [specialty, setSpecialty] = useState<string>(initial.specialty ?? "");
  const [providerCount, setProviderCount] = useState<string>(
    initial.providerCount != null ? String(initial.providerCount) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [escaping, setEscaping] = useState(false);
  const router = useRouter();

  const handleSpecialtyChange = (next: string) => {
    setSpecialty(next);
    // Specialty-aware defaults: dentists are almost always exempt from
    // MACRA/MIPS (low Medicare Part B volume + not in eligible specialty
    // list), so untoggle MIPS when DENTAL is picked. User can override.
    // Allied health — same exemption pattern. Behavioral health varies, so
    // leave it alone.
    const bucket = deriveSpecialtyCategory(next);
    if (bucket === "DENTAL" || bucket === "ALLIED") {
      setToggles((p) => ({ ...p, subjectToMacraMips: false }));
    }
  };

  const submit = (next: Route) => {
    setError(null);
    const providerCountParsed = providerCount
      ? Number.parseInt(providerCount, 10)
      : null;
    startTransition(async () => {
      try {
        await saveComplianceProfileAction({
          ...toggles,
          specialty: specialty || null,
          providerCount:
            providerCountParsed != null && !Number.isNaN(providerCountParsed)
              ? providerCountParsed
              : null,
        });
        router.push(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEscaping(false);
    submit(redirectTo);
  };

  const handleEscape = () => {
    setEscaping(true);
    submit(escapeHatchHref ?? ("/dashboard" as Route));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className="space-y-3">
        {TOGGLES.map((t) => (
          <label
            key={t.key}
            className="flex items-start gap-3 rounded-md border p-3 text-sm text-foreground"
          >
            <input
              type="checkbox"
              checked={toggles[t.key]}
              onChange={(e) =>
                setToggles((p) => ({ ...p, [t.key]: e.target.checked }))
              }
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

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-foreground">
          Primary specialty
          <SpecialtyCombobox
            value={specialty}
            onChange={handleSpecialtyChange}
            className="mt-1"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-foreground">
          Providers
          <input
            type="number"
            min={0}
            value={providerCount}
            onChange={(e) => setProviderCount(e.target.value)}
            placeholder="e.g. 3"
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
      </section>

      {error && (
        <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleEscape}
          disabled={isPending}
          className="text-xs text-muted-foreground underline disabled:opacity-50"
        >
          {escaping && isPending ? "Saving…" : "Set this up later →"}
        </button>
        <Button type="submit" size="sm" disabled={isPending}>
          {!escaping && isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
