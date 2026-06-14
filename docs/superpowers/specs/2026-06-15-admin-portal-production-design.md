# Admin Portal → Production — Design Spec

**Date:** 2026-06-15
**Branch:** `admin_final` (rebuilt from `reviewer_final` @ 295bc17 — carries ALL reviewer work)
**Release branch (cut later, push-only):** `release/reviewer-admin-v1`
**Companion:** `docs/superpowers/specs/2026-06-12-reviewer-portal-production-design.md` (reviewer)
**Status:** Approved design — pending user review of this written spec

---

## 1. Goal & scope

Ship the ADMIN-UI prototype (branch `ADMIN-UI`, static) to production at
`apply.artpark.info/admin/*`, fully wired to the production DB and interconnected
with the reviewer portal, leadership dashboard, AI screening, and the applicant
data — **plus** the two reviewer fixes found during the reviewer staging rehearsal.
admin_final carries the entire reviewer build too, so one staging preview shows both
and one prod cutover ships both.

**Decisions locked during brainstorming (2026-06-15):**
1. **Combined branch.** admin_final = reviewer_final + the 2 reviewer fixes + the
   admin build. One preview, one cutover.
2. **Jury: out of scope.** No `jury_members`/`jury_assignments`/`jury_scores`, no
   A-6 Jury page, no jury scorecards in app detail. The prototype's **Gate 2 / Final
   Gate + interview scheduling are jury-driven, so they defer with the jury module.**
3. **Statuses:** add `on_hold` + `jury_review` to the status CHECK + state machine
   (`jury_review` reserved forward-compat for the future jury stage).
4. **Psychometry (A-5): out of scope.**

**In scope — reviewer fixes:**
- Migration 023: reconcile `reviewer_assignments` columns across both DBs.
- Queue batching: `fetch_queue` bulk-fetch (kill the N+1).

**In scope — admin screens:** A-0 Dashboard, A-1 Applications pipeline, A-2
Application detail, A-3 Reviewer management (roster), A-4 Gate 1 admin review (3
decision variants), A-8 Audit log, A-9 Analytics/reviewer-calibration, User Roles
(integrate existing `/admin/users`), Settings (restore hidden/archived/held),
Batches.

**Out of scope (deferred, later modules):** Jury (A-6) + jury scoring, Gate 2 /
Final Gate (A-7) + interview scheduling, Psychometry (A-5).

---

## 2. Architecture

Same "extend in place" pattern as the reviewer portal. One FastAPI Lambda, one
Supabase, one Vite SPA. A new capability-gated `/admin/platform/*` router reuses
`state_machine`, `services/audit`, `applications_query`, and the existing leadership
read endpoints rather than duplicating them. Admin screens fold into the existing
SPA under `/admin/*`, extending `AdminLayout` and reusing `admin.css` + the
prototype's `styles.css` scoped under `.adm-portal` (the technique proven on the
reviewer port).

```
applicant submit ─▶ ai_screening ─▶ reviewers (queue/score) ─▶ under_review→evaluated
                                                                      │
   Admin Portal ◀── reads leadership/* + reviewer consensus ─────────┘
        │  POST decision (gate1: shortlist/hold/reject/waitlist + rationale)
        ▼  state_machine.assert_legal_transition + status_log + admin_decisions + audit
   shortlisted / on_hold / rejected / waitlisted   (jury_review + Gate2 = later)
```

---

## 3. Schema — two additive migrations

### 3.1 `backend/migrations/023_reviewer_assignments_reconcile.sql`
Reconcile the drifted `reviewer_assignments` to the union shape the reviewer code
needs (staging lacks `state`; prod lacks the rest). Additive, idempotent, wrapped.
```sql
begin;
alter table public.reviewer_assignments add column if not exists state text not null default 'pending';
alter table public.reviewer_assignments add column if not exists declined_at timestamptz;
alter table public.reviewer_assignments add column if not exists reassigned_to uuid;
alter table public.reviewer_assignments add column if not exists completed_at timestamptz;
alter table public.reviewer_assignments add column if not exists decline_reason text;
commit;
```

### 3.2 `backend/migrations/024_admin_platform.sql`
Additive, idempotent, transaction-wrapped. Service-role-only (RLS enabled, no client
policies — matches migration 014).

- **Status CHECK** — drop+recreate `tir_applications`/`sip_applications` status CHECK
  to add `on_hold` and `jury_review` (preserving all existing values incl. legacy
  `accepted`). Guarded so re-run is safe.
