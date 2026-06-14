# Admin Portal + Reviewer Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the ADMIN-UI prototype to production (`apply.artpark.info/admin/*`) fully wired to the prod DB and interconnected with reviewer/leadership/AI-screening, plus two reviewer fixes (migration 023 reconcile + queue batching). Jury, psychometry, and Gate-2/interviews are deferred.

**Architecture:** Extend-in-place (same as the reviewer build). New capability-gated `/admin/platform/*` FastAPI router reusing `state_machine`, `services/audit`, `applications_query`, and the leadership read endpoints; two additive migrations (023, 024); admin screens folded into the existing Vite SPA under `/admin/*`. All work on branch `admin_final` (which already carries the full reviewer build) in worktree `.claude/worktrees/admin_final`. Spec: `docs/superpowers/specs/2026-06-15-admin-portal-production-design.md`.

**Tech Stack:** FastAPI + Mangum (Lambda), supabase-py admin client (PostgREST — no DDL), Pydantic v2 (`extra="forbid"`, `Annotated[float, Field(...)]`), pytest with the `_FakeAdminClient`/`_install_db`/`_override_user`/`_clear_overrides` pattern (see `backend/tests/test_reviewer.py` + `test_leadership_writes.py`), React 18 + Vite + React Router v6, Vitest.

**Grounded facts (verified — do not re-derive):**
- Status write pattern (no generic helper exists): `sb.table(f"{track}_applications").update({"status": to})...` + insert into `application_status_log` (cols: application_id, application_track, from_status, to_status, changed_by, reason, changed_at) + `state_machine.assert_legal_transition(from, to)`. Mirror `state_machine.auto_transition_to_evaluated_if_complete` (lines 89-200). **Task 4 factors this into `apply_status_change()`.**
- `state_machine.LEGAL_TRANSITIONS` (dict[str, frozenset]) at `backend/app/services/state_machine.py:33`; `assert_legal_transition` raises 422 `illegal_transition` with `allowed` list.
- `write_audit(*, actor_user_id, actor_role, action_type, target_table=None, target_id=None, before=None, after=None, reason=None)` — kwarg is `after` (not `after_state`); never raises.
- Leadership reuse: `leadership.list_applications` (router), `applications_query.{find_application_with_track, fetch_apps_for_track, fetch_ai_scores_for, fetch_reviews_for, fetch_reviewer_assignments_for, fetch_status_history_for}`, `stats.{derive_stage_label, derive_project_name, compose_display_id, classify_industry}`.
- `rbac.ROLE_CAPABILITIES` at `backend/app/rbac.py`; keep in lockstep with `frontend/src/lib/rbac.js`. `require_capability(cap)` dependency.
- Tests run from `backend/`: `cd backend && python -m pytest tests/ -q --no-cov`. Baseline pre-existing failures = **19** (in test_admin/test_applications/test_cross_track_submit_lock/test_resume/test_validate_submission_mandatory_fields/test_validation_limits). Any task must keep it at 19. conftest already disables Sentry + pre-imports pandas.
- Frontend: `cd frontend && npm test` and `npm run build`. Prototype source: `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/ADMIN-UI/admin-ui-prototype/os/` (admin-1.jsx, admin-2.jsx, shell.jsx, styles.css, data.js).
- DDL cannot run locally (no psql/CLI). Migrations 023/024 are SQL files committed to the repo + handed to the user for the SQL editor. Data ops use the service-role key.
- NEVER commit to `release/sip-launch-v1` or `staging` directly here. NEVER `sam deploy` to prod from this plan (staging only; prod cutover is a gated runbook step). Commit messages: plain conventional commits, NO AI/Claude attribution.

---

## File structure

**Backend (new):**
- `backend/migrations/023_reviewer_assignments_reconcile.sql`
- `backend/migrations/024_admin_platform.sql`
- `backend/app/routers/admin_platform.py` — the `/admin/platform/*` router
- `backend/app/services/admin_query.py` — pipeline/detail/roster/audit read joins
- `backend/app/services/decisions.py` — `apply_status_change()` + decision recording

**Backend (modified):**
- `backend/app/services/state_machine.py` — add transitions + factor `apply_status_change`
- `backend/app/services/reviewer_query.py` — `fetch_queue` batching
- `backend/app/rbac.py` — new admin capabilities
- `backend/app/main.py` — register the admin_platform router

**Frontend (new):** `frontend/src/lib/adminPlatformApi.js`, `frontend/src/styles/admin-portal.css`, `frontend/src/pages/admin/platform/{AdminDashboard,AdminPipeline,AdminApplicationDetail,AdminReviewerRoster,AdminGate1Review,AdminAuditLog,AdminAnalytics,AdminSettings,AdminBatches}.jsx` + `ui.jsx` (shared atoms/helpers).
**Frontend (modified):** `frontend/src/pages/admin/AdminLayout.jsx` (nav), `frontend/src/router.jsx` (routes), `frontend/src/lib/rbac.js` (capabilities).

---

