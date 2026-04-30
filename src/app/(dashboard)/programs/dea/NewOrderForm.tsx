"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  type DeaSchedule,
  SCHEDULE_VALUES,
  SCHEDULE_LABELS,
} from "@/lib/dea/labels";
import { recordOrderAction } from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function NewOrderForm() {
  const tz = usePracticeTimezone();
  const today = formatPracticeDate(new Date(), tz);

  const [supplierName, setSupplierName] = useState("");
  const [supplierDeaNumber, setSupplierDeaNumber] = useState("");
  const [orderedAt, setOrderedAt] = useState(today);
  const [receivedAt, setReceivedAt] = useState("");
  const [form222Number, setForm222Number] = useState("");
  const [drugName, setDrugName] = useState("");
  const [ndc, setNdc] = useState("");
  const [schedule, setSchedule] = useState<DeaSchedule>("CII");
  const [strength, setStrength] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("tablets");
  const [notes, setNotes] = useState("");

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit() {
    setError(null);
    setSuccess(false);

    if (!supplierName.trim()) {
      setError("Supplier name is required.");
      return;
    }
    if (!orderedAt) {
      setError("Ordered date is required.");
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

    // Generate orderRecordId client-side so a fast double-click of Submit
    // reuses the same ID + dedupes via the server's idempotencyKey.
    const orderRecordId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

    startTransition(async () => {
      try {
        await recordOrderAction({
          orderRecordId,
          orderBatchId: null,
          supplierName: supplierName.trim(),
          supplierDeaNumber: supplierDeaNumber.trim() || null,
          // <input type="date"> emits YYYY-MM-DD; convert to start-of-day ISO.
          orderedAt: new Date(`${orderedAt}T00:00:00Z`).toISOString(),
          receivedAt: receivedAt
            ? new Date(`${receivedAt}T00:00:00Z`).toISOString()
            : null,
          form222Number: form222Number.trim() || null,
          drugName: drugName.trim(),
          ndc: ndc.trim() || null,
          schedule,
          strength: strength.trim() || null,
          quantity: qty,
          unit: unit.trim(),
          notes: notes.trim() || null,
        });
        setSupplierName("");
        setSupplierDeaNumber("");
        setOrderedAt(today);
        setReceivedAt("");
        setForm222Number("");
        setDrugName("");
        setNdc("");
        setSchedule("CII");
        setStrength("");
        setQuantity("");
        setUnit("tablets");
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
      <h3 className="text-sm font-semibold">Record a new order</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="supplier-name" className="text-xs font-medium">
            Supplier name
          </label>
          <input
            id="supplier-name"
            type="text"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Cardinal Health"
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="supplier-dea" className="text-xs font-medium">
            Supplier DEA number{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <input
            id="supplier-dea"
            type="text"
            value={supplierDeaNumber}
            onChange={(e) => setSupplierDeaNumber(e.target.value)}
            disabled={isPending}
            placeholder="e.g. RC1234567"
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ordered-at" className="text-xs font-medium">
            Ordered date
          </label>
          <input
            id="ordered-at"
            type="date"
            value={orderedAt}
            onChange={(e) => setOrderedAt(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="received-at" className="text-xs font-medium">
            Received date{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <input
            id="received-at"
            type="date"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="form-222" className="text-xs font-medium">
            Form 222 / CSOS number{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <input
            id="form-222"
            type="text"
            value={form222Number}
            onChange={(e) => setForm222Number(e.target.value)}
            disabled={isPending}
            placeholder="e.g. 12345678"
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Drug received
        </h4>
        <div className="rounded-md border bg-background p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="order-drug" className="text-xs font-medium">
                Drug name
              </label>
              <input
                id="order-drug"
                type="text"
                value={drugName}
                onChange={(e) => setDrugName(e.target.value)}
                disabled={isPending}
                placeholder="e.g. Hydrocodone/APAP"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="order-ndc" className="text-xs font-medium">
                NDC{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                id="order-ndc"
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
                htmlFor="order-schedule"
                className="text-xs font-medium"
              >
                Schedule
              </label>
              <select
                id="order-schedule"
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
                htmlFor="order-strength"
                className="text-xs font-medium"
              >
                Strength{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                id="order-strength"
                type="text"
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                disabled={isPending}
                placeholder="e.g. 5/325 mg"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="order-qty" className="text-xs font-medium">
                Quantity
              </label>
              <input
                id="order-qty"
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
              <label htmlFor="order-unit" className="text-xs font-medium">
                Unit
              </label>
              <input
                id="order-unit"
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
        <label htmlFor="order-notes" className="text-xs font-medium">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="order-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          placeholder="Discrepancies, partial fill, conditions on receipt…"
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && (
        <p className="text-sm text-[color:var(--gw-color-compliant)]">
          Order recorded successfully.
        </p>
      )}

      <Button onClick={handleSubmit} disabled={isPending} size="sm">
        {isPending ? "Saving…" : "Record order"}
      </Button>
    </div>
  );
}
