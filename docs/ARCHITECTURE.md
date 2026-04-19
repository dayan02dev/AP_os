# ARTPARK EIR — Architecture

> This document is the source of truth for how the production stack fits together.
> Individual service READMEs point back here rather than duplicate it.

## Overview

```
┌──────────────┐      ┌─────────────────┐      ┌──────────────────┐
│  Vercel      │      │  AWS API GW     │      │  Supabase        │
│  React UI    │─────▶│  + Lambda       │─────▶│  Postgres + Auth │
│  (wizard)    │      │  (FastAPI)      │      │  + Storage       │
└──────────────┘      └─────────────────┘      └──────────────────┘
       │                      │  │                      ▲
       │                      │  │                      │
       │                      │  └──▶ OpenRouter ──────▶│
       │                      │      (Gemini Flash)     │
       │                      │                         │
       │                      └──▶ AWS SES ────▶ email  │
       │                                                │
       └── supabase-js (auth only) ────────────────────┘
```

## Trust boundaries

- **Browser** talks to **Supabase directly only for auth** (login/signup/OTP).
  This uses the public anon key.
- **All data writes** go through the FastAPI backend so it can validate input,
  rate-limit, call LLMs, and write an audit trail server-side.
- The backend uses the **Supabase service role key** (never shipped to the
  browser) for privileged DB operations that bypass RLS.
- **Row-level security (RLS)** on Supabase protects anything the browser does
  touch directly.

## Components

| Component | Runs on | Code |
|---|---|---|
| React wizard | Vercel (static) | `/frontend` |
| FastAPI app | AWS Lambda + API Gateway (via SAM) | `/backend` |
| Postgres + Auth + Storage | Supabase | `/infra/supabase` (migrations, planned) |
| Infra as code | AWS SAM templates | `/infra/aws` (planned) |

## Scale assumption

~1,000 applicants over 3–4 months ≈ ~10/day average, ~50–100/day peaks.
Lambda + API Gateway keeps this under ~$5/month. No ECS/EC2 needed.

## Phase 0 (current)

- Monorepo structure established (`/frontend`, `/backend`, `/infra`, `/docs`).
- Frontend migrated to Vite + react-router-dom, JSX files converted from
  Babel-standalone globals to ES modules.
- `/apply/*` route tree wired up; all protected routes redirect unauthed users
  to `/apply/signin?next=…`.
- Supabase, OpenRouter, SES keys scaffolded in `.env.example` files (not yet
  consumed by code).

Subsequent phases wire up Supabase auth (Phase 3), application CRUD (Phase 4),
resume parsing via OpenRouter → Gemini Flash (Phase 5), email via SES (Phase 6),
and deploy via Vercel + AWS SAM (Phase 9).
