// src/app/(dashboard)/programs/staff/InviteMemberForm.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { inviteTeamMemberAction } from "./invitation-actions";

type Role = "ADMIN" | "STAFF" | "VIEWER";

export function InviteMemberForm({ canInvite }: { canInvite: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("STAFF");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canInvite) {
    return (
      <p className="text-xs text-muted-foreground">
        Only owners and admins can invite team members.
      </p>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await inviteTeamMemberAction({
          email: email.trim(),
          role,
        });
        setEmail("");
        setNotice(
          res.emailDelivered
            ? `Invitation sent. It expires in 7 days.`
            : `Invitation created (email delivery disabled: ${res.emailReason ?? "no email provider"}). Share the accept link from the pending list below.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invite failed");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 space-y-1 text-xs font-medium text-foreground">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-foreground">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="VIEWER">Viewer</option>
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Inviting…" : "Send invite"}
        </Button>
      </div>
      {notice && (
        <p className="text-xs text-[color:var(--gw-color-compliant)]">{notice}</p>
      )}
      {error && (
        <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
      )}
    </form>
  );
}
