// src/components/gw/HistoryRowActions/HistoryRowActions.tsx
//
// Audit #15 (2026-04-30): shared Edit / Delete affordance for history-row
// surfaces (Allergy drill log, Allergy equipment check log, Incident OSHA
// outcomes). Just the buttons — each surface owns its own edit-form
// rendering because the editable field set differs per surface.
//
// Audit #21 / Allergy IM-12 (2026-04-30): the delete confirm originally used
// the unstyled native `window.confirm()`. Replaced with shadcn AlertDialog
// for accessibility (focus trap + role=alertdialog + screen reader title /
// description), keyboard friendliness (Esc cancels, Tab cycles),
// dark-mode parity, and resistance to accidental Enter-confirm. Same
// pending-state + inline error semantics as before.

"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
  const [open, setOpen] = useState(false);

  if (!canManage) return null;

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        await onDelete();
        // AlertDialog closes itself when AlertDialogAction is clicked
        // (default Radix behavior). Reset state for the next open.
        setOpen(false);
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
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || isPending}
              className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              <span className="ml-1">
                {isPending ? "Deleting…" : deleteLabel}
              </span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm delete</AlertDialogTitle>
              <AlertDialogDescription>{deleteConfirmText}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // Stop AlertDialog's default close-on-click — we close
                  // it ourselves after the transition resolves so the
                  // user sees the pending state.
                  e.preventDefault();
                  handleConfirm();
                }}
                disabled={isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isPending ? "Deleting…" : deleteLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
