// src/app/(dashboard)/programs/allergy/CompetencyTab/AttestDialog.tsx
//
// Shared attestation dialog for fingertip + media-fill tests. Extracted
// from CompetencyTab.tsx (audit #21 MIN-8, Wave-4 D4).

"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export interface AttestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onSubmit: (notes: string) => Promise<void>;
}

export function AttestDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
}: AttestDialogProps) {
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await onSubmit(notes);
        setNotes("");
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "An error occurred. Please try again.");
      }
    });
  }

  function handleOpenChange(next: boolean) {
    if (!isPending) {
      if (!next) {
        setNotes("");
        setError(null);
      }
      onOpenChange(next);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="space-y-1.5">
          <label htmlFor="attest-notes" className="text-sm font-medium">
            Notes <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            id="attest-notes"
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Supervisor observations, kit used, batch number…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isPending}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        <DialogFooter showCloseButton>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : "Record Pass"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
