// src/components/gw/Extras/DeaExtras.tsx
//
// DEA Section G helpers:
//   - PerpetualInventoryWorksheet: simple add/subtract sandbox for a
//     Schedule II perpetual inventory entry. Use when you don't yet have a
//     full inventory module — produces a printable line you can paste into
//     the official paper log.
//   - BiennialInventoryReminder: countdown to next biennial inventory
//     based on the most recent inventory date stored in localStorage. The
//     federal rule is "every two years from the previous inventory."

"use client";

import { useState, useSyncExternalStore } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

export function DeaExtras() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PerpetualInventoryWorksheet />
      <BiennialInventoryReminder />
    </div>
  );
}

function PerpetualInventoryWorksheet() {
  const tz = usePracticeTimezone();
  const [drug, setDrug] = useState("");
  const [opening, setOpening] = useState("");
  const [received, setReceived] = useState("");
  const [dispensed, setDispensed] = useState("");
  const [destroyed, setDestroyed] = useState("");
  const o = Number.parseInt(opening, 10) || 0;
  const r = Number.parseInt(received, 10) || 0;
  const d = Number.parseInt(dispensed, 10) || 0;
  const ds = Number.parseInt(destroyed, 10) || 0;
  const closing = o + r - d - ds;
  const hasInput = drug || opening || received || dispensed || destroyed;
  const today = formatPracticeDate(new Date(), tz);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">Perpetual inventory line</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Sandbox for a single Schedule II inventory entry. The
            calculation here is just opening + received − dispensed − destroyed.
            Paste the result into your bound paper log or DEA Form 41 worksheet.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <label className="col-span-2 block text-[10px] font-medium text-foreground">
            Drug + strength
            <input
              type="text"
              value={drug}
              onChange={(e) => setDrug(e.target.value)}
              placeholder="e.g. Hydrocodone/APAP 5/325 mg"
              className="mt-0.5 block w-full rounded border bg-background px-1.5 py-1 text-xs"
            />
          </label>
          {[
            { label: "Opening (units)", val: opening, set: setOpening },
            { label: "Received", val: received, set: setReceived },
            { label: "Dispensed", val: dispensed, set: setDispensed },
            { label: "Destroyed/wasted", val: destroyed, set: setDestroyed },
          ].map((f) => (
            <label
              key={f.label}
              className="block text-[10px] font-medium text-foreground"
            >
              {f.label}
              <input
                type="number"
                min={0}
                value={f.val}
                onChange={(e) => f.set(e.target.value)}
                className="mt-0.5 block w-full rounded border bg-background px-1.5 py-1 text-xs tabular-nums"
              />
            </label>
          ))}
        </div>
        {hasInput && (
          <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
            <p>
              <span className="font-medium">{drug || "(drug)"}</span> ·{" "}
              {today} · Opening {o} + Received {r} − Dispensed {d} − Destroyed {ds} ={" "}
              <span className="font-semibold tabular-nums">{closing}</span>{" "}
              units
            </p>
            {closing < 0 && (
              <p className="mt-1 text-[color:var(--gw-color-risk)]">
                Negative balance — physical count required. Document the
                discrepancy + DEA Form 106 if loss is suspected.
              </p>
            )}
          </div>
        )}
        <Badge variant="outline" className="text-[10px]">
          21 CFR §1304.04 + .11
        </Badge>
      </CardContent>
    </Card>
  );
}

const STORAGE_KEY = "gw.dea.last-biennial-inventory-date";

// useSyncExternalStore subscriber for the localStorage key. Rerenders
// whenever the storage event fires (cross-tab sync). The empty subscribe
// suffices for same-tab updates because handleSave triggers a state update
// itself.
function subscribeStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function getStoredDate() {
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}
function getServerStoredDate() {
  return "";
}

// "Now" snapshot for the relative-day computation. Read once at mount via
// useSyncExternalStore; reading Date.now() in render is impure and trips
// react-hooks/purity. Static after mount — the relative day count is good
// enough for a reminder card; a refresh re-snaps now.
function subscribeNoop() {
  return () => {};
}
function getNowMs() {
  return Date.now();
}
function getServerNowMs() {
  return null;
}

function BiennialInventoryReminder() {
  const tz = usePracticeTimezone();
  const stored = useSyncExternalStore(
    subscribeStorage,
    getStoredDate,
    getServerStoredDate,
  );
  const nowMs = useSyncExternalStore<number | null>(
    subscribeNoop,
    getNowMs,
    getServerNowMs,
  );
  // Local override state — set when the user types in the input. Falls back
  // to the localStorage-backed `stored` value when null, so cross-tab
  // updates take effect.
  const [override, setOverride] = useState<string | null>(null);
  const lastDate = override ?? stored;

  const handleSave = (val: string) => {
    setOverride(val);
    if (val) window.localStorage.setItem(STORAGE_KEY, val);
    else window.localStorage.removeItem(STORAGE_KEY);
  };

  const last = lastDate ? new Date(lastDate) : null;
  const next = last
    ? new Date(last.getTime() + 2 * 365 * 24 * 60 * 60 * 1000)
    : null;
  const daysUntil =
    next && nowMs !== null
      ? Math.ceil((next.getTime() - nowMs) / (24 * 60 * 60 * 1000))
      : null;
  const overdue = daysUntil !== null && daysUntil < 0;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">Biennial inventory reminder</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Federal rule: full physical inventory of all controlled
            substances every two years from the previous inventory date.
            Stored in your browser only — set on each device that needs the
            reminder until we ship a server-side credentialing surface.
          </p>
        </div>
        <label className="block text-[10px] font-medium text-foreground">
          Most recent biennial inventory date
          <input
            type="date"
            value={lastDate}
            onChange={(e) => handleSave(e.target.value)}
            className="mt-0.5 block w-full rounded border bg-background px-1.5 py-1 text-xs"
          />
        </label>
        {next && daysUntil !== null && (
          <div
            className="rounded-md border p-2 text-[11px]"
            style={{
              borderColor: overdue
                ? "var(--gw-color-risk)"
                : daysUntil < 60
                  ? "var(--gw-color-needs)"
                  : "var(--gw-color-compliant)",
            }}
          >
            <p className="font-medium">
              Next biennial inventory due {formatPracticeDate(next, tz)}
            </p>
            <p className="text-muted-foreground">
              {overdue
                ? `${Math.abs(daysUntil)} days overdue`
                : daysUntil === 0
                  ? "Due today"
                  : `In ${daysUntil} days`}
            </p>
          </div>
        )}
        {lastDate && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handleSave("")}
            className="text-[10px]"
          >
            Clear stored date
          </Button>
        )}
        <Badge variant="outline" className="text-[10px]">
          21 CFR §1304.11(c)
        </Badge>
      </CardContent>
    </Card>
  );
}