## Task 1: Migration 023 — reviewer_assignments reconcile

**Files:** Create `backend/migrations/023_reviewer_assignments_reconcile.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 023_reviewer_assignments_reconcile.sql
-- Reconcile reviewer_assignments column drift between staging (lacks `state`)
-- and prod (lacks declined_at/reassigned_to/completed_at/decline_reason) so the
-- reviewer decline + submit-complete flows work on both. Additive, idempotent.
-- Apply to STAGING (exqmxvdtcsvpgtftwjml) and PROD (xtmszlpwgbyoumalgbhs) SQL editors.
begin;
alter table public.reviewer_assignments add column if not exists state text not null default 'pending';
alter table public.reviewer_assignments add column if not exists declined_at timestamptz;
alter table public.reviewer_assignments add column if not exists reassigned_to uuid;
alter table public.reviewer_assignments add column if not exists completed_at timestamptz;
alter table public.reviewer_assignments add column if not exists decline_reason text;
commit;
```
- [ ] **Step 2: Verify idempotency by inspection** — `grep -c "if not exists" backend/migrations/023_reviewer_assignments_reconcile.sql` → expect `5`. Do not run against any DB.
- [ ] **Step 3: Commit**
```bash
git add backend/migrations/023_reviewer_assignments_reconcile.sql
git commit -m "feat(db): migration 023 — reconcile reviewer_assignments columns across envs"
```

---

## Task 2: Queue batching (kill the N+1 in fetch_queue)

**Files:** Modify `backend/app/services/reviewer_query.py` (`fetch_queue`); Test `backend/tests/test_reviewer.py`

- [ ] **Step 1: Confirm the existing test still defines the contract**
Run: `cd backend && python -m pytest tests/test_reviewer.py::test_queue_shape_includes_ai_due_and_review_status -q --no-cov`
Expected: PASS (this test is the behavior contract; the refactor must keep it green).

