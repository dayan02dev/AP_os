# Reviewer Portal → Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the REVIEWER-UI prototype to production at `apply.artpark.info/reviewer/*`, backed by real `/reviewer/*` APIs, with SIP AI scoring enabled (provisional prompts).

**Architecture:** Extend the existing FastAPI `/reviewer` router and `reviewer_query` service in place (Approach A from the spec); one additive migration (022); SIP scoring as a track adapter to the existing LangGraph screener; fold the prototype UI into the prod Vite SPA replacing the basic reviewer pages. All work on branch `reviewer_final` in worktree `.claude/worktrees/reviewer_final`. Spec: `docs/superpowers/specs/2026-06-12-reviewer-portal-production-design.md`.

**Tech Stack:** FastAPI + Mangum (Lambda), supabase-py (admin client), Pydantic v2, LangGraph/LangChain via OpenRouter (Gemini 2.5 Flash), pytest with the `_FakeAdminClient`/`_FakeQuery` pattern (see `backend/tests/test_reviewer.py`), React 18 + Vite + React Router v6, Vitest for frontend lib tests.

**Grounded facts (verified in this worktree — do not re-derive):**
- Weighted overall already exists: `reviewer_query._weighted_overall(review)` with `_SCORE_WEIGHTS = {problem:22, solution:30, tech:22, founders:14, commitment:12}` (`backend/app/services/reviewer_query.py:287-304`).
- Stage label derivation exists: `stats.derive_stage_label(app_row)` (used by `leadership.py:270,354`).
- The AI-screener worker has an explicit SIP-enablement comment block at `backend/workers/ai_screener/handler.py:176-183` prescribing exactly 3 changes.
- `sqs_publisher.publish(application_id, application_track)` is already track-parameterized; TIR submit calls it at `backend/app/routers/applications.py:717`; the SIP submit route does NOT call it yet.
- `rbac.py` already grants leadership the `assign_reviewers` capability.
- Review scores are `numeric(4,1)` in the DB but the Pydantic bodies use `conint` — the prototype's sliders use 0.5 steps, so these must become floats (Task 2).
- Tests run from `backend/`: `cd backend && python -m pytest tests/ -x -q`. Frontend: `cd frontend && npm test`.
- Prototype source of truth: `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/REVIEWER-UI/` (`os/reviewer.jsx`, `os/api.js`, `os/styles.css`, `os/shell.jsx`).
- NEVER commit to `release/sip-launch-v1`. NEVER run `sam deploy` against production from this plan (staging only; prod cutover is a separate runbook step gated on the user).
- Commit messages: plain conventional commits, NO AI/Claude attribution lines.

---

### Task 1: Migration 022 (flags + due_at)

**Files:**
- Create: `backend/migrations/022_reviewer_portal_v2.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 022_reviewer_portal_v2.sql
-- Reviewer Portal v2 (spec docs/superpowers/specs/2026-06-12-reviewer-portal-production-design.md §3)
-- Additive only. Idempotent. Service-role-only tables — no RLS policy changes.
--
-- Apply to STAGING Supabase (exqmxvdtcsvpgtftwjml) first.
-- Apply to PROD Supabase (xtmszlpwgbyoumalgbhs) BEFORE the cutover window
-- (columns are unused by running code; zero risk).

-- 1. Reviewer-raised flags on a review (max 8, each ≤80 chars app-enforced)
alter table public.reviews
  add column if not exists flags jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reviews_flags_cap'
  ) then
    alter table public.reviews
      add constraint reviews_flags_cap
      check (jsonb_typeof(flags) = 'array' and jsonb_array_length(flags) <= 8);
  end if;
end $$;

-- 2. Per-assignment due date (drives the queue "Due" column)
alter table public.reviewer_assignments
  add column if not exists due_at timestamptz;
```

- [ ] **Step 2: Verify idempotency by inspection**

Run: `grep -c "if not exists\|IF NOT EXISTS" backend/migrations/022_reviewer_portal_v2.sql`
Expected: `3` (two ADD COLUMN guards + one constraint guard). Do NOT run against any database in this task — staging application happens in Task 12.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/022_reviewer_portal_v2.sql
git commit -m "feat(db): migration 022 — reviews.flags + reviewer_assignments.due_at"
```

---

### Task 2: Half-point scores (conint → float)

**Files:**
- Modify: `backend/app/routers/reviewer.py` (ReviewSubmitBody lines 91-95, ReviewPatchBody lines 277-281)
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write the failing test** (append to `backend/tests/test_reviewer.py`, reusing the file's existing `_FakeAdminClient` fixture pattern and `_auth_as` helper — copy the setup style of the existing submit tests in that file)

```python
def test_submit_review_accepts_half_point_scores(client, monkeypatch):
    """Prototype sliders move in 0.5 steps; conint would 422 on 7.5."""
    fake = _FakeAdminClient({
        "reviewer_assignments": [{
            "id": "asg-1", "application_id": "app-1", "application_track": "tir",
            "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None,
            "assigned_at": "2026-06-01T00:00:00+00:00",
        }],
        "reviews": [],
    })
    _install_fake(monkeypatch, fake)           # same helper style as existing tests
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])

    r = client.post("/reviewer/reviews", json={
        "application_id": "app-1", "application_track": "tir",
        "assignment_id": "asg-1",
        "score_problem": 7.5, "score_solution": 8.0, "score_tech": 6.5,
        "score_founders": 7.0, "score_commitment": 7.5,
        "recommendation": "yes", "draft": False,
    })
    assert r.status_code == 201, r.text
```

(If `test_reviewer.py` does not already expose `_install_fake`/`_auth_as` helpers under those names, follow the exact monkeypatch + `app.dependency_overrides[get_current_user]` pattern its existing submit tests use — the file is self-contained by design.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_reviewer.py::test_submit_review_accepts_half_point_scores -x -q`
Expected: FAIL — 422 from Pydantic (`Input should be a valid integer`).

- [ ] **Step 3: Implement** — in `backend/app/routers/reviewer.py`, replace every `conint(ge=0, le=10)` in BOTH `ReviewSubmitBody` and `ReviewPatchBody` with `confloat(ge=0, le=10)`, and update the import:

```python
from pydantic import BaseModel, ConfigDict, Field, confloat
```

```python
    score_problem:    confloat(ge=0, le=10) | None = None
    score_solution:   confloat(ge=0, le=10) | None = None
    score_tech:       confloat(ge=0, le=10) | None = None
    score_founders:   confloat(ge=0, le=10) | None = None
    score_commitment: confloat(ge=0, le=10) | None = None
```

(`conint` import goes away if now unused.)

- [ ] **Step 4: Run the new test AND the whole reviewer suite**

Run: `cd backend && python -m pytest tests/test_reviewer.py -x -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): accept 0.5-step scores (confloat) in review bodies"
```

---

### Task 3: Extended review payloads — flags, disagreements, notes; richer response

**Files:**
- Modify: `backend/app/routers/reviewer.py`
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write the failing tests** (append; same fixture pattern)

```python
def _base_submit_body(**over):
    body = {
        "application_id": "app-1", "application_track": "tir",
        "assignment_id": "asg-1",
        "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
        "score_founders": 7.0, "score_commitment": 7.0,
        "recommendation": "yes", "quick_notes": "solid team, real problem",
        "draft": False,
    }
    body.update(over)
    return body

def test_submit_requires_notes(client, monkeypatch):
    fake = _fake_with_one_assignment()         # helper: same rows as Task 2's fake
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.post("/reviewer/reviews", json=_base_submit_body(quick_notes=None))
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "notes_required"

def test_submit_persists_flags_and_disagreements(client, monkeypatch):
    fake = _fake_with_one_assignment()
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.post("/reviewer/reviews", json=_base_submit_body(
        flags=["Single founder — execution risk"],
        disagree_with_ai={"founders": "sole founder, no team yet"},
    ))
    assert r.status_code == 201, r.text
    table, payload = fake.inserts[-1]
    assert table == "reviews"
    assert payload["flags"] == ["Single founder — execution risk"]
    assert payload["disagree_with_ai"] == {"founders": "sole founder, no team yet"}

def test_submit_rejects_more_than_8_flags(client, monkeypatch):
    fake = _fake_with_one_assignment()
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.post("/reviewer/reviews",
                    json=_base_submit_body(flags=[f"f{i}" for i in range(9)]))
    assert r.status_code == 422

def test_submit_response_includes_weighted_overall_and_lock(client, monkeypatch):
    fake = _fake_with_one_assignment()
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.post("/reviewer/reviews", json=_base_submit_body(
        score_problem=8.0, score_solution=6.0, score_tech=7.0,
        score_founders=9.0, score_commitment=5.0,
    ))
    assert r.status_code == 201
    body = r.json()
    # 8*.22 + 6*.30 + 7*.22 + 9*.14 + 5*.12 = 6.96
    assert body["overall"] == 6.96
    assert body["editWindowExpiresAt"] is not None
```

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && python -m pytest tests/test_reviewer.py -x -q -k "notes_required or flags or weighted_overall"`
Expected: FAIL (extra=forbid rejects `flags`; no `notes_required` code; no `overall` key).

- [ ] **Step 3: Implement** in `backend/app/routers/reviewer.py`:

3a. Add fields to BOTH bodies (`ReviewSubmitBody` and `ReviewPatchBody`):

```python
    flags: list[str] | None = None
    disagree_with_ai: dict[str, str] | None = None
