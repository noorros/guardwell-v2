// src/app/(dashboard)/programs/vendors/[id]/actions.ts
"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import {
  projectBaaDraftUploaded,
  projectBaaSentToVendor,
} from "@/lib/events/projections/baa";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml } from "@/lib/email/template";

// ──────────────────────────────────────────────────────────────────────
// BAA workflow actions for the vendor detail page.
// All three actions enforce server-side OWNER/ADMIN gate +
// cross-tenant guards. Entity IDs come from the client (used as
// idempotencyKey) — same convention as the credential CEU action in
// chunk 5B.
// ──────────────────────────────────────────────────────────────────────

const TOKEN_TTL_DAYS = 30;

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "https://v2.app.gwcomp.com"
  );
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function verifyVendorInPractice(vendorId: string, practiceId: string) {
  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.practiceId !== practiceId) {
    throw new Error("Vendor not found");
  }
  return vendor;
}

async function verifyBaaRequestInPractice(
  baaRequestId: string,
  practiceId: string,
) {
  const baaRequest = await db.baaRequest.findUnique({
    where: { id: baaRequestId },
  });
  if (!baaRequest || baaRequest.practiceId !== practiceId) {
    throw new Error("BAA request not found");
  }
  return baaRequest;
}

// ──────────────────────────────────────────────────────────────────────
// startBaaDraftAction — creates (or re-emits) a BaaRequest in DRAFT
// state. Optionally points to a draft Evidence row uploaded via the
// EvidenceUpload component (entityType="VENDOR_BAA").
// ──────────────────────────────────────────────────────────────────────

const StartDraftInput = z.object({
  vendorId: z.string().min(1),
  baaRequestId: z.string().min(1).max(60),
  draftEvidenceId: z.string().min(1).nullable().optional(),
});