- [ ] **Step 2: Add a performance/shape test that asserts bulk fetching** (append to `test_reviewer.py`, using `_install_db`/`_override_user`/`_clear_overrides`). Seed 3 assignments across tir+sip with ai_screening + one review, then assert the response has 3 items with correct ai/due/reviewStatus AND that the fake recorded a bounded number of selects (the fake's `_FakeAdminClient` records `.table()` calls — assert reviewer_assignments/tir_applications/sip_applications/ai_screening/reviews/industry_categories are each queried at most twice, proving no per-row loop):
```python
def test_queue_uses_bulk_fetches_not_per_row(client, monkeypatch, _clear_overrides):
    fake = _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": f"a{i}", "application_id": f"app{i}", "application_track": ("tir" if i % 2 else "sip"),
             "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None,
             "assigned_at": "2026-06-01T00:00:00+00:00", "due_at": None} for i in range(3)
        ],
        "tir_applications": [{"id": "app1", "display_seq": 26001, "basic_org": "A1", "solution_stage": "Prototype built", "submitted_at": "2026-05-20T00:00:00+00:00", "basic_teammates": []}],
        "sip_applications": [
            {"id": "app0", "display_seq": 26000, "basic_org": "A0", "sip_trl": "TRL 5", "sip_traction": "Active pilots", "submitted_at": "2026-05-20T00:00:00+00:00", "sip_founders": []},
            {"id": "app2", "display_seq": 26002, "basic_org": "A2", "sip_trl": "TRL 4", "sip_traction": "Pre-revenue", "submitted_at": "2026-05-20T00:00:00+00:00", "sip_founders": []},
        ],
        "reviews": [], "ai_screening": [], "industry_categories": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("rev-1")
    r = client.get("/reviewer/queue")
    assert r.status_code == 200
    assert len(r.json()) == 3
    # bulk: each table queried a small bounded number of times regardless of N
    counts = fake.table_call_counts()  # helper added below if missing
    assert counts.get("reviewer_assignments", 0) <= 2
    assert counts.get("ai_screening", 0) <= 2
    assert counts.get("reviews", 0) <= 2
```
If `_FakeAdminClient` has no `table_call_counts()`, add a minimal counter to the fake in this test file: increment a dict in `.table(name)` and expose it. (Keep it local to the test fixture; ~5 lines.)

- [ ] **Step 3: Run to verify it fails** — `cd backend && python -m pytest tests/test_reviewer.py::test_queue_uses_bulk_fetches_not_per_row -q --no-cov` → FAIL (current code loops per assignment, exceeding the bound).

- [ ] **Step 4: Implement bulk fetch** in `reviewer_query.fetch_queue`. Replace the per-assignment loop with:
  1. Fetch active assignments for the reviewer (1 query).
  2. Partition application_ids by track. Bulk fetch `tir_applications` and `sip_applications` with `.in_("id", ids)` (1 query each, only if that track has ids).
  3. Bulk fetch `ai_screening` for all (app_id) pairs: `.in_("application_id", all_ids)` then filter by track in Python (1 query).
  4. Bulk fetch this reviewer's `reviews`: `.eq("reviewer_user_id", uid).in_("application_id", all_ids)` (1 query).
  5. Fetch `industry_categories` once (1 query).
  6. Build dicts keyed by (id, track) and assemble the same output rows as today (reuse the existing `_display_id`, `_founder_names`, `_ai_block`, `_review_status`, `stats.derive_stage_label`). Keep the same sort + fields, incl. `editWindowExpiresAt`.
Wrap each fetch in try/except + `log.warning` (match existing style). If `.in_` isn't available on the real client builder, it is (supabase-py supports `.in_(col, list)`).

- [ ] **Step 5: Run both queue tests + full reviewer suite**
Run: `cd backend && python -m pytest tests/test_reviewer.py -q --no-cov`
Expected: all PASS (the shape test and the new bulk test).

- [ ] **Step 6: Commit**
```bash
git add backend/app/services/reviewer_query.py backend/tests/test_reviewer.py
git commit -m "perf(reviewer): batch fetch_queue with in_() — removes per-app N+1"
```

---

## Task 3: Migration 024 — admin platform schema

**Files:** Create `backend/migrations/024_admin_platform.sql`

- [ ] **Step 1: Write the migration** (additive, idempotent, transaction-wrapped; service-role-only)
```sql
-- 024_admin_platform.sql — Admin Portal schema. Additive, idempotent, wrapped.
-- Apply to STAGING + PROD SQL editors. New tables empty; running code ignores
-- them until the admin code deploys. RLS enabled, no client policies (service-role only).
begin;

-- 1. Status enum: add on_hold + jury_review to both application tables.
do $$
declare t text;
begin
  foreach t in array array['tir_applications','sip_applications'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t||'_status_check');
    execute format($f$alter table public.%I add constraint %I check (status in (
      'draft','submitted','ai_screening','screening_failed','under_review','evaluated',
      'shortlisted','interview','offered','onboarded','rejected','waitlisted','withdrawn',
      'accepted','on_hold','jury_review'))$f$, t, t||'_status_check');
  end loop;
end $$;

-- 2. batches
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phase text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.batches enable row level security;

-- 3. application_batches (one batch per app)
create table if not exists public.application_batches (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  batch_id uuid not null references public.batches(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (application_id, application_track)
);
alter table public.application_batches enable row level security;
create index if not exists idx_application_batches_batch on public.application_batches(batch_id);

-- 4. admin_decisions
create table if not exists public.admin_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  gate_stage text not null default 'gate1',
  decision text not null check (decision in ('shortlisted','on_hold','rejected','waitlisted')),
  rationale text,
  decided_by uuid,
  decided_at timestamptz not null default now()
);
alter table public.admin_decisions enable row level security;
create index if not exists idx_admin_decisions_app on public.admin_decisions(application_id, application_track, decided_at desc);

-- 5. application_admin_meta (hide/archive; hold is the on_hold status)
create table if not exists public.application_admin_meta (
  application_id uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  is_hidden boolean not null default false,
  is_archived boolean not null default false,
  hidden_reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (application_id, application_track)
);
alter table public.application_admin_meta enable row level security;

-- 6. reviewer_profiles
create table if not exists public.reviewer_profiles (
  reviewer_user_id uuid primary key,
  expertise_domains text[] not null default '{}',
  weight numeric(3,1) not null default 1.0,
  batch_id uuid,
  updated_at timestamptz not null default now()
);
alter table public.reviewer_profiles enable row level security;

commit;
```
- [ ] **Step 2: Sanity-check** — `grep -c "create table if not exists" backend/migrations/024_admin_platform.sql` → expect `5`; confirm both `tir_applications` and `sip_applications` appear in the status block. Do not run against any DB.
- [ ] **Step 3: Commit**
```bash
git add backend/migrations/024_admin_platform.sql
git commit -m "feat(db): migration 024 — admin platform tables + on_hold/jury_review statuses"
```

---

## Task 4: State machine — transitions + apply_status_change helper

**Files:** Modify `backend/app/services/state_machine.py`; Test `backend/tests/test_state_machine.py` (create if absent)

- [ ] **Step 1: Write failing tests**
```python
from app.services import state_machine as sm

def test_evaluated_allows_on_hold():
    assert "on_hold" in sm.LEGAL_TRANSITIONS["evaluated"]

def test_on_hold_can_release_to_decisions():
    allowed = sm.LEGAL_TRANSITIONS["on_hold"]
    assert {"evaluated","shortlisted","rejected","waitlisted"} <= allowed

def test_shortlisted_allows_jury_review():
    assert "jury_review" in sm.LEGAL_TRANSITIONS["shortlisted"]
```
- [ ] **Step 2: Run → FAIL** (`on_hold` not a key; `jury_review` not allowed).
- [ ] **Step 3: Implement** — in `LEGAL_TRANSITIONS` change:
  - `"evaluated": frozenset({"shortlisted","on_hold","rejected","waitlisted","withdrawn"})`
  - add `"on_hold": frozenset({"evaluated","shortlisted","rejected","waitlisted","withdrawn"})`
  - `"shortlisted": frozenset({"jury_review","withdrawn"})`
  - add `"jury_review": frozenset({"withdrawn"})`
  Leave others unchanged.
- [ ] **Step 4: Add `apply_status_change` helper** (factors the update+log pattern used by `auto_transition_to_evaluated_if_complete`):
```python
def apply_status_change(application_id: str, track: str, *, to_status: str,
                        changed_by: str | None, reason: str | None = None) -> str:
    """Guarded status write: asserts legal transition, updates the app row, logs to
    application_status_log. Returns the previous status. Raises 422 on illegal move."""
    sb = get_admin_client()
    table = "tir_applications" if track == "tir" else "sip_applications"
    rows = sb.table(table).select("status").eq("id", application_id).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "application_not_found"})
    from_status = rows[0].get("status")
    assert_legal_transition(from_status, to_status)
    now_iso = datetime.now(UTC).isoformat()
    sb.table(table).update({"status": to_status}).eq("id", application_id).execute()
    try:
        sb.table("application_status_log").insert({
            "application_id": application_id, "application_track": track,
            "from_status": from_status, "to_status": to_status,
            "changed_by": changed_by, "reason": reason, "changed_at": now_iso,
        }).execute()
    except Exception as exc:
        log.warning("apply_status_change: status_log insert failed (swallowed)",
                    extra={"application_id": application_id, "err": str(exc)})
    return from_status
```
(Imports `datetime, UTC` and `HTTPException, status` already present in the module — verify; add if missing.)
- [ ] **Step 5: Add a test for apply_status_change** (FakeAdminClient pattern, monkeypatch get_admin_client): evaluated→shortlisted updates status + inserts status_log + returns "evaluated"; evaluated→under_review raises 422.
- [ ] **Step 6: Run** `cd backend && python -m pytest tests/test_state_machine.py -q --no-cov` → PASS. Also run `tests/test_reviewer.py` (auto_transition still works) → PASS.
- [ ] **Step 7: Commit**
```bash
git add backend/app/services/state_machine.py backend/tests/test_state_machine.py
git commit -m "feat(state-machine): on_hold + jury_review transitions; apply_status_change helper"
```

---

## Task 5: RBAC capabilities

**Files:** Modify `backend/app/rbac.py`, `frontend/src/lib/rbac.js`; Test `backend/tests/test_rbac.py`

- [ ] **Step 1: Failing test** (append to `test_rbac.py`):
```python
def test_admin_has_platform_capabilities():
    from app.rbac import ROLE_CAPABILITIES as C
    assert {"decide_application","manage_batches","manage_reviewers_roster"} <= C["admin"]
    assert "decide_application" in C["leadership"]
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — add `"decide_application","manage_batches","manage_reviewers_roster"` to the `admin` set and `"decide_application"` to `leadership` in `backend/app/rbac.py`. Mirror in `frontend/src/lib/rbac.js` ROLE_CAPABILITIES (admin + leadership sets).
- [ ] **Step 4: Run** `tests/test_rbac.py` → PASS.
- [ ] **Step 5: Commit**
```bash
git add backend/app/rbac.py frontend/src/lib/rbac.js backend/tests/test_rbac.py
git commit -m "feat(rbac): admin platform capabilities (decide/batches/roster)"
```

---

## Task 6: admin_query service + pipeline list & detail endpoints

**Files:** Create `backend/app/services/admin_query.py`, `backend/app/routers/admin_platform.py`; Modify `backend/app/main.py`; Test `backend/tests/test_admin_platform.py` (new)

- [ ] **Step 1: Failing test** — create `test_admin_platform.py` with the FakeAdminClient pattern (copy the fixture scaffolding from `test_reviewer.py`: `_FakeAdminClient`, `_FakeQuery`, `_install_db`, `_override_user`, `_clear_overrides`). Test:
```python
def test_pipeline_list_joins_decision_meta_batch(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "tir_applications": [{"id":"app-1","status":"evaluated","display_seq":26001,
            "basic_org":"Karkhana","solution_stage":"Pilot-ready product","submitted_at":"2026-05-20T00:00:00+00:00"}],
        "sip_applications": [],
        "ai_screening": [{"application_id":"app-1","application_track":"tir","score_overall":8.4,"project_name":"Karkhana Robotics","industry_category_id":"robotics"}],
        "admin_decisions": [{"application_id":"app-1","application_track":"tir","decision":"shortlisted","rationale":"strong","decided_at":"2026-06-10T00:00:00+00:00"}],
        "application_admin_meta": [{"application_id":"app-1","application_track":"tir","is_hidden":False,"is_archived":False}],
        "application_batches": [], "batches": [], "industry_categories":[{"id":"robotics","label":"Robotics & Automation"}],
        "reviews": [], "reviewer_assignments": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.get("/admin/platform/applications")
    assert r.status_code == 200
    items = {i["id"]: i for i in r.json()["applications"]}
    assert items["app-1"]["decision"] == "shortlisted"
    assert items["app-1"]["isHidden"] is False
    assert items["app-1"]["name"] == "Karkhana Robotics"

def test_detail_includes_decision_and_consensus(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, { ... same app-1 plus reviews:[{...one submitted review...}] ... })
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.get("/admin/platform/applications/tir/app-1")
    assert r.status_code == 200
    b = r.json()
    assert b["decision"]["decision"] == "shortlisted"
    assert "reviews" in b and "ai_screening" in b
```
- [ ] **Step 2: Run → FAIL** (404, router missing).
- [ ] **Step 3: Implement `admin_query.py`** with:
  - `fetch_pipeline(filters: dict) -> dict` — reuse `applications_query.fetch_apps_for_track` for tir+sip, join `ai_screening` (project_name/score/industry), `admin_decisions` (latest per app), `application_admin_meta`, `application_batches`+`batches`. Apply filters: status, track, industry, decision, batch_id, is_hidden, is_archived, search. Return `{applications:[...], total}`. Each item: id, applicationId(display), track, name, founder, industry, stage, ai_score_overall, status, decision, isHidden, isArchived, batch, submitted_at.
  - `fetch_detail(track, app_id) -> dict` — reuse `applications_query.{find_application_with_track or direct}, fetch_ai_screening_for, fetch_reviews_for, fetch_reviewer_assignments_for, fetch_status_history_for`; add latest `admin_decisions` row + `application_admin_meta` + batch. Return the leadership-detail shape + `decision`, `meta`, `batch`.
- [ ] **Step 4: Implement `admin_platform.py`** router (prefix `/admin/platform`, tag admin-platform) with the two GET routes, gated `require_capability("view_all_apps")` and `("view_app_detail")`. Register in `main.py` (`app.include_router(admin_platform.router)` next to the other admin routers).
- [ ] **Step 5: Run** `tests/test_admin_platform.py` → PASS; full suite stays at 19 failures.
- [ ] **Step 6: Commit**
```bash
git add backend/app/services/admin_query.py backend/app/routers/admin_platform.py backend/app/main.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): pipeline list + application detail (decision/meta/batch joins)"
```

---

## Task 7: Decision endpoint (single)

**Files:** Create `backend/app/services/decisions.py`; Modify `backend/app/routers/admin_platform.py`; Test `test_admin_platform.py`

- [ ] **Step 1: Failing tests**
```python
def test_decision_shortlist_writes_status_decision_audit(client, monkeypatch, _clear_overrides):
    fake = _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"evaluated"}],
        "sip_applications":[], "admin_decisions":[], "application_status_log":[]})
    monkeypatch.setattr("app.services.decisions.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/applications/tir/app-1/decision",
                    json={"decision":"shortlisted","rationale":"strong team"})
    assert r.status_code == 200, r.text
    assert any(t=="admin_decisions" for t,_ in fake.inserts)
    upd = [u for n,u,_ in fake.updates if n=="tir_applications"]
    assert any(u.get("status")=="shortlisted" for u in upd)

