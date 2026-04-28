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

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDownloadUrl } from "@/lib/storage/evidence";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (tokenRow.revokedAt || tokenRow.expiresAt.getTime() < Date.now()) {
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
