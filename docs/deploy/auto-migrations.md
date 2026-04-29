# Auto-migration on deploy

Every push to `main` runs `prisma db push --skip-generate` against prod **before** the new container is built. If the migration fails, the deploy aborts and prod stays on the previous revision.

## How it works

`cloudbuild.yaml` step `prisma-migrate` (runs first):

1. `node:20-slim` worker pulls the cloud-sql-proxy v2.14.3 binary from Google's storage.
2. Starts the proxy bound to `localhost:5434` for `guardwell-prod:us-central1:guardwell-v2-db`.
3. Waits up to 30 s for the proxy to bind (bash `/dev/tcp` readiness probe).
4. `npm ci` installs deps so `npx prisma` resolves.
5. Rewrites the `V2_DATABASE_URL` secret from Unix-socket form (`?host=...`) to TCP form pointing at the proxy.
6. Runs `prisma db push --skip-generate`. Idempotent — reports "already in sync" when schema unchanged.
7. Kills the proxy, step exits.

If any step fails, `set -euo pipefail` aborts the build before docker build runs.

## IAM grants (one-time, already applied to guardwell-prod)

The Cloud Build executor on this project is the **Compute default SA**, NOT the legacy Cloud Build SA:

```
135128769629-compute@developer.gserviceaccount.com
```

Grants:

- `roles/cloudsql.client` (project-scoped) — lets the proxy authenticate to the SQL instance.
- `roles/secretmanager.secretAccessor` on `V2_DATABASE_URL` only — pulls the connection string into the step env via `availableSecrets`.

Re-apply (idempotent) if the project is ever re-bootstrapped:

```bash
gcloud projects add-iam-policy-binding guardwell-prod \
  --member="serviceAccount:135128769629-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client" --condition=None

gcloud secrets add-iam-policy-binding V2_DATABASE_URL \
  --project=guardwell-prod \
  --member="serviceAccount:135128769629-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" --condition=None
```

## Destructive changes

`prisma db push` refuses changes that would drop a column or otherwise lose data unless `--accept-data-loss` is passed. The current step does NOT pass this flag, so destructive migrations fail closed: build aborts, prod keeps running.

If you need a destructive change, do it locally with explicit `--accept-data-loss` on a one-off proxy session (see "Manual migration fallback" below), commit the schema, and push. The auto-step then sees an in-sync schema and is a no-op.

## Manual migration fallback

The pre-chunk-16 manual flow is preserved as a fallback. Use it only if Cloud Build is unavailable:

```bash
# 1. Reauth ADC (interactive)
gcloud auth application-default login

# 2. Start proxy
cd D:/GuardWell && ./cloud-sql-proxy.exe guardwell-prod:us-central1:guardwell-v2-db --port 5434 &

# 3. Build TCP URL from secret
PROD_URL=$(gcloud secrets versions access latest --secret=V2_DATABASE_URL --project=guardwell-prod)
USER=$(echo "$PROD_URL" | sed -E 's|^postgresql://([^:]+):.*|\1|')
PASS=$(echo "$PROD_URL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
DBNAME=$(echo "$PROD_URL" | sed -E 's|^postgresql://[^@]+@[^/]*/([^?]+).*|\1|')
PROXY_URL="postgresql://${USER}:${PASS}@localhost:5434/${DBNAME}"

# 4. Apply
cd D:/GuardWell/guardwell-v2 && DATABASE_URL="$PROXY_URL" npx prisma db push --skip-generate
```

## Debugging a failed migrate step

The step's stdout and stderr stream to Cloud Logging. Open the build in the Cloud Build console, click into the `prisma-migrate` step, and look for:

- `failed to access secret version` → IAM regression on the Compute SA. Re-apply grants above.
- `connection refused` against `localhost:5434` after the readiness probe → proxy crashed. Check for a Cloud SQL instance restart or quota.
- `Cannot drop ...` from prisma → destructive change blocked. Use the manual fallback with explicit consent.
- `npm ci` failures → check for dirty `package-lock.json` or a deleted dep.

## Post-deploy one-shot scripts

Some schema additions need a one-shot data backfill that runs *after* the auto-`db push` step lands the new column. These scripts are kept under `scripts/` and run via the manual proxy ritual above. Idempotent — safe to re-run.

| Script | Run after | Purpose |
|---|---|---|
| `scripts/backfill-practice-specialty.ts` | PR #183 (specialty list expansion) | Maps legacy `specialtyCategory` enum → new specific `specialty` strings. |
| `scripts/backfill-practice-timezone.ts` | `feat/practice-timezone` (audit #10) | Sets `Practice.timezone` from `primaryState` for pre-column rows. Run via `DATABASE_URL="$PROXY_URL" npx tsx scripts/backfill-practice-timezone.ts`. Verify with `SELECT primaryState, timezone, count(*) FROM "Practice" GROUP BY primaryState, timezone;` — every row should land non-null. Pre-`primaryState` rows remain null and render UTC dates via the helper's fallback (acceptable). |

## Rollback

Revert the cloudbuild.yaml change. The step is removed and future deploys fall back to the manual ritual. No data risk.

## Known limitations / follow-ups

- `npm ci` is uncached. Adds ~30–60 s per build. Acceptable; optimize later by pre-baking a custom builder image.
- Proxy stderr is not captured to a separate log file. A failed proxy mid-`prisma` produces a bare `ECONNREFUSED`; a future iteration can `> /workspace/proxy.log 2>&1` and dump on EXIT trap.
- `db push` (schema-sync), not `migrate deploy` (history-tracked). Migrating to `prisma migrate dev/deploy` is a v2-launch-plus effort; not needed for first customers.
