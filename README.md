# ARTPARK EIR — Application Portal

Monorepo for the ARTPARK **Technology Innovator in Residence** application
wizard at IISc Bangalore.

## Stack

- **Frontend**: React 18 + Vite + react-router-dom, deployed on Vercel
- **Backend**: FastAPI on AWS Lambda + API Gateway (via SAM) — Phase 2+
- **Database**: Supabase Postgres + Auth (email OTP) + Storage — Phase 1+
- **Resume parsing**: OpenRouter → Gemini 2.0 Flash — Phase 5
- **Email**: AWS SES (OTP, support replies) — Phase 6

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system diagram
and [`docs/ROUTING.md`](docs/ROUTING.md) for the frontend route table.

## Layout

```
/frontend    React wizard (Vite)
/backend     FastAPI app (Phase 2+)
/infra       AWS SAM templates + Supabase migrations (Phase 1+)
/docs        ARCHITECTURE.md, ROUTING.md, reference PDFs
/.github     CI workflows (Phase 9)
```

## Quick start (frontend)

```
cd frontend
cp .env.example .env.local   # fill in when Supabase is provisioned
npm install
npm run dev
```

Open http://localhost:5173 — redirects to `/apply` and loads the wizard.

## Phases

Development is tracked in phases. See the playbook for details.

- **Phase 0** — monorepo scaffold + Vite migration + routing **(current)**
- **Phase 1** — Supabase schema
- **Phase 2** — FastAPI skeleton + empty router scaffolds
- **Phase 3** — Supabase email-OTP auth
- **Phase 4** — Application CRUD
- **Phase 5** — Resume parsing via OpenRouter
- **Phase 6** — Support tickets + transactional email
- **Phase 7** — Frontend wiring to the backend
- **Phase 8** — Hardening
- **Phase 9** — Deploy (Vercel + AWS SAM)

## Environment

Every secret used anywhere in the stack is enumerated in
[`.env.example`](.env.example) at the repo root. Each subproject
(`frontend`, `backend`) has its own `.env.example` with only the keys that
service consumes.

Never commit `.env*` files — the root `.gitignore` covers them explicitly.
