// src/lib/events/projections/guards.ts
//
// Shared cross-tenant guards for projection writers. Audit C-1 cross-area
// (HIPAA + Credentials + Allergy code reviews, 2026-04-29).
//
// ADR-0001 specifies that `appendEventAndApply` is the only mutation
// path. The action layer validates that target rows belong to the
// caller's practice — but any future cron / batch / backfill that emits
// events directly bypasses that validation. Defense-in-depth requires
// the projection itself to refuse cross-tenant writes.
//
// Reference pattern: `src/lib/events/projections/sraDraftSaved.ts:52`
// (the only projection that already had the check before the audit).
//
// Usage:
//
//   const existing = await tx.credential.findUnique({
//     where: { id: payload.credentialId },
//     select: { practiceId: true },
//   });
//   assertProjectionPracticeOwned(
//     existing,
//     practiceId,
//     `CREDENTIAL_UPSERTED ${payload.credentialId}`,
//   );
//
// Pre-existing-row case throws if practiceId differs. Missing-row case
// is intentionally allowed — that's the "no row yet, create it now"
// path for upserts. Callers that want strict "must exist" semantics
// (e.g. `*_REMOVED` projections) should add their own `if (!existing)
// return;` guard before/after.

export function assertProjectionPracticeOwned(
  existing: { practiceId: string } | null | undefined,
  expectedPracticeId: string,
  errorContext: string,
): void {
  if (existing && existing.practiceId !== expectedPracticeId) {
    throw new Error(
      `Cross-tenant projection write refused: ${errorContext} belongs to a different practice`,
    );
  }
}
