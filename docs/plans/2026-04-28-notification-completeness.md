# Chunk 8 — Notification system completeness

**Goal:** Add the 7 highest-priority missing NotificationTypes so compliance drift surfaces via the weekly digest instead of sitting silent until manual audit. V2 currently has 14 enum values + 7 active generators; v1 had 40+.

**Reference:** master plan `docs/plans/2026-04-27-launch-readiness.md` § 8.

## Pattern

Every new type mirrors `generateCredentialRenewalNotifications` (`src/lib/notifications/generators.ts:156`):
- Generator scans a domain table (or for escalations, the `Notification` table itself), returns `NotificationProposal[]`, never writes.
- Dedup uses an `entityKey` embedded in `@@unique([userId, type, entityKey])`. The digest runner's `dedupProposals()` pre-filters in memory, then `createMany({ skipDuplicates: true })` is the final guard.
- `runNotificationDigest` (`src/lib/notifications/run-digest.ts`) handles writes + email side-effects. Generators stay pure.
- Tests follow `tests/integration/credential-renewal-reminders.test.ts`.

Schema-wise: every new type is just an enum value addition. Auto-migration (chunk 16) applies them on merge. **No new tables, no new fields.**

## Out of scope (deferred)

- `STATE_LAW_ALERT` — depends on chunk 9 (regulatory polling restoration).
- `SANCTION_FOLLOW_UP_DUE` — depends on chunk 11 (LEIE re-screen wiring).
- Orphan enum cleanup (`TRAINING_EXPIRING`, `POLICY_STALE` exist in the enum but have no generator). Different semantics from the new types — file as a follow-up after chunk 8 ships.
- Critical-alert (immediate-email) path for new types. Today only `INCIDENT_BREACH_UNRESOLVED` uses `emitCriticalBreachAlert`. The new types ride the digest path.

## Phase A — 5 domain-scan generators (1 PR)

Adds 5 enum values + 5 generator functions + wires them into `generateAllNotifications` + 5+ tests.

### A1. `POLICY_REVIEW_DUE`

**Purpose:** Annual policy-review reminder.
**Source:** `PracticePolicy` where `retiredAt IS NULL AND lastReviewedAt IS NOT NULL`.
**Trigger:** 90/60/30 days before `lastReviewedAt + 365`. Skip when `lastReviewedAt + 365 - today < 0` (already overdue → that's `POLICY_STALE`'s job, deferred).
**EntityKey:** `policy:{id}:milestone:{N}` where N is one of {90, 60, 30}.
**Recipients:** All `PracticeUser` rows with role IN (`OWNER`, `ADMIN`).
**Title/body example:**
- title: `"Annual review due in {N} days: {policyName}"`
- body: `"{policyCode} was last reviewed {date}. Annual review is required by {dueDate}."`
- href: `/policies/{policyId}`

### A2. `TRAINING_OVERDUE`

**Purpose:** Staff missed training renewal — 90 days past due.
**Source:** `TrainingCompletion` where `passed = true AND expiresAt < now() - 90 days` AND no newer passing completion for the same `(userId, courseId)` combo.
**EntityKey:** `training-completion:{completionId}`.
**Recipients:** The user whose training expired (the staff member themselves).
**Title/body example:**
- title: `"Training overdue: {courseName}"`
- body: `"Your {courseName} training expired on {date} and has been overdue for 90 days. Retake to stay compliant."`
- href: `/training/{courseId}`

### A3. `CMS_ENROLLMENT_EXPIRING`

**Purpose:** Medicare/Medicaid revalidation reminder.
**Source:** `Credential` filtered to `credentialType.code IN ('MEDICARE_PECOS_ENROLLMENT', 'MEDICARE_PROVIDER_ENROLLMENT')` AND `expiryDate IS NOT NULL AND retiredAt IS NULL`.
**Trigger:** Reuse the credential `reminderConfig` (default 90/60/30/7d milestones) — same milestone-cross logic as `generateCredentialRenewalNotifications` but limited to the two CMS credential type codes.
**EntityKey:** `cms-enrollment:{credentialId}:milestone:{N}`.
**Recipients:** Owners + admins (CMS revalidation is an admin task).
**Title/body example:**
- title: `"Medicare {pecos|provider} enrollment expires in {N} days"`
- body: `"Revalidation must be completed via PECOS before {expiryDate}."`
- href: `/credentials/{credentialId}`.

