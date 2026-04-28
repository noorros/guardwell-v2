// src/app/accept-baa/[token]/AcceptBaaForm.tsx
//
// Client component — captures the vendor's typed e-signature, full name,
// and email confirmation. Handed off to executeBaaAction on submit.
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { executeBaaAction } from "./actions";

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface AcceptBaaFormProps {
  token: string;
  baaRequestId: string;
  tokenId: string;
  recipientEmail: string | null;
  practiceName: string;
  vendorName: string;
}

export function AcceptBaaForm({
  token,
  baaRequestId,
  tokenId,
  recipientEmail,
  practiceName,
  vendorName,
}: AcceptBaaFormProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const canSubmit =
    trimmedEmail.length > 0 &&
    trimmedName.length >= 2 &&
    trimmedName.length <= 200 &&
    agreed &&
    !isPending;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await executeBaaAction({
          token,
          baaRequestId,
          tokenId,
          vendorSignatureName: trimmedName,
          vendorEmail: trimmedEmail,
        });
        // executeBaaAction calls redirect() internally; reaching here
        // only happens if the redirect threw — leave the form alone.
      } catch (err) {
        // next/navigation's redirect() throws a special "NEXT_REDIRECT"
        // marker; rethrow so Next can complete the redirect.
        if (err && typeof err === "object" && "digest" in err) {
          const digest = (err as { digest?: string }).digest;
          if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
            throw err;
          }
        }
        setError(err instanceof Error ? err.message : "Sign failed");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">E-signature</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Per HIPAA §164.504(e), {vendorName} agrees that typing a full name
          below constitutes a legally binding electronic signature for this
          Business Associate Agreement with {practiceName}.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="vendor-email"
              className="block text-xs font-medium"
            >
              Your email
            </label>
            <input
              id="vendor-email"
              name="vendor-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD_CLASS}
              placeholder={recipientEmail ?? "you@example.com"}
            />
            {recipientEmail ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Must match{" "}
                <span className="font-medium">{recipientEmail}</span>
                {" "}— the address this BAA was sent to.
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="vendor-signature"
              className="block text-xs font-medium"
            >
              Full legal name
            </label>
            <input
              id="vendor-signature"
              name="vendor-signature"
              type="text"
              required
              minLength={2}
              maxLength={200}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD_CLASS}
              placeholder="Jane Doe"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              This will be recorded as your e-signature.
            </p>
          </div>

          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              I have read and agree to the terms of this Business Associate
              Agreement, and I confirm I am authorized to sign on behalf of{" "}
              <span className="font-medium">{vendorName}</span>.
            </span>
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {isPending ? "Submitting…" : "Sign and execute BAA"}
          </Button>
          {error ? (
            <p className="text-xs text-[color:var(--gw-color-risk)]">{error}</p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
