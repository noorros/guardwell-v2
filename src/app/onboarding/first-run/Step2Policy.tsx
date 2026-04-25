"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { adoptPolicyAction } from "@/app/(dashboard)/programs/policies/actions";

export interface Step2PolicyProps {
  // Optional template body to preview before adopting. If null, we still
  // adopt the core HIPAA_PRIVACY_POLICY code via adoptPolicyAction (no
  // PolicyTemplate row required) — the user can edit the body later.
  templateBody: string | null;
  onComplete: () => void;
}

const FALLBACK_PREVIEW = `This Privacy Policy describes how the practice collects, uses, and discloses Protected Health Information (PHI) in accordance with the HIPAA Privacy Rule (45 CFR Part 164).

You'll be able to customize the full policy body in My Programs › Policies after adoption. The starter content covers:

  · Permitted uses and disclosures of PHI
  · Patient rights (access, amendment, accounting of disclosures)
  · Minimum-necessary standard
  · Workforce training and sanctions
  · Notice of Privacy Practices distribution
  · Complaint procedures

Adopting now satisfies the HIPAA §164.530(i) policies-and-procedures requirement and unlocks downstream evidence types.`;

export function Step2Policy({ templateBody, onComplete }: Step2PolicyProps) {
  const [adopted, setAdopted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const previewBody = templateBody ?? FALLBACK_PREVIEW;

  const handleAdopt = () => {
    setError(null);
    startTransition(async () => {
      try {
        await adoptPolicyAction({ policyCode: "HIPAA_PRIVACY_POLICY" });
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
          Every practice needs a Privacy Policy. We&apos;ll start you with a
          HIPAA-compliant baseline — edit it anytime in My Programs › Policies.
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-4 text-xs">
        <pre className="whitespace-pre-wrap font-sans text-foreground">
          {previewBody}
        </pre>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={handleAdopt}
          disabled={adopted || isPending}
        >
          {adopted ? "✓ Adopted" : isPending ? "Adopting…" : "Adopt Privacy Policy"}
        </Button>
        <Button onClick={onComplete} disabled={!adopted}>
          Continue → HIPAA training
        </Button>
      </div>
    </div>
  );
}
