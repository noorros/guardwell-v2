// src/app/(dashboard)/programs/staff/bulk-invite/actions.ts
"use server";

import { randomUUID, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getPracticeUser } from "@/lib/rbac";
import { appendEventAndApply } from "@/lib/events";
import { projectUserInvited } from "@/lib/events/projections/invitation";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";
import { renderEmailHtml } from "@/lib/email/template";

const MAX_BATCH = 200;
const INVITATION_TTL_DAYS = 7;

export const BulkInviteRowSchema = z.object({
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  email: z.string().max(200),
  role: z.enum(["ADMIN", "STAFF", "VIEWER"]),
});

export type BulkInviteRow = z.infer<typeof BulkInviteRowSchema>;

export type BulkRowStatus =
  | "INVITED"
  | "DUPLICATE_IN_BATCH"
  | "ALREADY_MEMBER"
  | "ALREADY_PENDING"
  | "INVALID_EMAIL"
  | "INVALID_ROLE";

export interface BulkInvitePerRowResult {
  email: string;
  status: BulkRowStatus;
  invitationId?: string;
  emailDelivered?: boolean;
  emailReason?: string;
}

export interface BulkInviteResult {
  invitedCount: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  perRowResults: BulkInvitePerRowResult[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function acceptUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";
  return `${base.replace(/\/$/, "")}/accept-invite/${token}`;
}

/**
 * Core pipeline, exported for testing. The public server action wraps
 * this with auth + revalidation. Pure in its DB effects: for every
 * accepted row it writes one USER_INVITED event via the existing
 * projection. Email sends happen after the transaction (best-effort).
 */
export async function processBulkInviteRows(args: {
  practiceId: string;
  actorUserId: string;
  rows: BulkInviteRow[];
}): Promise<BulkInviteResult> {
  if (args.rows.length > MAX_BATCH) {
    throw new Error(
      `Batch too large: ${args.rows.length} rows exceeds the ${MAX_BATCH}-row cap. Split into multiple uploads.`,
    );
  }

  const perRowResults: BulkInvitePerRowResult[] = [];
  const seenInBatch = new Set<string>();
  const emailsToCheck: string[] = [];
  const acceptedRows: BulkInviteRow[] = [];

  // Pass 1: in-memory validation — format, role, intra-batch dedupe.
  for (const raw of args.rows) {
    const email = raw.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      perRowResults.push({ email: raw.email, status: "INVALID_EMAIL" });
      continue;
    }
    if (seenInBatch.has(email)) {
      perRowResults.push({ email, status: "DUPLICATE_IN_BATCH" });
      continue;
    }
    seenInBatch.add(email);
    acceptedRows.push({ ...raw, email });
    emailsToCheck.push(email);
  }

  // Pass 2: DB dedupe — existing members + pending invitations.
  const existingMembers = await db.user.findMany({
    where: {
      email: { in: emailsToCheck },
      practiceUsers: { some: { practiceId: args.practiceId, removedAt: null } },
    },
    select: { email: true },
  });
  const existingMemberEmails = new Set(
    existingMembers.map((u) => (u.email ?? "").toLowerCase()),
  );
  const pendingInvites = await db.practiceInvitation.findMany({
    where: {
      practiceId: args.practiceId,
      invitedEmail: { in: emailsToCheck },
      acceptedAt: null,
      revokedAt: null,
    },
    select: { invitedEmail: true },
  });
  const pendingEmails = new Set(pendingInvites.map((p) => p.invitedEmail));

  const toWrite: Array<{ row: BulkInviteRow; token: string; invitationId: string }> = [];
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  for (const row of acceptedRows) {
    if (existingMemberEmails.has(row.email)) {
      perRowResults.push({ email: row.email, status: "ALREADY_MEMBER" });
      continue;
    }
    if (pendingEmails.has(row.email)) {
      perRowResults.push({ email: row.email, status: "ALREADY_PENDING" });
      continue;
    }
    toWrite.push({
      row,
      token: randomBytes(24).toString("base64url"),
      invitationId: randomUUID(),
    });
  }

