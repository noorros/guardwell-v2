"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { adoptPolicyFromTemplateAction } from "@/app/(dashboard)/programs/policies/actions";

export interface Step2PolicyProps {
  template: { code: string; title: string; bodyMarkdown: string } | null;
  onComplete: () => void;
}

export function Step2Policy({ template, onComplete }: Step2PolicyProps) {
  const [adopted, setAdopted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!template) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Privacy policy template missing from the catalog. Contact support.
        </p>
        <Button onClick={onComplete} variant="ghost">
          Skip this step
        </Button>
      </div>
    );
  }

  const handleAdopt = () => {
    setError(null);
    startTransition(async () => {
      try {
        await adoptPolicyFromTemplateAction({ templateCode: template.code });
        setAdopted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Adoption failed");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 2 · 3 minutes
        </p>
        <h2 className="text-xl font-semibold">Adopt your HIPAA Privacy Policy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every practice needs a Privacy Policy. We'll start you with our
          HIPAA-compliant template — you can edit it anytime in My Programs › Policies.
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-4 text-xs">
        <pre className="whitespace-pre-wrap font-sans text-foreground">
          {template.bodyMarkdown}
        </pre>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={handleAdopt}
          disabled={adopted || isPending}
        >
          {adopted ? "✓ Adopted" : isPending ? "Adopting…" : "Adopt template"}
        </Button>
        <Button onClick={onComplete} disabled={!adopted}>
          Continue → HIPAA training
        </Button>
      </div>
    </div>
  );
}
