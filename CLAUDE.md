# CLAUDE.md — ARTPARK OS Codebase Reference

> **Read this first in every session.** It is the single source of truth for
> repo structure, branch topology, endpoint map, and ground rules.

---

## Ground rules (non-negotiable)

1. **Working branch is `work/dayan-tasks`.** All edits and commits happen here.
2. **Never check out, edit, or commit on:**
   - `main`
   - `release/sip-launch-v1` (production)
   - `REVIEWER-UI` (active feature branch — read-only base)
   A pre-push hook blocks pushes to those three, but don't even try.
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
Applicants fill a multi-section wizard; leadership reviews and scores them; a
separate reviewer portal (currently a standalone prototype) lets assigned
reviewers score individual applications. The stack is React + Vite on Vercel,
FastAPI on AWS Lambda, and Supabase for Postgres + Auth + Storage. Email is
sent via Resend (migrated from SES). AI scoring uses OpenRouter → Gemini.

**Current branch (`work/dayan-tasks`) is a stripped repo** — it contains only
the reviewer-portal standalone prototype (`os/` folder + REVIEWER_BACKEND_HANDOFF.md).
The full monorepo (frontend, backend, infra, docs) lives on `main` and
`release/sip-launch-v1`.

---

## Repo map

### `work/dayan-tasks` branch (this branch)

| Path | Description |
|---|---|
| `index.html` | Standalone reviewer portal HTML — loads React + Babel from CDN |
| `os/data.js` | Mock data: 16 startups, 5 reviewers, jury, activity, notifications (all `window.OS_DATA`) |
| `os/api.js` | Mock API seam (`window.ReviewerAPI`) — Promise-based, localStorage-backed eval store, `useAsync` hook, `window.toast` |
| `os/reviewer.jsx` | All reviewer portal UI: Queue, Dashboard, Eval form, FullApplicationView, Rubric, History, Topbar |
| `os/shell.jsx` | Shared atoms: `Topbar`, `Sidebar`, `ScoreBar`, `Slider`, `Chip`, `Radar`, `Histogram`, `Variance` (global via `Object.assign(window, …)`) |
| `os/styles.css` | All CSS — ARTPARK design tokens + reviewer portal layout |
| `REVIEWER_BACKEND_HANDOFF.md` | Full spec for what the backend must expose to make the reviewer portal real |

### `main` branch (full monorepo — read-only reference)

| Path | Description |
|---|---|
| `frontend/` | React 18 + Vite applicant wizard (deployed to Vercel) |
| `backend/` | FastAPI app (AWS Lambda via SAM) |
| `backend/app/routers/` | One file per API domain (see endpoint table below) |
| `backend/app/models/` | Pydantic request/response models |
| `backend/app/services/` | Email (Resend), LLM (OpenRouter), file parser, template parser |
| `backend/app/utils/` | Logging (structured JSON), rate limiting (slowapi), middleware |
| `backend/migrations/` | Numbered SQL files — apply once per Supabase project |
| `docs/ARCHITECTURE.md` | System diagram + trust boundaries |
| `docs/ROUTING.md` | Full frontend route table |
| `backend/docs/OPERATIONS.md` | Ops runbook: health checks, logs, rate limits, admin key |
| `.env.example` | Root env var reference (all secrets) |

### `release/sip-launch-v1` branch (production — read-only reference)

Everything in `main` plus:
- SIP track (parallel schema + wizard + router under `/apply-sip/*` and `/sip-applications/*`)
- Admin platform (user management UI + backend)
- Leadership dashboard (stats, applications table, review surface)
- Reviewer backend + frontend (fully wired, not the prototype)
- AI scoring pipeline (LangGraph, OpenRouter/Gemini)
- Migrations 010–021 (SIP, admin platform, reviewer, AI scoring)

---

## Backend endpoint table

### On `main`

