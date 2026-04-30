// src/app/accept-baa/[token]/actions.ts
//
// Public, no-auth server action invoked from the AcceptBaaForm. Token
// possession is the authorization. Re-validates the token + BaaRequest
// state, captures IP + user-agent for the e-signature record, then
// emits BAA_EXECUTED_BY_VENDOR.
//
// Hardening (audit #21 Wave 4 D3, 2026-04-30):
//   * C-4 rate-limit: 10 attempts per 5 minutes per IP via
//     assertBaaTokenRateLimit. Same Upstash pattern as the AI
//     assess / Concierge limiters.
//   * M-5 rejection logging: every refused token attempt — whether
//     unknown, revoked, expired, consumed, mismatched, or rate-limited
//     — produces a BAA_TOKEN_REJECTED event row (or console.warn for
//     unknown tokens with no resolvable practiceId).
//   * M-4 revalidatePath("/modules/hipaa") — module page reflects the
//     EXECUTED transition immediately.

"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectBaaExecutedByVendor } from "@/lib/events/projections/baa";
import { assertBaaTokenRateLimit } from "@/lib/baa/rateLimit";
import { extractClientIp } from "@/lib/baa/tokenAudit";
import {
  logRejectedKnownToken,
  logRejectedUnknownToken,
  type BaaTokenRejectReason,
} from "@/lib/baa/logRejected";

const ExecuteInput = z.object({
  token: z.string().min(1).max(200),
  baaRequestId: z.string().min(1),
  tokenId: z.string().min(1),
  vendorSignatureName: z.string().min(2).max(200),
  vendorEmail: z.string().email(),
});

export async function executeBaaAction(
  input: z.infer<typeof ExecuteInput>,
): Promise<void> {
  const parsed = ExecuteInput.parse(input);

  // Capture IP + user agent UP FRONT so rate-limit + rejection logs
  // share the same forensic context.
  const hdrs = await headers();
  const ip = extractClientIp(hdrs);
  const userAgent = hdrs.get("user-agent");

  // Rate-limit BEFORE any DB I/O so a flood doesn't burn Postgres.
  // 10 attempts per 5 minutes per IP. Matches the same Upstash
  // soft-skip pattern as src/lib/ai/rateLimit.ts (UPSTASH_DISABLE=1
  // in tests / CI).
  try {
    await assertBaaTokenRateLimit(ip);
  } catch (err) {
    // Best-effort log of the 429-ish event so platform can detect
    // enumeration. We don't know the practiceId here yet, so this
    // path falls back to console.warn.
    logRejectedUnknownToken({
      token: parsed.token,
      ip,
      userAgent,
    });
    throw err;
  }

  // Re-fetch the token + BaaRequest. NO auth — token is the authz.
  const tokenRow = await db.baaAcceptanceToken.findUnique({
    where: { token: parsed.token },
    include: {
      baaRequest: {
        select: {
          id: true,
          practiceId: true,
          status: true,
          recipientEmail: true,
        },
      },
    },
  });
  if (!tokenRow) {
    logRejectedUnknownToken({ token: parsed.token, ip, userAgent });
    throw new Error("Invalid link");
  }

  const reject = async (
    reason: BaaTokenRejectReason,
    message: string,
  ): Promise<never> => {
    await logRejectedKnownToken({
      practiceId: tokenRow.baaRequest.practiceId,
      baaRequestId: tokenRow.baaRequest.id,
      tokenId: tokenRow.id,
      token: parsed.token,
      reason,
      ip,
      userAgent,
    });
    throw new Error(message);
  };

  if (tokenRow.id !== parsed.tokenId) await reject("ID_MISMATCH", "Token mismatch");
  if (tokenRow.baaRequest.id !== parsed.baaRequestId) {
    await reject("ID_MISMATCH", "Request mismatch");
  }
  if (tokenRow.revokedAt) await reject("REVOKED", "Link revoked");
  if (tokenRow.expiresAt.getTime() < Date.now()) {
    await reject("EXPIRED", "Link expired");
  }
  if (tokenRow.consumedAt) await reject("ALREADY_CONSUMED", "Link already used");
  if (
    tokenRow.baaRequest.status !== "SENT" &&
    tokenRow.baaRequest.status !== "ACKNOWLEDGED"
  ) {
    await reject(
      "STATUS_CLOSED",
      "BAA is no longer accepting signatures",
    );
  }

  // Validate the typed email matches the recipient (case-insensitive)
  // when the original send recorded one.
  if (
    tokenRow.baaRequest.recipientEmail &&
    parsed.vendorEmail.toLowerCase() !==
      tokenRow.baaRequest.recipientEmail.toLowerCase()
  ) {
    await reject(
      "EMAIL_MISMATCH",
      "The email you entered does not match the email this BAA was sent to.",
    );
  }

  const executedAt = new Date().toISOString();
  const payload = {
    baaRequestId: parsed.baaRequestId,
    tokenId: parsed.tokenId,
    executedAt,
    vendorSignatureName: parsed.vendorSignatureName,
    vendorSignatureIp: ip,
    vendorSignatureUserAgent: userAgent,
    // v1: no expiry collected at sign time. Most BAAs are "evergreen".
    // The practice can set baaExpiresAt manually later if needed.
    expiresAt: null,
  };

  await appendEventAndApply(
    {
      practiceId: tokenRow.baaRequest.practiceId,
      actorUserId: null, // public; no GuardWell actor
      type: "BAA_EXECUTED_BY_VENDOR",
      payload,
      // Idempotency key tied to the tokenId — prevents double-execute on
      // form re-submit / browser back-button replays.
      idempotencyKey: `baa-execute-${parsed.tokenId}`,
    },
    async (tx) =>
      projectBaaExecutedByVendor(tx, {
        practiceId: tokenRow.baaRequest.practiceId,
        payload,
      }),
  );

  // Reflect the new vendor.baaExecutedAt + EXECUTED status on the
  // dashboard module page on next nav. Audit #21 M-4 (2026-04-30).
  revalidatePath("/modules/hipaa");
  revalidatePath("/programs/vendors");

  // Reload the page so the page-level guard now renders SuccessState.
  redirect(`/accept-baa/${parsed.token}` as Route);
}