**Implementation note:** Could be a filter inside `generateCredentialRenewalNotifications` but keeping it as a separate generator avoids special-casing inside the credential generator. New generator `generateCmsEnrollmentNotifications` mirrors the credential one minus the `practiceUser` join (CMS enrollment isn't per-staff like a license).

### A4. `BREACH_DETERMINATION_DEADLINE_APPROACHING`

**Purpose:** HIPAA's 60-day breach-determination window is closing — 10 days remaining.
**Source:** `Incident` where `isBreach = true AND breachDeterminedAt IS NULL AND resolvedAt IS NULL AND discoveredAt < now() - 50 days AND discoveredAt > now() - 60 days`.
**Trigger:** Once per incident, when `discoveredAt + 50d <= today < discoveredAt + 60d`.
**EntityKey:** `breach-deadline:{incidentId}`.
**Recipients:** Owners + admins + the incident's `assigneeId` (if set).
**Severity:** `WARNING` (others use `INFO`). Surfaces the urgency.
**Title/body example:**
- title: `"Breach determination due in {N} days"`
- body: `"Incident {incidentNumber} discovered {date} requires HIPAA breach determination by {deadline}. Complete the breach risk assessment."`
- href: `/incidents/{incidentId}`.

### A5. `OSHA_POSTING_REMINDER`

**Purpose:** OSHA 300A summary must be posted Feb 1 – Apr 30. Annual reminder fires Jan 15.
**Source:** `PracticeFramework` where `enabled = true` joined to `RegulatoryFramework.code = 'OSHA'`. One row per OSHA-opted-in practice.
**Trigger:** Calendar window — fire when `today BETWEEN Jan 15 AND Feb 1` of any year.
**EntityKey:** `osha-posting:{year}` (year of the upcoming Feb 1 deadline).
**Recipients:** Owners + admins.
**Title/body example:**
- title: `"OSHA 300A posting due Feb 1"`
- body: `"Post the OSHA 300A summary in a visible location from Feb 1 through Apr 30. Generate it from the Reports page."`
- href: `/audit/reports` (links to OSHA 300A PDF generator).

**Implementation note:** This generator doesn't take an `expiresAt`/`lastReviewedAt` field — it's pure calendar logic. Skip outside the Jan 15 – Feb 1 window. Inside the window, emit one proposal per OSHA-enabled practice.

---

### Phase A test plan

5 new tests in dedicated file `tests/integration/notification-completeness-a.test.ts` (or split per generator if simpler):

- `POLICY_REVIEW_DUE`: seeds a policy with `lastReviewedAt = today - (365-30) days`, asserts proposal at 30d milestone, asserts no proposal at 31d, asserts no proposal when `lastReviewedAt + 365 < today` (overdue → out of scope).
- `TRAINING_OVERDUE`: seeds completion with `expiresAt = today - 91d`, asserts proposal; seeds newer passing completion → asserts NO proposal.
- `CMS_ENROLLMENT_EXPIRING`: seeds Medicare PECOS credential expiring in 30d, asserts proposal at 30d milestone; seeds non-CMS credential → asserts NO proposal.
- `BREACH_DETERMINATION_DEADLINE_APPROACHING`: seeds incident with `discoveredAt = today - 51d`, `isBreach = true`, asserts proposal; seeds incident with `breachDeterminedAt` set → asserts NO proposal.
- `OSHA_POSTING_REMINDER`: mocks `today = Jan 20`, seeds OSHA-opted-in practice, asserts proposal; mocks `today = Mar 1` → asserts NO proposal.

End-to-end dedup test: run `runNotificationDigest` twice, assert no duplicate Notification rows.

### Phase A acceptance

- 5 new enum values present in `NotificationType`.
- 5 new generators exported from `src/lib/notifications/generators.ts`.
- All wired into `generateAllNotifications` `Promise.all`.
- All 5 tests + 1 dedup test pass.
- Existing 494 tests still green.

---

## Phase B — 2 notification-scan escalation generators (1 PR)

Both escalation generators query the existing `Notification` table for "old without action" rows, then emit a manager-targeted escalation. Pattern is new (other generators read domain tables); call out the pattern in `generators.ts` with a comment.

### B1. `TRAINING_ESCALATION`

**Purpose:** Staff still hasn't completed overdue training after 14 days → notify manager.
**Source:** `Notification` rows where `type = 'TRAINING_OVERDUE' AND createdAt < now() - 14 days AND readAt IS NULL`. Filter to those whose corresponding `TrainingCompletion` still has no newer passing completion (same source query as A2 inverted).
**EntityKey:** `training-escalation:{completionId}` (note: keyed on completion, not on the source notification, so we don't escalate twice).
**Recipients:** Owners + admins (the manager target).
**Title/body example:**
- title: `"Staff training overdue: {staffName} — {courseName}"`
- body: `"{staffName} has had overdue training for 14+ days with no completion. Follow up directly."`
- href: `/training/staff/{userId}`.

### B2. `CREDENTIAL_ESCALATION`

**Purpose:** A `CREDENTIAL_EXPIRING` notification has gone unaddressed for 14+ days → notify manager.
**Source:** `Notification` rows where `type = 'CREDENTIAL_EXPIRING' AND createdAt < now() - 14 days AND readAt IS NULL` AND the underlying `Credential` is still active and unrenewed.
**EntityKey:** `credential-escalation:{credentialId}`.
**Recipients:** Owners + admins.
**Title/body example:**
- title: `"Credential expiring without action: {staffName} — {credentialType}"`
- body: `"{staffName}'s {credentialType} expiring on {date} hasn't been addressed for 14 days. Renew or follow up."`
- href: `/credentials/{credentialId}`.

### Phase B test plan

2 tests in `tests/integration/notification-completeness-b.test.ts`:

- `TRAINING_ESCALATION`: seed training completion with expiresAt 100d ago + a TRAINING_OVERDUE notification 15d old → assert escalation proposal. Seed a newer passing completion → assert NO proposal.
- `CREDENTIAL_ESCALATION`: seed credential expiring + CREDENTIAL_EXPIRING notification 15d old → assert escalation. Seed a renewed credential → assert NO proposal.

Dedup test: run digest twice, assert one escalation row.

### Phase B acceptance

- 2 new enum values.
- 2 new generators wired into `generateAllNotifications`.
- 2 + 1 dedup tests pass.

---

## Phase C — Cloud Scheduler job for weekly digest (out-of-repo)

The route exists at `src/app/api/notifications/digest/run/route.ts` and is currently invokable only manually. Schedule it weekly.

```bash
gcloud scheduler jobs create http guardwell-v2-weekly-digest \
  --project=guardwell-prod \
  --location=us-central1 \
  --schedule="0 14 * * 1" \
  --time-zone="America/New_York" \
  --uri="https://v2.app.gwcomp.com/api/notifications/digest/run" \
  --http-method=POST \
  --headers="X-Cron-Secret=$(gcloud secrets versions access latest --secret=CRON_SECRET --project=guardwell-prod)" \
  --attempt-deadline=300s
```

Schedule: Mondays 9 AM ET (`0 14 * * 1` UTC = 14:00 UTC = 9 AM ET during EDT, 10 AM ET during EST). Weekly cadence matches the digest's intent (not too noisy, not too sparse).

**Validation:** After creating, run `gcloud scheduler jobs run guardwell-v2-weekly-digest --location=us-central1 --project=guardwell-prod` and check Cloud Run logs for the digest endpoint hit + a 200 response. Then disable the manual run flag if any.

This is a **manual operator task** — needs explicit user approval to execute. The plan documents the command; the actual run happens with the user's go-ahead.

---

## Sequence of work

1. **Phase A implement + test + spec review + code-quality review + push + merge.**
2. **Phase B implement + test + spec review + code-quality review + push + merge.**
3. **Phase C — present scheduler command, await user approval, run.**
4. **Update memory** (launch-readiness file): chunk 8 → ✅, mention orphan-enum follow-up.

Each phase: subagent-dispatched implementation, then spec compliance review, then code quality review, then must-fix application. Same pattern as chunks 4–6.

## Estimated session time

- Phase A: ~2.5–3 hours (5 generators, 5+1 tests, mostly mechanical)
- Phase B: ~1.5 hours (2 generators with a new "scan notifications" pattern, 2+1 tests)
- Phase C: ~10 minutes (one gcloud command + validation log check)

Total: ~4.5 hours of focused work. Fits one session at chunk-6 velocity.

## Risks

| Risk | Mitigation |
|---|---|
| OSHA framework gating wrong (e.g., generator fires for non-OSHA practices) | Test seeds an OSHA-disabled practice → asserts NO proposal. |
| Escalation generators emit duplicates if `Notification.entityKey` collisions exist | EntityKey-on-completion (not on source notification) prevents this — see B1 design. |
| `BREACH_DETERMINATION_DEADLINE_APPROACHING` fires after determination is done | Source query checks `breachDeterminedAt IS NULL`. Test asserts. |
| New types overwhelm digest emails (too many bullets) | Digest already groups by type. Acceptable; revisit only if customer complains. |
| Schema enum mutation breaks existing notification consumers | None exist — `NotificationType` is read-only outside generators. |

## Done state for chunk 8

- 7 new NotificationType enum values applied to prod via auto-migration
- 7 new generators wired into `generateAllNotifications`
- 8 new integration tests (5 + 2 + 1 dedup) passing
- Cloud Scheduler weekly digest job operational
- Master plan updated: chunk 8 ✅
- Memory updated: chunk 8 progress + orphan-enum follow-up filed
