# V2 Launch Readiness Plan (rev 2 — post-audit)

**Created:** 2026-04-27
**Last revised:** 2026-04-27 — after comprehensive v1-vs-v2 feature audit
**Owner:** Noorros + Claude
**Status:** Active — substantially rewritten after audit revealed v2 dropped ~60% of v1 feature surface during the greenfield rebuild

## What changed in this revision

The original launch-readiness plan was based on the assumption that v2 was feature-complete relative to v1. It wasn't. A comprehensive audit (2026-04-27 morning) compared every v1 module/program/cron/notification surface against v2 and found:

- **Document retention is URL-only** (v1 had file uploads with S3) — **user-flagged blocker**
- **DEA module entirely absent** in v2 (v1 has 7 DEA-specific tables + Form 41/106 PDFs)
- **OSHA injury fields stripped from `Incident`** (no OSHA 300/301 export viable)
- **Breach memo PDF generation missing** (HIPAA §164.402 compliance gap)
- **Training is library-only** — no course creation, no BYOV, no certificate expirations, no CME
- **Credentials lost CEU/CME tracking + evidence uploads + NPPES verification**
- **BAA signing workflow removed** — vendors page lists names + expiry dates, that's all
- **Notification system shrank from 40+ types to 13** — missing escalations, gap detection, posting reminders
- **Cron jobs went from 7 to 1** — only `onboarding-drip` remains
- **Sanctions screening (LEIE/OIG exclusions) — entire feature gone**
- **60 v1 models with no v2 equivalent** (some intentional, many feature-loss)

This plan is the response. It re-prioritizes work to close compliance-breaking gaps before launch. The original buckets (reports + bulk CSV, allergy, evidence/CEU, hardening) are NOT discarded — most of them are now intermixed with the audit findings in a single prioritized sequence.

## Where we are right now (2026-04-27 morning)