| Router | Prefix | Endpoints | Purpose |
|---|---|---|---|
| `health.py` | `/health` | `GET /health` · `GET /health/ready` | Liveness + readiness (checks Supabase + OpenRouter) |
| `auth.py` | `/auth` | `POST /request-otp` · `POST /verify-otp` · `POST /refresh` · `POST /logout` · `GET /me` · `POST /sign-in-password` · `POST /set-password` | Email OTP auth, password auth, session management |
| `applications.py` | `/applications` | `GET /me` · `PATCH /me` · `POST /me/submit` · `GET /me/submitted` · `GET /me/completion` | TIR application CRUD; fetch-or-create draft, partial update (debounced), submit, completion % |
| `resume.py` | `/resume` | `POST /upload` · `GET /me` · `GET /me/download` · `POST /me/apply-to-application` | PDF upload → OpenRouter parse → apply parsed fields to draft |
| `support.py` | `/support` | `POST /tickets` · `GET /tickets` | Support ticket creation + read |
| `waitlist.py` | `/waitlist` | `POST /` | SIP waitlist signup |
| `evidence_files.py` | `/applications/me/evidence-files` | `POST /` · `DELETE /{uuid}` | Evidence file upload/delete (private bucket `evidence-files`) |
| `milestone_files.py` | `/applications/me/milestone-files` | `POST /` · `DELETE /{uuid}` | Milestone file upload/delete (private bucket `milestone-files`) |
| `application_templates.py` | `/application-templates` | `POST /upload` · `GET /me` · `POST /me/apply` | Offline .docx template upload + parse + apply to draft |
| `admin.py` | `/admin` | `GET /stats` · `GET /applications` · `GET /applications/{id}` | Read-only ops (guarded by `X-Admin-Key` header) |

### Additional on `release/sip-launch-v1`

| Router | Prefix | Endpoints | Purpose |
|---|---|---|---|
| `admin_users.py` | `/admin/users` | `POST /` · `GET /` · `GET /{id}` · `PATCH /{id}` · `POST /{id}/roles` · `DELETE /{id}/roles/{role}` · `POST /{id}/reset-password` · `POST /{id}/deactivate` | Full user management (RBAC gated) |
| `auth.py` (extended) | `/auth` | + `PATCH /me/track` | Track switcher (TIR ↔ SIP) |
| `sip_applications.py` | `/sip-applications` | `GET /me` · `PATCH /me` · `POST /me/submit` · `GET /me/submitted` · `GET /me/completion` | SIP parallel of TIR applications router |
| `sip_evidence_files.py` | `/sip-applications/me/evidence-files` | `POST /` · `DELETE /{uuid}` | SIP evidence files |
| `sip_milestone_files.py` | `/sip-applications/me/milestone-files` | `POST /` · `DELETE /{uuid}` | SIP milestone files |
| `sip_resume.py` | `/sip-resume` | Same shape as `resume.py` | SIP resume upload + parse |
| `sip_application_templates.py` | `/sip-application-templates` | `POST /upload` · `GET /me` · `POST /me/apply` | SIP offline .docx template |
| `leadership.py` | `/leadership` | `GET /stats` · `GET /applications` · `GET /applications/{id}` · `GET /applications/{id}/files/{kind}/signed-url` · `GET /industry-categories` | Leadership dashboard reads (capability: `view_stats` / `view_app_detail`) |
| `leadership_actions.py` | `/leadership/applications/{id}` | `DELETE /reviewers/{reviewer_user_id}` | Leadership write ops (unassign reviewer) |
| `reviewer.py` | `/reviewer` | `GET /assignments` · `GET /applications/{track}/{id}` · `POST /reviews` · `PATCH /reviews/{id}` · `POST /assignments/{id}/decline` · `GET /reviews` · `GET /reviews/mine` | Reviewer inbox, scoring, history (capability: `score_app`) |
| `ai_screening.py` | `/admin/ai-screening` | `POST /run` | Trigger AI scoring pipeline (admin-guarded) |

---

## Frontend route table

### On `main`

