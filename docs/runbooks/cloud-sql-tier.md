# Runbook — Cloud SQL tier upsize before customer traffic

**Status:** Required before opening v2 to real customer traffic. Current tier (`db-g1-small`, ~1 vCPU shared, 1.7 GB RAM, ~$26/mo) is fine for dev and the smoke-test practice; will hit CPU and memory pressure under any non-trivial query load.

**Owner:** Noorros (it@noorros.com).

**Time to complete:** ~30 seconds command + ~30 seconds maintenance downtime + verification.

## Why this matters

Cloud SQL instance `guardwell-v2-db` runs `db-g1-small` per the initial cost-conscious provision. Real-world load (cross-framework derivation queries, audit overview rollups, AI Concierge prompt context fetches) will saturate one shared vCPU quickly. Tier upsize is a single `gcloud sql instances patch` call; no schema migration needed.

Upsize target: `db-custom-1-3840` (1 dedicated vCPU + 3.75 GB RAM, ~$50/mo). Re-evaluate at 25 paying customers; bump to `db-custom-2-7680` (~$100/mo) if CPU >70% sustained.

## Pre-reqs

- `gcloud` authenticated as an account with `cloudsql.instances.update` on `guardwell-prod`.
- Confirmed-with-stakeholders maintenance window. Downtime is ~30s as Cloud SQL drains connections + restarts on the new tier.

## Steps

1. **Notify any active sessions** (Slack #ops or equivalent). At launch this is just Noorros.

2. **Take a backup** (defensive — Cloud SQL also takes one automatically before tier-change but explicit is better):
   ```bash
   gcloud sql backups create \
     --instance=guardwell-v2-db --project=guardwell-prod \
     --description="pre-tier-upsize-$(date -u +%Y%m%d-%H%M%S)"
   ```
   Wait for the command to return; ~30 seconds.

3. **Patch the tier:**
   ```bash
   gcloud sql instances patch guardwell-v2-db \
     --tier=db-custom-1-3840 \
     --project=guardwell-prod
   ```
   Confirm the prompt with `y`. Cloud SQL drains connections, restarts on the new tier, and resumes. Output: `Patching Cloud SQL instance...done.`

4. **Verify the new tier:**
   ```bash
   gcloud sql instances describe guardwell-v2-db \
     --project=guardwell-prod \
     --format="value(settings.tier,settings.dataDiskSizeGb,settings.dataDiskType)"
   ```
   Expected: `db-custom-1-3840  100  PD_SSD` (or whatever disk size is configured).

5. **Smoke-test connectivity from Cloud Run:**
   - Open `https://v2.app.gwcomp.com/dashboard` in browser.
   - Sign in. Confirm sidebar framework scores load (proves Prisma → Cloud SQL round-trip).
   - Open `/audit/overview`. Confirm framework breakdown table renders (heavier query — proves vCPU is happy).

6. **Smoke-test from local dev** (optional — only if using Cloud SQL Proxy):
   ```bash
   cd /d/GuardWell
   ./cloud-sql-proxy.exe guardwell-prod:us-central1:guardwell-v2-db --port 5434 &
   PGPASSWORD="$(cat /d/GuardWell/gcp-secrets-v2.txt | grep gwapp | awk '{print $2}')" \
     psql -h 127.0.0.1 -p 5434 -U gwapp guardwell_v2 -c 'SELECT count(*) FROM "Practice";'
   ```
   Expected: returns the practice count without error.

## When to re-upsize

Watch the Cloud SQL → Insights → CPU + memory dashboards weekly. Trigger another upsize when:
- 7-day p95 CPU > 70%
- Memory committed > 80% of allocated
- Any query in the slow-query log >2s p95 that index tuning can't fix

Next tier up: `db-custom-2-7680` (~$100/mo). Then `db-custom-4-15360` (~$200/mo) when above 100 paying customers.

## Rollback

If the new tier introduces a regression (extremely unlikely — same engine, more resources), revert:
```bash
gcloud sql instances patch guardwell-v2-db \
  --tier=db-g1-small \
  --project=guardwell-prod
```
Same downtime profile. Then escalate to determine root cause before re-upsizing.

## Related
- Memory file `deployment.md` — Cloud Build auto-deploy + Cloud Scheduler crons.
- Memory file `v2-current-state.md` — Cloud SQL provisioning history.
- `cloudbuild.yaml` — application deploy pipeline (independent of DB tier).
