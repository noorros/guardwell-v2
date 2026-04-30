// src/lib/baa/logRejected.ts
//
// Records a failed `/accept-baa/[token]` / `/api/baa-document/[token]`
// attempt. Audit #21 M-5 (2026-04-30).
//
// Two paths:
//   * Token resolves to a real BaaRequest → append BAA_TOKEN_REJECTED
//     to the EventLog with hashed token + reason + IP/UA. The event is
//     NOT projected anywhere — it lives as an immutable audit row only.
//   * Token doesn't resolve (true 404) → console.warn. EventLog requires
//     a practiceId we don't have, and indiscriminate writes from public
//     surfaces are also a DoS vector. The platform log aggregator picks
//     up the warn line for correlation across attempts.
//
// We deliberately do NOT throw on logging failures — the caller's
// "Invalid link" / "Link expired" response must still propagate.

import { db } from "@/lib/db";
import type { EventType } from "@/lib/events/registry";
import { hashTokenForAudit } from "./tokenAudit";

export type BaaTokenRejectReason =
  | "REVOKED"
  | "EXPIRED"
  | "ALREADY_CONSUMED"
  | "STATUS_CLOSED"
  | "EMAIL_MISMATCH"
  | "RATE_LIMITED"
  | "ID_MISMATCH";

interface KnownTokenRejection {
  practiceId: string;
  baaRequestId: string;
  tokenId: string;
  token: string;
  reason: BaaTokenRejectReason;
  ip: string | null;
  userAgent: string | null;
}

/** Log a rejection where the token DID resolve to a BaaRequest. Writes
 *  directly to EventLog (not via appendEventAndApply) — no projection
 *  is attached, this row is audit-only. Best-effort: errors swallow. */
export async function logRejectedKnownToken(
  args: KnownTokenRejection,
): Promise<void> {
  try {
    const tokenHash = hashTokenForAudit(args.token);
    const ua = args.userAgent ? args.userAgent.slice(0, 500) : null;
    const ip = args.ip ? args.ip.slice(0, 45) : null;
    const payload = {
      baaRequestId: args.baaRequestId,
      tokenId: args.tokenId,
      tokenHash,
      rejectedAt: new Date().toISOString(),
      reason: args.reason,
      ip,
      userAgent: ua,
    };
    await db.eventLog.create({
      data: {
        practiceId: args.practiceId,
        actorUserId: null,
        type: "BAA_TOKEN_REJECTED" satisfies EventType,
        schemaVersion: 1,
        payload,
      },
    });
  } catch (err) {
    // Logging must never break the user-visible 4xx — emit and move on.
    console.error("[baa-token-rejected] log failed", err);
  }
}

/** Log a rejection where the token did NOT resolve (no BaaRequest).
 *  No EventLog row possible (no practiceId); console.warn so the
 *  platform aggregator can correlate enumeration patterns by IP. */
export function logRejectedUnknownToken(args: {
  token: string;
  ip: string | null;
  userAgent: string | null;
}): void {
  console.warn(
    "[baa-token-rejected] unknown token",
    JSON.stringify({
      tokenHash: hashTokenForAudit(args.token),
      ip: args.ip,
      userAgent: args.userAgent ? args.userAgent.slice(0, 500) : null,
      rejectedAt: new Date().toISOString(),
    }),
  );
}
