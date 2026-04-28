// src/app/accept-baa/[token]/actions.ts
//
// Public, no-auth server action invoked from the AcceptBaaForm. Token
// possession is the authorization. Re-validates the token + BaaRequest
// state, captures IP + user-agent for the e-signature record, then
// emits BAA_EXECUTED_BY_VENDOR.

"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { db } from "@/lib/db";
import { appendEventAndApply } from "@/lib/events";
import { projectBaaExecutedByVendor } from "@/lib/events/projections/baa";

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
  if (!tokenRow) throw new Error("Invalid link");
  if (tokenRow.id !== parsed.tokenId) throw new Error("Token mismatch");
  if (tokenRow.baaRequest.id !== parsed.baaRequestId) {
    throw new Error("Request mismatch");
  }
  if (tokenRow.revokedAt) throw new Error("Link revoked");
  if (tokenRow.expiresAt.getTime() < Date.now()) {
    throw new Error("Link expired");
  }
  if (tokenRow.consumedAt) throw new Error("Link already used");
  if (
    tokenRow.baaRequest.status !== "SENT" &&
    tokenRow.baaRequest.status !== "ACKNOWLEDGED"
  ) {
    throw new Error("BAA is no longer accepting signatures");
  }

  // Validate the typed email matches the recipient (case-insensitive)
  // when the original send recorded one.
  if (
    tokenRow.baaRequest.recipientEmail &&
    parsed.vendorEmail.toLowerCase() !==
      tokenRow.baaRequest.recipientEmail.toLowerCase()
  ) {
    throw new Error(
      "The email you entered does not match the email this BAA was sent to.",
    );
  }

  // Capture IP + user agent for the e-signature record.
  const hdrs = await headers();
  const xForwardedFor = hdrs.get("x-forwarded-for") ?? "";
  const xRealIp = hdrs.get("x-real-ip") ?? "";
  const ip = xForwardedFor.split(",")[0]?.trim() || xRealIp || null;
  const userAgent = hdrs.get("user-agent") ?? null;

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

  // Reload the page so the page-level guard now renders SuccessState.
  redirect(`/accept-baa/${parsed.token}` as Route);
}
