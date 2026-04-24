"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleOfficerAction } from "@/app/(dashboard)/programs/staff/actions";

export interface Step1OfficersProps {
  owner: { practiceUserId: string; userId: string; displayName: string };
  onComplete: () => void;
}

export function Step1Officers({ owner, onComplete }: Step1OfficersProps) {
  const [privacyDone, setPrivacyDone] = useState(false);
  const [securityDone, setSecurityDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleToggle = (role: "PRIVACY" | "SECURITY") => {
    setError(null);
    startTransition(async () => {
      try {
        await toggleOfficerAction({
          practiceUserId: owner.practiceUserId,
          officerRole: role,
          designated: true,
        });
        if (role === "PRIVACY") setPrivacyDone(true);
        else setSecurityDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  const bothDone = privacyDone && securityDone;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 1 · 90 seconds
        </p>
        <h2 className="text-xl font-semibold">Designate yourself as Privacy + Security Officer</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          HIPAA requires every practice to name both a Privacy Officer and a Security
          Officer. As the owner, you'll fill both roles until you delegate them later.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <OfficerCard
          label="Privacy Officer"
          citation="HIPAA §164.530(a)(1)"
          name={owner.displayName}
          confirmed={privacyDone}
          disabled={isPending}
          onConfirm={() => handleToggle("PRIVACY")}
        />
        <OfficerCard
          label="Security Officer"
          citation="HIPAA §164.308(a)(2)"
          name={owner.displayName}
          confirmed={securityDone}
          disabled={isPending}
          onConfirm={() => handleToggle("SECURITY")}
        />
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={onComplete} disabled={!bothDone}>
          Continue → Privacy Policy
        </Button>
      </div>
    </div>
  );
}

function OfficerCard({
  label,
  citation,
  name,
  confirmed,
  disabled,
  onConfirm,
}: {
  label: string;
  citation: string;
  name: string;
  confirmed: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-4 transition ${
        confirmed ? "border-emerald-500 bg-emerald-50" : "bg-background"
      }`}
    >
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{citation}</p>
      <p className="mt-3 text-sm">{name}</p>
      <Button
        type="button"
        variant={confirmed ? "secondary" : "default"}
        size="sm"
        className="mt-3 w-full"
        onClick={onConfirm}
        disabled={disabled || confirmed}
        aria-pressed={confirmed}
      >
        {confirmed ? "✓ Designated" : `I'll be the ${label}`}
      </Button>
    </div>
  );
}
