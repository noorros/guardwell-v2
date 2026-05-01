# Notifications operations

## Daily digest cron

Fires daily at 08:00 UTC via Cloud Scheduler `guardwell-v2-notifications-daily`.
Endpoint: POST /api/notifications/digest/run
Auth: `X-Cron-Secret` header matches `CRON_SECRET` env var.

## Weekly digest cron (Phase 7 PR 7)

Fires Sunday 22:00 UTC via Cloud Scheduler `guardwell-v2-notifications-weekly`.
Endpoint: POST /api/notifications/digest-weekly/run
Auth: `X-Cron-Secret` header matches `CRON_SECRET` env var.

### One-time setup (after PR deploys)

Run on a gcloud-authed workstation:

```bash
gcloud scheduler jobs create http guardwell-v2-notifications-weekly \
  --schedule="0 22 * * 0" \
  --uri="https://v2.app.gwcomp.com/api/notifications/digest-weekly/run" \
  --http-method=POST \
  --message-body='{}' \
  --update-headers="content-type=application/json,x-cron-secret=$(gcloud secrets versions access latest --secret=CRON_SECRET)" \
  --location=us-central1
```

(See `cron-gotchas.md` for the GCLB Content-Length + `--update-headers` traps.)

### Verification

After scheduling, manually trigger via:

```bash
gcloud scheduler jobs run guardwell-v2-notifications-weekly --location=us-central1
```

Then check logs:

```bash
gcloud run services logs read guardwell-v2 --region=us-central1 --limit=20 | grep -i digest
```

You should see a JSON response with `weeklyDigestsAttempted` + `weeklyDigestsDelivered` counts.