def test_decision_illegal_transition_422(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"draft"}],"sip_applications":[]})
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/applications/tir/app-1/decision", json={"decision":"shortlisted"})
    assert r.status_code == 422 and r.json()["detail"]["code"]=="illegal_transition"

def test_decision_requires_rationale_for_reject(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"evaluated"}],"sip_applications":[]})
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/applications/tir/app-1/decision", json={"decision":"rejected"})
    assert r.status_code == 422 and r.json()["detail"]["code"]=="rationale_required"
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `decisions.py`**:
```python
from .state_machine import apply_status_change
from .audit import write_audit
from ..supabase_client import get_admin_client
from datetime import UTC, datetime

def record_decision(*, track, application_id, decision, rationale, decided_by) -> dict:
    """Write the gate-1 decision: status change (guarded) + admin_decisions row + audit."""
    from_status = apply_status_change(application_id, track, to_status=decision,
                                      changed_by=decided_by, reason=rationale or f"gate1: {decision}")
    sb = get_admin_client()
    row = {"application_id": application_id, "application_track": track, "gate_stage": "gate1",
           "decision": decision, "rationale": rationale, "decided_by": decided_by,
           "decided_at": datetime.now(UTC).isoformat()}
    sb.table("admin_decisions").insert(row).execute()
    write_audit(actor_user_id=decided_by, actor_role="leadership", action_type="gate1_decision",
                target_table=f"{track}_applications", target_id=application_id,
                after={"decision": decision, "from_status": from_status})
    return {"application_id": application_id, "track": track, "decision": decision, "from_status": from_status}
```
- [ ] **Step 4: Add the route** to `admin_platform.py`:
```python
class DecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["shortlisted","on_hold","rejected","waitlisted"]
    rationale: str | None = None

@router.post("/applications/{track}/{application_id}/decision",
             dependencies=[Depends(require_capability("decide_application"))])
async def decide(track: Literal["tir","sip"], application_id: str, body: DecisionBody,
                 user: dict = Depends(get_current_user)) -> dict:
    if body.decision in ("rejected","waitlisted","on_hold") and not (body.rationale or "").strip():
        raise HTTPException(422, detail={"code":"rationale_required",
            "message":"A rationale is required for reject / waitlist / hold."})
    return decisions.record_decision(track=track, application_id=application_id,
        decision=body.decision, rationale=body.rationale, decided_by=user["user_id"])
```
- [ ] **Step 5: Run** → PASS; full suite at 19.
- [ ] **Step 6: Commit**
```bash
git add backend/app/services/decisions.py backend/app/routers/admin_platform.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): gate-1 decision endpoint (status + admin_decisions + audit, rationale-gated)"
```

