#!/usr/bin/env bash
#
# deploy-prod.sh — non-interactive production deploy for the EIR API.
#
# Sources backend/.env.prod, hands each secret to sam deploy via
# --parameter-overrides, prints stack outputs on success.
#
# Never echoes secret values. Never commits them. Never writes them to
# samconfig.toml (they would land in git).
#
# Usage:
#   cd infra/sam && ./deploy-prod.sh
#
# Prerequisites (see infra/sam/README.md for the full list):
#   - AWS CLI configured for ap-south-1 as artpark-deploy-admin
#   - backend/.env.prod populated and gitignored
#   - SAM CLI >= 1.120

set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="../../backend/.env.prod"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ $ENV_FILE not found"
  echo "  Copy backend/.env.example and populate with production values."
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
# `--use-container` runs the build inside AWS's official python3.11 image,
# so the host machine doesn't need Python 3.11 installed (most devs here
# run 3.12). Requires Docker Desktop to be running. If Docker isn't
# available, fall back to a host build — but that will only work when the
# host has python3.11 on PATH (homebrew: `brew install python@3.11`).
if docker info >/dev/null 2>&1; then
  sam build --use-container --config-env production
else
  echo "⚠ Docker not running; falling back to host build (needs python3.11 on PATH)"
  sam build --config-env production
fi

# ── Strip dotenv files out of the build artifact ────────────────────
# `sam build` copies the whole CodeUri (backend/) into .aws-sam/build, which
# sweeps up backend/.env.prod — i.e. the prod service-role key, ADMIN_API_KEY,
# Resend and OpenRouter keys end up inside the deployed code package AND in the
# SAM-managed S3 bucket, readable by anyone holding lambda:GetFunction or read
# on that bucket. Nothing needs them there: every value is handed to the
# function as a Lambda env var via --parameter-overrides below.
echo "→ Stripping dotenv files from the build artifact…"
_stripped=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rm -f "$f"
  echo "   removed ${f#.aws-sam/build/}"
  _stripped=$((_stripped + 1))
done < <(find .aws-sam/build \( -name '.env' -o -name '.env.*' \) 2>/dev/null)
echo "   ${_stripped} file(s) removed"

echo "→ Deploying to AWS ap-south-1 (stack: artpark-eir-api-production)…"
sam deploy \
  --config-env production \
  --no-confirm-changeset \
  --parameter-overrides \
    "EnvName=production" \
    "FrontendOrigin=${FRONTEND_ORIGIN}" \
    "SupabaseUrl=${SUPABASE_URL}" \
    "SupabaseAnonKey=${SUPABASE_ANON_KEY}" \
    "SupabaseServiceRoleKey=${SUPABASE_SERVICE_ROLE_KEY}" \
    "OpenRouterApiKey=${OPENROUTER_API_KEY}" \
    "OpenRouterModel=${OPENROUTER_MODEL:-google/gemini-2.5-flash}" \
    "AiStub=${AI_STUB:-true}" \
    "SentryDsn=${SENTRY_DSN:-}" \
    "AdminApiKey=${ADMIN_API_KEY}" \
    "AppVersion=${APP_VERSION:-0.1.0}" \
    "LogLevel=${LOG_LEVEL:-INFO}" \
    "SesFromEmail=${SES_FROM_EMAIL:-noreply@artpark.info}" \
    "ResendApiKey=${RESEND_API_KEY}" \
    "AwsRegionParam=ap-south-1" \
    "TirSubmissionsClosed=${TIR_SUBMISSIONS_CLOSED:-false}" \
    "SipSubmissionsClosed=${SIP_SUBMISSIONS_CLOSED:-false}" \
    "FounderPortalAllowlist=${FOUNDER_PORTAL_ALLOWLIST:-}"

echo ""
echo "✓ Deploy complete. Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name artpark-eir-api-production \
  --region ap-south-1 \
  --query 'Stacks[0].Outputs' \
  --output table
