# v2 Feature Recovery — Master Roadmap

**Date:** 2026-04-28
**Status:** Active master plan
**Scope:** Bring v2 to feature-parity-or-better with v1 in user-felt depth, while raising every shipped surface to the documented quality bar. No timing constraint — this supersedes the launch-driven 16-week budget.
**Predecessor:** `2026-04-27-launch-readiness.md` (now folded into Wave 1 + Wave 2 of this plan)

---

## 1. Why this plan exists

A code + docs + chrome audit on 2026-04-27/28 confirmed two things:

1. **v2's architecture is sound.** Event sourcing (ADR-0001), regulations × operations matrix (ADR-0002), LLM-ops layer (ADR-0003), modules-as-data (ADR-0004), internal design system (ADR-0005) are all live and honored in code.
2. **v2's product is hollowed out.** Compared to v1 (live at app.gwcomp.com), v2 has dropped ~85% of API routes, ~45% of Prisma models, 89% of in-UI AI surfaces, 79% of training courses, 82% of SRA depth, 71% of cron jobs, 68% of notification types, and the entire AI Concierge. Several frameworks have requirements seeded but no derivation rules — a manual-only flip story masquerading as evidence-driven compliance.

The architectural wins are real. The product gap is also real. This plan executes both threads in parallel: **port the quality functionality from v1 into v2, and bring every surface v2 already has up to the standards documented in our ADRs and specs.**

---

## 2. Locked decisions (do not re-litigate)

These were decided before this plan and remain in force:

- Event sourcing without CQRS (ADR-0001).
- Regulations × operations sidebar (ADR-0002).
- LLM-ops thin wrapper with prompt registry + Zod outputs + eval harness (ADR-0003).
- Modules as data (ADR-0004).
- Internal design system on Shadcn (ADR-0005).
- Single-tier billing (`v2-decisions-locked.md`).
- 7-day trial, card required.
- US-only at launch, web-only at launch.
- No SOC 2 / HITRUST cert at launch.
- 14 modules at launch is the *framework data set*; operational depth follows demand.
- Stripe + Resend + Firebase Auth + Cloud Run + Cloud SQL.

Per scope confirmation in this plan's review:

- **Cloud Storage infrastructure: BUILD.** Unlocks BAA e-signature with PDFs, BYOV training videos, Document Hub, evidence file uploads on credentials/policies/risk/incidents.
- **AI training tailoring: HOLD.** Tracked in deferred register; revisit post-launch.
- **CLIA operational depth: HOLD.** Framework-only at launch (modules-as-data); 7 v1 operational models tracked in deferred register.
- **Security ops depth (network map / pentest tracking / phishing campaigns): MINIMAL.** Asset Inventory + log-only Cybersecurity stays; full pentest registry + network diagram + phishing campaign manager tracked in deferred register.

---

## 3. Quality bar — the "standards" thread

Every chunk in this plan is gated on these. Don't merge if any is missing.

### Architecture discipline
- All state changes go through `appendEventAndApply()`. Direct projection mutation outside `ALLOWED_PATHS` is blocked by ESLint rule `gw/no-direct-projection-mutation`.
- Every new framework requirement has a derivation rule in `src/lib/compliance/derivation/<framework>.ts` *before* it ships. No more "data exists, derivation TBD."
- Every new event type has a Zod schema in `EVENT_SCHEMAS` (`src/lib/events/registry.ts`).
- `npm run db:seed` includes the new seed if any seed work shipped.

### Testing
- Integration test under `tests/integration/<feature>.test.ts` exercising event → projection → derivation → score flip end-to-end. Pass in isolation. Cross-file pollution is a separate fix (Phase 0).
- Unit tests for any pure function with branching logic (derivation rules, calculators, parsers).
- Test fixtures namespace by `practiceId` to allow combined runs.
- New AI prompt: paired eval suite with at least 3 in-distribution + 1 out-of-distribution case.

### UX + a11y
- Internal design system components only on user-facing surfaces. No raw `<button>` / `<input>` / hard-coded colors. ESLint `gw/no-hardcoded-colors` enforces.
- jest-axe passes on Storybook gallery.
- Focus rings visible. `aria-label` on icon-only buttons. Keyboard-navigable forms.
- Every CTA has a tooltip or visible label explaining the action.

### AI surfaces
- Versioned prompt constant in `src/lib/ai/registry.ts`.
- Output validated by Zod schema before reaching UI.
- `redactPHI()` enforced unless `{ allowPHI: true }` is explicit in the call site (annotated with reason).
- Cost guard + rate limit (Upstash) wired per call site.
- `LlmCall` row written: practiceId, prompt version, token counts, latency, success/failure.
- Eval suite checked into `tests/evals/<surface>.eval.ts`.

### Brand voice + content
- Every user-facing string passes `brand-voice:enforce-voice` skill review (or matches existing in-repo voice).
- No emoji in product copy unless explicitly requested.
- Tone: confident, concrete, no hedging. Citations where regulatory.

### Security + privacy
- No PHI in logs. `redactPHI()` on user-input strings before any `console.log` / Sentry / LlmCall write.
- Server actions verify session + practice membership via `requireRole()`. Never trust `practiceId` from client.
- New routes added to `PUBLIC_ROUTES` only if intentional.
- CSP nonce: tracked in Phase 14 (waiting on Turbopack support per existing comment).

### Verification before merge
- `npx tsc --noEmit` clean.
- `npm run lint` clean (including `gw/*` rules).
- `npm run test:run` green for the touched files.
- Chrome-verify on `v2.app.gwcomp.com` after Cloud Run rollout for any user-facing change. Screenshot pasted in PR body.
- `verification-before-completion` discipline: never claim "done" without running verification commands.

### PR cadence
- 4 PRs per session ceiling, one feature each, Chrome-verified per PR.
- PR body lists: scope, schema migration (if any), event types added, projection paths added, eval results (if AI), Chrome screenshot.
- Merge to main triggers Cloud Build → Cloud Run rollout. Treat that as live to staging.

---

## 4. Roadmap structure

The work is grouped into **15 phases** organized into **4 waves**. Phases inside a wave can run in parallel; phases in a later wave depend on earlier waves.

```
Wave 1 — Foundation        Phase 0   v2 bug + foundation fixes
                           Phase 1   Cross-framework derivation completeness
                           Phase 3   Cloud Storage infrastructure

Wave 2 — Core depth        Phase 2   AI Concierge + Module Page Section G Extras
                           Phase 4   Training depth restoration
                           Phase 5   SRA depth + Risk / CAP workflow
                           Phase 7   Notification system depth
                           Phase 8   Regulatory intelligence engine

Wave 3 — Operational depth Phase 6   AI active features (policy / breach / CAP)
                           Phase 9   Operational depth restoration
                           Phase 10  51-state law overlay polish
                           Phase 11  Sanctions / LEIE screening
                           Phase 12  Compliance Track upgrades

Wave 4 — Polish + close    Phase 13  Audit Prep depth
                           Phase 14  Final polish (a11y, perf, security)

Ongoing                    Phase 15  Deferred-but-tracked register (review checkpoint per wave)
```

Each phase below lists scope, deliverables, dependencies, and a placeholder for the future detailed implementation plan that will be written via `superpowers:writing-plans` when the phase is picked up.

---

## Wave 1 — Foundation

### Phase 0 — v2 bug + foundation fixes

**Why:** v2 has small but visible defects that erode trust. Clear them before stacking new features.

**Scope**
- **Sidebar `Get started` link 404.** Dashboard sidebar's "Get started" entry hrefs `/programs/get-started`, which 404s. Real path is `/programs/track`. Fix the link and add a redirect from `/programs/get-started` → `/programs/track` for any external bookmarks.
- **Compliance Track auto-completion sync.** Live practice "Prod Smoke Test" shows HIPAA 89%, Track score ring 0%. Auto-completion check is not running on existing state. Add a derivation backfill for Track tasks tagged `auto-completes`, modeled on `scripts/lib/backfill-derivations.ts`. Wire to projection on policy adopt / officer designate / training complete / vendor BAA execute / SRA complete.
- **Score-ring "Not assessed yet" state.** Frameworks with score=0 currently render "At Risk" red. Per `docs/specs/module-page-contract.md` Section A, render a "Not assessed yet" blue state when no `ComplianceItem` rows exist for the framework × practice. v1 has this as "Setting Up" blue.
- **Cross-file integration test pollution.** 3+ tests in `tests/integration/hipaa-assess.test.ts` fail under combined runs (Upstash URL parse + cross-practice DB races). Fix: mock Upstash in that file like `runLlm.test.ts` does for Anthropic; namespace practice cleanup per vitest worker.
- **Resend domain verification.** Onboarding drip + daily digest cron exist but inert without verified domain. Document the gcloud / Resend Dashboard steps; user-blocking action — note in plan but the cron and templates are already shipped.
- **Cloud SQL tier upsize.** `db-g1-small` → `db-custom-1-3840` before real customer traffic. Single `gcloud sql instances patch` call, ~30s downtime.
- **Track `Notification.subjectType` enum strictness.** Audit the 13 current notification types for completeness — `notification-completeness.md` plan already addresses; absorb its scope here.
- **`.env.example` parity.** Confirm every `process.env.X` referenced in code is documented in `.env.example` (audit found 4 missing).

