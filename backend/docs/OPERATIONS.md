# ARTPARK EIR — Operations Runbook

Phase 8 hardening ships with structured logging, Sentry, rate limits, an
admin API, and deep health checks. This doc is the operator-facing manual
for using them. Keep it current — if you change an endpoint, a key, or a
rate limit, update the matching section here.

Audience: the ops/on-call person investigating an incident or doing
routine checks. Assumes familiarity with `curl` and AWS CloudWatch.

---

## 1. Health checks

Two tiers:

| Endpoint         | Purpose     | External deps touched        | Use for |
|------------------|-------------|------------------------------|---------|
| `GET /health`       | Liveness    | None                         | ALB / k8s liveness probe |
| `GET /health/ready` | Readiness   | Supabase DB + Auth, OpenRouter | Synthetic monitors, "is the world OK" |

Example checks:

```bash
# Always 200 while the process is up — cheap.
curl -s https://api.artpark.in/health | jq
# { "status": "ok", "version": "0.8.0", "uptime_seconds": 1234 }

# 200 if all deps green, 503 otherwise.
curl -s https://api.artpark.in/health/ready | jq
# { "status": "ok", "checks": { "db": "ok", "auth": "ok", "llm": "ok" } }
```

When `/health/ready` returns 503, look at which sub-check is `error` and
jump to the matching section below:

- `db` → Supabase → Settings → Database → Service status
- `auth` → Supabase → Authentication → Status
- `llm` → https://status.openrouter.ai

---

## 2. Logs

All logs are **structured JSON on stdout**. CloudWatch Logs Insights parses
them natively. There is no log-format wrapper to configure — if it looks
messy in CW, something is double-formatting.

### 2.1 The fields you care about

Every request emits exactly two lines we care about in normal ops:

- `msg: "request.start"` — method, path, request_id
- `msg: "request.end"`   — method, path, status_code, duration_ms, severity

Both carry `request_id` and (when authed) `user_id`, so you can grep a
single request's full trace.

Useful Logs Insights queries:

```
# Slow requests in the last hour
fields ts, method, path, duration_ms, status_code, request_id
| filter msg = "request.end" and duration_ms > 500
| sort duration_ms desc
| limit 50

# Full trace of one request
fields ts, msg, level, @message
| filter request_id = "abc123def456"
| sort ts asc

# Error rate by route
fields path, status_code
| filter msg = "request.end" and status_code >= 500
| stats count() by path
```

### 2.2 Redaction

`utils/logging.py` scrubs JWTs, `Authorization` headers, email addresses,
phone numbers, and known-sensitive `extra={}` keys
(`access_token`, `refresh_token`, `password`, `api_key`, …) from every
log line. It's defense in depth — do not rely on it as primary control.
**Never log raw OTP codes or session tokens.** If you see any PII in
CloudWatch, file a ticket immediately: it means either the redactor has
a gap, or someone bypassed it by stringifying a sensitive object.

---

## 3. Sentry

Init lives in `main.py`. Key behaviours:

- `traces_sample_rate=0.1`, `profiles_sample_rate=0.1`
- `before_send` drops 4xx HTTPExceptions (user-input noise) and tags every
  event with the current `request_id`
- `sentry_sdk.set_user({id, email})` is called in `deps.get_current_user`
  after successful JWT verification

Common tasks:

- **Rotate DSN:** set `SENTRY_DSN` in the environment, redeploy. Empty
  disables Sentry entirely; the app logs `sentry disabled` at startup.
- **Suppress a noisy error:** don't silently catch it — add an `ignore_errors`
  entry to the `sentry_sdk.init()` call in `main.py` with a clear comment
  referencing the ticket.
- **Reproduce locally:** set `SENTRY_DSN=<dev DSN>` in `backend/.env`,
  boot the app, trigger the error. It appears in Sentry within ~5s.

---

## 4. Rate limits

Two layers, both in-memory per container:

1. **Global slowapi limiter** — `settings.rate_limit_default` (default
   `60/minute` per IP). Catches spam; not tuned per route.
2. **Sliding-window buckets** in `utils/rate_limit.py` — per-email / per-user
   / per-token, for anything IP-keyed slowapi can't do.