- **`batches`** — `id uuid pk default gen_random_uuid(), name text not null, phase text, created_at timestamptz default now(), updated_at timestamptz default now()`.
- **`application_batches`** — `id uuid pk, application_id uuid not null, application_track text check (in tir,sip), batch_id uuid references batches(id) on delete cascade, added_at timestamptz default now()`, unique `(application_id, application_track)`.
- **`admin_decisions`** — `id uuid pk, application_id uuid not null, application_track text, gate_stage text default 'gate1', decision text check (in shortlisted,on_hold,rejected,waitlisted), rationale text, decided_by uuid, decided_at timestamptz default now()`. Index `(application_id, application_track, decided_at desc)`.
- **`application_admin_meta`** — `application_id uuid, application_track text, is_hidden boolean default false, is_archived boolean default false, hidden_reason text, updated_at timestamptz default now(), updated_by uuid`, PK/unique `(application_id, application_track)`. (Hold is the `on_hold` status, not a flag.)
- **`reviewer_profiles`** — `reviewer_user_id uuid pk, expertise_domains text[] default '{}', weight numeric(3,1) default 1.0, batch_id uuid, updated_at timestamptz default now()`. (Progress/consistency computed, not stored.)

Both migrations handed to the user to run in **staging + prod** SQL editors (no psql
locally). Verified safe: additive, both new tables empty, running code ignores new
columns until the admin code deploys.

---

## 4. State machine changes

Add to `LEGAL_TRANSITIONS` (`backend/app/services/state_machine.py`):
- `evaluated → shortlisted | on_hold | rejected | waitlisted | withdrawn`
- `on_hold → evaluated | shortlisted | rejected | waitlisted | withdrawn` (release hold)
- `shortlisted → jury_review | withdrawn` (jury_review reserved; the Gate-2/jury flow that consumes it ships later)
- `jury_review → withdrawn` (terminal-ish until jury module)
Existing transitions unchanged. Every admin status write goes through
`assert_legal_transition` and logs to `application_status_log`.

---

## 5. Backend — `/admin/platform/*` router

New capabilities on the `admin` role in `rbac.py` (kept in lockstep with
`frontend/src/lib/rbac.js`): `decide_application`, `manage_batches`,
`manage_reviewers_roster`. Reuse `view_all_apps`, `view_app_detail`,
`view_audit_log`. Leadership also gets `decide_application` (they run Gate 1 today).

| Method | Path | Capability | Purpose |
|---|---|---|---|
| GET | `/admin/platform/applications` | view_all_apps | Pipeline list: leadership list + joined admin_decision/meta/batch; filters incl. hidden/archived/held/batch/decision |
| GET | `/admin/platform/applications/{track}/{id}` | view_app_detail | Detail + admin_decision + meta + batch + reviewer consensus (wraps leadership detail) |
| POST | `/admin/platform/applications/{track}/{id}/decision` | decide_application | Gate-1 decision (shortlisted/on_hold/rejected/waitlisted + rationale): legal-transition guard → status + admin_decisions + status_log + audit |
| POST | `/admin/platform/decisions/bulk` | decide_application | Bulk decision (per-id results: decided / illegal_transition / not_found) |
| PATCH | `/admin/platform/applications/{track}/{id}/meta` | view_all_apps | hide / archive / restore (writes application_admin_meta + audit) |
| GET | `/admin/platform/batches` · POST · PATCH `/{id}` | manage_batches | Batch list / create / rename |
| POST | `/admin/platform/batches/{id}/applications` | manage_batches | Bulk-add apps to a batch |
| GET | `/admin/platform/reviewers` | manage_reviewers_roster | Roster: reviewer + assigned/completed counts (progress), avg \|reviewer−AI\| (consistency), weight, domains, last activity |
| PATCH | `/admin/platform/reviewers/{user_id}` | manage_reviewers_roster | weight / domains / batch (reviewer_profiles upsert) |
| POST | `/admin/platform/reviewers/rebalance` | manage_reviewers_roster | Even-distribute unassigned apps across active reviewers (creates reviewer_assignments) |
| GET | `/admin/platform/audit-log` | view_audit_log | Read audit_log_v2 ∪ application_status_log (filters actor/action/date) + `?format=csv` |
| GET | `/admin/platform/analytics/reviewer-calibration` | view_stats | Per-reviewer avg score vs cohort/AI variance |
| GET | `/admin/platform/stats` | view_stats | Dashboard KPIs/funnel (reuse /leadership/stats + decision counts) |

