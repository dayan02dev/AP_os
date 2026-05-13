# Phase 1 Admin Platform — Parallel Session Division

> **Purpose:** Split the 29-task plan in `2026-05-13-phase1-admin-platform.md` into 8 parallel Claude Code sessions so multiple instances can work simultaneously without rework or merge conflicts.

**Branch:** `staging-role_based_dashboard` (every session works on this branch)
**Plan:** `docs/superpowers/plans/2026-05-13-phase1-admin-platform.md`
**Spec:** `docs/superpowers/specs/2026-05-13-admin-platform-design.md`

---

## How to Use This Document

1. Sessions are grouped into **phases**. Phase N must complete before Phase N+1 starts.
2. Within a phase, all listed sessions run **in parallel** (different terminals / different Claude Code windows).
3. Each session has a **starter prompt** — paste it verbatim into a fresh Claude Code session as your first message.
4. Each session has a **files owned** list — that session is the only one allowed to create/edit those files in its phase.
5. **Shared files** (e.g. `backend/app/main.py`, `frontend/src/router.jsx`) are append-only in every session, so concurrent edits resolve as trivial 3-way merges.
6. After each session finishes, **commit and push** before the next phase starts. The next phase pulls a clean state.

### Run order at a glance

```
Phase 1: Session 1 (blocking, sequential)
            │
            ▼
Phase 2: Session 2 ║ Session 4 ║ Session 7   (parallel)
            │            │           │
            ▼            ▼           │
Phase 3: Session 3 ║ Session 5       │       (parallel)
            │            │           │
            └─────┬──────┘           │
                  ▼                  │
Phase 4: Session 6                   │
                  │                  │
                  └────────┬─────────┘
                           ▼
Phase 5: Session 8 (final wiring + acceptance)
                           ▼
Udita (manual): Task 29 — UI polish pass
```

---

## Conflict-Avoidance Strategy

The plan was decomposed so that each session owns a **disjoint file set**. The handful of shared files use **additive merges only**:

| Shared file | Sessions that touch it | Conflict-avoidance rule |
|---|---|---|
| `backend/app/main.py` | 1, 2, 4, 6, 7, 8 | Only ever **append** new `app.include_router(...)` lines; no edits to existing lines |
| `frontend/src/router.jsx` | 1, 3, 5 | Only ever **append** new `<Route>` entries; no edits to existing |
| `backend/app/deps/auth.py` | 1 only | Created in Session 1; everyone else imports `require_capability` |
| `backend/migrations/` | 1 only | Migration 014 is already applied; no new migrations in Phase 1 |
| `backend/app/routers/admin_users.py` | 1 (create), 2 (append) | Session 1 creates with `POST /admin/users` only. Session 2 appends `GET/PATCH/grant/revoke` — disjoint route handlers, no edits to S1's code |
| `backend/app/routers/leadership.py` vs `backend/app/routers/leadership_actions.py` | 4 owns first, 6 owns second | Split into two files so reads and writes are physically separated |

**Golden rule:** if a session needs to touch a file that another session in the same phase also touches, the plan was decomposed wrong — flag it and split further before starting.

---

## Session 1 — Foundation + Vertical Slice (BLOCKING)

**Phase:** 1
**Runs:** Solo, blocks all other sessions
**Tasks covered:** 1, 2, 3, 4, 5, 6, 7, 8, 9
**Estimated effort:** ~1 day human / ~3-4 hours Claude
**Goal:** Admin signs in → adds reviewer → reviewer signs in → reviewer lands on stub inbox page. Proves auth + roles + multi-role switcher end-to-end.

