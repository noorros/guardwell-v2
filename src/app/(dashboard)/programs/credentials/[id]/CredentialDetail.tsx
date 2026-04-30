// src/app/(dashboard)/programs/credentials/[id]/CredentialDetail.tsx
//
// Orchestrator for the credential-detail page. Renders four panels:
//   - Metadata (Edit / Renew / Retire)         — CredentialMetadataPanel
//   - Evidence (upload + list, restricted gate) — CredentialDetail/EvidencePanel
//   - Continuing education (progress + log)     — CredentialDetail/CeuPanel
//   - Renewal reminders (milestone days form)   — CredentialDetail/ReminderPanel
//
// Audit #21 MN-4 (Wave-4 D4): the original 805-LOC monolithic component
// was split into focused panel siblings under `CredentialDetail/`. Public
// interface (this file's exported component + its props) is unchanged —
// `programs/credentials/[id]/page.tsx` continues to import from
// `./CredentialDetail`.

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { type EvidenceItem } from "@/components/gw/EvidenceUpload";
import { CredentialMetadataPanel } from "./CredentialMetadataPanel";
import { CeuPanel } from "./CredentialDetail/CeuPanel";
import { ReminderPanel } from "./CredentialDetail/ReminderPanel";
import { EvidencePanel } from "./CredentialDetail/EvidencePanel";
import { type CeuActivityRow } from "./CredentialDetail/helpers";

// Re-export the row shape so callers (page.tsx) keep their existing
// import paths working without churn.
export type { CeuActivityRow };

export interface CredentialDetailProps {
  canManage: boolean;
  credentialId: string;
  credentialType: {
    name: string;
    ceuRequirementHours: number | null;
    ceuRequirementWindowMonths: number | null;
    requiresEvidenceByDefault: boolean;
    renewalPeriodDays: number | null;
  };
  credential: {
    title: string;
    licenseNumber: string | null;
    issuingBody: string | null;
    issueDate: string | null; // ISO
    expiryDate: string | null; // ISO
    notes: string | null;
  };
  ceuActivities: CeuActivityRow[];
  reminderConfig: {
    id: string;
    enabled: boolean;
    milestoneDays: number[];
  } | null;
  /**
   * `null` means evidence is restricted for this viewer (STAFF/VIEWER —
   * audit #21 MN-6). The EvidencePanel renders a "Restricted" placeholder
   * instead of the upload + download list.
   */
  initialEvidence: EvidenceItem[] | null;
}

export function CredentialDetail({
  canManage,
  credentialId,
  credentialType,
  credential,
  ceuActivities,
  reminderConfig,
  initialEvidence,
}: CredentialDetailProps) {
  return (
    <div className="space-y-6">
      {/* ── Credential metadata (with Edit / Renew / Retire) ──────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <CredentialMetadataPanel
            credentialId={credentialId}
            canManage={canManage}
            value={credential}
            renewalPeriodDays={credentialType.renewalPeriodDays}
          />
        </CardContent>
      </Card>

      {/* ── Evidence ─────────────────────────────────────────────────── */}
      <EvidencePanel
        canManage={canManage}
        credentialId={credentialId}
        initialEvidence={initialEvidence}
        requiresEvidenceByDefault={credentialType.requiresEvidenceByDefault}
      />

      {/* ── CEU activities ───────────────────────────────────────────── */}
      <CeuPanel
        canManage={canManage}
        credentialId={credentialId}
        ceuRequirementHours={credentialType.ceuRequirementHours}
        ceuRequirementWindowMonths={credentialType.ceuRequirementWindowMonths}
        ceuActivities={ceuActivities}
      />

      {/* ── Renewal reminders ────────────────────────────────────────── */}
      <ReminderPanel
        credentialId={credentialId}
        reminderConfig={reminderConfig}
        canManage={canManage}
      />
    </div>
  );
}
