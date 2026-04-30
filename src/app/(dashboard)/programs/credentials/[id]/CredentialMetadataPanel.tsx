// src/app/(dashboard)/programs/credentials/[id]/CredentialMetadataPanel.tsx
//
// Audit #8 (Credentials B-2): Edit / Renew / Retire affordances on the
// credential detail page. Previously users had to Remove + Re-Add to
// update an expiry date, losing the credential.id + EvidenceLog history
// + CeuActivity rows. Now:
//   - Edit  → opens an inline form with all editable fields
//   - Renew → opens a minimal form with just expiryDate (and an
//             optional new issueDate)
//   - Retire → window.confirm + removeCredentialAction
//
// holder is intentionally read-only here — changing the assigned
// clinician is rare + needs a member-picker dropdown; defer to a
// follow-up. credentialTypeCode is server-side immutable per the
// updateCredentialAction docstring.

"use client";

import { useState, useTransition } from "react";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  removeCredentialAction,
  updateCredentialAction,
} from "../actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate } from "@/lib/audit/format";

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const TEXTAREA_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface CredentialMetadataValue {
  title: string;
  licenseNumber: string | null;
  issuingBody: string | null;
  issueDate: string | null; // ISO
  expiryDate: string | null; // ISO
  notes: string | null;
}

export interface CredentialMetadataPanelProps {
  credentialId: string;
  canManage: boolean;
  value: CredentialMetadataValue;
  /**
   * Typical renewal cycle from CredentialType, used to default the Renew
   * form's "new expiry date". Falls back to 365 days when null.
   * Examples: DEA = 1095 (3yr), CPR/BLS = 730 (2yr), most state licenses = 365.
   */
  renewalPeriodDays: number | null;
}

type Mode = "view" | "edit" | "renew";

function isoToYmd(iso: string | null): string {
  if (!iso) return "";
  // ISO datetime → YYYY-MM-DD (the format <input type="date"> expects).
  return iso.slice(0, 10);
}