**Deliverables**
- 6–8 PRs, each with verification.
- Updated test suite: combined `npm run test:run` passes green.
- Cloud SQL resized.
- `MEMORY.md` updated to remove "known follow-ups" from `v2-current-state.md` for items closed.

**Dependencies:** none. Can start immediately.

**Future plan ref:** `docs/plans/<date>-phase-0-foundation-fixes.md`

---

### Phase 1 — Cross-framework derivation completeness

**Why:** Today's evidence-driven compliance only works for HIPAA. OSHA has 4 rules of 8 requirements; OIG 1 of 7; DEA 0 of 8; CMS 0 of 7; CLIA 0 of 8; MACRA 0 of 4; TCPA 0 of 5; Allergy 0 of 9. Every one of those is "data seeded, derivation TBD" — manually flipping a radio is the only path. This is the architectural fragmentation v2 is at risk of inheriting from v1.

**Scope by framework**

OSHA — full coverage of 8 requirements:
- `OSHA_BBP_EXPOSURE_CONTROL`, `OSHA_HAZCOM`, `OSHA_EMERGENCY_ACTION_PLAN` already wired (policy-driven).
- `OSHA_BBP_TRAINING` already wired (training-driven).
- New rules: `OSHA_300_LOG` (derived from `INCIDENT_REPORTED` events with `oshaRecordable=true` over the calendar year, requiring an OSHA 300 log entry per recordable incident).
- `OSHA_REQUIRED_POSTERS` (derived from a new `POSTER_ATTESTATION` event — annual posting attestation; supports 300A Feb 1 – Apr 30 reminder).
- `OSHA_PPE` (derived from a new `PPE_ASSESSMENT_COMPLETED` event — workplace hazard assessment per 29 CFR §1910.132(d)).
- `OSHA_GENERAL_DUTY` (derived from policy adoption + SRA risk-flag absence — composite rule).

DEA — full coverage of 8 requirements:
- `DEA_REGISTRATION` derives from credential `DEA_CONTROLLED_SUBSTANCE_REGISTRATION` non-expired.
- `DEA_BIENNIAL_INVENTORY` derives from `DEA_INVENTORY_RECORDED` events with `as-of date` within the last 24 months.
- `DEA_RECORDS_2YR` derives from inventory + order + disposal events being intact for the prior 2 years (audit trail check).
- `DEA_SECURE_STORAGE` derives from policy adoption (DEA_SECURE_STORAGE_POLICY).
- `DEA_PRESCRIPTION_SECURITY` derives from EPCS attestation event (new) + policy.
- `DEA_EMPLOYEE_SCREENING` derives from `LeieScreening` results (cross-references Phase 11).
- `DEA_THEFT_LOSS_REPORTING` derives from policy adoption + (any `DEA_THEFT_LOSS_REPORTED` events that exist must have `form106Filed=true`).
- `DEA_DISPOSAL` derives from `DEA_DISPOSAL_COMPLETED` events being non-empty for any retired controlled substance.

CMS — 7 requirements wired (provider enrollment, emergency preparedness, billing/Stark/AKS, 60-day overpayment, patient records, OIG exclusion screening, beneficiary notice). Most derive from policy adoption, OverpaymentRecord events, and LeieScreening (Phase 11).

OIG — extend from 1 to 7:
- `OIG_COMPLIANCE_OFFICER` already wired.
- `OIG_WRITTEN_POLICIES` derives from adoption of OIG-tagged policies.
- `OIG_TRAINING_EDUCATION` derives from ≥95% workforce completion of OIG-tagged courses.
- `OIG_COMMUNICATION_LINES` derives from policy adoption (anonymous reporting policy).
- `OIG_AUDITING_MONITORING` derives from `OigAnnualReview` event existence within the last 12 months.
- `OIG_ENFORCEMENT_DISCIPLINE` derives from policy adoption + LeieScreening cadence.
- `OIG_RESPONSE_VIOLATIONS` derives from the existence of resolved `OigCorrectiveAction` records.

MACRA / MIPS — 4 requirements at framework level. Most are activity-log driven (improvement activities, promoting interoperability). Wire to a new `MACRA_ACTIVITY_LOGGED` event + simple coverage threshold.

TCPA — 5 requirements. Wire to `TcpaVendor` upsert + `PatientConsentRecord` events + DNC list maintenance.

