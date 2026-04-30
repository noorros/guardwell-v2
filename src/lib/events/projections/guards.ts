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
// Reference pattern: `src/lib/events/projections/sraDraftSaved.ts`
// already had this check before the audit; this helper hoists it so
// every projection can reuse the same shape.
//
// Usage:
//   const existing = await tx.credential.findUnique({
//     where: { id: payload.credentialId },
//     select: { practiceId: true, ...other fields you need },
//   });
//   assertProjectionPracticeOwned(existing, practiceId, {
//     table: "credential",
//     id: payload.credentialId,
//   });
//   // ...mutate freely now
//
// The missing-row case is intentionally allowed (the upsert "create"
// path) — only an existing row in another practice is refused. If the
// projection requires the row to exist, do an explicit `if (!existing)`
// check above the guard call.

export function assertProjectionPracticeOwned(
  existing: { practiceId: string } | null | undefined,
  practiceId: string,
  ctx: { table: string; id: string },
): void {
  if (existing && existing.practiceId !== practiceId) {
    throw new Error(
      `Projection refused: ${ctx.table} ${ctx.id} belongs to a different practice`,
    );
  }
}
