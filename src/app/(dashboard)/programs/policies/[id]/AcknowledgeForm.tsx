// src/app/(dashboard)/programs/policies/[id]/AcknowledgeForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { acknowledgePolicyAction } from "../actions";

export interface AcknowledgeFormProps {
  practicePolicyId: string;
  policyTitle: string;
  policyVersion: number;
  // Already-acked status for the CURRENT version of this policy.
  alreadyAcknowledged: boolean;
  acknowledgedAt: string | null;
  // Required course codes the user must have completed first. Empty
  // array = no prereqs; user can sign right away.
  prerequisites: Array<{
    courseCode: string;
    courseTitle: string;
    completed: boolean;
  }>;
  defaultSignature: string;
}

export function AcknowledgeForm({
  practicePolicyId,
  policyTitle,
  policyVersion,
  alreadyAcknowledged,
  acknowledgedAt,
  prerequisites,
  defaultSignature,
}: AcknowledgeFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [signature, setSignature] = useState(defaultSignature);
  const [error, setError] = useState<string | null>(null);

  const incompletePrereqs = prerequisites.filter((p) => !p.completed);
  const canSign = incompletePrereqs.length === 0 && !alreadyAcknowledged;

  const handleSubmit = () => {
    setError(null);
    if (!signature.trim()) {
      setError("Signature is required.");
      return;
    }
    startTransition(async () => {
      try {
        await acknowledgePolicyAction({
          practicePolicyId,
          signatureText: signature.trim(),
        });
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to acknowledge");
      }
    });
  };

  if (alreadyAcknowledged) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 p-4">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-[color:var(--gw-color-compliant)]"
            aria-hidden="true"
          />
          <div className="flex-1 space-y-0.5">
            <p className="text-sm font-semibold text-foreground">
              You've acknowledged v{policyVersion}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Signed{" "}
              {acknowledgedAt
                ? new Date(acknowledgedAt).toISOString().slice(0, 16).replace("T", " ")
                : ""}
              . If the policy is edited, you'll need to re-sign the new version.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-[color:var(--gw-color-needs)]"
              aria-hidden="true"
            />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Your acknowledgment is required
              </p>
              <p className="text-[11px] text-muted-foreground">
                You haven't signed v{policyVersion} of this policy yet.
                {prerequisites.length > 0 &&
                  ` ${prerequisites.length} prerequisite course${prerequisites.length === 1 ? "" : "s"} required first.`}
              </p>
            </div>
          </div>
          {prerequisites.length > 0 && (
            <ul className="space-y-1.5">
              {prerequisites.map((p) => (
                <li
                  key={p.courseCode}
                  className="flex items-center gap-2 rounded-md border bg-background/50 px-3 py-2 text-xs"
                >
                  {p.completed ? (
                    <CheckCircle2
                      className="h-3 w-3 flex-shrink-0 text-[color:var(--gw-color-compliant)]"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertCircle
                      className="h-3 w-3 flex-shrink-0 text-[color:var(--gw-color-needs)]"
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex-1 truncate text-foreground">
                    {p.courseTitle}
                  </span>
                  {!p.completed && (
                    <Link
                      href={"/programs/training" as Route}
                      className="text-[10px] text-foreground underline hover:no-underline"
                    >
                      Take course →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={!canSign}
          >
            {canSign
              ? "Acknowledge policy →"
              : "Complete prerequisites first"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const errorId = "ack-signature-error";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">
          Sign acknowledgment for {policyTitle} v{policyVersion}
        </h3>
        <p className="text-[11px] text-muted-foreground">
          By typing your name below and clicking Sign, you attest that you've
          read this policy and understand your obligations under it.
        </p>
        <div className="space-y-1">
          <label
            htmlFor="ack-signature"
            className="block text-xs font-medium text-foreground"
          >
            Type your full name + signature attestation{" "}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id="ack-signature"
            rows={3}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
        {error && (
          <p
            id={errorId}
            role="alert"
            className="text-xs text-[color:var(--gw-color-risk)]"
          >
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !signature.trim()}
          >
            {isPending ? "Signing…" : "Sign acknowledgment"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