**Live on prod (rev 00133):**
- Reports framework + 6 PDFs (PR #135 merged)
- Bulk CSV import on credentials/vendors/security-assets (PR #135)
- Allergy module — schema, projections, derivations, UI, quiz, notifications, AllergyExtras (PR #136 merged + prod migrated + seeded)
- Settings sidebar entry + redirect fixes (PR #137 merged)
- Allergy inactivity tracking + competency-due notification (PR #138 — schema migrated, awaiting merge)

**Test count:** 444 + new inactivity test = 445.

**Pending Noorros operational tasks** unchanged:
- Resend domain verification (`gwcomp.com` SPF/DKIM/DMARC)
- Marketing site CTA flip
- DNS flip plan
- Stripe webhook verification
- First-customer test on the live domain

## What's left before launch — the new prioritized sequence

Items 1–10 are the audit-derived priority list. Each ships as one or more PRs.

### 1. Document retention file uploads — CRITICAL · 1–2 days
**User-flagged blocker.** Real practices receive scanned PDFs and physical destruction certificates from vendors. V2's URL-only `certificateUrl` field forces them to host files externally, which breaks the workflow.

**Architecture decision:** instead of a one-off file column on `DestructionLog`, build the polymorphic `Evidence` model from the queued Evidence/CEU plan's Tasks 1–2 first. Document retention becomes the first surface to consume it. This unblocks Credentials (chunk 5) and post-launch surfaces (vendors, incidents, tech-assets, allergy drills) on the same infrastructure.

**Scope:**
- GCS storage helper (`src/lib/storage/gcs.ts`) with dev no-op fallback
- Polymorphic `Evidence` model keyed on `(entityType, entityId)`
- `Evidence` event types (UPLOAD_REQUESTED, UPLOAD_CONFIRMED, DOWNLOAD_URL_ISSUED, DELETED)
- High-level helpers (`src/lib/storage/evidence.ts`)
- API routes (`/api/evidence/upload`, `/api/evidence/download`, `/api/evidence/[id]`)
- `<EvidenceUpload>` client component
- DestructionLog-specific wiring: replace URL field with `<EvidenceUpload entityType="DESTRUCTION_LOG" entityId={...} />`
- Pre-existing `certificateUrl` field can stay as a fallback for legacy data

**Bucket pre-task for Noorros (out-of-band):** `guardwell-v2-evidence` GCS bucket + IAM + CORS + lifecycle. Storage helper falls back to no-op log mode in dev when `GCS_EVIDENCE_BUCKET` is unset, so this PR can land before the bucket exists; the upload won't actually work in prod until the bucket + env var are configured.

### 2. Incident breach memo PDF + individual notification tracking — CRITICAL · 2–3 days
HIPAA §164.402 requires a documented breach decision. OCR audits look for it. V2 schema retains the `breachDeterminationMemo` field but no UI generates one.

**Scope:**
- `/api/audit/incident-breach-memo-pdf/[id]` — render the 4-factor analysis + decision into a signed PDF
- Add `notifiedIndividualsAt`, `notifiedMediaAt`, `notifiedStateAgAt` DateTime fields to `Incident`
- UI to record notification dates as part of the breach response flow
- Update incident detail page to surface "Generate breach memo" once status moves to `RESOLVED` (or earlier if the user marks `breachDetermined=true`)

### 3. OSHA injury fields restored on `Incident` — CRITICAL · 2 days
V2 dropped `oshaBodyPart`, `oshaInjuryNature`, `oshaOutcome`, `sharpsDeviceType`, etc. Without them, OSHA 300/301 export is unviable.

**Scope:**
- Add the OSHA fields back to `Incident` (schema migration)
- "OSHA recordable" toggle on incident creation form; reveals OSHA-specific subform when checked
- `/api/audit/osha-300/route.tsx` — generates OSHA Form 300 PDF (annual log of work-related injuries)
- `/api/audit/osha-301/route.tsx` — generates OSHA Form 301 PDF (single-incident detail report)
- Add both reports to `/audit/reports`

### 4. DEA module — CRITICAL OR DEFERRED · 1 week (or 0 days if customer-segmented)
If any launch customer is DEA-certified, this is non-negotiable. If not, gate v2 to non-DEA practices for now and defer.

**Scope (if building):**
- 5 new schema models: `DeaInventory`, `DeaInventoryItem`, `DeaOrderRecord`, `DeaDisposalRecord`, `DeaTheftLossReport` (port v1 shapes)
- 5 corresponding event types + projections
- New `DEA` framework requirement set: inventory currency, biennial inventory reconciliation, theft/loss reporting compliance, EPCS audit logs
- `/programs/dea` shell with 4 sub-tabs (Inventory / Orders / Disposals / Theft & Loss)
- `/api/audit/dea-form-41/[id]` — Form 41 (Disposal) PDF
- `/api/audit/dea-form-106/[id]` — Form 106 (Theft/Loss) PDF
- `/api/audit/dea-inventory/[asOfDate]` — current inventory PDF

**Decision needed from Noorros:** does the first launch customer hold a DEA registration? If yes, this is week 1 work. If no, push to post-launch.

### 5. Credentials evidence uploads + CEU tracking + renewal reminders — IMPORTANT · 5 days
This is the existing Evidence/CEU plan (`docs/plans/2026-04-27-evidence-ceu-reminders.md`), now becomes chunk 5 since chunks 1–4 build the underlying infrastructure.

**Scope (already documented in the plan):**
- Use the `<EvidenceUpload>` component built in chunk 1 to attach license/board cert scans to `Credential` rows
- `CeuActivity` model + per-credential progress bar
- `CredentialReminderConfig` model + custom milestone schedule (default 90/60/30/7 days)
- Seed `MEDICAL_ASSISTANT_CERT` credential type (customer-asked)

### 6. BAA signing workflow + document storage — IMPORTANT · 3–4 days
V1 has `BaaRequest` + `BaaAcceptance` state machine + document upload + e-signature flow. V2 has zero — vendors page only stores expiry date.

**Scope:**
- Restore `BaaRequest` and `BaaAcceptance` models (or v2-equivalent state machine)
- Vendor detail page gets a "Send BAA" action that uploads a draft BAA → emails the vendor a link → vendor reviews + e-signs (text signature acceptable for v1; DocuSign integration is post-launch)
- BAA status states: `DRAFT` / `SENT` / `ACKNOWLEDGED` / `EXECUTED` / `EXPIRED`
- Document upload via the Evidence model from chunk 1
- BAA version history (replaces vs supersedes)

### 7. Training course creation + BYOV — IMPORTANT · 3–5 days
V1 has full course creation UI + video upload + `VideoProgress` tracking + certificate generation. V2 only renders pre-seeded library courses. Customers expect this, especially for practice-specific training.

**Scope:**
- `/programs/training/new` — course builder UI
- Video upload via Evidence model + GCS (chunk 1 infrastructure)
- `VideoProgress` model + projection for tracked watch time
- Certificate generation on completion (PDF with practice + course + completion date + score)
- Certificate expiration tracking (`expiresAt` on `TrainingCompletion`)
- CME credit field on `TrainingCourse` + per-staff CME totals

### 8. Notification system completeness — IMPORTANT · 2–3 days
V2 has 13 notification types vs v1's 40+. The missing notifications are how compliance drift gets surfaced — without them, problems sit silent until manual audit.

**Scope (highest-priority missing types):**
- `POLICY_REVIEW_DUE` — annual review reminder (90/60/30 days before `lastReviewedAt + 365`)
- `TRAINING_OVERDUE` — staff missed training deadline (90 days post-due)
- `TRAINING_ESCALATION` — TRAINING_OVERDUE × 2 → notify manager
- `CREDENTIAL_ESCALATION` — CREDENTIAL_EXPIRING × 2 with no action → notify manager
- `OSHA_POSTING_REMINDER` — annual reminder to post OSHA 300A summary
- `STATE_LAW_ALERT` — state regulatory updates (depends on v1's `RegulatoryAlert` polling, see chunk 9)
- `CMS_ENROLLMENT_EXPIRING` — Medicare/Medicaid revalidation reminder
- `BREACH_DETERMINATION_DEADLINE_APPROACHING` — 50 days post-discovery (10 days remaining of HIPAA's 60-day deadline)
- `SANCTION_FOLLOW_UP_DUE` — quarterly LEIE re-screen (depends on chunk 11)

### 9. Cron job restoration — IMPORTANT · 2 days
V2 has 1 cron (`onboarding-drip`). V1 has 7. Each missing cron is a mode of compliance drift.

**Scope (priority order):**
- `weekly-digest` — already exists as `/api/notifications/digest/run` (manual trigger only). Schedule it.
- `annual-audit-prep` — auto-generate annual audit prep sessions per practice (replaces current manual start)
- `regulatory` — poll for regulatory updates (depends on v1's `RegulatorySource`/`RegulatoryArticle` models — restore or skip)
- `account-cleanup` — trial expiry handling, inactive user cleanup
- `benchmark-compute` — compliance score benchmarking against industry baselines

### 10. Allergy 3-component journey view — IMPORTANT · 2 days
The user flagged the existing allergy flow as fragmented. The Compounders tab shows status but doesn't guide a compounder through the 3-component process. V1's monolithic dashboard had this; v2's tab split lost it.

**Scope:**
- Per-compounder "competency journey" panel (linked from each row in the Compounders tab)
- Shows: Quiz status (action: take quiz), Fingertip status (action: ask supervisor to attest after a passing test), Media fill status (action: ask supervisor to attest after passing 14-day incubation)
- Each step has explicit "what's next" copy
- Admin sees inline "Attest" actions next to each pending step (fewer clicks than the current dialog flow)

## Lower priority (NOT launch-blockers; post-launch backlog)

These v1 features are real but the audit found they don't block first-customer launch. Move them to backlog with named priority.

- **Sanctions screening (LEIE/OIG exclusions)** — quarterly screening cron + notification + UI to mark resolution. Required for some specialties; not all.
- **Technical Assessment / penetration testing** — `TechnicalAssessment` + `TechnicalAssessmentItem` + `SecurityTest` models + UI. Useful for bigger practices.
- **Risk item editing UI** — SRA completion exists, but post-completion risk-item edits + mitigation tracking missing.
- **Lab features (CLIA)** — `LabEquipment`, `LabMaintenanceLog`, `LabTest`, `QcLog`, `PtResult`. Only relevant to lab-having practices.
- **CMS/Medicare deep features** — billing audits, overpayment tracking, claim review.
- **State law tracking detail** — `StateLawItem` adoption per practice, per-state breach rule + retention rule + PDMP rule (some of this is in v2 jurisdiction-overlay code; depth varies).
- **Concierge chat** — v1 had dedicated support chat (`ConciergeConversation`/`ConciergeMessage`).
- **Network diagram snapshots** — security asset visualization.
- **Reporting suite expansion** — DEA forms (covered in chunk 4 if DEA built), technical assessment report, SRA remediation report, compiled-policies, audit-package.
- **Search across all resources** — comprehensive search v1 implied, v2 minimal.
- **My acknowledgments staff-facing view**.
- **Handbook upload + acknowledgment tracking** — `EmployeeHandbook` + `HandbookAcknowledgment`.

## Hardening (kept from prior plan)

These chunks were in the original plan and stay roughly intact, just renumbered.

### 11. Asset inventory → SRA wiring — 0.5 day
HIPAA_SRA derivation rule: requires ≥1 `TechAsset` with `processesPhi=true`. Surfaces a substantive SRA instead of attestation-only.

### 12. Admin dashboard MVP — 2 days
Practice list (search by name/email, view subscription status), customer health snapshot, manual subscription override (extend trial by 30 days).

### 13. A11y pass — 2 days
Keyboard nav, focus rings, color contrast (WCAG AA), screen reader smoke on 5 highest-traffic surfaces.

### 14. Security review prep — 2 days
Auth flow doc, RBAC matrix, RLS audit (every Prisma query scoped by `practiceId`), OWASP top-10 sweep, secret rotation runbook.

### 15. Performance pass — 1 day
Lighthouse on 5 key pages, bundle analyzer, slow-query review.

### 16. CI fix: prisma migration step in `cloudbuild.yaml` — 1 day
The schema-deploy outage on PR #136 was preventable. Add a `node:20-slim` step that downloads cloud-sql-proxy + runs `npx prisma db push --skip-generate` against prod via signed-PUT/secret env. Required IAM grants on Cloud Build SA (`cloudsql.client` + `secretmanager.secretAccessor`).

### 17. Operational handoff doc — 0.5 day
Resend setup, marketing CTA flip, DNS plan, smoke test script, 48-hour post-launch monitoring checklist.

## Estimated total remaining

If DEA stays in scope: **~6 weeks of focused work** (chunks 1–10 + hardening 11–17).

If DEA deferred via customer-segmentation: **~5 weeks of focused work**.

At current velocity (one major PR per session, 2–3 sessions per day): **3–4 weeks calendar time.**

## Out of scope for v2 launch (consciously deferred)

These were in the original plan and remain deferred. The audit didn't change this list.

- AI extraction from uploaded evidence — Phase 5 of the Evidence subsystem
- DocuSign-style BAA collection (text e-signature is launch-acceptable; DocuSign post-launch)
- AI-tailored training generation
- Knowledge base
- Handbook generator (1 customer ask away from queueing)
- Bulk staff assignments (1 multi-staff customer away from queueing)

## Risk register

- **Resend domain verification** could take 24–48 hours if DNS is wrong. Block: do this NOW.
- **GCS bucket setup gate** — chunks 1, 5, 6, 7 all depend on `guardwell-v2-evidence` bucket existing in prod. Get it created NOW so it's ready when code lands.
- **A11y fixes can cascade** — fixing one design-system primitive may ripple. Triage with the audit doc first, then prioritize.
- **Security review may find a real vuln** — leave time to fix.
- **DEA decision** — needs an answer this week. Will the first customer use DEA? If yes, week 1 commits to chunk 4.
- **OSHA decision** — same: if the first customer needs OSHA recordkeeping, chunk 3 is blocking.

## Done state

Launch is ready when chunks 1–17 are complete (or DEA is consciously deferred per chunk 4 decision), plus Noorros has confirmed:
- Resend domain verified, drip emails landing in inbox not spam
- GCS bucket created with correct IAM/CORS/lifecycle
- Marketing CTAs flipped on `gwcomp.com`
- DNS flip executed (`v2.app` → `app`)
- 1 friendly customer signed up + completed first-run wizard end-to-end on the live domain
- Cloud Build migration step shipped (chunk 16) to prevent the PR #136-style outage on future schema changes

## Reference: prior history

- 2026-04-19: V1 frozen, v2 greenfield decision
- 2026-04-25: Onboarding spec (Phases A–F) merged + deployed
- 2026-04-27 morning: PR #135 (reports + bulk) merged, PR #136 (Allergy) merged + recovered from migration outage, PR #137 (settings nav + redirect fix) merged, PR #138 (allergy inactivity) up
- 2026-04-27 audit: this rewrite

## Per-chunk acceptance criteria

Each chunk gets a separate plan doc as work begins. The original plan's acceptance criteria for chunks 11–15 (admin dashboard, a11y, security, perf) carry forward unchanged from the prior revision; copy them into the per-chunk docs when work starts.
