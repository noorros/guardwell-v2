#!/usr/bin/env bash
# scripts/provision-evidence-bucket.sh
#
# Provisions the guardwell-v2-evidence GCS bucket + IAM for the evidence
# upload flow. Run ONCE manually from a gcloud-authed workstation.
# Idempotent: re-running is safe (bucket already-exists error is suppressed).
#
# Prerequisites:
#   1. gcloud auth login (or ADC configured)
#   2. gcloud config set project guardwell-prod
#   3. The Cloud Run service "guardwell-v2" must already be deployed once
#      (so its SA email is discoverable via gcloud run services describe).
#
# After running:
#   1. Set the Cloud Run env var:
#        gcloud run services update guardwell-v2 --region=us-central1 \
#          --update-env-vars=GCS_EVIDENCE_BUCKET=guardwell-v2-evidence
#   2. Set GCS_EVIDENCE_BUCKET=guardwell-v2-evidence in the Cloud Build trigger
#      substitutions (or Secret Manager) if needed for build-time use.
#
# Workload Identity note:
#   Cloud Run on v2 uses the default Compute SA (PROJECT_NUMBER-compute@developer…)
#   or a custom SA set at deploy time. This script reads the actual SA from the
#   live service. If you deploy with a custom SA, the script still works because
#   it queries the live service.

set -euo pipefail

PROJECT="guardwell-prod"
BUCKET="guardwell-v2-evidence"
REGION="us-central1"
SERVICE="guardwell-v2"
STORAGE_SA="guardwell-v2-storage@${PROJECT}.iam.gserviceaccount.com"

echo "==> 1. Create bucket (idempotent)"
if gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "    Bucket gs://${BUCKET} already exists — skipping create."
else
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT}" \
    --location="${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
  echo "    Bucket created."
fi

echo "==> 2. Apply CORS policy"
gcloud storage buckets update "gs://${BUCKET}" \
  --cors-file="docs/ops/cors-v2-evidence.json"

echo "==> 3. Apply lifecycle policy"
gcloud storage buckets update "gs://${BUCKET}" \
  --lifecycle-file="docs/ops/lifecycle-v2-evidence.json"

echo "==> 4. Create dedicated storage service account (idempotent)"
if gcloud iam service-accounts describe "${STORAGE_SA}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "    SA ${STORAGE_SA} already exists — skipping create."
else
  gcloud iam service-accounts create "guardwell-v2-storage" \
    --project="${PROJECT}" \
    --display-name="GuardWell v2 Evidence Storage"
  echo "    SA created."
fi

echo "==> 5. Grant storage SA objectAdmin on the bucket"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${STORAGE_SA}" \
  --role="roles/storage.objectAdmin"

echo "==> 6. Look up Cloud Run runtime SA"
RUNTIME_SA=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(spec.template.spec.serviceAccountName)" 2>/dev/null || echo "")

if [ -z "${RUNTIME_SA}" ]; then
  echo "    WARNING: Could not detect Cloud Run SA for '${SERVICE}'."
  echo "    The service may not be deployed yet, or you lack run.services.get permission."
  echo "    After first deploy, re-run this script or manually add the SA to the bucket."
else
  echo "    Cloud Run SA: ${RUNTIME_SA}"
  echo "==> 7. Grant Cloud Run SA objectViewer on the bucket"
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/storage.objectViewer"
  echo "    Done."
fi

echo ""
echo "==> Provisioning complete."
echo ""
echo "NEXT STEPS (manual):"
echo "  gcloud run services update ${SERVICE} --region=${REGION} \\"
echo "    --update-env-vars=GCS_EVIDENCE_BUCKET=${BUCKET}"
echo ""
echo "  Add to .env.local for local dev (skip if using dev no-op mode):"
echo "    GCS_EVIDENCE_BUCKET=${BUCKET}"
echo "    GCP_PROJECT_ID=${PROJECT}"
echo "    GCP_KEY_FILE=/path/to/sa-key.json"