| URL | Component | Auth | Purpose |
|---|---|---|---|
| `/` | `RootRedirect` | no | Redirects to static marketing HTML |
| `/apply` | `App` | no | Welcome / returning-user chooser |
| `/apply/signin` | `SignInPage` | no | Email + password login |
| `/apply/signup` | `SignUpPage` | no | Email signup → OTP |
| `/apply/verify` | `VerifyPage` | no | 6-digit OTP entry |
| `/apply/support` | `SupportPage` | no | Support ticket form |
| `/apply/set-password` | `SetPasswordPage` | ✓ | First-time / reset password |
| `/apply/template` | `App` (TEMPLATE_UPLOAD phase) | ✓ | Offline .docx template upload between sections 01–02 |
| `/apply/basic` | `App` (section) | ✓ | Team + contact details |
| `/apply/problem` | `App` (section) | ✓ | Problem definition |
| `/apply/solution` | `App` (section) | ✓ | Solution + tech + moat |
| `/apply/execution` | `App` (section) | ✓ | Milestones + budget |
| `/apply/evidence` | `App` (section) | ✓ | Evidence files + pitch deck |
| `/apply/declaration` | `App` (section) | ✓ | Declarations + submit |
| `/apply/profile` | `App` (PROFILE phase) | ✓ | Personal info + sign-out |
| `/apply/review` | `App` (REVIEW phase) | ✓ | Pre-submit review |
| `/apply/submitted` | `App` (DONE phase) | ✓ | Post-submit receipt |
| `*` | `NotFoundPage` | no | 404 |

### Additional on `release/sip-launch-v1`

| URL | Component | Auth | Purpose |
|---|---|---|---|
| `/apply-sip` | SIP `App` variant | no | SIP welcome / chooser |
| `/apply-sip/{section}` | SIP `App` | ✓ | SIP wizard sections |
| `/apply-sip/fit-check` | SIP `App` | ✓ | SIP fit-check screen |
| `/apply-sip/sip-template` | SIP `App` | ✓ | SIP offline template step |
| `/apply-sip/profile` | SIP `App` | ✓ | SIP profile page |
| `/apply-sip/review` | SIP `App` | ✓ | SIP pre-submit review |
| `/apply-sip/submitted` | SIP `App` | ✓ | SIP post-submit receipt |
| `/admin` | `AdminLayout` | ✓ (admin) | Redirects to `/admin/users` |
| `/admin/users` | `UserListPage` | ✓ (admin) | User list + search + role filter |
| `/admin/users/new` | `AdminAddUser` | ✓ (admin) | Provision new user |
| `/admin/users/:id` | `UserDetailPage` | ✓ (admin) | User detail + roles + security |
| `/leadership` | `LeadershipDashboard` | ✓ (leadership) | Stats + applications table |
| `/leadership/:track/:id` | `ReviewApplicationPage` | ✓ (leadership/admin) | Full application review surface |
| `/reviewer` | Redirect | ✓ (reviewer) | → `/reviewer/inbox` |
| `/reviewer/inbox` | `ReviewerInboxPage` | ✓ (reviewer) | Assigned applications inbox |
| `/reviewer/completed` | `ReviewerCompletedPage` | ✓ (reviewer) | Submitted reviews |
| `/reviewer/:track/:id/score` | `ReviewerScoringPage` | ✓ (reviewer) | Scoring form + AI comparison |

### App.jsx wizard phases (main)

`WELCOME → RETURNING → UPLOAD → PARSING → PARSE_REVIEW → TEMPLATE_UPLOAD → SECTION_INTRO → QUESTION → CELEBRATE → REVIEW → DONE / PROFILE`

### Frontend hooks (`frontend/src/hooks/`)

| Hook | Purpose |
|---|---|
| `useAuth.jsx` | Auth context: user, loading, sign-in, sign-out, rehydrate from session |
| `useApplication.jsx` | Draft CRUD: fetch-or-create, save (debounced 800ms), submit, completion |
| `useResume.js` | CV upload → OpenRouter parse → apply to draft; polls for parse_status |
| `useSupport.js` | Support ticket POST |
| `useTemplate.js` | Offline .docx template upload + apply |
| `useToast.jsx` | Toast notification state |

### Frontend lib (`frontend/src/lib/`)

