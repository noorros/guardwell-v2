// src/app/(dashboard)/programs/incidents/[id]/OshaOutcomePanel.tsx
//
// Audit #15 (2026-04-30): client island that renders the OSHA recordable
// details block for an incident in either view or edit mode. Admins get
// an Edit affordance via <HistoryRowActions> (no Delete — incidents
// aren't deletable here; resolution happens through resolveIncidentAction).
// Save dispatches updateIncidentOshaOutcomeAction.
//
// Mirrors the audit-#8 CredentialMetadataPanel mode-toggle pattern.
//
// Audit #21 (2026-04-30):
//   - CHROME-1: when the originally-injured employee was offboarded
//     (PracticeUser.removedAt set), the dropdown couldn't reflect the
//     stored injuredUserId because the active-member list filters them
//     out. The panel now accepts an `injuredUserLabel` prop and renders
//     a clearly-labeled "(removed)" option above the active list so the
//     stored value is preserved across saves.
//   - OSHA I-5: ARIA pass — wrap the edit form in <fieldset>/<legend>,
//     add aria-required on required inputs, and aria-invalid +
//     aria-describedby on the error message when a save fails.

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateIncidentOshaOutcomeAction } from "../actions";

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type OshaOutcomeValue =
  | "DEATH"
  | "DAYS_AWAY"
  | "RESTRICTED"
  | "OTHER_RECORDABLE"
  | "FIRST_AID";

/**
 * Audit #21 / CHROME-4: render OSHA outcome enums as title-case labels
 * (matching the form's dropdown labels) instead of the all-caps
 * underscore-replace fallback ("DAYS AWAY"). Single source of truth for
 * the view-mode bullet rendering and any future surface that needs to
 * humanize an OSHA outcome value.
 */
export const OSHA_OUTCOME_LABELS: Record<OshaOutcomeValue, string> = {
  DEATH: "Fatal",
  DAYS_AWAY: "Days away",
  RESTRICTED: "Restricted duty",
  OTHER_RECORDABLE: "Other recordable",
  FIRST_AID: "First aid only",
};

export interface OshaOutcomePanelMember {
  userId: string;
  label: string;
}

export interface OshaOutcomePanelProps {
  incidentId: string;
  canManage: boolean;
  memberOptions: OshaOutcomePanelMember[];
  /**
   * Audit #21 / CHROME-1: display label for the originally-injured
   * employee when they are no longer in `memberOptions` (e.g. their
   * PracticeUser row was soft-deleted via removedAt). The page passes
   * a label like "Alice Smith" or the user's email. The panel renders
   * a "(removed)" option using this label so the stored injuredUserId
   * is preserved across edit/save without forcing the admin to pick
   * a substitute or losing the historical attribution.
   */
  injuredUserLabel?: string | null;
  initial: {
    oshaBodyPart: string | null;
    oshaInjuryNature: string | null;
    oshaOutcome: OshaOutcomeValue | null;
    oshaDaysAway: number | null;
    oshaDaysRestricted: number | null;
    sharpsDeviceType: string | null;
    injuredUserId: string | null;
  };
}

