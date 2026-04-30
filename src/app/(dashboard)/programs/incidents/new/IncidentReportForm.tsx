// src/app/(dashboard)/programs/incidents/new/IncidentReportForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { reportIncidentAction } from "../actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

type IncidentType =
  | "PRIVACY"
  | "SECURITY"
  | "OSHA_RECORDABLE"
  | "NEAR_MISS"
  | "DEA_THEFT_LOSS"
  | "CLIA_QC_FAILURE"
  | "TCPA_COMPLAINT";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface IncidentReportFormMember {
  userId: string;
  label: string;
}

export function IncidentReportForm({
  primaryState,
  operatingStates,
  memberOptions,
}: {
  primaryState: string;
  operatingStates: string[];
  memberOptions: IncidentReportFormMember[];
}) {
  const tz = usePracticeTimezone();
  const [type, setType] = useState<IncidentType>("PRIVACY");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [phiInvolved, setPhiInvolved] = useState(false);
  const [affectedCountStr, setAffectedCountStr] = useState("");
  const [discoveredAt, setDiscoveredAt] = useState(
    () => formatPracticeDate(new Date(), tz),
  );
  const jurisdictions = Array.from(
    new Set([primaryState, ...operatingStates]),
  );
  const [patientState, setPatientState] = useState<string>(primaryState);
  // OSHA-only fields.
  const [oshaBodyPart, setOshaBodyPart] = useState("");
  const [oshaInjuryNature, setOshaInjuryNature] = useState("");
  const [oshaOutcome, setOshaOutcome] = useState<string>("");
  const [oshaDaysAway, setOshaDaysAway] = useState("");
  const [oshaDaysRestricted, setOshaDaysRestricted] = useState<string>("");
  const [sharpsDeviceType, setSharpsDeviceType] = useState<string>("");
  // Audit #19: injured employee selection (OSHA-only). Required when
  // type=OSHA_RECORDABLE so the Form 300 column reflects the actual
  // injured staff member per §1904.35(b)(2)(v), not the reporter.
  const [injuredUserId, setInjuredUserId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const isOsha = type === "OSHA_RECORDABLE";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }
    const affectedCount = affectedCountStr
      ? Number.parseInt(affectedCountStr, 10)
      : null;
    if (affectedCount !== null && (Number.isNaN(affectedCount) || affectedCount < 0)) {
      setError("Affected count must be a non-negative integer.");
      return;
    }
    if (isOsha && !injuredUserId) {
      setError(
        "Select which staff member was injured. OSHA Form 300/301 requires the injured employee, not the reporter.",
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await reportIncidentAction({
          title: title.trim(),
          description: description.trim(),
          type,
          severity,
          phiInvolved,
          affectedCount,
          discoveredAt: new Date(discoveredAt).toISOString(),
          patientState: phiInvolved ? patientState : null,
          oshaBodyPart: isOsha ? oshaBodyPart.trim() || null : null,
          oshaInjuryNature: isOsha ? oshaInjuryNature.trim() || null : null,
          oshaOutcome: isOsha && oshaOutcome ? (oshaOutcome as
            | "DEATH"
            | "DAYS_AWAY"
            | "RESTRICTED"
            | "OTHER_RECORDABLE"
            | "FIRST_AID") : null,
          // Guard against NaN (e.g. if a non-numeric string slips past
          // the type=number input). Zod will then enforce the 0-180 range.
          oshaDaysAway: isOsha && oshaDaysAway
            ? (() => {
                const n = Number.parseInt(oshaDaysAway, 10);
                return Number.isFinite(n) ? n : null;
              })()
            : null,
          oshaDaysRestricted: isOsha && oshaDaysRestricted
            ? (() => {
                const n = Number.parseInt(oshaDaysRestricted, 10);
                return Number.isFinite(n) ? n : null;
              })()
            : null,
          sharpsDeviceType: isOsha && sharpsDeviceType.trim()
            ? sharpsDeviceType.trim()
            : null,
          injuredUserId: isOsha ? injuredUserId : null,
        });
        router.push(`/programs/incidents/${res.incidentId}` as Route);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to report");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="incident-type" className="block text-xs font-medium text-foreground">
                Type
              </label>
              <select
                id="incident-type"
                value={type}
                onChange={(e) => setType(e.target.value as IncidentType)}
                required
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="PRIVACY">Privacy</option>
                <option value="SECURITY">Security</option>
                <option value="OSHA_RECORDABLE">OSHA recordable</option>
                <option value="NEAR_MISS">Near miss</option>
                <option value="DEA_THEFT_LOSS">DEA theft/loss</option>
                <option value="CLIA_QC_FAILURE">CLIA QC failure</option>
                <option value="TCPA_COMPLAINT">TCPA complaint</option>
              </select>
            </div>
            <div>
              <label htmlFor="incident-severity" className="block text-xs font-medium text-foreground">
                Severity
              </label>
              <select
                id="incident-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                required
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="incident-title" className="block text-xs font-medium text-foreground">
              Title <span className="text-muted-foreground">*</span>
            </label>
            <input
              id="incident-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              placeholder="Short headline, e.g. 'Unencrypted laptop stolen from clinic'"
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label htmlFor="incident-description" className="block text-xs font-medium text-foreground">
              Description <span className="text-muted-foreground">*</span>
            </label>
            <textarea
              id="incident-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              maxLength={5000}
              placeholder="Facts of the incident: what happened, where, who discovered it, what data was involved."
              className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="incident-discovered-at" className="block text-xs font-medium text-foreground">
                Discovered
              </label>
              <input
                id="incident-discovered-at"
                type="date"
                value={discoveredAt}
                onChange={(e) => setDiscoveredAt(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="incident-affected-count" className="block text-xs font-medium text-foreground">
                Initial affected count (optional)
              </label>
              <input
                id="incident-affected-count"
                type="number"
                min={0}
                value={affectedCountStr}
                onChange={(e) => setAffectedCountStr(e.target.value)}
                placeholder="0"
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={phiInvolved}
              onChange={(e) => setPhiInvolved(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            PHI was involved in this incident
          </label>

          {phiInvolved && jurisdictions.length > 1 && (
            <div>
              <label htmlFor="incident-patient-state" className="block text-xs font-medium text-foreground">
                Patient state (for state-specific notification timing)
              </label>
              <select
                id="incident-patient-state"
                value={patientState}
                onChange={(e) => setPatientState(e.target.value)}
                className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {jurisdictions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isOsha && (
            <>
              <div className="rounded-md border border-dashed bg-muted/30 p-3">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  OSHA recordable details (29 CFR §1904)
                </p>
                <div>
                  <label htmlFor="osha-injured-user" className="block text-xs font-medium text-foreground">
                    Which staff member was injured?{" "}
                    <span className="text-muted-foreground">*</span>
                  </label>
                  <p id="osha-injured-user-help" className="mt-0.5 text-[10px] font-normal text-muted-foreground">
                    §1904.35(b)(2)(v) requires the injured employee on
                    Form 300/301 — distinct from the user reporting.
                  </p>
                  <select
                    id="osha-injured-user"
                    aria-describedby="osha-injured-user-help"
                    value={injuredUserId}
                    onChange={(e) => setInjuredUserId(e.target.value)}
                    required={isOsha}
                    className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Select staff member…</option>
                    {memberOptions.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="osha-body-part" className="block text-xs font-medium text-foreground">
                      Body part
                    </label>
                    <input
                      id="osha-body-part"
                      type="text"
                      value={oshaBodyPart}
                      onChange={(e) => setOshaBodyPart(e.target.value)}
                      placeholder="e.g. Hand"
                      className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="osha-injury-nature" className="block text-xs font-medium text-foreground">
                      Nature of injury
                    </label>
                    <input
                      id="osha-injury-nature"
                      type="text"
                      value={oshaInjuryNature}
                      onChange={(e) => setOshaInjuryNature(e.target.value)}
                      placeholder="e.g. Needlestick"
                      className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="osha-outcome" className="block text-xs font-medium text-foreground">
                      Outcome
                    </label>
                    <select
                      id="osha-outcome"
                      value={oshaOutcome}
                      onChange={(e) => setOshaOutcome(e.target.value)}
                      className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    >
                      <option value="">Select…</option>
                      <option value="DEATH">Death</option>
                      <option value="DAYS_AWAY">Days away</option>
                      <option value="RESTRICTED">Restricted duty</option>
                      <option value="OTHER_RECORDABLE">Other recordable</option>
                      <option value="FIRST_AID">First aid only</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="osha-days-away" className="block text-xs font-medium text-foreground">
                      Days away (if applicable)
                    </label>
                    <input
                      id="osha-days-away"
                      type="number"
                      min={0}
                      max={180}
                      value={oshaDaysAway}
                      onChange={(e) => setOshaDaysAway(e.target.value)}
                      aria-describedby="osha-days-away-help"
                      className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    />
                    <p id="osha-days-away-help" className="mt-1 text-[11px] font-normal text-muted-foreground">
                      max 180 days per §1904.7
                    </p>
                  </div>
                  <div>
                    <label htmlFor="osha-days-restricted" className="block text-xs font-medium text-foreground">
                      Days restricted (light duty / restricted work)
                    </label>
                    <input
                      id="osha-days-restricted"
                      type="number"
                      min={0}
                      max={180}
                      value={oshaDaysRestricted}
                      onChange={(e) => setOshaDaysRestricted(e.target.value)}
                      aria-describedby="osha-days-restricted-help"
                      className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    />
                    <p id="osha-days-restricted-help" className="mt-1 text-[11px] font-normal text-muted-foreground">
                      max 180 days per §1904.7
                    </p>
                  </div>
                  <div>
                    <label htmlFor="osha-sharps-device" className="block text-xs font-medium text-foreground">
                      Sharps device involved (if any)
                    </label>
                    <input
                      id="osha-sharps-device"
                      type="text"
                      placeholder="Needle / scalpel / lancet / other"
                      value={sharpsDeviceType}
                      onChange={(e) => setSharpsDeviceType(e.target.value)}
                      maxLength={200}
                      aria-describedby="osha-sharps-device-help"
                      className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    />
                    <p id="osha-sharps-device-help" className="mt-1 text-[11px] font-normal text-muted-foreground">
                      Required for the BBP §1910.1030 sharps injury log. Leave blank for non-sharps injuries.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {error && (
            <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Reporting doesn&apos;t declare this a HIPAA breach — the four-factor
          determination runs from the detail page once this incident is created.
        </p>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Reporting…" : "Report incident"}
        </Button>
      </div>
    </form>
  );
}