| File | Purpose |
|---|---|
| `api.js` | Fetch wrapper: auth header, 401 refresh-and-retry, `ApiError` class, timeouts |
| `auth.js` | Raw auth API calls (request-otp, verify-otp, refresh, get-me, sign-out) |
| `session.js` | localStorage session + single-flight refresh lock |
| `supabase.js` | Supabase anon client (auth-only — no direct DB calls from browser) |
| `fieldMap.js` | DB column ↔ question-id mapping; `collapseFromRow`, `expandForPatch` |
| `adminApi.js` *(sip-launch only)* | Admin user management API calls |
| `leadershipApi.js` *(sip-launch only)* | Leadership dashboard + review API calls |
| `reviewerApi.js` *(sip-launch only)* | Reviewer inbox, scoring, completed reviews API calls |

---

## Database table list

### Migrations 001–009 (on `main`)

| Migration | Tables / buckets created |
|---|---|
| 001 | `profiles`, `applications`, `resume_uploads`, `support_tickets`, `audit_logs` |
| 002 | Storage bucket `resumes` (private, PDF/Word, 5 MiB) |
| 003 | Schema updates for v2 questions (no new tables) |
| 004 | Storage bucket `milestone-files` (private, any file, 50 MiB) |
| 005 | Multi-application support (schema columns) |
| 006 | Storage bucket `evidence-files` (private, any file, 50 MiB) |
| 007 | `sip_waitlist` |
| 008 | `application_templates`; storage bucket `application-templates` (private) |
| 009 | Relaxed CHECK constraints on legacy fields |

### Migrations 010–021 (on `release/sip-launch-v1` only)

| Migration | Tables / buckets |
|---|---|
| 010 | Renames TIR tables/buckets to `tir_*` prefix; adds `profiles.track` |
| 011 | `sip_applications`, `sip_resume_uploads`, SIP storage buckets (`sip-resumes`, `sip-evidence-files`, `sip-milestone-files`) |
| 012 | Adds `sip_applications.execution_will_break` |
| 013 | Relaxes `OTHER` CHECK constraints |
| 014 | `user_roles`, `reviewer_assignments`, `reviews`, `ai_screening`, `application_status_log`, `audit_log_v2` |
| 015 | Expands `application_status` CHECK |
| 016 (two files) | `reviewer_pages_columns` additions to `reviews`; renames `score_solution` → `score_completeness` |
| 017 | `industry_categories`; adds `industry` column to `ai_screening`; `display_seq` |
| 018 | Adds `project_name` to `ai_screening` |
| 019 (three files) | Auto-assign `applicant` role on signup; mandatory profile links (LinkedIn, GitHub, resume) |
| 020 | `sip_application_templates`; storage bucket `sip-application-templates` |
| 021 | Adds co-founder invite + DPIIT fields to `sip_applications` |

### RLS policy summary

All tables have RLS enabled. Key policies:
- **profiles**: self can SELECT + UPDATE own row
- **applications / tir_applications**: self can SELECT, INSERT (once), UPDATE (draft only)
- **resume_uploads**: self can SELECT + INSERT
- **support_tickets**: anyone can INSERT, self can SELECT own
- **audit_logs / audit_log_v2**: no client access (service role only)
- **reviewer_assignments, reviews**: guarded by role capabilities (`reviewer`, `leadership`, `admin`) — no direct client RLS; all access via FastAPI backend with service role
- SIP tables: `profiles.track = 'sip'` enforced at RLS level for physical track isolation

---

## Branch differences

### `REVIEWER-UI` vs `main`

**What it is:** A completely separate, stripped-down standalone prototype. It does **not** extend the main React+Vite app — it is a raw HTML file that loads React from CDN and compiles JSX in-browser.

**Files that exist on `REVIEWER-UI` but not on `main`:**
- `index.html` — standalone reviewer portal shell
- `os/data.js` — 16 mock startups, reviewers, activity
- `os/api.js` — mock API seam (`window.ReviewerAPI`) + `useAsync` hook + toast
- `os/reviewer.jsx` — full reviewer portal UI (Queue, Dashboard, Eval form, History)
- `os/shell.jsx` — shared atoms (Radar, Slider, ScoreBar, etc.)
- `os/styles.css` — all CSS for the prototype
- `REVIEWER_BACKEND_HANDOFF.md` — engineering handoff doc