```

3b. Add a shared validator helper near `_validate_complete` and call it from both POST and the PATCH flip-to-submitted path:

```python
_MAX_FLAGS = 8
_MAX_FLAG_LEN = 80


def _validate_flags(flags: list[str] | None) -> None:
    if flags is None:
        return
    if len(flags) > _MAX_FLAGS or any(
        (not isinstance(f, str)) or len(f) > _MAX_FLAG_LEN or not f.strip()
        for f in flags
    ):
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "flags_invalid",
                    "message": f"Max {_MAX_FLAGS} flags, each non-empty and ≤{_MAX_FLAG_LEN} chars."},
        )


def _validate_notes(quick_notes: str | None, draft: bool) -> None:
    if draft:
        return
    if not (quick_notes or "").strip():
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "notes_required",
                    "message": "Notes are required before you can submit."},
        )
```

In `submit_review`, after `_validate_complete(body)` add:

```python
    _validate_flags(body.flags)
    _validate_notes(body.quick_notes, body.draft)
```

3c. Persist the new columns — add to `insert_row`:

```python
        "flags":            body.flags or [],
        "disagree_with_ai": body.disagree_with_ai,
```

(`ReviewPatchBody` fields flow automatically through the existing
`model_dump(exclude_unset=True)` patch builder — no change needed there, but the
flip-to-submitted path must call `_validate_flags(final.get("flags"))` and
`_validate_notes(final.get("quick_notes"), draft=False)` using the merged `final` dict
it already computes.)

3d. Enrich responses. In `submit_review`'s return, and `patch_review`'s return:

```python
    from ..services.reviewer_query import _weighted_overall  # top of file with other imports

    # submit_review:
    return {
        "review": review_row,
        "overall": _weighted_overall(review_row),
        "editWindowExpiresAt": review_row.get("locked_at"),
    }

    # patch_review (fetch the final row state by merging existing + patch):
    final_row = {**existing, **patch}
    return {
        "review_id": review_id,
        "patched": list(patch.keys()),
        "overall": _weighted_overall(final_row),
        "editWindowExpiresAt": final_row.get("locked_at"),
    }
```

Note: import `_weighted_overall` as a module-level import (`from ..services import reviewer_query` then `reviewer_query._weighted_overall(...)`) to match the file's existing import style.

- [ ] **Step 4: Run the full reviewer suite**

Run: `cd backend && python -m pytest tests/test_reviewer.py -x -q`
Expected: all PASS (older tests unaffected — new fields optional).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): flags, disagree_with_ai, notes-required; weighted overall in responses"
```

---

### Task 4: Remove the AI anti-anchoring strip (UI-is-truth decision)

**Files:**
- Modify: `backend/app/services/reviewer_query.py:254-272` (`fetch_application_for_reviewer`)
- Test: `backend/tests/test_reviewer.py` (one existing privacy test inverts)

- [ ] **Step 1: Find and invert the existing privacy-boundary test**

Run: `grep -n "ai_screening" backend/tests/test_reviewer.py | head`
Locate the test asserting `ai_screening is None` pre-submit. Rewrite it to assert AI data IS returned with no submitted review, and rename it:

```python
def test_app_detail_includes_ai_screening_before_submit(client, monkeypatch):
    """Spec decision 2026-06-12: prototypes are source of truth — AI visible pre-submit."""
    fake = _FakeAdminClient({
        "reviewer_assignments": [{
            "id": "asg-1", "application_id": "app-1", "application_track": "tir",
            "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None,
            "assigned_at": "2026-06-01T00:00:00+00:00",
        }],
        "tir_applications": [{"id": "app-1", "status": "under_review",
                              "submitted_at": "2026-05-20T00:00:00+00:00"}],
        "reviews": [],
        "ai_screening": [{"application_id": "app-1", "application_track": "tir",
                          "score_overall": 8.4, "confidence": 0.92}],
    })
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.get("/reviewer/applications/tir/app-1")
    assert r.status_code == 200
    assert r.json()["ai_screening"] is not None
    assert r.json()["ai_screening"]["score_overall"] == 8.4
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_reviewer.py::test_app_detail_includes_ai_screening_before_submit -x -q`
Expected: FAIL (`ai_screening` is None — strip still active).

- [ ] **Step 3: Implement** — in `fetch_application_for_reviewer`, replace the gated block

```python
    ai_screening = None
    if my_review and my_review.get("submitted_at"):
```

with an ungated fetch behind a single switch (spec §8 risk table — one-line re-gate later):

```python
    # Spec 2026-06-12 §1 decision 2: prototypes are source of truth — AI scores
    # are served pre-submit. To restore anti-anchoring later, set this to
    # `bool(my_review and my_review.get("submitted_at"))`.
    include_ai = True
    ai_screening = None
    if include_ai:
```

(keep the inner try/except fetch body unchanged). Also update the docstring lines 191-195 and the router module docstring line 5 (`AI stripped` → `AI included`).

- [ ] **Step 4: Run full backend suite** (other suites reference reviewer behavior)

Run: `cd backend && python -m pytest tests/ -x -q`
Expected: all PASS. If `test_acceptance_phase1.py` asserts the strip, update that assertion the same way with a comment citing the spec.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reviewer_query.py backend/app/routers/reviewer.py backend/tests/
git commit -m "feat(reviewer): serve ai_screening pre-submit (UI-is-truth spec decision)"
```

---

### Task 5: Bulk reviewer-assignment creation (leadership)

**Files:**
- Modify: `backend/app/routers/leadership_actions.py`
- Test: `backend/tests/test_leadership_writes.py`

- [ ] **Step 1: Write the failing tests** (append to `test_leadership_writes.py`, reusing its `_FakeAdminClient` and auth-override pattern)

```python
def test_assign_reviewers_bulk_creates_rows(client, monkeypatch):
    fake = _FakeAdminClient({
        "tir_applications": [{"id": "app-1", "status": "under_review"}],
        "sip_applications": [],
        "user_roles": [{"user_id": "rev-1", "role": "reviewer"},
                       {"user_id": "rev-2", "role": "reviewer"}],
        "reviewer_assignments": [],
        "reviews": [],
    })
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="lead-1", roles=["leadership"])
    r = client.post("/leadership/applications/tir/app-1/reviewers", json={
        "reviewer_user_ids": ["rev-1", "rev-2"],
        "due_at": "2026-06-20T00:00:00Z",
    })
    assert r.status_code == 200, r.text
    results = {x["reviewer_user_id"]: x for x in r.json()["results"]}
    assert results["rev-1"]["status"] == "created"
    assert results["rev-2"]["status"] == "created"
    inserted = [p for (t, p) in fake.inserts if t == "reviewer_assignments"]
    assert len(inserted) == 2
    assert inserted[0]["assigned_by"] == "lead-1"
    assert inserted[0]["due_at"] == "2026-06-20T00:00:00Z"

def test_assign_reviewers_conflict_and_not_reviewer(client, monkeypatch):
    fake = _FakeAdminClient({
        "tir_applications": [{"id": "app-1", "status": "under_review"}],
        "sip_applications": [],
        "user_roles": [{"user_id": "rev-1", "role": "reviewer"}],
        "reviewer_assignments": [{
            "id": "asg-1", "application_id": "app-1", "application_track": "tir",
            "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None,
        }],
        "reviews": [],
    })
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="lead-1", roles=["leadership"])
    r = client.post("/leadership/applications/tir/app-1/reviewers",
                    json={"reviewer_user_ids": ["rev-1", "stranger-9"]})
    assert r.status_code == 200
    results = {x["reviewer_user_id"]: x for x in r.json()["results"]}
    assert results["rev-1"]["status"] == "already_assigned"
    assert results["stranger-9"]["status"] == "not_a_reviewer"
```

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && python -m pytest tests/test_leadership_writes.py -x -q -k assign_reviewers`
Expected: FAIL with 404/405 (route missing).

- [ ] **Step 3: Implement** — append to `backend/app/routers/leadership_actions.py` (it already has `router`, `_resolve_app`, `write_audit`, `get_admin_client`, `require_capability`, `get_current_user` imports — reuse them; add any missing):

