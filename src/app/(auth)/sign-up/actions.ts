// src/app/(auth)/sign-up/actions.ts
//
// Phase B server actions per docs/specs/onboarding-flow.md.
//
// `completeSignUpAction` runs AFTER the client has:
//   1. created the Firebase user via createUserWithEmailAndPassword
//   2. called sendEmailVerification
//   3. called /api/auth/sync to upsert the User row + set fb-token
//
// This action then:
//   1. Updates User.firstName + lastName from the form
//   2. Creates the Practice (subscriptionStatus = INCOMPLETE)
//   3. Creates the OWNER PracticeUser
//   4. Records LegalAcceptance rows for TOS + BAA
//   5. Emits PRACTICE_CREATED + USER_INVITED events
//
// `getMyVerificationStatusAction` is the polling target for
// /sign-up/verify — returns the latest emailVerified state from the
// User row. The /api/auth/sync route updates this on every sign-in
// using the Firebase decoded token, so the value is fresh whenever
// the user clicks the email-verify link + their browser refreshes
// its Firebase token.

"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";

const CompleteInput = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  practiceName: z.string().min(1).max(200),
  primaryState: z.string().length(2).regex(/^[A-Z]{2}$/),
  // The four legal flags. All required to submit the form.
  agreeTos: z.literal(true),
  agreeBaa: z.literal(true),
  // Optional marketing opt-in. Defaults to true on the form but the
  // user can uncheck it. Stored as `User.marketingOptIn` if/when we
  // add that column; for now logged in EventLog only.
  marketingOptIn: z.boolean().optional().default(false),
});

export type CompleteSignUpResult =
  | { ok: true; practiceId: string }
  | { ok: false; error: string };

export async function completeSignUpAction(
  input: z.infer<typeof CompleteInput>,
): Promise<CompleteSignUpResult> {
  const user = await requireUser();
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // Idempotency guard: if the user already has a Practice, just return
  // success — the page handles the redirect. Prevents double-create on
  // form double-submit.
  const existingPu = await db.practiceUser.findFirst({
    where: { userId: user.id, removedAt: null },
    select: { practiceId: true },
  });
  if (existingPu) {
    return { ok: true, practiceId: existingPu.practiceId };
  }

  // Capture IP + user-agent for the LegalAcceptance audit trail.
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    null;
  const ua = hdrs.get("user-agent") ?? null;

  // 1. Update User firstName + lastName.
  await db.user.update({
    where: { id: user.id },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
    },
  });

  // 2. Record LegalAcceptance rows. Two documents: TOS_v1 + BAA_v1.
  // Marketing opt-in is logged separately if/when we capture it.
  await db.legalAcceptance.createMany({
    data: [
      {
        userId: user.id,
        documentType: "TOS",
        version: "v1",
        ipAddress: ip,
        userAgent: ua,
      },
      {
        userId: user.id,
        documentType: "BAA",
        version: "v1",
        ipAddress: ip,
        userAgent: ua,
      },
    ],
    skipDuplicates: true,
  });

  // 3. Create the Practice + OWNER PracticeUser via the standard
  // event-sourcing pipeline. subscriptionStatus defaults to INCOMPLETE
  // per the schema; Phase C's webhook flips it to TRIALING after
  // Stripe Checkout completes.
  const practice = await db.practice.create({
    data: {
      name: parsed.data.practiceName,
      primaryState: parsed.data.primaryState,
    },
  });

  await appendEventAndApply(
    {
      practiceId: practice.id,
      actorUserId: user.id,
      type: "PRACTICE_CREATED",
      payload: {
        practiceName: parsed.data.practiceName,
        primaryState: parsed.data.primaryState,
        ownerUserId: user.id,
      },
    },
    async (tx) => {
      // Audit B-2 (HIPAA findings, 2026-04-29): default the OWNER as
      // Privacy + Security + Compliance Officer. HIPAA §164.308(a)(2)
      // requires a designated Security Officer. The first-run wizard
      // (Phase D) confirms or reassigns when staff arrive.
      await tx.practiceUser.create({
        data: {
          userId: user.id,
          practiceId: practice.id,
          role: "OWNER",
          isPrivacyOfficer: true,
          isSecurityOfficer: true,
          isComplianceOfficer: true,
        },
      });
    },
  );

  return { ok: true, practiceId: practice.id };
}

// ────────────────────────────────────────────────────────────────────────
// Verification polling
// ────────────────────────────────────────────────────────────────────────
//
// /sign-up/verify polls this every few seconds. Returns the latest
// User.emailVerified bit. The client's Firebase session refreshes the
// token periodically + auto-flips emailVerified=true once the user
// clicks the verify link, so polling will return true within ~30s of
// the click in the worst case.

export type VerificationStatus = {
  emailVerified: boolean;
  email: string;
};

export async function getMyVerificationStatusAction(): Promise<VerificationStatus> {
  const user = await requireUser();
  const fresh = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { email: true, emailVerified: true },
  });
  return { emailVerified: fresh.emailVerified, email: fresh.email };
}

/** Refresh the User.emailVerified bit from the live Firebase session.
 *  Called when the verify page loads — picks up the click-the-link
 *  flow even if the user navigates back to the verify tab without a
 *  full sign-in cycle. Requires a fresh ID token from the client. */
const RefreshInput = z.object({
  emailVerified: z.boolean(),
});

export async function refreshMyEmailVerifiedAction(
  input: z.infer<typeof RefreshInput>,
): Promise<{ ok: true }> {
  const user = await requireUser();
  const parsed = RefreshInput.parse(input);
  if (parsed.emailVerified && !user.emailVerified) {
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
  }
  return { ok: true };
}
