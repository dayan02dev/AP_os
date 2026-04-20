# `infra/sam/` — AWS Lambda + HTTP API deployment

Production stack for the ARTPARK EIR backend. FastAPI on Lambda behind
API Gateway HTTP API, in `ap-south-1` (Mumbai).

## Files

| File             | Purpose |
|------------------|---------|
| `template.yaml`  | SAM/CloudFormation template — Lambda fn, HTTP API, log group, IAM role |
| `samconfig.toml` | Non-secret SAM CLI defaults (region, stack name, capabilities) |
| `deploy-prod.sh` | Wrapper: sources `backend/.env.prod` → `sam build` → `sam deploy` |
| `README.md`      | This file |

## One-time setup (done in Phase 9B)

1. AWS account with CLI configured for `ap-south-1`. Check:
   ```bash
   aws sts get-caller-identity
   ```
2. SAM CLI ≥ 1.120 (`sam --version`).
3. Docker Desktop running — the build uses
   `public.ecr.aws/sam/build-python3.11:latest-arm64` because most dev
   machines run Python 3.12, not 3.11.
4. `backend/.env.prod` populated and gitignored. The script refuses to
   deploy if any of `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `ADMIN_API_KEY`, or
   `FRONTEND_ORIGIN` is empty.

## Redeploy

```bash
cd infra/sam && ./deploy-prod.sh
```

About 90–120 s if cache is warm (no dependency changes), 2–3 min if cold.

## Stack details (current as of 2026-04-20)

| Key            | Value |
|----------------|-------|
| Stack name     | `artpark-eir-api-production` |
| Region         | `ap-south-1` |
| API URL        | `https://api.artpark.info` (custom domain — see §Custom domain) |
| Raw exec-URL   | `https://w1yw8stevk.execute-api.ap-south-1.amazonaws.com` (internal; don't advertise) |
| Lambda ARN     | `arn:aws:lambda:ap-south-1:348287123004:function:artpark-eir-api-production` |
| Log group      | `/aws/lambda/artpark-eir-api-production` (30-day retention) |
| Runtime        | Python 3.11 on arm64, 1024 MB, 29 s timeout |
| Handler        | `app.main.handler` (Mangum, `lifespan="off"`) |

## View logs

```bash
# Tail live
aws logs tail /aws/lambda/artpark-eir-api-production --follow \
  --since 10m --region ap-south-1

# Query for a specific request_id
aws logs filter-log-events \
  --log-group-name /aws/lambda/artpark-eir-api-production \
  --filter-pattern '"request_id":"<id>"' \
  --region ap-south-1
```

## Emergency: destroy stack

```bash
aws cloudformation delete-stack \
  --stack-name artpark-eir-api-production --region ap-south-1

# Watch deletion progress
aws cloudformation wait stack-delete-complete \
  --stack-name artpark-eir-api-production --region ap-south-1
```

Everything the stack owns (Lambda, HTTP API, IAM role, log group) is
deleted. Supabase data is not touched — that's a separate system.

## Rollback

Fastest safe rollback is a redeploy of the previous Git commit:

```bash
# Find the commit that was last known-good
git log --oneline backend/ infra/sam/

# Roll back the working tree and redeploy
git checkout <good-sha>
cd infra/sam && ./deploy-prod.sh
```

CloudFormation will do a rolling update — traffic keeps flowing on the old
Lambda version until the new one is live.

## Cost projection

At the expected scale (~10–100 applications/day over 4 months):

| Service | Usage | Cost |
|---------|-------|------|
| Lambda (arm64, 1 GB, ~500 ms avg) | ~150 k invocations/mo | ~$0.50 |
| API Gateway HTTP API | ~150 k requests/mo | ~$0.15 |
| CloudWatch Logs (~1 GB/mo ingest, 30-day retain) | | ~$0.60 |
| X-Ray (10 % sampling) | | <$0.10 |
| Data transfer out | | <$0.50 |
| **Total** | | **< $2/mo** |

Well inside the AWS free tier for the first year; after free tier ends,
the cost cap is around **$5/mo** even with a 3× load spike.

## Known limitations

- **Rate limits are per-container.** slowapi + the custom sliding-window
  buckets in `utils/rate_limit.py` live in Lambda memory. Two concurrent
  cold invocations each get their own buckets. At our scale this is fine
  — swap to Redis if we ever sustain >100 concurrent requests.
- **29 s timeout.** HTTP API Gateway caps at 29 s regardless of Lambda
  timeout. Resume parsing stays under this budget (`PARSE_BUDGET_SECONDS
  = 22.0`); longer operations need Phase 9C's background worker.
- **Cold start ~2–3.5 s.** Python + FastAPI + supabase-py + pypdf all
  load at init. Lambda SnapStart is not available for Python, so this is
  the floor. Provisioned concurrency would kill cold starts but adds
  ~$15/mo for one instance; not worth it at current scale.
- **In-memory Supabase client pool.** `get_admin_client()` is memoised
  with `lru_cache`; it survives across warm invocations of the same
  container but dies with it. httpx keep-alive handles re-use inside the
  pool.

## Security notes

- The `AdminApiKey`, `SupabaseServiceRoleKey`, `SupabaseAnonKey`, and
  `OpenRouterApiKey` parameters are declared `NoEcho: true` in the
  template — they never appear in CloudFormation events, change-sets, or
  console audit trails.
- `backend/.env.prod` is gitignored and must never be committed. The
  deploy script reads values at deploy time and passes them as SAM
  parameter-overrides; nothing is persisted to `samconfig.toml`.
- IAM role is scoped to CloudWatch Logs only — no S3, no DynamoDB, no
  SES yet. When Phase 6's SES email work goes live, add
  `SESCrudPolicy` scoped to the verified sender domain.

## Custom domain (Phase 9C)

The production API is served from `https://api.artpark.info`. TLS is
terminated at API Gateway using an ACM certificate. DNS is managed in
GoDaddy; two CNAMEs live there:

| Record | Purpose | Value |
|--------|---------|-------|
| `_0864f35b2c2974372d519b02ca400d38.api` | ACM DNS validation — never delete while the cert is in use | `_5d41cfadc520946ec4b751434fd3ee08.jkddzztszm.acm-validations.aws` |
| `api` | Routes traffic to the API Gateway regional endpoint | `d-g6k6lgwbi8.execute-api.ap-south-1.amazonaws.com` |

Key AWS resources:

| Resource | Value |
|----------|-------|
| Certificate ARN | `arn:aws:acm:ap-south-1:348287123004:certificate/87d0ce6a-f468-4365-9aa4-9b855ff68e52` |
| API Gateway target | `d-g6k6lgwbi8.execute-api.ap-south-1.amazonaws.com` |
| Hosted zone (API GW side) | `Z3VO1THU9YC4UR` |
| Security policy | TLS 1.2 |
| Endpoint type | REGIONAL |

### Rotation

ACM **auto-renews DNS-validated certificates** up to 60 days before
expiry — no action needed as long as the `_0864f35b2c29…` validation
CNAME stays in GoDaddy. If that CNAME is deleted, the first renewal that
hits validation will fail and the certificate will expire ~55 days later.
The renewal attempt emails AWS root-account contacts; set a Google
Calendar reminder ~1 year out as a belt-and-braces check.

### If we ever switch DNS provider

1. Export both CNAMEs from GoDaddy.
2. Recreate them in the new provider (same name + value).
3. Wait for DNS TTL to expire (default 1 h) before cutting `api.artpark.info`
   traffic over.
4. Nothing in AWS needs to change — the cert is tied to the domain name,
   not the DNS provider.

### Teardown (emergency)

```bash
# Remove the mapping
aws apigatewayv2 delete-api-mapping \
  --domain-name api.artpark.info \
  --api-mapping-id <id-from-get-api-mappings> \
  --region ap-south-1

# Delete the custom domain
aws apigatewayv2 delete-domain-name \
  --domain-name api.artpark.info --region ap-south-1

# Delete the cert (only after confirming nothing else uses it)
aws acm delete-certificate \
  --certificate-arn arn:aws:acm:ap-south-1:348287123004:certificate/87d0ce6a-f468-4365-9aa4-9b855ff68e52 \
  --region ap-south-1
```

Clients will then fail over to the raw execute-API URL if it's still in
their config, or 404/cert-error if they're pinned to the custom domain.