### Files owned (create)
- `backend/app/services/roles.py` — `ROLE_CAPABILITIES` constant, `get_user_roles()`, `user_has_capability()`
- `backend/app/deps/auth.py` — `require_capability(cap_name)` FastAPI dependency
- `backend/app/routers/admin_users.py` — **only the `POST /admin/users` endpoint** in this session; Session 2 will append the rest
- `backend/app/routers/me.py` — `GET /me`, `GET /me/roles`, `PATCH /me/active-role`
- `frontend/src/contexts/RolesContext.jsx`
- `frontend/src/components/RoleSwitcher.jsx` (basic version — Session 3 will polish)
- `frontend/src/pages/admin/AdminLayout.jsx`
- `frontend/src/pages/admin/UserCreatePage.jsx`
- `frontend/src/pages/reviewer/ReviewerInbox.jsx` (stub: "No assignments yet")
- `frontend/src/pages/leadership/LeadershipLayout.jsx` (empty shell — wired later)

### Files modified (append-only)
- `backend/app/main.py` — append `include_router` for the new routers
- `frontend/src/router.jsx` — append routes for `/admin`, `/admin/users/new`, `/reviewer/inbox`, `/leadership`
- `frontend/src/auth_upload.jsx` — read `roles[]` from `/me` after login, route by `active_role`

### Acceptance test (must pass before declaring Phase 1 done)
1. Run backend locally → `pytest backend/tests/test_roles.py` passes
2. Visit Vercel preview → log in as `ndedhia18@gmail.com` (admin) → land on `/admin`
3. Click "Add User" → fill form with reviewer email → submit → toast "Invite sent"
4. Open invite email link in incognito → set password → log in → land on `/reviewer/inbox` showing "No assignments yet"
5. Multi-role test: grant admin user a `reviewer` role via SQL → log in → `RoleSwitcher` shows both → toggle works without re-auth

### Starter prompt (copy-paste this into a fresh Claude Code session)

```
You are picking up Phase 1 of the ARTPARK admin platform build. Execute Tasks 1-9 (the "Vertical Slice") from the plan at:

  docs/superpowers/plans/2026-05-13-phase1-admin-platform.md

Spec for context: docs/superpowers/specs/2026-05-13-admin-platform-design.md

Branch: staging-role_based_dashboard (already checked out)
Constraints:
- Migration 014 is ALREADY applied to staging Supabase — do NOT re-apply it
- Do not touch anything outside Tasks 1-9
- Use AI_STUB=true (no real Gemini calls in this session)
- Commit frequently (one commit per task, per the plan's structure)
- This is a BLOCKING session — sessions 2-8 cannot start until this is pushed

Test users on staging:
- Admin:    ndedhia18@gmail.com / 123456
- Reviewer (pre-created): manager@artpark.in / 123456

Acceptance test at end:
1. Admin logs in → lands on /admin
2. Admin creates a new reviewer via UserCreatePage
3. Reviewer accepts invite, sets password, lands on /reviewer/inbox stub
4. A user with two roles sees RoleSwitcher and can toggle without re-auth

When done: push to origin/staging-role_based_dashboard and report DONE.
```

---

## Session 2 — Admin User-Management Backend (rest of routes)

**Phase:** 2
**Runs parallel with:** Sessions 4, 7
**Tasks covered:** 10, 11, 12, 14, 15
**Estimated effort:** ~0.5 day human / ~1.5 hours Claude
**Goal:** Complete the admin/users API so the frontend in Session 3 has real data.

### Files owned
- `backend/app/routers/admin_users.py` — **append only** new handlers (Session 1 already created the file with `POST`):
  - `GET /admin/users` (list with search + filter)
  - `GET /admin/users/{id}` (detail incl. roles, last_login, applications)
  - `PATCH /admin/users/{id}` (edit profile)
  - `POST /admin/users/{id}/roles` (grant role)
  - `DELETE /admin/users/{id}/roles/{role}` (revoke role)
  - `POST /admin/users/{id}/reset-password` (Supabase admin API)
  - `POST /admin/users/{id}/deactivate`
- `backend/app/services/audit.py` — best-effort `write_audit(...)` helper used by every write
- `backend/tests/test_admin_users.py`

