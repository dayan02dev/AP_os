# CLAUDE.md — ARTPARK OS · work/reviewer-integration

> **Read this first in every session.** Single source of truth for repo
> structure, branch topology, current phase status, and ground rules.

---

## Reviewer V2 — current status (post-Phase 3)

### What's done

| Phase | Commit | What it did |
|---|---|---|
| 0 | `9bdbc58` | Created `work/reviewer-integration` from `release/sip-launch-v1` tip; imported REVIEWER-UI prototype files (`os/`, `index.html`, `REVIEWER_BACKEND_HANDOFF.md`) via file-mode checkout. Protected branches untouched. |
| 0.1 | `dfcc006` | Imported missing prototype assets (`assets/artpark-iisc-combined.webp`, `.../artpark-logo.png`, `.../iisc-logo.png`). |
| 1 | `791f606` | Wrote `docs/REVIEWER_REWIRE_PLAN.md` — full discovery: API mapping table, adapter pseudo-code, post-login routing plan, role-grant SQL, risk register, phase checklists. |
| 2 | `a96e6b8` | Ported prototype into Vite app under `/reviewer-v2/*`. Created `frontend/src/pages/reviewer-v2/` page tree, `reviewerApiV2.js` (mock), scoped CSS under `.reviewer-v2-shell`. Routes additive — `/reviewer/*` untouched. |
| 3 | `a267fe5` | Replaced mock bodies in `reviewerApiV2.js` with real `fetch()` via `api.js`. Mock preserved behind `VITE_REVIEWER_V2_MOCK=true`. Write guard `VITE_REVIEWER_V2_READONLY=true`. Backend untouched. |

### Phase 4 — next (pending approval)

**Goal:** Route the three pilot reviewer accounts to `/reviewer-v2/inbox` on
login, and grant the `reviewer` DB role to their emails.

**One-line change:** `frontend/src/lib/landing.js` line 16:
```diff
- if (r.includes("reviewer")) return "/reviewer/inbox";
+ if (r.includes("reviewer")) return "/reviewer-v2/inbox";
```

**DB migration:** Run the idempotent SQL from `docs/REVIEWER_REWIRE_PLAN.md §6`
against the target Supabase project to grant the `reviewer` role to:
- `udayan.pawar@artpark.in`
- `sanjay.haritwal@artpark.in`
- `dev@artpark.in`

### Reviewer V2 file map

```
frontend/src/lib/
  reviewerApiV2.js            API client — dispatches on USE_MOCK
  reviewerApiV2.mock.js       Phase 2 mock (localStorage-backed)
  reviewerApiV2.adapters.js   Backend → prototype shape adapters

frontend/src/pages/reviewer-v2/
  ReviewerV2AppShell.jsx      Shell: topbar + <Outlet/>; derives active tab from URL
  ReviewerV2InboxPage.jsx     Hosts Dashboard + Queue tabs (both at /inbox)
  ReviewerV2EvaluationPage.jsx  2-column eval form with FullApplicationView
  ReviewerV2HistoryPage.jsx   Locked-review history table

  components/
    atoms.jsx           Chip, LoadingState, ErrorState, EmptyState, PageHead, Variance
    FullApplicationView.jsx   Wizard-style full application read (Q2 answer)
    QueueTable.jsx            8-column filterable queue table (Q1 answer)
    Radar.jsx                 SVG radar chart (exported, not used in portal yet)
    ScoreBar.jsx              Score bar atom
    Slider.jsx                Mouse-driven 0–10 slider
    useAsync.js               loading/data/error hook

  data/
    mockData.js       16 mock startups + queue overrides (used by mock only)
    rubric.js         Hardcoded rubric (TODO: move to GET /reviewer/rubric)

  styles/
    reviewer-v2.css   Scoped under .reviewer-v2-shell — no leakage into prod CSS

assets/
  artpark-iisc-combined.webp
  artpark-logo.png
  iisc-logo.png

os/                   REFERENCE ONLY — prototype source, do not edit
  api.js  data.js  reviewer.jsx  shell.jsx  styles.css

index.html            Standalone prototype entry point (CDN React) — reference only
REVIEWER_BACKEND_HANDOFF.md   Original engineering handoff spec — reference only
docs/REVIEWER_REWIRE_PLAN.md  Phase 1 design doc — authoritative API map + adapters
```

### Env flags (added to `frontend/.env.example`)

| Flag | Default | Effect |
|---|---|---|
| `VITE_REVIEWER_V2_MOCK` | `false` | `true` → use mock data, no backend needed |
| `VITE_REVIEWER_V2_READONLY` | `false` | `true` → block save/submit, show demo-mode toast |

### What stays untouched (invariants)

