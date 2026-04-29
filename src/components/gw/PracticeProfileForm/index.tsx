// src/components/gw/PracticeProfileForm/index.tsx
//
// Unified practice profile form. Used by:
//   - /settings/practice (mode="settings"): all sections + optional fields
//   - /onboarding/compliance-profile (mode="onboarding"): all sections,
//     but staffHeadcount + phone are hidden (compliance-relevant only).
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { US_STATES } from "@/lib/states";
import { isValidNpi } from "@/lib/npi";
import { SpecialtyCombobox } from "@/components/gw/SpecialtyCombobox";
import { StateMultiSelect } from "@/components/gw/StateMultiSelect";
import { EhrCombobox } from "@/components/gw/EhrCombobox";
import type { PracticeProfileInput, PracticeProfileFormProps } from "./types";

const inputClass =
  "mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm";
const labelClass = "text-xs font-medium text-foreground";
const sectionClass = "space-y-3 rounded-md border p-4";

export function PracticeProfileForm({
  mode,
  initial,
  onSubmit,
  submitLabel = "Save",
}: PracticeProfileFormProps) {
  const [state, setState] = useState<PracticeProfileInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof PracticeProfileInput, string>>
  >({});
  const [pending, startTransition] = useTransition();

  function update<K extends keyof PracticeProfileInput>(
    key: K,
    value: PracticeProfileInput[K],
  ) {
    setState((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): Partial<Record<keyof PracticeProfileInput, string>> {
    const errs: Partial<Record<keyof PracticeProfileInput, string>> = {};
    if (!state.name || state.name.trim().length === 0) {
      errs.name = "Practice name is required.";
    }
    if (state.npiNumber && !isValidNpi(state.npiNumber)) {
      errs.npiNumber = "Invalid NPI checksum — please verify the number.";
    }
    if (state.addressZip && !/^\d{5}$/.test(state.addressZip)) {
      errs.addressZip = "Zip must be 5 digits.";
    }
    if (!US_STATES.find((s) => s.code === state.primaryState)) {
      errs.primaryState = "Primary state is required.";
    }
    return errs;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    startTransition(async () => {
      const result = await onSubmit(state);
      if (!result.ok) {
        setError(result.error ?? "Save failed");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className={sectionClass} aria-labelledby="identity-heading">
        <h3 id="identity-heading" className="text-sm font-semibold">
          Identity
        </h3>
        <div>
          <label htmlFor="name" className={labelClass}>
            Practice name
          </label>
          <input
            id="name"
            type="text"
            value={state.name}
            onChange={(e) => update("name", e.target.value)}
            required
            maxLength={200}
            className={inputClass}
          />
          {fieldErrors.name && (
            <p className="mt-1 text-xs text-destructive">{fieldErrors.name}</p>
          )}
        </div>
        <div>
          <label htmlFor="npiNumber" className={labelClass}>
            NPI (optional)
          </label>
          <input
            id="npiNumber"
            type="text"
            inputMode="numeric"
            placeholder="10-digit NPI"
            value={state.npiNumber ?? ""}
            onChange={(e) => update("npiNumber", e.target.value || null)}
            className={inputClass}
          />
          {fieldErrors.npiNumber && (
            <p className="mt-1 text-xs text-destructive">{fieldErrors.npiNumber}</p>
          )}
        </div>
        <div>
          <span className={labelClass}>Entity type</span>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="entityType"
                value="COVERED_ENTITY"
                checked={state.entityType === "COVERED_ENTITY"}
                onChange={() => update("entityType", "COVERED_ENTITY")}
              />
              <span>Covered Entity</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="entityType"
                value="BUSINESS_ASSOCIATE"
                checked={state.entityType === "BUSINESS_ASSOCIATE"}
                onChange={() => update("entityType", "BUSINESS_ASSOCIATE")}
              />
              <span>Business Associate</span>
            </label>
          </div>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="location-heading">
        <h3 id="location-heading" className="text-sm font-semibold">
          Location
        </h3>
        <div>
          <label htmlFor="primaryState" className={labelClass}>
            Primary state
          </label>
          <select
            id="primaryState"
            value={state.primaryState}
            onChange={(e) => update("primaryState", e.target.value)}
            className={inputClass}
          >
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          {fieldErrors.primaryState && (
            <p className="mt-1 text-xs text-destructive">
              {fieldErrors.primaryState}
            </p>
          )}
        </div>
        <div>
          <span className={labelClass}>Additional states</span>
          <StateMultiSelect
            selectedStates={state.operatingStates}
            excludeStates={[state.primaryState]}
            onChange={(next) => update("operatingStates", next)}
            className="mt-1"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="addressStreet" className={labelClass}>
              Street
            </label>
            <input
              id="addressStreet"
              type="text"
              value={state.addressStreet ?? ""}
              onChange={(e) => update("addressStreet", e.target.value || null)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="addressSuite" className={labelClass}>
              Suite
            </label>
            <input
              id="addressSuite"
              type="text"
              value={state.addressSuite ?? ""}
              onChange={(e) => update("addressSuite", e.target.value || null)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="addressCity" className={labelClass}>
              City
            </label>
            <input
              id="addressCity"
              type="text"
              value={state.addressCity ?? ""}
              onChange={(e) => update("addressCity", e.target.value || null)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="addressZip" className={labelClass}>
              Zip
            </label>
            <input
              id="addressZip"
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={state.addressZip ?? ""}
              onChange={(e) => update("addressZip", e.target.value || null)}
              className={inputClass}
            />
            {fieldErrors.addressZip && (
              <p className="mt-1 text-xs text-destructive">
                {fieldErrors.addressZip}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="practice-heading">
        <h3 id="practice-heading" className="text-sm font-semibold">
          Practice
        </h3>
        <div>
          <span className={labelClass}>Specialty</span>
          <SpecialtyCombobox
            value={state.specialty ?? ""}
            onChange={(next) => update("specialty", next || null)}
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="providerCount" className={labelClass}>
            Providers
          </label>
          <select
            id="providerCount"
            value={state.providerCount}
            onChange={(e) =>
              update(
                "providerCount",
                e.target.value as PracticeProfileInput["providerCount"],
              )
            }
            className={inputClass}
          >
            <option value="SOLO">Solo (1)</option>
            <option value="SMALL_2_5">Small (2–5)</option>
            <option value="MEDIUM_6_15">Medium (6–15)</option>
            <option value="LARGE_16_PLUS">Large (16+)</option>
          </select>
        </div>
        <div>
          <span className={labelClass}>EHR system</span>
          <EhrCombobox
            value={state.ehrSystem ?? ""}
            onChange={(next) => update("ehrSystem", next || null)}
            className="mt-1"
          />
        </div>
        {mode === "settings" && (
          <>
            <div>
              <label htmlFor="staffHeadcount" className={labelClass}>
                Staff headcount
              </label>
              <input
                id="staffHeadcount"
                type="number"
                min={0}
                value={state.staffHeadcount ?? ""}
                onChange={(e) =>
                  update(
                    "staffHeadcount",
                    e.target.value ? Number.parseInt(e.target.value, 10) : null,
                  )
                }
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="phone" className={labelClass}>
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                value={state.phone ?? ""}
                onChange={(e) => update("phone", e.target.value || null)}
                className={inputClass}
              />
            </div>
          </>
        )}
      </section>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
