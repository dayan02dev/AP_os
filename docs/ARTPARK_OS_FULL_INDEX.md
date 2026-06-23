# ARTPARK OS — Full System Index (Applicant · Leadership · Reviewer · Admin)

> **Scope:** the entire ARTPARK OS as it stands in **production**.
> **Source of truth:** `release/sip-launch-v1` @ `6bd1fe1` (= this worktree `admin-ui-faithful-port`).
> Frontend: Vercel `ap-os`, prod domain `apply.artpark.info` (set by manual "Promote to Production").
> Backend: AWS SAM stack `artpark-eir-api-production` (ap-south-1), API `api.artpark.info`.
> DB/Storage/Auth: production Supabase. Supersedes `docs/ADMIN_REVIEWER_PORTAL_INDEX.md` (admin+reviewer only, written at the older `a2c0d82`).

The OS is **one React SPA + one FastAPI Lambda + one Postgres (Supabase)** serving four
audiences off a shared role/capability model and a shared application data model:

1. **Applicant** — the TIR + VIP (SIP) application wizard + post-login dashboard (`/apply`, `/apply-sip`).
2. **Leadership** — cohort dashboard, cross-track triage, gate-1 decisions (`/leadership`).
3. **Reviewer** — assigned-queue scoring (`/reviewer`).
4. **Admin** — control panel: roster, batches, decisions, audit, analytics, user roles (`/admin`).

---

## 0. End-to-end lifecycle (how the surfaces connect)

```
APPLICANT                         AI (async)              LEADERSHIP / ADMIN            REVIEWER
  signup ─ pick track (TIR|VIP)
  fill 6-section wizard (draft)
  submit ──────────────▶ SQS ──▶ worker Lambda ──▶ ai_screening row (6 scores + summary)
       status: submitted              │                    │ status → under_review (when assigned)
                                       │                    │ assign reviewers ──▶ reviewer_assignments ──▶ queue
                                       ▼                    │                                              │ score → reviews row
   edit-after-submit (window) ──▶ re-publish SQS            │                          all reviews in ◀────┘
                                                            │   status auto → evaluated
                                            gate-1 decision (reject/shortlist/hold/waitlist)
                                            via admin_decisions + state_machine + application_status_log
                                            (leadership can reject from ANY active status)
```

Shared tables are the contract: `tir_applications`/`sip_applications` (the app), `ai_screening`
(round-1 AI), `reviewer_assignments` (admin/leadership writes → reviewer reads), `reviews`
(reviewer writes → admin/leadership reads), `admin_decisions` + `application_status_log` (gate-1).

---

## 1. Platform spine (shared)

### Routing (`frontend/src/router.jsx`)
`BrowserRouter` + React Router v6. `ProtectedRoute` + capability gates; `landingPathFor` after sign-in
sends leadership/admin → `/admin` or `/leadership`, reviewer → `/reviewer`, applicant → `/apply`.
- Public: `/apply/signin`, `/apply/signup` + `/apply-sip/signup`, `/apply/verify`, `/apply/support`, `/apply/set-password`.
- Applicant (gated): `/apply` + `/apply/{basic,problem,solution,execution,evidence,declaration}`, `/apply/template`, `/apply/review`, `/apply/submitted`, `/apply/profile`; `/apply-sip/*` mirrors.
- Leadership (`view_stats`/`view_app_detail`): `/leadership`, `/leadership/applications/:track/:id/review`.
- Reviewer (`view_assigned_apps`): `/reviewer`, `/reviewer/queue`, `/reviewer/eval/:track/:appId`, `/reviewer/history`.
- Admin: `/admin/*` (`view_all_apps`), `/admin/users` (`manage_users`).

### Auth (`hooks/useAuth.jsx`, `lib/api.js`, `backend/app/deps.py`)
Supabase JWT (Bearer). `useAuth` rehydrates via `GET /auth/me`. `api.js` auto-refreshes once on 401
(`POST /auth/refresh`), then clears session + fires `auth:expired`. `get_current_user()` verifies the
token, attaches `profiles.track` + `user_roles` → `{user_id, email, track, roles}`.

### RBAC (`backend/app/rbac.py` ↔ `frontend/src/lib/rbac.js`, kept in sync)
| Role | Capabilities |
|------|---|
| applicant | manage_own_draft, submit_app, view_own_status |
| founder | view_own_milestones, upload_milestone_evidence |
| reviewer | view_assigned_apps, score_app, comment_app, decline_assignment |
| mentor | view_assigned_founders, comment_founder |
| leadership | view_all_apps, view_app_detail, assign_reviewers, change_app_status, view_stats, export_data, view_audit_log, **decide_application** |
| admin | manage_users, grant_role, revoke_role, reset_password, view_all_apps, view_app_detail, assign_reviewers, change_app_status, view_stats, view_audit_log, manage_support, decide_application, manage_batches, manage_reviewers_roster |