---

## Task 8: Bulk decision

**Files:** Modify `admin_platform.py`, `decisions.py`; Test `test_admin_platform.py`

- [ ] **Step 1: Failing test** — POST `/admin/platform/decisions/bulk` with `{items:[{track,application_id,decision,rationale}], }` → 200 with per-id `results:[{application_id, status: decided|illegal_transition|not_found|rationale_required}]`; assert one decided + one illegal (seed one evaluated app, one draft app).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `decisions.record_decision_safe(...)` wrapping `record_decision` in try/except mapping HTTPException codes to result statuses; route loops items, returns results. Same rationale gate per item.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(admin): bulk gate-1 decisions with per-id results`

---

## Task 9: Admin meta (hide/archive/restore)

**Files:** Modify `admin_platform.py`, `admin_query.py`; Test `test_admin_platform.py`

- [ ] **Step 1: Failing test** — PATCH `/admin/platform/applications/tir/app-1/meta` `{is_hidden:true}` → 200; upserts application_admin_meta with is_hidden true + updated_by; audited. A second PATCH `{is_hidden:false}` restores. Assert `fake.inserts`/`upserts` carry the values.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `MetaBody(extra=forbid){is_hidden: bool|None, is_archived: bool|None, hidden_reason: str|None}`; route upserts `application_admin_meta` on conflict `(application_id, application_track)` with only the provided fields + updated_at/updated_by; `write_audit(action_type="admin_meta_update")`. Capability `view_all_apps`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(admin): application admin-meta hide/archive/restore`