export function CredentialMetadataPanel({
  credentialId,
  canManage,
  value,
  renewalPeriodDays,
}: CredentialMetadataPanelProps) {
  const tz = usePracticeTimezone();
  const [mode, setMode] = useState<Mode>("view");

  if (mode === "edit") {
    return (
      <CredentialEditForm
        credentialId={credentialId}
        initial={value}
        onCancel={() => setMode("view")}
      />
    );
  }
  if (mode === "renew") {
    return (
      <CredentialRenewForm
        credentialId={credentialId}
        initial={value}
        renewalPeriodDays={renewalPeriodDays}
        onCancel={() => setMode("view")}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">Credential details</h2>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMode("edit")}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMode("renew")}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Renew
            </Button>
            <RetireButton credentialId={credentialId} />
          </div>
        )}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">License number</dt>
          <dd className="mt-0.5">
            {value.licenseNumber ? (
              <span className="font-mono">{value.licenseNumber}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Issuing body</dt>
          <dd className="mt-0.5">
            {value.issuingBody ?? <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Issue date</dt>
          <dd className="mt-0.5 tabular-nums">
            {value.issueDate ? formatPracticeDate(new Date(value.issueDate), tz) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Expiry date</dt>
          <dd className="mt-0.5 tabular-nums">
            {value.expiryDate ? formatPracticeDate(new Date(value.expiryDate), tz) : "—"}
          </dd>
        </div>
        {value.notes && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
            <dd className="mt-0.5 whitespace-pre-wrap">{value.notes}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ── Retire ───────────────────────────────────────────────────────────────────

function RetireButton({ credentialId }: { credentialId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Retire this credential? It stays in the audit log but stops counting toward your framework score. CEU activities and evidence remain attached.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await removeCredentialAction({ credentialId });
        // Server action revalidates the page; the dl will re-render with
        // the retired credential. (Page-level treatment of retired
        // credentials is a separate concern handled by the page layout.)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to retire credential.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleClick}
        disabled={isPending}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {isPending ? "Retiring…" : "Retire"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ── Edit ─────────────────────────────────────────────────────────────────────

function CredentialEditForm({
  credentialId,
  initial,
  onCancel,
}: {
  credentialId: string;
  initial: CredentialMetadataValue;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [licenseNumber, setLicenseNumber] = useState(initial.licenseNumber ?? "");
  const [issuingBody, setIssuingBody] = useState(initial.issuingBody ?? "");
  const [issueDate, setIssueDate] = useState(isoToYmd(initial.issueDate));
  const [expiryDate, setExpiryDate] = useState(isoToYmd(initial.expiryDate));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await updateCredentialAction({
          credentialId,
          title,
          licenseNumber: licenseNumber.trim() || null,
          issuingBody: issuingBody.trim() || null,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          notes: notes.trim() || null,
        });
        onCancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save changes.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">Edit credential</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="cred-title" className="text-xs font-medium">
            Title
          </label>
          <input
            id="cred-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPending}
            maxLength={200}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="cred-license" className="text-xs font-medium">
            License number{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="cred-license"
            type="text"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            disabled={isPending}
            maxLength={100}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="cred-issuer" className="text-xs font-medium">
            Issuing body{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="cred-issuer"
            type="text"
            value={issuingBody}
            onChange={(e) => setIssuingBody(e.target.value)}
            disabled={isPending}
            maxLength={200}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="cred-issue-date" className="text-xs font-medium">
            Issue date{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="cred-issue-date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="cred-expiry-date" className="text-xs font-medium">
            Expiry date{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="cred-expiry-date"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
      </div>
      <div>
        <label htmlFor="cred-notes" className="text-xs font-medium">
          Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="cred-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          maxLength={2000}
          className={TEXTAREA_CLASS}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={handleSubmit} disabled={isPending || !title.trim()} size="sm">
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

// ── Renew ────────────────────────────────────────────────────────────────────

function CredentialRenewForm({
  credentialId,
  initial,
  renewalPeriodDays,
  onCancel,
}: {
  credentialId: string;
  initial: CredentialMetadataValue;
  renewalPeriodDays: number | null;
  onCancel: () => void;
}) {
  // Renewal default = bump expiryDate by `renewalPeriodDays` from the
  // current value (or from today if there's no current expiry). UI lets
  // the user override, and optionally update issueDate to the renewal date.
  // Falls back to 365 days when the credential type has no configured
  // renewal cycle. (Audit #21 IM-2: previously hardcoded to 365 — wrong
  // for DEA (1095) / CPR/BLS (730) / etc.)
  const [expiryDate, setExpiryDate] = useState(() => {
    const base = initial.expiryDate ? new Date(initial.expiryDate) : new Date();
    const days = renewalPeriodDays && renewalPeriodDays > 0 ? renewalPeriodDays : 365;
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
  });
  const [issueDate, setIssueDate] = useState(isoToYmd(initial.issueDate));
  const [licenseNumber, setLicenseNumber] = useState(initial.licenseNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await updateCredentialAction({
          credentialId,
          // Carry through every field — the server action does a full
          // upsert, so omitting a field would clear it. License number
          // is editable in renew because state boards sometimes issue
          // a new number on renewal.
          title: initial.title,
          licenseNumber: licenseNumber.trim() || null,
          issuingBody: initial.issuingBody ?? null,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          notes: initial.notes ?? null,
        });
        onCancel();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to renew credential.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">Renew credential</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Update the expiry date and (optionally) the license number if the
        issuer assigned a new one. Existing CEU activities and evidence stay
        attached to this credential.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="renew-expiry-date" className="text-xs font-medium">
            New expiry date
          </label>
          <input
            id="renew-expiry-date"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            disabled={isPending}
            required
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="renew-issue-date" className="text-xs font-medium">
            Issue date{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="renew-issue-date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="renew-license" className="text-xs font-medium">
            License number{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="renew-license"
            type="text"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            disabled={isPending}
            maxLength={100}
            className={FIELD_CLASS}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={handleSubmit} disabled={isPending || !expiryDate} size="sm">
          {isPending ? "Renewing…" : "Save renewal"}
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
