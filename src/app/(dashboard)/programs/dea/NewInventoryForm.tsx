"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type DeaSchedule,
  SCHEDULE_VALUES,
  SCHEDULE_LABELS,
} from "@/lib/dea/labels";
import { recordInventoryAction } from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

interface ItemDraft {
  // Stable client-side ID so React `key={...}` doesn't reuse DOM nodes
  // when an item is removed mid-list. Not sent to the server.
  clientId: string;
  drugName: string;
  ndc: string;
  schedule: DeaSchedule;
  strength: string;
  quantity: string; // string in form; parsed to int on submit
  unit: string;
}

function emptyItem(): ItemDraft {
  return {
    clientId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    drugName: "",
    ndc: "",
    schedule: "CII",
    strength: "",
    quantity: "",
    unit: "tablets",
  };
}

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function NewInventoryForm() {
  const tz = usePracticeTimezone();
  const [asOfDate, setAsOfDate] = useState(() =>
    formatPracticeDate(new Date(), tz),
  );
  const [witnessName, setWitnessName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>(() => [emptyItem()]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(idx: number) {
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== idx),
    );
  }

  function handleSubmit() {
    setError(null);
    setSuccess(false);

    // Front-end validation: every item needs drug + non-negative quantity.
    for (const [idx, it] of items.entries()) {
      if (!it.drugName.trim()) {
        setError(`Item ${idx + 1}: drug name is required.`);
        return;
      }
      const qty = Number.parseInt(it.quantity, 10);
      if (Number.isNaN(qty) || qty < 0) {
        setError(`Item ${idx + 1}: quantity must be a non-negative integer.`);
        return;
      }
      if (!it.unit.trim()) {
        setError(`Item ${idx + 1}: unit is required.`);
        return;
      }
    }

    if (!asOfDate) {
      setError("As-of date is required.");
      return;
    }

    // Generate the inventoryId client-side so that a fast double-click of
    // Submit reuses the same ID on retry, dedupes via the server-side
    // idempotencyKey, and never creates two rows for the same submission.
    const inventoryId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) +
          Date.now().toString(36);

    startTransition(async () => {
      try {
        await recordInventoryAction({
          inventoryId,
          // <input type="date"> emits YYYY-MM-DD; convert to start-of-day ISO.
          asOfDate: new Date(`${asOfDate}T00:00:00Z`).toISOString(),
          witnessUserId: witnessName.trim() || null,
          notes: notes.trim() || null,
          items: items.map((it) => ({
            drugName: it.drugName.trim(),
            ndc: it.ndc.trim() || null,
            schedule: it.schedule,
            strength: it.strength.trim() || null,
            quantity: Number.parseInt(it.quantity, 10),
            unit: it.unit.trim(),
          })),
        });
        setAsOfDate(formatPracticeDate(new Date(), tz));
        setWitnessName("");
        setNotes("");
        setItems([emptyItem()]);
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
      <h3 className="text-sm font-semibold">Record a new inventory</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="asof-date" className="text-xs font-medium">
            As-of date
          </label>
          <input
            id="asof-date"
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="witness" className="text-xs font-medium">
            Witness{" "}
            <span className="font-normal text-muted-foreground">
              (optional, free text)
            </span>
          </label>
          <input
            id="witness"
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
          Drugs counted
        </h4>
        {items.map((it, idx) => (
          <div
            key={it.clientId}
            className="rounded-md border bg-background p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Item {idx + 1}
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  disabled={isPending}
                  className="inline-flex items-center gap-1 text-xs text-destructive hover:underline disabled:opacity-50"
                  aria-label={`Remove item ${idx + 1}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Remove
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`drug-${idx}`}
                  className="text-xs font-medium"
                >
                  Drug name
                </label>
                <input
                  id={`drug-${idx}`}
                  type="text"
                  value={it.drugName}
                  onChange={(e) =>
                    updateItem(idx, { drugName: e.target.value })
                  }
                  disabled={isPending}
                  placeholder="e.g. Hydrocodone/APAP"
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label
                  htmlFor={`ndc-${idx}`}
                  className="text-xs font-medium"
                >
                  NDC{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <input
                  id={`ndc-${idx}`}
                  type="text"
                  value={it.ndc}
                  onChange={(e) => updateItem(idx, { ndc: e.target.value })}
                  disabled={isPending}
                  placeholder="e.g. 0406-0123-01"
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label
                  htmlFor={`schedule-${idx}`}
                  className="text-xs font-medium"
                >
                  Schedule
                </label>
                <select
                  id={`schedule-${idx}`}
                  value={it.schedule}
                  onChange={(e) =>
                    updateItem(idx, {
                      schedule: e.target.value as DeaSchedule,
                    })
                  }
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
                  htmlFor={`strength-${idx}`}
                  className="text-xs font-medium"
                >
                  Strength{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <input
                  id={`strength-${idx}`}
                  type="text"
                  value={it.strength}
                  onChange={(e) =>
                    updateItem(idx, { strength: e.target.value })
                  }
                  disabled={isPending}
                  placeholder="e.g. 5/325 mg"
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label
                  htmlFor={`qty-${idx}`}
                  className="text-xs font-medium"
                >
                  Quantity
                </label>
                <input
                  id={`qty-${idx}`}
                  type="number"
                  min={0}
                  step={1}
                  value={it.quantity}
                  onChange={(e) =>
                    updateItem(idx, { quantity: e.target.value })
                  }
                  disabled={isPending}
                  placeholder="0"
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label
                  htmlFor={`unit-${idx}`}
                  className="text-xs font-medium"
                >
                  Unit
                </label>
                <input
                  id={`unit-${idx}`}
                  type="text"
                  value={it.unit}
                  onChange={(e) => updateItem(idx, { unit: e.target.value })}
                  disabled={isPending}
                  placeholder="tablets"
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add another drug
        </button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="inv-notes" className="text-xs font-medium">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="inv-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          placeholder="Discrepancies, corrective actions, conditions of count…"
          className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && (
        <p className="text-sm text-[color:var(--gw-color-compliant)]">
          Inventory recorded successfully.
        </p>
      )}

      <Button onClick={handleSubmit} disabled={isPending} size="sm">
        {isPending ? "Saving…" : "Record inventory"}
      </Button>
    </div>
  );
}
