# Regulatory engine operations

The Phase 8 regulatory intelligence engine ingests RSS feeds from healthcare-compliance sources (HHS, OSHA, OIG, DEA, CMS, etc.), scores articles via Claude Sonnet 4.6 for per-framework relevance, and fans out per-practice alerts to OWNER + ADMIN inboxes. Three sequential daily crons drive the pipeline.

## Cron schedule

| Job | Cron (UTC) | Endpoint | Purpose |
|-----|-----------|----------|---------|
| `guardwell-v2-regulatory-ingest` | `0 11 * * *` | POST /api/cron/regulatory/ingest | Walk active sources, fetch new articles |
| `guardwell-v2-regulatory-analyze` | `0 12 * * *` | POST /api/cron/regulatory/analyze | Score articles via Claude, fan out per-practice alerts |
| `guardwell-v2-regulatory-notify` | `0 13 * * *` | POST /api/cron/regulatory/notify | Convert alerts to Notification rows |

Times are UTC. During EDT (March-November) that's 6 / 7 / 8 AM ET; during EST it's 12 / 13 / 14 UTC. Cloud Scheduler does NOT auto-adjust for DST; the wall-clock time shifts by one hour each spring/fall. If you want a fixed 6 AM ET year-round, switch `--time-zone="America/New_York"`.

Jobs run sequentially because each consumes the previous job's output:
- Ingest writes `RegulatoryArticle` rows with `analyzedAt: null`
- Analyze picks up `analyzedAt: null` rows, calls Claude once per article, writes `RegulatoryAlert` rows with `sentAt: null` per practice
- Notify picks up `sentAt: null` alerts, fans out `Notification` rows per OWNER/ADMIN, stamps `sentAt`

## One-time setup

After this PR deploys, run from a gcloud-authed workstation:

### 1. Seed sources (once)

Cloud Build does NOT auto-run seed scripts. Run this once after PR 2 deploys (or any time you edit `scripts/_v2-regulatory-sources.json`):

```bash
DATABASE_URL=... npm run db:seed:regulatory
```

Expected output: `10 sources upserted.` Re-running is idempotent — `name`, `feedType`, `defaultFrameworks` get refreshed but admin-toggled `isActive` and `scrapeConfig` are preserved.

### 2. Create the 3 Cloud Scheduler jobs

```bash
# Ingest (6 AM ET / 11 UTC during EDT)
gcloud scheduler jobs create http guardwell-v2-regulatory-ingest \
  --schedule="0 11 * * *" \
  --uri="https://v2.app.gwcomp.com/api/cron/regulatory/ingest" \
  --http-method=POST \
  --message-body='{}' \
  --headers="content-type=application/json,x-cron-secret=$(gcloud secrets versions access latest --secret=CRON_SECRET)" \
  --location=us-central1

# Analyze (7 AM ET / 12 UTC)
gcloud scheduler jobs create http guardwell-v2-regulatory-analyze \
  --schedule="0 12 * * *" \
  --uri="https://v2.app.gwcomp.com/api/cron/regulatory/analyze" \
  --http-method=POST \
  --message-body='{}' \
  --headers="content-type=application/json,x-cron-secret=$(gcloud secrets versions access latest --secret=CRON_SECRET)" \
  --location=us-central1

# Notify (8 AM ET / 13 UTC)
gcloud scheduler jobs create http guardwell-v2-regulatory-notify \
  --schedule="0 13 * * *" \
  --uri="https://v2.app.gwcomp.com/api/cron/regulatory/notify" \
  --http-method=POST \
  --message-body='{}' \
  --headers="content-type=application/json,x-cron-secret=$(gcloud secrets versions access latest --secret=CRON_SECRET)" \
  --location=us-central1
```

