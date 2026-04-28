# Runbook — Resend domain verification

**Status:** Required before onboarding drip emails + daily/weekly digests will actually deliver in production.

**Owner:** Noorros (it@noorros.com).

**Time to complete:** ~30 minutes wall-clock + DNS propagation wait (up to 24 hours, usually <1 hour).

## Why this matters

Cron jobs `/api/cron/onboarding-drip` and `/api/notifications/digest/run` are wired and emit to Resend, but Resend silently no-ops sends from unverified domains. Symptom in prod: events fire, emails never arrive, no error surfaced.

The sender domain must be DKIM- and SPF-verified before Resend will deliver mail.

## Pre-reqs

- Resend account (https://resend.com) with billing enabled.
- DNS access for `gwcomp.com` (currently Cloud DNS in `guardwell-prod` GCP project).
- `RESEND_API_KEY` already in `Secret Manager → guardwell-v2` (set during onboarding-phase-c).

## Steps

1. **Sign in to Resend dashboard** → Domains → Add Domain.
2. **Enter** `gwcomp.com` (root domain — sub-domains inherit, and we want the same sender across marketing/app/v2).
3. **Resend issues 3 DNS records:**
   - A `TXT` for SPF (e.g. `v=spf1 include:_spf.resend.com ~all`)
   - A `TXT` for DKIM (e.g. `resend._domainkey TXT k=rsa;p=…`)
   - Optionally a `TXT` for DMARC (recommend `v=DMARC1; p=none; rua=mailto:dmarc@gwcomp.com`)
4. **Add the records to Cloud DNS:**
   ```bash
   gcloud dns record-sets transaction start \
     --zone=gwcomp-com --project=guardwell-prod
   gcloud dns record-sets transaction add \
     "v=spf1 include:_spf.resend.com ~all" \
     --name="gwcomp.com." --ttl=300 --type=TXT \
     --zone=gwcomp-com --project=guardwell-prod
   gcloud dns record-sets transaction add \
     "k=rsa;p=YOUR_DKIM_PUBKEY_FROM_RESEND" \
     --name="resend._domainkey.gwcomp.com." --ttl=300 --type=TXT \
     --zone=gwcomp-com --project=guardwell-prod
   gcloud dns record-sets transaction execute \
     --zone=gwcomp-com --project=guardwell-prod
   ```
5. **Wait for propagation.** Typically <10 minutes. Resend dashboard auto-checks every minute and flips status to "Verified" when satisfied.
6. **Confirm `EMAIL_FROM` env-var is `noreply@gwcomp.com` (or `support@gwcomp.com`)** in Cloud Run service `guardwell-v2`. Currently set per `.env.example`. If different, update via:
   ```bash
   gcloud run services update guardwell-v2 \
     --region us-central1 --project guardwell-prod \
     --update-env-vars EMAIL_FROM='GuardWell <noreply@gwcomp.com>'
   ```
7. **Smoke-test the cron endpoint manually:**
   ```bash
   curl -X POST -H "Authorization: Bearer $(gcloud secrets versions access latest --secret=CRON_SECRET --project=guardwell-prod)" \
     https://v2.app.gwcomp.com/api/cron/onboarding-drip
   ```
   Expected: HTTP 200 with `{"sent":N}` where N matches the count of practices in the relevant drip windows. If N>0, check Resend dashboard → Logs → confirm delivery.

## Recovery

If a customer reports missing emails AFTER verification:

1. Check Resend dashboard → Logs → filter by recipient. Look for `delivered` vs `bounced` vs `complained`.
2. If bounced: confirm recipient address typo or permanent failure; reach out via in-app.
3. If delivered but customer hasn't seen: ask them to check spam (DKIM/SPF should put us in inbox, but enterprise mail rules vary).
4. Resend bounce/complaint webhook can auto-suppress addresses — endpoint is `/api/webhooks/resend` (TODO: wire up if not already; track in Phase 7).

## Related
- `src/lib/email/send.ts` — fallback no-op when `RESEND_API_KEY` is empty (also active in tests).
- `src/lib/onboarding/run-drip.ts` — drip cadence logic.
- `src/lib/notifications/run-digest.ts` — daily digest batch send.
