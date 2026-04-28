# Cloud Build Prisma Migration Step (Chunk 16)

> **For agentic workers:** This is a high-level plan; flesh out task-level detail at the start of the next session before dispatching subagents.

**Goal:** Add a Prisma `db push` step to `cloudbuild.yaml` so every schema-changing PR auto-applies the migration to prod before the new container is deployed. Eliminates the manual `gcloud auth login` → start cloud-sql-proxy → `prisma db push` → verify cycle that we've now done 6+ times this session alone.

**Why now:** Schema-changing PRs are queueing up. Chunks 8 (notifications), 10 (allergy), 11 (asset-SRA), 12 (admin MVP) are likely to add new fields. Each one currently requires Noorros to be available + ADC to be fresh + the manual migration ritual. This is a launch blocker — if a Cloud Build deploys a new container before the matching schema is on prod, the new code crashes against the old DB.

## Current Cloud Build (`cloudbuild.yaml`)

3 steps: docker build → docker push → gcloud run deploy.

The deploy step uses `--set-secrets=DATABASE_URL=V2_DATABASE_URL:latest` — the runtime container already has access to the prod DB URL. The Cloud Build SA does NOT, but it can be granted.

## Proposed step

Insert a new step BEFORE the docker build (so a failed migration aborts the build instead of leaving prod in an inconsistent state):

```yaml
  - name: node:20-slim
    id: prisma-migrate
    entrypoint: bash
    secretEnv:
      - DATABASE_URL
    args:
      - -c
      - |
        set -euo pipefail
        echo "Installing cloud-sql-proxy..."
        apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
        curl -sSL -o /usr/local/bin/cloud-sql-proxy \
          https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.3/cloud-sql-proxy.linux.amd64
        chmod +x /usr/local/bin/cloud-sql-proxy

        echo "Starting cloud-sql-proxy..."
        cloud-sql-proxy guardwell-prod:us-central1:guardwell-v2-db --port 5434 &
        PROXY_PID=$!
        sleep 5

        echo "Installing dependencies + running prisma db push..."
        cd /workspace
        npm ci --prefer-offline --no-audit --no-fund
        # The DATABASE_URL secret is the Unix-socket form (host=...).
        # Rewrite it to TCP so it resolves to the local proxy.
        TCP_URL=$(echo "$$DATABASE_URL" \
          | sed -E 's|^postgresql://([^:]+):([^@]+)@[^/]*/([^?]+).*|postgresql://\1:\2@localhost:5434/\3|')
        DATABASE_URL="$$TCP_URL" npx prisma db push --skip-generate

        echo "Stopping proxy..."
        kill $$PROXY_PID || true

availableSecrets:
  secretManager:
    - versionName: projects/$PROJECT_ID/secrets/V2_DATABASE_URL/versions/latest
      env: DATABASE_URL
```

**Critical details:**
- The step uses `secretEnv` to pull `V2_DATABASE_URL` from Secret Manager. Cloud Build SA needs `secretmanager.secretAccessor` on this secret.
- Cloud Build SA needs `cloudsql.client` IAM binding on the project (or specifically on the Cloud SQL instance) so the proxy can authenticate.
- The proxy v2 binary is fetched per-build from Google's official storage. Not cached — adds ~2s to each build. Acceptable.
- `npm ci` runs to populate `node_modules` so `npx prisma` resolves. Could optimize by running only `npm ci --no-save prisma @prisma/client` but the full install is simpler and Cloud Build caches package-level layers between builds.
- The TCP-URL rewrite mirrors the manual pattern we use locally (Unix-socket connection string from the secret has `host=...` query param — strip it for TCP).
- `set -euo pipefail` at top so any failure aborts the step.
- `kill $$PROXY_PID || true` on the way out so the step doesn't hang.

## IAM grants needed

Run once before the first Cloud Build trigger that uses this step:

```bash
PROJECT_ID=guardwell-prod
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Grant Cloud SQL client (for proxy auth)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/cloudsql.client"

# Grant Secret Manager accessor scoped to V2_DATABASE_URL only
gcloud secrets add-iam-policy-binding V2_DATABASE_URL \
  --project=$PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

**Note:** prefer scoping the secret accessor to the specific secret (above), not project-wide. The proxy IAM is project-scoped because Cloud Build doesn't have a way to scope cloudsql.client per-instance via gcloud easily. Acceptable; the SA is already broadly trusted.

## Rollback strategy

If the prisma-migrate step ever produces a destructive change (Prisma's "this would result in data loss" warning), `db push` fails by default. The build aborts before a new container deploys. Previous container keeps running. No production data loss.

For safety, add a guard step OR a dry-run pre-check:

```bash
DATABASE_URL="$$TCP_URL" npx prisma migrate diff \
  --from-url "$$TCP_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script | head -20
```

This prints the SQL that *would* be applied. Useful for the build log without affecting prod. Optional — `db push` already refuses destructive changes.

## Tasks

Suggested commit chain (5-7 commits):

1. **Prep** — verify Cloud Build SA email, grant IAM bindings (run once outside the repo).
2. `cloudbuild(prisma): add db push step before docker build` — first cut.
3. **Test on a no-op PR** — push a docs-only change, watch the Cloud Build log, confirm step succeeds. The `prisma db push` should report "already in sync".
4. **Test with a real schema change** — find the smallest pending schema change (chunk 11's TechAsset wiring is 1 field) or fabricate one + revert. Verify migration applied + container redeployed.
5. `cloudbuild(prisma): tighten step (cache npm install, pin proxy version)` — optimizations after baseline works.
6. `docs(deploy): document the new auto-migration flow + IAM grants` — runbook for Noorros.
7. **Update memory** — `launch-readiness-2026-04-27.md` flips chunk 16 to ✅ and removes the "manual migration discipline applies" notes from every future chunk plan.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Cloud Build SA lacks IAM | Pre-task IAM grants above |
| Proxy auth fails mid-build | Build log captures the error; rollback by reverting the cloudbuild.yaml change |
| Destructive migration sneaks through | `prisma db push` refuses by default; if forced via `--accept-data-loss` it's a deliberate dev choice |
| Build takes longer (proxy install + prisma) | ~30-60s overhead; acceptable for prod safety |
| Race: deploy starts before migration finishes | Solved by step ordering — migration is BEFORE docker build |
| Cloud Build worker can't reach Cloud SQL | The proxy handles this via the public Cloud SQL Auth Proxy endpoint; no VPC needed |

## Deferred (post-launch)

- Migration history table (Prisma's own `_prisma_migrations`) for reproducible rollbacks. Currently using `db push` (schema-sync), not `migrate dev/deploy`. Switching to migrations is a v2-launch+ effort — not critical for first customers since we don't need historical schema rollback yet.
- Slack notification on migration success/failure. Useful but not critical.
- Pre-prod staging migration first (would require a staging Cloud SQL instance). Out of scope.

## Estimated session time

1 day per the master plan. With the IAM grants pre-done and a no-op test PR, the actual implementation should fit in ~3-4 hours including review + merge.
