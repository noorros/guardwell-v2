// src/app/(auth)/sign-up/payment/PaymentInner.tsx
"use client";

import { useState } from "react";
import { Logo } from "@/components/gw/Logo";
import { PayButton } from "./PayButton";

const MONTHLY_PRICE = 249;
const ANNUAL_PRICE_PER_MONTH = 199;
const ANNUAL_TOTAL = 199 * 12;

const FEATURES = [
  "HIPAA + OSHA + OIG + CMS + DEA + CLIA + MACRA + TCPA frameworks",
  "130+ policy templates with editor + version history",
  "36 staff training courses with quiz tracking",
  "Per-user policy acknowledgment workflow",
  "Audit-prep wizard for HHS OCR · OSHA · CMS · DEA",
  "Cyber readiness score + drill logging",
  "Compliance calendar across all deadlines",
  "AI Concierge for any compliance question",
];

export interface PaymentInnerProps {
  practiceName: string;
  promoBanner: {
    code: string;
    label: string;
    isHundredOff: boolean;
  } | null;
  promoParam: string | null;
}

export function PaymentInner({
  practiceName,
  promoBanner,
  promoParam,
}: PaymentInnerProps) {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");

  const annualSavings = MONTHLY_PRICE * 12 - ANNUAL_TOTAL;

  return (
    <div className="w-full max-w-md space-y-5 rounded-xl bg-white p-8 shadow">
      <Logo className="flex justify-center" height={36} />

      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold text-slate-900">
          {promoBanner?.isHundredOff
            ? "Activate your free account"
            : "Start your 7-day free trial"}
        </h1>
        <p className="text-sm text-slate-500">
          {promoBanner?.isHundredOff
            ? `For ${practiceName}. No card required.`
            : `For ${practiceName}. Cancel anytime in the first 7 days — no charge.`}
        </p>
      </div>

      {promoBanner && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">
          <strong>Promo applied:</strong> {promoBanner.label}
        </div>
      )}

      {/* Pricing toggle (hidden when 100%-off promo is applied since the
          interval choice doesn't affect what's owed) */}
      {!promoBanner?.isHundredOff && (
        <div
          role="radiogroup"
          aria-label="Billing interval"
          className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={interval === "monthly"}
            onClick={() => setInterval("monthly")}
            className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              interval === "monthly"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <div>Monthly</div>
            <div className="text-base font-semibold">${MONTHLY_PRICE}</div>
            <div className="text-[10px] font-normal text-slate-500">per month</div>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={interval === "annual"}
            onClick={() => setInterval("annual")}
            className={`relative rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              interval === "annual"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <div>Annual</div>
            <div className="text-base font-semibold">
              ${ANNUAL_PRICE_PER_MONTH}
              <span className="text-[10px] font-normal text-slate-500">
                /mo
              </span>
            </div>
            <div className="text-[10px] font-medium text-emerald-700">
              save ${annualSavings}/yr
            </div>
          </button>
        </div>
      )}

      {/* Feature recap */}
      <ul className="space-y-1 rounded-md bg-slate-50 p-3 text-[11px] text-slate-700">
        {FEATURES.map((f) => (
          <li key={f} className="flex items-start gap-1.5">
            <span aria-hidden="true" className="text-emerald-600">
              ✓
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <PayButton
        billingInterval={interval}
        promoCode={promoParam ?? undefined}
        promoIsHundredOff={!!promoBanner?.isHundredOff}
      />

      <p className="text-center text-[10px] text-slate-400">
        HIPAA-aligned · SOC 2 Type II in progress · BAA already signed
      </p>
    </div>
  );
}
