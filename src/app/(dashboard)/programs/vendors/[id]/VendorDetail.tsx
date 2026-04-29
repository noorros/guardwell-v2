// src/app/(dashboard)/programs/vendors/[id]/VendorDetail.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CheckCircle2,
  CircleDashed,
  FileSignature,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EvidenceUpload } from "@/components/gw/EvidenceUpload";
import { BaaStatusBadge } from "../BaaStatusBadge";
import {
  startBaaDraftAction,
  sendBaaAction,
  resendBaaAction,
} from "./actions";
import { usePracticeTimezone } from "@/lib/timezone/PracticeTimezoneContext";
import { formatPracticeDate, formatPracticeDateTime } from "@/lib/audit/format";

const FIELD_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const TEXTAREA_CLASS =
  "mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ── Types ────────────────────────────────────────────────────────────────────

export type BaaRequestStatus =
  | "DRAFT"
  | "SENT"
  | "ACKNOWLEDGED"
  | "EXECUTED"
  | "REJECTED"
  | "EXPIRED"
  | "SUPERSEDED";

export interface BaaRequestRow {
  id: string;
  status: BaaRequestStatus;
  recipientEmail: string | null;
  recipientMessage: string | null;
  draftUploadedAt: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  executedAt: string | null;
  rejectedAt: string | null;
  expiresAt: string | null;
  vendorSignatureName: string | null;
  rejectionReason: string | null;
  draftEvidence: {
    id: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    status: string;
    uploadedAt: string;
  } | null;
  activeToken: { id: string; expiresAt: string } | null;
}

