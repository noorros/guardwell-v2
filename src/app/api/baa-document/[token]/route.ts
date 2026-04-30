// src/app/api/baa-document/[token]/route.ts
//
// Public, token-protected download for the BAA draft document. The
// token IS the authorization — same model as /accept-baa/[token]. The
// existing /api/evidence/[id]/download requires getPracticeUser, which
// vendors can't satisfy.
//
// Lookup flow:
//   1. Look up the BaaAcceptanceToken by the URL token.
//   2. Verify the token is not revoked + not expired. (Consumed tokens
//      for EXECUTED/REJECTED BAAs CAN still download — preserves the
//      vendor's audit copy.)
//   3. Issue a 5-minute signed GCS URL via getDownloadUrl (scoped to
//      the practice the BaaRequest belongs to — token's practiceId is
//      load-bearing here for cross-tenant safety).
//   4. 302-redirect the browser directly to GCS.
//
// Audit #21 C-4 + M-5 (2026-04-30): rate-limit + rejected-attempt
// logging on this surface mirror the /accept-baa/[token] page hardening.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getDownloadUrl } from "@/lib/storage/evidence";
import { assertBaaTokenRateLimit } from "@/lib/baa/rateLimit";
import { extractClientIp } from "@/lib/baa/tokenAudit";
import {
  logRejectedKnownToken,
  logRejectedUnknownToken,
} from "@/lib/baa/logRejected";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const hdrs = await headers();
  const ip = extractClientIp(hdrs);
  const userAgent = hdrs.get("user-agent");

  // 10 attempts / 5 min per IP. Soft-skipped via UPSTASH_DISABLE in tests.
  try {
    await assertBaaTokenRateLimit(ip);
  } catch (err) {
    logRejectedUnknownToken({ token, ip, userAgent });
    const message = err instanceof Error ? err.message : "Rate limited";
    return NextResponse.json({ error: message }, { status: 429 });
  }

  const tokenRow = await db.baaAcceptanceToken.findUnique({
    where: { token },
    include: {
      baaRequest: {
        select: {
          id: true,
          practiceId: true,
          status: true,
          draftEvidenceId: true,
        },
      },
    },
  });
  if (!tokenRow) {
    logRejectedUnknownToken({ token, ip, userAgent });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (tokenRow.revokedAt) {
    await logRejectedKnownToken({
      practiceId: tokenRow.baaRequest.practiceId,
      baaRequestId: tokenRow.baaRequest.id,
      tokenId: tokenRow.id,
      token,
      reason: "REVOKED",
      ip,
      userAgent,
    });
    return NextResponse.json(
      { error: "Link no longer active" },
      { status: 410 },
    );
  }
  if (tokenRow.expiresAt.getTime() < Date.now()) {
    await logRejectedKnownToken({
      practiceId: tokenRow.baaRequest.practiceId,
      baaRequestId: tokenRow.baaRequest.id,
      tokenId: tokenRow.id,
      token,
      reason: "EXPIRED",
      ip,
      userAgent,
    });
    return NextResponse.json(
      { error: "Link no longer active" },
      { status: 410 },
    );
  }
  if (!tokenRow.baaRequest.draftEvidenceId) {
    return NextResponse.json({ error: "No document" }, { status: 404 });
  }

  try {
    const result = await getDownloadUrl({
      practiceId: tokenRow.baaRequest.practiceId,
      evidenceId: tokenRow.baaRequest.draftEvidenceId,
    });
    if (!result.url) {
      return NextResponse.json(
        { error: result.reason ?? "GCS not configured" },
        { status: 503 },
      );
    }
    return NextResponse.redirect(result.url, 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    const status = message === "Evidence not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