### Files NOT touched
- Anything in `frontend/` (that's Session 3)
- `backend/app/routers/leadership*.py` (that's Sessions 4 and 6)
- `backend/app/main.py` (Session 1 already wired admin_users into the app)

### Acceptance test
- `pytest backend/tests/test_admin_users.py` — all endpoints return correct shape
- curl through each route as admin: 200; as non-admin: 403

### Starter prompt

```
You are picking up Phase 2 of the ARTPARK admin platform build. Execute Tasks 10, 11, 12, 14, 15 from:

  docs/superpowers/plans/2026-05-13-phase1-admin-platform.md

Spec: docs/superpowers/specs/2026-05-13-admin-platform-design.md
Branch: staging-role_based_dashboard
Phase 1 (Session 1) is already merged — POST /admin/users exists. Your job is to APPEND the rest of the admin user routes to backend/app/routers/admin_users.py.

Files you own (do not touch anything else):
- backend/app/routers/admin_users.py (APPEND new handlers only)
- backend/app/services/audit.py (CREATE)
- backend/tests/test_admin_users.py (CREATE)

Rules:
- Do not edit existing handlers in admin_users.py
- Use require_capability("manage_users") on every route
- Every write must call write_audit(...) — failures swallowed, never blocks the response
- Reset-password uses Supabase service-role admin API
- Migration 014 is already applied — do not write new migrations

Acceptance: pytest backend/tests/test_admin_users.py passes; curl as admin returns 200, as reviewer returns 403.

When done: push to origin/staging-role_based_dashboard and report DONE.
```

---

## Session 3 — Admin User-Management Frontend + RoleSwitcher polish

**Phase:** 3
**Runs parallel with:** Session 5
**Tasks covered:** 10 (UI part), 11 (UI part), 13, 14 (UI part)
**Estimated effort:** ~1 day human / ~3 hours Claude
**Goal:** Wire the admin user-management screens to the Session 2 backend; polish the RoleSwitcher per the screenshot reference.

### Files owned
- `frontend/src/pages/admin/UserListPage.jsx`
- `frontend/src/pages/admin/UserDetailPage.jsx`
- `frontend/src/pages/admin/UserRolesPanel.jsx`
- `frontend/src/pages/admin/UserSecurityPanel.jsx`
- `frontend/src/components/RoleSwitcher.jsx` (replace Session 1's stub with the polished version matching the screenshots)
- `frontend/src/components/ProfileShell.jsx`
- `frontend/src/styles/admin.css`

### Reference inputs
- Prototype: `/Users/apple/Downloads/Application Form - 12 May/src/leadership.jsx` — match visual language
- Screenshots provided earlier in conversation (admin user-mgmt 4 sections)

### Files NOT touched
- `backend/` — Session 2 owns the API
- `frontend/src/pages/leadership/*` (Session 5)
- `frontend/src/router.jsx` — only **append** new routes; do not edit Session 1's existing routes

### Acceptance test
1. Log in as admin → user list loads with real data from `GET /admin/users`
2. Filter by role "reviewer" → list narrows correctly
3. Click a user → detail page shows roles, last_login, applications submitted
4. Grant a new role → see it appear without page reload
5. Revoke a role → confirmation modal → role disappears
6. Reset password → confirmation modal → toast "Email sent"
7. RoleSwitcher visible for multi-role users; hidden for single-role; toggle persists `active_role`

### Starter prompt

```
You are picking up Phase 3 (frontend) of the ARTPARK admin platform build. Execute the FRONTEND parts of Tasks 10, 11, 13, 14 from:

  docs/superpowers/plans/2026-05-13-phase1-admin-platform.md

Spec: docs/superpowers/specs/2026-05-13-admin-platform-design.md
Branch: staging-role_based_dashboard
Phase 2 has shipped — these backend routes exist and you call them:
  GET    /admin/users
  GET    /admin/users/{id}
  PATCH  /admin/users/{id}
  POST   /admin/users/{id}/roles
  DELETE /admin/users/{id}/roles/{role}
  POST   /admin/users/{id}/reset-password
  POST   /admin/users/{id}/deactivate

Files you own:
- frontend/src/pages/admin/UserListPage.jsx
- frontend/src/pages/admin/UserDetailPage.jsx
- frontend/src/pages/admin/UserRolesPanel.jsx
- frontend/src/pages/admin/UserSecurityPanel.jsx
- frontend/src/components/RoleSwitcher.jsx  (REPLACE the basic stub from Session 1 with polished version)
- frontend/src/components/ProfileShell.jsx
- frontend/src/styles/admin.css

Files you can APPEND to (no edits to existing lines):
- frontend/src/router.jsx — add new routes only

Rules:
- Match the screenshot mockups for admin user-mgmt (4 sections)
- Match the prototype's visual language (/Users/apple/Downloads/Application Form - 12 May/src/leadership.jsx)
- Do not touch backend; do not touch leadership pages

When done: push and report DONE.
```

---

## Session 4 — Leadership Backend READS

**Phase:** 2
**Runs parallel with:** Sessions 2, 7
**Tasks covered:** 16, 18
**Estimated effort:** ~0.5 day human / ~1.5 hours Claude
**Goal:** Provide the leadership dashboard's read endpoints so Session 5 frontend can wire to real data.

### Files owned (create)
- `backend/app/routers/leadership.py` — **reads only**:
  - `GET /leadership/stats` — funnel + status counts + avg AI score + industry breakdown
  - `GET /leadership/applications` — paginated list w/ filters (status, industry, AI score range, track)
  - `GET /leadership/applications/{id}` — full detail incl. answers + AI score + reviews
- `backend/app/services/stats.py` — pure SQL aggregation helpers
- `backend/tests/test_leadership_reads.py`

### Files modified (append-only)
- `backend/app/main.py` — append `include_router(leadership_router)`

### Files NOT touched
- `backend/app/routers/leadership_actions.py` — Session 6 owns the writes
- Anything in `frontend/`

### Acceptance test
- `pytest backend/tests/test_leadership_reads.py`
- curl `/leadership/stats` as leadership user → returns expected shape
- curl as reviewer → 403

### Starter prompt

```
You are running Session 4 of the ARTPARK admin platform parallel build. Execute Tasks 16 and 18 from:

  docs/superpowers/plans/2026-05-13-phase1-admin-platform.md

Spec: docs/superpowers/specs/2026-05-13-admin-platform-design.md
Branch: staging-role_based_dashboard
Phase 1 (Session 1) is merged. require_capability("view_all_apps") and require_capability("view_app_detail") exist in backend/app/deps/auth.py.

Files you own (CREATE):
- backend/app/routers/leadership.py  (READS ONLY — Session 6 will own a separate file for writes)
- backend/app/services/stats.py
- backend/tests/test_leadership_reads.py

Files you may APPEND to:
- backend/app/main.py — add include_router for leadership

DO NOT touch:
- backend/app/routers/leadership_actions.py (Session 6 owns writes)
- frontend/* (Session 5 owns)

Endpoints to ship:
- GET /leadership/stats
- GET /leadership/applications  (with filters: status, industry, ai_score_min, ai_score_max, track)
- GET /leadership/applications/{id}

Rules:
- All routes guarded by require_capability("view_all_apps") or "view_app_detail"
- Stats computed via SQL aggregation — no in-Python loops over rows
- Cover both TIR and SIP tracks (polymorphic FK: application_track ∈ {tir, sip})

When done: push and report DONE.
```

---

## Session 5 — Leadership Dashboard Frontend

**Phase:** 3
**Runs parallel with:** Session 3
**Tasks covered:** 17, 19
**Estimated effort:** ~1 day human / ~3 hours Claude
**Goal:** Lift-and-shift the prototype `leadership.jsx` (703 LOC) and wire its mock data to real Session 4 endpoints.

### Files owned
- `frontend/src/pages/leadership/LeadershipDashboard.jsx`
- `frontend/src/pages/leadership/components/MetricCard.jsx`
- `frontend/src/pages/leadership/components/FunnelStrip.jsx`
- `frontend/src/pages/leadership/components/ScoreHistogram.jsx`
- `frontend/src/pages/leadership/components/ComponentBars.jsx`
- `frontend/src/pages/leadership/components/IndustryBars.jsx`
- `frontend/src/pages/leadership/components/StatusGrid.jsx`
- `frontend/src/pages/leadership/components/ApplicationsTable.jsx`
- `frontend/src/pages/leadership/components/AppDrawer.jsx` (read-only view; Session 6 wires action buttons)
- `frontend/src/styles/leadership.css`

### Reference inputs
- Prototype: `/Users/apple/Downloads/Application Form - 12 May/src/leadership.jsx` — copy structure, replace `generateCohort()` with `fetch('/leadership/applications')`
- Screenshots provided earlier (leadership dashboard 4 sections + drawer)

### Files NOT touched
- `backend/` — Session 4 owns reads
- `frontend/src/pages/admin/*` — Session 3
- Drawer's three action buttons (status change / assign reviewer / etc.) — leave them as no-ops; Session 6 wires them

### Files modified (append-only)
- `frontend/src/router.jsx` — append `/leadership` route

### Acceptance test
1. Log in as leadership user → `/leadership` loads
2. Five metric cards show real numbers from `GET /leadership/stats`
3. Funnel strip + histogram + industry bars all render from real data
4. Applications tab table is sortable, filters work
5. Click row → drawer opens with answers + AI score
6. (Action buttons in drawer are visible but non-functional — Session 6 will wire)

### Starter prompt

```
You are running Session 5 of the ARTPARK admin platform parallel build. Execute Tasks 17 and 19 from:

  docs/superpowers/plans/2026-05-13-phase1-admin-platform.md

Spec: docs/superpowers/specs/2026-05-13-admin-platform-design.md
Branch: staging-role_based_dashboard
Phase 2 has shipped — these endpoints exist:
  GET /leadership/stats
  GET /leadership/applications  (with filters)
  GET /leadership/applications/{id}

Source to lift-and-shift:
  /Users/apple/Downloads/Application Form - 12 May/src/leadership.jsx  (703 LOC)

This prototype uses generateCohort() to fabricate 287 deterministic apps. Your job: replace that mock with real fetch() calls to the endpoints above, while keeping the visual layout identical to the screenshots and the prototype.

Files you own (CREATE):
- frontend/src/pages/leadership/LeadershipDashboard.jsx
- frontend/src/pages/leadership/components/MetricCard.jsx
- frontend/src/pages/leadership/components/FunnelStrip.jsx
- frontend/src/pages/leadership/components/ScoreHistogram.jsx
- frontend/src/pages/leadership/components/ComponentBars.jsx
- frontend/src/pages/leadership/components/IndustryBars.jsx
- frontend/src/pages/leadership/components/StatusGrid.jsx
- frontend/src/pages/leadership/components/ApplicationsTable.jsx
- frontend/src/pages/leadership/components/AppDrawer.jsx  (READ-ONLY in this session)
- frontend/src/styles/leadership.css

Files you may APPEND to:
- frontend/src/router.jsx — add /leadership route

DO NOT:
- Wire the drawer's action buttons (Session 6 will)
- Touch admin pages (Session 3)
- Touch backend (Session 4 owns reads, Session 6 owns writes)

When done: push and report DONE.
```

---

## Session 6 — Leadership WRITES + Drawer Actions

**Phase:** 4
**Runs after:** Phases 1, 2, 3 complete
**Tasks covered:** 20, 21, 22
**Estimated effort:** ~0.5 day human / ~2 hours Claude
**Goal:** Wire the three drawer action buttons — change status, assign reviewers, surface app detail comments.

### Files owned (create)
- `backend/app/routers/leadership_actions.py` — **writes only**:
  - `PATCH /leadership/applications/{id}/status` — status state machine enforcement
  - `POST  /leadership/applications/{id}/reviewers` — assign reviewers (1-3 max enforced)
  - `DELETE /leadership/applications/{id}/reviewers/{user_id}`
  - `POST  /leadership/applications/{id}/notes` (leadership-only comment thread, if in plan)
- `backend/app/services/state_machine.py` — validates `from_state → to_state` transitions per spec §4.8
- `frontend/src/pages/leadership/modals/StatusChangeModal.jsx`
- `frontend/src/pages/leadership/modals/AssignReviewersModal.jsx`
- `backend/tests/test_leadership_writes.py`

### Files modified (append-only)
- `backend/app/main.py` — append `include_router(leadership_actions_router)`
- `frontend/src/pages/leadership/components/AppDrawer.jsx` — replace the three placeholder buttons with onClick handlers that open the new modals. Keep all read-only sections from Session 5 intact.

### Acceptance test
1. Leadership user opens drawer → clicks "Change Status" → modal lists only legal next states → confirms → status flips + audit log written
2. Click "Assign Reviewer" → multi-select up to 3 reviewers → submit → reviewers appear in their inbox
3. State machine rejects illegal transitions (e.g. `draft → shortlisted`) with 422
4. Reviewer count > 3 returns 422

### Starter prompt

```
You are running Session 6 of the ARTPARK admin platform parallel build. Execute Tasks 20, 21, 22 from:

  docs/superpowers/plans/2026-05-13-phase1-admin-platform.md

Spec: docs/superpowers/specs/2026-05-13-admin-platform-design.md  (especially §4.8 status state machine)
Branch: staging-role_based_dashboard
Phases 1-3 are complete. Session 5 left AppDrawer.jsx with three non-functional buttons — your job is to wire them.

Files you own (CREATE):
- backend/app/routers/leadership_actions.py
- backend/app/services/state_machine.py
- frontend/src/pages/leadership/modals/StatusChangeModal.jsx
- frontend/src/pages/leadership/modals/AssignReviewersModal.jsx
- backend/tests/test_leadership_writes.py

Files you MODIFY:
- frontend/src/pages/leadership/components/AppDrawer.jsx — replace the three placeholder button onClicks ONLY. Do NOT edit the read-only sections above them.
- backend/app/main.py — APPEND include_router only.

DO NOT touch:
- backend/app/routers/leadership.py (Session 4's reads — separate file)
- Any other Session 5 component
- Admin pages

Rules:
- Status transitions enforced per spec §4.8 — illegal → 422
- Max 3 reviewers per app (UNIQUE constraint exists in migration 014)
- Every write calls write_audit(...) best-effort
- All routes guarded by require_capability("change_app_status") or "assign_reviewers"

When done: push and report DONE.
```

---

## Session 7 — AI Pipeline (SQS + Worker)

**Phase:** 2 (fully independent — can start any time after Session 1)
**Runs parallel with:** Sessions 2, 4
**Tasks covered:** 23, 24, 25
**Estimated effort:** ~1 day human / ~3 hours Claude
**Goal:** Submit-handler enqueues SQS message → worker Lambda consumes → writes to `ai_screening` table. Stub mode default.

### Files owned (create)
- `backend/app/services/sqs_publisher.py` — publishes `{application_id, application_track}` to FIFO queue with message group = `app_id`
- `backend/workers/ai_screener/handler.py` — Lambda handler that consumes SQS, calls Gemini (or stub), writes `ai_screening` row, advances status to `under_review`
- `backend/workers/ai_screener/scoring.py` — pure scoring logic (5 categories per spec §6)
- `backend/workers/ai_screener/stub.py` — deterministic random via `hash(app_id)` seed
- `backend/workers/ai_screener/openrouter_client.py` — `google/gemini-flash-latest` wrapper
- `infra/sam/template.yaml` — append `AiScreenerQueue` (FIFO + DLQ) + `AiScreenerFunction` resource
- `backend/tests/test_ai_screener.py`

### Files modified
- `backend/app/routers/application.py` (or wherever submit lives) — after successful submit, call `sqs_publisher.publish(app_id, track)`. **Single-line addition.**
- `backend/app/main.py` — append `include_router` only if a new admin reroute is added

### Files NOT touched
- Anything in `frontend/`
- Leadership routers
- Admin user routers

### Acceptance test
1. Submit an application as applicant → status flips `draft → submitted` immediately → response in <500ms
2. With `AI_STUB=true` (default), within ~10s the worker writes an `ai_screening` row with 5 category scores + total + status → `under_review`
3. Idempotency: re-running the same message ID is a no-op (UNIQUE on application_id+track)
4. Setting `AI_STUB=false` + `OPENROUTER_API_KEY=...` → real Gemini call works (test only locally, not on staging)
5. DLQ receives messages after 3 failed attempts

### Starter prompt

```
You are running Session 7 of the ARTPARK admin platform parallel build. Execute Tasks 23, 24, 25 from:

  docs/superpowers/plans/2026-05-13-phase1-admin-platform.md

Spec: docs/superpowers/specs/2026-05-13-admin-platform-design.md  (esp. §6 AI scoring + §7 SQS architecture)
Branch: staging-role_based_dashboard
Phase 1 (Session 1) is done. This session is FULLY INDEPENDENT — start any time, do not block on Sessions 2/4.

Files you own (CREATE):
- backend/app/services/sqs_publisher.py
- backend/workers/ai_screener/handler.py
- backend/workers/ai_screener/scoring.py
- backend/workers/ai_screener/stub.py
- backend/workers/ai_screener/openrouter_client.py
- backend/tests/test_ai_screener.py

Files you MODIFY (minimal edits):
- backend/app/routers/application.py — after submit success, call sqs_publisher.publish(app_id, track). Single line addition.
- infra/sam/template.yaml — APPEND AiScreenerQueue (FIFO + DLQ) and AiScreenerFunction resources only. Do not edit existing resources.

DO NOT touch:
- frontend/*
- Any leadership or admin router
- Existing migrations

Rules:
- Default mode AI_STUB=true → deterministic random via hash(app_id) seed, 5 category scores per spec §6
- AI_STUB=false uses google/gemini-flash-latest via OpenRouter API
- SQS message: {application_id, application_track}, MessageGroupId=app_id (FIFO ordering per app)
- Idempotent: UNIQUE(application_id, application_track) on ai_screening — INSERT ... ON CONFLICT DO NOTHING
- Worker advances status submitted → ai_screening → under_review on success
- DLQ after 3 retries

When done: push and report DONE.
```

---

## Session 8 — Email + Seed + Acceptance Test

**Phase:** 5 (final)
**Runs after:** All other sessions complete and merge
**Tasks covered:** 26, 27, 28
**Estimated effort:** ~0.5 day human / ~2 hours Claude
**Goal:** Transactional emails, seed script for fresh staging, end-to-end acceptance test.

### Files owned (create)
- `backend/app/services/email.py` — Resend wrapper with 3 templates: invite, password-reset, status-change
- `backend/app/templates/emails/invite.html`
- `backend/app/templates/emails/reset.html`
- `backend/app/templates/emails/status_change.html`
- `backend/scripts/seed_staging.py` — idempotent: creates 1 admin + 1 leadership + 3 reviewers + 5 sample applications (3 TIR, 2 SIP)
- `backend/tests/test_acceptance_phase1.py` — the 10-checkpoint acceptance script from spec §11

### Files modified
- `backend/app/routers/admin_users.py` — replace any TODO `# send email here` placeholders with `email.send_invite(...)` calls. Best-effort, swallow errors.
- `backend/app/routers/leadership_actions.py` — replace `# email applicant` placeholders with `email.send_status_change(...)`.

### Acceptance test (this IS the test)
Run `pytest backend/tests/test_acceptance_phase1.py` — passes all 10 checkpoints from spec §11:
1. Admin can create reviewer; reviewer receives invite email
2. Multi-role user sees RoleSwitcher and can toggle
3. Applicant submits → status flips immediately → AI score appears within 10s (stub)
4. Leadership sees app in dashboard with correct AI score
5. Leadership assigns reviewer → reviewer sees in inbox
6. Leadership changes status → applicant receives status-change email
7. State machine rejects illegal transitions
8. Audit log records every privileged write
9. Non-admin gets 403 on `/admin/*`
10. Idempotent submit doesn't double-score

### Starter prompt

```
You are running Session 8 — the final session of the ARTPARK admin platform build. Execute Tasks 26, 27, 28 from:

  docs/superpowers/plans/2026-05-13-phase1-admin-platform.md

Spec: docs/superpowers/specs/2026-05-13-admin-platform-design.md  (esp. §11 acceptance criteria)
Branch: staging-role_based_dashboard
All other sessions (1-7) have shipped. Your job is the final wiring: emails, seed data, and the full acceptance test.

Files you own (CREATE):
- backend/app/services/email.py
- backend/app/templates/emails/invite.html
- backend/app/templates/emails/reset.html
- backend/app/templates/emails/status_change.html
- backend/scripts/seed_staging.py  (idempotent — safe to re-run)
- backend/tests/test_acceptance_phase1.py

Files you MODIFY:
- backend/app/routers/admin_users.py — replace TODO email placeholders with email.send_invite(...) calls. Best-effort: try/except, swallow, do not block response.
- backend/app/routers/leadership_actions.py — replace email placeholders with email.send_status_change(...).

Rules:
- Use Resend API (RESEND_API_KEY env var)
- All email sends are best-effort — failures must NOT roll back the underlying transaction
- Seed script must be idempotent — re-running creates no duplicates
- Acceptance test must pass all 10 checkpoints from spec §11
- This is the gating test for Phase 1 done — if any checkpoint fails, report the exact failure

When pytest backend/tests/test_acceptance_phase1.py passes: push and report DONE PHASE 1.
```

---

## Udita's Phase — Task 29 (UI Polish)

**Phase:** Manual handoff (not a Claude session)
**Trigger:** Session 8 reports DONE PHASE 1
**Tasks covered:** 29 only
**Estimated effort:** ~1 day human, no Claude involvement

### Scope (Udita owns)
- Visual polish pass across all new pages — typography, spacing, color, micro-interactions
- Loading states, empty states, error states
- Responsive breakpoints (mobile/tablet for admin pages)
- Accessibility: keyboard nav, focus rings, ARIA labels
- Cross-browser smoke test (Chrome, Safari, Firefox)

### Files Udita may touch
- Any `.css` file under `frontend/src/styles/`
- Any `.jsx` file under `frontend/src/pages/admin/` or `frontend/src/pages/leadership/`
- **Do not touch backend** — UI polish only

### Handoff message to Udita
> "Phase 1 admin platform is functionally complete and deployed to the staging-role_based_dashboard preview. All 8 Claude sessions have shipped and the acceptance test passes. Please do a visual polish pass — typography, spacing, loading/empty/error states, responsive breakpoints. Do not change functionality or wire new endpoints. When done, raise a PR back into staging-role_based_dashboard and tag me for review."

---

## Pre-Phase-2 Deferred (DO NOT BUILD in any Phase 1 session)

These appear in screenshots / older docs but are explicitly Phase 2+. If a session sees these, skip them:
- Jury portal / Jury Member role
- Psychometry (L5)
- `scoring.md` editor
- Cohort analytics views
- Cohort Manager role
- Mentor dashboard (data model exists; UI deferred)
- Founder dashboard (data model exists; UI deferred)
- AI vs human variance flag visualization
- Audit log feed page (data is being written; visual feed deferred)

---

## Session Coordination Checklist

Before starting any Phase 2+ session, the operator (you) does:

```bash
git checkout staging-role_based_dashboard
git pull origin staging-role_based_dashboard
# verify previous phase merged cleanly; no conflict markers
grep -r "<<<<<<<" backend/ frontend/ && echo "CONFLICTS EXIST — DO NOT START" || echo "CLEAN"
```

Then paste the corresponding starter prompt into a fresh Claude Code window.

When a session reports DONE, run:

```bash
git fetch origin staging-role_based_dashboard
git log origin/staging-role_based_dashboard --oneline -5
```

…to confirm commits landed before unblocking the next phase.
