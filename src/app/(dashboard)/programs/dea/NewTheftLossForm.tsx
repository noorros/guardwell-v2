"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  type DeaSchedule,
  SCHEDULE_VALUES,
  SCHEDULE_LABELS,
  type DeaLossType,
  LOSS_TYPE_VALUES,
  LOSS_TYPE_LABELS,
} from "@/lib/dea/labels";
import { recordTheftLossAction } from "./actions";

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function NewTheftLossForm() {
  const today = new Date().toISOString().slice(0, 10);

  const [discoveredAt, setDiscoveredAt] = useState(today);
  const [lossType, setLossType] = useState<DeaLossType>("THEFT");
  const [drugName, setDrugName] = useState("");
  const [ndc, setNdc] = useState("");
  const [schedule, setSchedule] = useState<DeaSchedule>("CII");
  const [strength, setStrength] = useState("");
  const [quantityLost, setQuantityLost] = useState("");
  const [unit, setUnit] = useState("tablets");
  const [methodOfDiscovery, setMethodOfDiscovery] = useState("");
  const [lawEnforcementNotified, setLawEnforcementNotified] = useState(false);
  const [lawEnforcementAgency, setLawEnforcementAgency] = useState("");
  const [lawEnforcementCaseNumber, setLawEnforcementCaseNumber] = useState("");
  const [deaNotifiedAt, setDeaNotifiedAt] = useState("");
  const [form106SubmittedAt, setForm106SubmittedAt] = useState("");
  const [notes, setNotes] = useState("");

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit() {
    setError(null);
    setSuccess(false);

    if (!discoveredAt) {
      setError("Discovery date is required.");
      return;
    }
    if (!drugName.trim()) {
      setError("Drug name is required.");
      return;
    }
    const qty = Number.parseInt(quantityLost, 10);
    if (Number.isNaN(qty) || qty < 1) {
      setError("Quantity lost must be a positive integer.");
      return;
    }
    if (!unit.trim()) {
      setError("Unit is required.");
      return;
    }

    // Generate reportId client-side so a fast double-click of Submit
    // reuses the same ID + dedupes via the server's idempotencyKey.
    const reportId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

    startTransition(async () => {
      try {
        await recordTheftLossAction({
          reportId,
          reportBatchId: null,
          incidentId: null,
          discoveredAt: new Date(`${discoveredAt}T00:00:00Z`).toISOString(),
          lossType,
          drugName: drugName.trim(),
          ndc: ndc.trim() || null,
          schedule,
          strength: strength.trim() || null,
          quantityLost: qty,
          unit: unit.trim(),
          methodOfDiscovery: methodOfDiscovery.trim() || null,
          lawEnforcementNotified,
          lawEnforcementAgency: lawEnforcementNotified
            ? lawEnforcementAgency.trim() || null
            : null,
          lawEnforcementCaseNumber: lawEnforcementNotified
            ? lawEnforcementCaseNumber.trim() || null
            : null,
          deaNotifiedAt: deaNotifiedAt
            ? new Date(`${deaNotifiedAt}T00:00:00Z`).toISOString()
            : null,
          form106SubmittedAt: form106SubmittedAt
            ? new Date(`${form106SubmittedAt}T00:00:00Z`).toISOString()
            : null,
          notes: notes.trim() || null,
        });
        setDiscoveredAt(today);
        setLossType("THEFT");
        setDrugName("");
        setNdc("");
        setSchedule("CII");
        setStrength("");
        setQuantityLost("");
        setUnit("tablets");
        setMethodOfDiscovery("");
        setLawEnforcementNotified(false);
        setLawEnforcementAgency("");
        setLawEnforcementCaseNumber("");
        setDeaNotifiedAt("");
        setForm106SubmittedAt("");
        setNotes("");
        setSuccess(true);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "An error occurred. Please try again.",
        );
      }
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Record a theft or loss</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="tl-discovered" className="text-xs font-medium">
            Date discovered
          </label>
          <input
            id="tl-discovered"
            type="date"
            value={discoveredAt}
            onChange={(e) => setDiscoveredAt(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="tl-loss-type" className="text-xs font-medium">
            Loss type
          </label>
          <select
            id="tl-loss-type"
            value={lossType}
            onChange={(e) => setLossType(e.target.value as DeaLossType)}
            disabled={isPending}
            className={FIELD_CLASS}
          >
            {LOSS_TYPE_VALUES.map((lt) => (
              <option key={lt} value={lt}>
                {LOSS_TYPE_LABELS[lt]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Drug lost
        </h4>
        <div className="rounded-md border bg-background p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="tl-drug" className="text-xs font-medium">
                Drug name
              </label>
              <input
                id="tl-drug"
                type="text"
                value={drugName}
                onChange={(e) => setDrugName(e.target.value)}
                disabled={isPending}
                placeholder="e.g. Hydrocodone/APAP"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="tl-ndc" className="text-xs font-medium">
                NDC{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                id="tl-ndc"
                type="text"
                value={ndc}
                onChange={(e) => setNdc(e.target.value)}
                disabled={isPending}
                placeholder="e.g. 0406-0123-01"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="tl-schedule" className="text-xs font-medium">
                Schedule
              </label>
              <select
                id="tl-schedule"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value as DeaSchedule)}
                disabled={isPending}
                className={FIELD_CLASS}
              >
                {SCHEDULE_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {SCHEDULE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tl-strength" className="text-xs font-medium">
                Strength{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                id="tl-strength"
                type="text"
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                disabled={isPending}
                placeholder="e.g. 5/325 mg"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="tl-qty" className="text-xs font-medium">
                Quantity lost
              </label>
              <input
                id="tl-qty"
                type="number"
                min={1}
                step={1}
                value={quantityLost}
                onChange={(e) => setQuantityLost(e.target.value)}
                disabled={isPending}
                placeholder="0"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="tl-unit" className="text-xs font-medium">
                Unit
              </label>
              <input
                id="tl-unit"
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                disabled={isPending}
                placeholder="tablets"
                className={FIELD_CLASS}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="tl-method" className="text-xs font-medium">
          Method of discovery{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="tl-method"
          rows={3}
          value={methodOfDiscovery}
          onChange={(e) => setMethodOfDiscovery(e.target.value)}
          disabled={isPending}
          placeholder="How did you discover the loss? e.g. daily count discrepancy, broken seal, missing vial."
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Notifications
        </h4>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={lawEnforcementNotified}
            onChange={(e) => setLawEnforcementNotified(e.target.checked)}
            disabled={isPending}
            className="h-3.5 w-3.5 rounded border"
          />
          <span>Law enforcement has been notified</span>
        </label>
        {lawEnforcementNotified && (
          <div className="grid gap-3 sm:grid-cols-2 pl-5">
            <div className="space-y-1.5">
              <label htmlFor="tl-le-agency" className="text-xs font-medium">
                Agency
              </label>
              <input
                id="tl-le-agency"
                type="text"
                value={lawEnforcementAgency}
                onChange={(e) => setLawEnforcementAgency(e.target.value)}
                disabled={isPending}
                placeholder="e.g. Phoenix PD"
                className={FIELD_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="tl-le-case" className="text-xs font-medium">
                Case number
              </label>
              <input
                id="tl-le-case"
                type="text"
                value={lawEnforcementCaseNumber}
                onChange={(e) => setLawEnforcementCaseNumber(e.target.value)}
                disabled={isPending}
                placeholder="e.g. 2026-12345"
                className={FIELD_CLASS}
              />
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="tl-dea-notified" className="text-xs font-medium">
              DEA notified at{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <input
              id="tl-dea-notified"
              type="date"
              value={deaNotifiedAt}
              onChange={(e) => setDeaNotifiedAt(e.target.value)}
              disabled={isPending}
              className={FIELD_CLASS}
            />
            <p className="text-[11px] text-muted-foreground">
              Form 106 must be filed within 1 business day of discovery.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="tl-form106-at" className="text-xs font-medium">
              Form 106 submitted at{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <input
              id="tl-form106-at"
              type="date"
              value={form106SubmittedAt}
              onChange={(e) => setForm106SubmittedAt(e.target.value)}
              disabled={isPending}
              className={FIELD_CLASS}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="tl-notes" className="text-xs font-medium">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="tl-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          placeholder="Additional context for investigators or auditors…"
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && (
        <p className="text-sm text-[color:var(--gw-color-compliant)]">
          Theft / loss report recorded successfully.
        </p>
      )}

      <Button onClick={handleSubmit} disabled={isPending} size="sm">
        {isPending ? "Saving…" : "Record theft / loss"}
      </Button>
    </div>
  );
}