- `frontend/src/pages/reviewer/` — existing production reviewer pages: **untouched**.
- `frontend/src/lib/reviewerApi.js` — existing production reviewer client: **untouched**.
- `frontend/src/lib/landing.js` — post-login redirect: **untouched until Phase 4**.
- All `backend/` files: **untouched**.
- Protected branches `main`, `release/sip-launch-v1`, `REVIEWER-UI`: **untouched**.

### Known gaps (Phase 1 §3 — to be addressed in future phases)

- **Queue `name`, `founders`, `stage`, `ai`** — inbox endpoint (`fetch_inbox`) doesn't return these. Queue shows `app_identifier` as name, founders/stage as `—`. Phase 3 Option A (backend add to `fetch_inbox`) is the fix; not yet done.
- **History `aiScore` / `adminDec`** — not returned by `GET /reviewer/reviews`. Rendered as `—`.
- **History `stats` aggregate** — not returned by any current endpoint. All four stat tiles show `—`.
- **Weighted overall score** — prototype shows plain mean; spec wants 22/30/22/14/12 weights. Deferred to Phase 4/5.
- **Rubric endpoint** — rubric is hardcoded in `data/rubric.js`. TODO comment in place; move to `GET /reviewer/rubric` in a future phase.

---

## Ground rules (non-negotiable)

1. **Working branch is `work/reviewer-integration`.** All edits and commits happen here.
2. **Never check out, edit, or commit on:**
   - `main`
   - `release/sip-launch-v1` (production)
   - `REVIEWER-UI` (active feature branch — read-only base)
   - `work/dayan-tasks` (older prototype branch — read-only reference)
   A pre-push hook blocks pushes to protected branches.
   To read a file from them use `git show <branch>:<path>`.
3. **Never run `git push` without being explicitly asked.**
4. **Never run destructive git commands** (`reset --hard`, `clean -fd`,
   `branch -D`, force-push) without explicit go-ahead.
5. **When in doubt about scope, ask before editing.** Do not "fix" things
   you weren't asked to fix.

---

## Project at a glance

**ARTPARK OS** is the application portal for the ARTPARK Technology Innovator
in Residence (TIR) and Startup Incubation Program (SIP) at IISc Bangalore.
Applicants fill a multi-section wizard; leadership reviews and scores them;
a separate reviewer portal lets assigned reviewers score individual
applications. Stack: React + Vite on Vercel, FastAPI on AWS Lambda, Supabase
for Postgres + Auth + Storage. Email via Resend. AI scoring via
OpenRouter → Gemini.

**`work/reviewer-integration`** starts at the `release/sip-launch-v1` tip
(the most complete production branch) and adds the new reviewer-v2 portal
on top. It has the full monorepo: `frontend/`, `backend/`, `infra/`, `docs/`,
plus the prototype reference files (`os/`, `index.html`, `assets/`,
`REVIEWER_BACKEND_HANDOFF.md`).

---

## Repo map

### Root

| Path | Description |
|---|---|
| `frontend/` | React 18 + Vite applicant wizard + reviewer-v2 portal (Vercel) |
| `backend/` | FastAPI app (AWS Lambda via SAM) |
| `infra/` | SAM templates, deployment scripts |
| `docs/` | Architecture, routing, design system, REVIEWER_REWIRE_PLAN.md |
| `os/` | REVIEWER-UI prototype source — **reference only, do not edit** |
| `assets/` | Prototype logo assets (imported in Phase 0.1) |
| `index.html` | Standalone prototype entry point — **reference only** |
| `REVIEWER_BACKEND_HANDOFF.md` | Original prototype engineering handoff — **reference only** |
| `DESIGN_SYSTEM_AUDIT.md` | Design system audit doc |
| `.env.example` | Root env var reference |
| `scripts/` | Utility scripts |

### `frontend/src/`

| Path | Description |
|---|---|
| `pages/reviewer-v2/` | **New reviewer portal** (Phases 2–3) — see file map above |
| `pages/reviewer/` | **Existing production reviewer** — untouched |
| `pages/leadership/` | Leadership dashboard |
| `pages/admin/` | Admin user management |
| `pages/SignInPage.jsx` | Login — calls `landingPathFor(roles)` for post-login redirect |
| `lib/reviewerApiV2.js` | New reviewer API client (dispatches on `USE_MOCK`) |
| `lib/reviewerApiV2.adapters.js` | Backend → prototype shape adapters |
| `lib/reviewerApiV2.mock.js` | Phase 2 mock implementation |
| `lib/reviewerApi.js` | **Existing production reviewer client** — untouched |
| `lib/api.js` | Fetch wrapper (auth header, 401 refresh, base URL) |
| `lib/landing.js` | Post-login redirect — reviewer still goes to `/reviewer/inbox` until Phase 4 |
| `lib/landing.js` | `landingPathFor()` + `isApplyHiddenFor()` |
| `router.jsx` | Full route tree; `/reviewer-v2/*` block added in Phase 2 |
| `styles/reviewer-v2.css` | Scoped under `.reviewer-v2-shell` |