export function OshaOutcomePanel({
  incidentId,
  canManage,
  memberOptions,
  injuredUserLabel,
  initial,
}: OshaOutcomePanelProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");

  if (mode === "edit") {
    return (
      <OshaOutcomeEditForm
        incidentId={incidentId}
        memberOptions={memberOptions}
        injuredUserLabel={injuredUserLabel}
        initial={initial}
        onCancel={() => setMode("view")}
      />
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs text-foreground">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">OSHA recordable details</p>
        {canManage && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMode("edit")}
            className="h-7 px-2 text-xs"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            <span className="ml-1">Edit</span>
          </Button>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {initial.oshaBodyPart && <li>Body part: {initial.oshaBodyPart}</li>}
        {initial.oshaInjuryNature && (
          <li>Injury: {initial.oshaInjuryNature}</li>
        )}
        {initial.oshaOutcome && (
          <li>Outcome: {OSHA_OUTCOME_LABELS[initial.oshaOutcome]}</li>
        )}
        {initial.oshaDaysAway != null && (
          <li>Days away: {initial.oshaDaysAway}</li>
        )}
        {initial.oshaDaysRestricted != null && (
          <li>Days restricted: {initial.oshaDaysRestricted}</li>
        )}
        {initial.sharpsDeviceType && (
          <li>Sharps device: {initial.sharpsDeviceType}</li>
        )}
      </ul>
      <div className="mt-3 pt-3 border-t">
        <Link
          href={`/api/audit/osha-301/${incidentId}` as Route}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          target="_blank"
          rel="noopener noreferrer"
        >
          Generate OSHA 301 form
        </Link>
      </div>
    </div>
  );
}

function OshaOutcomeEditForm({
  incidentId,
  memberOptions,
  injuredUserLabel,
  initial,
  onCancel,
}: {
  incidentId: string;
  memberOptions: OshaOutcomePanelMember[];
  injuredUserLabel?: string | null;
  initial: OshaOutcomePanelProps["initial"];
  onCancel: () => void;
}) {
  const [bodyPart, setBodyPart] = useState(initial.oshaBodyPart ?? "");
  const [injuryNature, setInjuryNature] = useState(
    initial.oshaInjuryNature ?? "",
  );
  const [outcome, setOutcome] = useState<string>(initial.oshaOutcome ?? "");
  const [daysAway, setDaysAway] = useState(
    initial.oshaDaysAway != null ? String(initial.oshaDaysAway) : "",
  );
  const [daysRestricted, setDaysRestricted] = useState(
    initial.oshaDaysRestricted != null
      ? String(initial.oshaDaysRestricted)
      : "",
  );
  const [sharpsDevice, setSharpsDevice] = useState(
    initial.sharpsDeviceType ?? "",
  );
  const [injuredUserId, setInjuredUserId] = useState(
    initial.injuredUserId ?? "",
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateIncidentOshaOutcomeAction({
          incidentId,
          oshaBodyPart: bodyPart.trim() || null,
          oshaInjuryNature: injuryNature.trim() || null,
          oshaOutcome: outcome
            ? (outcome as OshaOutcomeValue)
            : null,
          // §1904.7 caps day counts at 180. Guard against NaN before
          // Zod sees the value — sending NaN would surface as a generic
          // type error instead of a clear range error.
          oshaDaysAway: daysAway
            ? (() => {
                const n = parseInt(daysAway, 10);
                return Number.isFinite(n) ? n : null;
              })()
            : null,
          oshaDaysRestricted: daysRestricted
            ? (() => {
                const n = parseInt(daysRestricted, 10);
                return Number.isFinite(n) ? n : null;
              })()
            : null,
          sharpsDeviceType: sharpsDevice.trim() || null,
          injuredUserId: injuredUserId || null,
        });
        onCancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  const idPrefix = `edit-osha-${incidentId}`;
  const legendId = `${idPrefix}-legend`;
  const errorId = `${idPrefix}-error`;

  // Audit #21 / CHROME-1: if the stored injuredUserId is non-empty and
  // not present in the active member list, the original employee has
  // been offboarded. Render a clearly-labeled "(removed)" option above
  // active members so the dropdown reflects the stored value and the
  // admin can still see who was originally listed. Saving without
  // changing the dropdown preserves the value.
  const storedIdNotInActive =
    injuredUserId !== "" &&
    !memberOptions.some((m) => m.userId === injuredUserId);
  const removedLabel = injuredUserLabel?.trim() || "Former staff member";

  return (
    <fieldset
      aria-labelledby={legendId}
      aria-describedby={error ? errorId : undefined}
      className="rounded-md border bg-muted/30 p-3 text-xs text-foreground space-y-3"
    >
      <legend id={legendId} className="font-medium px-1">
        Edit OSHA recordable details
      </legend>
      <div>
        <label
          htmlFor={`${idPrefix}-injured`}
          className="block text-xs font-medium"
        >
          Injured staff member
        </label>
        <select
          id={`${idPrefix}-injured`}
          value={injuredUserId}
          onChange={(e) => setInjuredUserId(e.target.value)}
          disabled={isPending}
          aria-required="true"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
          className={FIELD_CLASS}
        >
          <option value="">Select staff member…</option>
          {storedIdNotInActive && (
            <option value={injuredUserId}>{removedLabel} (removed)</option>
          )}
          {memberOptions.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`${idPrefix}-body-part`}
            className="block text-xs font-medium"
          >
            Body part
          </label>
          <input
            id={`${idPrefix}-body-part`}
            type="text"
            value={bodyPart}
            onChange={(e) => setBodyPart(e.target.value)}
            disabled={isPending}
            maxLength={200}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-injury`}
            className="block text-xs font-medium"
          >
            Nature of injury
          </label>
          <input
            id={`${idPrefix}-injury`}
            type="text"
            value={injuryNature}
            onChange={(e) => setInjuryNature(e.target.value)}
            disabled={isPending}
            maxLength={200}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-outcome`}
            className="block text-xs font-medium"
          >
            Outcome
          </label>
          <select
            id={`${idPrefix}-outcome`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            disabled={isPending}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            className={FIELD_CLASS}
          >
            <option value="">Select…</option>
            {/*
             * Audit #21 / OSHA M-7: ordered by frequency (most common
             * first) instead of enum order so a typeahead "d" hits
             * "Days away" — the dominant case — before "Fatal" /
             * DEATH. Renamed DEATH to "Fatal" (matches OSHA's
             * own §1904.7 vocabulary) so the alphabetical D-collision
             * doesn't recur.
             */}
            <option value="FIRST_AID">First aid only</option>
            <option value="DAYS_AWAY">Days away</option>
            <option value="RESTRICTED">Restricted duty</option>
            <option value="OTHER_RECORDABLE">Other recordable</option>
            <option value="DEATH">Fatal</option>
          </select>
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-days-away`}
            className="block text-xs font-medium"
          >
            Days away
          </label>
          <input
            id={`${idPrefix}-days-away`}
            type="number"
            min={0}
            max={180}
            value={daysAway}
            onChange={(e) => setDaysAway(e.target.value)}
            disabled={isPending}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? `${errorId} ${idPrefix}-days-away-help` : `${idPrefix}-days-away-help`}
            className={FIELD_CLASS}
          />
          <p
            id={`${idPrefix}-days-away-help`}
            className="mt-0.5 text-[11px] text-muted-foreground"
          >
            max 180 days per §1904.7
          </p>
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-days-restricted`}
            className="block text-xs font-medium"
          >
            Days restricted
          </label>
          <input
            id={`${idPrefix}-days-restricted`}
            type="number"
            min={0}
            max={180}
            value={daysRestricted}
            onChange={(e) => setDaysRestricted(e.target.value)}
            disabled={isPending}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? `${errorId} ${idPrefix}-days-restricted-help` : `${idPrefix}-days-restricted-help`}
            className={FIELD_CLASS}
          />
          <p
            id={`${idPrefix}-days-restricted-help`}
            className="mt-0.5 text-[11px] text-muted-foreground"
          >
            max 180 days per §1904.7
          </p>
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-sharps`}
            className="block text-xs font-medium"
          >
            Sharps device
          </label>
          <input
            id={`${idPrefix}-sharps`}
            type="text"
            value={sharpsDevice}
            onChange={(e) => setSharpsDevice(e.target.value)}
            disabled={isPending}
            maxLength={200}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
            className={FIELD_CLASS}
          />
        </div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
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
    </fieldset>
  );
}