```python
class AssignReviewersBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewer_user_ids: list[str] = Field(..., min_length=1, max_length=10)
    due_at: str | None = None  # ISO timestamptz


@router.post(
    "/{track}/{application_id}/reviewers",
    dependencies=[Depends(require_capability("assign_reviewers"))],
)
async def assign_reviewers(
    track: Literal["tir", "sip"],
    application_id: str,
    body: AssignReviewersBody,
    user: dict = Depends(get_current_user),
) -> dict:
    """Bulk-create reviewer assignments (spec §4.1). Per-id result statuses:
    created | already_assigned | not_a_reviewer. 404 if the app doesn't exist."""
    sb = get_admin_client()

    table = "tir_applications" if track == "tir" else "sip_applications"
    app_rows = sb.table(table).select("id").eq("id", application_id).limit(1).execute().data
    if not app_rows:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "application_not_found"})

    role_rows = (sb.table("user_roles").select("user_id")
                 .eq("role", "reviewer").execute().data) or []
    reviewer_ids = {r["user_id"] for r in role_rows}

    existing_rows = (sb.table("reviewer_assignments").select("reviewer_user_id")
                     .eq("application_id", application_id)
                     .eq("application_track", track).execute().data) or []
    already = {r["reviewer_user_id"] for r in existing_rows}

    now = datetime.now(UTC).isoformat()
    results: list[dict] = []
    for rid in body.reviewer_user_ids:
        if rid not in reviewer_ids:
            results.append({"reviewer_user_id": rid, "status": "not_a_reviewer"})
            continue
        if rid in already:
            results.append({"reviewer_user_id": rid, "status": "already_assigned"})
            continue
        row = {
            "application_id": application_id,
            "application_track": track,
            "reviewer_user_id": rid,
            "assigned_by": user["user_id"],
            "assigned_at": now,
            "state": "pending",
            "due_at": body.due_at,
        }
        sb.table("reviewer_assignments").insert(row).execute()
        write_audit(
            actor_user_id=user["user_id"], actor_role="leadership",
            action_type="assign_reviewer",
            target_table="reviewer_assignments",
            target_id=f"{application_id}:{rid}",
            after={"application_track": track, "due_at": body.due_at},
        )
        already.add(rid)
        results.append({"reviewer_user_id": rid, "status": "created"})

    return {"application_id": application_id, "track": track, "results": results}
```

Add the imports the file is missing (check its header first): `from datetime import UTC, datetime`, `from typing import Literal`, `from pydantic import BaseModel, ConfigDict, Field`, `from fastapi import status as http_status`.

- [ ] **Step 4: Run the leadership-writes suite**

Run: `cd backend && python -m pytest tests/test_leadership_writes.py -x -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/leadership_actions.py backend/tests/test_leadership_writes.py
git commit -m "feat(leadership): bulk reviewer-assignment creation with per-id results"
```

---

### Task 6: GET /reviewer/queue

**Files:**
- Modify: `backend/app/services/reviewer_query.py` (new `fetch_queue`)
- Modify: `backend/app/routers/reviewer.py` (new route)
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write the failing test**

```python
def test_queue_shape_includes_ai_due_and_review_status(client, monkeypatch):
    fake = _FakeAdminClient({
        "reviewer_assignments": [
            {"id": "asg-1", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None,
             "assigned_at": "2026-06-01T00:00:00+00:00", "due_at": "2026-06-20T00:00:00+00:00"},
            {"id": "asg-2", "application_id": "app-2", "application_track": "sip",
             "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None,
             "assigned_at": "2026-06-02T00:00:00+00:00", "due_at": None},
        ],
        "tir_applications": [{"id": "app-1", "display_seq": 26001,
                              "basic_full_name": "Aanya Mehta", "basic_org": "Karkhana",
                              "solution_stage": "Pilot-ready product",
                              "submitted_at": "2026-05-20T00:00:00+00:00",
                              "basic_teammates": []}],
        "sip_applications": [{"id": "app-2", "display_seq": 26002,
                              "basic_full_name": "Priya Iyer", "basic_org": "Saathi",
                              "sip_trl": "TRL 5", "sip_traction": "Active pilots",
                              "submitted_at": "2026-05-21T00:00:00+00:00",
                              "sip_founders": []}],
        "reviews": [{"id": "rv-1", "application_id": "app-1", "application_track": "tir",
                     "reviewer_user_id": "rev-1", "submitted_at": "2026-06-03T00:00:00+00:00",
                     "locked_at": "2026-06-03T01:00:00+00:00"}],
        "ai_screening": [{"application_id": "app-1", "application_track": "tir",
                          "project_name": "Karkhana Robotics",
                          "score_overall": 8.4, "confidence": 0.92,
                          "score_problem": 8.6, "score_completeness": 8.2,
                          "score_tech": 9.0, "score_founders": 7.8,
                          "score_commitment": 8.4,
                          "industry_category_id": "robotics"}],
        "industry_categories": [{"id": "robotics", "label": "Robotics & Automation"}],
    })
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.get("/reviewer/queue")
    assert r.status_code == 200, r.text
    items = {i["id"]: i for i in r.json()}
    a1 = items["app-1"]
    assert a1["applicationId"] == "TIR-26001"
    assert a1["name"] == "Karkhana Robotics"          # ai project_name wins
    assert a1["industry"] == "Robotics & Automation"
    assert a1["due"] == "2026-06-20T00:00:00+00:00"
    assert a1["ai"]["overall"] == 8.4
    assert a1["ai"]["solution"] == 8.2                # maps score_completeness
    assert a1["ai"]["conf"] == 92
    assert a1["reviewStatus"] == "submitted"          # submitted stays in queue
    a2 = items["app-2"]
    assert a2["applicationId"] == "SIP-26002"
    assert a2["ai"] is None
    assert a2["reviewStatus"] == "not-started"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_reviewer.py::test_queue_shape_includes_ai_due_and_review_status -x -q`
Expected: FAIL 404 (route missing).

- [ ] **Step 3: Implement `fetch_queue`** — append to `backend/app/services/reviewer_query.py`:

```python
def _display_id(track: str, app_row: dict) -> str:
    seq = app_row.get("display_seq")
    prefix = "TIR" if track == "tir" else "SIP"
    return f"{prefix}-{seq}" if seq is not None else _compose_app_identifier(
        track, app_row.get("id", ""), app_row.get("submitted_at"))


def _founder_names(track: str, app_row: dict) -> list[str]:
    names = [app_row.get("basic_full_name") or ""]
    extra = app_row.get("basic_teammates") if track == "tir" else app_row.get("sip_founders")
    for t in (extra or []):
        n = (t or {}).get("name") or (t or {}).get("fullName")
        if n:
            names.append(n)
    return [n for n in names if n]


def _ai_block(ai_row: dict | None) -> dict | None:
    if not ai_row:
        return None
    conf = ai_row.get("confidence")
    return {
        "overall":  ai_row.get("score_overall"),
        "conf":     round(conf * 100) if isinstance(conf, (int, float)) else None,
        "problem":  ai_row.get("score_problem"),
        "solution": ai_row.get("score_completeness"),  # ai_screening naming (mig 016)
        "tech":     ai_row.get("score_tech"),
        "founders": ai_row.get("score_founders"),
        "commit":   ai_row.get("score_commitment"),
    }


def _review_status(my_review: dict | None) -> str:
    if my_review is None:
        return "not-started"
    if my_review.get("submitted_at"):
        return "submitted"
    return "draft"


def fetch_queue(reviewer_user_id: str) -> list[dict]:
    """Spec §4.2 — one canonical record per active assignment.

    Unlike fetch_inbox, SUBMITTED reviews stay in the queue (status chip),
    and AI scores are included pre-submit (spec decision 2026-06-12)."""
    from . import stats  # local import: stats imports nothing from this module

    sb = get_admin_client()
    try:
        assignments = (
            sb.table("reviewer_assignments").select("*")
            .eq("reviewer_user_id", reviewer_user_id).execute().data
        ) or []
    except Exception as exc:
        log.warning("queue: assignments fetch failed",
                    extra={"reviewer": reviewer_user_id, "err": str(exc)})
        return []
    assignments = [a for a in assignments
                   if a.get("declined_at") is None and a.get("reassigned_to") is None]

    # industry label lookup table (small; one fetch)
    try:
        cats = (sb.table("industry_categories").select("*").execute().data) or []
    except Exception:
        cats = []
    cat_label = {c["id"]: c.get("label") for c in cats}

    out: list[dict] = []
    for a in assignments:
        track = a["application_track"]
        table = "tir_applications" if track == "tir" else "sip_applications"
        try:
            app_rows = (sb.table(table).select("*")
                        .eq("id", a["application_id"]).limit(1).execute().data) or []
        except Exception as exc:
            log.warning("queue: app fetch failed",
                        extra={"application_id": a.get("application_id"), "err": str(exc)})
            continue
        if not app_rows:
            continue
        app_row = app_rows[0]

        try:
            ai_rows = (sb.table("ai_screening").select("*")
                       .eq("application_id", a["application_id"])
                       .eq("application_track", track).execute().data) or []
        except Exception:
            ai_rows = []
        ai_row = ai_rows[0] if ai_rows else None

        try:
            rv_rows = (sb.table("reviews").select("*")
                       .eq("application_id", a["application_id"])
                       .eq("application_track", track)
                       .eq("reviewer_user_id", reviewer_user_id).execute().data) or []
        except Exception:
            rv_rows = []
        my_review = rv_rows[0] if rv_rows else None

        industry = None
        if ai_row and ai_row.get("industry_category_id"):
            industry = cat_label.get(ai_row["industry_category_id"])

        out.append({
            "id":            a["application_id"],
            "assignmentId":  a["id"],
            "applicationId": _display_id(track, app_row),
            "track":         track,
            "name":          (ai_row or {}).get("project_name")
                             or app_row.get("basic_org")
                             or app_row.get("basic_full_name") or "—",
            "founders":      _founder_names(track, app_row),
            "industry":      industry or "—",
            "stage":         stats.derive_stage_label({**app_row, "track": track}),
            "due":           a.get("due_at"),
            "ai":            _ai_block(ai_row),
            "reviewStatus":  _review_status(my_review),
            "editWindowExpiresAt": (my_review or {}).get("locked_at"),
        })
    # newest assignment first
    out.sort(key=lambda x: x.get("due") or "9999", reverse=False)
    return out
```

