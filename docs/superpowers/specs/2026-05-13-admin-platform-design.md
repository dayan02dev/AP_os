# ARTPARK OS — Admin Platform · Phase 1 design

**Status**: draft for review
**Branch**: `staging-role_based_dashboard` (forked from `main`)
**Target Supabase**: staging (`exqmxvdtcsvpgtftwjml`)
**Target Lambda**: staging (`artpark-eir-api-staging`)
**Scope**: build the two surfaces shown in the team's UI screenshots — **Leadership Dashboard** and **Admin User-Management page** — wired to real data, plus the minimum backend + reviewer plumbing those screens depend on.

### Source of truth

> **The team's UI screenshots are the canonical specification.** The PDFs (`ARTPARK_OS_Evaluation System`, `UX/UI Specification`, `Full Proposal`) are *context* — they describe the holistic Selection System we're building toward over several phases, not what Phase 1 ships. Where the PDFs and screenshots disagree on Phase 1 scope, **the screenshots win**.
>
> Concretely: features described in the PDFs but **not** visible in the screenshots are deferred:
> - Jury portal, psychometry, scoring.md editor, cohort analytics dashboard
> - Cohort Manager portal + role
> - Audit log feed page (the table + capability stay; no UI surface in Phase 1)
> - AI-vs-human variance flags + override-with-reason flow at Gate 1
> - Mentor + Founder dashboards
> - Multi-cohort archive
>
> The **reviewer experience** is not in the screenshots either. Phase 1 creates reviewer *assignments* (so leadership's "Assign reviewer" button is functional) and sends reviewers an email — but the reviewer scoring UI lands in **Phase 1.5** as the immediate next ship, before Phase 2 begins.

---

## 1. Goal

Ship the two surfaces shown in the team's UI screenshots, wired to real data on the staging Supabase, with the backend infrastructure they depend on. The applicant wizard flow stays as-is; what changes is everything *around* it: who can see the data, who can act on it, and how those actions ripple through the system.

### Two primary surfaces (from screenshots)

1. **Leadership Dashboard** (`/admin/dashboard`)
   - Header: track badge, user info, "EXPORT CSV", "SWITCH ROLE"
   - Two tabs: **Dashboard** (5 metric cards + pipeline funnel + AI score distribution + score components + industry breakdown + status grid) and **Applications** (sortable table + filter pills + search + per-row drawer with "Open full review", "Assign reviewer", "Move to shortlist")
   - All charts and counts come from real DB queries against the staging Supabase
   - Already prototyped in `leadership.jsx` (703 LOC) — Phase 1 wires it up

2. **Admin User-Management page** (`/admin/users/:userId`)
   - Section 01: Personal information (full name, email immutable, phone, organisation, role/title) + Save changes
   - Section 02: Active role panel showing all 6 role cards — in admin mode the verb is **GRANT / REVOKE** (in self-service mode it would be **SWITCH**)
   - Section 03: Change password (current / new / confirm + Update password button)
   - Section 04: Sign out
   - Reused as a shared `ProfileShell` component with `mode="self" | "admin"` variants

### Backend the screenshots depend on

- 6-role multi-role schema + `require_capability()` enforcement
- Leadership's drawer buttons need destinations: a reviewer-picker (modal), a status-transition endpoint, an application-detail page
- Email notifications on status transitions + on reviewer assignment
- AI screening pipeline (SQS + worker Lambda, stub mode default) so the dashboard's AI score charts have real rows to read from
- Immutable audit log of every state change (no UI page in Phase 1 — table + capability ready for Phase 2's audit feed)

### Phase 1.5 — the next ship after Phase 1

The reviewer experience: inbox + scoring screen with 5 sliders + Yes/Maybe/No. Built as a fast follow once leadership has been using Phase 1 long enough to inform the reviewer UI's details. **Not in Phase 1 acceptance**, but **explicitly the very next ship** before any Phase 2 work.

---

## 2. Scope summary

### In scope (Phase 1)

| Area | Item |
|---|---|
| Auth & roles | 6-role multi-role schema, role grant/revoke API, "active role" UI navigation, login-routing by role |
| Leadership UI | Dashboard tab (metrics + 4 charts + status grid) + Applications tab (filter + table + drawer) wired to real data |
| Admin UI | User Management page (list users + per-user grant/revoke/reset + Add User form) |
| AI pipeline | Async queue on submit, OpenRouter call to `google/gemini-flash-latest`, 5-category scoring + summary written to `ai_screening` (rubric prompt is a placeholder, refined later) |
| Reviewer machinery | 1–3 reviewer assignments per app, reviews table, status-transition wiring |
| Audit | Immutable `application_status_log` + `audit_log_v2` on every state change and admin action |
| Email | Notifications on key status transitions (submitted, under_review, evaluated, shortlisted, rejected, waitlisted) |
| RBAC enforcement | `require_capability()` FastAPI dep on every admin/leadership/reviewer endpoint |

### Out of scope (Phase 2+)

- L5 Psychometry (16-Q test + archetype cards)
- L6 Jury portal (external evaluators)
- L7 Gate 2 final decision + AI-drafted feedback composer
- scoring.md rubric editor with versioning
- Cohort Manager portal (CM-1, CM-2 screens)
- Jury Member role
- Cohort Manager role
- Mentor dashboard
- Founder post-acceptance dashboard (milestones, disbursements)
- Cohort analytics dashboard (A-9)
- Multi-cohort support
- AI vs reviewer variance flag with auto-routing

### Out of scope (forever, by design call)

- AI making final decisions — every gate stays human
- Applicants seeing AI scores or reviewer identities
- Reviewers seeing each other's scores

---

## 3. Roles & permissions

### 3.1 The 6 roles

| Role | Purpose | Provisioning |
|---|---|---|
| **applicant** | Pre-acceptance founder filling the wizard | Self-signup via `/apply/signup` |
| **founder** | Accepted applicant in the program | Auto-granted on status → `onboarded` (Phase 2 actually uses this) |
| **reviewer** | Internal domain expert scoring assigned apps in L3 | Admin invites via Add User form |
| **mentor** | Post-acceptance founder guide | Admin invites (Phase 2 actually uses this) |
| **leadership** | Eagle view of everything; assigns reviewers; sees cross-app stats; makes Gate 1 decisions | Admin invites |
| **admin** | Operational: provisions users, manages support tickets, resets passwords, edits rubric (Phase 2) | Admin invites (first admin seeded manually in Supabase) |

A user can hold **multiple roles** simultaneously (`user_roles` is a many-to-many join). `profiles.active_role` records which dashboard they're currently viewing — this is **UI state only**, not a permission gate.

### 3.2 Capabilities map

Defined as a Python constant in `backend/app/rbac.py`:

```python
# RBAC kept intentionally simple — static role → capability map. If rules
# grow conditional/temporal, migrate to Casbin or Cerbos. The
# require_capability() dep is the only API surface to swap.
ROLE_CAPABILITIES: dict[str, set[str]] = {
    "applicant":  {"manage_own_draft", "submit_app", "view_own_status"},
    "founder":    {"view_own_milestones", "upload_milestone_evidence"},
    "reviewer":   {"view_assigned_apps", "score_app", "comment_app",
                   "decline_assignment"},
    "mentor":     {"view_assigned_founders", "comment_founder"},
    "leadership": {"view_all_apps", "view_app_detail", "assign_reviewers",
                   "change_app_status", "view_stats", "export_data",
                   "view_audit_log"},
    "admin":      {"manage_users", "grant_role", "revoke_role",
                   "reset_password", "view_all_apps", "view_app_detail",
                   "change_app_status", "view_audit_log", "manage_support"},
}
```

Capability checks union across all of a user's granted roles — there's no "active role limits capabilities" rule. If a user has both `leadership` and `reviewer`, they can do everything in either set regardless of which dashboard is currently rendering.

### 3.3 Leadership vs Admin — the key distinction

Per user decision: these are **two distinct strategic vs operational tiers**, not synonyms.

- **Leadership** owns the *content* side: which applications pass L4, which reviewers get assigned to what, how the cohort is shaping up.
- **Admin** owns the *system* side: who has accounts, who has which role, who needs password resets, who's escalating support tickets.

Concretely:
- Leadership cannot create users (no `manage_users` capability) — they have to ask Admin.
- Admin can change application status (operational override) but in practice the dashboard hides this from them — they don't usually triage applications.
- Both can see all applications and audit logs.

### 3.4 Login flow

- All users sign in at the existing `/apply/signin`.
- On successful auth, backend returns the user's granted roles in the JWT/session payload.
- Frontend's `useAuth()` exposes `roles: string[]` and `activeRole: string`.
- Post-signin redirect:
  - If `applicant` is the only role → `/apply/...` wizard.
  - If any of `leadership`/`admin`/`reviewer`/`mentor` is granted → `/admin/dashboard` (the leadership shell, role-aware).
- Role switching: Profile page section 02 shows all granted roles. Clicking "Switch" sets `profiles.active_role` and reloads the dashboard.

---

## 4. Data model

Migration `014_admin_platform_phase1.sql` (already applied to staging Supabase) creates:

### 4.1 `user_roles`
```
user_id (uuid → profiles.id, CASCADE)
role (enum: applicant/founder/reviewer/mentor/leadership/admin)
granted_at, granted_by
PK (user_id, role)
```

### 4.2 `reviewer_assignments`
```
id, application_id, application_track ('tir'|'sip'),
reviewer_user_id, assigned_at, assigned_by,
declined_at, decline_reason,
reassigned_to (self-FK), completed_at
UNIQUE (application_id, application_track, reviewer_user_id)
```
**App-layer rule**: ≤3 *active* (non-declined, non-reassigned) assignments per application.

### 4.3 `reviews`
```
id, application_id, application_track,
reviewer_user_id, assignment_id,
score_problem, score_solution, score_tech,
score_founders, score_commitment, score_integrity,    -- 6 columns
score_overall, recommendation ('yes'|'maybe'|'no'),
disagree_with_ai (jsonb), strengths, concerns, quick_notes,
submitted_at, locked_at,
created_at, updated_at
UNIQUE (application_id, application_track, reviewer_user_id)
```

**Phase 1 uses 5 categories** matching the existing leadership dashboard:

| Spec category | DB column | Leadership UI label | Weight |
|---|---|---|---|
| Problem Importance & Clarity | `score_problem` | Problem Impact & Importance | 22% |
| Solution Depth & Completeness | `score_solution` | Completeness & Depth of Solution | 30% |
| Technical Strength | `score_tech` | Technical Depth | 22% |
| Founder Traits | `score_founders` | Behavioral Parameters | 14% |
| Commitment Level | `score_commitment` | Commitment | 12% |
| *Integrity & Closure* | `score_integrity` | *(not shown)* | *(Phase 2)* |

`score_integrity` is in the schema but stays NULL throughout Phase 1 — wired up in Phase 2 alongside the AI integrity check. Frontend never reads the integrity column in Phase 1.

### 4.4 `ai_screening`
```
id, application_id, application_track,
score_problem, score_solution, score_tech,
score_founders, score_commitment, score_integrity,
score_overall, confidence (jsonb), summary, flags (jsonb),
raw_response, model, ran_at, error
UNIQUE (application_id, application_track)   -- latest run replaces previous
```

### 4.5 `application_status_log`
```
id, application_id, application_track,
from_status, to_status, changed_by, reason, changed_at
```
Append-only. No updates, no deletes. Enforced via Postgres trigger.

### 4.6 `audit_log_v2`
```
id, actor_user_id, actor_role, action_type,
target_table, target_id, before_state, after_state,
reason, occurred_at
```
Captures every state change beyond status (role grants/revokes, password resets, reviewer assignment, manual overrides). Read-only. No updates, no deletes.

Named `audit_log_v2` because `audit_logs` already exists from migration 001 for support-ticket audit. Phase 2 will migrate the older log into this one.

### 4.7 `profiles.active_role` (column addition)
```
profiles.active_role text NULL
```
UI navigation device. NULL is valid (user hasn't picked yet → defaults to first granted role).

### 4.8 Status state machine (Phase 1 subset)

```
draft ─────── submit ──────▶ submitted
                                │
                                ▼ (AI pipeline runs)
                            ai_screening
                                │
                                ▼ (AI completes)
                            under_review
                                │ (leadership assigns 1–3 reviewers)
                                ▼ (all assigned reviewers submit)
                              evaluated  ◄─── new status name (was "reviewed")
                                │ (leadership Gate 1 decision)
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
          shortlisted        rejected        waitlisted
            (Phase 2)
                │
              ... interview / offered / onboarded — Phase 2+
```

Phase 1 wires every transition `draft → … → {shortlisted|rejected|waitlisted}`. The post-shortlist states (`interview`, `offered`, `onboarded`, `withdrawn`) exist as enum values for forward-compat but no UI controls drive them yet.

Status name change: I'm using `evaluated` (matching the spec's STATUS_CHIP component) instead of `reviewed` (which I'd proposed earlier). The spec's Global UI Components doc names this chip "EVALUATED · green".

---

## 5. Backend (FastAPI) — new routers + endpoints

All routers depend on `require_capability("…")` for authorization. All write actions append to `audit_log_v2` and (where relevant) `application_status_log`.

### 5.1 `/admin/users` — user provisioning + role mgmt

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/admin/users` | `manage_users` | List users with role chips + last-active + search |
| GET | `/admin/users/{user_id}` | `manage_users` | Single user detail incl. all roles + audit history |
| POST | `/admin/users` | `manage_users` | Create user (calls Supabase admin API → invite or temp password) |
| PATCH | `/admin/users/{user_id}` | `manage_users` | Edit name/phone/org/title |
| POST | `/admin/users/{user_id}/roles` | `grant_role` | Grant a role (body: `{role: "reviewer"}`) |
| DELETE | `/admin/users/{user_id}/roles/{role}` | `revoke_role` | Revoke a role |
| POST | `/admin/users/{user_id}/password-reset` | `reset_password` | Send reset email via Supabase |

### 5.2 `/leadership/applications` — read across both tracks

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/leadership/applications` | `view_all_apps` | Cross-track applications list with filters (track, industry, stage, status, AI-score range, search). Cached + paginated. |
| GET | `/leadership/applications/{track}/{id}` | `view_app_detail` | Single application detail incl. answers, files, AI score breakdown, all reviews, status history |
| POST | `/leadership/applications/{track}/{id}/status` | `change_app_status` | Move status with `{to_status, reason}`. Triggers email. |
| POST | `/leadership/applications/{track}/{id}/reviewers` | `assign_reviewers` | Body: `{reviewer_user_ids: [uuid, ...]}` (1–3). Creates `reviewer_assignments`, sends emails. |
| DELETE | `/leadership/applications/{track}/{id}/reviewers/{assignment_id}` | `assign_reviewers` | Unassign / reassign a reviewer |

### 5.3 `/leadership/stats` — dashboard KPIs

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/leadership/stats/overview` | `view_stats` | Single response with profiles count, apps submitted (TIR/SIP), advanced count, onboarded count, avg AI score |
| GET | `/leadership/stats/funnel` | `view_stats` | Counts per pipeline stage |
| GET | `/leadership/stats/ai-distribution` | `view_stats` | Histogram bins for AI score |
| GET | `/leadership/stats/components` | `view_stats` | Average per scoring category |
| GET | `/leadership/stats/industry` | `view_stats` | Count + % per industry |
| GET | `/leadership/stats/status` | `view_stats` | Count per status |

(All these are simple aggregate queries; they could be one composite endpoint but splitting keeps the leadership dashboard's individual charts independently cacheable.)

### 5.4 `/reviewer` — minimal placeholder for Phase 1

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/reviewer/assignments` | `view_assigned_apps` | Inbox of assigned (non-completed) reviews. Phase 1 returns a basic list; the scoring UI lands in Phase 1.5. |
| POST | `/reviewer/assignments/{id}/decline` | `decline_assignment` | Decline with reason. Notifies leadership. |
| POST | `/reviewer/reviews` | `score_app` | Submit a review (5 scores, recommendation, text fields). Backend sets `locked_at = submitted_at + 60 minutes`; subsequent PATCH within that window is allowed, after that returns 423 Locked. |
| PATCH | `/reviewer/reviews/{id}` | `score_app` | Edit a submitted review during the 60-minute window only. |

### 5.5 `/audit` — read-only log

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/audit/applications/{track}/{id}` | `view_audit_log` | Combined `application_status_log` + `audit_log_v2` rows for one app |
| GET | `/audit/recent` | `view_audit_log` | Most recent N events across the system (dashboard feed) |

### 5.6 AI pipeline (cross-cutting)

- **Trigger**: when an application status moves `submitted → ai_screening`, a Lambda background task enqueues an AI call.
- **Worker**: invokes `google/gemini-flash-latest` via OpenRouter. Prompt is a templated rubric pulled from a constant (Phase 2 will read from a `scoring_md` table).
- **Storage**: a row in `ai_screening` per application; latest run replaces previous via the UNIQUE constraint.
- **Auto-transition**: on AI completion, status → `under_review`. On AI failure, status stays `ai_screening` with the error stored; admin can re-trigger.
- **Stub mode (Phase 1)**: if `AI_STUB=true` env var is set, the worker fills `ai_screening` with deterministic random scores (5.0 ± 1.5) so the dashboard works without the OpenRouter integration being live.

---

## 6. Frontend (React) — new structure

### 6.1 Route additions

Built into `frontend/src/router.jsx`:

```
/admin                          → AdminAppShell (protected: leadership OR admin)
  /admin/dashboard              → LeadershipDashboard (default landing for leadership)
  /admin/users                  → AdminUserList (admin only)
  /admin/users/:userId          → AdminUserDetail (admin only)
  /admin/users/new              → AdminAddUser (admin only)
  /admin/applications           → applications list (mirrored from dashboard's Apps tab)
  /admin/applications/:track/:id → full app detail (Phase 1 stub, real in Phase 2)
  /admin/profile                → Profile (self-service, slim variant)
  (no audit-feed page in Phase 1 — table + capability exist for Phase 2)

/reviewer                       → ReviewerAppShell (protected: reviewer)
  /reviewer/inbox               → list of assigned apps (Phase 1 stub)
  /reviewer/:track/:id/score    → scoring screen (Phase 1.5)
```

### 6.2 Component layout

```
frontend/src/
├── pages/
│   ├── admin/
│   │   ├── AdminAppShell.jsx          ← header + sidebar + role-aware nav
│   │   ├── LeadershipDashboard.jsx    ← wraps the existing leadership.jsx
│   │   ├── AdminUserList.jsx
│   │   ├── AdminUserDetail.jsx        ← reuses ProfileShell with mode="admin"
│   │   ├── AdminAddUser.jsx
│   │   ├── ApplicationsList.jsx
│   │   ├── ApplicationDetail.jsx      ← Phase 1 stub
│   │   └── (no AuditFeed page in Phase 1)
│   └── reviewer/
│       ├── ReviewerAppShell.jsx
│       ├── ReviewerInbox.jsx
│       └── ReviewerScoring.jsx         ← Phase 1.5
├── components/
│   ├── ProfileShell.jsx                ← shared between self-service + admin modes
│   ├── RoleSwitcher.jsx                ← section 02 of profile
│   ├── ScoreBar.jsx                    ← spec component 8.1
│   ├── StatusChip.jsx                  ← spec component 8.2
│   ├── CompletenessFlag.jsx            ← spec component 8.3
│   └── AuditTimeline.jsx
├── hooks/
│   ├── useRoles.js                     ← reads from useAuth
│   ├── useCapability.js
│   └── useLeadershipStats.js           ← swr-style fetcher
└── lib/
    └── rbac.js                         ← mirrors backend ROLE_CAPABILITIES
```

### 6.3 Reusing the existing prototype

The Downloads-folder prototype's `leadership.jsx` (703 LOC) and the profile screenshots map almost 1:1 to the components above. Plan is:

1. **Copy `leadership.jsx` verbatim** into `src/pages/admin/LeadershipDashboard.jsx` as the starting point.
2. **Replace `generateCohort()` with real data fetches** via `useLeadershipStats`.
3. **Extract reusable pieces** (`MetricCard`, `FunnelStrip`, `ScoreHistogram`, `ComponentBars`, `IndustryBars`, `StatusGrid`, `ApplicationsTable`, `AppDrawer`) into `components/leadership/`.
4. **Wire the drawer's "Open full review" / "Assign reviewer" / "Move to shortlist" buttons** to the new endpoints.
5. **Build `ProfileShell`** from the 3 screenshots, with `mode="self"` and `mode="admin"` variants.

### 6.4 Visual language

Reuse the existing CSS tokens and `eir-*` class system. Spec's design tokens (Score Bar colours, Status Chip colours, Completeness Flag colours) get added to `styles.css`. SIP keeps violet (`#6B5CFF`); TIR keeps blue (`#3213B7`); admin shell uses the existing neutral palette.

---

## 7. AI pipeline (infrastructure now, prompts later)

### 7.1 Architecture — SQS + worker Lambda

The submit endpoint returns immediately; AI scoring happens asynchronously in a separate Lambda. Chosen over inline scoring to protect against deadline-day submission spikes and remove any risk of submit timeouts.

```
applicant submits ─▶ POST /sip-applications/{track}/me/submit
                       │
                       │  (Lambda #1: existing API function)
                       │
                       ├─ validate payload
                       ├─ write status = submitted
                       ├─ SendMessage to artpark-eir-ai-screening (FIFO)
                       └─ return 200 OK                          ← <500ms always
                                
                                ▼  (SQS holds the message)
                                
                       ┌─────────────────────────────────────┐
                       │  Lambda #2: artpark-eir-ai-worker  │
                       │  (separate SAM resource, SQS event  │
                       │   source mapping triggers it)       │
                       └─────────────────────────────────────┘
                                │
                                ├─ write status = ai_screening
                                ├─ build prompt (rubric + app data)
                                ├─ if AI_STUB=true: deterministic random scores
                                │  else: call OpenRouter → google/gemini-flash-latest
                                ├─ parse 5 scores + summary + flags
                                ├─ upsert into ai_screening
                                ├─ write status = under_review
                                └─ delete SQS message (handled by Lambda runtime on success)
                                
                                ▼  on failure (exception or timeout)
                                
                       SQS visibility timeout expires → message redelivered
                                │ (up to 3 receive attempts)
                                ▼
                       DLQ artpark-eir-ai-screening-dlq
                                │
                                ▼
                       CloudWatch alarm fires → admin sees "AI scoring failed" 
                       flag in dashboard; "Re-trigger" button re-enqueues
```

### 7.2 Infrastructure additions

New AWS resources (added to `infra/sam/template.yaml`):

| Resource | Purpose | Config |
|---|---|---|
| `AiScreeningQueue` (AWS::SQS::Queue) | Main FIFO queue for AI screening jobs | FIFO with content-based deduplication; visibility timeout 300s; max receive count 3 before DLQ |
| `AiScreeningDLQ` (AWS::SQS::Queue) | Dead-letter queue for jobs that fail 3× | FIFO; retention 14 days for forensics |
| `AiWorkerFunction` (AWS::Serverless::Function) | Worker Lambda that processes queue messages | Python 3.11, arm64, 1024MB RAM, 60s timeout, reserved concurrency 10 (don't hammer OpenRouter); same code base as API function, different handler entrypoint |
| IAM policy on `ApiFunction` | Allow SendMessage on the queue | `sqs:SendMessage` scoped to `AiScreeningQueue.Arn` |
| IAM policy on `AiWorkerFunction` | Allow receive/delete from queue + DB writes | `sqs:ReceiveMessage` + `sqs:DeleteMessage` + Supabase service-role env injection |
| CloudWatch alarm | Alerts admin when DLQ has any messages | Threshold `ApproximateNumberOfMessagesVisible > 0` for 60s |

The worker Lambda lives in the same `backend/app/` codebase but registered as a separate handler: `backend/app/ai_worker.py` with `lambda_handler(event, context)`. SAM bundles the same code for both functions.

### 7.3 Implementation notes

- **Stub mode default**: env var `AI_STUB=true` on the worker Lambda short-circuits to deterministic random scores (seeded by `hash(application_id)` so the same app always scores identically). Returns in <10ms. No OpenRouter calls. All downstream code paths work identically — dashboard widgets, status transitions, audit log entries.
- **Switching to real Gemini**: flip `AI_STUB=false` in the worker Lambda env vars and redeploy. From that point every new submission gets a real Gemini call. Already-scored apps stay at their stub scores until manually re-triggered.
- **Rubric in code**: Phase 1 stores the rubric prompt as a Python constant in `backend/app/ai_rubric.py`. Phase 2 migrates it to a `scoring_md` DB table with versioning + admin editor (the spec's L2 scoring.md UI).
- **Idempotency**: SQS at-least-once delivery means a message could be processed twice. Safe because `ai_screening` has `UNIQUE (application_id, application_track)` — second worker run upserts over the first. Status transitions are also idempotent (writing `under_review` over `under_review` is a no-op).
- **Failure handling**:
  - First 2 retries: SQS redelivers automatically with backoff
  - 3rd failure: message lands in DLQ
  - Dashboard shows affected applications with "AI scoring failed — re-trigger" chip
  - Re-trigger sends a fresh SQS message; DLQ message stays for audit
- **Stub mode + real Gemini coexist**: even with stub default, the OpenRouter call path is fully written and tested in CI. Flipping the env var is the *only* change needed to go live.

### 7.4 Frontend impact of async AI

The post-submit screen needs to handle the "AI not yet complete" state. Concretely:

- Immediately after submit, applicant lands on the existing submission-receipt screen. AI score is NULL.
- For the applicant's "My Application" status page (Phase 2), we'll show "Application under review · AI screening in progress" until status flips.
- For the leadership dashboard, applications with `status=ai_screening` show a small pulsing "processing" chip (per spec component 8.2 — `PROCESSING (cyan, pulsing)`). They auto-disappear on next dashboard refresh once status moves to `under_review`.
- Phase 1 uses **manual refresh** on the leadership dashboard (no realtime). With stub mode the gap is ~10ms; with real Gemini it's 3–8s. Phase 2 wires Supabase Realtime subscriptions if leadership reports stale-data complaints.

### 7.5 Cost envelope (real Gemini, post-stub)

- Per scoring call: ~3000 input + ~500 output tokens × Gemini Flash pricing = **~$0.0003 per submission**
- 2000-app cohort = **~$0.60 per cohort**
- SQS messages: $0.40 per million → **effectively $0** at this volume
- Worker Lambda invocations: included in existing free tier or pennies per cohort

Total ongoing AI cost = **under $1 per cohort** at current scale.

### 7.3 Out-of-scope for Phase 1 AI

- Confidence calibration (spec's confidence % per category — column exists, stays null)
- Inconsistency flags (column exists, stays empty)
- Radar chart on application detail (deferred to Phase 2 with the AI Evaluation View screen)
- scoring.md editor with version history

---

## 8. Email notifications (Phase 1 cut)

Re-uses the existing Resend integration. Triggers:

| Event | Recipient | Template |
|---|---|---|
| Application submitted | applicant | "Your application is in" (already exists in production for TIR) |
| Reviewer assigned to app | reviewer | "You have a new application to review — [app] — due [date]" |
| Reviewer assignment declined | leadership | "Reviewer [name] declined — please reassign" |
| All reviewers completed (status → evaluated) | leadership | "App [id] is ready for Gate 1" |
| Status → shortlisted | applicant | "You've been shortlisted" |
| Status → rejected | applicant | Rejection with category code + improvement hints (no raw scores) |
| Status → waitlisted | applicant | Neutral waitlist email |
| Role granted | new user | "You've been invited as a [role] on ARTPARK OS" (with magic link) |
| Password reset | user | Supabase default reset email |

In-portal notification system (spec component 8.6) is **Phase 2**. Phase 1 uses email only, mirrored by the wizard's existing "Continue application" tab counter for status changes.

---

## 9. Error states & edge cases

Phase 1 must explicitly handle:

- **AI pipeline failure** — show "AI scoring failed" chip on affected applications in leadership view. Show "Re-trigger" button. Status stays `ai_screening`. Audit-logged with model + error message.
- **Reviewer declines before scoring** — `reviewer_assignments.declined_at` set. Leadership sees a red flag on the app. No partial review created.
- **3-reviewer cap exceeded** — backend rejects the assignment POST with 409 + `{code: "reviewer_cap_reached"}`.
- **Self-assignment** — reviewer can't be assigned to an app they themselves submitted. Backend checks `reviewer_user_id != application.user_id`, returns 409 + `{code: "self_assignment_blocked"}`.
- **Role grant to non-existent user** — 404 + clear error. Admin can fall back to creating the user first.
- **Last admin revocation** — backend refuses to remove the `admin` role from the only remaining admin user. 409 + `{code: "last_admin_protection"}`.
- **Status transition invariant** — backend rejects illegal transitions (e.g. `draft → shortlisted`) per a hardcoded state-machine map.
- **Race on simultaneous status changes** — Postgres advisory lock on `(application_id, application_track)` during transition writes.

---

## 10. Testing strategy

### 10.1 Unit
- `rbac.py` capability resolution (union of roles, no-active-role default)
- Status state-machine transition map
- Reviewer assignment cap enforcement
- AI response parser (5 scores + summary)

### 10.2 Integration (against staging Supabase)
- Full lifecycle: signup → submit → AI screening (stubbed) → assign 2 reviewers → submit 2 reviews → leadership Gate 1 → status shortlisted → audit log has every step.
- Role grant + revoke + last-admin protection.
- Cross-track listing: leadership sees both TIR + SIP apps in one table.

### 10.3 Smoke (manual against the deployed staging URL)
- Sign in as a freshly-seeded leadership user → dashboard loads with real data.
- Sign in as freshly-seeded admin → User Management page shows all users with their role chips.
- Add new reviewer via Admin Add User form → log in as that reviewer → land on reviewer inbox.
- Assign that reviewer to an app → reviewer sees it in inbox → submits a stubbed score.

### 10.4 Seed data
A script `backend/scripts/seed_synthetic_cohort.py` generates ~40 synthetic applications (mix of TIR + SIP, varied stages/industries/scores), 5 fake reviewers, 1 fake leadership, 1 fake admin, with deterministic content. Run once after the DB migration; idempotent (skips if seed marker exists).

---

## 11. Migration plan

### Step 1 — DB schema ✓ (done)
Migration `014_admin_platform_phase1.sql` already applied to staging Supabase.

### Step 2 — Branch + scaffolding
- Create branch `staging-role_based_dashboard` off `main`.
- Cherry-pick the migration file into `backend/migrations/014_admin_platform_phase1.sql`.
- Add new backend modules (`rbac.py`, `routers/admin_users.py`, `routers/leadership.py`, `routers/reviewer.py`, `routers/audit.py`, `ai_rubric.py`).
- Add frontend routes + components per § 6.

### Step 3 — Vertical slice: Admin → Add User → Reviewer → Inbox
- Backend: `/admin/users` POST + GET, `/auth/login` returning roles.
- Frontend: Admin Add User form + Reviewer Inbox stub.
- Smoke test end-to-end before any other work.

### Step 4 — Wire the leadership dashboard
- Copy `leadership.jsx` into the new structure.
- Replace mock data with `/leadership/stats/*` and `/leadership/applications` fetches.
- Drawer's "Assign reviewer" calls `/leadership/.../reviewers`.

### Step 5 — Reviewer scoring screen (Phase 1.5)
- Builds on the inbox. The 6-slider scoring form is in spec R-2.

### Step 6 — AI pipeline (SQS + worker)
- Add SQS queue + DLQ to SAM template.
- Build `backend/app/ai_worker.py` with `lambda_handler(event, context)`.
- Wire IAM policies: API Lambda gets SendMessage, worker Lambda gets ReceiveMessage + DeleteMessage.
- Submit endpoint enqueues on `status=submitted`.
- Worker writes `ai_screening` row + transitions to `under_review`.
- Stub mode (`AI_STUB=true`) wired but real Gemini call also fully implemented and CI-tested behind the flag.
- CloudWatch alarm on DLQ depth.
- Dashboard chip for `processing` status, "Re-trigger" button on failed apps.

### Step 7 — Email notifications + audit + edge cases
- Wire Resend templates per § 8.
- Add invariants per § 9.

### Step 8 — Seed + smoke + QA
- Run seed script.
- Manual QA per § 10.3.
- Codex/codereview pass on the diff before any prod consideration.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| SQS message lost mid-processing (worker Lambda dies before deleting) | SQS visibility timeout (300s) means message reappears after worker death; max 3 retries before DLQ. Idempotent write via `ai_screening` UNIQUE constraint prevents double-scoring. |
| DLQ fills up silently if no one watches | CloudWatch alarm fires the moment DLQ depth > 0; leadership dashboard shows a red banner with affected app count. |
| Deadline-day surge (500+ concurrent submits) | SQS buffers infinitely; worker Lambda concurrency capped at 10 to protect OpenRouter rate limits — applications get scored within a few minutes, not a few seconds, but submit endpoint stays <500ms throughout. |
| Cross-track FK polymorphism (no DB-level FK from reviews to tir_applications/sip_applications) | Validate at API layer on every write. Add a Postgres trigger in Phase 2 if integrity drift becomes a problem. |
| Last-admin lockout | Hard-coded backend protection (§ 9). Plus: first admin is seeded directly in Supabase, never deletable through the API. |
| Stub AI scores look "fake" in screenshots for board demos | Seed script generates AI scores that mirror real distributions (5.5 ± 1.2 with category-correlation). Toggleable via env. |
| Role naming drift between UI mock and code | Single source of truth = the `user_roles.role` CHECK constraint. Frontend constants in `lib/rbac.js` must match. Lint rule in CI to detect mismatch. |
| Reviewer 60-min edit window enforcement client-side only | Backend rejects PATCH after `locked_at + 60min`. UI surfaces the timer as a guide, backend is authoritative. |

---

## 13. Open questions (none blocking — note for Phase 2)

- Founder dashboard layout — placeholder for now; comes in Phase 2 with milestone tracking.
- Mentor ↔ founder pairing flow — Phase 2.
- Email template visual polish — using Resend defaults for Phase 1.
- Multi-cohort archive — single 2026 cohort hardcoded for Phase 1.

---

## 14. Acceptance criteria — Phase 1 ships when

1. ✅ Migration 014 applied to staging Supabase.
2. ⬜ Admin signs in, opens User Management, adds a new reviewer + sets their role. Reviewer receives the invite email.
3. ⬜ That reviewer signs in, sees a populated inbox (assigned by leadership), submits a review.
4. ⬜ Leadership signs in, sees the dashboard wired to real data (≥40 synthetic apps), filters by industry + status, opens an app drawer, assigns 2 reviewers, moves the status to shortlist after both reviewers submit.
5. ⬜ Every state change above appears in the audit log within 2 seconds.
6. ⬜ Email is sent at every key transition (visible in Resend dashboard).
7. ⬜ AI pipeline: submit endpoint returns 200 in <500ms; worker Lambda picks up the SQS message, writes `ai_screening` row, transitions status to `under_review`. With `AI_STUB=true` this happens in <2s; with real Gemini in 3–8s. DLQ stays empty under normal load.
8. ⬜ Role + capability enforcement: a reviewer who tries to hit `/leadership/applications` gets 403.
9. ⬜ Last-admin protection: attempting to revoke the last admin role returns 409.
10. ⬜ Lighthouse mobile score on `/apply/signin` and `/admin/dashboard` ≥ 85.

---

## 15. What this design intentionally does NOT include

To prevent scope-creep mid-build, the following are **deferred to later phases** and should not be added without an explicit spec amendment:

- Psychometry test + archetype card generation (L5)
- Jury portal + 3-dimension scoring (L6)
- Gate 2 final decision + AI-drafted rejection feedback composer (L7)
- scoring.md rubric editor with versioning + AI proposal mode
- Cohort Manager portal (CM-1, CM-2 in spec)
- Cohort analytics dashboard (A-9) — calibration heatmap, funnel analytics, reviewer drift
- AI vs reviewer variance flag at Gate 1 (high-amber-red colour bands + override-with-reason flow)
- Mentor dashboard
- Founder post-acceptance milestones dashboard
- Multi-cohort support + cross-cohort archive
- Confidence percentages per AI score category
- AI inconsistency flags
- 60-minute reviewer edit window timer UI (backend enforces; UI gets it in Phase 1.5)
- Audit log CSV export
- Cohort Manager and Jury Member roles (not in `user_roles` enum until Phase 2)