Backend `require_capability(cap)` → 403; frontend `hasCapability()` gates rendering.

### AI screening (`routers/ai_screening.py`, `services/ai_scoring/*`, `workers/ai_screener/`)
Submit → SQS FIFO `artpark-eir-ai-screener-production.fifo` → worker Lambda (reserved concurrency 10) →
LangGraph pipeline (OpenRouter `google/gemini-2.5-flash`, temp 0) → upsert `ai_screening`. 3 retries → DLQ
`...-dlq-production.fifo` (alarm on non-empty). **6 score columns:** `score_problem`,
`score_completeness` (AI's "solution/completeness" — renamed from score_solution in mig 016),
`score_tech`, `score_founders`, `score_commitment`, `score_overall` + `confidence`, `summary` (JSON),
`flags` (cap_events/needs_human_review), `industry_category_id`, `project_name`. `AI_STUB=true` returns
deterministic scores. Manual re-run: `POST /admin/ai-screening/run`.

### Email (`services/email_service.py`, Resend)
Submission confirmation (post-submit, TIR+SIP), support ticket (to staff), ticket acknowledgement.
From `noreply@artpark.info`; 2/sec rate-limited; submission errors propagate, support errors swallowed.

### Config / feature flags (`backend/app/config.py`)
- `TIR_SUBMISSIONS_CLOSED` (bool) — **TIR intake currently CLOSED**; gates new TIR account/draft/submit; existing TIR users keep access; SIP unaffected. Reversible toggle (SAM param `TirSubmissionsClosed`).
- `EDIT_DEADLINE_TIR` (~2026-06-25 IST) / `EDIT_DEADLINE_SIP` (~2026-07-05 IST) — edit-after-submit windows.
- `RATE_LIMIT_DEFAULT` = `60/minute`; `ADMIN_API_KEY` (≥32, prod-strict); `FRONTEND_ORIGINS` (CORS); `AI_STUB`.

### SAM (`infra/sam/template.yaml`)
arm64 Python 3.11, 1 GB. **ApiFunction** (FastAPI, 29s) behind **HttpApi** (CORS, prod-locked + Vercel
preview in non-prod). **AiScreenerFunction** (worker, 60s, concurrency 10) off **AiScreenerQueue** (FIFO,
vis 300s, 3 retries) + **AiScreenerDLQ**. CloudWatch alarms: API errors/throttles/p99, DLQ non-empty.
Deploy: `infra/sam/deploy-prod.sh` (sources `backend/.env.prod`, container build, stack `artpark-eir-api-production`).

### Migrations (`backend/migrations/`, 014→026)
014 admin-platform RBAC tables · 015 status-constraint expand · 016 score_solution→score_completeness (+reviewer v2 cols) · 018 ai_screening.project_name · 019 applicant-role-on-signup + profile-links policy · 020 SIP offline templates · 021 SIP team/DPIIT · 022 reviewer portal v2 (flags, due_at) · 023 reviewer-assignments reconcile · 024 admin-platform refinements · 025 SIP linkedin/github/resume_file_id · **026 edit-after-submit (edited_after_submit, last_edited_at) both tracks**.

---

## 2. Applicant — TIR + VIP (SIP) application

### Frontend (`frontend/src/`)
- **Wizard shells:** `App.jsx` (TIR), `AppSip.jsx` (SIP). State machine: welcome → upload → parse-review → (template) → 6 sections → review → submit. URL-synced per section; debounced autosave (800ms).
- **Question schemas:** `questions.jsx` (TIR), `questions_sip.jsx` (SIP) — 6 sections each, conditional logic. SIP adds gates (incorporated / TRL — "not yet"/"TRL≤3" → early-exit "better fit for TIR"), DPIIT, cap-table, traction.
- **Inputs:** `inputs.jsx` / `inputs_sip.jsx` (incl. `CaptableInput`, `DpiitInput`, `SipTractionFilesInput`).
- **Field maps:** `lib/fieldMap.js` / `lib/fieldMap-sip.js` — questionId ↔ DB column (section-prefixed). Special cases: `declarations` dict ↔ 4 booleans; `sipDpiit` object ↔ 3 columns; `linkedinUrl`/`githubUrl`/`resumeFileId` (added mig 019/025).
- **State hooks:** `hooks/useApplication.jsx` / `useSipApplication.jsx` — draft load/save/submit, `startNew()` (multi-app), `refreshSubmitted()`, `saveSubmittedField()` (edit-after-submit), `wrongTrack`(403)/`tirClosed` flags.
- **Resume:** `auth_upload.jsx` (UploadScreen → ParsingScreen → ParsedReviewScreen, captures CV+LinkedIn+GitHub) + `hooks/useResume.js`/`useSipResume.js`.
- **Post-login dashboard (`auth_upload.jsx`):** `ReturningChoiceScreen` (Current / Past tabs), `SubmittedDashboard` (6-stage milestone pipeline, status, reviewer notes), `CurrentPane`/`PastPane`. Track picker for first-timers.

### Backend
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/applications/me` | user(tir) | fetch/auto-create draft |
| PATCH | `/applications/me` | user | partial update (status must be draft) |
| POST | `/applications/me/submit` | user | validate + status→submitted + SQS publish (5/hr; **TIR-closed gate**) |
| GET | `/applications/me/submitted` | user | list submitted (Past tab) |
| GET | `/applications/me/completion` | user | completion_pct + missing required |
| PATCH | `/applications/{id}` | user(owner) | **edit-after-submit** within window; stamps edited + re-screens (409 if not editable) |
| POST | `/resume/upload`, GET `/resume/me`, GET `/resume/{id}`, POST `/resume/me/apply-to-application` | user | CV upload + inline parse + copy into draft |
| (SIP mirrors) | `/sip-applications/*`, `/sip-resume/*` | user(sip) | same shape |

- **Models** (`models/application.py`, `models/sip_application.py`): section-prefixed columns; long-text fields capped at 5000 (essay caps 1000–2000); `completion_pct`, `submitted_at`, `editable`, `edit_deadline`, `edited_after_submit`, `last_edited_at`. SIP-specific: `sip_incorporated`, `sip_trl`, `sip_dpiit_*`, `sip_founders` (cap-table JSONB), `sip_traction(_details/_files)`, `sip_pitch_deck`, `sip_cap_table_file`, `sip_demo_video_url`, `sip_patents_files`.
- **Submit order:** TIR-closed gate → rate check (no consume) → fetch draft → `_validate_submission` (required + format) → status=submitted → consume quota → audit → **SQS publish (AI screening)** → confirmation email.
- **Edit-after-submit:** `services/edit_window.is_edit_open(track)` + owner + status∈{submitted,under_review}; declarations stay locked (422 if unset); re-publishes SQS.
- **Track isolation:** `require_track()` dep; cross-track access bounces.

---

## 3. Leadership portal (`/leadership`)

### Frontend (`frontend/src/pages/leadership/`)
- **`LeadershipDashboard.jsx`** — shell; topbar (logo, **PortalSwitcher**, sign-out); two tabs via `view` state:
  - **Dashboard:** 5 stat tiles, 6-step funnel, **status-breakdown grid** (click a status → switches to Applications tab filtered), AI-score histogram (click bucket → filter), component-average bars, industry bars/pills. (Title now **"TIR + VIP cohort 2026"**; the live-snapshot subline was removed.)
  - **Applications:** filtered paginated table (search/track/status/score-bucket/industry), CSV export.
  - Row → **`components/AppDrawer.jsx`** (slide-in): AI score + bars + summary, problem/solution, assignments, reviews, status history; footer **Reject application** (prompts reason) + **Review application**. `refreshNonce` refetches after a decision.
- **`ReviewApplicationPage.jsx`** + `review/*` — full per-app surface: tabs **Application / Reviews / History** (Assessment + Evidence & Files tabs removed), collapsible **AI Screening Panel** (score + reviewers), Prev/Next, assign/unassign reviewers.
- **`lib/leadershipApi.js`** — `getStats`, `listApplications`, `getApplication`, `getIndustryCategories`, `fileSignedUrl`, `assignReviewers`, `unassignReviewer`, **`decide`** (POST decision).
- **`applicationSchemas.js`** — TIR (6 sec/24 q) + SIP (6 sec/29 q) display schemas.

### Backend (`routers/leadership.py`, `routers/leadership_actions.py`)
| Method | Path | Capability | Purpose |
|--------|------|-----------|---------|
| GET | `/leadership/stats` | view_stats | `{totals, funnel, status_counts, ai_score_overalls}` |
| GET | `/leadership/applications` | view_all_apps | paginated cross-track list (filters) |
| GET | `/leadership/applications/{id}` | view_app_detail | full detail (track inferred) |
| GET | `/leadership/industry-categories` | view_stats | filter pills + breakdown (cap 12) |
| GET | `/leadership/applications/{id}/files/signed-url` | view_app_detail | allow-listed signed download |
| POST | `/leadership/applications/{id}/reviewers` | assign_reviewers | bulk-assign |
| DELETE | `/leadership/applications/{id}/reviewers/{rid}` | assign_reviewers | unassign (409 if review submitted) |
| POST | `/leadership/applications/{id}/decision` | decide_application | **gate-1 decision (default reject)** → `decisions.record_decision` |

Services: `stats.py` (DB-side count(*) per status×track, funnel, score list), `applications_query.py` (list/detail, `find_application_with_track`, file allow-list), `industry_categories.py` (LLM-classified, cap 12). Filters: status/search/track DB-side; industry + score-bucket Python-side.

---

## 4. Reviewer portal (`/reviewer`) — see also `docs/ADMIN_REVIEWER_PORTAL_INDEX.md`
Frontend `frontend/src/pages/reviewer/v2/` (scoped `.rv-portal`): `ReviewerPortal` shell (topbar now uses
shared **PortalSwitcher**), Dashboard, **Queue** (AI-score cell inline-styled to dodge the global
`.lp-score-bar` leak), **Eval** (5 sliders problem/solution/tech/founders/commit + reco + notes + flags,
autosave POST→PATCH, 60-min edit window; AI-disagreement UI removed), History.
Backend `routers/reviewer.py` + `services/reviewer_query.py`: queue/inbox, content (signed URLs), `POST
/reviewer/reviews` (writes `reviews`; on submit sets `submitted_at`/`locked_at`, marks
`reviewer_assignments.completed_at`, auto-transitions app → evaluated when all done; `_validate_disagreements`
is a no-op), `PATCH /reviewer/reviews/{id}` (60-min window). Weighted overall 22/30/22/14/12 mirrored FE/BE.

---

## 5. Admin portal (`/admin`) — see also `docs/ADMIN_REVIEWER_PORTAL_INDEX.md`
Frontend `frontend/src/pages/admin/platform/` (scoped `.adm-portal`): `AdminPortal` shell (logo fixed to
`/assets/artpark-iisc-logo.webp`; topbar uses shared **PortalSwitcher**; `decisionMode` reviewer/jury).
Screens — LIVE: Dashboard, Pipeline, Detail + ComparativeReviewModel (real `reviews[]` + names), Gate-1
decisions, **Reviewers roster** (Invite member + **Edit reviewer** picker → Manage drawer editing
name/email/domain/weight + batch assign/unassign + rebalance), Analytics, Audit, Roles. PREVIEW (mock):
Jury, Psychometry, Gate-2. Data: `adminPlatformApi` → `adminDataAdapter` (AI_CAT vs REVIEW_CAT keep
`score_completeness`≠`score_solution`) → `useAdminData`.
Backend `routers/admin_platform.py`: pipeline/detail/stats/roster/audit/calibration/batches/decisions/
rebalance + `PATCH /admin/platform/reviewers/{id}` (weight/domains on reviewer_profiles **+ name/email on
profiles via UPDATE, auth email synced**). `admin_query.fetch_roster` uses `.in_()` (PostgREST 1000-row cap).
`routers/admin_users.py`: create user / roles. State machine + decisions in §6.

---

## 6. Gate-1 state machine (`services/state_machine.py`, `services/decisions.py`)
`LEGAL_TRANSITIONS`: **reject is reachable from every active (non-terminal) status** (submitted, ai_screening,
screening_failed, under_review, evaluated, on_hold, shortlisted, jury_review, interview, offered, waitlisted)
— so leadership/admin can reject straight from the dashboard. Terminal: onboarded, rejected, withdrawn.
Other gate-1 moves (shortlist/hold/waitlist) only from evaluated/on_hold. `record_decision` pre-validates →
writes `admin_decisions` (gate1) → `apply_status_change` (writes status + `application_status_log`) → audit.
Reviewer completion auto-transitions under_review → evaluated.

---

## 7. Gotchas to keep in head
- **TIR intake is CLOSED** on prod (`TIR_SUBMISSIONS_CLOSED`); SIP/VIP open. Reopen = flag false + redeploy.
- AI `score_completeness` ≠ human `score_solution` — the admin adapter's AI_CAT/REVIEW_CAT keep them apart.
- `profiles.email` is NOT NULL → reviewer-edit writes use `UPDATE` (not upsert), else name-only edits 422.
- `leadership.css .lp-score-bar` is unscoped/global → reviewer queue AI cell uses inline styles.
- Roster must use `.in_()` (PostgREST caps select-all at 1000 rows → would drop reviewers > 1000 users).
- Vercel prod = manual **Promote to Production** of `release/sip-launch-v1`; DDL runs by hand in Supabase Studio.
- **Before any prod deploy, check the worktree base vs `origin/release/sip-launch-v1`** — a stale worktree will silently roll prod back (the 29-commit divergence incident, 2026-06-23).
- Long essay fields capped at 5000 chars (over-cap paste → silent 422 "save failed").