**Files on `main` that don't exist on `REVIEWER-UI`:**
- The entire `frontend/`, `backend/`, `infra/`, `docs/` tree — essentially the whole real product

**No reviewer routes in `main`'s `frontend/src/router.jsx`:** The only review-adjacent page on `main` is `frontend/src/pages/ReviewPage.jsx`, which is the *pre-submit applicant review screen* (not a reviewer portal).

**No reviewer backend router on `main`:** `backend/app/routers/` on `main` has no `reviewer.py`.

**No reviewer/reviews tables on `main`:** Migrations 001–009 have no reviewer or review tables. Those come in migration 014 on `release/sip-launch-v1`.

**REVIEWER-UI has 5 commits beyond main:**
1. `024da1f` — Reviewer Portal UI — standalone prototype (initial)
2. `e16c56e` — Re-openable evaluations + isolated history/queue stores
3. `834dfb0` — My History includes current-cohort submissions
4. `f039e03` — Nirav feedback round 2 (wording, bullets, beautify, role switch)
5. `a84d704` — Section headings larger than their content (Nirav)

---

### `release/sip-launch-v1` vs `main`

**What it adds (~200 commits beyond main):**

| Domain | What's new |
|---|---|
| **SIP track** | `/apply-sip/*` wizard, `sip_applications` table + router, SIP resume/evidence/template uploads, track chooser, cross-track submit blocking |
| **Admin platform** | `/admin/*` UI (UserListPage, UserDetailPage, AdminAddUser) + `admin_users.py` router (full user management, role grant/revoke, reset-password, deactivate) |
| **Leadership dashboard** | `/leadership` UI + `leadership.py` router — stats, applications table (8 columns, industry filter, AI score histogram, funnel), full application review surface |
| **Reviewer backend** | `reviewer.py` router — inbox assignments, application detail (AI stripped for anti-anchoring), submit/edit/decline reviews |
| **Reviewer frontend** | `ReviewerInboxPage`, `ReviewerScoringPage`, `ReviewerCompletedPage` + full component tree under `frontend/src/pages/reviewer/`; `reviewerApi.js` |
| **AI scoring** | LangGraph pipeline (4-pass: evidence extract → signal score → caps → synthesize); `ai_screening.py` admin endpoint; stored in `ai_screening` table |
| **RBAC** | `backend/app/rbac.py` + `user_roles` table + `audit_log_v2`; roles: applicant, founder, reviewer, mentor, leadership, admin |
| **Resend email** | Migrated from AWS SES; `resend_api_key` config; reviewer assignment email template |
| **SQS worker** | SQS FIFO queue + DLQ + worker Lambda for async AI scoring |
| **Migrations 010–021** | See database table above |
| **Prod infra** | SAM template with `AiStub` param, staging environment scaffolding |

**Admin UI state:**
- **Backend (release/sip-launch-v1):** Fully implemented — `admin_users.py` has all CRUD + role management endpoints
- **Frontend (release/sip-launch-v1):** Fully implemented — 5 pages under `frontend/src/pages/admin/`
- **Frontend (main):** Admin backend exists only as a header-key-guarded read-only `/admin/*` (stats + list). No admin UI pages exist on `main`.

---

## External services + env vars

