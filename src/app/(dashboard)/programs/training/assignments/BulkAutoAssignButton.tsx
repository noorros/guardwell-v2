// src/app/(dashboard)/programs/training/assignments/BulkAutoAssignButton.tsx
//
// Phase 4 PR 5 — client wrapper around autoAssignRequiredAction
// (defined in /programs/training/actions.ts). Confirmation pattern
// matches Manage Courses' retire/restore: open AlertDialog, explicit
// Cancel + Confirm, success/error toast in-place.
//
// The action is INSERT-only and idempotent — already-existing
// (course, role) tuples for this practice are skipped, never duplicated.
// The dialog copy makes that explicit so admins don't worry about
// double-assigning by clicking again.

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";
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
import { autoAssignRequiredAction } from "../actions";

type Result = { created: number; skipped: number };

export function BulkAutoAssignButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function onConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    // The default AlertDialogAction click closes the dialog before the
    // pending action resolves — preventDefault keeps it open so we can
    // surface the success or error message in the same dialog body.
    e.preventDefault();
    setErrorMsg(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await autoAssignRequiredAction();
        setResult(r);
        // Refresh the surrounding server component so the grid below
        // reflects the new assignments.
        router.refresh();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  function onOpenChange(next: boolean) {
    // Reset result/error on dialog close so the next open starts clean.
    if (!next) {
      setResult(null);
      setErrorMsg(null);
    }
    setOpen(next);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm">
          <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Auto-Assign required to Team
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Auto-assign required courses</AlertDialogTitle>
          <AlertDialogDescription>
            This will issue a role-wide assignment for every required course
            that is missing one in your practice. The action is insert-only
            and idempotent — existing assignments are skipped, not
            duplicated. You can run it as often as you like.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {result && (
          <div
            role="status"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"
          >
            Created {result.created}, skipped {result.skipped}.
          </div>
        )}
        {errorMsg && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {errorMsg}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {result || errorMsg ? "Close" : "Cancel"}
          </AlertDialogCancel>
          {!result && !errorMsg && (
            <AlertDialogAction onClick={onConfirm} disabled={isPending}>
              {isPending ? "Assigning…" : "Auto-assign"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
