"use client";

import { useState, useTransition } from "react";
import { Thermometer, Package, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  deleteEquipmentCheckAction,
  logEquipmentCheckAction,
  updateEquipmentCheckAction,
} from "./actions";
import { HistoryRowActions } from "@/components/gw/HistoryRowActions";

export interface EquipmentTabProps {
  canManage: boolean;
  checks: Array<{
    id: string;
    checkType: string;
    checkedAt: string;
    epiExpiryDate: string | null;
    epiLotNumber: string | null;
    allItemsPresent: boolean | null;
    itemsReplaced: string | null;
    temperatureC: number | null;
    inRange: boolean | null;
    notes: string | null;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function InRangeBadge({ inRange }: { inRange: boolean | null }) {
  if (inRange === null) return <Badge variant="secondary">Unknown</Badge>;
  return inRange ? (
    <Badge className="bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_15%,transparent)] text-[color:var(--gw-color-compliant)] border-[color:var(--gw-color-compliant)]">
      <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
      In range
    </Badge>
  ) : (
    <Badge variant="destructive">
      <XCircle className="mr-1 h-3 w-3" aria-hidden="true" />
      Out of range
    </Badge>
  );
}

function PresentBadge({ allItemsPresent }: { allItemsPresent: boolean | null }) {
  if (allItemsPresent === null) return <Badge variant="secondary">Unknown</Badge>;
  return allItemsPresent ? (
    <Badge className="bg-[color:color-mix(in_oklch,var(--gw-color-compliant)_15%,transparent)] text-[color:var(--gw-color-compliant)] border-[color:var(--gw-color-compliant)]">
      <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
      All present
    </Badge>
  ) : (
    <Badge variant="destructive">
      <XCircle className="mr-1 h-3 w-3" aria-hidden="true" />
      Items missing
    </Badge>
  );
}

// ── Emergency Kit Log Form ────────────────────────────────────────────────────

function EmergencyKitForm() {
  const [epiExpiryDate, setEpiExpiryDate] = useState("");
  const [epiLotNumber, setEpiLotNumber] = useState("");
  const [allItemsPresent, setAllItemsPresent] = useState(true);
  const [itemsReplaced, setItemsReplaced] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit() {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        await logEquipmentCheckAction({
          checkType: "EMERGENCY_KIT",
          epiExpiryDate: epiExpiryDate || null,
          epiLotNumber: epiLotNumber || null,
          allItemsPresent,
          itemsReplaced: itemsReplaced || null,
          notes: notes || null,
        });
        setEpiExpiryDate("");
        setEpiLotNumber("");
        setAllItemsPresent(true);
        setItemsReplaced("");
        setNotes("");
        setSuccess(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred. Please try again.");
      }
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Log a check</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="epi-expiry" className="text-xs font-medium">
            Epi expiry date
          </label>
          <input
            id="epi-expiry"
            type="date"
            value={epiExpiryDate}
            onChange={(e) => setEpiExpiryDate(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="epi-lot" className="text-xs font-medium">
            Lot number
          </label>
          <input
            id="epi-lot"
            type="text"
            value={epiLotNumber}
            onChange={(e) => setEpiLotNumber(e.target.value)}
            disabled={isPending}
            placeholder="e.g. AB12345"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allItemsPresent}
          onChange={(e) => setAllItemsPresent(e.target.checked)}
          disabled={isPending}
          className="h-4 w-4 cursor-pointer accent-[color:var(--gw-color-compliant)]"
        />
        All items present
      </label>
      <div className="space-y-1.5">
        <label htmlFor="items-replaced" className="text-xs font-medium">
          Items replaced{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="items-replaced"
          rows={2}
          value={itemsReplaced}
          onChange={(e) => setItemsReplaced(e.target.value)}
          disabled={isPending}
          placeholder="Describe any items replaced…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="kit-notes" className="text-xs font-medium">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="kit-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          placeholder="Any additional observations…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && (
        <p className="text-sm text-[color:var(--gw-color-compliant)]">Check recorded successfully.</p>
      )}
      <Button onClick={handleSubmit} disabled={isPending} size="sm">
        {isPending ? "Saving…" : "Record check"}
      </Button>
    </div>
  );
}

// ── Refrigerator Temperature Log Form ────────────────────────────────────────

function RefrigeratorForm() {
  const [temperatureC, setTemperatureC] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const tempNum = parseFloat(temperatureC);
  const inRange = !isNaN(tempNum) ? tempNum >= 2 && tempNum <= 8 : null;

  function handleSubmit() {
    if (isNaN(tempNum)) {
      setError("Please enter a valid temperature.");
      return;
    }
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        await logEquipmentCheckAction({
          checkType: "REFRIGERATOR_TEMP",
          temperatureC: tempNum,
          inRange: inRange ?? false,
          notes: notes || null,
        });
        setTemperatureC("");
        setNotes("");
        setSuccess(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred. Please try again.");
      }
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Log a reading</h3>
      <div className="grid gap-3 sm:grid-cols-2 items-end">
        <div className="space-y-1.5">
          <label htmlFor="temp-c" className="text-xs font-medium">
            Temperature (°C)
          </label>
          <input
            id="temp-c"
            type="number"
            step="0.1"
            value={temperatureC}
            onChange={(e) => setTemperatureC(e.target.value)}
            disabled={isPending}
            placeholder="e.g. 4.5"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {temperatureC !== "" && inRange !== null && (
          <div className="pb-1.5">
            <InRangeBadge inRange={inRange} />
            <p className="mt-1 text-xs text-muted-foreground">Acceptable range: 2–8°C</p>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="temp-notes" className="text-xs font-medium">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="temp-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          placeholder="Any observations or corrective actions…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && (
        <p className="text-sm text-[color:var(--gw-color-compliant)]">Reading recorded successfully.</p>
      )}
      <Button onClick={handleSubmit} disabled={isPending} size="sm">
        {isPending ? "Saving…" : "Record reading"}
      </Button>
    </div>
  );
}

// ── Edit Emergency Kit ────────────────────────────────────────────────────────

function EditEmergencyKitForm({
  check,
  onCancel,
}: {
  check: EquipmentTabProps["checks"][number];
  onCancel: () => void;
}) {
  const [epiExpiryDate, setEpiExpiryDate] = useState(
    check.epiExpiryDate ? check.epiExpiryDate.slice(0, 10) : "",
  );
  const [epiLotNumber, setEpiLotNumber] = useState(check.epiLotNumber ?? "");
  const [allItemsPresent, setAllItemsPresent] = useState(
    check.allItemsPresent ?? true,
  );
  const [itemsReplaced, setItemsReplaced] = useState(check.itemsReplaced ?? "");
  const [notes, setNotes] = useState(check.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateEquipmentCheckAction({
          equipmentCheckId: check.id,
          epiExpiryDate: epiExpiryDate || null,
          epiLotNumber: epiLotNumber || null,
          allItemsPresent,
          itemsReplaced: itemsReplaced || null,
          notes: notes || null,
        });
        onCancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  const idPrefix = `edit-kit-${check.id}`;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Edit emergency kit check</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-expiry`} className="text-xs font-medium">
            Epi expiry date
          </label>
          <input
            id={`${idPrefix}-expiry`}
            type="date"
            value={epiExpiryDate}
            onChange={(e) => setEpiExpiryDate(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-lot`} className="text-xs font-medium">
            Lot number
          </label>
          <input
            id={`${idPrefix}-lot`}
            type="text"
            value={epiLotNumber}
            onChange={(e) => setEpiLotNumber(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allItemsPresent}
          onChange={(e) => setAllItemsPresent(e.target.checked)}
          disabled={isPending}
          className="h-4 w-4 cursor-pointer accent-[color:var(--gw-color-compliant)]"
        />
        All items present
      </label>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-replaced`} className="text-xs font-medium">
          Items replaced <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`${idPrefix}-replaced`}
          rows={2}
          value={itemsReplaced}
          onChange={(e) => setItemsReplaced(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-notes`} className="text-xs font-medium">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={isPending} size="sm">
          {isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Edit Refrigerator Temp ────────────────────────────────────────────────────

function EditRefrigeratorForm({
  check,
  onCancel,
}: {
  check: EquipmentTabProps["checks"][number];
  onCancel: () => void;
}) {
  const [temperatureC, setTemperatureC] = useState(
    check.temperatureC != null ? String(check.temperatureC) : "",
  );
  const [notes, setNotes] = useState(check.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const tempNum = parseFloat(temperatureC);
  const inRange = !isNaN(tempNum) ? tempNum >= 2 && tempNum <= 8 : null;

  function handleSave() {
    if (isNaN(tempNum)) {
      setError("Please enter a valid temperature.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateEquipmentCheckAction({
          equipmentCheckId: check.id,
          temperatureC: tempNum,
          inRange: inRange ?? false,
          notes: notes || null,
        });
        onCancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  const idPrefix = `edit-temp-${check.id}`;

  return (
    <tr className="border-t bg-muted/40">
      <td colSpan={5} className="px-4 py-3">
        <div className="space-y-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Edit reading
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 items-end">
            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-temp`} className="text-xs font-medium">
                Temperature (°C)
              </label>
              <input
                id={`${idPrefix}-temp`}
                type="number"
                step="0.1"
                value={temperatureC}
                onChange={(e) => setTemperatureC(e.target.value)}
                disabled={isPending}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {temperatureC !== "" && inRange !== null && (
              <div className="pb-1.5">
                <InRangeBadge inRange={inRange} />
                <p className="mt-1 text-xs text-muted-foreground">Acceptable range: 2–8°C</p>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-notes`} className="text-xs font-medium">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id={`${idPrefix}-notes`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isPending}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={isPending} size="sm">
              {isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={onCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── EquipmentTab ──────────────────────────────────────────────────────────────

export function EquipmentTab({ canManage, checks }: EquipmentTabProps) {
  const kitChecks = checks.filter((c) => c.checkType === "EMERGENCY_KIT");
  const tempChecks = checks
    .filter((c) => c.checkType === "REFRIGERATOR_TEMP")
    .slice(0, 10);

  const latestKit = kitChecks[0] ?? null;
  const [editingKitId, setEditingKitId] = useState<string | null>(null);
  const [editingTempId, setEditingTempId] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {/* ── Emergency Kit ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-semibold">Emergency kit</h2>
        </div>

        {latestKit && editingKitId === latestKit.id ? (
          <EditEmergencyKitForm
            check={latestKit}
            onCancel={() => setEditingKitId(null)}
          />
        ) : latestKit ? (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            {canManage && (
              <div className="flex justify-end">
                <HistoryRowActions
                  canManage={canManage}
                  onEdit={() => setEditingKitId(latestKit.id)}
                  onDelete={async () => {
                    await deleteEquipmentCheckAction({
                      equipmentCheckId: latestKit.id,
                    });
                  }}
                  deleteConfirmText={`Delete this kit check from ${fmtDate(latestKit.checkedAt)}? It stays in the audit log but stops counting toward ALLERGY_EMERGENCY_KIT_CURRENT.`}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-0.5">
                  Last checked
                </span>
                <span>{fmtDate(latestKit.checkedAt)}</span>
              </div>
              {latestKit.epiExpiryDate && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-0.5">
                    Epi expires
                  </span>
                  <span
                    className={cn(
                      new Date(latestKit.epiExpiryDate) < new Date()
                        ? "text-destructive font-medium"
                        : "",
                    )}
                  >
                    {fmtDate(latestKit.epiExpiryDate)}
                    {new Date(latestKit.epiExpiryDate) < new Date() && " — EXPIRED"}
                  </span>
                </div>
              )}
              {latestKit.epiLotNumber && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-0.5">
                    Lot number
                  </span>
                  <span>{latestKit.epiLotNumber}</span>
                </div>
              )}
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground block mb-0.5">
                  Items
                </span>
                <PresentBadge allItemsPresent={latestKit.allItemsPresent} />
              </div>
            </div>
            {latestKit.itemsReplaced && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Items replaced:</span> {latestKit.itemsReplaced}
              </p>
            )}
            {latestKit.notes && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Notes:</span> {latestKit.notes}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center">
            No emergency kit checks recorded yet.
          </p>
        )}

        {canManage && editingKitId === null && <EmergencyKitForm />}
      </section>

      {/* ── Refrigerator Temperature ──────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-semibold">Refrigerator temperature</h2>
          <span className="text-xs text-muted-foreground">(2–8°C acceptable)</span>
        </div>

        {tempChecks.length > 0 ? (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Temp (°C)
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                    Notes
                  </th>
                  {canManage && (
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {tempChecks.map((c, i) =>
                  editingTempId === c.id ? (
                    <EditRefrigeratorForm
                      key={c.id}
                      check={c}
                      onCancel={() => setEditingTempId(null)}
                    />
                  ) : (
                    <tr
                      key={c.id}
                      className={cn("border-t", i % 2 === 0 ? "bg-background" : "bg-muted/20")}
                    >
                      <td className="px-4 py-2.5 tabular-nums">{fmtDate(c.checkedAt)}</td>
                      <td className="px-4 py-2.5 tabular-nums font-mono">
                        {c.temperatureC !== null ? c.temperatureC.toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <InRangeBadge inRange={c.inRange} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                        {c.notes ?? "—"}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2.5 text-right">
                          <HistoryRowActions
                            canManage={canManage}
                            onEdit={() => setEditingTempId(c.id)}
                            onDelete={async () => {
                              await deleteEquipmentCheckAction({
                                equipmentCheckId: c.id,
                              });
                            }}
                            deleteConfirmText={`Delete the ${fmtDate(c.checkedAt)} reading${c.temperatureC != null ? ` (${c.temperatureC.toFixed(1)}°C)` : ""}? It stays in the audit log but stops counting toward ALLERGY_REFRIGERATOR_LOG.`}
                          />
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center">
            No refrigerator readings recorded yet.
          </p>
        )}

        {canManage && editingTempId === null && <RefrigeratorForm />}
      </section>
    </div>
  );
}
