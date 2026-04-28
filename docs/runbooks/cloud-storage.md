# Cloud Storage Runbook — guardwell-v2-evidence

Last updated: 2026-04-28

## 1. Bucket details

| Property | Value |
|---|---|
| Bucket name | `guardwell-v2-evidence` |
| Region | `us-central1` |
| Access mode | Uniform bucket-level (no per-object ACLs) |
| Public access | Prevention enabled (bucket is never publicly readable) |
| Storage class | STANDARD |
| Lifecycle rule | Delete objects older than 365 days |

## 2. Who can access the bucket

| Principal | Role | How |
|---|---|---|
| `guardwell-v2-storage@guardwell-prod.iam.gserviceaccount.com` | `roles/storage.objectAdmin` | Scoped IAM on the bucket |
| Cloud Run runtime SA | `roles/storage.objectViewer` | Scoped IAM on the bucket |

No user has direct GCS console access. All uploads/downloads go through the application's signed URL flow.

## 3. Signed URL flow

### Upload (3 steps)
1. Client POSTs to `/api/evidence/upload` → server calls `getSignedUploadUrl` → returns a 15-min v4 signed PUT URL.
2. Client PUTs file directly to GCS using the signed URL (no server-side buffering).
3. Client POSTs to `/api/evidence/{id}/confirm` → server flips Evidence.status to UPLOADED.

### Download
- Client GETs `/api/evidence/{id}/download` → server calls `getSignedDownloadUrl` → 302 redirect to a 5-min signed GET URL.

### Delete
- Soft-delete: DELETE `/api/evidence/{id}` → status=DELETED, deletedAt set, GCS object deleted best-effort.
- Hard-delete: Reaper cron runs daily at 02:00 UTC; hard-deletes GCS objects + DB rows where deletedAt < now()-30d.

## 4. Bucket lifecycle policy

The GCS lifecycle rule (365-day delete) is a safety net. The application-level flow is:
- Day 0: Evidence.status = UPLOADED
- User deletes: Evidence.status = DELETED, deletedAt = now, GCS object deleted best-effort
- Day +30: Reaper cron hard-deletes GCS object (if still exists) + DB row
- Day +365: GCS lifecycle rule deletes any object still remaining (belt + suspenders)

## 5. Quota management

### Default quota
5 GB per practice, configurable via:
1. `PRACTICE_STORAGE_QUOTA_BYTES` env var (applies to all practices with no override).
2. `Practice.storageQuotaBytes` column (per-practice override, set via `psql` or admin UI when available).

### Raising a practice's quota
```sql
UPDATE "Practice"
SET "storageQuotaBytes" = 10737418240  -- 10 GB
WHERE id = '<practice_id>';
```

### Checking a practice's current usage
```sql
SELECT
  p.name,
  p.id,
  COALESCE(SUM(e."fileSizeBytes"), 0) AS used_bytes,
  COALESCE(SUM(e."fileSizeBytes"), 0) / 1073741824.0 AS used_gb
FROM "Practice" p
LEFT JOIN "Evidence" e ON e."practiceId" = p.id AND e.status != 'DELETED'
WHERE p.id = '<practice_id>'
GROUP BY p.id, p.name;
```

## 6. Reaper cron

- **Job name:** `guardwell-v2-evidence-reaper`
- **Schedule:** `0 2 * * *` (02:00 UTC daily)
- **Endpoint:** `POST https://v2.app.gwcomp.com/api/cron/evidence-reaper`
- **Auth:** `x-cron-secret: <CRON_SECRET>` header (same secret as `onboarding-drip`)
- **maxDuration:** 300s

### Create the Cloud Scheduler job (run once)
```bash
gcloud scheduler jobs create http guardwell-v2-evidence-reaper \
  --project=guardwell-prod \
  --location=us-central1 \
  --schedule="0 2 * * *" \
  --uri="https://v2.app.gwcomp.com/api/cron/evidence-reaper" \
  --http-method=POST \
  --headers="x-cron-secret=<CRON_SECRET_VALUE>" \
  --attempt-deadline=5m \
  --time-zone="UTC"
```

### Trigger manually (test run)
```bash
gcloud scheduler jobs run guardwell-v2-evidence-reaper \
  --project=guardwell-prod \
  --location=us-central1
```

Check Cloud Logging for output:
```
resource.type="cloud_scheduler_job"
resource.labels.job_id="guardwell-v2-evidence-reaper"
```

### Monitor reaper health
The cron returns `{ ok: true, purged: N, errors: M }`. If `errors > 0`, check Cloud Logging for `[evidence-reaper] GCS delete failed` entries. Errors are usually transient (GCS 503); re-run the job. If persistent, check if the GCS SA still has objectAdmin.

## 7. Abuse incident response

### Symptom: a practice uploads unexpected file types or volumes
1. Check the Evidence table for the practice:
```sql
SELECT "entityType", "mimeType", "fileName", "fileSizeBytes", "uploadedAt"
FROM "Evidence"
WHERE "practiceId" = '<practice_id>'
  AND status != 'DELETED'
ORDER BY "uploadedAt" DESC
LIMIT 50;
```
2. If abuse confirmed, set `Practice.storageQuotaBytes = 0` to block further uploads immediately.
3. Soft-delete offending rows via the admin UI (when available) or directly:
```sql
UPDATE "Evidence"
SET status = 'DELETED', "deletedAt" = now()
WHERE "practiceId" = '<practice_id>'
  AND status != 'DELETED';
```
The reaper will hard-delete the GCS objects within 30 days. For immediate GCS purge, run the reaper manually (see §6).

### Symptom: signed URL leaks (URL shared externally)
Signed URLs expire in 5 min (downloads) or 15 min (uploads). No action needed beyond monitoring if the TTL has already elapsed. For an active leak of an unexpired URL: delete the GCS object immediately:
```bash
gcloud storage rm "gs://guardwell-v2-evidence/<object-key>"
```
Then soft-delete the Evidence row so the application UI reflects the deletion.

### Symptom: bucket misconfiguration (public access)
The bucket has `public-access-prevention` enabled. If a GCP change accidentally removes this:
```bash
gcloud storage buckets update gs://guardwell-v2-evidence \
  --public-access-prevention
```

## 8. VirusTotal scan (deferred — Phase 14)

VirusTotal integration is out of scope for Phase 3. Tracked in Phase 14 deferred register. When implemented, it will be a Cloud Function triggered on bucket object finalize events. Until then, the content-type allowlist (PDF + common images only; no executables) is the primary abuse control.

## 9. Object naming convention

```
practices/<practiceId>/<entityType>/<entityId>/<evidenceId[0:12]>-<sanitized-filename>
```

Example:
```
practices/cm1abc123/CREDENTIAL/cm9xyz456/a1b2c3d4e5f6-DEA_registration_2026.pdf
```

The `practiceId` prefix is the primary cross-tenant isolation boundary. Even if a signed URL were leaked, it only provides access to a single object in a single tenant's namespace.
