// src/app/(dashboard)/programs/credentials/CredentialActions.tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { removeCredentialAction } from "./actions";

export interface CredentialActionsProps {
  credentialId: string;
}

export function CredentialActions({ credentialId }: CredentialActionsProps) {
  const [isPending, startTransition] = useTransition();

  const handleRemove = () => {
    // Audit #21 / Credentials MN-1: confirm before retiring. Matches the
    // pattern in CredentialMetadataPanel.RetireButton + HistoryRowActions —
    // a stray click on a list-row "Remove" should not silently retire a
    // credential. Native window.confirm here is consistent with the rest
    // of the codebase; replacing with a styled Dialog is tracked
    // separately (Allergy IM-12).
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Retire this credential? It stays in the audit log but stops counting toward your framework score.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await removeCredentialAction({ credentialId });
      } catch (err) {
        console.error("removeCredentialAction failed", err);
      }
    });
  };

  return (
    <Button size="sm" variant="ghost" onClick={handleRemove} disabled={isPending}>
      Remove
    </Button>
  );
}
