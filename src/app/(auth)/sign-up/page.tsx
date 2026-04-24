// src/app/(auth)/sign-up/page.tsx
//
// Phase B sign-up page per docs/specs/onboarding-flow.md Screen 2.
//
// Single-page form (NOT a wizard). Collects everything we need to
// create the User + Practice in one submit:
//   - Name + work email + password
//   - Practice name + primary state
//   - TOS + BAA acknowledgment (both required)
//   - Marketing opt-in (optional)
//
// Submit flow (client-side):
//   1. Firebase createUserWithEmailAndPassword
//   2. sendEmailVerification with continueUrl back to /sign-up/verify
//   3. POST /api/auth/sync to set fb-token cookie + upsert User row
//   4. completeSignUpAction(serverside) writes firstName/lastName +
//      Practice + OWNER PracticeUser + LegalAcceptance rows
//   5. router.push("/sign-up/verify")

"use client";

import { Suspense, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { Logo } from "@/components/gw/Logo";
import { completeSignUpAction } from "./actions";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
];

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  practiceName: string;
  primaryState: string;
  agreeTos: boolean;
  agreeBaa: boolean;
  marketingOptIn: boolean;
}

const INITIAL: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  practiceName: "",
  primaryState: "",
  agreeTos: false,
  agreeBaa: false,
  marketingOptIn: true,
};

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const promo = params.get("promo");

  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Soft client-side validation. Submit will catch the rest.
  const passwordOk = form.password.length >= 10;
  const passwordHint = form.password
    ? passwordOk
      ? "✓ Strong enough"
      : `${form.password.length} / 10 chars minimum`
    : "Use at least 10 characters";
  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    passwordOk &&
    form.practiceName.trim() &&
    /^[A-Z]{2}$/.test(form.primaryState) &&
    form.agreeTos &&
    form.agreeBaa &&
    !loading;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    let firebaseUserCreated = false;
    try {
      // Step 1 — Firebase sign-up
      const cred = await createUserWithEmailAndPassword(
        firebaseAuth,
        form.email.trim(),
        form.password,
      );
      firebaseUserCreated = true;

      // Step 2 — send verification email with continueUrl back to the
      // verify page (so the click delivers them to a friendly screen)
      await sendEmailVerification(cred.user, {
        url:
          typeof window !== "undefined"
            ? `${window.location.origin}/sign-up/verify?verified=1${promo ? `&promo=${encodeURIComponent(promo)}` : ""}`
            : "https://v2.app.gwcomp.com/sign-up/verify?verified=1",
        handleCodeInApp: false,
      });

      // Step 3 — sync token + upsert User row + set fb-token cookie
      const token = await cred.user.getIdToken();
      const syncRes = await fetch("/api/auth/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!syncRes.ok) throw new Error("auth-sync-failed");

      // Step 4 — server action writes firstName/lastName/Practice/PracticeUser/LegalAcceptance
      const res = await completeSignUpAction({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        practiceName: form.practiceName.trim(),
        primaryState: form.primaryState,
        agreeTos: true,
        agreeBaa: true,
        marketingOptIn: form.marketingOptIn,
      });
      if (!res.ok) throw new Error(res.error);

      // Step 5 — straight to verify (carry promo so it survives the hop)
      const dest = `/sign-up/verify${promo ? `?promo=${encodeURIComponent(promo)}` : ""}`;
      router.push(dest as Route);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-up failed";
      const friendly =
        msg.includes("auth/email-already-in-use") ||
        msg.includes("EMAIL_EXISTS")
          ? "An account with this email already exists. Try signing in instead."
          : msg.includes("auth/weak-password")
            ? "Password is too weak. Use at least 10 characters."
            : msg.includes("auth/invalid-email")
              ? "That email looks invalid."
              : msg;
      setError(friendly);
      setLoading(false);
      // If Firebase user created but server action failed, leave it —
      // user can re-submit and the idempotency guard in
      // completeSignUpAction will reuse the existing user.
      void firebaseUserCreated;
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 shadow"
    >
      <Logo className="flex justify-center" height={36} />
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">
          Start your 7-day free trial
        </h1>
        <p className="text-sm text-slate-500">
          No card charged for 7 days. Cancel anytime in /settings/billing.
        </p>
        {promo && (
          <div className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
            <strong>Promo applied:</strong> {promo} — we&apos;ll carry this
            through to checkout.
          </div>
        )}
      </div>

      {error && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <input
            type="text"
            required
            autoComplete="given-name"
            value={form.firstName}
            onChange={(e) => update("firstName", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Last name">
          <input
            type="text"
            required
            autoComplete="family-name"
            value={form.lastName}
            onChange={(e) => update("lastName", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <Field label="Work email">
        <input
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Password">
        <input
          type="password"
          required
          autoComplete="new-password"
          minLength={10}
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <p
          className={`mt-1 text-[11px] ${passwordOk ? "text-emerald-700" : "text-slate-500"}`}
        >
          {passwordHint}
        </p>
      </Field>

      <Field label="Practice name">
        <input
          type="text"
          required
          maxLength={200}
          autoComplete="organization"
          value={form.practiceName}
          onChange={(e) => update("practiceName", e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Primary state">
        <select
          required
          value={form.primaryState}
          onChange={(e) => update("primaryState", e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Select state…</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      <div className="space-y-2 pt-1">
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            required
            checked={form.agreeTos}
            onChange={(e) => update("agreeTos", e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I agree to the{" "}
            <a
              href="https://gwcomp.com/terms"
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 underline hover:no-underline"
            >
              Terms of Service
            </a>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            required
            checked={form.agreeBaa}
            onChange={(e) => update("agreeBaa", e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I have read + accept the{" "}
            <a
              href="https://gwcomp.com/baa"
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 underline hover:no-underline"
            >
              Business Associate Agreement
            </a>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={form.marketingOptIn}
            onChange={(e) => update("marketingOptIn", e.target.checked)}
            className="mt-0.5"
          />
          <span>Email me product updates (you can unsubscribe anytime)</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Creating account…" : "Create account →"}
      </button>

      <p className="text-center text-xs text-slate-500">
        Already have an account?{" "}
        <a href="/sign-in" className="text-blue-700 underline hover:no-underline">
          Sign in
        </a>
      </p>

      <p className="text-center text-[10px] text-slate-400">
        HIPAA-aligned · SOC 2 Type II in progress · Stripe-secured payment
      </p>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Suspense
        fallback={<div className="text-sm text-slate-500">Loading…</div>}
      >
        <SignUpForm />
      </Suspense>
    </div>
  );
}