(Verify `stats.derive_stage_label`'s expected row shape with `grep -n "def derive_stage_label" -A 20 backend/app/services/stats.py` and adapt the call if it takes `(row)` keyed differently — match whatever leadership.py:270 passes.)

3b. Add the route to `backend/app/routers/reviewer.py`:

```python
@router.get(
    "/queue",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_queue(user: dict = Depends(get_current_user)) -> list[dict]:
    """Spec §4.2 — rich queue. Replaces buildReviewerQueue() in the prototype."""
    return reviewer_query.fetch_queue(user["user_id"])
```

- [ ] **Step 4: Run the suite**

Run: `cd backend && python -m pytest tests/test_reviewer.py -x -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reviewer_query.py backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): GET /reviewer/queue — canonical queue with AI block, due dates, review status"
```

---

### Task 7: Application-content presenter — GET /reviewer/applications/{track}/{id}/content

**Files:**
- Create: `backend/app/services/review_presenter.py`
- Modify: `backend/app/routers/reviewer.py` (new route)
- Test: `backend/tests/test_review_presenter.py` (new file — pure functions, no HTTP)
- Test: `backend/tests/test_reviewer.py` (route-level test)

- [ ] **Step 1: Write the failing unit tests** — create `backend/tests/test_review_presenter.py`:

```python
"""Unit tests for the §4.3 presenter — pure functions over application rows."""
from app.services.review_presenter import (
    sentence_bullets, build_fields, build_sections, TIR_FIELD_MAP, SIP_FIELD_MAP,
)


def test_sentence_bullets_splits_on_sentences_protecting_decimals():
    text = ("We process 4.5 tonnes daily. Costs fall by ₹2.3 lakh per site. "
            "Pilots run in 3 cities.")
    assert sentence_bullets(text) == [
        "We process 4.5 tonnes daily.",
        "Costs fall by ₹2.3 lakh per site.",
        "Pilots run in 3 cities.",
    ]


def test_sentence_bullets_prefers_bullet_markers():
    text = "• first point • second point"
    assert sentence_bullets(text) == ["first point", "second point"]


def test_build_fields_tir_marks_short_facts_and_bullets_long_text():
    row = {
        "problem_defined": "Yes",
        "problem_describe": "Indian startups face slow valuations. Banks lack data.",
        "solution_stage": "Pilot-ready product",
        "solution_describe": None,
    }
    fields = build_fields(row, TIR_FIELD_MAP)
    by_label = {f["label"]: f for f in fields}
    assert by_label["Problem defined"]["short"] is True
    assert by_label["Problem description"]["bullets"] == [
        "Indian startups face slow valuations.", "Banks lack data."]
    assert "Solution description" not in by_label  # None answers omitted


def test_build_sections_covers_every_mapped_question():
    row = {col: "x" for _, col, _ in TIR_FIELD_MAP}
    sections = build_sections(row, "tir")
    prompts = [q["prompt"] for s in sections for q in s["questions"]]
    assert len(prompts) >= 10                      # all wizard questions present
    assert sections[0]["num"] == "01"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_review_presenter.py -x -q`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Implement** — create `backend/app/services/review_presenter.py`:

```python
"""Presenter for GET /reviewer/applications/{track}/{id}/content (spec §4.3).

Maps tir_applications / sip_applications rows into the shape the Reviewer
Portal renders: {aiSummary, fields[], sections[], attachments[]}.

Formatting contract (REVIEWER_BACKEND_HANDOFF.md §2.3):
  * long answers   -> {"label", "bullets": [<= 1 sentence each]}
  * short facts    -> {"label", "value", "short": true}
  * None/empty     -> omitted entirely
The field maps below are the single source of truth — when a wizard question
is added, add one row here and the UI needs no change.
"""

from __future__ import annotations

import re

# (label, column, kind) — kind: "fact" | "long"
TIR_FIELD_MAP: list[tuple[str, str, str]] = [
    ("Problem defined",              "problem_defined",             "fact"),
    ("Problem description",          "problem_describe",            "long"),
    ("Solution stage",               "solution_stage",              "fact"),
    ("Solution description",         "solution_describe",           "long"),
    ("Solution core tech",           "solution_core_tech",          "long"),
    ("Solution contrarian insight",  "solution_contrarian_insight", "long"),
    ("Execution milestone",          "execution_milestone",         "long"),
    ("Execution infrastructure",     "execution_infrastructure",    "long"),
    ("What will break first",        "execution_will_break",        "long"),
]

SIP_FIELD_MAP: list[tuple[str, str, str]] = [
    ("Incorporated",                 "sip_incorporated",            "fact"),
    ("Technology readiness (TRL)",   "sip_trl",                     "fact"),
    ("Traction",                     "sip_traction",                "fact"),
    ("Traction details",             "sip_traction_details",        "long"),
    ("DPIIT recognised",             "basic_dpiit_registered",      "fact"),
    ("Problem description",          "problem_describe",            "long"),
    ("Solution description",         "solution_describe",           "long"),
    ("Solution core tech",           "solution_core_tech",          "long"),
    ("Solution contrarian insight",  "solution_contrarian_insight", "long"),
    ("Execution milestone",          "execution_milestone",         "long"),
    ("Execution infrastructure",     "execution_infrastructure",    "long"),
    ("What will break first",        "execution_will_break",        "long"),
]

# Section layout: (num, title, [(prompt, column), ...]) — mirrors the wizard.
TIR_SECTIONS: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("01", "Basic details", [
        ("Full name",                       "basic_full_name"),
        ("Phone",                           "basic_phone"),
        ("Email",                           "basic_email"),
        ("Organisation",                    "basic_org"),
        ("Degree",                          "basic_degree"),
        ("Do you have co-founders?",        "basic_has_team"),
        ("Incubator association",           "basic_incubator_association"),
        ("How did you hear about ARTPARK?", "basic_hear_about"),
    ]),
    ("02", "Problem & importance", [
        ("Is the problem well defined?",    "problem_defined"),
        ("Describe the problem",            "problem_describe"),
    ]),
    ("03", "Your solution", [
        ("Describe your solution",          "solution_describe"),
        ("Core technology",                 "solution_core_tech"),
        ("Contrarian insight",              "solution_contrarian_insight"),
    ]),
    ("04", "Execution plan", [
        ("Current stage",                   "solution_stage"),
        ("Critical milestone",              "execution_milestone"),
        ("Infrastructure needed",           "execution_infrastructure"),
        ("What will break first",           "execution_will_break"),
    ]),
    ("05", "Evidence", [
        ("Demo video URL",                  "evidence_video_url"),
    ]),
    ("06", "Declaration", [
        ("Information is truthful",         "declaration_truthful"),
        ("Consent to reference checks",     "declaration_ref_checks"),
        ("Accepted terms",                  "declaration_terms"),
    ]),
]

SIP_SECTIONS: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("01", "Basic details", [
        ("Full name",                       "basic_full_name"),
        ("Phone",                           "basic_phone"),
        ("Email",                           "basic_email"),
        ("Company",                         "basic_org"),
        ("Incorporated",                    "sip_incorporated"),
        ("TRL",                             "sip_trl"),
        ("DPIIT recognised",                "basic_dpiit_registered"),
        ("DPIIT recognition number",        "basic_dpiit_recognition_number"),
    ]),
    ("02", "Problem & importance", [
        ("Describe the problem",            "problem_describe"),
    ]),
    ("03", "Solution & traction", [
        ("Describe your solution",          "solution_describe"),
        ("Core technology",                 "solution_core_tech"),
        ("Contrarian insight",              "solution_contrarian_insight"),
        ("Traction level",                  "sip_traction"),
        ("Traction details",                "sip_traction_details"),
    ]),
    ("04", "Execution plan", [
        ("Critical milestone",              "execution_milestone"),
        ("Infrastructure needed",           "execution_infrastructure"),
        ("What will break first",           "execution_will_break"),
    ]),
    ("05", "Evidence", [
        ("Demo video URL",                  "sip_demo_video_url"),
    ]),
    ("06", "Declaration", [
        ("Information is truthful",         "declaration_truthful"),
        ("Consent to reference checks",     "declaration_ref_checks"),
        ("Accepted terms",                  "declaration_terms"),
    ]),
]

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z₹\"'(])")
_BULLET_MARKERS = re.compile(r"\s*[•·]\s*")


def sentence_bullets(text: str) -> list[str]:
    """One-sentence bullets per handoff §2.3 (mirrors the prototype's fieldBullets)."""
    text = (text or "").strip()
    if not text:
        return []
    if "•" in text or "·" in text:
        return [p.strip() for p in _BULLET_MARKERS.split(text) if p.strip()]
    return [p.strip() for p in _SENTENCE_SPLIT.split(text) if p.strip()]


def _is_fact(value: str) -> bool:
    return len(value) <= 48 and not any(c in value for c in ".!?")


def build_fields(row: dict, field_map: list[tuple[str, str, str]]) -> list[dict]:
    out: list[dict] = []
    for label, col, kind in field_map:
        raw = row.get(col)
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            continue
        value = str(raw).strip()
        if kind == "fact" or _is_fact(value):
            out.append({"label": label, "value": value, "short": True})
        else:
            out.append({"label": label, "bullets": sentence_bullets(value)})
    return out


def build_sections(row: dict, track: str) -> list[dict]:
    layout = TIR_SECTIONS if track == "tir" else SIP_SECTIONS
    sections: list[dict] = []
    for num, title, questions in layout:
        qs = []
        for prompt, col in questions:
            raw = row.get(col)
            if raw is None or raw == "" or raw == []:
                continue
            if isinstance(raw, bool):
                answer = "Yes" if raw else "No"
            else:
                answer = str(raw)
            qs.append({"prompt": prompt, "answer": answer, "type": "text"})
        sections.append({"num": num, "title": title, "questions": qs})
    return sections


def collect_attachment_paths(row: dict, track: str) -> list[dict]:
    """Returns [{kind, name, storage_path, bucket}] — signing happens in the router
    (reuses the leadership signed-URL flow)."""
    out: list[dict] = []
    if track == "sip":
        deck = row.get("sip_pitch_deck")
        if isinstance(deck, dict) and deck.get("path"):
            out.append({"kind": "deck", "name": deck.get("name") or "pitch-deck",
                        "storage_path": deck["path"], "bucket": "sip-evidence-files"})
        for f in (row.get("sip_traction_files") or []):
            if isinstance(f, dict) and f.get("path"):
                out.append({"kind": "traction", "name": f.get("name") or "traction",
                            "storage_path": f["path"], "bucket": "sip-evidence-files"})
        for f in (row.get("sip_patents_files") or []):
            if isinstance(f, dict) and f.get("path"):
                out.append({"kind": "patent", "name": f.get("name") or "patent",
                            "storage_path": f["path"], "bucket": "sip-evidence-files"})
    else:
        for f in (row.get("evidence_files") or []):
            if isinstance(f, dict) and f.get("storage_path"):
                out.append({"kind": "evidence", "name": f.get("name") or "evidence",
                            "storage_path": f["storage_path"], "bucket": "tir-evidence-files"})
        for f in (row.get("execution_milestone_files") or []):
            path = (f or {}).get("path") or (f or {}).get("storage_path")
            if path:
                out.append({"kind": "milestone", "name": f.get("name") or "milestone",
                            "storage_path": path, "bucket": "tir-milestone-files"})
    return out
```

- [ ] **Step 4: Run unit tests**

Run: `cd backend && python -m pytest tests/test_review_presenter.py -x -q`
Expected: all PASS.

- [ ] **Step 5: Write the failing route test** (append to `test_reviewer.py`)

```python
def test_content_endpoint_returns_presenter_shape(client, monkeypatch):
    fake = _FakeAdminClient({
        "reviewer_assignments": [{
            "id": "asg-1", "application_id": "app-1", "application_track": "tir",
            "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None,
            "assigned_at": "2026-06-01T00:00:00+00:00"}],
        "tir_applications": [{
            "id": "app-1", "display_seq": 26001, "basic_full_name": "Aanya Mehta",
            "basic_org": "Karkhana", "problem_defined": "Yes",
            "problem_describe": "Robots are costly. Integration is slow.",
            "solution_stage": "Pilot-ready product",
            "submitted_at": "2026-05-20T00:00:00+00:00", "evidence_files": []}],
        "reviews": [], "ai_screening": [
            {"application_id": "app-1", "application_track": "tir",
             "summary": "Strong robotics play.", "project_name": "Karkhana Robotics"}],
        "industry_categories": [],
    })
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.get("/reviewer/applications/tir/app-1/content")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["aiSummary"] == "Strong robotics play."
    assert body["name"] == "Karkhana Robotics"
    labels = {f["label"] for f in body["fields"]}
    assert {"Problem defined", "Problem description"} <= labels
    assert body["sections"][0]["num"] == "01"
    assert body["attachments"] == []

def test_content_endpoint_404_when_not_assigned(client, monkeypatch):
    fake = _FakeAdminClient({"reviewer_assignments": [], "tir_applications": [],
                             "reviews": [], "ai_screening": [], "industry_categories": []})
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.get("/reviewer/applications/tir/app-x/content")
    assert r.status_code == 404
```

- [ ] **Step 6: Implement the route** — add to `backend/app/routers/reviewer.py` **above** the existing `/applications/{track}/{application_id}` route (FastAPI matches in registration order; `/content` must register first):

```python
from ..services import review_presenter  # with the other service imports


@router.get(
    "/applications/{track}/{application_id}/content",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_application_content(
    track: Literal["tir", "sip"],
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    """Spec §4.3 presenter — the full application as the eval screen renders it.
    404 (not 403) when unassigned: no app-existence enumeration."""
    payload = reviewer_query.fetch_application_for_reviewer(
        user["user_id"], track, application_id,
    )
    if payload is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    app_row = payload["application"]
    ai = payload.get("ai_screening") or {}
    field_map = (review_presenter.TIR_FIELD_MAP if track == "tir"
                 else review_presenter.SIP_FIELD_MAP)

    attachments = []
    sb = get_admin_client()
    for att in review_presenter.collect_attachment_paths(app_row, track):
        try:
            signed = (sb.storage.from_(att["bucket"])
                      .create_signed_url(att["storage_path"], 120))
            url = None
            if isinstance(signed, dict):
                url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
            if url:
                attachments.append({"kind": att["kind"], "name": att["name"], "url": url})
        except Exception:
            log.warning("content: signed url failed",
                        extra={"path": att["storage_path"]})

    return {
        "id": application_id,
        "applicationId": reviewer_query._display_id(track, app_row),
        "track": track,
        "name": ai.get("project_name") or app_row.get("basic_org")
                or app_row.get("basic_full_name") or "—",
        "aiSummary": ai.get("summary"),
        "fields": review_presenter.build_fields(app_row, field_map),
        "sections": review_presenter.build_sections(app_row, track),
        "attachments": attachments,
        "evaluation": payload.get("my_review"),
        "assignment": payload.get("assignment"),
    }
```

- [ ] **Step 7: Run the suite**

Run: `cd backend && python -m pytest tests/test_reviewer.py tests/test_review_presenter.py -x -q`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/review_presenter.py backend/app/routers/reviewer.py backend/tests/
git commit -m "feat(reviewer): application-content presenter endpoint (sections/fields/bullets/attachments)"
```

---### Task 8: GET /reviewer/history

**Files:**
- Modify: `backend/app/services/reviewer_query.py` (new `fetch_history`)
- Modify: `backend/app/routers/reviewer.py` (new route)
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write the failing test**

```python
def test_history_rows_variance_and_admin_decision(client, monkeypatch):
    fake = _FakeAdminClient({
        "reviews": [{
            "id": "rv-1", "application_id": "app-1", "application_track": "tir",
            "reviewer_user_id": "rev-1",
            "score_problem": 8.0, "score_solution": 8.0, "score_tech": 8.0,
            "score_founders": 8.0, "score_commitment": 8.0,
            "recommendation": "yes",
            "submitted_at": "2026-06-03T00:00:00+00:00",
            "locked_at": "2026-06-03T01:00:00+00:00"}],
        "tir_applications": [{"id": "app-1", "display_seq": 26001,
                              "basic_org": "Karkhana", "status": "shortlisted",
                              "submitted_at": "2026-05-20T00:00:00+00:00"}],
        "ai_screening": [{"application_id": "app-1", "application_track": "tir",
                          "score_overall": 8.5, "project_name": "Karkhana Robotics"}],
        "reviewer_assignments": [], "industry_categories": [],
    })
    _install_fake(monkeypatch, fake)
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.get("/reviewer/history")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["total"] == 1
    assert body["stats"]["consistencyPct"] is None
    row = body["rows"][0]
    assert row["myScore"] == 8.0          # weighted mean of all-8s
    assert row["aiScore"] == 8.5
    assert row["variance"] == 0.5
    assert row["adminDecision"] == "approved"   # shortlisted → approved
    assert row["reco"] == "yes"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_reviewer.py::test_history_rows_variance_and_admin_decision -x -q`
Expected: FAIL 404.

- [ ] **Step 3: Implement `fetch_history`** — append to `reviewer_query.py`:

```python
_APPROVED_STATUSES = {"shortlisted", "interview", "offered", "onboarded", "accepted"}


def _admin_decision(app_status: str | None) -> str:
    if app_status in _APPROVED_STATUSES:
        return "approved"
    if app_status == "rejected":
        return "rejected"
    return "pending"


def fetch_history(reviewer_user_id: str) -> dict:
    """Spec §4.5 — every SUBMITTED review by this reviewer, newest first."""
    sb = get_admin_client()
    try:
        rows = (sb.table("reviews").select("*")
                .eq("reviewer_user_id", reviewer_user_id).execute().data) or []
    except Exception as exc:
        log.warning("history: reviews fetch failed",
                    extra={"reviewer": reviewer_user_id, "err": str(exc)})
        return {"stats": {"total": 0, "avgVariance": None,
                          "consistencyPct": None, "avgMinutes": None}, "rows": []}

    submitted = [r for r in rows if r.get("submitted_at")]
    submitted.sort(key=lambda r: r.get("submitted_at") or "", reverse=True)

    out_rows: list[dict] = []
    variances: list[float] = []
    for r in submitted:
        track = r["application_track"]
        table = "tir_applications" if track == "tir" else "sip_applications"
        try:
            app_rows = (sb.table(table).select("*")
                        .eq("id", r["application_id"]).limit(1).execute().data) or []
        except Exception:
            app_rows = []
        app_row = app_rows[0] if app_rows else {}

        try:
            ai_rows = (sb.table("ai_screening").select("*")
                       .eq("application_id", r["application_id"])
                       .eq("application_track", track).execute().data) or []
        except Exception:
            ai_rows = []
        ai_row = ai_rows[0] if ai_rows else None

        my_score = _weighted_overall(r)
        ai_score = (ai_row or {}).get("score_overall")
        variance = (round(abs(my_score - ai_score), 1)
                    if my_score is not None and ai_score is not None else None)
        if variance is not None:
            variances.append(variance)

        out_rows.append({
            "appId":         r["application_id"],
            "reviewId":      r["id"],
            "track":         track,
            "name":          (ai_row or {}).get("project_name")
                             or app_row.get("basic_org")
                             or app_row.get("basic_full_name") or "—",
            "date":          r.get("submitted_at"),
            "myScore":       my_score,
            "aiScore":       ai_score,
            "variance":      variance,
            "reco":          r.get("recommendation"),
            "adminDecision": _admin_decision(app_row.get("status")),
            "editWindowExpiresAt": r.get("locked_at"),
        })

    avg_var = round(sum(variances) / len(variances), 2) if variances else None
    return {
        "stats": {"total": len(out_rows), "avgVariance": avg_var,
                  "consistencyPct": None, "avgMinutes": None},
        "rows": out_rows,
    }
```

3b. Route in `reviewer.py`:

```python
@router.get(
    "/history",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_history(user: dict = Depends(get_current_user)) -> dict:
    """Spec §4.5 — submitted reviews + AI variance + current admin decision."""
    return reviewer_query.fetch_history(user["user_id"])
```

- [ ] **Step 4: Run the suite**

Run: `cd backend && python -m pytest tests/test_reviewer.py -x -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reviewer_query.py backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): GET /reviewer/history with variance and admin-decision mapping"
```

---

### Task 9: GET /reviewer/rubric

**Files:**
- Create: `backend/app/services/rubric.py`
- Modify: `backend/app/routers/reviewer.py`
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write the failing test**

```python
def test_rubric_endpoint_versioned_and_weighted(client):
    _auth_as(client.app, user_id="rev-1", roles=["reviewer"])
    r = client.get("/reviewer/rubric?track=tir")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "v3.1"
    assert sum(d["weight"] for d in body["dimensions"]) == 100
    keys = [d["key"] for d in body["dimensions"]]
    assert keys == ["problem", "solution", "tech", "founders", "commit"]
    assert body["title"].startswith("TIR")
```

- [ ] **Step 2: Run to verify failure** — `cd backend && python -m pytest tests/test_reviewer.py::test_rubric_endpoint_versioned_and_weighted -x -q` → FAIL 404.

- [ ] **Step 3: Implement** — create `backend/app/services/rubric.py`. Transcribe the anchors VERBATIM from the prototype: `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/REVIEWER-UI/os/reviewer.jsx` lines 1154-1235 (`RubricModal`) — every dimension has 5 anchor tiers (10/8/6/4/2). Structure:

```python
"""Rubric v3.1 — single source for the modal, inline panel, and scoring.md
download. Weights MUST stay in lockstep with reviewer_query._SCORE_WEIGHTS."""

RUBRIC_VERSION = "v3.1"
RUBRIC_DATE = "2026-04-01"

RUBRIC_DIMENSIONS = [
    {"key": "problem",  "name": "Problem Quality",  "weight": 22,
     "description": "Problem statement impact and importance",
     "anchors": {  # transcribe each tier's text from reviewer.jsx:1157-1163
         "10": "<verbatim from prototype>", "8": "<verbatim>", "6": "<verbatim>",
         "4": "<verbatim>", "2": "<verbatim>"}},
    {"key": "solution", "name": "Solution Fit",     "weight": 30,
     "description": "Completeness, depth of solution",
     "anchors": {"10": "<verbatim from reviewer.jsx:1164-1170>", "8": "...",
                 "6": "...", "4": "...", "2": "..."}},
    {"key": "tech",     "name": "Tech Depth",        "weight": 22,
     "description": "Technical depth",
     "anchors": {"10": "<verbatim from reviewer.jsx:1171-1177>", "8": "...",
                 "6": "...", "4": "...", "2": "..."}},
    {"key": "founders", "name": "Founder Strength",  "weight": 14,
     "description": "Professional profile of founder",
     "anchors": {"10": "<verbatim from reviewer.jsx:1178-1184>", "8": "...",
                 "6": "...", "4": "...", "2": "..."}},
    {"key": "commit",   "name": "Commitment",        "weight": 12,
     "description": "Commitment to be fully available",
     "anchors": {"10": "<verbatim from reviewer.jsx:1185-1191>", "8": "...",
                 "6": "...", "4": "...", "2": "..."}},
]


def get_rubric(track: str) -> dict:
    label = "TIR" if track == "tir" else "VIP"
    return {
        "version": RUBRIC_VERSION,
        "date": RUBRIC_DATE,
        "title": f"{label} 2026 rubric",
        "dimensions": RUBRIC_DIMENSIONS,
    }
```

**The `<verbatim ...>` markers are instructions to the implementer, not shippable content** — open the prototype file at the cited lines and copy each anchor string exactly. The test in Step 1 plus a `grep -c "verbatim" backend/app/services/rubric.py` returning `0` is the done-check.

Route in `reviewer.py`:

```python
from ..services import rubric as rubric_service


@router.get(
    "/rubric",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_rubric(
    track: Literal["tir", "sip"] = Query("tir"),
) -> dict:
    return rubric_service.get_rubric(track)
```

- [ ] **Step 4: Run + check no placeholders left**

Run: `cd backend && python -m pytest tests/test_reviewer.py -x -q && grep -c "verbatim" backend/app/services/rubric.py`
Expected: tests PASS, grep prints `0`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/rubric.py backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): versioned rubric endpoint (v3.1, single source)"
```

---

### Task 10: SIP AI scoring (provisional prompts)

**Files:**
- Modify: `backend/workers/ai_screener/handler.py` (delete the SIP-reject block per its own comment at lines 176-183; parameterize the applications table)
- Modify: `backend/app/services/ai_scoring/runner.py` (remove the `track != "tir"` ValueError at line 97; parameterization already exists — `_load_application_row`/`_load_resume_meta` take `track`)
- Modify: `backend/app/routers/ai_screening.py` (remove the TIR-only 422 at lines 49-53)
- Modify: `backend/app/routers/sip_applications.py` (add `sqs_publisher.publish(submitted["id"], "sip")` in the submit handler — mirror `applications.py:717`)
- Create: `backend/app/services/ai_scoring/tracks/__init__.py`, `backend/app/services/ai_scoring/tracks/sip_evidence.py`
- Modify: `backend/app/services/ai_scoring/nodes/extract_evidence.py` (route SIP rows through the SIP evidence mapper)
- Create: `scripts/backfill_sip_ai_scores.py`
- Test: `backend/tests/test_ai_screener.py`, `backend/tests/ai_scoring/`

- [ ] **Step 1: Read the three prescribed worker changes**

Run: `sed -n 170,200p backend/workers/ai_screener/handler.py`
The comment block prescribes exactly: (1) delete the `if application_track == "sip"` early-return block, (2) change the hardcoded `tir_applications` SELECT to `f"{application_track}_applications"`, (3) add the SQS publish in the SIP submit router. Follow it.

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_ai_screener.py` (follow its existing stub-mode test pattern — it tests the handler with `AI_STUB=true`):

```python
def test_handler_processes_sip_track_in_stub_mode(monkeypatch, fake_supabase_sip):
    """SIP messages must score (stub), not early-return."""
    # fake_supabase_sip: same fixture style as the existing TIR handler tests,
    # but seeds sip_applications with one submitted row (id "sip-app-1",
    # status "ai_screening", plus sip_trl/sip_traction/problem/solution columns).
    monkeypatch.setenv("AI_STUB", "true")
    from workers.ai_screener import handler
    event = {"Records": [{"messageId": "m1", "body":
        '{"application_id": "sip-app-1", "application_track": "sip"}'}]}
    result = handler.lambda_handler(event, None)
    assert result["batchItemFailures"] == []
    upserts = [p for (t, p) in fake_supabase_sip.upserts if t == "ai_screening"]
    assert upserts and upserts[-1]["application_track"] == "sip"

def test_sip_submit_publishes_to_sqs(client, monkeypatch):
    """Mirror of the TIR submit→publish test — assert sqs_publisher.publish
    is called with ("…", "sip") after a successful SIP submit."""
    calls = []
    monkeypatch.setattr("app.routers.sip_applications.sqs_publisher",
                        SimpleNamespace(publish=lambda i, t: calls.append((i, t))))
    # ...drive a valid SIP submit using the fixture pattern from
    # tests/test_applications.py's submit tests adapted to sip_applications...
    assert calls and calls[0][1] == "sip"
```

(Adapt fixture names to what `test_ai_screener.py` actually defines — copy its existing TIR handler test wholesale and switch the track/table.)

- [ ] **Step 3: Run to verify failures**

Run: `cd backend && python -m pytest tests/test_ai_screener.py -x -q -k sip`
Expected: FAIL (handler early-returns SIP; no publish call in SIP submit).

- [ ] **Step 4: Implement the unblock + evidence adapter**

4a. `handler.py`: apply the 3 prescribed changes (delete SIP block; `table = f"{application_track}_applications"` — line ~150 already does this in `_load`; confirm the remaining hardcoded `tir_applications` SELECT near the comment and parameterize it).

4b. `runner.py`: delete lines 97-98 (`if track != "tir": raise ValueError(...)`).

4c. `ai_screening.py` router: delete the 422 guard (lines 49-53).

4d. `sip_applications.py`: in the submit endpoint, after the status flip succeeds, add (mirroring `applications.py:717`):

```python
    sqs_publisher.publish(submitted["id"], "sip")
```

with `from ..services import sqs_publisher` at the top if missing.

4e. Create `backend/app/services/ai_scoring/tracks/sip_evidence.py`:

```python
"""SIP evidence mapper — PROVISIONAL_V0 (2026-06-12).

Maps a sip_applications row into the evidence dict consumed by the scoring
graph. Mirrors the TIR extractor's output keys so downstream nodes need no
changes. EVERYTHING in this file is provisional: field weighting, inclusion
choices, and phrasing will be revisited when the SIP rubric is finalized.
Search for PROVISIONAL_V0 to find every site to revise.
"""

def sip_application_evidence(app_row: dict) -> dict:
    """PROVISIONAL_V0 — assemble SIP evidence text blocks."""
    return {
        "problem": app_row.get("problem_describe") or "",
        "solution": "\n\n".join(filter(None, [
            app_row.get("solution_describe"),
            app_row.get("solution_core_tech"),
            app_row.get("solution_contrarian_insight"),
        ])),
        "execution": "\n\n".join(filter(None, [
            app_row.get("execution_milestone"),
            app_row.get("execution_infrastructure"),
            app_row.get("execution_will_break"),
        ])),
        # PROVISIONAL_V0: traction is SIP's strongest signal — surfaced as its
        # own block so score_all_signals prompts can reference it.
        "traction": "\n\n".join(filter(None, [
            f"Traction level: {app_row.get('sip_traction') or 'unknown'}",
            app_row.get("sip_traction_details"),
        ])),
        "company_facts": "\n".join(filter(None, [
            f"Incorporated: {app_row.get('sip_incorporated') or 'unknown'}",
            f"TRL: {app_row.get('sip_trl') or 'unknown'}",
            f"DPIIT: {app_row.get('basic_dpiit_registered') or 'unknown'}",
            f"Founders on cap table: {len(app_row.get('sip_founders') or [])}",
        ])),
    }
```

4f. In `nodes/extract_evidence.py`, branch on `state["track"]` (the runner already puts `track` in the initial state — verify with `grep -n '"track"' backend/app/services/ai_scoring/runner.py`): when `sip`, build the evidence dict from `sip_application_evidence(application_row)` and append the `traction` + `company_facts` blocks to the evidence text the LLM sees. Tag the insertion with `# PROVISIONAL_V0`.

4g. Caps: in `backend/app/services/ai_scoring/caps.py`, add (matching the existing rule structure in that file):

```python
# PROVISIONAL_V0 (SIP): pre-incorporation or TRL ≤ 3 should not clear the bar.
# Cap overall at 4.0 and flag for human review. Revisit with the SIP rubric.
```

with a rule keyed on `track == "sip"` reading `sip_incorporated`/`sip_trl` from the application row — follow the exact registration pattern of the existing TIR caps in that file.

- [ ] **Step 5: Run the AI suites**

Run: `cd backend && python -m pytest tests/test_ai_screener.py tests/ai_scoring/ -x -q`
Expected: all PASS (stub mode — no OpenRouter spend).

- [ ] **Step 6: Backfill script** — create `scripts/backfill_sip_ai_scores.py` modeled on the existing `scripts/` backfill for TIR (see `tests/test_backfill_tir_scores.py` for its contract): iterate submitted `sip_applications` without an `ai_screening` row, call `sqs_publisher.publish(id, "sip")`, sleep 1s between publishes (reserved concurrency 10 absorbs bursts; this keeps OpenRouter QPS polite), `--dry-run` flag prints without publishing. Add `tests/test_backfill_sip_scores.py` mirroring the TIR backfill test.

- [ ] **Step 7: Commit**

```bash
git add backend/workers/ai_screener/ backend/app/services/ai_scoring/ backend/app/routers/ai_screening.py backend/app/routers/sip_applications.py scripts/backfill_sip_ai_scores.py backend/tests/
git commit -m "feat(ai): enable SIP scoring end-to-end (PROVISIONAL_V0 prompts/caps) + backfill script"
```

---

### Task 11: Frontend — reviewerApi seam + useAsync

**Files:**
- Modify: `frontend/src/lib/reviewerApi.js`
- Create: `frontend/src/hooks/useAsync.js`
- Test: `frontend/src/lib/__tests__/reviewerApi.test.js`

- [ ] **Step 1: Write the failing test** (follow the existing test style in `frontend/src/lib/__tests__/` — they mock `api.js`):

```javascript
import { describe, it, expect, vi } from "vitest";
vi.mock("../api.js", () => ({
  api: { get: vi.fn(async (p) => ({ path: p })), post: vi.fn(), patch: vi.fn() },
}));
import { api } from "../api.js";
import { reviewerApi } from "../reviewerApi.js";

describe("reviewerApi v2 seam", () => {
  it("getQueue hits /reviewer/queue", async () => {
    await reviewerApi.getQueue();
    expect(api.get).toHaveBeenCalledWith("/reviewer/queue");
  });
  it("getContent hits the content endpoint", async () => {
    await reviewerApi.getContent("tir", "app-1");
    expect(api.get).toHaveBeenCalledWith("/reviewer/applications/tir/app-1/content");
  });
  it("getHistory and getRubric hit their endpoints", async () => {
    await reviewerApi.getHistory();
    await reviewerApi.getRubric("sip");
    expect(api.get).toHaveBeenCalledWith("/reviewer/history");
    expect(api.get).toHaveBeenCalledWith("/reviewer/rubric?track=sip");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd frontend && npm test -- reviewerApi` → FAIL (methods missing).

- [ ] **Step 3: Implement** — append to the existing `reviewerApi` object in `frontend/src/lib/reviewerApi.js` (keep all existing methods untouched):

```javascript
  getQueue: () => api.get("/reviewer/queue"),
  getContent: (track, id) => api.get(`/reviewer/applications/${track}/${id}/content`),
  getHistory: () => api.get("/reviewer/history"),
  getRubric: (track) => api.get(`/reviewer/rubric?track=${track}`),
```

Create `frontend/src/hooks/useAsync.js` — port the hook verbatim from the prototype (`REVIEWER-UI/os/api.js:252-265`), converted to an ES module:

```javascript
import { useState, useRef, useCallback, useEffect } from "react";

// Generic async hook used by every reviewer screen (ported from the
// REVIEWER-UI prototype seam). Returns { loading, data, error, reload }.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const idRef = useRef(0);
  const run = useCallback(() => {
    const id = ++idRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => { if (idRef.current === id) setState({ loading: false, data, error: null }); },
      (error) => { if (idRef.current === id) setState({ loading: false, data: null, error }); },
    );
  }, deps || []);
  useEffect(run, deps || []);
  return { ...state, reload: run };
}
```

- [ ] **Step 4: Run frontend tests** — `cd frontend && npm test -- reviewerApi` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/reviewerApi.js frontend/src/lib/__tests__/reviewerApi.test.js frontend/src/hooks/useAsync.js
git commit -m "feat(frontend): reviewerApi v2 methods (queue/content/history/rubric) + useAsync hook"
```

---

### Task 12: Frontend — port the prototype screens

**Files (create):**
- `frontend/src/pages/reviewer/v2/ReviewerPortal.jsx` (shell: topbar + tab routing)
- `frontend/src/pages/reviewer/v2/ReviewerDashboard.jsx`
- `frontend/src/pages/reviewer/v2/ReviewerQueue.jsx`
- `frontend/src/pages/reviewer/v2/ReviewerEval.jsx` (eval form + FullApplicationView + RubricModal)
- `frontend/src/pages/reviewer/v2/ReviewerHistory.jsx`
- `frontend/src/styles/reviewer-portal.css`
**Files (modify):**
- `frontend/src/router.jsx` (replace reviewer routes)

**Port source:** `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/REVIEWER-UI/os/reviewer.jsx` (1387 lines — components: `ReviewerApp`, `ReviewerTopbar`, `ReviewerDashboard`, `ReviewerQueue`, `ReviewerEval`/`ReviewerEvalForm`, `FullApplicationView`, `RubricModal`/`RubricInline`, `ReviewerHistory`) and `os/styles.css`.

This task is a mechanical port with five precise transformation rules — apply them to every component:

1. **Module conversion:** each `window.X = ...` component becomes an exported function in the file listed above; `React.useState` → imported hooks; load-order globals (`window.APP_DETAIL`, `window.OS_DATA`) are deleted — data arrives via props from `useAsync` calls.
2. **Seam swap:** every `window.ReviewerAPI.method(...)` call becomes `reviewerApi.method(...)` with this mapping (the seam signatures were designed for this — components don't change shape):
   - `getMe()` → `useAuth()` user (name/email from `/auth/me`; initials derived client-side; cohort string is the constant `"TIR + VIP cohort 2026"`).
   - `getQueue()` → `reviewerApi.getQueue()` (server shape already matches the canonical QueueItem — delete `buildReviewerQueue`, `QUEUE_ITEM_*` arrays, `appIdOf`).
   - `getEvalScreen(idx, source)` → `reviewerApi.getContent(track, appId)` — **navigation is by `(track, appId)` route params now, not array index**; the `source: 'queue' | 'history'` distinction collapses because production keys evaluations by review row (the history "Edit" routes to the same eval screen).
   - `saveEvaluation(appId, draft)` → first save `reviewerApi.submitReview({...draft, draft: true})` (POST), then `reviewerApi.patchReview(reviewId, {...})` for subsequent autosaves. Payload field mapping: `scores.problem→score_problem`, `scores.solution→score_solution`, `scores.tech→score_tech`, `scores.founders→score_founders`, `scores.commit→score_commitment`, `notes→quick_notes`, `disagreements→disagree_with_ai`, `flags→flags`, `recommendation→recommendation`.
   - `submitEvaluation(...)` → `reviewerApi.patchReview(reviewId, {...payload, draft: false})` (or POST with `draft:false` if no draft exists yet).
   - `getHistory()` → `reviewerApi.getHistory()`.
   - `signOut()` → the app's existing sign-out from `useAuth`.
3. **Countdown:** delete the `timeLeft = 3240` mount timer in `ReviewerEvalForm`; derive remaining seconds from `editWindowExpiresAt` (server) vs `Date.now()`, ticking locally. When expired → fields locked, Submit disabled, "Re-open" hidden (matches backend 423).
4. **Routes** (in `router.jsx`, replacing the three existing reviewer routes and their imports — delete `ReviewerAppShell`/`ReviewerInboxPage`/`ReviewerCompletedPage`/`ReviewerScoringPage` route entries; leave the old files on disk until Task 13 cleanup):

```jsx
<Route path="/reviewer" element={<ProtectedRoute><ReviewerPortal tab="dashboard" /></ProtectedRoute>} />
<Route path="/reviewer/queue" element={<ProtectedRoute><ReviewerPortal tab="queue" /></ProtectedRoute>} />
<Route path="/reviewer/eval/:track/:appId" element={<ProtectedRoute><ReviewerPortal tab="eval" /></ProtectedRoute>} />
<Route path="/reviewer/history" element={<ProtectedRoute><ReviewerPortal tab="history" /></ProtectedRoute>} />
```

5. **Styles:** copy `os/styles.css` → `frontend/src/styles/reviewer-portal.css`; delete its `:root` font/color token redefinitions that collide with `colors_and_type.css` (keep portal-specific classes); import it once in `ReviewerPortal.jsx`. The Google-Fonts `<link>` and CDN script tags from the prototype's `index.html` are NOT ported (fonts already loaded app-wide; React comes from the bundle).

- [ ] **Step 1:** Port `ReviewerPortal.jsx` (shell from `ReviewerApp` + `ReviewerTopbar`) + `reviewer-portal.css`; wire routes. Run `cd frontend && npm run build` → must compile.
- [ ] **Step 2:** Port `ReviewerDashboard.jsx` against `reviewerApi.getQueue()` (all tiles/charts derive from queue rows — the prototype's COMPS weights stay as display constants). Build passes.
- [ ] **Step 3:** Port `ReviewerQueue.jsx` (filters/search/CSV export operate on the queue payload; row click → `navigate(\`/reviewer/eval/${row.track}/${row.id}\`)`). Build passes.
- [ ] **Step 4:** Port `ReviewerEval.jsx` (eval form + `FullApplicationView` rendering `content.fields`/`content.sections`/`content.aiSummary`/`content.attachments` + rubric modal fed by `reviewerApi.getRubric(track)`; autosave debounced 800 ms via the seam mapping above; mandatory-notes gate kept). Build passes.
- [ ] **Step 5:** Port `ReviewerHistory.jsx` (rows from `getHistory()`; "✎ Edit" enabled only when `editWindowExpiresAt > now`, routing to the eval screen). Build passes.
- [ ] **Step 6:** Run the full frontend suite + build: `cd frontend && npm test && npm run build` → PASS.
- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/reviewer/v2/ frontend/src/styles/reviewer-portal.css frontend/src/router.jsx
git commit -m "feat(frontend): reviewer portal v2 — dashboard/queue/eval/history wired to real APIs"
```

---

### Task 13: Frontend cleanup + smoke in the browser

**Files:**
- Delete: `frontend/src/pages/reviewer/ReviewerAppShell.jsx`, `ReviewerInboxPage.jsx`, `ReviewerCompletedPage.jsx`, `ReviewerScoringPage.jsx` and their now-unreferenced tests/helpers (`inboxCardStates.js`, `scoring/`, `review/` — verify with grep that nothing else imports them first)
- Modify: anything still importing them (`grep -rn "ReviewerInboxPage\|ReviewerAppShell\|ReviewerScoringPage\|ReviewerCompletedPage" frontend/src/`)

- [ ] **Step 1:** Grep for references; delete the dead files; fix imports. `npm test && npm run build` → PASS.
- [ ] **Step 2:** Local smoke: run backend (`cd backend && uvicorn app.main:app --port 8000`) with staging Supabase env + `cd frontend && npm run dev`; sign in as the staging reviewer test user; verify: queue renders with AI bars, eval screen shows real application content, autosave fires PATCH (network tab), submit locks with countdown, history row appears.
- [ ] **Step 3: Commit**

```bash
git add -A frontend/src
git commit -m "chore(frontend): remove superseded reviewer v1 pages"
```

---

### Task 14: Staging rehearsal

**No code — operational checklist. Do NOT touch production.**

- [ ] **Step 1:** Apply `backend/migrations/022_reviewer_portal_v2.sql` to STAGING Supabase (`exqmxvdtcsvpgtftwjml`) via SQL Editor. Verify: `select column_name from information_schema.columns where table_name='reviews' and column_name='flags';` returns one row; same for `reviewer_assignments.due_at`.
- [ ] **Step 2:** Deploy backend to staging from THIS worktree: `cd infra/sam && ./deploy-staging.sh` (sources `backend/.env.staging`). Never flip HEAD during the build.
- [ ] **Step 3:** Push `reviewer_final` and point a Vercel preview at it (or merge to the `staging` branch per the existing staging workflow); set `VITE_API_BASE_URL` to the staging API URL.
- [ ] **Step 4:** End-to-end on staging with the 3 pre-created test users: leadership assigns (new endpoint) → reviewer sees queue → opens content → drafts (autosave) → submits → app auto-transitions to `evaluated` when all reviewers done → history shows variance. SIP: submit a SIP app → worker scores it (check `ai_screening` row + DLQ empty) → SIP row shows AI scores in queue.
- [ ] **Step 5:** Record results in `docs/superpowers/specs/2026-06-12-reviewer-portal-production-design.md` under a new "Staging rehearsal" appendix (date, pass/fail per flow, bugs found). Commit.

---

### Task 15: Production cutover runbook (execute ONLY with explicit user go-ahead)

- [ ] **Step 1:** Cut the release branch: `git checkout -b release/reviewer-portal-v1 reviewer_final` (new worktree).
- [ ] **Step 2 (pre-window, zero-risk):** Apply migration 022 to PROD Supabase (`xtmszlpwgbyoumalgbhs`) — additive, unused by running code. Run `sam build --use-container --config-env production` from the release worktree.
- [ ] **Step 3 (window open, target ≤15 min):** `cd infra/sam && ./deploy-prod.sh` (~5–8 min) → merge/promote release branch to the Vercel production branch (~2 min) → smoke: leadership login → assign test app → reviewer login → queue → submit (~3 min).
- [ ] **Step 4 (rollback if smoke fails):** redeploy previous Lambda commit from a clean worktree of `release/sip-launch-v1`; Vercel instant rollback. Schema stays (additive, harmless).
- [ ] **Step 5 (post-window):** run `python scripts/backfill_sip_ai_scores.py` (watch DLQ alarm); seed real reviewer accounts via `/admin/users`; fast-forward `release/sip-launch-v1` to the release branch so the prod branch reflects reality; notify the admin_final session to rebase.

---

## Self-review notes (completed)

- **Spec coverage:** §3→Task 1; §4.1→Task 5; §4.2→Task 6; §4.3→Task 7; §4.4→Tasks 2-4; §4.5→Task 8; §4.6→Task 9; §4.7→Task 3 (notes/flags) + Task 3.3b (disagreement check — see below); §5→Task 10; §6→Tasks 11-13; §7→Tasks 14-15.
- **Disagreement-reason validation (spec §4.7):** enforced client-side in Task 12 Step 4 (eval form blocks submit when |score−AI|>1.0 without a reason — port the prototype's existing field-error UI) and server-side as part of Task 3's `_validate_notes` sibling: add `_validate_disagreements(body, ai_row)` called in `submit_review` when an `ai_screening` row exists — same 422 pattern, code `disagreement_reason_required`. Include it in Task 3 Step 3b implementation and add one test mirroring `test_submit_requires_notes`.
- **Type consistency:** queue/history/content all expose `editWindowExpiresAt` = `locked_at`; seam maps `commit→score_commitment` everywhere; `ai.solution` always sources `score_completeness` (ai_screening) while review payloads use `score_solution` (reviews) — verified against both tables' real columns.
- **Rubric anchors:** marked as verbatim-transcription instructions with a grep done-check (not shippable placeholders).
