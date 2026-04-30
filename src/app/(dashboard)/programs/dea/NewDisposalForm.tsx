"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  type DeaSchedule,
  SCHEDULE_VALUES,
  SCHEDULE_LABELS,
  DISPOSAL_METHOD_VALUES,
  DISPOSAL_METHOD_LABELS,
} from "@/lib/dea/labels";
import { recordDisposalAction } from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

type DisposalMethod = (typeof DISPOSAL_METHOD_VALUES)[number];

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function NewDisposalForm() {
  const tz = usePracticeTimezone();
  const today = formatPracticeDate(new Date(), tz);

  const [reverseDistributorName, setReverseDistributorName] = useState("");
  const [reverseDistributorDeaNumber, setReverseDistributorDeaNumber] =
    useState("");
  const [disposalDate, setDisposalDate] = useState(today);
  const [disposalMethod, setDisposalMethod] = useState<DisposalMethod>(
    "REVERSE_DISTRIBUTOR",
  );
  const [drugName, setDrugName] = useState("");
  const [ndc, setNdc] = useState("");
  const [schedule, setSchedule] = useState<DeaSchedule>("CII");
  const [strength, setStrength] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("tablets");
  const [witnessName, setWitnessName] = useState("");
  const [form41Filed, setForm41Filed] = useState(false);
  const [notes, setNotes] = useState("");

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit() {
    setError(null);
    setSuccess(false);

    if (!reverseDistributorName.trim()) {
      setError("Reverse distributor name is required.");
      return;
    }
    if (!disposalDate) {
      setError("Disposal date is required.");
      return;
    }
    if (!drugName.trim()) {
      setError("Drug name is required.");
      return;
    }
    const qty = Number.parseInt(quantity, 10);
    if (Number.isNaN(qty) || qty < 1) {
      setError("Quantity must be a positive integer.");
      return;
    }
    if (!unit.trim()) {
      setError("Unit is required.");
      return;
    }

    // Generate disposalRecordId client-side so a fast double-click of
    // Submit reuses the same ID + dedupes via the server's idempotencyKey.
    const disposalRecordId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

    startTransition(async () => {
      try {
        await recordDisposalAction({
          disposalRecordId,
          disposalBatchId: null,
          witnessUserId: witnessName.trim() || null,
          reverseDistributorName: reverseDistributorName.trim(),
          reverseDistributorDeaNumber:
            reverseDistributorDeaNumber.trim() || null,
          disposalDate: new Date(`${disposalDate}T00:00:00Z`).toISOString(),
          disposalMethod,
          drugName: drugName.trim(),
          ndc: ndc.trim() || null,
          schedule,
          strength: strength.trim() || null,
          quantity: qty,
          unit: unit.trim(),
          form41Filed,
          notes: notes.trim() || null,
        });
        setReverseDistributorName("");
        setReverseDistributorDeaNumber("");
        setDisposalDate(today);
        setDisposalMethod("REVERSE_DISTRIBUTOR");
        setDrugName("");
        setNdc("");
        setSchedule("CII");
        setStrength("");
        setQuantity("");
        setUnit("tablets");
        setWitnessName("");
        setForm41Filed(false);
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
      <h3 className="text-sm font-semibold">Record a new disposal</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="rd-name" className="text-xs font-medium">
            Reverse distributor name
          </label>
          <input
            id="rd-name"
            type="text"
            value={reverseDistributorName}
            onChange={(e) => setReverseDistributorName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Inmar Rx Solutions"
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rd-dea" className="text-xs font-medium">
            Reverse distributor DEA number{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <input
            id="rd-dea"
            type="text"
            value={reverseDistributorDeaNumber}
            onChange={(e) => setReverseDistributorDeaNumber(e.target.value)}
            disabled={isPending}
            placeholder="e.g. RI1234567"
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="disposal-date" className="text-xs font-medium">
            Disposal date
          </label>
          <input
            id="disposal-date"
            type="date"
            value={disposalDate}
            onChange={(e) => setDisposalDate(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="disposal-method" className="text-xs font-medium">
            Disposal method
          </label>
          <select
            id="disposal-method"
            value={disposalMethod}
            onChange={(e) =>
              setDisposalMethod(e.target.value as DisposalMethod)
            }
            disabled={isPending}
            className={FIELD_CLASS}
          >
            {DISPOSAL_METHOD_VALUES.map((m) => (
              <option key={m} value={m}>
                {DISPOSAL_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="disposal-witness" className="text-xs font-medium">
            Witness{" "}
            <span className="font-normal text-muted-foreground">
              (optional, free text)
            </span>
          </label>
          <input
            id="disposal-witness"
            type="text"
            value={witnessName}
            onChange={(e) => setWitnessName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Jane Doe, RPh"
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Drug surrendered
        </h4>
        <div className="rounded-md border bg-background p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="disposal-drug" className="text-xs font-medium">
                Drug name
              </label>
              <input
                id="disposal-drug"
                type="text"
                value={drugName}
                onChange={(e) => setDrugName(e.target.value)}
                disabled={isPending}
                placeholder="e.g. Hydrocodone/APAP"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="disposal-ndc" className="text-xs font-medium">
                NDC{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                id="disposal-ndc"
                type="text"
                value={ndc}
                onChange={(e) => setNdc(e.target.value)}
                disabled={isPending}
                placeholder="e.g. 0406-0123-01"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor="disposal-schedule"
                className="text-xs font-medium"
              >
                Schedule
              </label>
              <select
                id="disposal-schedule"
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
              <label
                htmlFor="disposal-strength"
                className="text-xs font-medium"
              >
                Strength{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                id="disposal-strength"
                type="text"
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                disabled={isPending}
                placeholder="e.g. 5/325 mg"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="disposal-qty" className="text-xs font-medium">
                Quantity
              </label>
              <input
                id="disposal-qty"
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={isPending}
                placeholder="0"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="disposal-unit" className="text-xs font-medium">
                Unit
              </label>
              <input
                id="disposal-unit"
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

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form41Filed}
          onChange={(e) => setForm41Filed(e.target.checked)}
          disabled={isPending}
          className="h-3.5 w-3.5 rounded border"
        />
        <span>Form 41 has been filed with the DEA</span>
      </label>

      <div className="space-y-1.5">
        <label htmlFor="disposal-notes" className="text-xs font-medium">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="disposal-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          placeholder="Reason for disposal, return authorization, conditions of surrender…"
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && (
        <p className="text-sm text-[color:var(--gw-color-compliant)]">
          Disposal recorded successfully.
        </p>
      )}

      <Button onClick={handleSubmit} disabled={isPending} size="sm">
        {isPending ? "Saving…" : "Record disposal"}
      </Button>
    </div>
  );
}