| Endpoint                                | Limit             | Key      |
|-----------------------------------------|-------------------|----------|
| `POST /auth/request-otp`                | 3 / 15 min        | email    |
| `POST /auth/verify-otp`                 | 5 / 15 min        | email    |
| `POST /auth/refresh`                    | 30 / min          | IP       |
| `POST /auth/logout`                     | 30 / min          | user     |
| `GET  /auth/me`                         | 120 / min         | user     |
| `GET  /applications/me`                 | 60 / min          | user     |
| `PATCH /applications/me`                | 30 / min          | user     |
| `POST /applications/me/submit`          | 5 / hour          | user     |
| `GET  /applications/me/completion`      | 60 / min          | user     |
| `POST /resume/upload`                   | 5 / hour          | user     |
| `GET  /resume/me`                       | 30 / min          | user     |
| `GET  /resume/{id}`                     | 30 / min          | user     |
| `POST /resume/me/apply-to-application`  | 10 / hour         | user     |
| `POST /support/ticket`                  | 3 / hr (anon) or 10 / hr (authed) | IP / token |
| `GET  /support/tickets/me`              | 60 / min          | user     |
| `/admin/*`                              | 60 / min          | admin key |

> **Per-container, not distributed.** A burst of concurrent Lambda invocations
> can each allow N requests, effectively multiplying limits. At ~10–100 apps
> per day this is fine. If we scale to thousands of concurrent applicants,
> swap to Redis-backed buckets (see the note at the top of
> `utils/rate_limit.py`).

### 4.1 Resetting a user's bucket

There is no production endpoint. If someone is legitimately stuck:

1. Confirm it's real by reading logs (look for the offending 429 with
   `user_id=<x>` or `key=<x>`).
2. Redeploy / scale-in Lambda → all buckets are flushed on cold start.
   This is the supported emergency release valve.
3. If the same user gets blocked twice in a day, investigate — a client
   bug is probably hammering the API.

---

## 5. Admin API

All endpoints live under `/admin/*` and require an `X-Admin-Key` header
matching `settings.admin_api_key`. Never paste the key into chat / tickets /
screenshots — rotate it if you do.

```bash
ADMIN_KEY="$(op read op://vault/eir-admin-api-key/value)"

# Dashboard counts
curl -s https://api.artpark.in/admin/stats \
  -H "X-Admin-Key: $ADMIN_KEY" | jq

# Paginated applications (50/page; tweak ?page=N and ?page_size=N<=100)
curl -s "https://api.artpark.in/admin/applications?status=submitted&page=1&page_size=50" \
  -H "X-Admin-Key: $ADMIN_KEY" | jq

# Full detail for one application (+ owner profile + latest resume parse)
curl -s https://api.artpark.in/admin/applications/<uuid> \
  -H "X-Admin-Key: $ADMIN_KEY" | jq
```

### 5.1 Rotating the admin key

1. `python -c "import secrets; print(secrets.token_urlsafe(48))"` →
   generates a new 64-char key.
2. Update `ADMIN_API_KEY` in the deployment environment (AWS Secrets
   Manager / Lambda env config).
3. Redeploy. The old key stops working the moment the new container boots.
4. Update the ops vault (1Password `eir-admin-api-key`).

The startup guard in `config._startup_validation` refuses to boot in
`APP_ENV=production` if the dev-only sentinel key is still present, so a
misconfigured deploy fails fast rather than silently exposing `/admin/*`.

---

## 6. CORS

`settings.frontend_origins` is a comma-separated list; every origin
allowed for `fetch(..., { credentials: "include" })` must be listed
exactly. No `*`. Browser preflights (OPTIONS) are handled by FastAPI's
CORSMiddleware; allowed methods and headers are pinned in `main.py`.

Symptoms of a CORS misconfig:

- Browser console shows `No 'Access-Control-Allow-Origin' header`
- `curl` works fine → confirms it's CORS, not a backend error

Fix: add the origin to `FRONTEND_ORIGIN` (yes, the env var is singular for
back-compat) as a comma-separated append, redeploy.

---

## 7. Security headers

`SecurityHeadersMiddleware` in `utils/middleware.py` adds:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  (production only — Lambda behind CloudFront terminates TLS)

Verify from ops:

```bash
curl -sI https://api.artpark.in/health | grep -E 'X-Frame|Strict|Content-Type|Permissions'
```

---

## 8. Incident response — quick skeleton

1. **Confirm scope.** `/health/ready` → which sub-check is red?
2. **Find the request ID.** User reports usually include one (we return
   `X-Request-ID` on every response). If not, ask them to retry and copy
   it from DevTools.
3. **Grep logs.** Use the Logs Insights query in §2.1 with the request_id.
4. **Check Sentry.** Filter events by `request_id=<x>` (tagged on every
   event automatically).