export interface VendorDetailProps {
  canManage: boolean;
  practiceId: string;
  vendor: {
    id: string;
    name: string;
    type: string | null;
    service: string | null;
    contact: string | null;
    email: string | null;
    notes: string | null;
    processesPhi: boolean;
    baaDirection: string | null;
    baaExecutedAt: string | null;
    baaExpiresAt: string | null;
  };
  baaRequests: BaaRequestRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeUuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// "Active" is the most recent non-terminal BAA — the one the vendor is
// currently working through. Terminal states (EXECUTED / REJECTED /
// EXPIRED / SUPERSEDED) move to "past".
function isActiveStatus(s: BaaRequestStatus): boolean {
  return s === "DRAFT" || s === "SENT" || s === "ACKNOWLEDGED";
}

function statusLabel(s: BaaRequestStatus): string {
  switch (s) {
    case "DRAFT":
      return "Draft";
    case "SENT":
      return "Sent — awaiting acknowledgment";
    case "ACKNOWLEDGED":
      return "Acknowledged — awaiting signature";
    case "EXECUTED":
      return "Executed";
    case "REJECTED":
      return "Rejected";
    case "EXPIRED":
      return "Expired";
    case "SUPERSEDED":
      return "Superseded";
  }
}

// ── VendorDetail ─────────────────────────────────────────────────────────────

export function VendorDetail({
  canManage,
  vendor,
  baaRequests,
}: VendorDetailProps) {
  const active = baaRequests.find((r) => isActiveStatus(r.status));
  const past = baaRequests.filter(
    (r) => !active || r.id !== active.id,
  );

  return (
    <div className="space-y-6">
      {/* ── Vendor metadata ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">Vendor details</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Type</dt>
              <dd className="mt-0.5">
                {vendor.type ?? <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Email
              </dt>
              <dd className="mt-0.5">
                {vendor.email ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                Contact
              </dt>
              <dd className="mt-0.5">
                {vendor.contact ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                BAA direction
              </dt>
              <dd className="mt-0.5">
                {vendor.baaDirection ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            {vendor.service && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Service
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{vendor.service}</dd>
              </div>
            )}
            {vendor.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  Notes
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{vendor.notes}</dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">
                Current BAA status
              </dt>
              <dd className="mt-1">
                <BaaStatusBadge
                  processesPhi={vendor.processesPhi}
                  baaExecutedAt={vendor.baaExecutedAt}
                  baaExpiresAt={vendor.baaExpiresAt}
                />
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* ── BAA workflow ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <FileSignature className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <h2 className="text-sm font-semibold">BAA workflow</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Send a Business Associate Agreement to this vendor and
                track its lifecycle from draft to signature.
              </p>
            </div>
          </div>

          {!vendor.processesPhi && (
            <div className="rounded-md border border-dashed bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
              This vendor is not flagged as processing PHI. A BAA may not
              be required — flip the &quot;Processes PHI&quot; flag from
              the vendor list if that&apos;s incorrect.
            </div>
          )}

          {active ? (
            <ActiveBaaCard
              vendor={vendor}
              request={active}
              canManage={canManage}
            />
          ) : (
            <NoActiveBaaCard
              vendor={vendor}
              canManage={canManage}
              hasPriorRequests={past.length > 0}
            />
          )}
        </CardContent>
      </Card>

      {/* ── BAA timeline (active request only) ───────────────────────── */}
      {active && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-sm font-semibold">Status timeline</h2>
            <BaaTimeline request={active} />
          </CardContent>
        </Card>
      )}

      {/* ── Past BAA requests ────────────────────────────────────────── */}
      {past.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-sm font-semibold">History</h2>
            <ul className="divide-y rounded-md border">
              {past.map((r) => (
                <PastBaaRow key={r.id} request={r} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── ActiveBaaCard ────────────────────────────────────────────────────────────

function ActiveBaaCard({
  vendor,
  request,
  canManage,
}: {
  vendor: VendorDetailProps["vendor"];
  request: BaaRequestRow;
  canManage: boolean;
}) {
  const tz = usePracticeTimezone();
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{statusLabel(request.status)}</p>
          {request.recipientEmail && (
            <p className="text-[11px] text-muted-foreground">
              Sent to {request.recipientEmail}
              {request.activeToken
                ? ` · expires ${formatPracticeDate(new Date(request.activeToken.expiresAt), tz)}`
                : null}
            </p>
          )}
        </div>
        <Badge variant="secondary" className="text-[10px] uppercase">
          {request.status}
        </Badge>
      </div>

      {/* Draft state — show evidence upload + send form */}
      {request.status === "DRAFT" && (
        <div className="space-y-4 border-t pt-4">
          <div>
            <h3 className="text-xs font-medium">BAA document</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Upload the prepared BAA document (PDF). The vendor will see
              this attached when they open the accept link.
            </p>
            <div className="mt-2">
              <EvidenceUpload
                entityType="VENDOR_BAA"
                entityId={request.id}
                initialEvidence={
                  request.draftEvidence
                    ? [
                        {
                          id: request.draftEvidence.id,
                          fileName: request.draftEvidence.fileName,
                          mimeType: request.draftEvidence.mimeType,
                          fileSizeBytes: request.draftEvidence.fileSizeBytes,
                          uploadedAt: request.draftEvidence.uploadedAt,
                          status: request.draftEvidence.status,
                        },
                      ]
                    : []
                }
                canManage={canManage}
                accept=".pdf"
              />
            </div>
          </div>
          {canManage && (
            <SendBaaForm
              baaRequestId={request.id}
              defaultEmail={vendor.email ?? ""}
              defaultMessage=""
              mode="send"
            />
          )}
        </div>
      )}

      {/* Sent or Acknowledged — show resend */}
      {(request.status === "SENT" || request.status === "ACKNOWLEDGED") && (
        <div className="space-y-3 border-t pt-4">
          {request.activeToken ? (
            <p className="text-xs text-muted-foreground">
              Active token expires {formatPracticeDateTime(new Date(request.activeToken.expiresAt), tz)}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No active token. Send a new link to continue.
            </p>
          )}
          {canManage && (
            <SendBaaForm
              baaRequestId={request.id}
              defaultEmail={request.recipientEmail ?? vendor.email ?? ""}
              defaultMessage={request.recipientMessage ?? ""}
              mode="resend"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── NoActiveBaaCard ──────────────────────────────────────────────────────────

function NoActiveBaaCard({
  vendor,
  canManage,
  hasPriorRequests,
}: {
  vendor: VendorDetailProps["vendor"];
  canManage: boolean;
  hasPriorRequests: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleStart = () => {
    setError(null);
    const baaRequestId = makeUuid();
    startTransition(async () => {
      try {
        await startBaaDraftAction({
          vendorId: vendor.id,
          baaRequestId,
          draftEvidenceId: null,
        });
        // Page refetches via revalidatePath in the action, but the
        // RSC parent re-fetches only on hard navigation. Force a reload
        // so the new DRAFT row + EvidenceUpload appear.
        window.location.reload();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not start BAA workflow.",
        );
      }
    });
  };

  return (
    <div className="rounded-lg border border-dashed p-4 text-sm">
      {hasPriorRequests ? (
        <p className="text-muted-foreground">
          No active BAA. Start a new workflow to upload a fresh draft and
          send it to the vendor.
        </p>
      ) : (
        <p className="text-muted-foreground">
          No BAA on file yet. Start the workflow by uploading the BAA
          document and sending the vendor a token-protected link to sign.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {canManage && (
        <Button
          onClick={handleStart}
          disabled={isPending}
          size="sm"
          className="mt-3 gap-1.5"
        >
          <FileSignature className="h-3.5 w-3.5" aria-hidden="true" />
          {isPending ? "Starting…" : "Start BAA workflow"}
        </Button>
      )}
    </div>
  );
}

// ── SendBaaForm ──────────────────────────────────────────────────────────────

function SendBaaForm({
  baaRequestId,
  defaultEmail,
  defaultMessage,
  mode,
}: {
  baaRequestId: string;
  defaultEmail: string;
  defaultMessage: string;
  mode: "send" | "resend";
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState(defaultMessage);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isResend = mode === "resend";

  const handleSubmit = () => {
    setError(null);
    setSuccess(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Recipient email is required.");
      return;
    }
    // Lightweight client-side email check; server re-validates with Zod.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    const tokenId = makeUuid();
    const trimmedMessage = message.trim() || null;

    startTransition(async () => {
      try {
        const result = isResend
          ? await resendBaaAction({
              baaRequestId,
              tokenId,
              recipientMessage: trimmedMessage,
            })
          : await sendBaaAction({
              baaRequestId,
              tokenId,
              recipientEmail: trimmedEmail,
              recipientMessage: trimmedMessage,
            });
        setSuccess(
          result.emailDelivered
            ? `BAA sent to ${trimmedEmail}.`
            : `BAA recorded as sent. Email delivery: ${result.emailReason ?? "unknown"}.`,
        );
        // Force reload to pick up the new SENT state + active token.
        setTimeout(() => window.location.reload(), 800);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send BAA.");
      }
    });
  };

  return (
    <div className="space-y-3">
      {!isResend && (
        <div>
          <label htmlFor={`baa-email-${baaRequestId}`} className="text-xs font-medium">
            Recipient email
          </label>
          <input
            id={`baa-email-${baaRequestId}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
            placeholder="vendor@example.com"
            maxLength={200}
            className={FIELD_CLASS}
          />
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Defaults to vendor email on file.
          </p>
        </div>
      )}
      <div>
        <label htmlFor={`baa-msg-${baaRequestId}`} className="text-xs font-medium">
          Message{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`baa-msg-${baaRequestId}`}
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isPending}
          placeholder="Optional note for the vendor — context, deadline, etc."
          maxLength={2000}
          className={TEXTAREA_CLASS}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && (
        <p className="text-xs text-[color:var(--gw-color-compliant)]">
          {success}
        </p>
      )}
      <div>
        <Button
          onClick={handleSubmit}
          disabled={isPending}
          size="sm"
          className="gap-1.5"
        >
          {isResend ? (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {isPending
            ? isResend
              ? "Resending…"
              : "Sending…"
            : isResend
              ? "Resend BAA"
              : "Send BAA"}
        </Button>
      </div>
    </div>
  );
}

// ── BaaTimeline ──────────────────────────────────────────────────────────────

function BaaTimeline({ request }: { request: BaaRequestRow }) {
  const tz = usePracticeTimezone();
  const steps = useMemo(() => {
    const out: {
      label: string;
      done: boolean;
      timestamp: string | null;
      tone: "default" | "success" | "danger";
    }[] = [
      {
        label: "Draft uploaded",
        done: request.draftUploadedAt !== null,
        timestamp: request.draftUploadedAt,
        tone: "default",
      },
      {
        label: "Sent to vendor",
        done: request.sentAt !== null,
        timestamp: request.sentAt,
        tone: "default",
      },
      {
        label: "Acknowledged by vendor",
        done: request.acknowledgedAt !== null,
        timestamp: request.acknowledgedAt,
        tone: "default",
      },
    ];
    if (request.status === "REJECTED") {
      out.push({
        label: "Rejected by vendor",
        done: true,
        timestamp: request.rejectedAt,
        tone: "danger",
      });
    } else {
      out.push({
        label: "Executed by vendor",
        done: request.executedAt !== null,
        timestamp: request.executedAt,
        tone: "success",
      });
    }
    return out;
  }, [request]);

  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">
            {step.done ? (
              step.tone === "danger" ? (
                <XCircle
                  className="h-4 w-4 text-destructive"
                  aria-hidden="true"
                />
              ) : (
                <CheckCircle2
                  className="h-4 w-4"
                  style={{
                    color:
                      step.tone === "success"
                        ? "var(--gw-color-compliant)"
                        : "var(--gw-color-compliant)",
                  }}
                  aria-hidden="true"
                />
              )
            ) : (
              <CircleDashed
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </span>
          <div className="flex-1 space-y-0.5">
            <p
              className={
                step.done
                  ? "text-sm font-medium"
                  : "text-sm text-muted-foreground"
              }
            >
              {step.label}
            </p>
            {step.timestamp && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {formatPracticeDateTime(new Date(step.timestamp), tz)}
              </p>
            )}
            {step.label === "Executed by vendor" &&
              request.vendorSignatureName && (
                <p className="text-[11px] text-muted-foreground">
                  Signed by {request.vendorSignatureName}
                </p>
              )}
            {step.label === "Rejected by vendor" &&
              request.rejectionReason && (
                <p className="text-[11px] text-muted-foreground italic">
                  &ldquo;{request.rejectionReason}&rdquo;
                </p>
              )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── PastBaaRow ───────────────────────────────────────────────────────────────

function PastBaaRow({ request }: { request: BaaRequestRow }) {
  const tz = usePracticeTimezone();
  const summary = (() => {
    if (request.status === "EXECUTED") {
      return `Executed ${request.executedAt ? formatPracticeDate(new Date(request.executedAt), tz) : "—"}${
        request.vendorSignatureName
          ? ` · signed by ${request.vendorSignatureName}`
          : ""
      }`;
    }
    if (request.status === "REJECTED") {
      return `Rejected ${request.rejectedAt ? formatPracticeDate(new Date(request.rejectedAt), tz) : "—"}${
        request.rejectionReason ? ` — ${request.rejectionReason}` : ""
      }`;
    }
    if (request.status === "EXPIRED") {
      return `Expired ${request.expiresAt ? formatPracticeDate(new Date(request.expiresAt), tz) : "—"}`;
    }
    if (request.status === "SUPERSEDED") {
      return `Superseded by a newer BAA`;
    }
    return statusLabel(request.status);
  })();

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">{summary}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          Created {request.draftUploadedAt ? formatPracticeDate(new Date(request.draftUploadedAt), tz) : "—"}
          {request.sentAt ? ` · sent ${formatPracticeDate(new Date(request.sentAt), tz)}` : ""}
        </p>
      </div>
      <Badge variant="outline" className="text-[10px] uppercase">
        {request.status}
      </Badge>
    </li>
  );
}
