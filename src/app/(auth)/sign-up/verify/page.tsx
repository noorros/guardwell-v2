// src/app/(auth)/sign-up/verify/page.tsx
//
// Phase B verify page per docs/specs/onboarding-flow.md Screen 3.
//
// Holding screen between sign-up form submission and the next step
// in the onboarding flow. Polls every 5s for User.emailVerified.
// When verified, advances to the next step (which is /onboarding/
// compliance-profile until Phase C ships /sign-up/payment).
//
// Resend button calls Firebase sendEmailVerification with a 60s
// cooldown so we don't get rate-limited by Firebase.

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sendEmailVerification, reload } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase";
import { Logo } from "@/components/gw/Logo";
import {
  getMyVerificationStatusAction,
  refreshMyEmailVerifiedAction,
} from "../actions";

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const promo = params.get("promo");

  const [email, setEmail] = useState<string>("");
  const [verified, setVerified] = useState<boolean>(false);
  const [resendCooldownEndsAt, setResendCooldownEndsAt] = useState<number>(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendOk, setResendOk] = useState<boolean>(false);
  const [polling, setPolling] = useState<boolean>(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Where do we go once verified? For now, compliance-profile (the
  // existing step 2 of onboarding). Phase C will insert /sign-up/payment
  // here. We carry the promo through the URL so it survives the hop.
  const nextHref =
    `/onboarding/compliance-profile${promo ? `?promo=${encodeURIComponent(promo)}` : ""}` as `/onboarding/compliance-profile`;

  // Poll the server for the latest emailVerified state. Five-second
  // cadence; stops once verified.
  useEffect(() => {
    let mounted = true;

    async function tick() {
      try {
        // 1. Refresh Firebase's local user state — this is what flips
        // emailVerified=true after the user clicks the verify link in
        // their email tab.
        if (firebaseAuth.currentUser) {
          await reload(firebaseAuth.currentUser);
          // 2. If Firebase says verified, push that fact into our DB
          // so the polling check returns true on the next round.
          if (firebaseAuth.currentUser.emailVerified) {
            await refreshMyEmailVerifiedAction({ emailVerified: true });
          }
        }
        // 3. Read the latest status from the server.
        const status = await getMyVerificationStatusAction();
        if (!mounted) return;
        setEmail(status.email);
        if (status.emailVerified) {
          setVerified(true);
          setPolling(false);
          if (intervalRef.current) clearInterval(intervalRef.current);
          // Brief celebration moment before redirecting.
          setTimeout(() => router.push(nextHref), 1500);
        }
      } catch {
        // Silent — we'll retry on the next tick. Probably the user has
        // an expired Firebase token; signing in again will re-trigger
        // /api/auth/sync which re-sets the cookie.
      }
    }

    void tick();
    intervalRef.current = setInterval(tick, 5000);
    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [router, nextHref]);

  async function handleResend() {
    setResendError(null);
    setResendOk(false);
    if (Date.now() < resendCooldownEndsAt) return;
    if (!firebaseAuth.currentUser) {
      setResendError(
        "Your session expired. Sign in again to resend the verification email.",
      );
      return;
    }
    try {
      await sendEmailVerification(firebaseAuth.currentUser, {
        url:
          typeof window !== "undefined"
            ? `${window.location.origin}/sign-up/verify?verified=1${promo ? `&promo=${encodeURIComponent(promo)}` : ""}`
            : "https://v2.app.gwcomp.com/sign-up/verify?verified=1",
        handleCodeInApp: false,
      });
      setResendOk(true);
      setResendCooldownEndsAt(Date.now() + 60_000);
    } catch (err) {
      setResendError(
        err instanceof Error ? err.message : "Failed to resend email",
      );
    }
  }

  const cooldownSecs = Math.max(
    0,
    Math.ceil((resendCooldownEndsAt - Date.now()) / 1000),
  );

  return (
    <div className="w-full max-w-md space-y-5 rounded-xl bg-white p-8 shadow">
      <Logo className="flex justify-center" height={36} />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">
          {verified ? "Verified — let's go!" : "Check your email"}
        </h1>
        {!verified && (
          <p className="text-sm text-slate-500">
            We sent a verification link to{" "}
            <strong className="font-semibold text-slate-700">
              {email || "your inbox"}
            </strong>
            . Click it to continue.
          </p>
        )}
        {verified && (
          <p className="text-sm text-emerald-700">
            Email verified. Loading the next step…
          </p>
        )}
      </div>

      {!verified && (
        <>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold">Didn&apos;t get the email?</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Check your spam / promotions folder</li>
              <li>
                Make sure {email || "the email"} is the address you actually
                use
              </li>
              <li>The link can take up to 1 minute to arrive</li>
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldownSecs > 0}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cooldownSecs > 0
                ? `Resend in ${cooldownSecs}s`
                : "Resend verification email"}
            </button>
            {resendOk && (
              <p className="text-center text-xs text-emerald-700">
                Sent. Check your inbox in ~30 seconds.
              </p>
            )}
            {resendError && (
              <p className="text-center text-xs text-red-700">{resendError}</p>
            )}
          </div>
          <p className="text-center text-[11px] text-slate-400">
            {polling ? "Auto-checking every 5 seconds…" : ""}
          </p>
        </>
      )}

      <p className="border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
        Wrong address?{" "}
        <a href="/sign-out" className="text-blue-700 underline hover:no-underline">
          Sign out
        </a>{" "}
        and start over.
      </p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Suspense
        fallback={<div className="text-sm text-slate-500">Loading…</div>}
      >
        <VerifyInner />
      </Suspense>
    </div>
  );
}