---

## Task 10: Batches CRUD + assign

**Files:** Modify `admin_platform.py`, `admin_query.py`; Test `test_admin_platform.py`

- [ ] **Step 1: Failing tests** — `GET /admin/platform/batches` (list), `POST /admin/platform/batches {name,phase}` (create → row), `PATCH /admin/platform/batches/{id} {name}` (rename), `POST /admin/platform/batches/{id}/applications {items:[{track,application_id}]}` (bulk upsert application_batches, unique per app → re-assign moves it). Assert inserts/updates.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — routes gated `manage_batches`; bodies `extra=forbid`. Batch create/rename touch `batches`; assign upserts `application_batches` on conflict `(application_id, application_track)`; audit each.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(admin): batch CRUD + bulk application assignment`

---

## Task 11: Reviewer roster (GET + PATCH profile + rebalance)

**Files:** Modify `admin_platform.py`, `admin_query.py`; Test `test_admin_platform.py`

- [ ] **Step 1: Failing tests**
  - `GET /admin/platform/reviewers` → for each user with role 'reviewer' (from user_roles): `{user_id, name, email, domains, weight, assigned, completed, progress, consistency, lastActivity, batch}`. progress = completed/assigned from reviewer_assignments+reviews; consistency = round(1 - mean(|reviewer_overall − ai_overall|)/10, 2) over submitted reviews (clamped 0..1) or null if none; weight/domains from reviewer_profiles (default 1.0/[]). Seed 1 reviewer + 2 assignments (1 completed) + ai_screening + 1 review; assert progress "1 / 2" and a numeric consistency.
  - `PATCH /admin/platform/reviewers/{user_id} {weight:2.0, domains:["Robotics"]}` → upserts reviewer_profiles; audited.
  - `POST /admin/platform/reviewers/rebalance` → distributes unassigned non-draft apps across active reviewers evenly (creates reviewer_assignments with state pending); returns counts. Seed 2 reviewers + 4 unassigned apps → each gets 2.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in `admin_query.py` (`fetch_roster`, `rebalance`) + routes gated `manage_reviewers_roster`. Use bulk fetches. rebalance creates assignments via the same insert shape as the leadership assign endpoint (application_id, application_track, reviewer_user_id, assigned_by, assigned_at, state, due_at=None).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(admin): reviewer roster metrics + profile patch + rebalance`

---

## Task 12: Audit-log read + CSV

**Files:** Modify `admin_platform.py`, `admin_query.py`; Test `test_admin_platform.py`