| Service | Purpose | Key env vars |
|---|---|---|
| **Supabase** | Postgres + Auth (email OTP) + Storage | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **OpenRouter → Gemini** | Resume parsing + AI scoring pipeline | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default: `google/gemini-2.5-flash`) |
| **Resend** *(sip-launch)* | Transactional email (OTPs via Supabase, support replies, reviewer assignment notifications) | `RESEND_API_KEY`, `SES_FROM_EMAIL` (or alias `EMAIL_FROM`) |
| **AWS SES** *(main)* | Transactional email (main branch still uses SES) | `AWS_REGION`, `SES_FROM_EMAIL`, `SUPPORT_RECIPIENT_EMAILS` |
| **AWS Lambda + API Gateway** | Backend hosting (via SAM) | `AWS_REGION_APP` (in Lambda; `AWS_REGION` locally) |
| **AWS SQS** *(sip-launch)* | Async AI scoring job queue (FIFO + DLQ) | Configured in SAM template |
| **Vercel** | Frontend hosting | `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| **Sentry** | Error monitoring (optional) | `SENTRY_DSN` (blank = disabled) |

Other config:
- `ENV` / `APP_ENV` — `dev` | `staging` | `prod`
- `FRONTEND_ORIGIN` — comma-separated CORS allow-list
- `ADMIN_API_KEY` — ≥32 chars; required for `/admin/*` (main uses header-key; sip-launch uses RBAC)
- `RATE_LIMIT_DEFAULT` — e.g. `60/minute`
- `AI_SCORING_ENABLED` — `true` | `false` (sip-launch; default `false`)
- `AI_SCORING_MODEL` / `AI_SCORING_BASE_URL` — (sip-launch)
- `LOG_LEVEL` — `DEBUG` | `INFO` | `WARNING` | `ERROR`

---

## Known gaps / TODOs

### Prototype → production (REVIEWER-UI / `work/dayan-tasks` specific)

The `REVIEWER_BACKEND_HANDOFF.md` is the authoritative list. Key gaps:
1. **No build pipeline** — React + Babel from CDN, JSX compiled in-browser. Needs Vite/Next.
2. **No auth** — reviewer identity is hardcoded ("Vikram Sundar"). Needs session from the real auth system.
3. **All data is mock** — 16 startups in `data.js`; evaluation store is `localStorage`. All `ReviewerAPI.*` methods need real `fetch()` bodies.
4. **Application content is static** — `APP_DETAIL` ("Evaldam AI") is shown for every startup. Needs `GET /api/applications/:id`.
5. **No real routing** — tab is `useState`; no deep links, no back-button support.
6. **Evaluation persistence** — drafts lost on refresh (partially fixed: now `localStorage`, but needs real DB via `PUT /reviewer/evaluations/:appId`).
7. **Weighted overall score** — currently a plain mean; spec wants weighted (Problem 22%, Solution 30%, Tech 22%, Founders 14%, Commit 12%).
8. **Edit-window timer** — currently counts from mount; needs `editWindowExpiresAt` from server.
9. **Required-field validation** — client and server enforcement not yet wired.
10. **Accessibility** — Slider is mouse-only, table rows not keyboard-reachable, no focus trap in RubricModal.

### Full product (main vs release/sip-launch-v1)

- `main` has no reviewer frontend UI — only the backend admin read-only endpoint.
- `main` has no leadership dashboard UI.
- `main` has no RBAC — admin is header-key only.
- The standalone prototype (`REVIEWER-UI`) and the real reviewer frontend (`release/sip-launch-v1`) are completely separate codebases; they need to be reconciled/merged.
- AI scoring pipeline exists on `release/sip-launch-v1` but `AI_SCORING_ENABLED=false` by default (AiStub param in SAM).
- Rubric is defined twice in `os/reviewer.jsx` (`RubricModal` + `RubricInline`) — should be a single API-served source.
- `os/shell.jsx` exports several atoms (`Topbar`, `Sidebar`, `Stat`, `Histogram`, `Radar`, `FlagDot`) that are defined but never called in the reviewer portal.

---

## How to work in this repo

### Before making any change

1. Confirm you are on `work/dayan-tasks` (`git branch`).
2. Read the relevant source file before proposing edits.
3. Check `REVIEWER_BACKEND_HANDOFF.md` for the reviewer portal's intended API contract.

### Branch reading (without switching)

```bash
git show main:frontend/src/router.jsx
git show release/sip-launch-v1:backend/app/routers/reviewer.py
git log --oneline main..release/sip-launch-v1
git diff --stat main..REVIEWER-UI
```

### Never do

```bash
git checkout main          # forbidden
git checkout release/...   # forbidden
git checkout REVIEWER-UI   # forbidden
git push                   # only with explicit user request
git reset --hard           # only with explicit user request
git push --force           # never
```

### Commit (only when asked)

```bash
git add <specific files>   # never `git add -A` — risk of committing .env
git commit -m "$(cat <<'EOF'
  Short imperative title

  Body if needed.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