5. **If broken:** redeploy or roll back (both flush in-memory state — rate
   limits, slowapi buckets, the lru_cache'd Supabase client pool).
6. **Communicate.** Post a one-liner in #eir-ops with ETA. Write up
   post-incident notes into `backend/docs/INCIDENTS/<YYYY-MM-DD>.md` so
   Phase 8's structured logging pays back over time.

### 8.1 Paging criteria (draft — revisit in Phase 9)

Page if:
- `/health/ready` returns 503 for > 5 minutes
- 5xx rate > 5% of total requests for > 10 minutes
- Sentry receives > 20 unique events in 5 minutes

Do **not** page on:
- Individual 4xx spikes (user input problems)
- OTP delivery warnings (SMTP issues — investigate in business hours)

---

## 9. Environment variables

Required at boot. `config.py` reads these; missing required values fail
loudly via pydantic validation. See `backend/.env.example` for the full
template.

| Var                        | Required? | Notes |
|----------------------------|-----------|-------|
| `APP_ENV`                  | yes       | `development` / `staging` / `production` (`dev`/`prod` aliases accepted) |
| `SUPABASE_URL`             | yes       | |
| `SUPABASE_ANON_KEY`        | yes       | |
| `SUPABASE_SERVICE_ROLE_KEY`| yes       | **Never** expose to the frontend. |
| `OPENROUTER_API_KEY`       | yes (parse) | Resume parsing fails without it. |
| `ADMIN_API_KEY`            | yes (prod)| ≥32 chars. Dev sentinel rejected in production. |
| `FRONTEND_ORIGIN`          | yes       | Comma-separated list of allowed origins. |
| `SENTRY_DSN`               | no        | Empty → Sentry disabled. |
| `SES_FROM_EMAIL`           | prod only | |
| `AWS_REGION`               | prod only | |
| `LOG_LEVEL`                | no        | `INFO` default. `DEBUG` is noisy in prod. |
| `RATE_LIMIT_DEFAULT`       | no        | `60/minute` default. |

---

## 10. Production stack (Phase 9B)

The backend is deployed as a single Lambda function behind an HTTP API
Gateway in `ap-south-1`. See `infra/sam/README.md` for the redeploy /
rollback / destroy playbook; this section is the operator cheat sheet.

| Key            | Value |
|----------------|-------|
| Environment    | `production` (from `APP_ENV=production`) |
| Stack name     | `artpark-eir-api-production` |
| Region         | `ap-south-1` |
| API URL        | `https://api.artpark.info` |
| Raw exec-URL   | `https://w1yw8stevk.execute-api.ap-south-1.amazonaws.com` — still works but **do not advertise**; route clients through the custom domain |
| Lambda fn      | `artpark-eir-api-production` |
| Log group      | `/aws/lambda/artpark-eir-api-production` (30-day retention) |
| Runtime        | Python 3.11 / arm64 / 1024 MB / 29 s timeout |

Quick reference:

```bash
# Tail prod logs
aws logs tail /aws/lambda/artpark-eir-api-production \
  --follow --since 10m --region ap-south-1

# Smoke the API
curl https://api.artpark.info/health/ready

# Admin stats (key from backend/.env.prod)
curl -H "X-Admin-Key: $ADMIN_KEY" \
  https://api.artpark.info/admin/stats

# Redeploy latest main
cd infra/sam && ./deploy-prod.sh

# Emergency rollback
git checkout <good-sha> && cd infra/sam && ./deploy-prod.sh
```

See `infra/sam/README.md` for cost projection (<$5/mo) and the full list
of known limitations (cold start, per-container rate limits, 29 s cap).

---

## 11. Phase-8 smoke-test checklist

Run after any infra change. All should pass against staging.

```bash
# 1. Liveness
curl -s https://api.artpark.in/health | jq '.status' # → "ok"

# 2. Readiness
curl -s https://api.artpark.in/health/ready | jq '.status' # → "ok"

# 3. Admin auth — 401 without key
curl -sI https://api.artpark.in/admin/stats | head -1 # → HTTP/2 401

# 4. Admin auth — 200 with key
curl -sI https://api.artpark.in/admin/stats \
  -H "X-Admin-Key: $ADMIN_KEY" | head -1 # → HTTP/2 200

# 5. Request ID echo
curl -sI https://api.artpark.in/health | grep -i 'x-request-id' # → non-empty

# 6. Security headers
curl -sI https://api.artpark.in/health | grep -i 'strict-transport-security'

# 7. Rate limit bite (local only — don't hammer prod)
for i in $(seq 1 65); do curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:8000/health; done | tail -5 # last few are 429
```