(See `cron-gotchas.md` for the GCLB `Content-Length` requirement and the `--update-headers` replace-vs-merge trap on the `update http` command. **Note:** `gcloud scheduler jobs create http` uses `--headers` (above), NOT `--update-headers` — the `update` command's flag name is misleading.)

### 3. Verify each job end-to-end

```bash
gcloud scheduler jobs run guardwell-v2-regulatory-ingest --location=us-central1
gcloud run services logs read guardwell-v2 --region=us-central1 --limit=20 | grep -i regulatory
```

Each should return HTTP 200 with a JSON summary: `{ ok: true, sourcesScanned, articlesIngested, errors }` for ingest, etc.

## Cost expectations

| Cron | Per-run scale | Daily cost (Sonnet 4.6) |
|------|---------------|--------------------------|
| Ingest | ~10 sources × ~5 articles = 50 inserts/day | $0 (no LLM) |
| Analyze | ≤ 50 articles × ~3K input tokens × 1.5K output tokens | ~$0.50/day at launch |
| Notify | ≤ 200 alerts → 2 Notifications each ≈ 400 rows | $0 (no LLM) |

The analyze cron is the only LLM cost. `LLM_MONTHLY_BUDGET_USD` env var caps total monthly spend across all surfaces (Concierge + weekly digest + analyzer); the analyzer's `assertMonthlyCostBudget()` short-circuits when the budget is tripped.

**LlmCall row attribution:** the analyzer is a system-level call with no per-practice attribution. `LlmCall.practiceId` is `null` for these rows (the column is nullable specifically for this case). When scanning the cost dashboard, filter by `practiceId IS NULL` to see analyzer spend, or filter by specific practiceId to exclude it from per-tenant attribution.

## Manual trigger for debugging

```bash
gcloud scheduler jobs run guardwell-v2-regulatory-ingest --location=us-central1
gcloud scheduler jobs run guardwell-v2-regulatory-analyze --location=us-central1
gcloud scheduler jobs run guardwell-v2-regulatory-notify --location=us-central1
```

Or hit the endpoints directly with curl:

```bash
curl -X POST https://v2.app.gwcomp.com/api/cron/regulatory/ingest \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $(gcloud secrets versions access latest --secret=CRON_SECRET)" \
  -d '{}'
```

## Monitoring

Each cron emits a JSON summary on success. Watch for:

- **Ingest:** `articlesIngested: 0` for >7 consecutive days → check source RSS URL validity. Most likely cause is a publisher restructuring their feed URL. RSS feeds also flake — `errors[].message` typically reads "request timeout" or "Status code 503".
- **Analyze:** `alertsCreated: 0` while `articlesAnalyzed > 0` → either every article was scored LOW relevance (acceptable; probably a slow news week) OR every practice has `enabled: false` on their PracticeFrameworks (configuration bug). Also watch for `errors[].message: "analyzer returned null"` clusters — that's the cost-guard fail-soft path; check `LLM_MONTHLY_BUDGET_USD` consumption.
- **Notify:** `alertsScanned == 200 && notificationsCreated > 0` for several consecutive runs → backlog is forming. Either increase `NOTIFY_BATCH_LIMIT` (currently 200) or run the notify cron more frequently (e.g. every 6 hours).
- Console warnings prefixed `[regulatory:notify]` (severity drift, empty-recipients) flag observable-but-non-fatal cases — review periodically.

## Disabling a misbehaving source

If a source consistently fails to parse or returns junk, an OWNER can flip its `isActive` toggle from `/audit/regulatory/sources` in the UI. The next ingest cron skips it. Flipping `isActive: true` later resumes ingestion automatically — `lastIngestedAt` is preserved across toggles.

## Re-seeding sources

If you edit `scripts/_v2-regulatory-sources.json`:

```bash
DATABASE_URL=... npm run db:seed:regulatory
```

The upsert preserves admin-toggled `isActive` and `scrapeConfig`, so re-runs are safe.

## Source feed health (post-launch)

The 5 active RSS feeds at launch (HHS OCR, OSHA, HealthIT.gov, AMA, Becker's, AHA) are publisher-controlled; expect ~5% transient failure rates from any of them. The ingest cron tolerates per-source failures — the `errors[]` array logs the offender, OTHER sources continue to process. If a single source fails for >3 consecutive days, investigate the URL or disable the source from `/audit/regulatory/sources`.

The 4 SCRAPE-typed sources (HHS OIG, DEA, CMS Newsroom, California AG) are seeded with `isActive: false`. Per-source HTML scrape adapters land in a future PR.

## Pipeline scaling thresholds

These are notes for when growth pushes past current bounds:

- **Sequential ingest loop** — current per-source-then-next pattern. Acceptable at 10 sources × 15s parser timeout = 150s worst case (under maxDuration=300). Past ~15 active sources, switch to `Promise.allSettled(sources.map(...))` with a concurrency limiter (`p-limit` set to 5).
- **Per-source single-row update** — `lastIngestedAt` updates are 1 round-trip per source per run. Fine at 10 sources; batch into a single `updateMany` past 100.
- **Notify global scan** — caps at `take: 200`. The `[sentAt, dismissedAt, createdAt]` index makes the find fast, but if backlog grows the cron may need to fire more often than daily.

## Relevant files

- Plan: `docs/plans/2026-04-30-phase-8-regulatory-engine.md`
- Schema: `prisma/schema.prisma` — RegulatorySource / RegulatoryArticle / RegulatoryAlert / AlertAction (lines ~485-590)
- Cron routes: `src/app/api/cron/regulatory/{ingest,analyze,notify}/route.ts`
- Workers: `src/lib/regulatory/{ingest,runAnalyze,runNotify,analyzeArticle,parsers/rss}.ts`
- UI: `src/app/(dashboard)/audit/regulatory/{page,[alertId]/page,sources/page,AlertActions,sources/SourceToggle}.tsx`
- Seed: `scripts/seed-regulatory-sources.ts` + `scripts/_v2-regulatory-sources.json`
- Eval: `scripts/eval-regulatory-relevance.ts` + `tests/fixtures/prompts/regulatory.relevance/*.json`