  // Pass 3: emit one USER_INVITED event per acceptable row. appendEventAndApply
  // runs inside its own tx, so a batch of N writes = N transactions.
  // Failures roll back per-row but the batch is not atomic — if row 50
  // fails, rows 1-49 are still invited. This matches the spec's
  // "partial-failure is impossible **per row**" goal — the batch is an
  // idempotent set of independent invitations, not a ledger requiring
  // all-or-nothing.
  const practice = await db.practice.findUniqueOrThrow({
    where: { id: args.practiceId },
    select: { name: true },
  });

  for (const { row, token, invitationId } of toWrite) {
    const payload = {
      invitationId,
      invitedEmail: row.email,
      role: row.role,
      expiresAt: expiresAt.toISOString(),
    };
    await appendEventAndApply(
      {
        practiceId: args.practiceId,
        actorUserId: args.actorUserId,
        type: "USER_INVITED",
        payload,
      },
      async (tx) =>
        projectUserInvited(tx, {
          practiceId: args.practiceId,
          invitedByUserId: args.actorUserId,
          token,
          payload,
        }),
    );
    perRowResults.push({
      email: row.email,
      status: "INVITED",
      invitationId,
    });
  }

  // Email send (post-commit, best-effort). Failures here don't roll back
  // the invitations — staff-page surfaces a "resend" button per row.
  for (const rowResult of perRowResults) {
    if (rowResult.status !== "INVITED" || !rowResult.invitationId) continue;
    const written = toWrite.find((w) => w.invitationId === rowResult.invitationId);
    if (!written) continue;
    const href = acceptUrl(written.token);
    const subject = `${practice.name} invited you to GuardWell`;
    const text = [
      `You've been invited to join ${practice.name} on GuardWell.`,
      `Role: ${written.row.role}.`,
      ``,
      `Accept: ${href}`,
      ``,
      `Expires ${expiresAt.toUTCString()}.`,
    ].join("\n");
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://v2.app.gwcomp.com";
    const html = renderEmailHtml({
      preheader: `${practice.name} invited you to GuardWell.`,
      headline: `You're invited to ${practice.name}`,
      subheadline: `Join as ${written.row.role}.`,
      sections: [
        {
          html: `<p style="margin:0 0 8px;">GuardWell is how ${practice.name} tracks compliance. Accept the invitation to collaborate with your team.</p><p style="margin:0; color:#64748B;">This invitation expires ${expiresAt.toUTCString()}.</p>`,
        },
      ],
      cta: { label: "Accept invitation", href },
      practiceName: practice.name,
      baseUrl,
    });
    const emailResult = await sendEmail({
      to: written.row.email,
      subject,
      text,
      html,
    });
    rowResult.emailDelivered = emailResult.delivered;
    rowResult.emailReason = emailResult.reason;
  }

  return {
    invitedCount: perRowResults.filter((r) => r.status === "INVITED").length,
    skippedDuplicates: perRowResults.filter(
      (r) =>
        r.status === "DUPLICATE_IN_BATCH" ||
        r.status === "ALREADY_MEMBER" ||
        r.status === "ALREADY_PENDING",
    ).length,
    skippedInvalid: perRowResults.filter(
      (r) => r.status === "INVALID_EMAIL" || r.status === "INVALID_ROLE",
    ).length,
    perRowResults,
  };
}

const BulkInput = z.object({
  rows: z.array(BulkInviteRowSchema).min(1).max(MAX_BATCH),
});

export async function bulkInviteAction(
  input: z.infer<typeof BulkInput>,
): Promise<BulkInviteResult> {
  const user = await requireUser();
  const pu = await getPracticeUser();
  if (!pu) throw new Error("Unauthorized");
  if (pu.role !== "OWNER" && pu.role !== "ADMIN") {
    throw new Error("Only owners and admins can bulk-invite team members");
  }
  const parsed = BulkInput.parse(input);
  const result = await processBulkInviteRows({
    practiceId: pu.practiceId,
    actorUserId: user.id,
    rows: parsed.rows,
  });
  revalidatePath("/programs/staff");
  revalidatePath("/programs/staff/bulk-invite");
  return result;
}
