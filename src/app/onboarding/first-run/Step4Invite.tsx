// src/app/onboarding/first-run/Step4Invite.tsx
"use client";

import { Button } from "@/components/ui/button";
import { BulkInviteForm } from "@/components/gw/BulkInviteForm";
import { bulkInviteAction } from "@/app/(dashboard)/programs/staff/bulk-invite/actions";

export interface Step4InviteProps {
  onComplete: () => void;
}

export function Step4Invite({ onComplete }: Step4InviteProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 4 · 2 minutes (or skip)
        </p>
        <h2 className="text-xl font-semibold">Invite your team</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add the rest of your staff so they can take training and acknowledge
          policies. Skip for now if you want to roll this out quietly.
        </p>
      </div>
      <BulkInviteForm
        onSubmit={(rows) => bulkInviteAction({ rows })}
        onSkip={onComplete}
        submitLabel="Send invites"
        skipLabel="Skip for now — I'll invite later"
      />
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onComplete}>
          I'm done with invites → finish
        </Button>
      </div>
    </div>
  );
}
