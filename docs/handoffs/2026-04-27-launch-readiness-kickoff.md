# 2026-04-27 — Launch Readiness Kickoff Handoff

**Session ended:** 2026-04-27 evening, after the onboarding spec went fully live in prod (Phases A–F all merged + deployed).

**Where the project is:** Onboarding spec complete. Now mid-flight on the launch-readiness plan. Three implementation plans are written and queued; Noorros is bunkered down for night. Next session picks up here.

---

## In flight right now

**[PR #135](https://github.com/noorros/guardwell-v2/pull/135) — Reports + Bulk CSV import/export** — open, unmerged.

Branch: `feat/launch-1-reports-framework` (off main)
Commits on the branch:
- `44ca972` — `feat(reports): vendor+BAA register, credentials register, P&P attestation`
- `d64539e` — `feat(programs): bulk CSV import + export for security-assets, vendors, credentials`

What ships:
- 3 new PDF reports (vendor+BAA register, credentials register, annual P&P attestation) on top of the 3 already shipped (compliance snapshot, training summary, incident summary)
- Generic `<BulkCsvImport>` component + tech-asset / vendor / credential bulk-import surfaces + CSV export endpoints
- Updated launch-readiness master plan committed alongside

**Status:** TypeScript clean, dev-server smoke passed (`/programs/security-assets/bulk-import` renders correctly, `/pricing` redirect verified, `/api/security-assets/export` 401s without cookie as expected). Did not chrome-verify the full upload-then-import round trip — that's the merge-and-verify step.

**Recommended first action next session:** verify PR #135 + merge if clean. Cloud Build will deploy in ~3 min. Then chrome-verify the bulk-import surfaces against prod with the seeded test practice.

---

## Queued (plans written, ready to execute)

### Allergy module — `docs/plans/2026-04-27-allergy-module.md`

15-task plan, 7 days estimated. **Customer-blocking** (real customer asked for it before launch).

Faithful port of v1's allergy/USP 797 §21 subsystem to v2's modules-as-data + event-sourced architecture. Adds:
- `RegulatoryFramework` row + 9 requirements (4 derived + 5 policy-attestation)
- 5 new event types (`ALLERGY_QUIZ_COMPLETED`, `ALLERGY_FINGERTIP_TEST_PASSED`, `ALLERGY_MEDIA_FILL_PASSED`, `ALLERGY_EQUIPMENT_CHECK_LOGGED`, `ALLERGY_DRILL_LOGGED`)
- 5 new schema models (`AllergyCompetency`, `AllergyQuizQuestion`, `AllergyQuizAttempt`, `AllergyQuizAnswer`, `AllergyEquipmentCheck`, `AllergyDrill`)
- `compoundsAllergens` flag on compliance profile (auto-enables the framework)
- `requiresAllergyCompetency` per-PracticeUser flag
- `/programs/allergy` 3-tab surface (Compounders, Equipment, Drills)
- `/programs/allergy/quiz` standalone quiz runner
- 4 derivation rules + 4 integration tests
- 3 notification generators (drill due, fridge overdue, kit expiring)

**Pre-task for Noorros:** export v1's `AllergyQuizQuestion` rows as JSON to `scripts/_v1-allergy-quiz-export.json`. The seed script reads it. Plan includes the exact `psql COPY` command. (Optional — the schema lands without quiz content; questions can be ported later.)

The USP 797 §21 training course content is already authored at `scripts/_v2-allergy-courses.json` from a prior session. Just needs to be added to `scripts/seed-training.ts` (Task 5).

### Evidence uploads + CEU tracking + renewal reminders — `docs/plans/2026-04-27-evidence-ceu-reminders.md`

13-task plan, 5 days estimated. Three integrated subsystems addressing gaps Noorros surfaced during this session's review:
1. **Evidence uploads** — polymorphic `Evidence` model + GCS direct-to-bucket via signed PUT URLs. Credential is the first surface; vendors / incidents / tech assets / drills follow post-launch.
2. **CEU tracking** — `CeuActivity` model + per-credential progress bar + CredentialType ceuRequirementHours/Months defaults.
3. **Renewal reminders** — `CredentialReminderConfig` model + custom milestone schedule (default 90/60/30/7) + extension to existing notification cron.

Plus one micro-task (**Task 11**): seed `MEDICAL_ASSISTANT_CERT` credential type. Customer specifically asked.

**Pre-task for Noorros:** create the `guardwell-v2-evidence` GCS bucket + apply CORS + lifecycle + grant Cloud Run SA access + set the `GCS_EVIDENCE_BUCKET` env var on the service. Exact gcloud commands listed in the plan's "Pre-Task" section + `docs/ops/2026-04-27-gcs-bucket-setup.md` (created in Task 12 of the plan).

In dev, the storage helper falls back to a no-op log mode when `GCS_EVIDENCE_BUCKET` is unset — so all the schema/projection/UI work can proceed locally without the bucket. Just upload won't actually work until the bucket exists.

---

## After the queued plans land

Per `docs/plans/2026-04-27-launch-readiness.md`, remaining chunks are:

| # | What | Effort |
|---|------|--------|
| 5 | Asset inventory → SRA wiring | 0.5 day |
| 6 | Admin dashboard MVP (practice list, health snapshot, sub override) | 2 days |
| 7 | A11y pass (keyboard, contrast, focus, screen reader smoke) | 2 days |
| 8 | Security review prep (auth, RBAC, RLS audit, OWASP basics) | 2 days |
| 9 | Performance pass (bundle size, slow queries, Lighthouse) | 1 day |
| 10 | Operational handoff doc for Noorros | 0.5 day |

Total remaining after Allergy + Evidence/CEU: ~8 days = 2-3 working sessions.

---

## Pending user actions (Noorros only)

These are what Noorros has to do himself — none of them block the next coding session:

1. **Verify + merge PR #135** (when ready) — Cloud Build auto-deploys to prod
2. **Export v1 allergy quiz questions** to `scripts/_v1-allergy-quiz-export.json` (one-time `psql COPY`)
3. **Create `guardwell-v2-evidence` GCS bucket** (gcloud commands in the Evidence plan)
4. **Verify Resend domain** (`gwcomp.com` SPF/DKIM/DMARC) — drip emails go to spam without it; cron is wired but inert
5. **Marketing CTA flip** — `gwcomp.com` waitlist gate → trial gate (single config change in marketing repo)
6. **DNS flip plan** — `v2.app.gwcomp.com` → `app.gwcomp.com` at launch

---

## How to start the next session

1. Read this file + `docs/plans/2026-04-27-launch-readiness.md`
2. Decide which plan to execute next: Allergy (customer-blocking) or Evidence/CEU
3. If Allergy → read `docs/plans/2026-04-27-allergy-module.md` start to finish, then dispatch with `superpowers:subagent-driven-development`
4. If Evidence/CEU → read `docs/plans/2026-04-27-evidence-ceu-reminders.md`, confirm bucket setup status with Noorros, then dispatch
5. PR #135 sitting open — recommend merging it before starting either plan so the new code doesn't pile up

---

## Environment gotchas (carry-overs from this session)

- **Docker Desktop daemon flakes** — `docker ps` returning "cannot find pipe" sometimes means Docker Desktop is closed; ask Noorros to open it. Recovery is fast (~5s once Docker comes back).
- **gcloud auth expires** — re-run `gcloud auth login --account=it@noorros.com` if any `gcloud secrets ...` or `gcloud run ...` commands return "Reauthentication failed". Already burned us once this session.
- **CRLF line-ending warnings on commit** — cosmetic only (Windows repo with `core.autocrlf=true`). Ignore.
- **EPERM on `npx prisma generate`** — happens when the dev server has the Prisma client DLL open. Stop the dev server (`mcp__Claude_Preview__preview_stop`) before regenerating, then restart.
- **Test integration suite shares one Docker Postgres** — running `npm test -- --run` will wipe the test practice that Noorros uses for chrome-verify. Re-seed via the small script in `D:/GuardWell/guardwell-v2/scripts/_dev-seed-phased-verify.ts` pattern (already deleted; recreate inline if needed).
- **Prod chrome-verify on `v2.app.gwcomp.com`** — Cloud Build typically deploys in 60-180s after merge to main. Hard-refresh the page to flush stale RSC payloads.

---

## Where things live

- Memory index: `~/.claude/projects/D--GuardWell/memory/MEMORY.md`
- Onboarding phases A–F memory: `onboarding-phase-{a-f}.md` siblings (Phases A-C in handoff `2026-04-24-onboarding-phases-a-b-c.md`)
- Master launch plan: `D:/GuardWell/guardwell-v2/docs/plans/2026-04-27-launch-readiness.md`
- Allergy plan: `D:/GuardWell/guardwell-v2/docs/plans/2026-04-27-allergy-module.md`
- Evidence/CEU plan: `D:/GuardWell/guardwell-v2/docs/plans/2026-04-27-evidence-ceu-reminders.md`
- Spec docs: `D:/GuardWell/guardwell-v2/docs/specs/onboarding-flow.md`, `module-page-contract.md`, `v1-ideas-survey.md`
- v1 reference for porting: `D:/GuardWell/guardwell/src/app/(dashboard)/allergy/`, `D:/GuardWell/guardwell/src/lib/storage.ts`, `D:/GuardWell/guardwell/cors.json`

---

## End-of-session state

- Branch `feat/launch-1-reports-framework` pushed, PR #135 open, awaiting review/merge.
- main is at the post-onboarding-Phase-F revision, deployed to v2.app.gwcomp.com on rev `guardwell-v2-00129-bdh` (Cloud Run).
- Cloud Scheduler `guardwell-v2-onboarding-drip` ENABLED, daily 0 13 * * * America/New_York. Idle (no TRIALING practices on prod).
- Stripe webhook configured + secret pinned. CRON_SECRET pinned.
- 434 tests passing on main (+9 net new on PR #135 = 443 if PR merges).

Repo clean. Ready for new session.
