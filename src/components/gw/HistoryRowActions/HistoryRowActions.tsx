// src/components/gw/HistoryRowActions/HistoryRowActions.tsx
//
// Audit #15 (2026-04-30): shared Edit / Delete affordance for history-row
// surfaces (Allergy drill log, Allergy equipment check log, Incident OSHA
// outcomes). Just the buttons — each surface owns its own edit-form
// rendering because the editable field set differs per surface.
//
// Pattern matches the audit-#8 RetireButton in CredentialMetadataPanel:
// `window.confirm` for delete, `useTransition` for the pending state,
// inline error rendering on failure.

"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface HistoryRowActionsProps {
  /** Hide the affordance entirely for non-admin viewers. */
  canManage: boolean;
  /** Disable both buttons (e.g. while a parent transition is pending). */
  disabled?: boolean;
  /** Handler for the Edit button. Surface owns the actual edit form. */
  onEdit: () => void;
  /**
   * Handler for the Delete button. Should perform the soft-delete
   * server action; this component handles the confirm + pending state.
   * Throw to surface an error message under the buttons.
   */
  onDelete: () => Promise<void>;
  /** Confirm message — surface-specific so users see what they're deleting. */
  deleteConfirmText: string;
  /** Customizable button labels for surface-specific copy. */
  editLabel?: string;
  deleteLabel?: string;
}

export function HistoryRowActions({
  canManage,
  disabled = false,
  onEdit,
  onDelete,
  deleteConfirmText,
  editLabel = "Edit",
  deleteLabel = "Delete",
}: HistoryRowActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  function handleDelete() {
    if (typeof window !== "undefined" && !window.confirm(deleteConfirmText)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onDelete();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onEdit}
          disabled={disabled || isPending}
          className="h-7 px-2 text-xs"
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
          <span className="ml-1">{editLabel}</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={disabled || isPending}
          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
          <span className="ml-1">{isPending ? "Deleting…" : deleteLabel}</span>
        </Button>
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