Allergy / USP 797 §21 — 9 requirements. Wire to allergy event types already shipping (PR #136). This phase confirms full coverage and runs the seed-time backfill.

**Backfill rerun.** After every framework's rules land, run `backfillFrameworkDerivations(db, frameworkCode)` to flip existing practices' state from manual-only to derivation-driven where evidence exists.

**Deliverables**
- 8 derivation files (one per framework) in `src/lib/compliance/derivation/`.
- New event types added to `EVENT_SCHEMAS`: `POSTER_ATTESTATION`, `PPE_ASSESSMENT_COMPLETED`, `MACRA_ACTIVITY_LOGGED`, `OigAnnualReviewSubmitted`, `OverpaymentReported`, plus any framework-specific.
- Updated seeds: `acceptedEvidenceTypes` populated on every requirement.
- Integration tests: one per framework asserting the rules fire end-to-end.
- All existing practices reflect the new derivation state after backfill.

**Dependencies:** none architectural. Phase 0 should run in parallel for stable test infra.

**Future plan ref:** Single phase plan, but execution will be 8 sub-PRs (one per framework). `docs/plans/<date>-phase-1-derivation-completeness.md`.

---

### Phase 3 — Cloud Storage infrastructure

**Why:** Three big v1 features (BAA e-signature with PDF, BYOV training video, Document Hub) all need the same infra. Plus evidence file uploads on credentials/policies/risk/incidents — currently impossible. Building once unlocks four.

**Scope**

Bucket + IAM
- Create GCS bucket `guardwell-v2-evidence` in `us-central1`. Uniform bucket-level access.
- Service account `guardwell-v2-storage@` with `storage.objectAdmin` on the bucket only.
- Cloud Run runtime SA gets read access via Workload Identity binding.
- Object naming convention: `practices/<practiceId>/<resourceType>/<resourceId>/<filename>` — practiceId scoping prevents cross-tenant leakage even if a misconfigured signed URL leaks.

Signed URL service
- `src/lib/storage/signedUrl.ts` exposes:
  - `getUploadUrl(practiceId, resourceType, resourceId, filename, contentType)` — returns a v4 signed PUT URL with 15-min TTL, content-type pinned.
  - `getDownloadUrl(practiceId, resourceType, resourceId, filename)` — returns a v4 signed GET URL with 5-min TTL.
- Server actions only — never expose signing keys to client.

Evidence model
- `Evidence` table (already exists per code audit). Confirm fields: id, practiceId, resourceType (POLICY|CREDENTIAL|RISK|INCIDENT|VENDOR|TRAINING_COMPLETION), resourceId, filename, contentType, sizeBytes, gcsObjectName, uploadedByUserId, uploadedAt, deletedAt.
- Events: `EVIDENCE_UPLOAD_REQUESTED`, `EVIDENCE_UPLOAD_CONFIRMED`, `EVIDENCE_DELETED` (already in registry per memory; verify and extend).
- Soft delete: deletion sets `deletedAt`, then a daily reaper cron actually purges from GCS after 30 days. Evidence-driven derivation respects `deletedAt IS NULL`.

Abuse + safety
- Per-practice quota: 5 GB at launch (configurable). Quota check inline in `getUploadUrl`. Hitting the limit returns a clear error — not a silent fail.
- Content-type allowlist by resourceType. Policies/credentials: `application/pdf`, `image/png`, `image/jpeg`. Training videos: `video/mp4` only at launch (no transcoding pipeline yet — video must be MP4 H.264).
- Filename sanitization (strip path traversal, length cap, slugify).
- Optional virus scan: Cloud Function trigger on bucket write that calls VirusTotal API. Out of scope for first pass — track in deferred. Document the TODO.

UI components
- `<EvidenceUploader resourceType resourceId>` in `src/components/gw/EvidenceUploader/`. Drag-drop zone, progress bar, success state, error states (quota / content-type / size). Uses signed URL flow.
- `<EvidenceList resourceType resourceId>` shows uploaded files with download link + delete button. RBAC: only OWNER/ADMIN can delete.

Feature unlocks (each lands in subsequent phases)
- BAA e-sig PDF generation (Phase 9)
- BYOV training video (Phase 4)
- Document Hub `/programs/document-hub` (Phase 9)
- Inline evidence on credentials/policies/risk/incidents (Phase 9)

**Deliverables**
- Bucket + IAM in Terraform / gcloud script (committed to repo).
- `src/lib/storage/` with full test coverage (mock GCS client).
- `<EvidenceUploader>` + `<EvidenceList>` components in design system.
- Reaper cron + Cloud Scheduler entry.
- Documented runbook in `docs/runbooks/cloud-storage.md` for bucket lifecycle, quota raises, abuse incident response.

**Dependencies:** none, but unblocks Phase 4 (BYOV) and Phase 9 (BAA e-sig + Document Hub).

**Future plan ref:** `docs/plans/<date>-phase-3-cloud-storage.md`

---

## Wave 2 — Core depth

### Phase 2 — AI Concierge + Module Page Section G Extras

**Why:** Two highest-impact user-felt gaps in the comparison.

**Scope: AI Concierge** (`/concierge`)

Schema (new tables)
- `ConciergeConversation`: id, practiceId, userId, title (auto-generated from first message), createdAt, lastMessageAt.
- `ConciergeMessage`: id, conversationId, role (user|assistant|system), content, tokenCount, modelVersion, createdAt.
- `LlmCall` row written per assistant turn (links to conversation via metadata).

UI
- New route `/concierge` (not under modules).
- Layout: history sidebar on left (paginated conversation list, click to load), main panel with messages, input box at bottom, suggested-questions chip row when conversation is empty.
- Streaming via Anthropic SDK `messages.stream()`.
- PHI banner: "Do not enter Protected Health Information (PHI). Concierge provides general compliance guidance only." Persistent above input.
- Suggested questions tied to current practice state (e.g., if HIPAA score < 80, suggest "What are my biggest HIPAA gaps?").
- Mobile responsive (sidebar collapses to drawer).

System prompt
- Versioned in `src/lib/ai/prompts/concierge.system.v1.ts`.
- Includes: practice profile (specialty, state, size), enabled frameworks, current score, top 3 gaps, last 5 events. Refreshed per turn (cached for 5 min).
- Hard rules: never advise specific legal/clinical action, always cite regulation, refuse PHI input.

Eval suite
- `tests/evals/concierge.eval.ts` with 10 representative compliance questions + expected behavior (cites regulation, suggests action, refuses PHI). Run on every prompt-version bump.
- Regression gate: any answer that hallucinates a regulation citation fails the suite.

Cost guard
- Hard cap per-practice: 100 messages / day at launch. Soft warning at 80. Configurable in `Practice.aiQuotaPerDay`.

**Scope: Module Page Section G Extras** (per `docs/specs/module-page-contract.md`)

Per-framework extras registry at `src/components/gw/ModuleExtras/`. Each framework's extras component is registered and conditionally rendered on `/modules/[code]`.

HIPAA
- Breach Notification Calculator widget. Inputs: PHI involved (yes/no), individuals affected count, low-probability-of-compromise (LPC) outcome, jurisdiction. Outputs: notification deadline, required parties (HHS, individuals, media if 500+, state AG per state law), draft memo link.
- NPP version diff link (already exists at `/programs/policies/<id>/history`).

OSHA
- 300A annual posting reminder banner. Visible Feb 1 – Apr 30. Yellow chrome + "Download 300A" button + `Posting attestation` button (emits `POSTER_ATTESTATION` event).
- 300/300A/301 log link.
- PPE assessment widget (kicks off the new `PPE_ASSESSMENT_COMPLETED` flow).

DEA
- Form 106 (theft/loss) generator link.
- Form 41 (disposal) generator link.
- EPCS Review attestation widget.

CMS
- STARK disclosure widget.
- 60-day overpayment ledger summary.

OIG
- LEIE screening summary (last screened date, match count) — fully realized in Phase 11.
- OIG Annual Review link.

DEA controlled substance and CMS overpayment widgets emit events that drive Phase 1 derivation rules.

Inline major-breach banner on `/programs/incidents` list — when any incident has `isBreach=true` AND `affectedIndividuals >= 500`, show a red banner at top: "MAJOR BREACH — HHS notification due within 60 days" with countdown to deadline.

**Deliverables**
- `/concierge` page + sidebar history + streaming + eval suite + cost guard.
- 7 module-extras registry entries (HIPAA / OSHA / DEA / CMS / OIG / CLIA / Allergy at minimum).
- Inline major-breach banner.
- Updated `module-page-contract.md` open-question table (closes O-2 deadline display, etc.).

**Dependencies:** Phase 1 (derivation) for the OSHA 300A and DEA EPCS event types; Phase 3 not strictly required for Concierge but lets Concierge cite uploaded evidence if available.

**Future plan ref:** Two sub-plans likely. `docs/plans/<date>-phase-2a-concierge.md` and `docs/plans/<date>-phase-2b-module-extras.md`.

---

### Phase 4 — Training depth restoration

**Why:** Single biggest functional regression. v2 is library-only; v1 is a teaching system.

**Scope**

Schema additions
- `TrainingAssignment` model: id, practiceId, courseId, assignedToUserId? (null = role-based), assignedToRole? (OWNER|ADMIN|STAFF|VIEWER), assignedToCategory? (clinical|administrative|management|other), dueDate, requiredFlag, createdAt, createdByUserId.
- `AssignmentExclusion` model: id, assignmentId, userId, reason, excludedAt, excludedByUserId.
- `PolicyTrainingPrereq` model (joins Phase 9 policy work): policyTemplateId / policyId → trainingCourseCode. Surfaces "Requires training: <name>" inline on policy rows. Acknowledgment blocked until training complete.

Events
- `TRAINING_ASSIGNED` (assigner, assignee or role/category, courseId, dueDate, required).
- `TRAINING_ASSIGNMENT_REVOKED`.
- `STAFF_EXCLUDED_FROM_ASSIGNMENT` (with reason).
- `TRAINING_COURSE_CREATED` (admin authored a custom course; AI-tailored is HOLD per scope decision but the schema must support it later).
- `TRAINING_COURSE_UPDATED` (version bump).
- `TRAINING_COURSE_RETIRED`.

UI
- `/programs/training` redesign:
  - KPI band: "My Progress %", "Completed", "In Progress", "Team Completions" tiles.
  - Tabs: My Training | Manage Courses (OWNER/ADMIN only) | Assignments (OWNER/ADMIN only).
  - Filters: To Do | In Progress | Completed | Overdue + category chips (HIPAA / OSHA / OIG / DEA / Custom).
  - Course rows: title, framework, duration, due date, status badge, Start/Resume/Retake button.
  - Bulk action: "Auto-Assign required to Team" — assigns all `requiredFlag=true` system courses to all active staff per role mapping.
- `/programs/training/manage` (OWNER/ADMIN): course CRUD list, archive, version, "Create course" button.
- `/programs/training/assignments`: per-staff completion grid. Rows = staff. Columns = required courses. Cell = status (pending / in progress / completed date / expired).
- Course completion certificate auto-generated on pass — stored in GCS via Phase 3 — downloadable from completion record.
- BYOV (bring-your-own-video) for custom courses: video upload via `<EvidenceUploader>` (Phase 3), playback in lesson view, `VideoProgress` tracking, ≥80% watch threshold required to unlock quiz.

Bulk content port from v1
- Port the remaining v1 system courses (5 OSHA, 4 OIG, 3 CMS, 2 DEA, 2 TCPA — confirm exact count from v1 export) following the existing JSON-fixture pattern in `scripts/_v1-hipaa-101-export.json` etc. After this phase, v2's library matches v1's at ~30+ courses.

Notifications
- Hooks for Phase 7: emit notification on assignment, due-soon (configurable lead times), overdue, expiry approaching.

**Deliverables**
- 5 new schema models + 6 new event types + projections.
- Redesigned `/programs/training` + 2 new admin sub-pages.
- v1 content port complete.
- Per-staff completion grid functional.
- Integration tests for assignment + completion + due-date flow.

**Dependencies:** Phase 3 (GCS for video + certificates).

**Future plan ref:** `docs/plans/<date>-phase-4-training-depth.md`

---

### Phase 5 — SRA depth + Risk / CAP workflow

**Why:** v2's 20-safeguard SRA is an order of magnitude shallower than v1's 80-question SRA + 35-question Technical Assessment. Real OCR audits demand the depth.

**Scope**

SRA expansion
- Port v1's 80-question SRA, structured per OCR's framework: Administrative Safeguards (§164.308), Physical Safeguards (§164.310), Technical Safeguards (§164.312).
- New `SraQuestion` rows: id, code, section (ADMIN|PHYSICAL|TECHNICAL), citation, prompt, helperText, riskWeight (LOW|MEDIUM|HIGH), category (e.g., "access control", "audit controls").
- Migration path for the 20 currently-seeded safeguards: map them onto the 80-question structure where they fit; deprecate the rest. No customer data loss — `PracticeSraAnswer` is event-sourced.
- `PracticeSraAssessment` flow:
  - Multi-step wizard (one section per step, save & continue).
  - Per question: Yes/No/N-A radio + free-text notes + evidence link (`<EvidenceUploader>`).
  - Auto-score: % of "Yes" + adjusted by risk weight.
  - Generates risk register on submit: every "No" answer becomes a `RiskItem`.

Technical Security Assessment
- Separate but linked instance: 35 questions across 6 categories (Access Controls, Audit Logging, Encryption, Backup, Network Security, Endpoint Hardening).
- Designed for IT providers / MSPs. Practice can complete themselves or delegate to MSP via shareable link.
- Findings auto-feed into the SRA evidence chain.

Risk register + CAP
- `RiskItem` model: id, practiceId, source (SRA|TECHNICAL_ASSESSMENT|MANUAL|INCIDENT_FOLLOWUP), category, severity, description, status (OPEN|MITIGATED|ACCEPTED|TRANSFERRED), createdAt, createdByUserId.
- `CorrectiveAction` model: id, riskItemId, description, assignedToUserId, dueDate, status (PENDING|IN_PROGRESS|COMPLETED|OVERDUE), evidenceIds[].
- `/programs/risk` redesign:
  - Risk Register tab: filterable, sortable list of risk items.
  - SRA tab: current + history (already exists, gets enriched with the 80-question shape).
  - Technical Assessment tab: new.
  - CAP tab: timeline view of all corrective actions with deadlines.
- AI assistance for CAP plan generation in Phase 6.

Events
- `SRA_QUESTION_ANSWERED` (granular — replaces today's all-or-nothing SRA_DRAFT_SAVED for partial save support).
- `SRA_SUBMITTED` (full assessment finalized).
- `RISK_ITEM_CREATED`, `RISK_ITEM_UPDATED`, `RISK_ITEM_RESOLVED`.
- `CORRECTIVE_ACTION_CREATED`, `CAP_STATUS_UPDATED`, `CAP_COMPLETED`.

**Deliverables**
- 80-question SRA seeded.
- 35-question Technical Assessment seeded.
- Risk Register + CAP register live.
- Integration tests for SRA → RiskItem → CAP flow.
- Module page HIPAA_SRA derivation continues to work (now satisfied by submitted SRA within 365 days).

**Dependencies:** Phase 3 (evidence uploads).

**Future plan ref:** `docs/plans/<date>-phase-5-sra-and-risk.md`

---

### Phase 7 — Notification system depth

**Why:** v1 has 40+ notification types + per-category lead times + nudge engine + weekly AI digest. v2 has 13 types + a daily digest cron that doesn't email yet.

**Scope**

Notification type expansion (target: 40+)
- Credential expiring (per configured lead time: 90/60/30/7).
- Training overdue / due in N days / certification expiring.
- Policy pending acknowledgment / annual review due.
- Incident reported / breach determined / notification deadline approaching.
- BAA signature required / expiring / executed.
- Compliance alert (regulatory feed match — Phase 8).
- Regulatory update (state law change).
- DEA biennial inventory reminder.
- OSHA 300A posting reminder (Feb 1 trigger).
- LEIE screening overdue (Phase 11).
- SRA refresh due (12 months from last submitted).
- Audit Prep session opening (Phase 13).
- Phishing drill due (Phase 15 deferred — but type registered now).
- Backup verification overdue.
- Document destruction overdue.
- Subscription past due / canceled / billing issue.
- Welcome to drip email day-N.
- Generic system (e.g., "Cloud SQL maintenance tonight").

Per-practice configuration
- `Practice.reminderSettings` JSON. Per-category lead time arrays:
  - `credentials: [90, 60, 30, 7]`
  - `training: [60, 30, 14]`
  - `policies: [30, 7]`
  - `baa: [60, 30]`
  - etc.
- Settings page at `/settings/reminders` lets OWNER/ADMIN edit + opt out per category.

Per-user preference
- `NotificationPreference` model (already exists). Confirm fields: cadence (INSTANT|DAILY|WEEKLY|NONE), channels (EMAIL, IN_APP, both), categoryFilters (array), digestTime, digestDay (for weekly).
- `/settings/notifications` lets each user configure.

Generators
- `src/lib/notifications/generators/` — one file per notification type. Each pure function: takes a context, returns a `NotificationDraft`. Easy to test.
- Projection-driven creation: subscribers in event projections call generators inline. (e.g., `INCIDENT_REPORTED` projection → `incidentReported.generate()` → upsert Notification rows for all OWNER/ADMIN of the practice.)

Delivery
- Daily digest cron `/api/notifications/digest/run` — already wired. Confirm it batches by user, respects preferences, includes only unsent items.
- Weekly digest cron — new `/api/notifications/digest-weekly/run`. AI-generated summary using a prompt that takes the week's notifications + score change + top action. Saves the digest text to `Notification.body` and sends.
- Critical types (breach, MFA warning, billing-past-due) bypass digest — sent immediately even if user prefers weekly.

Resend domain
- Verify `gwcomp.com` (or chosen sender domain) on Resend.
- DKIM + SPF DNS records.
- Configure `EMAIL_FROM` env var.
- Bounce + complaint handling (Resend webhook → suppress flagged addresses).

**Deliverables**
- 40+ notification types registered with templates.
- Generator library with per-type tests.
- Daily + weekly digest crons.
- Resend domain live + bounce handling.
- `/settings/reminders` + `/settings/notifications` pages.
- Integration tests for projection → notification flow per type.

**Dependencies:** Phase 1 (some types subscribe to Phase 1 events). Phase 8 (regulatory alerts feed in).

**Future plan ref:** `docs/plans/<date>-phase-7-notifications.md`

---

### Phase 8 — Regulatory intelligence engine

**Why:** Differentiator from v1. Healthcare regs change continuously; an engine that scans + summarizes + alerts is high-leverage.

**Scope**

Schema (port from v1)
- `RegulatorySource`: id, name, url, feedType (RSS|ATOM|SCRAPE), lastIngestedAt, isActive.
- `RegulatoryArticle`: id, sourceId, title, url, summary, publishDate, rawContent, ingestedAt, relevanceTags (string[]).
- `RegulatoryAlert`: id, practiceId, articleId, alertBody (AI-generated), recommendedActions (string[]), severity (INFO|ADVISORY|URGENT), sentAt, dismissedAt.
- `AlertAction`: id, alertId, description, ownerUserId, dueDate, completionStatus.

Cron
- `/api/cron/regulatory/ingest` — daily 6 AM ET. Walks all active sources, fetches new articles since `lastIngestedAt`, dedupes by URL, writes rows.
- `/api/cron/regulatory/analyze` — daily 7 AM ET. For each new article, calls Claude with a prompt that takes article + relevance tags + healthcare framework taxonomy → returns relevance score per framework + suggested action body. Writes `RegulatoryAlert` rows for any practice whose enabled frameworks match.
- `/api/cron/regulatory/notify` — daily 8 AM ET. Creates `Notification` rows for new alerts (per preference cadence).

Sources at launch (~10)
- HHS OCR breach portal RSS.
- HHS OIG Work Plan / Compliance Today (scrape).
- OSHA news room RSS.
- DEA Diversion Control news (scrape).
- CMS regulatory updates (scrape).
- HealthIT.gov news.
- Selected state AG breach notification feeds (CA, TX, NY at minimum).
- AMA news.
- AHA news.
- Becker's Hospital Review compliance category.

UI
- `/audit/regulatory` page. Lists active alerts with filter by severity, framework, dismissed/active.
- Per-alert detail: full article, AI-generated implication summary, recommended actions, "Acknowledge" + "Add to my CAP" buttons.
- Admin can toggle source on/off.

LLM ops
- Prompt versioned: `analyzer.regulatory-relevance.v1`.
- Eval suite: 20 known articles with expected framework matches + severity classifications.
- Cost guard: max 200 article-analyses per day across all practices.

**Deliverables**
- 4 schema models, 3 cron endpoints, 1 UI page.
- 10 ingestion sources configured.
- Eval suite + prompt versioned.
- Per-practice subscription respects framework set.

**Dependencies:** Phase 7 (notifications) for delivery.

**Future plan ref:** `docs/plans/<date>-phase-8-regulatory-engine.md`

---

## Wave 3 — Operational depth

### Phase 6 — AI active features (policy / breach / CAP)

**Why:** v1's 9 in-UI AI surfaces include high-value active flows that v2 has dropped. This phase restores three: policy personalization, breach triage, CAP generation. Plus re-evaluates Run AI Assessment.

**Scope**

Policy personalization
- `PolicyAiJob` model: id, practiceId, policyTemplateId or existingPolicyId, mode (DRAFT_FROM_TEMPLATE|GAP_FILL_FROM_UPLOAD), status (PENDING|RUNNING|COMPLETE|FAILED), result JSON, error, createdAt, completedAt.
- `/programs/policies/personalize/<templateId>` flow:
  - Step 1: practice profile review (specialty, state, size, modules).
  - Step 2: optional upload existing policy PDF (parsed to text via pdf-parse).
  - Step 3: Claude run — prompt `policy.personalize.v1` returns gap-filled markdown body + change summary.
  - Step 4: admin reviews diff, edits, accepts. Creates `PracticePolicy` with `aiGenerated=true`, `aiJobId=<id>`.
- Async job pattern: server action enqueues job; client polls every 3s; UI shows progress.
- Eval suite: 5 policy templates × 3 specialty profiles, expected gap-fill behavior.
- Mandatory admin review (no auto-publish).

Breach triage
- Hooked to `/programs/incidents/new`.
- After basic incident details entered (PHI involved, individuals affected, type), "Run AI breach triage" button.
- Claude analyzes: affected individuals × type × state → returns:
  - Breach likelihood (HIGH|MEDIUM|LOW with HIPAA §164.402 four-factor reasoning).
  - Notification deadlines (HHS, individuals, media if 500+, state AG per state law lookup).
  - Draft notification memo (markdown) with placeholders for practice fields.
- Output reviewed by admin before any action. Memo can be exported to PDF (Phase 3 evidence flow).

CAP generation
- Hooked to `/programs/risk/<id>` risk item detail.
- "Suggest remediation plan" button.
- Claude prompt `risk.cap-generate.v1` takes risk item + practice context → returns 3–5 CAP steps with timeline and responsibility suggestion.
- Admin reviews, edits, assigns owners + due dates, saves as `CorrectiveAction` rows.

Run AI Assessment re-evaluation
- The original "Run AI assessment on this module" button was hidden in PR #34 because output was generic boilerplate. Try a sharper version:
  - New prompt `requirement.assess.v2` takes specific requirement + practice's existing evidence + uploaded files (Phase 3).
  - Output is a *gap analysis* (specific to what's missing), not a generic compliance summary.
  - If eval suite shows substantive output (>70% of test cases produce actionable specific recommendations), re-enable the button. If still generic, leave hidden and update deferred register.

LLM ops compliance
- All four prompts in `src/lib/ai/prompts/`. Versioned constants.
- Zod-validated outputs.
- `redactPHI()` on all uploaded user content before Claude calls.
- Cost guard: per-job ceiling, per-practice daily ceiling.
- Eval suite required for merge.

**Deliverables**
- 4 AI surfaces wired (or 3 + documented re-deferral on Run AI Assessment).
- `PolicyAiJob` async pattern proven and reusable for future jobs.
- Updated audit trail: AI-generated content visible as such in event log.

**Dependencies:** Phase 1 (derivation rules to interpret), Phase 3 (PDF parsing + evidence storage).

**Future plan ref:** `docs/plans/<date>-phase-6-ai-active-features.md`

---

### Phase 9 — Operational depth restoration

**Why:** Brings v2's thin operational pages up to v1's user-felt depth, plus surfaces the 130 already-seeded policy templates that today are invisible.

**Scope by surface**

Policies (`/programs/policies`)
- **Template Library is already surfaced** — 115 templates visible to an AZ practice (130 total in the export, filtered by `stateFilter`/`specialtyFilter`). Search + framework dropdown work. **Gap: no per-template preview.** Each row only has an Adopt button, which immediately copies the body into a new `PracticePolicy` and fires `POLICY_ADOPTED`. Users can't read the policy before committing.
- **Per-template preview** — `/programs/policies/templates/[code]` route renders full template body in markdown, with framework + state + specialty metadata, "Adopt this template" CTA at top + bottom, "Compare to existing" if a `PracticePolicy` of the same code already exists. Modal version on the index page (click row → drawer with preview, adopt button stays primary).
- **Adoption with optional edit** — current flow copies body verbatim. Add: "Adopt + edit now" alternative that opens the editor at `/programs/policies/[id]` immediately after adopt. Keep "Adopt as-is" as fast path.
- **Required vs Adopted vs Library** tab structure (mirrors v1's Adopted / Not Applicable / Templates).
- **KPI tile bar:** Active Policies count / Adoption Coverage % / Required Missing / Team Acknowledgment %.
- **Per-row controls:** Edit, Upload PDF (uses Phase 3), Attach Evidence, Read & Acknowledge, Mark Reviewed, Retire.
- **Policy ↔ Training prereq surfaced inline:** "Requires training: <Course Name>" with deep link. If the user hasn't completed the prereq training, the Acknowledge button is disabled with tooltip "Complete <course> first."
- **Acknowledgment tracking** — already exists at `/programs/policies/<id>/acknowledgments`. Surface counts on the index row and at the KPI level.
- **Admin acknowledgment gate** — for Admin-Only policies, OWNER/ADMIN must acknowledge before staff are assigned.
- **Bulk actions:** Mark all selected reviewed, Send acknowledgment reminders to outstanding staff, Export adopted policies as PDF.

Vendors (`/programs/vendors`)
- **Vendor discovery** — add a "Suggest vendors" tab that searches a curated database of common healthcare vendors (EHR, billing, payroll, etc.) by service type.
- **Risk tier** field — LOW / MEDIUM / HIGH affects derivation weight. Default based on PHI access + service type.
- **2026 HIPAA Security Rule safeguard verification** fields: encryption, MFA, audit logging, breach timeline (days), incident-clause-in-BAA flag. Displayed as checklist on vendor detail.
- **BAA full e-signature workflow** (uses Phase 3):
  - Practice-initiated: practice fills BAA template, generates PDF, sends signed token URL to vendor email. Vendor clicks, reviews, types signature, submits → server generates final signed PDF, both parties get download.
  - Vendor-initiated: vendor uploads their existing BAA PDF, practice approves.
  - Token TTL: 30 days. Token usage tracked in `BaaRequest`.
  - Replaces v1's `/baa/sign/[token]` flow with the same UX, on v2 infra.
- **BAA expiry tracking** — emits `BAA_EXPIRING_SOON` notifications per Phase 7 lead times.

Incidents (`/programs/incidents`)
- **Filter tabs:** All / Open / Investigating / Privacy / Security / OSHA.
- **OSHA 300A annual posting reminder** banner (Feb 1 – Apr 30). Linked to `OSHA_REQUIRED_POSTERS` derivation.
- **OCR notification tracking** — per breach: HHS notification status (NOT_DUE | DUE | SENT_DATE), individuals notification status, media notification status, state AG notification per state.
- **Breach memo PDF** generation (already in launch-readiness chunk 4 — confirm landed).
- **Breach calculator widget** — already covered in Phase 2 module extras for HIPAA, surface from `/programs/incidents/new` as well.
- **Inline major-breach banner** — already in Phase 2.
- **OSHA 300/300A/301 generator** — link to `/api/audit/exports/osha-300/route.ts`.

Credentials (`/programs/credentials`)
- **Reminder thresholds** per credential — configurable lead times overriding the practice default (e.g., this DEA expires in 90/60/30/7 days). Emits `CREDENTIAL_EXPIRING` notifications per Phase 7.
- **Document upload** — evidence per credential (license PDF, board cert) using Phase 3.
- **Custom per-practice credential types** — OWNER/ADMIN can add a non-system credential type (e.g., "ACLS — Advanced").
- **CEU activity tracking** — already shipping per memory (PR #112). Confirm complete.
- **Per-holder grouping + practice-level section** — already exists.

DEA (`/programs/dea`)
- **Restore Checklist tab** — same as v1 DEA Compliance Checklist with auto-detection bullets per requirement (driven by Phase 1 DEA derivation rules).
- **Restore Access Log tab** — per-drug administered/dispensed/wasted log entries with user, timestamp, quantity. Required by DEA recordkeeping for some practices.
- **Restore EPCS Review tab** — Electronic Prescribing of Controlled Substances audit. Periodic review event + findings + corrective actions.
- **Form 106 (theft/loss)** PDF generator — already in launch-readiness chunk; confirm landed.
- **Form 41 (disposal)** PDF generator — confirm landed.
- **Inventory tab** — already exists; thicken with biennial reminder (24-month timer).
- **Orders tab** — already exists; map to CSOS order records.

Document Hub (`/programs/document-hub`) — new
- General-purpose practice file storage (uses Phase 3).
- Folders: Policies / Forms / BAAs / Audit Records / Other.
- Retention rules: tag a document with retention period; integrates with Document Retention destruction log.
- Search by filename + tag.

Document Retention (`/programs/document-retention`)
- Already exists; thicken with state-specific retention rules surfaced inline (Phase 10 dependency).

Staff (`/programs/staff`)
- **Designations tab** — Privacy / Security / Compliance / Safety officer toggle (already exists).
- **Staff category** — clinical / administrative / management / other. Drives policy + training assignment routing.
- **MFA enforcement** UI — already partially shipping; confirm.
- **Training assignments per staff** — link to Phase 4 grid.

**Deliverables**
- Policies surface gets 5 user-facing additions (templates browser, KPIs, training prereq display, evidence upload, bulk actions).
- Vendors gets BAA e-sig + risk tier + safeguard verification + discovery tab.
- Incidents gets filter tabs + OSHA 300A reminder + OCR tracking columns.
- Credentials gets per-credential lead times + evidence + custom types.
- DEA gets 3 restored tabs.
- Document Hub launches.

**Dependencies:** Phase 3 (cloud storage), Phase 1 (DEA derivations), Phase 4 (training prereq link), Phase 7 (notifications), Phase 10 (state retention rules).

**Future plan ref:** Likely 4–5 sub-plans by surface. `docs/plans/<date>-phase-9a-policies.md`, etc.

---

### Phase 10 — 51-state law overlay polish

**Why:** Already ~80% there (51 jurisdictions seeded). What remains is surfacing the data in context.

**Scope**
- **Per-state breach notification** — calculator output (Phase 2) routes to correct state AG per `StateBreachRule` row.
- **State retention rules** surfaced on `/programs/document-retention` — per-record-type retention period from `StateRetentionRule`.
- **State PDMP rules** surfaced on `/programs/dea` — prescriber participation requirement, mandatory reporting cadence per `StatePdmpRule`.
- **State mandatory reporting** surfaced contextually on Incidents — suspected child abuse, elder abuse, etc., per `StateMandatoryReport`.
- **State-specific policy templates** filtered into the templates browser (Phase 9).
- **Multi-state practice support** — `Practice.operatingStates[]` array (already exists). Show overlays from all operating states, not just primary.

**Deliverables**
- 4 state-rule reference tables surfaced in 4 product surfaces.
- Multi-state practice scenario tested (practice based AZ but operating in CA + TX shows all three states' overlays).

**Dependencies:** Phase 9 (vendor surfaces) and Phase 2 (HIPAA breach calc).

**Future plan ref:** `docs/plans/<date>-phase-10-state-overlays.md`

---

### Phase 11 — Sanctions / LEIE screening

**Why:** Required for any practice billing Medicare/Medicaid. v1 has it; v2 dropped it.

**Scope**

Schema
- `Sanction`: id, type (LEIE|OIG|STATE|OTHER), individualOrOrgName, npi?, sanctionType, effectiveDate, source, status.
- `LeieScreening`: id, practiceId, scope (STAFF|VENDORS|BOTH), runAt, runByUserId or "CRON", resultCount, matches JSON.
- `LeieMatch`: id, screeningId, subjectType (STAFF|VENDOR), subjectId, matchedAgainst (sanctionId), matchScore, status (PENDING_REVIEW|FALSE_POSITIVE|CONFIRMED), reviewedByUserId, reviewedAt.

Data ingestion
- Monthly download from OIG LEIE database (CSV + ZIP from oig.hhs.gov).
- Parse + diff against existing `Sanction` rows.
- Cron `/api/cron/leie-update` monthly.

Screening cron
- Monthly cron `/api/cron/leie-screen` per practice per active staff/vendor.
- Compares names + NPIs against `Sanction` rows.
- Creates `LeieMatch` rows for review.
- Notifications fire on new matches (Phase 7).

UI
- `/programs/sanctions` page (or fold into `/programs/staff` and `/programs/vendors` as a section — TBD per design review).
- Per-staff + per-vendor screening status badge: Clear / Pending Review / Match.
- Match review workflow: admin reviews, marks false positive or confirmed.
- Confirmed match for staff → blocks scheduling shifts (out of scope at launch; flag in deferred).
- Confirmed match for vendor → blocks new BAAs.

Derivation
- `OIG_LEIE_SCREENING` requirement derives from any `LeieScreening` event within last 30 days.
- `DEA_EMPLOYEE_SCREENING` derives from staff LEIE screening + license verification.

**Deliverables**
- LEIE database ingest cron live.
- Per-practice screening cron live.
- Match review UI.
- Phase 1 OIG_LEIE_SCREENING + DEA_EMPLOYEE_SCREENING rules wired.

**Dependencies:** Phase 1 (derivation), Phase 7 (notifications).

**Future plan ref:** `docs/plans/<date>-phase-11-sanctions.md`

---

### Phase 12 — Compliance Track upgrades

**Why:** Bug already in Phase 0. This phase enriches.

**Scope**
- **Per-week milestone cards** with progress bar per week.
- **"Sync"** button — recomputes auto-completes from current state. (Today the sync only happens reactively on event; explicit re-derive helps users stuck at 0/12.)
- **"Reset"** button (OWNER only) — clears track progress and re-generates from current week. Useful if practice profile changes drastically.
- **Track length consideration** — keep 12 weeks at launch. Decide later whether to extend to 90 days (v1 length, 82 tasks) based on customer feedback.
- **Notification:** weekly "this week's track" email, references upcoming milestone.

**Deliverables**
- Sync + Reset buttons.
- Weekly track digest notification type.
- Per-week visualization.

**Dependencies:** Phase 0 (bug fix), Phase 7 (notification).

**Future plan ref:** `docs/plans/<date>-phase-12-compliance-track.md`

---

## Wave 4 — Polish + close

### Phase 13 — Audit Prep depth

**Why:** Audit Prep is one of v2's strongest surfaces (4 modes vs v1's 2). This phase ensures depth + automation parity.

**Scope**
- **Annual auto-creation cron** on signup anniversary ±7 days. Creates `AuditPrepSession` for the practice's primary framework focus. Notification fires.
- **Investigation Response (reactive) mode** — for OCR / OSHA / OIG / DEA / CMS investigations. Agency-specific document request checklist.
- **PDF packet generator** — confirm includes uploaded evidence (Phase 3) inline, not just metadata.
- **Per-mode question set** — review against current OCR / OSHA / OIG / DEA inspection guides; update where regs have shifted in 2026.
- **Mock investigator chat** — optional Phase 6 AI assist that role-plays an OCR investigator. Useful for practice prep.

**Deliverables**
- Auto-create cron live.
- Investigation Response mode complete with 5 agency types.
- PDF packet includes inline evidence.

**Dependencies:** Phase 3 (evidence in PDFs).

**Future plan ref:** `docs/plans/<date>-phase-13-audit-prep.md`

---

### Phase 14 — Final polish

**Why:** Things we know are technical debt but aren't blocking.

**Scope**
- **Score-ring "Not assessed" empty state** — already in Phase 0.
- **A11y comprehensive audit** — manual screen reader walk-through across 20 highest-traffic surfaces. Fix any blockers.
- **Performance audit** — Cloud Run cold start budget (target <2s p95). Prisma N+1 review on `/modules/[code]` and `/audit/overview`. Add indexes where needed.
- **CSP nonce restoration** — re-evaluate when Turbopack supports auto-nonce injection. Until then, current `'unsafe-inline'` posture stays documented.
- **Storybook extraction** — `/internal/design-system` is currently in-app. Decide whether to extract to a real Storybook tool. Defer if cost > value.
- **Cross-file integration test pollution** — already in Phase 0.
- **Component prop completeness** — `ModuleHeader` is missing `lastScoredAt`, `scoreLabel`, `shortName` per spec. Audit + complete the design system component spec.
- **Documentation: customer-facing help center** — currently no `/help` page in v2. Port v1's knowledge base content if it still applies. Or build new with framework × topic taxonomy.
- **Operational runbooks** — `docs/runbooks/` for Cloud Storage, LEIE ingest, regulatory cron, billing webhook recovery, schema migration on prod.
- **Brand voice pass** — run `brand-voice:enforce-voice` on all user-facing copy, especially error messages and email templates.

**Deliverables**
- A11y baseline + remediation log.
- Performance benchmarks documented.
- Help center live (or deferred with rationale).
- 5+ runbooks committed.

**Dependencies:** prior phases shipped.

**Future plan ref:** `docs/plans/<date>-phase-14-polish.md`

---

## Wave Ongoing

### Phase 15 — Deferred-but-tracked register

These are not silently dropped — they're scheduled for review at the end of each wave. Each item has:
- **Why deferred**
- **What unblocks it**
- **Estimated scope**

Items currently on the register:

#### AI training tailoring
- **Why deferred:** Auto-generated training content with regulatory citations is an accuracy/legal risk. v1 had it; v2 dropped pre-launch.
- **What unblocks it:** Eval discipline + admin-approval gate (the user explicitly requested this scope when revisiting).
- **Approach when it lands:** AI generates draft → review queue → OWNER/ADMIN reads + edits + approves → publishes. No auto-publish ever.
- **Estimated scope:** ~2 weeks. Reuses Phase 4 course-creation infra + Phase 6 AI-job pattern.
- **Review trigger:** end of Wave 2.

#### CLIA operational depth (7 v1 models)
- **Why deferred:** Most non-lab practices don't need it. Launch goal is HIPAA + OSHA + OIG operational depth; CLIA stays as data-only (manual radios on `/modules/clia`).
- **What unblocks it:** First lab customer or in-house-lab cohort signal.
- **Approach when it lands:** 7 models from v1 (LabTest / QcLog / CompetencyAssessment / PtResult / LabEquipment / LabMaintenanceLog / CliaInspection) ported as new event types + projections + `/programs/clia` operational page.
- **Estimated scope:** ~3–4 weeks.
- **Review trigger:** end of Wave 3, or first lab signup.

#### Full Security ops suite
- Network Map / Pentest tracking / Phishing campaigns / Backup verification deep workflow.
- **Why deferred:** Asset Inventory + log-only Cybersecurity satisfies launch; the full v1 surface is heavy.
- **What unblocks it:** Customer demand or first MSP-as-customer signup.
- **Approach when it lands:**
  - Network Map: SVG diagram editor (or accept text-based topology description). Low ROI; only if pushed.
  - Pentest tracking: SecurityTest + SecurityTestFinding ports from v1, evidence uploads, remediation linking to risk register.
  - Phishing campaigns: PhishingDrill model already exists. Build out: campaign creator, employee click tracking, training auto-assigned to clickers.
  - Backup verification: BackupVerification cadence + automated test logging + alert on missing.
- **Estimated scope:** 2 weeks per sub-area, total ~8 weeks if all four ship.
- **Review trigger:** end of Wave 3.

#### Mobile native apps (iOS + Android)
- **Why deferred:** Already in `v2-decisions-locked.md`. Web-only at launch.
- **What unblocks it:** Customer signal + revenue.
- **Approach:** likely React Native or Capacitor for code reuse. Start with read-only dashboard + nudge inbox.
- **Review trigger:** post-launch, after first 50 customers.

#### International (non-US)
- **Why deferred:** Locked. US-only at launch. Healthcare regulatory framework set is fundamentally US (HIPAA / OSHA / DEA / CMS).
- **Approach when it lands:** Adapter pattern — `RegulatoryFramework` rows keyed by jurisdiction code (US|CA|UK|AU|EU). Modules-as-data scales naturally.
- **Review trigger:** strategic decision, not feature-driven.

#### SOC 2 Type II / HITRUST certification
- **Why deferred:** Locked. Table stakes long-term but not for first 50 customers.
- **What unblocks it:** First enterprise sales conversation that requires it.
- **Estimated scope:** 6 months end-to-end including audit firm engagement.
- **Review trigger:** strategic.

#### "Run AI Assessment" on module page (re-evaluation in Phase 6)
- If Phase 6's sharpened prompt still produces generic boilerplate, leave hidden permanently.
- **Review trigger:** Phase 6 eval results.

---

## Wave sequencing — explicit dependencies

```
Wave 1 — Foundation (parallel)
  Phase 0 ── independent ──┐
  Phase 1 ── independent ──┤
  Phase 3 ── independent ──┘
                            │
                            ▼
Wave 2 — Core depth (mostly parallel, ordered by dependencies)
  Phase 7 ── needs Phase 1 ──┐
  Phase 2 ── needs Phase 1 ──┤
  Phase 8 ── needs Phase 7 ──┤
  Phase 4 ── needs Phase 3 ──┤
  Phase 5 ── needs Phase 3 ──┘
                              │
                              ▼
Wave 3 — Operational depth (parallel, ordered by dependencies)
  Phase 6  ── needs Phases 1+3 ──┐
  Phase 9  ── needs Phases 1+3+4+7 ──┤
  Phase 10 ── needs Phase 9 ──┤
  Phase 11 ── needs Phases 1+7 ──┤
  Phase 12 ── needs Phases 0+7 ──┘
                                  │
                                  ▼
Wave 4 — Polish + close (sequential, low parallelism)
  Phase 13 ── needs Phase 3 ──┐
  Phase 14 ── needs all ────┘
```

Estimated wave count: 4. No timing on this plan — but for context, Wave 1 alone is roughly the scope of v2's first 4 weeks of original build. Wave 4 is light. The shape:

- Wave 1 ≈ heavy (foundation rebuild)
- Wave 2 ≈ heaviest (most user-felt features)
- Wave 3 ≈ medium-heavy
- Wave 4 ≈ light polish

---

## Open risks

1. **Resend domain verification** is user-blocking. Drip + digest crons are inert until the domain is verified. Cannot be fixed by code alone.
2. **Cloud SQL cost.** As features add, query patterns change. Tier upsize is in Phase 0; ongoing cost monitoring needed.
3. **AI cost.** Adding Concierge + 4 active AI surfaces + regulatory analyzer + eval suites pushes Anthropic spend up. Cost guard ceilings + per-practice quota in `Practice.aiQuotaPerDay` field. Watch monthly burn.
4. **GCS abuse vector.** BYOV + Document Hub means user-uploaded files. Quota + content-type allowlist are first defense. Consider VirusTotal or Cloud Function malware scan in Phase 14.
5. **Schema migration discipline.** Auto-migration on Cloud Build is wired (`docs/deploy/auto-migrations.md`). Each phase's schema additions must be additive-first; destructive changes require explicit RFC.
6. **Test pollution.** Combined integration runs still race. Phase 0 fixes the known cases; the pattern (mock external services + namespace cleanup per worker) needs to be enforced for all new tests.
7. **Brand voice drift.** Many phases ship customer-facing strings. Without consistent enforcement (`brand-voice:enforce-voice`), voice will drift. Add to PR checklist.
8. **Plan freshness.** This plan is point-in-time. Each wave should produce a "wave debrief" that updates the master plan with discovered scope, dropped items, or new deferred-register entries.

---

## How to execute against this plan

For each phase as it's picked up:

1. Run `superpowers:writing-plans` with the phase scope to produce a detailed implementation plan with TDD checkpoints. Save under `docs/plans/<date>-phase-<N>-<name>.md`.
2. Execute via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` (inline alternative).
3. Each chunk lands as a PR. PR body lists what's done + Chrome-verify screenshot + test evidence + eval results (if AI).
4. After phase complete, `MEMORY.md` updates: `v2-current-state.md` reflects new state, deferred-register reviewed for items unblocked.

Per `collaboration-preferences.md`:
- Use plugins. `superpowers:writing-plans` for plans, `engineering:architecture` for any new ADR (e.g., the GCS bucket architecture deserves one), `superpowers:test-driven-development` for execution.
- Brief, direct PR descriptions. No padding.
- Chrome-verify before claiming done.
- 4 PRs per session ceiling, one feature each.

---

## Appendix A — Feature parity checklist (v1 → v2)

Tracking what's ported and what's tracked-deferred. ✅ shipped, 🔧 in scope this plan, ⏸ deferred-tracked, ❌ permanently dropped.

| Feature | v1 | v2 today | Plan disposition |
|---|---|---|---|
| Multi-framework compliance (HIPAA + OSHA + OIG + CMS + DEA + CLIA + MACRA + TCPA + Allergy + Risk) | ✅ | partial | 🔧 Phase 1 fills derivation, Phase 9 fills operations |
| State law overlays (51 jurisdictions) | ✅ scattered | ✅ | 🔧 Phase 10 surfaces in context |
| AI Concierge (full streaming chat) | ✅ | ❌ | 🔧 Phase 2 |
| AI policy personalization (Claude generates from template + practice profile) | ✅ | ❌ | 🔧 Phase 6 |
| AI training tailoring | ✅ | ❌ | ⏸ Phase 15 |
| AI breach triage (Claude analyzes incident → notification timeline) | ✅ | ❌ | 🔧 Phase 6 |
| AI CAP generation | ✅ | ❌ | 🔧 Phase 6 |
| Regulatory feed analysis (cron + Claude relevance) | ✅ | ❌ | 🔧 Phase 8 |
| Sales chat (marketing site) | ✅ | n/a | ❌ marketing repo concern, out of scope |
| BAA full e-signature workflow (token + PDF + bidirectional) | ✅ | thin | 🔧 Phase 9 |
| BAA expiry tracking + reminder cadence | ✅ | partial | 🔧 Phase 7 + Phase 9 |
| 2026 HIPAA Security Rule vendor safeguard verification | ✅ | ❌ | 🔧 Phase 9 |
| BYOV training (video upload + progress) | ✅ | ❌ | 🔧 Phase 4 (depends on Phase 3) |
| Custom course creation (admin authors) | ✅ | ❌ | 🔧 Phase 4 |
| Auto-Assign training to team | ✅ | ❌ | 🔧 Phase 4 |
| Per-staff training completion grid | ✅ | ❌ | 🔧 Phase 4 |
| Training course due dates + overdue tracking | ✅ | ❌ | 🔧 Phase 4 |
| Policy ↔ Training prerequisites | ✅ informal | ❌ | 🔧 Phase 4 + Phase 9 |
| Policy template library browser (130+ templates) | ✅ | ✅ surfaced (115 for AZ), but no preview before adopt | 🔧 Phase 9 adds per-template preview + "Adopt + edit now" path |
| Policy version control + diff view | ✅ | ✅ | (already shipped) |
| Policy admin acknowledgment gate | ✅ | partial | 🔧 Phase 9 |
| Per-policy evidence attachment | ✅ | ❌ | 🔧 Phase 9 (depends on Phase 3) |
| 80-q SRA + 35-q Technical Assessment | ✅ | thin (20 safeguards) | 🔧 Phase 5 |
| Risk register | ✅ | thin | 🔧 Phase 5 |
| CAP register + remediation timeline | ✅ | ❌ | 🔧 Phase 5 |
| Audit Prep — Annual Readiness | ✅ | ✅ (4 modes) | 🔧 Phase 13 polish |
| Audit Prep — Investigation Response | ✅ | ❌ | 🔧 Phase 13 |
| Audit Prep — PDF packet with inline evidence | ✅ | partial | 🔧 Phase 13 (depends on Phase 3) |
| Audit Prep — Annual auto-creation cron | ✅ | ❌ | 🔧 Phase 13 |
| Compliance Reports (8 PDFs) | ✅ | ✅ (7 PDFs) | 🔧 Phase 9 + Phase 13 add OIG Annual + SRA Remediation + Technical Assessment |
| 90-day Compliance Track | ✅ (82 tasks) | partial (12 weeks, buggy) | 🔧 Phase 0 + Phase 12 |
| Concierge during onboarding (setup-mode hints) | ✅ | wizard handles it | (intentionally folded into wizard, no work needed) |
| Document Hub (general file storage) | ✅ | ❌ | 🔧 Phase 9 (depends on Phase 3) |
| Document Retention + destruction log | ✅ | partial | 🔧 Phase 10 surfaces state-specific rules |
| Notifications — 40+ types | ✅ | partial (13) | 🔧 Phase 7 |
| Notifications — per-category lead times | ✅ | ❌ | 🔧 Phase 7 |
| Notifications — daily + weekly digest | ✅ | partial | 🔧 Phase 7 |
| Sanctions / LEIE screening | ✅ | ❌ | 🔧 Phase 11 |
| DEA — Checklist tab with auto-detection | ✅ | ❌ | 🔧 Phase 9 |
| DEA — Access Log tab | ✅ | ❌ | 🔧 Phase 9 |
| DEA — EPCS Review tab | ✅ | ❌ | 🔧 Phase 9 |
| DEA — Inventory / Orders / Disposals / Theft tabs | ✅ | ✅ | (already shipped) |
| OSHA — 300A annual posting reminder | ✅ | ❌ | 🔧 Phase 2 + Phase 9 |
| OSHA — 300/300A/301 generator | ✅ | partial | 🔧 Phase 9 |
| Major Breach inline banner with deadline | ✅ | ❌ | 🔧 Phase 2 + Phase 9 |
| Allergy / USP 797 §21 module | ✅ | ✅ (PR #136) | (in-flight; finalize derivation in Phase 1) |
| CLIA operational suite (LabTest + QC + Competency + PT + Equipment + Maintenance + Inspections) | ✅ | ❌ | ⏸ Phase 15 |
| Asset Inventory | ✅ | partial | 🔧 Phase 9 thicken |
| Network Map | ✅ | ❌ | ⏸ Phase 15 |
| Security Testing / Pentest tracking | ✅ | ❌ | ⏸ Phase 15 |
| Phishing campaigns | ✅ | log-only | ⏸ Phase 15 |
| Backup verification | ✅ | log-only | ⏸ Phase 15 |
| Concierge AI on every page | ✅ | partial (Ask AI tooltip read-only) | 🔧 Phase 2 + Phase 6 sharpens it |
| Audit & Insights cross-framework view | ❌ (v1) | ✅ | (v2 win — keep) |
| Audit & Insights activity log with AI explain | ❌ | ✅ | (v2 win — keep) |
| Audit & Insights compliance calendar | ❌ | ✅ | (v2 win — keep) |
| Stripe billing pipeline + webhooks | ✅ legacy | ✅ | (v2 win — keep) |
| Onboarding wizard + bulk invite + drip | partial | ✅ | (v2 win — keep, fix Resend domain) |
| Modules-as-data architecture | ❌ | ✅ | (v2 win — preserves "INSERT not deploy" for new frameworks) |
| Event sourcing + audit trail | ❌ scattered | ✅ | (v2 win — keep) |

---

## Appendix B — File / module references

For implementers: where things live in v2 today.

```
src/
├─ app/(dashboard)/
│  ├─ modules/[code]/        Single dynamic module template (renders any RegulatoryFramework)
│  ├─ programs/              Operational pages — most thinness lives here
│  └─ audit/                 Cross-framework — audit/overview, audit/activity, audit/calendar, audit/prep, audit/reports
├─ components/gw/            Internal design system (11 component dirs, 78 files)
├─ lib/
│  ├─ ai/                    LLM ops: client.ts, runLlm.ts, registry.ts, costGuard.ts, rateLimit.ts, redact.ts
│  ├─ compliance/
│  │  ├─ derivation/         Per-framework rules: hipaa.ts, osha.ts, oig.ts, shared.ts; index.ts spreads
│  │  ├─ policies.ts         Canonical policy codes + metadata
│  │  └─ scoring.ts          Score computation
│  ├─ events/
│  │  ├─ registry.ts         EventType union + EVENT_SCHEMAS Zod
│  │  ├─ append.ts           appendEventAndApply
│  │  ├─ replay.ts           Replay events for audit/forensics
│  │  └─ projections/        Per-domain projection handlers (29 files)
│  ├─ notifications/
│  │  ├─ generators/         Per-type templates
│  │  └─ run-digest.ts
│  └─ storage/               (NEW Phase 3) signedUrl.ts + abuse controls
├─ proxy.ts                  Next.js 16 middleware (auth + CSP)
prisma/
└─ schema.prisma             56 models today; growing per phase
scripts/
├─ seed-*.ts                 Per-framework seeds + content fixtures
└─ lib/backfill-derivations.ts
docs/
├─ adr/                      ADR-0001 through ADR-0005
├─ specs/                    module-page-contract.md (live), onboarding-flow.md (draft), v1-ideas-survey.md (reference)
├─ plans/                    This plan + per-phase plans (to be written)
├─ handoffs/                 Per-session debriefs
└─ runbooks/                 (NEW Phase 14) operational runbooks
tests/
├─ integration/              47 tests today, growing per phase
└─ evals/                    (NEW per phase) eval suites for AI prompts
```

---

## Appendix C — How memory should evolve as this plan executes

`MEMORY.md` index entries to add or update:

- **`v2-feature-recovery-master.md`** (NEW memory file pointing at this plan path).
- **`v2-current-state.md`** updated each session to reflect new wave/phase progress.
- **`v2-deferred-roadmap.md`** updated to match Phase 15 register exactly.
- **`v2-decisions-locked.md`** unchanged unless a re-litigation is genuinely needed.

End-of-wave memory checkpoint:
- Audit `v2-current-state.md` for staleness.
- Add a "Wave N debrief" entry summarizing what shipped, what slipped, what's next.

---

**End of master roadmap.**