- [ ] **Step 1: Failing test** — `GET /admin/platform/audit-log?actor=&action=&from=&to=` → merges `audit_log_v2` + `application_status_log` into one time-sorted list `[{ts, actor, action, target, detail}]`; filters applied; `?format=csv` returns text/csv. Seed a couple rows in each table; assert both appear newest-first and CSV has a header line.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `admin_query.fetch_audit(filters)` reads both tables, normalizes to a common shape, sorts by ts desc, applies filters in Python; route gated `view_audit_log`; CSV via `io.StringIO` + `csv.writer`, returned with `Response(media_type="text/csv")`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(admin): audit-log read endpoint + CSV export`

---

## Task 13: Analytics calibration + admin stats

**Files:** Modify `admin_platform.py`, `admin_query.py`; Test `test_admin_platform.py`

- [ ] **Step 1: Failing tests**
  - `GET /admin/platform/analytics/reviewer-calibration` → `[{user_id, name, n_reviews, avg_score, avg_variance_vs_ai}]`. Seed 1 reviewer + 2 submitted reviews + ai rows; assert avg_score and avg_variance computed.
  - `GET /admin/platform/stats` → reuse leadership stats shape + `decisions:{shortlisted,on_hold,rejected,waitlisted}` counts from admin_decisions. Assert keys present.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — gated `view_stats`. calibration reuses the roster computation core; stats calls the leadership stats logic (import the function or re-aggregate) + counts admin_decisions by decision.
- [ ] **Step 4: Run → PASS; then run the FULL backend suite** `cd backend && python -m pytest tests/ -q --no-cov 2>&1 | tail -2` → 19 failed (unchanged), everything else green.
- [ ] **Step 5: Commit** `feat(admin): reviewer-calibration analytics + admin dashboard stats`

---

## Task 14: Frontend — adminPlatformApi seam + shell + routes

**Files:** Create `frontend/src/lib/adminPlatformApi.js`, `frontend/src/styles/admin-portal.css`, `frontend/src/pages/admin/platform/ui.jsx`; Modify `frontend/src/pages/admin/AdminLayout.jsx`, `frontend/src/router.jsx`; Test `frontend/src/lib/__tests__/adminPlatformApi.test.js`

- [ ] **Step 1: Failing test** — assert each seam method calls the right path (vi.mock api.js): `getPipeline(params)`→`/admin/platform/applications{query}`, `getApplication(track,id)`, `decide(track,id,body)` POST, `bulkDecide(body)`, `patchMeta(track,id,body)` PATCH, `getBatches/createBatch/renameBatch/assignBatch`, `getReviewers/patchReviewer/rebalance`, `getAuditLog(params)`, `getCalibration`, `getStats`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `adminPlatformApi.js` (mirror `reviewerApi.js`/`leadershipApi.js` shape, `buildQuery` helper). Create `admin-portal.css` by copying the prototype `os/styles.css`, dropping `:root` token redefs that collide with `colors_and_type.css`, scoping portal classes under `.adm-portal` (same technique as `reviewer-portal.css`). Create `ui.jsx` with shared atoms (LoadingState/ErrorState/EmptyState/Chip/ScoreBar) + helpers, reusing `useAsync`. Extend `AdminLayout` nav with: Dashboard, Pipeline, Reviewers, Gate 1, Audit, Analytics, Batches, Settings, Users (existing) — each capability-gated; OMIT Jury/Psychometry/Gate-2. Add routes in `router.jsx` under `/admin/*` wrapped in `ProtectedRoute` + the existing admin capability gate.
- [ ] **Step 4: Run** `cd frontend && npm test` (seam test passes) and `npm run build` (compiles).
- [ ] **Step 5: Commit** `feat(admin-fe): adminPlatformApi seam + portal shell + nav + routes`

---

## Task 15: Frontend — Admin Dashboard (A-0)

**Files:** Create `frontend/src/pages/admin/platform/AdminDashboard.jsx`. Port `ReviewerDashboard`-equivalent from prototype `admin-1.jsx` (A-0). Reads `adminPlatformApi.getStats()`. Render KPIs, funnel, status breakdown, AI histogram, industry breakdown. Transformation rules: window globals → props/useAsync; mock data → getStats; keep layout/classes (scoped). Build must pass.
- [ ] Steps: implement → `npm run build` passes → smoke render (no console errors via the existing test harness if feasible, else build-gate) → commit `feat(admin-fe): dashboard screen`.

## Task 16: Frontend — Applications Pipeline (A-1)

**Files:** Create `AdminPipeline.jsx`. Port the pipeline table from `admin-1.jsx`: columns (ID, name, founder, domain, stage, AI score, reviewer score, status, decision, batch, submitted), filters (track/status/industry/decision/batch/search), bulk-select + bulk actions (decision via `bulkDecide`, hide/archive via `patchMeta`), batch assignment (`assignBatch`), CSV export. Reads `getPipeline`. Row click → detail route. Build passes. Commit `feat(admin-fe): applications pipeline`.

## Task 17: Frontend — Application Detail (A-2)

**Files:** Create `AdminApplicationDetail.jsx`. Port from `admin-1.jsx`/`admin-2.jsx`: full application (reuse the reviewer presenter shape via leadership detail OR render the detail payload), AI screening panel, reviewer consensus (reviews[]), reviewer assign/unassign (reuse `/leadership/applications/{id}/reviewers` via leadershipApi), admin decision card (decision buttons + rationale → `decide`), hide/archive/hold controls (`patchMeta` + decision on_hold), batch assignment. Build passes. Commit `feat(admin-fe): application detail with decision + assignment`.

## Task 18: Frontend — Gate 1 Review (A-4, 3 variants)

**Files:** Create `AdminGate1Review.jsx`. Port the 3 decision variants from `admin-2.jsx`: Decision-Stack (one app at a time + approve/hold/reject/waitlist + rationale), Triage-Table (whole-cohort inline decisions + Apply-All via `bulkDecide`), Cutoff-Histogram (score distribution + cutoff slider + auto-classify + manual override). All drive `decide`/`bulkDecide`. Build passes. Commit `feat(admin-fe): gate-1 review (stack/triage/cutoff variants)`.

## Task 19: Frontend — Reviewer Roster (A-3)

**Files:** Create `AdminReviewerRoster.jsx`. Port reviewer management from `admin-1.jsx`: roster table (domain, batch, progress, consistency, weight, last activity), edit weight/domains (`patchReviewer`), assign apps (leadershipApi assign), rebalance (`rebalance`), invite reviewer (reuse `adminApi.createUser` with role reviewer). Build passes. Commit `feat(admin-fe): reviewer roster`.

## Task 20: Frontend — Audit, Analytics, Settings, Batches

**Files:** Create `AdminAuditLog.jsx` (`getAuditLog` + CSV download), `AdminAnalytics.jsx` (`getCalibration`), `AdminSettings.jsx` (restore hidden/archived via `patchMeta`; release-hold via `decide` to a legal next state — show held apps from pipeline filter), `AdminBatches.jsx` (`getBatches`/`createBatch`/`renameBatch`/`assignBatch`). Build passes. Commit `feat(admin-fe): audit log, analytics, settings, batches`.

## Task 21: Full verification + role switch

- [ ] Add an "Admin" entry to the role-switch menus (reviewer portal + leadership dashboard) shown when the user holds the `admin` role, navigating to `/admin`. (Mirror the existing leadership↔reviewer switch added in the reviewer build.)
- [ ] Run `cd frontend && npm test && npm run build` — all green. Run `cd backend && python -m pytest tests/ -q --no-cov 2>&1 | tail -2` — 19 baseline failures, all else green.
- [ ] Commit `feat(admin-fe): admin role-switch entries + final verification`.

## Task 22: Staging rehearsal + cutover runbook (operational; prod step user-gated)

- [ ] **Staging:** hand the user migrations 023 + 024 SQL for the staging SQL editor (exqmxvdtcsvpgtftwjml); after applied, run the data setup (ensure nirav has `admin` role too via `setup_reviewer_nirav.py`-style grant; existing 69 assignments stand); deploy backend to staging from the worktree (`infra/sam/deploy-staging.sh`); fast-forward the `staging` branch for the frontend; verify the staging gateway CORS still includes the staging URL. Browser-smoke as nirav: dashboard → pipeline → open app → gate-1 decision → see it in audit → batch assign → roster → restore. Record results in the spec under a "Staging rehearsal" appendix.
- [ ] **Prod cutover (ONLY on explicit user go-ahead):** rebase `admin_final` onto current `origin/release/sip-launch-v1` (carries prod storage fixes); cut `release/reviewer-admin-v1`; hand user migrations 022 (already done) + 023 + 024 for the prod SQL editor; `sam build` from the release worktree (pre-window); window: `deploy-prod.sh` + Vercel promote + create reviewer/admin users + smoke (~≤15 min). Rollback = redeploy previous Lambda + Vercel instant rollback; schema additive.

---

## Self-review notes (completed)

- **Spec coverage:** §3.1→Task 1; §6 queue batching→Task 2; §3.2→Task 3; §4→Task 4; §5 rbac→Task 5; §5 pipeline/detail→Task 6; decision→Task 7-8; meta→Task 9; batches→Task 10; roster→Task 11; audit→Task 12; analytics/stats→Task 13; §7 frontend→Tasks 14-21; §8 testing folded into each task + Task 21; §9 rollout→Task 22.
- **Deferred (per spec §1):** jury, psychometry, Gate-2/interviews — no tasks, intentionally.
- **Type/name consistency:** decision values `shortlisted|on_hold|rejected|waitlisted` consistent across migration 024, state_machine, decisions.py, DecisionBody, frontend. `apply_status_change` signature consistent between Task 4 (def) and Task 7 (use). Capability names consistent between Task 5 (rbac) and Tasks 6-13 (gates).
- **No placeholders:** backend tasks carry real test + impl code; frontend port tasks (15-20) follow the proven reviewer-port transformation rules with build-gates per task (the reviewer Task 12 precedent). Where a frontend task says "port X", the rule set + seam mapping + source file are named explicitly.
