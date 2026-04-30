// src/app/(dashboard)/programs/incidents/[id]/OshaOutcomePanel.tsx
//
// Audit #15 (2026-04-30): client island that renders the OSHA recordable
// details block for an incident in either view or edit mode. Admins get
// an Edit affordance via <HistoryRowActions> (no Delete — incidents
// aren't deletable here; resolution happens through resolveIncidentAction).
// Save dispatches updateIncidentOshaOutcomeAction.
//
// Mirrors the audit-#8 CredentialMetadataPanel mode-toggle pattern.

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

export interface OshaOutcomePanelMember {
  userId: string;
  label: string;
}

export interface OshaOutcomePanelProps {
  incidentId: string;
  canManage: boolean;
  memberOptions: OshaOutcomePanelMember[];
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
  initial,
}: OshaOutcomePanelProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");

  if (mode === "edit") {
    return (
      <OshaOutcomeEditForm
        incidentId={incidentId}
        memberOptions={memberOptions}
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
          <li>Outcome: {initial.oshaOutcome.replace(/_/g, " ")}</li>
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
  initial,
  onCancel,
}: {
  incidentId: string;
  memberOptions: OshaOutcomePanelMember[];
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
          oshaDaysAway: daysAway ? parseInt(daysAway, 10) : null,
          oshaDaysRestricted: daysRestricted
            ? parseInt(daysRestricted, 10)
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

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs text-foreground space-y-3">
      <p className="font-medium">Edit OSHA recordable details</p>
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
          className={FIELD_CLASS}
        >
          <option value="">Select staff member…</option>
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
            className={FIELD_CLASS}
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
            value={daysAway}
            onChange={(e) => setDaysAway(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
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
            value={daysRestricted}
            onChange={(e) => setDaysRestricted(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
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
            className={FIELD_CLASS}
          />
        </div>
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
