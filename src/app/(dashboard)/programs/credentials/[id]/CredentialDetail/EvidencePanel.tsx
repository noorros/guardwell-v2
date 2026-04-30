// src/app/(dashboard)/programs/credentials/[id]/CredentialDetail/EvidencePanel.tsx
//
// Evidence-upload panel — extracted from CredentialDetail.tsx (audit #21
// MN-4, Wave-4 D4 file-organization). Pure refactor: no behavior change.
// Honors the audit-#21 MN-6 contract that `initialEvidence === null` is
// the page's signal for "STAFF/VIEWER — restricted" and renders a
// placeholder instead of the upload + list.

"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  EvidenceUpload,
  type EvidenceItem,
} from "@/components/gw/EvidenceUpload";

export interface EvidencePanelProps {
  canManage: boolean;
  credentialId: string;
  /**
   * `null` means evidence is restricted for this viewer (STAFF/VIEWER —
   * audit #21 MN-6). Renders a "Restricted" placeholder instead of the
   * upload + download list.
   */
  initialEvidence: EvidenceItem[] | null;
  /** Whether the credential type expects evidence by default. Drives the
   * inline copy that nudges the user to upload. */
  requiresEvidenceByDefault: boolean;
}

export function EvidencePanel({
  canManage,
  credentialId,
  initialEvidence,
  requiresEvidenceByDefault,
}: EvidencePanelProps) {
  // STAFF/VIEWER receive `initialEvidence === null` from the page —
  // render a "Restricted" placeholder instead of the upload + list.
  // See src/app/(dashboard)/programs/credentials/[id]/page.tsx for
  // the gate (audit #21 MN-6).
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Evidence</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {initialEvidence === null
                ? "Evidence files attached to this credential are restricted to administrators."
                : "Upload a scan of the license, board certification, or any supporting documentation."}
              {initialEvidence !== null && requiresEvidenceByDefault && (
                <>
                  {" "}
                  <span className="font-medium text-foreground">
                    This credential type expects evidence.
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        {initialEvidence !== null ? (
          <EvidenceUpload
            entityType="CREDENTIAL"
            entityId={credentialId}
            initialEvidence={initialEvidence}
            canManage={canManage}
          />
        ) : (
          <p
            className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground"
            data-testid="evidence-restricted"
          >
            Restricted — only practice administrators can view evidence files
            attached to credentials.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
