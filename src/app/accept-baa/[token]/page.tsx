// src/app/accept-baa/[token]/page.tsx
//
// Public, no-auth surface for a vendor to review and e-sign a BAA.
// Token possession is the authorization; vendors don't have GuardWell
// accounts. Per HIPAA §164.504(e), text e-signature + timestamp + IP +
// user agent is sufficient for v1; DocuSign integration is post-launch.
//
// Lives at the top level of /src/app/ — outside the (dashboard) group —
// so it doesn't inherit the dashboard layout / auth redirect chain.

import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { appendEventAndApply } from "@/lib/events";
import { projectBaaAcknowledgedByVendor } from "@/lib/events/projections/baa";
import { AcceptBaaForm } from "./AcceptBaaForm";
import { formatPracticeDate } from "@/lib/audit/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review BAA · GuardWell" };

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function AcceptBaaPage({ params }: PageProps) {
  const { token } = await params;

  const tokenRow = await db.baaAcceptanceToken.findUnique({
    where: { token },
    include: {
      baaRequest: {
        include: {
          practice: { select: { name: true, primaryState: true } },
          vendor: { select: { id: true, name: true, email: true } },
          draftEvidence: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              fileSizeBytes: true,
              status: true,
            },
          },
        },
      },
    },
  });
  if (!tokenRow) notFound();

  // Status guards — render different states.
  // eslint-disable-next-line react-hooks/purity -- Server component; Date.now() is safe here.
  const now = Date.now();
  const expired = tokenRow.expiresAt.getTime() < now;
  const consumed = !!tokenRow.consumedAt;
  const revoked = !!tokenRow.revokedAt;
  const baa = tokenRow.baaRequest;

  if (revoked) {
    return (
      <BlockedState
        title="Link revoked"
        body="This BAA link has been replaced. Please contact the practice for a new link."
      />
    );
  }
  if (expired) {
    return (
      <BlockedState
        title="Link expired"
        body="This BAA link has expired. Contact the practice to receive a new link."
      />
    );
  }
  if (consumed && baa.status === "EXECUTED") {
    return (
      <SuccessState
        practiceName={baa.practice.name}
        vendorName={baa.vendor.name}
        executedAt={baa.executedAt}
        signatureName={baa.vendorSignatureName}
      />
    );
  }
  if (consumed && baa.status === "REJECTED") {
    return (
      <BlockedState
        title="BAA already declined"
        body="You have already declined this Business Associate Agreement."
      />
    );
  }
  if (baa.status !== "SENT" && baa.status !== "ACKNOWLEDGED") {
    return (
      <BlockedState
        title="BAA unavailable"
        body="This BAA is no longer accepting signatures."
      />
    );
  }

  // Emit acknowledgment event on first render (best-effort — failure
  // doesn't block the user from signing). Idempotent: the projection
  // skips when acknowledgedAt is already set.
  if (!baa.acknowledgedAt) {
    try {
      const acknowledgedAt = new Date().toISOString();
      const ackPayload = {
        baaRequestId: baa.id,
        tokenId: tokenRow.id,
        acknowledgedAt,
      };
      await appendEventAndApply(
        {
          practiceId: baa.practiceId,
          actorUserId: null, // public access — no actor
          type: "BAA_ACKNOWLEDGED_BY_VENDOR",
          payload: ackPayload,
        },
        async (tx) =>
          projectBaaAcknowledgedByVendor(tx, {
            practiceId: baa.practiceId,
            payload: ackPayload,
          }),
      );
    } catch (err) {
      // Log but don't block — the user can still sign.
      console.error("[baa-accept] acknowledge emit failed", err);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Business Associate Agreement
        </h1>
        <p className="text-sm text-muted-foreground">
          {baa.practice.name} has sent {baa.vendor.name} a BAA to review and
          electronically sign.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">Document</h2>
          {baa.draftEvidence ? (
            <DocumentPreview
              evidence={baa.draftEvidence}
              token={token}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No document was attached to this BAA. Please contact the practice.
            </p>
          )}
        </CardContent>
      </Card>

      <AcceptBaaForm
        token={token}
        baaRequestId={baa.id}
        tokenId={tokenRow.id}
        recipientEmail={baa.recipientEmail}
        practiceName={baa.practice.name}
        vendorName={baa.vendor.name}
      />
    </main>
  );
}

function BlockedState({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-md p-12">
      <Card>
        <CardContent className="space-y-2 p-6 text-center">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{body}</p>
        </CardContent>
      </Card>
    </main>
  );
}

function SuccessState({
  practiceName,
  vendorName,
  executedAt,
  signatureName,
}: {
  practiceName: string;
  vendorName: string;
  executedAt: Date | null;
  signatureName: string | null;
}) {
  return (
    <main className="mx-auto max-w-md p-12">
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <h1 className="text-xl font-semibold">BAA executed</h1>
          <p className="text-sm text-muted-foreground">
            {vendorName} signed this BAA with {practiceName} on{" "}
            {/* Unauthenticated viewer — no practice context available. UTC is the
                safe default for token landing pages; if we ever attach the inviting
                practice's timezone to the token row, switch to that. */}
            {executedAt ? formatPracticeDate(executedAt, "UTC") : "—"}.
          </p>
          {signatureName ? (
            <p className="text-xs text-muted-foreground">
              Signed as: <span className="font-medium">{signatureName}</span>
            </p>
          ) : null}
          <p className="pt-2 text-xs text-muted-foreground">
            A copy is retained by {practiceName} and available on request.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function DocumentPreview({
  evidence,
  token,
}: {
  evidence: {
    id: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    status: string;
  };
  token: string;
}) {
  const sizeKb = Math.round(evidence.fileSizeBytes / 1024);
  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">{evidence.fileName}</p>
        <p className="text-xs text-muted-foreground">
          {evidence.mimeType} · {sizeKb.toLocaleString()} KB
        </p>
      </div>
      <a
        href={`/api/baa-document/${token}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
      >
        Download to review
      </a>
    </div>
  );
}