### `backend/app/routers/` (on this branch = release/sip-launch-v1 state)

| Router | Prefix | Key endpoints used by reviewer-v2 |
|---|---|---|
| `reviewer.py` | `/reviewer` | `GET /assignments` · `GET /applications/{track}/{id}` · `GET /reviews/mine` · `POST /reviews` · `PATCH /reviews/{id}` · `GET /reviews?mine=true&locked=true` |
| `auth.py` | `/auth` | `GET /me` (identity for topbar) |

Full endpoint table: see the original CLAUDE.md section below, or
`docs/REVIEWER_REWIRE_PLAN.md §3`.

---

## Backend endpoint table

### On `main` / `release/sip-launch-v1`

| Router | Prefix | Endpoints | Purpose |
|---|---|---|---|
| `health.py` | `/health` | `GET /health` · `GET /health/ready` | Liveness + readiness |
| `auth.py` | `/auth` | `POST /request-otp` · `POST /verify-otp` · `POST /refresh` · `POST /logout` · `GET /me` · `POST /sign-in-password` · `POST /set-password` | Email OTP auth, password auth, session management |
| `applications.py` | `/applications` | `GET /me` · `PATCH /me` · `POST /me/submit` · `GET /me/submitted` · `GET /me/completion` | TIR application CRUD |
| `resume.py` | `/resume` | `POST /upload` · `GET /me` · `GET /me/download` · `POST /me/apply-to-application` | PDF upload → OpenRouter parse |
| `support.py` | `/support` | `POST /tickets` · `GET /tickets` | Support tickets |
| `waitlist.py` | `/waitlist` | `POST /` | SIP waitlist signup |
| `evidence_files.py` | `/applications/me/evidence-files` | `POST /` · `DELETE /{uuid}` | Evidence file upload/delete |
| `milestone_files.py` | `/applications/me/milestone-files` | `POST /` · `DELETE /{uuid}` | Milestone file upload/delete |
| `application_templates.py` | `/application-templates` | `POST /upload` · `GET /me` · `POST /me/apply` | Offline .docx template |
| `admin.py` | `/admin` | `GET /stats` · `GET /applications` · `GET /applications/{id}` | Read-only ops (admin key) |
| `admin_users.py` | `/admin/users` | `POST /` · `GET /` · `GET /{id}` · `PATCH /{id}` · `POST /{id}/roles` · `DELETE /{id}/roles/{role}` · `POST /{id}/reset-password` · `POST /{id}/deactivate` | User management (RBAC) |
| `sip_applications.py` | `/sip-applications` | (parallel of applications.py for SIP) | SIP application CRUD |
| `leadership.py` | `/leadership` | `GET /stats` · `GET /applications` · `GET /applications/{id}` · `GET /.../signed-url` · `GET /industry-categories` | Leadership dashboard |
| `reviewer.py` | `/reviewer` | `GET /assignments` · `GET /applications/{track}/{id}` · `GET /reviews/mine` · `GET /reviews` · `POST /reviews` · `PATCH /reviews/{id}` · `POST /assignments/{id}/decline` | Reviewer inbox, scoring, history |
| `ai_screening.py` | `/admin/ai-screening` | `POST /run` | Trigger AI scoring (admin) |

---

## Frontend route table (this branch)

### Applicant wizard (`/apply/*`, `/apply-sip/*`)

Unchanged from `release/sip-launch-v1` — full table in `docs/ROUTING.md`.

### Admin, Leadership, existing Reviewer

| URL | Component | Notes |
|---|---|---|
| `/admin` | `AdminLayout` | Redirects to `/admin/users` |
| `/admin/users` | `UserListPage` | |
| `/leadership` | `LeadershipDashboard` | |
| `/leadership/applications/:track/:id/review` | `ReviewApplicationPage` | |
| `/reviewer` | redirect | → `/reviewer/inbox` |
| `/reviewer/inbox` | `ReviewerInboxPage` | **Existing — untouched** |
| `/reviewer/completed` | `ReviewerCompletedPage` | **Existing — untouched** |
| `/reviewer/:track/:id/score` | `ReviewerScoringPage` | **Existing — untouched** |

### Reviewer V2 (new, Phase 2)

| URL | Component | Notes |
|---|---|---|
| `/reviewer-v2` | redirect | → `/reviewer-v2/inbox` |
| `/reviewer-v2/inbox` | `ReviewerV2InboxPage` | Dashboard + Queue tabs |
| `/reviewer-v2/eval/:appId` | `ReviewerV2EvaluationPage` | idx-based, resolves via queue cache |
| `/reviewer-v2/history` | `ReviewerV2HistoryPage` | Locked reviews; Re-open within 60-min window |

