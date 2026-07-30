#!/usr/bin/env bash
#
# deploy-staging.sh — non-interactive staging deploy for the EIR API.
#
# Mirrors deploy-prod.sh but reads backend/.env.staging and pushes to
# the artpark-eir-api-staging CloudFormation stack. Used to put changes
# in front of the manager before promoting them to prod.
#
# Usage:
#   cd infra/sam && ./deploy-staging.sh
#
# Prerequisites:
#   - AWS CLI configured for ap-south-1
#   - backend/.env.staging populated and gitignored
#   - SAM CLI >= 1.120
#   - Docker Desktop running (for --use-container build)

set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="../../backend/.env.staging"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ $ENV_FILE not found"
  echo "  Copy backend/.env.staging.example and populate with staging values."
  exit 1
fi

# `set -a` makes all sourced vars exported so the parameter-overrides
# section below can reference them directly.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ── Required-vars gate ─────────────────────────────────────────────
# Fail before wasting 2 minutes on a sam build that can't possibly deploy.
for var in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY OPENROUTER_API_KEY ADMIN_API_KEY FRONTEND_ORIGIN RESEND_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "✗ Missing $var in $ENV_FILE"
    exit 1
  fi
done

echo "→ Building SAM application (this takes 1-2 min)…"
if docker info >/dev/null 2>&1; then
  sam build --use-container --config-env staging
else
  echo "⚠ Docker not running; falling back to host build (needs python3.11 on PATH)"
  sam build --config-env staging
fi

# Same dotenv strip as deploy-prod.sh — `sam build` copies the whole backend/
# into the artifact, dotenv files included, which would put Supabase and API
# keys inside the deployed code package and the SAM S3 bucket. Every value is
# passed as a Lambda env var below instead.
echo "→ Stripping dotenv files from the build artifact…"
_stripped=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rm -f "$f"
  echo "   removed ${f#.aws-sam/build/}"
  _stripped=$((_stripped + 1))
done < <(find .aws-sam/build \( -name '.env' -o -name '.env.*' \) 2>/dev/null)
echo "   ${_stripped} file(s) removed"

echo "→ Deploying to AWS ap-south-1 (stack: artpark-eir-api-staging)…"
sam deploy \
  --config-env staging \
  --no-confirm-changeset \
  --parameter-overrides \
    "EnvName=staging" \
    "FrontendOrigin=${FRONTEND_ORIGIN}" \
    "SupabaseUrl=${SUPABASE_URL}" \
    "SupabaseAnonKey=${SUPABASE_ANON_KEY}" \
    "SupabaseServiceRoleKey=${SUPABASE_SERVICE_ROLE_KEY}" \
    "OpenRouterApiKey=${OPENROUTER_API_KEY}" \
    "OpenRouterModel=${OPENROUTER_MODEL:-google/gemini-2.5-flash}" \
    "AiStub=${AI_STUB:-true}" \
    "SentryDsn=${SENTRY_DSN:-}" \
    "AdminApiKey=${ADMIN_API_KEY}" \
    "AppVersion=${APP_VERSION:-0.1.0-staging}" \
    "LogLevel=${LOG_LEVEL:-DEBUG}" \
    "SesFromEmail=${SES_FROM_EMAIL:-staging-noreply@artpark.info}" \
    "ResendApiKey=${RESEND_API_KEY}" \
    "AwsRegionParam=ap-south-1"

echo ""
echo "✓ Deploy complete. Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name artpark-eir-api-staging \
  --region ap-south-1 \
  --query 'Stacks[0].Outputs' \
  --output table
