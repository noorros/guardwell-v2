# Resend domain verification + bounce webhook

> Companion to [`resend-domain.md`](./resend-domain.md). That covers SPF/DKIM
> domain verification (a one-time DNS prereq); this covers the Phase 7 PR 9
> bounce + complaint webhook wired at `/api/webhooks/resend`.

## Status

- Domain: `gwcomp.com` (sender, see `EMAIL_FROM` env var).
- Webhook URL: `https://v2.app.gwcomp.com/api/webhooks/resend`
- Webhook secret: stored in Secret Manager as `RESEND_WEBHOOK_SECRET`.

## What the webhook does

Receives `email.bounced` and `email.complained` events from Resend. On
either, inserts a row into the `EmailSuppression` table (reason `BOUNCE`
or `COMPLAINT` respectively). `sendEmail()` consults this table before
every Resend API call and short-circuits with
`{ delivered: false, reason: "recipient suppressed" }` when the address
is on the list.

The whole point: avoid burning sender reputation by repeatedly mailing
hard-bounced addresses. Resend will throttle / deplatform us if our
bounce-or-complaint rate stays high; suppressing on first bounce keeps
the rate at zero on retries.

All other event types (`email.delivered`, `email.opened`, `email.clicked`,
`email.sent`, …) are acknowledged with 200 + a no-op. If we want analytics
in v3, extend the route handler.

## One-time setup checklist

- [ ] Domain `gwcomp.com` already verified per `resend-domain.md` (SPF +
      DKIM live in Cloud DNS, Resend dashboard shows green).
- [ ] In the Resend dashboard, navigate to **Webhooks → Create webhook**.
  - Endpoint: `https://v2.app.gwcomp.com/api/webhooks/resend`
  - Events: select `email.bounced` AND `email.complained`. Skip the
    analytics events (they generate volume but we don't act on them).
- [ ] Copy the webhook signing secret from Resend (starts with `whsec_`).
- [ ] **The `RESEND_WEBHOOK_SECRET` already exists in Secret Manager**
      with a placeholder value (created during PR 9 ship to unblock the
      build). Add a new version with the real Resend signing secret:
  ```bash
  echo -n "whsec_..." | gcloud secrets versions add RESEND_WEBHOOK_SECRET \
    --data-file=- --project=guardwell-prod
  ```
  `cloudbuild.yaml` already references `:latest`, so the next deploy
  picks up the new version automatically. No Cloud Run service-update
  command needed.
- [ ] **Verify the secret value rotated** by checking the latest version:
  ```bash
  gcloud secrets versions access latest --secret=RESEND_WEBHOOK_SECRET
  ```
  Should return your `whsec_...` string, not the placeholder.
- [ ] Send a test email via the Resend dashboard, confirm delivery.
- [ ] In the Resend dashboard, use **Send test webhook event** on the
      newly created webhook. Confirm a `200` response in Cloud Run logs
      for the `/api/webhooks/resend` route.
- [ ] Deliberately send to a known-invalid address (e.g.
      `bounce-test@bounce-test.example`); confirm the bounce event
      arrives and an `EmailSuppression` row is created:
  ```sql
  SELECT * FROM "EmailSuppression"
   WHERE email = 'bounce-test@bounce-test.example';
  ```
- [ ] Verify subsequent `sendEmail` calls to the suppressed address return
      `{ delivered: false, reason: "recipient suppressed" }` (search Cloud
      Run logs for `[email:suppressed]`).

## Maintenance

- Suppression rows are NOT auto-cleaned. To re-enable an address (e.g.
  the recipient confirms the bounce was transient), delete the row:
  ```sql
  DELETE FROM "EmailSuppression" WHERE email = 'foo@example.com';
  ```
- For an unsubscribe link (Phase 14+), insert a row programmatically with
  reason `UNSUBSCRIBE` instead of going through the bounce path.
- Manual suppression (e.g. an admin says "stop emailing this person"):
  reason `MANUAL`, write directly via the same `suppressEmail()` helper.

## Webhook event types we act on

| Resend event       | Action                                             |
|--------------------|----------------------------------------------------|
| `email.bounced`    | INSERT/UPSERT `EmailSuppression` reason=`BOUNCE`   |
| `email.complained` | INSERT/UPSERT `EmailSuppression` reason=`COMPLAINT`|
| anything else      | 200 + no-op                                        |

UPSERT semantics: on replay (same recipient, second event), the original
cause + timestamp + `resendId` are preserved — we DON'T overwrite. This
is intentional: the FIRST bounce is the diagnostic signal; later events
are noise.

## Security

The route is in `PUBLIC_ROUTES` in `src/proxy.ts` — no Firebase cookie
required. Security comes entirely from the Svix signature on every
payload (HMAC-SHA256 keyed by `RESEND_WEBHOOK_SECRET`). If the secret
env var is unset, the route returns 503 — fail closed, never accept
unsigned posts.

The `svix` package handles signature verification. We use `req.text()`
to read the raw body so the bytes Svix is hashing match exactly what
Resend signed.

## Related

- `src/lib/email/send.ts` — pre-send `isSuppressed` gate + the no-op
  fallback when `RESEND_API_KEY` is empty.
- `src/lib/email/suppression.ts` — `isSuppressed`, `suppressEmail`.
- `src/app/api/webhooks/resend/route.ts` — the webhook handler.
- `tests/integration/resend-webhook.test.ts` — 7-case integration test.