Reviewer-assignment create/unassign already exist (`/leadership/applications/{id}/reviewers`) and are reused by the admin UI. Status-change authority now lives here (gated + audited), superseding the removed leadership PATCH /status.

---

## 6. Reviewer fix — queue batching

Rewrite `reviewer_query.fetch_queue` to eliminate the per-assignment N+1: one
assignments query, then bulk `in_()` fetches for tir_applications, sip_applications,
ai_screening, reviews (for this reviewer), and a single industry_categories fetch —
assemble in memory. Behavior/output shape identical (covered by the existing
`test_queue_shape_*` test). Target: 432-app load well under 1s.

---

## 7. Frontend

Port ADMIN-UI prototype screens into `frontend/src/pages/admin/platform/`:
`AdminDashboard`, `AdminPipeline`, `AdminApplicationDetail`, `AdminReviewerRoster`,
`AdminGate1Review` (Decision-Stack / Triage-Table / Cutoff-Histogram variants),
`AdminAuditLog`, `AdminAnalytics`, `AdminSettings`, `AdminBatches`. Extend
`AdminLayout` nav (omit Jury / Psychometry / Gate-2 items). New `adminPlatformApi.js`
seam; reuse `useAsync`, `admin.css`, and the prototype `styles.css` scoped under
`.adm-portal`. The existing `/admin/users` (User Roles) becomes a nav entry.
Decision buttons → decision endpoint; Settings restore → meta + release-hold; bulk
pipeline actions → bulk endpoints. Loading/error/empty states throughout. The
leadership↔admin↔reviewer role-switch already exists (extend with an "Admin" switch
where the user holds the admin role).

---

## 8. Error handling & testing

`{code, message}` envelope, `extra="forbid"` bodies, `state_machine` guards every
status write, all mutations → `audit_log_v2`. **Tests:**
- pytest (FakeAdminClient pattern): decision legality + status/admin_decisions/audit
  writes, bulk per-id results, meta toggles, batch CRUD + bulk-assign, roster metric
  computation, audit-log filters + CSV, calibration, rebalance, and migration-024
  status-enum acceptance. Full backend suite stays at the known 19 pre-existing
  failures.
- Vitest: `adminPlatformApi` path contracts + pure UI helpers.
- `npm run build` green.
- Staging rehearsal: apply 023+024 to staging, deploy, click every admin screen as
  nirav end-to-end (pipeline → decision → audit shows it; batch; roster; restore).

---

## 9. Rollout (hard constraints)

- **Branch:** all work on `admin_final` (carries reviewer + admin). Release branch
  `release/reviewer-admin-v1` cut from it for the push.
- **Migrations 023 + 024** — additive/idempotent; user runs the SQL in **staging +
  prod** editors (handed over like 022). Prod schema is safe (new tables empty,
  unused by running code until cutover).
- **Staging preview:** apply migrations to staging, set up data (nirav already has
  reviewer+leadership; ensure admin role for the admin preview), deploy backend from
  the worktree, fast-forward the `staging` branch for the frontend, give the preview
  URL. Prod DB data/accounts untouched until cutover.
- **Prod cutover (≤15 min, user-gated, after preview approval):** apply 023+024 to
  prod, deploy backend from the release worktree, promote frontend, create the
  reviewer + admin user accounts, smoke. Rollback = redeploy previous Lambda +
  Vercel instant rollback; schema additive (no rollback needed).

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Status-enum migration drop+recreate briefly invalid | Wrap in txn; recreate immediately; both tables' existing rows already satisfy the superset |
| Admin decision writes an illegal transition | `state_machine.assert_legal_transition` returns 422 with allowed list; no raw status writes |
| Roster consistency metric is expensive | Computed from already-fetched reviews+ai rows in memory; bounded by cohort size; cache later if needed |
| Bulk decision partial failure | Per-id result list (decided/illegal/not_found), best-effort like the reviewer bulk-assign |
| Prototype Gate-2/jury UI bleeds in | Nav + routes for jury/psychometry/Gate-2 deliberately omitted; decision buttons limited to gate-1 set |
| admin_final drifts from prod base | Rebuilt from reviewer_final; rebase onto current release/sip-launch-v1 before cutover (carries prod storage fixes) |