`landing.js` still sends `reviewer` role to `/reviewer/inbox`. Phase 4 flips
it to `/reviewer-v2/inbox`.

---

## Database table list

### Migrations 001–009 (TIR track, `main`)

| Migration | Tables / buckets created |
|---|---|
| 001 | `profiles`, `applications`, `resume_uploads`, `support_tickets`, `audit_logs` |
| 002 | Storage bucket `resumes` |
| 003 | Schema updates for v2 questions |
| 004 | Storage bucket `milestone-files` |
| 005 | Multi-application support |
| 006 | Storage bucket `evidence-files` |
| 007 | `sip_waitlist` |
| 008 | `application_templates`; bucket `application-templates` |
| 009 | Relaxed CHECK constraints |

### Migrations 010–021 (`release/sip-launch-v1` = this branch's base)

| Migration | Tables / buckets |
|---|---|
| 010 | Renames TIR tables to `tir_*`; adds `profiles.track` |
| 011 | `sip_applications`, `sip_resume_uploads`, SIP storage buckets |
| 012 | Adds `sip_applications.execution_will_break` |
| 013 | Relaxes `OTHER` CHECK constraints |
| 014 | `user_roles`, `reviewer_assignments`, `reviews`, `ai_screening`, `application_status_log`, `audit_log_v2` |
| 015 | Expands `application_status` CHECK |
| 016 (two files) | `reviewer_pages_columns` additions; renames `score_solution → score_completeness` |
| 017 | `industry_categories`; `display_seq` |
| 018 | Adds `project_name` to `ai_screening` |
| 019 (three files) | Auto-assign `applicant` role on signup; mandatory profile links |
| 020 | `sip_application_templates`; bucket `sip-application-templates` |
| 021 | Adds co-founder invite + DPIIT fields to `sip_applications` |

### Migration 022 — not yet written

Phase 4 will optionally add a migration to grant the `reviewer` role to the
three pilot emails. The idempotent SQL is drafted in
`docs/REVIEWER_REWIRE_PLAN.md §6`. No schema changes — inserts only into
`public.user_roles`.

---

## External services + env vars

| Service | Purpose | Key env vars |
|---|---|---|
| **Supabase** | Postgres + Auth + Storage | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **OpenRouter → Gemini** | Resume parsing + AI scoring | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| **Resend** | Transactional email | `RESEND_API_KEY`, `SES_FROM_EMAIL` |
| **AWS Lambda + API Gateway** | Backend hosting (SAM) | `AWS_REGION_APP` |
| **AWS SQS** | Async AI scoring queue | Configured in SAM template |
| **Vercel** | Frontend hosting | `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| **Sentry** | Error monitoring (optional) | `SENTRY_DSN` |

Reviewer V2 specific (in `frontend/.env.example`):
- `VITE_REVIEWER_V2_MOCK=false` — set `true` for UI work without a backend
- `VITE_REVIEWER_V2_READONLY=false` — set `true` for safe demo previews

Other config: `ENV`, `FRONTEND_ORIGIN`, `ADMIN_API_KEY`, `RATE_LIMIT_DEFAULT`,
`AI_SCORING_ENABLED`, `LOG_LEVEL`.

---

## How to work in this repo

### Before making any change

1. Confirm you are on `work/reviewer-integration` (`git branch`).
2. Read the relevant source file before proposing edits.
3. For reviewer-v2 changes, read `docs/REVIEWER_REWIRE_PLAN.md` for the
   intended API contract and adapter shapes.

### Branch reading (without switching)

```bash
git show main:frontend/src/router.jsx
git show release/sip-launch-v1:backend/app/routers/reviewer.py
git show REVIEWER-UI:os/reviewer.jsx
```

### Never do

```bash
git checkout main                # forbidden
git checkout release/...         # forbidden
git checkout REVIEWER-UI         # forbidden
git checkout work/dayan-tasks    # forbidden
git push                         # only with explicit user request
git reset --hard                 # only with explicit user request
git push --force                 # never
```

### Commit (only when asked)

```bash
git add <specific files>         # never `git add -A` — risk of .env
git commit -m "$(cat <<'EOF'
  Short imperative title

  Body if needed.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Running the frontend locally

```bash
cd frontend
npm install
# create frontend/.env.local from frontend/.env.example, fill VITE_API_BASE_URL
npm run dev        # http://localhost:5173
# Navigate to /reviewer-v2/inbox to test the new portal
# Set VITE_REVIEWER_V2_MOCK=true in .env.local to skip the backend
```

### Running the backend locally

```bash
cd backend
pip install -r requirements.txt
# create .env from .env.example, fill Supabase + OpenRouter keys
uvicorn app.main:app --reload --port 8000
```