export async function startBaaDraftAction(
  input: z.infer<typeof StartDraftInput>,
): Promise<{ baaRequestId: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  const parsed = StartDraftInput.parse(input);

  // Cross-tenant guard: vendor must belong to this practice.
  await verifyVendorInPractice(parsed.vendorId, pu.practiceId);

  const payload = {
    baaRequestId: parsed.baaRequestId,
    vendorId: parsed.vendorId,
    draftEvidenceId: parsed.draftEvidenceId ?? null,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "BAA_DRAFT_UPLOADED",
      payload,
      idempotencyKey: `baa-draft-${parsed.baaRequestId}`,
    },
    async (tx) =>
      projectBaaDraftUploaded(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  revalidatePath("/programs/vendors");
  revalidatePath(`/programs/vendors/${parsed.vendorId}`);
  // Audit #21 M-4 (2026-04-30): the HIPAA module page surfaces vendor /
  // BAA state as part of the §164.502(e) compliance roll-up, so any BAA
  // lifecycle write needs to invalidate it too.
  revalidatePath("/modules/hipaa");
  return { baaRequestId: parsed.baaRequestId };
}

// ──────────────────────────────────────────────────────────────────────
// sendBaaAction — emails the vendor a token-protected accept link and
// transitions the BaaRequest from DRAFT → SENT. Generates a fresh
// crypto-random token (TTL = 30 days). Email send is post-commit
// best-effort (failures don't roll back the SENT transition; practice
// can resend).
// ──────────────────────────────────────────────────────────────────────

const SendInput = z.object({
  baaRequestId: z.string().min(1),
  tokenId: z.string().min(1).max(60),
  recipientEmail: z.string().email(),
  recipientMessage: z.string().max(2000).nullable().optional(),
});

export async function sendBaaAction(
  input: z.infer<typeof SendInput>,
): Promise<{ tokenId: string; emailDelivered: boolean; emailReason?: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  const parsed = SendInput.parse(input);
  const trimmedMessage = parsed.recipientMessage?.trim() || null;

  // Cross-tenant guard: BAA request must belong to this practice.
  const baaRequest = await verifyBaaRequestInPractice(
    parsed.baaRequestId,
    pu.practiceId,
  );

  // Practice + vendor metadata for the email body.
  const [practice, vendor] = await Promise.all([
    db.practice.findUniqueOrThrow({
      where: { id: pu.practiceId },
      select: { name: true },
    }),
    db.vendor.findUniqueOrThrow({
      where: { id: baaRequest.vendorId },
      select: { name: true },
    }),
  ]);

  // Generate a cryptographically-random URL-safe token. base64url avoids
  // the "+" / "/" / "=" characters that need URL-encoding in a path.
  const token = randomBytes(32).toString("base64url");
  const tokenExpiresAt = new Date(
    Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const payload = {
    baaRequestId: parsed.baaRequestId,
    tokenId: parsed.tokenId,
    token,
    tokenExpiresAt: tokenExpiresAt.toISOString(),
    recipientEmail: parsed.recipientEmail,
    recipientMessage: trimmedMessage,
  };

  await appendEventAndApply(
    {
      practiceId: pu.practiceId,
      actorUserId: user.id,
      type: "BAA_SENT_TO_VENDOR",
      payload,
      // tokenId is unique per send — Date.now() not needed.
      idempotencyKey: `baa-send-${parsed.tokenId}`,
    },
    async (tx) =>
      projectBaaSentToVendor(tx, {
        practiceId: pu.practiceId,
        payload,
      }),
  );

  // Email send (post-commit, best-effort). Errors do NOT roll back the
  // SENT state; practice can use Resend BAA to retry.
  const acceptHref = `${baseUrl().replace(/\/$/, "")}/accept-baa/${token}`;
  const subject = `${practice.name} sent you a Business Associate Agreement`;
  const text = [
    `${practice.name} has prepared a Business Associate Agreement for ${vendor.name}.`,
    `Review the document and provide an electronic signature using the link below.`,
    ``,
    `Review & sign: ${acceptHref}`,
    ``,
    `Link expires ${tokenExpiresAt.toUTCString()}.`,
    trimmedMessage ? `\nMessage from ${practice.name}:\n${trimmedMessage}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sections: { html: string }[] = [
    {
      html: `<p style="margin:0 0 8px;">${escapeHtml(practice.name)} has prepared a Business Associate Agreement for <strong>${escapeHtml(vendor.name)}</strong>. Click the button below to review the document and provide an electronic signature.</p>`,
    },
  ];
  if (trimmedMessage) {
    sections.push({
      html: `<p style="margin:0; padding:12px 14px; background:#F8FAFC; border-left:3px solid #2563EB; font-style:italic; color:#475569;">${escapeHtml(trimmedMessage)}</p>`,
    });
  }
  sections.push({
    html: `<p style="margin:0; font-size:12px; color:#64748b;">The link below expires in ${TOKEN_TTL_DAYS} days. If you have questions, reply to this email — it is monitored by ${escapeHtml(practice.name)}.</p>`,
  });

  const html = renderEmailHtml({
    preheader: `${practice.name} has sent you a Business Associate Agreement`,
    headline: "Review & sign your BAA",
    sections,
    cta: { label: "Review & sign BAA", href: acceptHref },
    practiceName: practice.name,
    baseUrl: baseUrl(),
  });

  const emailResult = await sendEmail({
    to: parsed.recipientEmail,
    subject,
    text,
    html,
  });

  revalidatePath("/programs/vendors");
  revalidatePath(`/programs/vendors/${baaRequest.vendorId}`);
  // Audit #21 M-4 (2026-04-30): module-level rollup needs to see the
  // SENT transition immediately.
  revalidatePath("/modules/hipaa");

  return {
    tokenId: parsed.tokenId,
    emailDelivered: emailResult.delivered,
    emailReason: emailResult.reason,
  };
}

// ──────────────────────────────────────────────────────────────────────
// resendBaaAction — generates a new token + re-emails the vendor.
// Mirrors sendBaaAction but starts from an existing BaaRequest in
// SENT or ACKNOWLEDGED state.
//
// TRADE-OFF: projectBaaSentToVendor sets status=SENT regardless of
// prior state. Re-sending while ACKNOWLEDGED therefore regresses the
// status to SENT. Acceptable for v1 since the vendor will re-acknowledge
// on next click of the new link, and projection idempotency means the
// historical event log accurately reflects "we re-sent". A finer-grained
// state machine (SENT_RESENT) is a post-launch enhancement.
// ──────────────────────────────────────────────────────────────────────

const ResendInput = z.object({
  baaRequestId: z.string().min(1),
  tokenId: z.string().min(1).max(60),
  recipientMessage: z.string().max(2000).nullable().optional(),
});

export async function resendBaaAction(
  input: z.infer<typeof ResendInput>,
): Promise<{ tokenId: string; emailDelivered: boolean; emailReason?: string }> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  const parsed = ResendInput.parse(input);

  // Cross-tenant guard.
  const baaRequest = await verifyBaaRequestInPractice(
    parsed.baaRequestId,
    pu.practiceId,
  );
  if (!baaRequest.recipientEmail) {
    throw new Error("Cannot resend: original send had no recipient email");
  }
  if (baaRequest.status !== "SENT" && baaRequest.status !== "ACKNOWLEDGED") {
    throw new Error(
      `Cannot resend a BAA in ${baaRequest.status} state — start a new BAA instead`,
    );
  }

  // Delegate the rest of the flow to sendBaaAction's body, but inline so
  // we keep its exact email + token-revoke logic in one place.
  return sendBaaAction({
    baaRequestId: parsed.baaRequestId,
    tokenId: parsed.tokenId,
    recipientEmail: baaRequest.recipientEmail,
    recipientMessage:
      parsed.recipientMessage?.trim() || baaRequest.recipientMessage,
  });
}
