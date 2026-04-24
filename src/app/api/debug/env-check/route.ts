// src/app/api/debug/env-check/route.ts
//
// Returns which billing-relevant env vars are present (keys only,
// NOT values). Used to debug "why is prod 500ing on the
// createCheckoutSessionAction" without leaking secrets.
//
// Gated to platform admins only — even leaking the SET/UNSET state
// of secrets is mild info disclosure.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const KEYS_TO_CHECK = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MONTHLY",
  "STRIPE_PRICE_ANNUAL",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "RESEND_API_KEY",
  "DATABASE_URL",
  "FIREBASE_PRIVATE_KEY",
  "ANTHROPIC_API_KEY",
];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "auth-required" }, { status: 401 });
  }
  const admin = await db.user.findUnique({
    where: { id: user.id },
    select: { isPlatformAdmin: true },
  });
  if (!admin?.isPlatformAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const status: Record<string, { set: boolean; length: number }> = {};
  for (const k of KEYS_TO_CHECK) {
    const v = process.env[k];
    status[k] = { set: !!v, length: v?.length ?? 0 };
  }
  return NextResponse.json({ env: process.env.NODE_ENV ?? "unknown", status });
}
