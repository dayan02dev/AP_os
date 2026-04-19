# ARTPARK EIR — Backend

FastAPI service for the ARTPARK EIR application portal. Talks to Supabase,
OpenRouter (resume parsing), and AWS SES (transactional email). Deploys as a
single Lambda via AWS SAM in Phase 9; runs as a regular ASGI app locally.

## Layout

```
app/
  main.py               ← FastAPI app, CORS, middleware, Mangum handler
  config.py             ← pydantic-settings (loads .env)
  deps.py               ← get_current_user Bearer-token dependency
  supabase_client.py    ← anon + admin client factories
  routers/
    health.py           ← GET /health (live)
    auth.py             ← Phase 3 stub
    applications.py     ← Phase 4 stub
    resume.py           ← Phase 5 stub
    support.py          ← Phase 6 stub
  models/               ← Pydantic request/response models (filled per phase)
  services/             ← External integrations (SES, OpenRouter)
  utils/
    logging.py          ← JSON log formatter
    rate_limit.py       ← slowapi Limiter
tests/
  conftest.py           ← TestClient fixture
  test_health.py        ← liveness + rate-limit coverage
migrations/             ← Phase 1 SQL — apply once per Supabase project
requirements.txt        ← runtime deps (pinned to major versions)
requirements-dev.txt    ← tests + linting
pyproject.toml          ← ruff + pytest config
Dockerfile              ← local-dev parity; prod uses SAM
```

## Prerequisites

- **Python 3.11+** (3.12 also tested). Spec baseline is 3.11; if your system
  only has 3.12 that's fine.
- Supabase project provisioned (see `migrations/README.md`).
- `backend/.env` populated with at minimum the three Supabase keys.

## Local setup

```bash
cd backend

# fresh venv — isolate from system packages
python3.11 -m venv .venv        # or python3.12 if 3.11 isn't installed
source .venv/bin/activate

pip install -r requirements-dev.txt      # installs runtime + dev deps

# populate .env (copied from .env.example earlier)
# At minimum: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

uvicorn app.main:app --reload --port 8000
```

Health check:

```bash
curl localhost:8000/health
# {"status":"ok","db":"ok"}
```

Interactive API docs (dev only):
- http://localhost:8000/docs  — Swagger UI
- http://localhost:8000/openapi.json  — raw spec

## Running tests

```bash
cd backend
source .venv/bin/activate
pytest
```

Tests:
- `test_health_returns_200` / `test_health_shape` — /health contract
- `test_health_is_rate_limited` — fires 61 requests; expects 60 x 200 + 1 x 429

The rate-limit test is the slowest (~2s) because it actually pokes the endpoint
60 times and hits Supabase each time. If you only want a smoke check,
`pytest -k "not rate_limit"`.

## Rate limiting

Default policy: **60 requests per minute per client IP**, applied to every
route. Configured via `RATE_LIMIT_DEFAULT=60/minute` in env. Override per-route
with `@limiter.limit("10/minute")` etc. Backing store is in-memory (single
Lambda container → fine at our scale; swap to Redis if we ever multi-container).

## Logging

Structured JSON. Every log line is a single JSON object: `ts`, `level`,
`logger`, `msg`, plus any fields you pass via `extra={...}`. Works out of the
box with CloudWatch Logs Insights — no parsing rules needed.

## Sentry

Set `SENTRY_DSN` in env to enable. Leaving it blank is a silent no-op (the
startup log will say "sentry disabled"). `traces_sample_rate=0.1` — tune per
environment.

## Docker

Only for local parity. Not used for prod deploys (those go through SAM in
Phase 9).

```bash
docker build -t artpark-eir-api .
docker run --env-file .env -p 8000:8000 artpark-eir-api
```

## Deploying to Lambda

Phase 9 adds `infra/aws/template.yaml` (SAM) and a GitHub Actions workflow.
The Lambda handler is already wired — `app.main.handler` (via Mangum).

## Conventions

- **Never import `os.environ` directly.** Use `from app.config import settings`.
- **Never create Supabase clients inline.** Use `get_admin_client()` /
  `get_anon_client()` from `supabase_client.py`.
- **Auth-protected routes** must depend on `deps.get_current_user` — that's
  the single place we verify Supabase JWTs.
- **Service-role key stays server-side.** Never log it, never include it in
  an error message, never ship it to the frontend (that's why CORS doesn't
  allow `Access-Control-Expose-Headers: *` and why we have a separate anon
  client when RLS is the intent).
