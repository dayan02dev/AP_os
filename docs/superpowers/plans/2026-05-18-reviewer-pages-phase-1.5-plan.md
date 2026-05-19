# Reviewer pages (Phase 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reviewer experience that Phase 1 deferred — Inbox, Scoring page (three render states), and Completed history — closing spec §14.3 and §14.4.

**Architecture:** New FastAPI router `backend/app/routers/reviewer.py` exposing `/reviewer/*`. New React pages under `frontend/src/pages/reviewer/` that **copy** (don't import) the leadership review chrome to avoid merge conflicts with the parallel UI-polish session. Anti-anchoring privacy boundary is enforced server-side: `GET /reviewer/applications/{track}/{id}` returns `ai_screening: null` until the caller has a submitted review.

**Tech Stack:** FastAPI + Supabase (Python). React 18 + Vite + react-router. Vitest + RTL + MSW for frontend tests. pytest + FakeSupabase pattern for backend tests.

**Branch:** `feature/reviewer-screens` (worktree at `.claude/worktrees/feature-reviewer-screens`). Base: `origin/staging-role_based_dashboard`.

**Design doc:** `docs/superpowers/specs/2026-05-18-reviewer-pages-phase-1.5-design.md`

---

## File Structure

### Backend (new)
- `backend/app/routers/reviewer.py` — all `/reviewer/*` endpoints
- `backend/app/services/reviewer_query.py` — DB reads (inbox list, completed list, my-review probe)
- `backend/tests/test_reviewer.py` — unit tests for all endpoints

### Backend (modified)
- `backend/app/main.py` — register `reviewer.router`
- `backend/app/services/state_machine.py` — add `auto_transition_to_evaluated_if_complete()` helper
- `backend/app/services/email_service.py` — add `send_assignment_declined()` template (already may exist; check first)

### Frontend (new)
- `frontend/src/pages/reviewer/ReviewerAppShell.jsx`
- `frontend/src/pages/reviewer/ReviewerInboxPage.jsx`
- `frontend/src/pages/reviewer/ReviewerCompletedPage.jsx`
- `frontend/src/pages/reviewer/ReviewerScoringPage.jsx`
- `frontend/src/pages/reviewer/inboxCardStates.js`
- `frontend/src/pages/reviewer/review/` — verbatim copies of `pages/leadership/review/{ReviewHeader,ApplicationTab,QuestionBlock,SectionBlock,applicationSchemas,answers/}.jsx|js`
- `frontend/src/pages/reviewer/scoring/ReviewerScoringPanel.jsx`
- `frontend/src/pages/reviewer/scoring/ScoreSegmentInput.jsx`
- `frontend/src/pages/reviewer/scoring/RecommendationInput.jsx`
- `frontend/src/pages/reviewer/scoring/EditWindowCountdown.jsx`
- `frontend/src/pages/reviewer/scoring/AIComparisonView.jsx`
- `frontend/src/pages/reviewer/scoring/DeclineAssignmentModal.jsx`
- `frontend/src/lib/reviewerApi.js`
- `frontend/src/styles/reviewer.css`

### Frontend (modified)
- `frontend/src/router.jsx` — register reviewer routes, remove `ReviewerInboxStub` import
- `frontend/src/pages/reviewer/ReviewerInboxStub.jsx` — delete after migration

### Tests (new)
- `frontend/src/pages/reviewer/__tests__/ReviewerInboxPage.test.jsx`
- `frontend/src/pages/reviewer/__tests__/DeclineAssignmentModal.test.jsx`
- `frontend/src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx`
- `frontend/src/pages/reviewer/__tests__/ScoreSegmentInput.test.jsx`
- `frontend/src/pages/reviewer/__tests__/EditWindowCountdown.test.jsx`
- `frontend/src/pages/reviewer/__tests__/ReviewerCompletedPage.test.jsx`

---

## Task 1: Backend scaffolding — router file + register + first test

**Files:**
- Create: `backend/app/routers/reviewer.py`
- Modify: `backend/app/main.py` (add `include_router`)
- Create: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_reviewer.py`:

```python
"""Tests for the reviewer endpoints (Phase 1.5).

Mirrors the FakeSupabase pattern used in test_leadership_writes.py:
  - _FakeAdminClient + _FakeQuery for table mocking
  - app.dependency_overrides[get_current_user] for auth
  - monkeypatch on get_admin_client + write_audit

Coverage matrix (this file builds up across Tasks 1-7):
  * /reviewer/assignments — inbox shape, filtering rules
  * /reviewer/applications/{track}/{id} — privacy boundary
  * /reviewer/reviews — submit, draft, validation, auto-transition
  * /reviewer/reviews/{id} — 423 lock, edit-within-window
  * /reviewer/assignments/{id}/decline — happy path + audit
  * /reviewer/reviews — completed list filter
  * /reviewer/reviews/mine — probe endpoint
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.deps import get_current_user
from app.main import app


def test_reviewer_router_registered(client):
    """Smoke test: the router is wired into the app."""
    # Hitting the route without auth should 401, not 404.
    r = client.get("/reviewer/assignments")
    assert r.status_code in (401, 403), f"got {r.status_code}; route may not be registered"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_reviewer.py::test_reviewer_router_registered -v`
Expected: FAIL with `404` (route not registered yet).

- [ ] **Step 3: Create the reviewer router**

Create `backend/app/routers/reviewer.py`:

```python
"""Reviewer endpoints (Phase 1.5).

Every endpoint guarded by `require_capability(...)`. Mutations append to
`audit_log_v2`. Privacy boundary: GET /reviewer/applications/{track}/{id}
returns ai_screening: null unless the caller has a submitted review.

Routes (built up across Tasks 1-7 of the implementation plan):

    GET    /reviewer/assignments                       inbox
    GET    /reviewer/applications/{track}/{id}         app detail (AI stripped)
    GET    /reviewer/reviews/mine?application_id=...   probe
    GET    /reviewer/reviews?mine=true&locked=true     completed list
    POST   /reviewer/reviews                           submit (or draft)
    PATCH  /reviewer/reviews/{review_id}               edit (423 after lock)
    POST   /reviewer/assignments/{id}/decline          decline with reason
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends

from ..rbac import require_capability

log = logging.getLogger(__name__)

router = APIRouter(prefix="/reviewer", tags=["reviewer"])


@router.get(
    "/assignments",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def list_assignments() -> dict:
    """Placeholder — fully implemented in Task 2."""
    return {"assignments": []}
```

- [ ] **Step 4: Register the router**

Modify `backend/app/main.py` — locate the section where leadership/admin routers are imported and included, add:

```python
from .routers import reviewer  # noqa: E402  (existing pattern)

# ... in the app setup ...
app.include_router(reviewer.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && pytest tests/test_reviewer.py::test_reviewer_router_registered -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/reviewer.py backend/app/main.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): scaffold /reviewer router + first smoke test"
```

---

## Task 2: GET /reviewer/assignments — inbox payload

**Files:**
- Modify: `backend/app/routers/reviewer.py`
- Create: `backend/app/services/reviewer_query.py`
- Modify: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write failing tests for the inbox shape**

Append to `backend/tests/test_reviewer.py`:

```python
# ─── Fake client (copied from test_leadership_writes; kept self-contained
#     so the file is readable without cross-file references) ─────────────


class _FakeQuery:
    def __init__(self, parent, name: str):
        self._parent = parent
        self._name = name
        self._mode = "select"
        self._payload: Any = None
        self._eqs: list[tuple[str, Any]] = []
        self._is_nulls: list[str] = []
        self._not_nulls: list[str] = []

    def select(self, *_a, **_k):  return self
    def order(self, *_a, **_k):   return self
    def limit(self, *_a, **_k):   return self
    def in_(self, *_a, **_k):     return self
    def or_(self, *_a, **_k):     return self
    def range(self, *_a, **_k):   return self
    def neq(self, *_a, **_k):     return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def is_(self, col, val):
        if val is None:
            self._is_nulls.append(col)
        return self

    def not_(self):
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        self._parent.inserts.append((self._name, payload))
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        self._parent.updates.append((self._name, payload, list(self._eqs)))
        return self

    def execute(self):
        if self._mode in ("insert", "update"):
            data = self._payload if isinstance(self._payload, list) else (
                [self._payload] if self._payload else [{"ok": True}]
            )
            return SimpleNamespace(data=data, count=len(data))
        rows = self._parent.tables.get(self._name, [])
        # Apply eq filters
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        return SimpleNamespace(data=rows, count=len(rows))


class _FakeAdminClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables = tables or {}
        self.inserts: list[tuple[str, Any]] = []
        self.updates: list[tuple[str, Any, list]] = []

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


def _override_user(user_id: str, roles: list[str] = None):
    def _f():
        return {
            "user_id": user_id,
            "email": f"{user_id}@x.com",
            "roles": roles or ["reviewer"],
        }
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _install_db(monkeypatch, tables):
    from app.routers import reviewer as rv
    from app.services import reviewer_query
    fake = _FakeAdminClient(tables=tables)
    monkeypatch.setattr(rv, "get_admin_client", lambda: fake)
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: fake)
    return fake


# ─── GET /reviewer/assignments ─────────────────────────────────────────


def test_inbox_returns_only_my_active_assignments(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    other = "rev-b"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None, "reassigned_to": None,
             "completed_at": None},
            {"id": "a2", "reviewer_user_id": other, "application_id": "app2",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None, "reassigned_to": None,
             "completed_at": None},
            {"id": "a3", "reviewer_user_id": me, "application_id": "app3",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": "2026-05-17T00:00:00Z",
             "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "basic_org": "EdTech Co",
             "answers": {"problem": "AI tutoring for K-12 in rural India"},
             "submitted_at": "2026-05-15T00:00:00Z"},
            {"id": "app2", "basic_org": "X", "answers": {}, "submitted_at": "2026-05-15T00:00:00Z"},
            {"id": "app3", "basic_org": "Y", "answers": {}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "profiles": [
            {"id": "leader-u", "full_name": "Dev Dayan", "email": "dev@artpark.in"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/assignments")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "assignments" in body
    ids = [a["assignment_id"] for a in body["assignments"]]
    assert "a1" in ids
    assert "a2" not in ids  # belongs to another reviewer
    assert "a3" not in ids  # declined


def test_inbox_assignment_shape(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None, "reassigned_to": None,
             "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "basic_org": "EdTech Co",
             "answers": {"problem": "AI tutoring for K-12 in rural India"},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "profiles": [
            {"id": "leader-u", "full_name": "Dev Dayan", "email": "dev@artpark.in"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/assignments")
    assert r.status_code == 200
    a = r.json()["assignments"][0]
    assert a["assignment_id"] == "a1"
    assert a["application_track"] == "tir"
    assert a["app_identifier"].startswith("TIR-")
    assert a["problem_one_liner"].startswith("AI tutoring")
    assert a["assigned_by_display"] == "Dev Dayan"
    assert a["my_review"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "inbox"`
Expected: FAIL — endpoint returns `{"assignments": []}` placeholder.

- [ ] **Step 3: Create the query service**

Create `backend/app/services/reviewer_query.py`:

```python
"""Read queries for the reviewer endpoints. All reads use the admin client
(RLS-bypassing) because authorization is already enforced at the route
layer via require_capability + per-request reviewer_user_id matching.
"""

from __future__ import annotations

from typing import Any

from ..supabase_client import get_admin_client


def _compose_app_identifier(track: str, app_id: str, submitted_at: str | None) -> str:
    prefix = (track or "").upper()
    year = 2026
    if submitted_at:
        try:
            year = int(submitted_at[:4])
        except (ValueError, TypeError):
            pass
    tail = (app_id or "")[:8] or "unknown"
    return f"{prefix}-{year}-{tail}"


def _problem_one_liner(answers: dict | None) -> str:
    if not isinstance(answers, dict):
        return ""
    text = answers.get("problem") or answers.get("problem_statement") or ""
    text = str(text).strip()
    if len(text) > 140:
        return text[:137] + "..."
    return text


def fetch_inbox(reviewer_user_id: str) -> list[dict]:
    """Return the reviewer's active, non-locked assignments with the thin
    application summary the inbox UI needs.

    Filters applied:
      - reviewer_user_id == caller
      - declined_at IS NULL
      - reassigned_to IS NULL
      - my_review either does not exist OR its locked_at > now() (the
        latter check is applied in Python after the join, since the fake
        client doesn't have a `now()` comparison; in production this is
        a single CTE).
    """
    sb = get_admin_client()
    rows = (
        sb.table("reviewer_assignments")
        .select("*")
        .eq("reviewer_user_id", reviewer_user_id)
        .execute()
        .data
    )
    # Filter out declined / reassigned in Python (the fake test client
    # doesn't model IS NULL on chained selects).
    rows = [r for r in rows if r.get("declined_at") is None
            and r.get("reassigned_to") is None]

    # Hydrate each row with its application summary + my_review (if any).
    out = []
    for a in rows:
        track = a["application_track"]
        table = "tir_applications" if track == "tir" else "sip_applications"
        app_row = next(
            (x for x in sb.table(table).select("*").execute().data
             if x["id"] == a["application_id"]),
            None,
        )
        if app_row is None:
            continue

        # my_review lookup
        reviews = sb.table("reviews").select("*").eq(
            "application_id", a["application_id"]
        ).eq("reviewer_user_id", reviewer_user_id).execute().data
        my_review = reviews[0] if reviews else None

        # Filter rule: if review is submitted AND locked, exclude.
        if my_review and my_review.get("locked_at"):
            # Compare against now() in production (SQL); in the fake we
            # let through everything — the test below sets locked_at in
            # the future so the assignment surfaces with my_review set.
            from datetime import datetime, timezone
            try:
                locked_at = datetime.fromisoformat(
                    my_review["locked_at"].replace("Z", "+00:00")
                )
                if locked_at <= datetime.now(timezone.utc):
                    continue
            except (ValueError, TypeError):
                pass

        # assigned_by display name
        assigned_by_display = None
        if a.get("assigned_by"):
            profs = sb.table("profiles").select("*").eq("id", a["assigned_by"]).execute().data
            if profs:
                assigned_by_display = profs[0].get("full_name") or profs[0].get("email")

        out.append({
            "assignment_id": a["id"],
            "application_id": a["application_id"],
            "application_track": track,
            "app_identifier": _compose_app_identifier(
                track, a["application_id"], app_row.get("submitted_at"),
            ),
            "industry": app_row.get("basic_org") or "—",
            "problem_one_liner": _problem_one_liner(app_row.get("answers")),
            "assigned_at": a["assigned_at"],
            "assigned_by_display": assigned_by_display,
            "my_review": (
                {
                    "review_id": my_review["id"],
                    "submitted_at": my_review.get("submitted_at"),
                    "locked_at": my_review.get("locked_at"),
                }
                if my_review else None
            ),
        })
    return out
```

- [ ] **Step 4: Wire the service into the router**

Modify `backend/app/routers/reviewer.py` — replace the `list_assignments` placeholder:

```python
from ..deps import get_current_user
from ..supabase_client import get_admin_client
from ..services import reviewer_query


@router.get(
    "/assignments",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def list_assignments(user: dict = Depends(get_current_user)) -> dict:
    return {
        "assignments": reviewer_query.fetch_inbox(user["user_id"]),
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "inbox"`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/reviewer.py backend/app/services/reviewer_query.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): GET /reviewer/assignments returns inbox payload"
```

---

## Task 3: GET /reviewer/applications/{track}/{id} — the privacy boundary

**Files:**
- Modify: `backend/app/routers/reviewer.py`
- Modify: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write failing tests for the privacy boundary**

Append to `backend/tests/test_reviewer.py`:

```python
# ─── GET /reviewer/applications/{track}/{id} ───────────────────────────


def test_app_detail_strips_ai_when_no_submitted_review(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None,
             "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [
            {"id": "ai1", "application_id": "app1", "application_track": "tir",
             "score_problem": 8, "score_solution": 7, "score_overall": 7.5,
             "summary": "Strong on problem framing."},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/applications/tir/app1")
    assert r.status_code == 200
    body = r.json()
    assert body["ai_screening"] is None, "AI must be stripped before submit"


def test_app_detail_includes_ai_after_submit(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None,
             "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "application_id": "app1", "application_track": "tir",
             "reviewer_user_id": me, "submitted_at": "2026-05-17T10:00:00Z",
             "locked_at": "2026-05-17T11:00:00Z",
             "score_problem": 6, "recommendation": "maybe"},
        ],
        "ai_screening": [
            {"id": "ai1", "application_id": "app1", "application_track": "tir",
             "score_problem": 8, "score_overall": 7.5, "summary": "Strong."},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/applications/tir/app1")
    assert r.status_code == 200
    body = r.json()
    assert body["ai_screening"] is not None
    assert body["ai_screening"]["score_overall"] == 7.5


def test_app_detail_403_when_not_assigned(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [],  # no assignment for `me`
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/applications/tir/app1")
    assert r.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "app_detail"`
Expected: FAIL — 404 (route not implemented).

- [ ] **Step 3: Add `fetch_application_for_reviewer` service**

Append to `backend/app/services/reviewer_query.py`:

```python
def fetch_application_for_reviewer(
    reviewer_user_id: str, track: str, application_id: str,
) -> dict | None:
    """Return the app payload visible to a reviewer.

    Returns None if the reviewer has no active assignment for this app
    (the router converts None → 403).

    The `ai_screening` key is always present in the response dict but is
    None unless the reviewer has a submitted (non-draft) review. This is
    the load-bearing privacy boundary — see spec §6.3.
    """
    sb = get_admin_client()

    # Active assignment check
    assignment_rows = (
        sb.table("reviewer_assignments")
        .select("*")
        .eq("application_id", application_id)
        .eq("application_track", track)
        .eq("reviewer_user_id", reviewer_user_id)
        .execute()
        .data
    )
    active = [
        a for a in assignment_rows
        if a.get("declined_at") is None and a.get("reassigned_to") is None
    ]
    if not active:
        return None
    assignment = active[0]

    # Application body
    table = "tir_applications" if track == "tir" else "sip_applications"
    app_rows = sb.table(table).select("*").eq("id", application_id).execute().data
    if not app_rows:
        return None
    application = app_rows[0]

    # My review (if any)
    review_rows = (
        sb.table("reviews")
        .select("*")
        .eq("application_id", application_id)
        .eq("reviewer_user_id", reviewer_user_id)
        .execute()
        .data
    )
    my_review = review_rows[0] if review_rows else None

    # ── Privacy boundary ──────────────────────────────────────────
    ai_screening = None
    if my_review and my_review.get("submitted_at"):
        ai_rows = (
            sb.table("ai_screening")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .execute()
            .data
        )
        if ai_rows:
            ai_screening = ai_rows[0]

    return {
        "application": application,
        "assignment": {
            "assignment_id": assignment["id"],
            "assigned_at": assignment["assigned_at"],
        },
        "my_review": my_review,
        "ai_screening": ai_screening,
    }
```

- [ ] **Step 4: Add the endpoint to the router**

Append to `backend/app/routers/reviewer.py`:

```python
from fastapi import HTTPException, status as http_status


@router.get(
    "/applications/{track}/{application_id}",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_application_for_reviewer(
    track: str,
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    if track not in ("tir", "sip"):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_track", "message": "Track must be 'tir' or 'sip'."},
        )

    payload = reviewer_query.fetch_application_for_reviewer(
        user["user_id"], track, application_id,
    )
    if payload is None:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "not_assigned",
                    "message": "You have no active assignment for this application."},
        )
    return payload
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "app_detail"`
Expected: PASS (all 3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/reviewer.py backend/app/services/reviewer_query.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): GET /reviewer/applications/{track}/{id} with anti-anchoring AI strip"
```

---

## Task 4: POST /reviewer/reviews — submit + auto-transition to evaluated

**Files:**
- Modify: `backend/app/routers/reviewer.py`
- Modify: `backend/app/services/state_machine.py`
- Modify: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_reviewer.py`:

```python
# ─── POST /reviewer/reviews ────────────────────────────────────────────


_VALID_SUBMIT = {
    "application_id": "app1",
    "application_track": "tir",
    "assignment_id": "a1",
    "score_problem": 7,
    "score_solution": 5,
    "score_tech": 6,
    "score_founders": 8,
    "score_commitment": 7,
    "recommendation": "maybe",
    "strengths": None,
    "concerns": None,
    "quick_notes": None,
    "draft": False,
}


def _seed_one_assignment(monkeypatch, reviewer_user_id: str, **extra_rows):
    tables = {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": reviewer_user_id,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "status": "under_review",
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [],
        "application_status_log": [],
    }
    for k, v in extra_rows.items():
        tables[k] = v
    return _install_db(monkeypatch, tables)


def test_submit_review_rejects_missing_score(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    del body["score_problem"]
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422


def test_submit_review_rejects_score_out_of_range(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    body["score_solution"] = 11
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422


def test_submit_review_rejects_score_integrity_field(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    body["score_integrity"] = 6
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422


def test_submit_review_writes_row_with_60_min_lock(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T10:00:00Z")
    fake = _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 201, r.text
    # Find the insert into 'reviews'
    review_inserts = [p for n, p in fake.inserts if n == "reviews"]
    assert len(review_inserts) == 1
    row = review_inserts[0]
    assert row["submitted_at"] == "2026-05-18T10:00:00+00:00"
    assert row["locked_at"] == "2026-05-18T11:00:00+00:00"


def test_submit_review_all_reviewers_complete_triggers_evaluated(
    client, monkeypatch, _clear_overrides,
):
    """Closes spec §14.4."""
    me = "rev-a"
    other = "rev-b"
    fake = _seed_one_assignment(
        monkeypatch, me,
        reviewer_assignments=[
            {"id": "a1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
            {"id": "a2", "reviewer_user_id": other,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None,
             "completed_at": "2026-05-17T12:00:00Z"},  # other already done
        ],
    )
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 201, r.text
    # tir_applications should have an update to status=evaluated
    status_updates = [u for n, u, eqs in fake.updates if n == "tir_applications"]
    assert any(u.get("status") == "evaluated" for u in status_updates)


def test_submit_review_partial_completion_does_not_transition(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    other = "rev-b"
    fake = _seed_one_assignment(
        monkeypatch, me,
        reviewer_assignments=[
            {"id": "a1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
            {"id": "a2", "reviewer_user_id": other,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
        ],
    )
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 201, r.text
    status_updates = [u for n, u, eqs in fake.updates if n == "tir_applications"]
    assert not any(u.get("status") == "evaluated" for u in status_updates)


def test_draft_does_not_transition_or_lock(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T10:00:00Z")
    fake = _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    body["draft"] = True
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201
    review_inserts = [p for n, p in fake.inserts if n == "reviews"]
    row = review_inserts[0]
    assert row["submitted_at"] is None
    assert row["locked_at"] is None
    status_updates = [u for n, u, eqs in fake.updates if n == "tir_applications"]
    assert not any(u.get("status") == "evaluated" for u in status_updates)
```

Note: tests use `freezer` fixture from `freezegun` — confirm it's already a dev dependency (look in `backend/pyproject.toml`); if not, install it (Step 2a below).

- [ ] **Step 2a: Confirm freezegun is available**

Run: `cd backend && grep -E "freezegun|pytest-freezer" pyproject.toml requirements*.txt 2>/dev/null`
If not present, add to dev dependencies and install: `pip install pytest-freezer` and add `pytest-freezer` to `pyproject.toml`'s test extras.

- [ ] **Step 2b: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "submit_review or draft"`
Expected: FAIL — endpoint not implemented.

- [ ] **Step 3: Add auto-transition helper to state_machine**

Modify `backend/app/services/state_machine.py` — append at the end:

```python
def auto_transition_to_evaluated_if_complete(
    application_id: str, track: str,
) -> bool:
    """If every active assignment for this app has completed_at set, move
    the app's status from under_review → evaluated. Returns True iff the
    transition fired.

    Idempotent. Safe to call multiple times. Used by the reviewer submit
    endpoint to close spec §14.4.
    """
    from ..supabase_client import get_admin_client
    sb = get_admin_client()

    # Active assignments for this app
    rows = (
        sb.table("reviewer_assignments")
        .select("*")
        .eq("application_id", application_id)
        .eq("application_track", track)
        .execute()
        .data
    )
    active = [r for r in rows
              if r.get("declined_at") is None and r.get("reassigned_to") is None]
    if not active:
        return False  # No assignments — leadership hasn't assigned anyone yet
    if any(r.get("completed_at") is None for r in active):
        return False

    # All complete — transition iff current status is under_review
    table = "tir_applications" if track == "tir" else "sip_applications"
    app_rows = sb.table(table).select("*").eq("id", application_id).execute().data
    if not app_rows:
        return False
    current = app_rows[0].get("status")
    if current != "under_review":
        return False  # Already moved past or rewound; respect existing state

    # Perform the transition
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    sb.table(table).update({"status": "evaluated"}).eq("id", application_id).execute()
    sb.table("application_status_log").insert({
        "application_id": application_id,
        "application_track": track,
        "from_status": "under_review",
        "to_status": "evaluated",
        "changed_by": None,  # system-driven
        "reason": "all reviewers submitted",
        "changed_at": now_iso,
    }).execute()
    return True
```

- [ ] **Step 4: Add the submit endpoint to the router**

Append to `backend/app/routers/reviewer.py`:

```python
from datetime import datetime, timedelta, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, conint
from ..services import state_machine
from ..services.audit import write_audit


_RECOMMENDATIONS = ("yes", "maybe", "no")


class ReviewSubmitBody(BaseModel):
    model_config = ConfigDict(extra="forbid")  # rejects score_integrity et al

    application_id: str
    application_track: Literal["tir", "sip"]
    assignment_id: str
    score_problem: conint(ge=0, le=10) | None = None
    score_solution: conint(ge=0, le=10) | None = None
    score_tech: conint(ge=0, le=10) | None = None
    score_founders: conint(ge=0, le=10) | None = None
    score_commitment: conint(ge=0, le=10) | None = None
    recommendation: Literal["yes", "maybe", "no"] | None = None
    strengths: str | None = None
    concerns: str | None = None
    quick_notes: str | None = None
    draft: bool = False


def _validate_complete(body: ReviewSubmitBody) -> None:
    """Non-draft submits require all 5 scores and recommendation."""
    if body.draft:
        return
    missing: list[str] = []
    for col in ("score_problem", "score_solution", "score_tech",
                "score_founders", "score_commitment"):
        if getattr(body, col) is None:
            missing.append(col)
    if body.recommendation is None:
        missing.append("recommendation")
    if missing:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "incomplete_review", "missing": missing},
        )


@router.post(
    "/reviews",
    status_code=http_status.HTTP_201_CREATED,
    dependencies=[Depends(require_capability("score_app"))],
)
async def submit_review(
    body: ReviewSubmitBody,
    user: dict = Depends(get_current_user),
) -> dict:
    _validate_complete(body)

    # Verify caller has an active assignment for this app
    sb = get_admin_client()
    asg_rows = (
        sb.table("reviewer_assignments")
        .select("*")
        .eq("id", body.assignment_id)
        .execute()
        .data
    )
    if not asg_rows or asg_rows[0]["reviewer_user_id"] != user["user_id"]:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "not_your_assignment"},
        )

    now = datetime.now(timezone.utc)
    submitted_at = None if body.draft else now.isoformat()
    locked_at = None if body.draft else (now + timedelta(minutes=60)).isoformat()

    insert_row = {
        "application_id": body.application_id,
        "application_track": body.application_track,
        "reviewer_user_id": user["user_id"],
        "assignment_id": body.assignment_id,
        "score_problem": body.score_problem,
        "score_solution": body.score_solution,
        "score_tech": body.score_tech,
        "score_founders": body.score_founders,
        "score_commitment": body.score_commitment,
        "recommendation": body.recommendation,
        "strengths": body.strengths,
        "concerns": body.concerns,
        "quick_notes": body.quick_notes,
        "submitted_at": submitted_at,
        "locked_at": locked_at,
    }
    result = sb.table("reviews").insert(insert_row).execute()
    review_row = result.data[0]
    review_id = review_row.get("id")

    if not body.draft:
        # Mark assignment complete
        sb.table("reviewer_assignments").update(
            {"completed_at": now.isoformat()}
        ).eq("id", body.assignment_id).execute()

        # Audit
        write_audit(
            actor_user_id=user["user_id"],
            actor_role="reviewer",
            action_type="submit_review",
            target_table="reviews",
            target_id=review_id,
            after_state={"recommendation": body.recommendation},
        )

        # Auto-transition (closes spec §14.4)
        state_machine.auto_transition_to_evaluated_if_complete(
            body.application_id, body.application_track,
        )

    return {"review": review_row}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "submit_review or draft"`
Expected: PASS (all 7 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/reviewer.py backend/app/services/state_machine.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): POST /reviewer/reviews submit + auto-transition to evaluated"
```

---

## Task 5: PATCH /reviewer/reviews/{id} — edit within 60-min window, 423 after

**Files:**
- Modify: `backend/app/routers/reviewer.py`
- Modify: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_reviewer.py`:

```python
# ─── PATCH /reviewer/reviews/{id} ──────────────────────────────────────


def test_patch_review_within_window_succeeds(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T10:30:00Z")
    fake = _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 5, "recommendation": "maybe"},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 8})
    assert r.status_code == 200, r.text
    updates = [u for n, u, eqs in fake.updates if n == "reviews"]
    assert any(u.get("score_problem") == 8 for u in updates)


def test_patch_review_after_lock_returns_423(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T11:01:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 5, "recommendation": "maybe"},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 8})
    assert r.status_code == 423
    assert r.json()["detail"]["code"] == "review_locked"


def test_patch_review_does_not_extend_lock(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T10:30:00Z")
    fake = _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 5, "recommendation": "maybe"},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 8})
    assert r.status_code == 200
    updates = [u for n, u, eqs in fake.updates if n == "reviews"]
    # No update should touch locked_at
    assert not any("locked_at" in u for u in updates)


def test_patch_review_caller_must_own(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T10:30:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "reviewer_user_id": "rev-b",  # NOT me
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 5, "recommendation": "maybe"},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 8})
    assert r.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "patch_review"`
Expected: FAIL — endpoint not implemented.

- [ ] **Step 3: Add the PATCH endpoint**

Append to `backend/app/routers/reviewer.py`:

```python
class ReviewPatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score_problem: conint(ge=0, le=10) | None = None
    score_solution: conint(ge=0, le=10) | None = None
    score_tech: conint(ge=0, le=10) | None = None
    score_founders: conint(ge=0, le=10) | None = None
    score_commitment: conint(ge=0, le=10) | None = None
    recommendation: Literal["yes", "maybe", "no"] | None = None
    strengths: str | None = None
    concerns: str | None = None
    quick_notes: str | None = None
    draft: bool | None = None  # only meaningful when flipping draft → submitted


@router.patch(
    "/reviews/{review_id}",
    dependencies=[Depends(require_capability("score_app"))],
)
async def patch_review(
    review_id: str,
    body: ReviewPatchBody,
    user: dict = Depends(get_current_user),
) -> dict:
    sb = get_admin_client()
    rows = sb.table("reviews").select("*").eq("id", review_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail={"code": "review_not_found"})
    existing = rows[0]
    if existing["reviewer_user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "not_your_review"})

    # Lock check — only for already-submitted (non-draft) reviews
    locked_at_str = existing.get("locked_at")
    if locked_at_str:
        locked_at = datetime.fromisoformat(locked_at_str.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > locked_at:
            raise HTTPException(
                status_code=423,
                detail={
                    "code": "review_locked",
                    "message": f"Edit window closed at {locked_at.isoformat()}.",
                },
            )

    # Build the patch — only the fields the body actually sent
    patch: dict = {
        k: v for k, v in body.model_dump(exclude_unset=True).items()
        if k != "draft"
    }

    # Draft → submitted transition: set submitted_at + locked_at NOW
    flipping_to_submitted = (
        body.draft is False and existing.get("submitted_at") is None
    )
    now = datetime.now(timezone.utc)
    if flipping_to_submitted:
        patch["submitted_at"] = now.isoformat()
        patch["locked_at"] = (now + timedelta(minutes=60)).isoformat()

    sb.table("reviews").update(patch).eq("id", review_id).execute()

    if flipping_to_submitted:
        # Mark assignment complete + audit + maybe auto-transition
        sb.table("reviewer_assignments").update(
            {"completed_at": now.isoformat()}
        ).eq("id", existing["assignment_id"]).execute()
        write_audit(
            actor_user_id=user["user_id"],
            actor_role="reviewer",
            action_type="submit_review",
            target_table="reviews",
            target_id=review_id,
            after_state={"recommendation": body.recommendation},
        )
        state_machine.auto_transition_to_evaluated_if_complete(
            existing["application_id"], existing["application_track"],
        )

    return {"review_id": review_id, "patched": list(patch.keys())}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "patch_review"`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): PATCH /reviewer/reviews/{id} edit with 423 lock"
```

---

## Task 6: POST /reviewer/assignments/{id}/decline

**Files:**
- Modify: `backend/app/routers/reviewer.py`
- Modify: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_reviewer.py`:

```python
# ─── POST /reviewer/assignments/{id}/decline ───────────────────────────


def test_decline_sets_declined_at_and_reason(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T10:00:00Z")
    fake = _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post(
        "/reviewer/assignments/a1/decline",
        json={"reason": "Not my domain — defer to someone with healthcare context."},
    )
    assert r.status_code == 200, r.text
    updates = [u for n, u, eqs in fake.updates if n == "reviewer_assignments"]
    assert len(updates) == 1
    assert updates[0]["declined_at"] == "2026-05-18T10:00:00+00:00"
    assert "healthcare" in updates[0]["decline_reason"]


def test_decline_requires_min_10_char_reason(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/assignments/a1/decline", json={"reason": "no"})
    assert r.status_code == 422


def test_decline_blocked_when_not_my_assignment(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, "rev-b")  # assigned to someone else
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post(
        "/reviewer/assignments/a1/decline",
        json={"reason": "I shouldn't be able to decline this."},
    )
    assert r.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "decline"`
Expected: FAIL — endpoint not implemented.

- [ ] **Step 3: Add the decline endpoint**

Append to `backend/app/routers/reviewer.py`:

```python
class DeclineBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=10, max_length=2000)


@router.post(
    "/assignments/{assignment_id}/decline",
    dependencies=[Depends(require_capability("decline_assignment"))],
)
async def decline_assignment(
    assignment_id: str,
    body: DeclineBody,
    user: dict = Depends(get_current_user),
) -> dict:
    sb = get_admin_client()
    rows = sb.table("reviewer_assignments").select("*").eq("id", assignment_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail={"code": "assignment_not_found"})
    assignment = rows[0]
    if assignment["reviewer_user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail={"code": "not_your_assignment"})
    if assignment.get("declined_at") is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "already_declined"},
        )

    now = datetime.now(timezone.utc).isoformat()
    sb.table("reviewer_assignments").update({
        "declined_at": now,
        "decline_reason": body.reason,
    }).eq("id", assignment_id).execute()

    write_audit(
        actor_user_id=user["user_id"],
        actor_role="reviewer",
        action_type="decline_assignment",
        target_table="reviewer_assignments",
        target_id=assignment_id,
        after_state={"declined_at": now, "decline_reason": body.reason},
    )

    # Email is best-effort — see spec §8 rule for swallowing Resend failures.
    try:
        from ..services import email_service
        if hasattr(email_service, "send_assignment_declined"):
            email_service.send_assignment_declined(
                application_id=assignment["application_id"],
                application_track=assignment["application_track"],
                reviewer_user_id=user["user_id"],
                reason=body.reason,
            )
    except Exception:
        log.exception("decline email best-effort send failed; ignored")

    return {"assignment_id": assignment_id, "declined_at": now}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "decline"`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): POST /reviewer/assignments/{id}/decline with audit + email"
```

---

## Task 7: GET /reviewer/reviews (completed list) + /reviewer/reviews/mine (probe)

**Files:**
- Modify: `backend/app/routers/reviewer.py`
- Modify: `backend/app/services/reviewer_query.py`
- Modify: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_reviewer.py`:

```python
# ─── GET /reviewer/reviews?mine=true&locked=true ───────────────────────


def test_completed_list_returns_only_my_locked(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-20T10:00:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "Locked one"},
             "submitted_at": "2026-05-15T00:00:00Z"},
            {"id": "app2", "answers": {"problem": "Unlocked one"},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 7, "score_solution": 6, "score_tech": 7,
             "score_founders": 8, "score_commitment": 7, "recommendation": "yes"},
            {"id": "r2", "reviewer_user_id": me, "application_id": "app2",
             "application_track": "tir", "submitted_at": "2026-05-20T09:50:00+00:00",
             "locked_at": "2026-05-20T10:50:00+00:00",  # not yet locked
             "score_problem": 5, "recommendation": "maybe"},
            {"id": "r3", "reviewer_user_id": "rev-b", "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 7, "recommendation": "no"},  # not mine
        ],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews?mine=true&locked=true")
    assert r.status_code == 200
    ids = [x["review_id"] for x in r.json()["reviews"]]
    assert "r1" in ids
    assert "r2" not in ids   # not yet locked
    assert "r3" not in ids   # not mine


def test_completed_list_computes_weighted_overall(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-20T10:00:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "X"},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 8, "score_solution": 6, "score_tech": 7,
             "score_founders": 9, "score_commitment": 5, "recommendation": "yes"},
        ],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews?mine=true&locked=true")
    rows = r.json()["reviews"]
    # Weights: P22 S30 T22 F14 C12 → (8*22 + 6*30 + 7*22 + 9*14 + 5*12) / 100
    # = (176 + 180 + 154 + 126 + 60) / 100 = 696/100 = 6.96
    assert abs(rows[0]["score_overall_mine"] - 6.96) < 0.01


def test_mine_probe_returns_my_review_for_app(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 7, "recommendation": "yes"},
        ],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews/mine?application_id=app1")
    assert r.status_code == 200
    assert r.json()["review"]["id"] == "r1"


def test_mine_probe_returns_null_when_no_review(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [], "tir_applications": [], "sip_applications": [],
        "reviews": [], "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews/mine?application_id=app1")
    assert r.status_code == 200
    assert r.json()["review"] is None


def test_completed_list_requires_mine_true(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [], "tir_applications": [], "sip_applications": [],
        "reviews": [], "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews?locked=true")  # missing mine=true
    assert r.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_reviewer.py -v -k "completed_list or mine_probe"`
Expected: FAIL — endpoints not implemented.

- [ ] **Step 3: Add the completed list + probe to the query service**

Append to `backend/app/services/reviewer_query.py`:

```python
# Score weights per spec §4.3 — keep in lockstep with frontend
# ScoreSegmentInput's display labels and the leadership AI overall calc.
_SCORE_WEIGHTS = {
    "score_problem":    22,
    "score_solution":   30,
    "score_tech":       22,
    "score_founders":   14,
    "score_commitment": 12,
}


def _weighted_overall(review: dict) -> float | None:
    """Returns None iff any required score is missing."""
    total = 0
    for col, w in _SCORE_WEIGHTS.items():
        v = review.get(col)
        if v is None:
            return None
        total += v * w
    return round(total / 100, 2)


def fetch_completed_reviews(
    reviewer_user_id: str, track: str = "all", page: int = 1, page_size: int = 20,
) -> dict:
    """Return the reviewer's locked reviews, paginated, with app context."""
    from datetime import datetime, timezone
    sb = get_admin_client()
    rows = (
        sb.table("reviews")
        .select("*")
        .eq("reviewer_user_id", reviewer_user_id)
        .execute()
        .data
    )
    now = datetime.now(timezone.utc)
    locked_mine = []
    for r in rows:
        locked_at = r.get("locked_at")
        if not locked_at:
            continue
        try:
            t = datetime.fromisoformat(locked_at.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        if t > now:
            continue
        if track != "all" and r.get("application_track") != track:
            continue
        locked_mine.append(r)

    # Sort by submitted_at DESC
    locked_mine.sort(key=lambda x: x.get("submitted_at") or "", reverse=True)

    total = len(locked_mine)
    start = (page - 1) * page_size
    end = start + page_size
    page_rows = locked_mine[start:end]

    # Hydrate with app context
    out: list[dict] = []
    for r in page_rows:
        table = "tir_applications" if r["application_track"] == "tir" else "sip_applications"
        app_rows = sb.table(table).select("*").eq("id", r["application_id"]).execute().data
        if not app_rows:
            continue
        a = app_rows[0]
        out.append({
            "review_id": r["id"],
            "application_id": r["application_id"],
            "application_track": r["application_track"],
            "app_identifier": _compose_app_identifier(
                r["application_track"], r["application_id"], a.get("submitted_at"),
            ),
            "problem_one_liner": _problem_one_liner(a.get("answers")),
            "score_overall_mine": _weighted_overall(r),
            "recommendation": r.get("recommendation"),
            "submitted_at": r.get("submitted_at"),
        })

    return {
        "reviews": out,
        "page": page,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "total": total,
    }


def fetch_my_review_for_application(
    reviewer_user_id: str, application_id: str,
) -> dict | None:
    sb = get_admin_client()
    rows = (
        sb.table("reviews")
        .select("*")
        .eq("reviewer_user_id", reviewer_user_id)
        .eq("application_id", application_id)
        .execute()
        .data
    )
    return rows[0] if rows else None
```

- [ ] **Step 4: Add the two endpoints to the router**

Append to `backend/app/routers/reviewer.py`:

```python
from fastapi import Query


@router.get(
    "/reviews",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def list_reviews(
    mine: bool = Query(False),
    locked: bool = Query(False),
    track: Literal["tir", "sip", "all"] = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    if not mine:
        raise HTTPException(
            status_code=400,
            detail={"code": "mine_required",
                    "message": "Phase 1.5 only exposes self-reviews. Pass mine=true."},
        )
    if not locked:
        raise HTTPException(
            status_code=400,
            detail={"code": "locked_filter_required",
                    "message": "Phase 1.5 list endpoint only returns locked reviews."},
        )
    return reviewer_query.fetch_completed_reviews(
        user["user_id"], track=track, page=page, page_size=page_size,
    )


@router.get(
    "/reviews/mine",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_my_review(
    application_id: str = Query(..., min_length=1),
    user: dict = Depends(get_current_user),
) -> dict:
    row = reviewer_query.fetch_my_review_for_application(
        user["user_id"], application_id,
    )
    return {"review": row}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_reviewer.py -v`
Expected: PASS (all reviewer tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/reviewer.py backend/app/services/reviewer_query.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): GET /reviewer/reviews completed list + GET /reviewer/reviews/mine probe"
```

---

## Task 8: Frontend API client + router wiring + ReviewerAppShell

**Files:**
- Create: `frontend/src/lib/reviewerApi.js`
- Create: `frontend/src/pages/reviewer/ReviewerAppShell.jsx`
- Modify: `frontend/src/router.jsx`
- Delete: `frontend/src/pages/reviewer/ReviewerInboxStub.jsx`
- Create: `frontend/src/styles/reviewer.css`

- [ ] **Step 1: Create reviewerApi.js**

Create `frontend/src/lib/reviewerApi.js`:

```javascript
// Wrapper for /reviewer/* endpoints. Mirrors leadershipApi.js shape.

import { api } from "./api.js";

function buildQuery(params) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries).toString()}`;
}

export const reviewerApi = {
  listAssignments: () => api.get("/reviewer/assignments"),

  getApplication: (track, id) =>
    api.get(`/reviewer/applications/${track}/${id}`),

  getMyReview: (applicationId) =>
    api.get(`/reviewer/reviews/mine?application_id=${encodeURIComponent(applicationId)}`),

  submitReview: (payload) => api.post("/reviewer/reviews", payload),

  patchReview: (reviewId, patch) =>
    api.patch(`/reviewer/reviews/${reviewId}`, patch),

  declineAssignment: (assignmentId, reason) =>
    api.post(`/reviewer/assignments/${assignmentId}/decline`, { reason }),

  listCompletedReviews: (params = {}) =>
    api.get(`/reviewer/reviews${buildQuery({ mine: true, locked: true, ...params })}`),
};
```

- [ ] **Step 2: Create the reviewer CSS file (minimal — just imports the system + adds scoring-panel + score-seg)**

Create `frontend/src/styles/reviewer.css`:

```css
/* Reviewer-surface styles. Imports the design system; adds only the
 * scoring panel + segmented score input. No new tokens, no shadows,
 * no gradients. */

@import "./colors_and_type.css";
@import "./admin.css";  /* re-uses .app-shell, .app-header, .app-rail, .page-head, .card */

/* ── Scoring panel container (right rail on /reviewer/:track/:id/score) ── */
.scoring-panel {
  background: var(--paper);
  border-left: 1px solid var(--line);
  padding: var(--s-6);
  width: 480px;
  flex: 0 0 480px;
  position: sticky;
  top: 73px;
  align-self: start;
  max-height: calc(100vh - 73px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--s-5);
}

.scoring-panel .panel-eyebrow {
  font-family: var(--font-body);
  font-size: var(--t-eyebrow);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-dim);
  font-weight: 600;
}

.scoring-panel .panel-intro {
  font-size: var(--t-body-sm);
  color: var(--ink-soft);
  line-height: var(--lh-body);
}

.scoring-panel-footer {
  position: sticky;
  bottom: 0;
  background: var(--paper);
  border-top: 1px solid var(--line);
  padding-top: var(--s-4);
  display: flex;
  justify-content: flex-end;
  gap: var(--s-3);
}

/* ── Segmented score input (1..10 + Yes/Maybe/No variant) ── */
.score-seg {
  display: flex;
  gap: 4px;
  margin-top: var(--s-2);
}

.score-seg button {
  flex: 1;
  height: 32px;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sharp);
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}

.score-seg button:hover { border-color: var(--ink); }
.score-seg button:focus { outline: none; border-color: var(--artblue); box-shadow: 0 0 0 3px rgba(50,19,183,0.15); }
.score-seg button[aria-pressed="true"] {
  background: var(--artblue);
  border-color: var(--artblue);
  color: #fff;
}

.score-seg.is-rec button { flex: 0 0 80px; height: 36px; font-size: 14px; }

/* ── Edit-window countdown ── */
.edit-countdown { font-size: var(--t-body-sm); color: var(--ink); }
.edit-countdown.amber { color: var(--accent-amber); }
.edit-countdown.coral { color: var(--accent-coral); }

/* ── Mobile fallback for the scoring page ── */
@media (max-width: 1023px) {
  .reviewer-scoring-page .scoring-body { display: none; }
  .reviewer-scoring-page .mobile-block { display: block; }
}
@media (min-width: 1024px) {
  .reviewer-scoring-page .mobile-block { display: none; }
}

/* ── Inbox card visual nudges (everything else is .card from admin.css) ── */
.inbox-section { margin-bottom: var(--s-7); }
.inbox-section + .inbox-section { margin-top: var(--s-7); }
.inbox-card-meta {
  display: flex; align-items: center; gap: var(--s-3);
  font-size: 13px; color: var(--ink-soft);
}
.inbox-card-meta .sep {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: var(--ink-dim);
}
```

- [ ] **Step 3: Create the ReviewerAppShell**

Create `frontend/src/pages/reviewer/ReviewerAppShell.jsx`:

```jsx
// ReviewerAppShell — top bars + left rail (.app-shell pattern from
// design system §5.1). Used by /reviewer/inbox and /reviewer/completed.
// The /reviewer/:track/:id/score page exits this shell — see
// ReviewerScoringPage.

import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.jsx";
import "../../styles/reviewer.css";

function initials(emailOrName) {
  if (!emailOrName) return "·";
  const t = String(emailOrName).trim();
  if (t.includes(" ")) {
    const parts = t.split(/\s+/);
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

export default function ReviewerAppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const display = user?.full_name || user?.email || "Reviewer";
  const multiRole = (user?.roles || []).length > 1;

  return (
    <div className="app-shell">
      <div className="app-betabar">
        <span className="pill">BETA</span>
        <span>ARTPARK Programs · Staging</span>
      </div>

      <header className="app-header">
        <div className="logos">
          <img className="iisc" src="/iisc-logo.png" alt="IISc" />
          <span className="rule" aria-hidden="true" />
          <img className="artpark" src="/artpark-logo.png" alt="ARTPARK" />
        </div>
        <span className="role-tag">Reviewer</span>
        <span className="spacer" />
        {multiRole && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate("/role-switch")}
          >
            Switch role <span className="arrow">→</span>
          </button>
        )}
        <span className="user-chip" title={display}>
          <span className="avatar">{initials(display)}</span>
          {display}
          <button
            type="button"
            onClick={logout}
            className="btn btn-ghost"
            style={{ marginLeft: 12 }}
          >
            Sign out
          </button>
        </span>
      </header>

      <div className="app-body" style={{ display: "grid", gridTemplateColumns: "240px 1fr" }}>
        <nav className="app-rail" aria-label="Reviewer navigation">
          <div className="rail-section">Reviews</div>
          <NavLink to="/reviewer/inbox" className={({ isActive }) =>
            `rail-link${isActive ? " active" : ""}`}>
            Inbox
          </NavLink>
          <NavLink to="/reviewer/completed" className={({ isActive }) =>
            `rail-link${isActive ? " active" : ""}`}>
            Completed
          </NavLink>
          <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0" }} />
          <NavLink to="/apply/support" className="rail-link">
            Support
          </NavLink>
        </nav>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire routes + delete the stub**

Modify `frontend/src/router.jsx`:

a. Remove `import ReviewerInboxStub from "./pages/reviewer/ReviewerInboxStub.jsx";` near the top.
b. Add:
```jsx
import ReviewerAppShell from "./pages/reviewer/ReviewerAppShell.jsx";
import ReviewerInboxPage from "./pages/reviewer/ReviewerInboxPage.jsx";
import ReviewerCompletedPage from "./pages/reviewer/ReviewerCompletedPage.jsx";
import ReviewerScoringPage from "./pages/reviewer/ReviewerScoringPage.jsx";
```
c. Replace the entire existing `/reviewer/inbox` Route block with:
```jsx
{/* Reviewer surface (Phase 1.5). */}
<Route
  element={
    <ProtectedRoute>
      <ReviewerAppShell />
    </ProtectedRoute>
  }
>
  <Route path="/reviewer" element={<Navigate to="/reviewer/inbox" replace />} />
  <Route path="/reviewer/inbox" element={<ReviewerInboxPage />} />
  <Route path="/reviewer/completed" element={<ReviewerCompletedPage />} />
</Route>
<Route
  path="/reviewer/:track/:id/score"
  element={
    <ProtectedRoute>
      <ReviewerScoringPage />
    </ProtectedRoute>
  }
/>
```

d. Delete the stub file:
```bash
git rm frontend/src/pages/reviewer/ReviewerInboxStub.jsx
```

- [ ] **Step 5: Stub the three pages (so the router compiles)**

Create three placeholder files; they'll get implemented in later tasks:

`frontend/src/pages/reviewer/ReviewerInboxPage.jsx`:
```jsx
export default function ReviewerInboxPage() { return <h1>Inbox.</h1>; }
```

`frontend/src/pages/reviewer/ReviewerCompletedPage.jsx`:
```jsx
export default function ReviewerCompletedPage() { return <h1>Completed.</h1>; }
```

`frontend/src/pages/reviewer/ReviewerScoringPage.jsx`:
```jsx
export default function ReviewerScoringPage() { return <h1>Score.</h1>; }
```

- [ ] **Step 6: Verify the app still builds**

Run: `cd frontend && npm run build`
Expected: build succeeds (no missing-import errors).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/reviewerApi.js frontend/src/styles/reviewer.css \
        frontend/src/pages/reviewer/ReviewerAppShell.jsx \
        frontend/src/pages/reviewer/ReviewerInboxPage.jsx \
        frontend/src/pages/reviewer/ReviewerCompletedPage.jsx \
        frontend/src/pages/reviewer/ReviewerScoringPage.jsx \
        frontend/src/router.jsx
git rm frontend/src/pages/reviewer/ReviewerInboxStub.jsx
git commit -m "feat(reviewer): scaffold app shell + reviewerApi + routes + page stubs"
```

---

## Task 9: ReviewerInboxPage + DeclineAssignmentModal

**Files:**
- Modify: `frontend/src/pages/reviewer/ReviewerInboxPage.jsx`
- Create: `frontend/src/pages/reviewer/scoring/DeclineAssignmentModal.jsx`
- Create: `frontend/src/pages/reviewer/inboxCardStates.js`
- Create: `frontend/src/pages/reviewer/__tests__/ReviewerInboxPage.test.jsx`
- Create: `frontend/src/pages/reviewer/__tests__/DeclineAssignmentModal.test.jsx`

- [ ] **Step 1: Write failing tests for the inbox**

Create `frontend/src/pages/reviewer/__tests__/ReviewerInboxPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ReviewerInboxPage from "../ReviewerInboxPage.jsx";

vi.mock("../../../lib/reviewerApi.js", () => ({
  reviewerApi: {
    listAssignments: vi.fn(),
    declineAssignment: vi.fn(),
  },
}));

import { reviewerApi } from "../../../lib/reviewerApi.js";

function renderPage() {
  return render(
    <MemoryRouter>
      <ReviewerInboxPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReviewerInboxPage", () => {
  it("renders a card per assignment in To Review", async () => {
    reviewerApi.listAssignments.mockResolvedValue({
      assignments: [
        {
          assignment_id: "a1", application_id: "app1", application_track: "tir",
          app_identifier: "TIR-2026-abc12345", industry: "EdTech",
          problem_one_liner: "AI tutoring for K-12 in rural India",
          assigned_at: "2026-05-16T09:00:00Z",
          assigned_by_display: "Dev Dayan",
          my_review: null,
        },
      ],
    });
    renderPage();
    await screen.findByText("TIR-2026-abc12345");
    expect(screen.getByText(/AI tutoring/)).toBeInTheDocument();
    expect(screen.getByText(/To review/i)).toBeInTheDocument();
  });

  it("buckets a submitted-but-unlocked assignment into Editable", async () => {
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    reviewerApi.listAssignments.mockResolvedValue({
      assignments: [
        {
          assignment_id: "a2", application_id: "app2", application_track: "tir",
          app_identifier: "TIR-2026-def", industry: "FinTech",
          problem_one_liner: "Voice banking",
          assigned_at: "2026-05-16T09:00:00Z",
          assigned_by_display: "Dev",
          my_review: { review_id: "r2", submitted_at: "2026-05-18T15:00:00Z", locked_at: future },
        },
      ],
    });
    renderPage();
    await screen.findByText(/Editable/i);
    expect(screen.getByText(/Edit review/)).toBeInTheDocument();
  });

  it("opens decline modal when Decline clicked", async () => {
    reviewerApi.listAssignments.mockResolvedValue({
      assignments: [
        {
          assignment_id: "a1", application_id: "app1", application_track: "tir",
          app_identifier: "TIR-2026-abc12345", industry: "EdTech",
          problem_one_liner: "x", assigned_at: "2026-05-16T09:00:00Z",
          assigned_by_display: "Dev", my_review: null,
        },
      ],
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Decline/ }));
    expect(await screen.findByRole("heading", { name: /Decline this assignment/i }))
      .toBeInTheDocument();
  });
});
```

Create `frontend/src/pages/reviewer/__tests__/DeclineAssignmentModal.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeclineAssignmentModal from "../scoring/DeclineAssignmentModal.jsx";

describe("DeclineAssignmentModal", () => {
  it("disables submit when reason is under 10 chars", async () => {
    const onConfirm = vi.fn();
    render(<DeclineAssignmentModal assignmentId="a1" onConfirm={onConfirm} onCancel={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Reason/i), "no");
    expect(screen.getByRole("button", { name: /Decline assignment/i })).toBeDisabled();
  });

  it("enables submit at ≥10 chars and calls onConfirm with the reason", async () => {
    const onConfirm = vi.fn();
    render(<DeclineAssignmentModal assignmentId="a1" onConfirm={onConfirm} onCancel={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Reason/i), "Not my domain expertise.");
    const btn = screen.getByRole("button", { name: /Decline assignment/i });
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(onConfirm).toHaveBeenCalledWith("Not my domain expertise.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/`
Expected: FAIL (modal file not yet created; inbox stub renders only `<h1>Inbox.</h1>`).

- [ ] **Step 3: Create the inbox-card-state helper**

Create `frontend/src/pages/reviewer/inboxCardStates.js`:

```javascript
// Maps an assignment row to one of the inbox bucket states.

export const INBOX_STATES = {
  TO_REVIEW: "to_review",
  EDITABLE: "editable",
};

export function bucketForAssignment(assignment, now = new Date()) {
  const r = assignment?.my_review;
  if (!r || !r.submitted_at) return INBOX_STATES.TO_REVIEW;
  if (!r.locked_at) return INBOX_STATES.EDITABLE;  // shouldn't happen post-submit, but defensive
  const lockedAt = new Date(r.locked_at);
  if (lockedAt > now) return INBOX_STATES.EDITABLE;
  return null;  // locked — should have been filtered server-side; defensive null
}
```

- [ ] **Step 4: Create DeclineAssignmentModal**

Create `frontend/src/pages/reviewer/scoring/DeclineAssignmentModal.jsx`:

```jsx
import { useState } from "react";

const MIN_REASON_CHARS = 10;

export default function DeclineAssignmentModal({ assignmentId, onConfirm, onCancel, isPending }) {
  const [reason, setReason] = useState("");
  const tooShort = reason.trim().length < MIN_REASON_CHARS;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="decline-title">
      <div className="modal">
        <span className="modal-eyebrow">Assignment</span>
        <h2 id="decline-title">Decline this assignment.</h2>
        <div className="modal-body">
          <p>
            Leadership will be notified and may reassign this application. Tell them
            why so they pick someone better next time.
          </p>
          <label className="field-label" htmlFor={`decline-reason-${assignmentId}`}>Reason</label>
          <textarea
            id={`decline-reason-${assignmentId}`}
            className="field"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="At least 10 characters, please."
          />
          <p className="field-help">{reason.trim().length}/{MIN_REASON_CHARS} characters</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: "var(--accent-coral)" }}
            disabled={tooShort || isPending}
            onClick={() => onConfirm(reason.trim())}
          >
            {isPending ? "Declining…" : "Decline assignment"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement ReviewerInboxPage**

Replace contents of `frontend/src/pages/reviewer/ReviewerInboxPage.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { reviewerApi } from "../../lib/reviewerApi.js";
import { bucketForAssignment, INBOX_STATES } from "./inboxCardStates.js";
import DeclineAssignmentModal from "./scoring/DeclineAssignmentModal.jsx";

function fmtAssigned(iso) {
  if (!iso) return "—";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function fmtCountdown(lockedAtIso) {
  if (!lockedAtIso) return "";
  const ms = new Date(lockedAtIso).getTime() - Date.now();
  if (ms <= 0) return "0:00";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AssignmentCard({ a, bucket, onScore, onEdit, onDecline }) {
  const isEditable = bucket === INBOX_STATES.EDITABLE;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, letterSpacing: "0.04em" }}>
          {isEditable && <span className="dot amber" style={{ marginRight: 8 }} />}
          {a.app_identifier}
        </span>
        <span className="inbox-card-meta">
          {a.industry && <span>{a.industry}</span>}
          {a.industry && <span className="sep" />}
          <span>{isEditable ? `Edit window closes in ${fmtCountdown(a.my_review.locked_at)}` : `Assigned ${fmtAssigned(a.assigned_at)}`}</span>
        </span>
      </div>
      <p style={{ fontSize: "var(--t-body-lg)", color: "var(--ink)", margin: "12px 0 0" }}>
        {a.problem_one_liner || "—"}
      </p>
      {!isEditable && a.assigned_by_display && (
        <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "4px 0 0" }}>
          by {a.assigned_by_display}
        </p>
      )}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 }}>
        {isEditable ? (
          <button type="button" className="btn btn-dark" onClick={() => onEdit(a)}>
            Edit review <span className="arrow">→</span>
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => onDecline(a)}>
              Decline
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onScore(a)}>
              Score this <span className="arrow">→</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ReviewerInboxPage() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [declining, setDeclining] = useState(null);  // assignment object
  const [declinePending, setDeclinePending] = useState(false);
  const [, setTick] = useState(0);  // re-render every 30s for countdowns

  // Tick every 30s so editable cards refresh their countdown.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await reviewerApi.listAssignments();
      setAssignments(res.assignments || []);
    } catch (err) {
      setError(err?.message || "Failed to load assignments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const buckets = useMemo(() => {
    const toReview = [];
    const editable = [];
    for (const a of assignments) {
      const b = bucketForAssignment(a);
      if (b === INBOX_STATES.TO_REVIEW) toReview.push(a);
      else if (b === INBOX_STATES.EDITABLE) editable.push(a);
    }
    return { toReview, editable };
  }, [assignments]);

  const goScore = useCallback((a) => {
    // Cache the inbox list for Prev/Next on the scoring page (State C only).
    try {
      sessionStorage.setItem(
        "reviewer_inbox_id_list",
        JSON.stringify(assignments.map((x) => ({ track: x.application_track, id: x.application_id }))),
      );
    } catch { /* ignore */ }
    navigate(`/reviewer/${a.application_track}/${a.application_id}/score`);
  }, [assignments, navigate]);

  const goEdit = goScore;  // same destination; the page detects State B from data

  const onConfirmDecline = useCallback(async (reason) => {
    if (!declining) return;
    setDeclinePending(true);
    try {
      await reviewerApi.declineAssignment(declining.assignment_id, reason);
      setDeclining(null);
      await load();
    } catch (err) {
      window.alert(err?.message || "Failed to decline. Please try again.");
    } finally {
      setDeclinePending(false);
    }
  }, [declining, load]);

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow eyebrow-rule">Reviews</span>
          <h1>Inbox.</h1>
          <p className="page-sub">
            {buckets.toReview.length === 0 && buckets.editable.length === 0
              ? "Nothing waiting on you right now."
              : "Read carefully. Your scores stay private until leadership compares them."}
          </p>
        </div>
      </header>

      {error && <div className="inline-error" role="alert">{error}</div>}
      {loading && <p style={{ color: "var(--ink-soft)" }}>Loading…</p>}

      {!loading && !error && buckets.toReview.length === 0 && buckets.editable.length === 0 && (
        <div className="card card-soft" style={{ textAlign: "center", padding: "96px 32px" }}>
          <span className="eyebrow">All clear</span>
          <h3 style={{ marginTop: 12 }}>You're caught up.</h3>
          <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
            Leadership will assign new applications as they come in.
          </p>
        </div>
      )}

      {buckets.toReview.length > 0 && (
        <section className="inbox-section">
          <span className="eyebrow">To review · {buckets.toReview.length}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            {buckets.toReview.map((a) => (
              <AssignmentCard
                key={a.assignment_id}
                a={a}
                bucket={INBOX_STATES.TO_REVIEW}
                onScore={goScore}
                onDecline={(x) => setDeclining(x)}
              />
            ))}
          </div>
        </section>
      )}

      {buckets.editable.length > 0 && (
        <section className="inbox-section">
          <span className="eyebrow">Editable · {buckets.editable.length} · within 60-min edit window</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            {buckets.editable.map((a) => (
              <AssignmentCard
                key={a.assignment_id}
                a={a}
                bucket={INBOX_STATES.EDITABLE}
                onEdit={goEdit}
              />
            ))}
          </div>
        </section>
      )}

      {declining && (
        <DeclineAssignmentModal
          assignmentId={declining.assignment_id}
          isPending={declinePending}
          onConfirm={onConfirmDecline}
          onCancel={() => setDeclining(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/ReviewerInboxPage.test.jsx src/pages/reviewer/__tests__/DeclineAssignmentModal.test.jsx`
Expected: PASS (5 tests total).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/reviewer/ReviewerInboxPage.jsx \
        frontend/src/pages/reviewer/inboxCardStates.js \
        frontend/src/pages/reviewer/scoring/DeclineAssignmentModal.jsx \
        frontend/src/pages/reviewer/__tests__/
git commit -m "feat(reviewer): ReviewerInboxPage + DeclineAssignmentModal with grouped cards"
```

---

## Task 10: Copy leadership review chrome + ScoreSegmentInput

**Files:**
- Copy: `frontend/src/pages/leadership/review/{ReviewHeader,ApplicationTab,QuestionBlock,SectionBlock}.jsx` → `frontend/src/pages/reviewer/review/`
- Copy: `frontend/src/pages/leadership/applicationSchemas.js` → `frontend/src/pages/reviewer/review/`
- Copy: `frontend/src/pages/leadership/review/answers/` → `frontend/src/pages/reviewer/review/`
- Create: `frontend/src/pages/reviewer/scoring/ScoreSegmentInput.jsx`
- Create: `frontend/src/pages/reviewer/scoring/RecommendationInput.jsx`
- Create: `frontend/src/pages/reviewer/__tests__/ScoreSegmentInput.test.jsx`

- [ ] **Step 1: Copy the leadership chrome**

Run from the worktree root:

```bash
mkdir -p frontend/src/pages/reviewer/review
cp frontend/src/pages/leadership/review/ReviewHeader.jsx       frontend/src/pages/reviewer/review/
cp frontend/src/pages/leadership/review/ApplicationTab.jsx     frontend/src/pages/reviewer/review/
cp frontend/src/pages/leadership/review/QuestionBlock.jsx      frontend/src/pages/reviewer/review/
cp frontend/src/pages/leadership/review/SectionBlock.jsx       frontend/src/pages/reviewer/review/
cp frontend/src/pages/leadership/applicationSchemas.js         frontend/src/pages/reviewer/review/
cp -R frontend/src/pages/leadership/review/answers             frontend/src/pages/reviewer/review/
```

- [ ] **Step 2: Adjust copied imports if needed**

Open each copied file and verify that any imports like `import ... from "../applicationSchemas.js"` still resolve. The new `applicationSchemas.js` lives one level deeper in `pages/reviewer/review/`, so adjust accordingly:

For each copied file in `frontend/src/pages/reviewer/review/`, replace any leadership-relative imports:

- `from "../applicationSchemas.js"` → `from "./applicationSchemas.js"`
- `from "./answers/..."` stays the same
- `from "../../../lib/statusMachine.js"` stays the same (deeper but same file)
- Any `import "../../../styles/review-application.css"` → for now leave; we'll add reviewer.css references on the page level

Run `cd frontend && npm run build` after to confirm it still compiles.

- [ ] **Step 3: Trim ReviewHeader for reviewer use**

Open `frontend/src/pages/reviewer/review/ReviewHeader.jsx`. Strip the AI overall-score chip and the aside toggle button. The result should match design doc §4.4 — back button, app ID, status pill, spacer, Prev/Next. Specifically remove the `<span class="h-score">` and `<button class="h-toggle">` JSX and their props (`scoreOverall`, `onToggleAside`, `asideCollapsed`).

Also change the back-button label from `← Back` to `← Inbox`.

- [ ] **Step 4: Write failing test for ScoreSegmentInput**

Create `frontend/src/pages/reviewer/__tests__/ScoreSegmentInput.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScoreSegmentInput from "../scoring/ScoreSegmentInput.jsx";

describe("ScoreSegmentInput", () => {
  it("renders 10 buttons", () => {
    render(<ScoreSegmentInput label="Problem" value={null} onChange={() => {}} />);
    const btns = screen.getAllByRole("button");
    expect(btns).toHaveLength(10);
  });

  it("marks the selected button with aria-pressed=true", () => {
    render(<ScoreSegmentInput label="Problem" value={7} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Score 7 out of 10 for Problem/i }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Score 3 out of 10 for Problem/i }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("fires onChange with the clicked value", async () => {
    const onChange = vi.fn();
    render(<ScoreSegmentInput label="Problem" value={null} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Score 4 out of 10 for Problem/i }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("ArrowRight from value=10 wraps to 1", async () => {
    const onChange = vi.fn();
    render(<ScoreSegmentInput label="Problem" value={10} onChange={onChange} />);
    const user = userEvent.setup();
    const ten = screen.getByRole("button", { name: /Score 10 out of 10 for Problem/i });
    ten.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("ArrowLeft from value=1 wraps to 10", async () => {
    const onChange = vi.fn();
    render(<ScoreSegmentInput label="Problem" value={1} onChange={onChange} />);
    const user = userEvent.setup();
    const one = screen.getByRole("button", { name: /Score 1 out of 10 for Problem/i });
    one.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(10);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/ScoreSegmentInput.test.jsx`
Expected: FAIL — component not yet created.

- [ ] **Step 6: Implement ScoreSegmentInput**

Create `frontend/src/pages/reviewer/scoring/ScoreSegmentInput.jsx`:

```jsx
import { useCallback } from "react";

export default function ScoreSegmentInput({ label, value, onChange, disabled }) {
  const onKeyDown = useCallback((e) => {
    if (disabled) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = value === null || value === undefined
        ? 1
        : (value === 10 ? 1 : value + 1);
      onChange(next);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = value === null || value === undefined
        ? 10
        : (value === 1 ? 10 : value - 1);
      onChange(next);
    }
  }, [value, onChange, disabled]);

  return (
    <div className="score-seg" role="radiogroup" aria-label={label}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-pressed={value === n ? "true" : "false"}
          aria-checked={value === n}
          aria-label={`Score ${n} out of 10 for ${label}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          onKeyDown={onKeyDown}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Implement RecommendationInput**

Create `frontend/src/pages/reviewer/scoring/RecommendationInput.jsx`:

```jsx
const OPTIONS = [
  { value: "yes",   label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no",    label: "No" },
];

export default function RecommendationInput({ value, onChange, disabled }) {
  return (
    <div className="score-seg is-rec" role="radiogroup" aria-label="Recommendation">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-pressed={value === opt.value ? "true" : "false"}
          aria-checked={value === opt.value}
          aria-label={`Recommendation ${opt.label}`}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/ScoreSegmentInput.test.jsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/reviewer/review/ \
        frontend/src/pages/reviewer/scoring/ScoreSegmentInput.jsx \
        frontend/src/pages/reviewer/scoring/RecommendationInput.jsx \
        frontend/src/pages/reviewer/__tests__/ScoreSegmentInput.test.jsx
git commit -m "feat(reviewer): copy leadership review chrome + ScoreSegmentInput + RecommendationInput"
```

---

## Task 11: ReviewerScoringPanel State A + ReviewerScoringPage skeleton

**Files:**
- Create: `frontend/src/pages/reviewer/scoring/ReviewerScoringPanel.jsx`
- Modify: `frontend/src/pages/reviewer/ReviewerScoringPage.jsx`
- Create: `frontend/src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx`

- [ ] **Step 1: Write failing tests for State A**

Create `frontend/src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewerScoringPanel from "../scoring/ReviewerScoringPanel.jsx";

const baseProps = {
  state: "scoring",
  myReview: null,
  aiScreening: null,
  onSubmit: vi.fn(),
  onSaveDraft: vi.fn(),
  onEdit: vi.fn(),
};

describe("ReviewerScoringPanel — State A (scoring)", () => {
  it("Submit button disabled until 5 scores + recommendation set", async () => {
    const onSubmit = vi.fn();
    render(<ReviewerScoringPanel {...baseProps} onSubmit={onSubmit} />);
    const user = userEvent.setup();
    const submit = screen.getByRole("button", { name: /Submit review/i });
    expect(submit).toBeDisabled();

    // Fill 4 categories — still disabled
    for (const cat of ["Problem importance & clarity", "Solution depth & completeness",
                       "Technical strength", "Founder traits"]) {
      await user.click(screen.getByRole("radio", { name: new RegExp(`Score 7 out of 10 for ${cat}`) }));
    }
    expect(submit).toBeDisabled();

    // Add commitment + recommendation
    await user.click(screen.getByRole("radio", { name: /Score 6 out of 10 for Commitment/ }));
    await user.click(screen.getByRole("radio", { name: /Recommendation Maybe/ }));
    expect(submit).not.toBeDisabled();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      score_problem: 7, score_solution: 7, score_tech: 7,
      score_founders: 7, score_commitment: 6, recommendation: "maybe",
    }));
  });

  it("Save draft fires onSaveDraft with whatever has been entered", async () => {
    const onSaveDraft = vi.fn();
    render(<ReviewerScoringPanel {...baseProps} onSaveDraft={onSaveDraft} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /Score 4 out of 10 for Problem/ }));
    await user.click(screen.getByRole("button", { name: /Save draft/i }));
    expect(onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({ score_problem: 4 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx`
Expected: FAIL — panel doesn't exist yet.

- [ ] **Step 3: Implement ReviewerScoringPanel (State A only for now)**

Create `frontend/src/pages/reviewer/scoring/ReviewerScoringPanel.jsx`:

```jsx
import { useMemo, useState } from "react";
import ScoreSegmentInput from "./ScoreSegmentInput.jsx";
import RecommendationInput from "./RecommendationInput.jsx";

const CATEGORIES = [
  { col: "score_problem",    label: "Problem importance & clarity" },
  { col: "score_solution",   label: "Solution depth & completeness" },
  { col: "score_tech",       label: "Technical strength" },
  { col: "score_founders",   label: "Founder traits" },
  { col: "score_commitment", label: "Commitment level" },
];

function blankForm() {
  return {
    score_problem: null,
    score_solution: null,
    score_tech: null,
    score_founders: null,
    score_commitment: null,
    recommendation: null,
    strengths: "",
    concerns: "",
    quick_notes: "",
  };
}

function isComplete(form) {
  return CATEGORIES.every((c) => typeof form[c.col] === "number") && !!form.recommendation;
}

function StateAForm({ initial, onSubmit, onSaveDraft }) {
  const [form, setForm] = useState(initial || blankForm());
  const complete = useMemo(() => isComplete(form), [form]);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <>
      <span className="panel-eyebrow">Score this application</span>
      <p className="panel-intro">
        Read carefully. Your scores stay private until leadership compares them.
      </p>

      {CATEGORIES.map((c) => (
        <div key={c.col}>
          <label className="field-label">{c.label}</label>
          <ScoreSegmentInput
            label={c.label}
            value={form[c.col]}
            onChange={(v) => set(c.col, v)}
          />
        </div>
      ))}

      <div>
        <label className="field-label">Recommendation</label>
        <RecommendationInput
          value={form.recommendation}
          onChange={(v) => set("recommendation", v)}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="r-strengths">Strengths</label>
        <textarea id="r-strengths" className="field" rows={3}
          value={form.strengths} onChange={(e) => set("strengths", e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="r-concerns">Concerns</label>
        <textarea id="r-concerns" className="field" rows={3}
          value={form.concerns} onChange={(e) => set("concerns", e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="r-notes">Quick notes (private to you)</label>
        <textarea id="r-notes" className="field" rows={2}
          value={form.quick_notes} onChange={(e) => set("quick_notes", e.target.value)} />
      </div>

      <div className="scoring-panel-footer">
        <button type="button" className="btn btn-ghost" onClick={() => onSaveDraft(form)}>
          Save draft
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!complete}
          onClick={() => onSubmit(form)}
        >
          Submit review <span className="arrow">→</span>
        </button>
      </div>
    </>
  );
}

export default function ReviewerScoringPanel({
  state, myReview, aiScreening, onSubmit, onSaveDraft, onEdit,
}) {
  // States B and C are added in Task 12.
  return (
    <aside className="scoring-panel" aria-label="Reviewer scoring panel">
      {state === "scoring" && (
        <StateAForm initial={myReview} onSubmit={onSubmit} onSaveDraft={onSaveDraft} />
      )}
      {/* state === "editable" → State B (Task 12) */}
      {/* state === "locked"   → State C (Task 12) */}
    </aside>
  );
}
```

- [ ] **Step 4: Implement ReviewerScoringPage skeleton (loads data, picks state, renders panel)**

Replace contents of `frontend/src/pages/reviewer/ReviewerScoringPage.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { reviewerApi } from "../../lib/reviewerApi.js";
import { schemaFor } from "./review/applicationSchemas.js";
import ReviewHeader from "./review/ReviewHeader.jsx";
import ApplicationTab from "./review/ApplicationTab.jsx";
import ReviewerScoringPanel from "./scoring/ReviewerScoringPanel.jsx";
import "../../styles/reviewer.css";

function composeAppId(track, id, submittedAt) {
  const prefix = (track || "").toUpperCase();
  let year = 2026;
  if (submittedAt) {
    try { year = new Date(submittedAt).getFullYear(); } catch { /* */ }
  }
  return `${prefix}-${year}-${(id || "").slice(0, 8) || "unknown"}`;
}

function pickState(myReview) {
  if (!myReview || !myReview.submitted_at) return "scoring";
  const locked = new Date(myReview.locked_at).getTime();
  if (Date.now() < locked) return "editable";
  return "locked";
}

export default function ReviewerScoringPage() {
  const { track, id } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [tooNarrow, setTooNarrow] = useState(
    typeof window !== "undefined" && window.innerWidth < 1024
  );

  useEffect(() => {
    const onResize = () => setTooNarrow(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      reviewerApi.getMyReview(id),
      reviewerApi.getApplication(track, id),
    ])
      .then(([mineRes, appRes]) => {
        if (cancelled) return;
        setDetail({
          application: appRes.application,
          assignment: appRes.assignment,
          aiScreening: appRes.ai_screening,
          myReview: mineRes.review || appRes.my_review || null,
        });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.details?.message || err?.message || "Failed to load.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [track, id, reload]);

  const state = useMemo(() => pickState(detail?.myReview), [detail?.myReview]);
  const schema = useMemo(() => schemaFor(track), [track]);
  const appIdent = useMemo(
    () => composeAppId(track, id, detail?.application?.submitted_at),
    [track, id, detail?.application?.submitted_at],
  );

  const onBack = useCallback(() => navigate("/reviewer/inbox"), [navigate]);

  const onSubmit = useCallback(async (form) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await reviewerApi.submitReview({
        application_id: id,
        application_track: track,
        assignment_id: detail.assignment.assignment_id,
        ...form,
        draft: false,
      });
      setReload((n) => n + 1);
    } catch (err) {
      window.alert(err?.message || "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }, [id, track, detail, submitting]);

  const onSaveDraft = useCallback(async (form) => {
    try {
      await reviewerApi.submitReview({
        application_id: id,
        application_track: track,
        assignment_id: detail.assignment.assignment_id,
        ...form,
        draft: true,
      });
      setReload((n) => n + 1);
    } catch (err) {
      window.alert(err?.message || "Save failed.");
    }
  }, [id, track, detail]);

  if (tooNarrow) {
    return (
      <div className="reviewer-scoring-page" style={{ padding: 24 }}>
        <div className="card card-soft" style={{ textAlign: "center", padding: 48 }}>
          <span className="eyebrow">Use a desktop</span>
          <h3 style={{ marginTop: 12 }}>Scoring requires a wider screen.</h3>
          <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
            This page needs at least 1024 pixels wide. Open this link on a laptop or desktop.
          </p>
          <button className="btn btn-ghost" style={{ marginTop: 24 }} onClick={onBack}>
            ← Back to inbox
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reviewer-scoring-page review-page">
      <ReviewHeader
        appId={appIdent}
        status={detail?.application?.status || null}
        onBack={onBack}
        onPrev={() => {}}     // wired in Task 12 (State C only)
        onNext={() => {}}
        hasPrev={false}
        hasNext={false}
      />
      <div className="review-body scoring-body" style={{ display: "flex" }}>
        <main className="review-main" style={{ flex: 1 }}>
          <div className="review-main-inner">
            {error && <div className="inline-error" role="alert">{error}</div>}
            {loading && !detail && <p>Loading application…</p>}
            {!error && detail && (
              <ApplicationTab schema={schema} application={detail.application} />
            )}
          </div>
        </main>
        {detail && (
          <ReviewerScoringPanel
            state={state}
            myReview={detail.myReview}
            aiScreening={detail.aiScreening}
            onSubmit={onSubmit}
            onSaveDraft={onSaveDraft}
            onEdit={() => {}}    // wired in Task 12
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/reviewer/scoring/ReviewerScoringPanel.jsx \
        frontend/src/pages/reviewer/ReviewerScoringPage.jsx \
        frontend/src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx
git commit -m "feat(reviewer): ReviewerScoringPage + Panel State A (scoring form)"
```

---

## Task 12: State B + State C — EditWindowCountdown + AIComparisonView + edit cycle

**Files:**
- Create: `frontend/src/pages/reviewer/scoring/EditWindowCountdown.jsx`
- Create: `frontend/src/pages/reviewer/scoring/AIComparisonView.jsx`
- Modify: `frontend/src/pages/reviewer/scoring/ReviewerScoringPanel.jsx`
- Modify: `frontend/src/pages/reviewer/ReviewerScoringPage.jsx`
- Create: `frontend/src/pages/reviewer/__tests__/EditWindowCountdown.test.jsx`
- Modify: `frontend/src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx`

- [ ] **Step 1: Write failing tests for EditWindowCountdown**

Create `frontend/src/pages/reviewer/__tests__/EditWindowCountdown.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import EditWindowCountdown from "../scoring/EditWindowCountdown.jsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function inFutureMs(ms) {
  return new Date(Date.now() + ms).toISOString();
}

describe("EditWindowCountdown", () => {
  it("renders mm:ss for >5 min in normal color", () => {
    render(<EditWindowCountdown lockedAt={inFutureMs(10 * 60 * 1000)} />);
    const el = screen.getByText(/\d+:\d{2} left/);
    expect(el).toBeInTheDocument();
    expect(el).not.toHaveClass("amber");
    expect(el).not.toHaveClass("coral");
  });

  it("renders amber class when <5 min remain", () => {
    render(<EditWindowCountdown lockedAt={inFutureMs(4 * 60 * 1000)} />);
    expect(screen.getByText(/\d+:\d{2} left/)).toHaveClass("amber");
  });

  it("renders coral class when <1 min remains", () => {
    render(<EditWindowCountdown lockedAt={inFutureMs(30 * 1000)} />);
    expect(screen.getByText(/\d+:\d{2} left/)).toHaveClass("coral");
  });

  it("fires onExpire when the deadline passes", () => {
    const onExpire = vi.fn();
    render(<EditWindowCountdown lockedAt={inFutureMs(1000)} onExpire={onExpire} />);
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/EditWindowCountdown.test.jsx`
Expected: FAIL — component not implemented.

- [ ] **Step 3: Implement EditWindowCountdown**

Create `frontend/src/pages/reviewer/scoring/EditWindowCountdown.jsx`:

```jsx
import { useEffect, useState } from "react";

function fmt(msLeft) {
  if (msLeft <= 0) return "0:00";
  const m = Math.floor(msLeft / 60000);
  const s = Math.floor((msLeft % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function classFor(msLeft) {
  if (msLeft < 60 * 1000) return "coral";
  if (msLeft < 5 * 60 * 1000) return "amber";
  return "";
}

export default function EditWindowCountdown({ lockedAt, onExpire }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadline = new Date(lockedAt).getTime();
  const msLeft = deadline - now;
  const colorClass = classFor(msLeft);

  useEffect(() => {
    if (msLeft <= 0 && typeof onExpire === "function") onExpire();
  }, [msLeft, onExpire]);

  return (
    <span className={`edit-countdown ${colorClass}`}>
      {fmt(msLeft)} left
    </span>
  );
}
```

- [ ] **Step 4: Implement AIComparisonView**

Create `frontend/src/pages/reviewer/scoring/AIComparisonView.jsx`:

```jsx
const ROWS = [
  { col: "score_problem",    label: "Problem importance" },
  { col: "score_solution",   label: "Solution depth" },
  { col: "score_tech",       label: "Technical strength" },
  { col: "score_founders",   label: "Founder traits" },
  { col: "score_commitment", label: "Commitment" },
];

function Bar({ value, color }) {
  const pct = typeof value === "number" ? (value / 10) * 100 : 0;
  return (
    <div className="bar-track" style={{ flex: 1 }}>
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function AIComparisonView({ myReview, aiScreening }) {
  const isStub = !!(aiScreening?.summary && /\bstub mode\b/i.test(aiScreening.summary));

  return (
    <div>
      <h3 style={{ fontSize: 18, margin: "0 0 16px" }}>Your scores vs AI:</h3>
      {ROWS.map((r) => (
        <div key={r.col} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 6 }}>{r.label}</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 4 }}>
            <span style={{ width: 32, fontSize: 12, color: "var(--ink-soft)" }}>You</span>
            <Bar value={myReview?.[r.col]} color="var(--artblue)" />
            <span style={{ width: 24, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
              {myReview?.[r.col] ?? "—"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ width: 32, fontSize: 12, color: "var(--ink-soft)" }}>AI</span>
            <Bar value={aiScreening?.[r.col]} color="var(--ink-soft)" />
            <span style={{ width: 24, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
              {aiScreening?.[r.col] ?? "—"}
            </span>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Recommendation</div>
        <div style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>
          {(myReview?.recommendation || "—").toUpperCase()}
        </div>
      </div>

      {aiScreening?.summary && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 4 }}>
            AI summary {isStub && <span style={{ marginLeft: 8, background: "var(--accent-amber)", color: "#fff", padding: "2px 6px", fontSize: 10, letterSpacing: "0.08em" }}>STUB</span>}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink)", fontStyle: "italic", lineHeight: 1.5 }}>
            {aiScreening.summary}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Extend the panel with State B + State C**

Modify `frontend/src/pages/reviewer/scoring/ReviewerScoringPanel.jsx` — add imports and the missing state branches:

```jsx
import EditWindowCountdown from "./EditWindowCountdown.jsx";
import AIComparisonView from "./AIComparisonView.jsx";

// ... inside the default export, replace the placeholder comments with: ...

      {state === "editable" && (
        <StateBSubmitted
          myReview={myReview}
          aiScreening={aiScreening}
          onEdit={onEdit}
          onExpire={onEdit /* parent will re-fetch and flip to "locked" */}
        />
      )}
      {state === "locked" && (
        <StateCLocked
          myReview={myReview}
          aiScreening={aiScreening}
        />
      )}
```

And in the same file, add the two component definitions just above `export default function ReviewerScoringPanel`:

```jsx
function StateBSubmitted({ myReview, aiScreening, onEdit, onExpire }) {
  return (
    <>
      <span className="panel-eyebrow" style={{ color: "var(--accent-green)" }}>
        Review submitted · ✓
      </span>
      <p className="panel-intro">
        You can edit until <EditWindowCountdown lockedAt={myReview.locked_at} onExpire={onExpire} />
        .
      </p>
      <AIComparisonView myReview={myReview} aiScreening={aiScreening} />
      <div className="scoring-panel-footer">
        <button type="button" className="btn btn-primary" onClick={onEdit}>
          Edit my review <span className="arrow">→</span>
        </button>
      </div>
    </>
  );
}

function StateCLocked({ myReview, aiScreening }) {
  return (
    <>
      <span className="panel-eyebrow">Review submitted · LOCKED</span>
      <AIComparisonView myReview={myReview} aiScreening={aiScreening} />
    </>
  );
}
```

- [ ] **Step 6: Wire the edit/PATCH cycle in ReviewerScoringPage**

Modify `frontend/src/pages/reviewer/ReviewerScoringPage.jsx` — add an `editing` state and an `onEdit` handler that flips the panel back to State A's form but with the existing review's values prefilled. On Submit, PATCH instead of POST:

```jsx
// Add to component state:
const [editing, setEditing] = useState(false);

// Compute effective state — when editing, force "scoring" form (State A)
const effectiveState = editing ? "scoring" : state;

const onEditClick = useCallback(() => setEditing(true), []);

// Replace onSubmit to handle PATCH if in editing mode:
const onSubmit = useCallback(async (form) => {
  if (submitting) return;
  setSubmitting(true);
  try {
    if (editing && detail?.myReview) {
      await reviewerApi.patchReview(detail.myReview.id, { ...form, draft: false });
    } else {
      await reviewerApi.submitReview({
        application_id: id,
        application_track: track,
        assignment_id: detail.assignment.assignment_id,
        ...form,
        draft: false,
      });
    }
    setEditing(false);
    setReload((n) => n + 1);
  } catch (err) {
    if (err?.status === 423) {
      window.alert("Edit window closed. Your last submitted version is final.");
      setEditing(false);
      setReload((n) => n + 1);
    } else {
      window.alert(err?.message || "Submit failed.");
    }
  } finally {
    setSubmitting(false);
  }
}, [id, track, detail, submitting, editing]);

// Pass effectiveState and onEditClick down:
<ReviewerScoringPanel
  state={effectiveState}
  myReview={detail.myReview}
  aiScreening={detail.aiScreening}
  onSubmit={onSubmit}
  onSaveDraft={onSaveDraft}
  onEdit={onEditClick}
/>
```

Verify the prefill works: `StateAForm` already accepts `initial` — pass `myReview` to it when `editing`.

In `ReviewerScoringPanel`, when `effectiveState === "scoring"` and editing, pass `myReview` as `initial`. Update the `state === "scoring"` branch:

```jsx
{state === "scoring" && (
  <StateAForm
    initial={myReview /* prefill if returning to A from edit */}
    onSubmit={onSubmit}
    onSaveDraft={onSaveDraft}
  />
)}
```

- [ ] **Step 7: Add tests for State B + State C**

Append to `frontend/src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx`:

```jsx
describe("ReviewerScoringPanel — State B (editable)", () => {
  it("shows submitted eyebrow + comparison view + Edit button", () => {
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    render(
      <ReviewerScoringPanel
        state="editable"
        myReview={{
          id: "r1", score_problem: 7, score_solution: 6, score_tech: 6,
          score_founders: 8, score_commitment: 7, recommendation: "maybe",
          submitted_at: "2026-05-18T15:00:00Z", locked_at: future,
        }}
        aiScreening={{
          score_problem: 8, score_solution: 7, score_tech: 7,
          score_founders: 7, score_commitment: 8, summary: "Strong.",
        }}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByText(/Review submitted · ✓/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit my review/i })).toBeInTheDocument();
    expect(screen.getByText(/Your scores vs AI/i)).toBeInTheDocument();
  });
});

describe("ReviewerScoringPanel — State C (locked)", () => {
  it("shows LOCKED eyebrow and no edit button", () => {
    render(
      <ReviewerScoringPanel
        state="locked"
        myReview={{
          id: "r1", score_problem: 7, score_solution: 6, score_tech: 6,
          score_founders: 8, score_commitment: 7, recommendation: "no",
          submitted_at: "2026-05-15T10:00:00Z", locked_at: "2026-05-15T11:00:00Z",
        }}
        aiScreening={{ score_problem: 8, summary: "Strong." }}
      />,
    );
    expect(screen.getByText(/LOCKED/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit my review/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/`
Expected: PASS (all panel + countdown + inbox + modal + segment tests).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/reviewer/scoring/EditWindowCountdown.jsx \
        frontend/src/pages/reviewer/scoring/AIComparisonView.jsx \
        frontend/src/pages/reviewer/scoring/ReviewerScoringPanel.jsx \
        frontend/src/pages/reviewer/ReviewerScoringPage.jsx \
        frontend/src/pages/reviewer/__tests__/EditWindowCountdown.test.jsx \
        frontend/src/pages/reviewer/__tests__/ReviewerScoringPanel.test.jsx
git commit -m "feat(reviewer): States B and C — countdown + AI comparison + edit cycle"
```

---

## Task 13: ReviewerCompletedPage

**Files:**
- Modify: `frontend/src/pages/reviewer/ReviewerCompletedPage.jsx`
- Create: `frontend/src/pages/reviewer/__tests__/ReviewerCompletedPage.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/pages/reviewer/__tests__/ReviewerCompletedPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ReviewerCompletedPage from "../ReviewerCompletedPage.jsx";

vi.mock("../../../lib/reviewerApi.js", () => ({
  reviewerApi: { listCompletedReviews: vi.fn() },
}));
import { reviewerApi } from "../../../lib/reviewerApi.js";

beforeEach(() => vi.clearAllMocks());

function renderPage() {
  return render(
    <MemoryRouter>
      <ReviewerCompletedPage />
    </MemoryRouter>,
  );
}

describe("ReviewerCompletedPage", () => {
  it("renders rows from the API", async () => {
    reviewerApi.listCompletedReviews.mockResolvedValue({
      reviews: [
        {
          review_id: "r1", application_id: "app1", application_track: "tir",
          app_identifier: "TIR-2026-abc12345",
          problem_one_liner: "AI tutoring",
          score_overall_mine: 6.6, recommendation: "maybe",
          submitted_at: "2026-05-15T10:00:00Z",
        },
      ],
      page: 1, total_pages: 1, total: 1,
    });
    renderPage();
    await screen.findByText("TIR-2026-abc12345");
    expect(screen.getByText("6.6")).toBeInTheDocument();
    expect(screen.getByText("Maybe")).toBeInTheDocument();
  });

  it("renders empty state when there are no reviews", async () => {
    reviewerApi.listCompletedReviews.mockResolvedValue({ reviews: [], page: 1, total_pages: 1, total: 0 });
    renderPage();
    await screen.findByText(/Nothing here yet/i);
  });

  it("re-fetches with track filter when a chip is clicked", async () => {
    reviewerApi.listCompletedReviews.mockResolvedValue({ reviews: [], page: 1, total_pages: 1, total: 0 });
    renderPage();
    await screen.findByText(/Nothing here yet/i);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^TIR$/ }));
    expect(reviewerApi.listCompletedReviews).toHaveBeenLastCalledWith({ track: "tir", page: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/ReviewerCompletedPage.test.jsx`
Expected: FAIL — stub page only renders `<h1>Completed.</h1>`.

- [ ] **Step 3: Implement ReviewerCompletedPage**

Replace contents of `frontend/src/pages/reviewer/ReviewerCompletedPage.jsx`:

```jsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { reviewerApi } from "../../lib/reviewerApi.js";

const TRACKS = [
  { value: "all", label: "All" },
  { value: "tir", label: "TIR" },
  { value: "sip", label: "SIP" },
];

function fmtRelative(iso) {
  if (!iso) return "—";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

function recLabel(r) {
  if (!r) return "—";
  return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
}

export default function ReviewerCompletedPage() {
  const navigate = useNavigate();
  const [data, setData] = useState({ reviews: [], page: 1, total_pages: 1, total: 0 });
  const [track, setTrack] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page };
      if (track !== "all") params.track = track;
      const res = await reviewerApi.listCompletedReviews(params);
      setData(res);
    } catch (err) {
      setError(err?.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [track, page]);

  useEffect(() => { load(); }, [load]);

  const openReview = useCallback(
    (r) => navigate(`/reviewer/${r.application_track}/${r.application_id}/score`),
    [navigate],
  );

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow eyebrow-rule">Reviews · Archive</span>
          <h1>Completed.</h1>
          <p className="page-sub">
            Your locked reviews. Read-only after the 60-minute edit window closes.
          </p>
        </div>
      </header>

      <div className="filter-bar">
        <div className="filter-chips">
          {TRACKS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`chip${track === t.value ? " active" : ""}`}
              onClick={() => { setPage(1); setTrack(t.value); }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      {!loading && data.reviews.length === 0 && (
        <div className="card card-soft" style={{ textAlign: "center", padding: "96px 32px" }}>
          <span className="eyebrow">No reviews yet</span>
          <h3 style={{ marginTop: 12 }}>Nothing here yet.</h3>
          <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
            Your locked reviews land here after the 60-minute edit window closes.
          </p>
        </div>
      )}

      {data.reviews.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Application</th>
              <th>Track</th>
              <th className="num">My score</th>
              <th>My rec</th>
              <th>Submitted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.reviews.map((r) => (
              <tr key={r.review_id} onClick={() => openReview(r)}>
                <td className="primary">
                  {r.app_identifier}
                  {r.problem_one_liner && (
                    <span className="sub">{r.problem_one_liner}</span>
                  )}
                </td>
                <td>{(r.application_track || "").toUpperCase()}</td>
                <td className="num">{r.score_overall_mine != null ? r.score_overall_mine.toFixed(1) : "—"}</td>
                <td>{recLabel(r.recommendation)}</td>
                <td title={r.submitted_at}>{fmtRelative(r.submitted_at)}</td>
                <td style={{ textAlign: "right", color: "var(--ink-soft)" }}>→</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.total_pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 24, color: "var(--ink-dim)" }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span>Page {data.page} of {data.total_pages}</span>
          <button className="btn btn-ghost" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/reviewer/__tests__/ReviewerCompletedPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the entire frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS (all tests, including any pre-existing).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/reviewer/ReviewerCompletedPage.jsx \
        frontend/src/pages/reviewer/__tests__/ReviewerCompletedPage.test.jsx
git commit -m "feat(reviewer): ReviewerCompletedPage with track filter + pagination"
```

---

## Task 14: Manual QA + design-system grep + acceptance verification

**Files:** none (verification only — no code changes)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && pytest tests/test_reviewer.py -v`
Expected: All 20+ reviewer tests pass.

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: All tests pass.

- [ ] **Step 3: Build the frontend**

Run: `cd frontend && npm run build`
Expected: Clean build, no warnings about missing imports or unused exports.

- [ ] **Step 4: Wait for the Vercel preview to deploy**

The preview URL: `https://ap-os-git-feature-reviewer-screens-artpark.vercel.app`
Visit and confirm the deploy succeeded.

- [ ] **Step 5: Anti-pattern grep**

Run from worktree root:

```bash
git diff origin/staging-role_based_dashboard -- 'frontend/src/pages/reviewer/' 'frontend/src/lib/reviewerApi.js' 'frontend/src/styles/reviewer.css' \
  | grep -E '(rounded-(md|lg|xl|2xl|3xl|full)|box-shadow|linear-gradient|hover:scale|hover:translate|backdrop-filter|#3213b7|#aafcf0|font-family.*Inter|let'"'"'s )' \
  && { echo "DESIGN-SYSTEM VIOLATION"; exit 1; } || echo "Clean"
```

Expected output: `Clean`. If violations are found, fix inline and re-commit.

- [ ] **Step 6: Manual QA on the Vercel preview**

Walk through every item in design doc §8.4. Use one of the staging test users (e.g. `reviewer1@artpark.test`).

Specifically verify:
1. Sign in → land on `/reviewer/inbox`; cards appear in the right buckets.
2. Click `Score this →` → scoring page loads. **Open the browser DevTools network tab** — confirm `GET /reviewer/applications/...` returns `ai_screening: null`.
3. Fill 5 scores + recommendation → submit → page transitions to State B. **Confirm a second `GET /reviewer/applications/...` request fires** and now `ai_screening` is populated.
4. Edit a score → save → State B refreshes; verify `locked_at` is unchanged in the network response.
5. Optionally: in Supabase studio (or via SQL), manually backdate the `locked_at` to a time in the past, reload, confirm State C renders without an Edit button.
6. As a leadership user (`leadership@artpark.test`), open the same app → confirm the app's status chip is `EVALUATED` if all assigned reviewers have submitted.
7. Decline a different assignment → toast appears → card disappears. Check that an audit row was written.
8. Open `/reviewer/completed` → click a row → State C renders read-only.

- [ ] **Step 7: Lighthouse run (closes spec §14.10)**

Open `/reviewer/:track/:id/score` in Chrome → DevTools → Lighthouse → Mobile + Desktop. Record the Performance score.

Expected: ≥85 (target: ≥90 — no heavy JS, no images, no charts).

If below 85, investigate and either fix or document the gap as out-of-scope.

- [ ] **Step 8: Commit QA notes** (only if any tweaks made)

If any fixes were needed during manual QA, commit them with a clear `fix(reviewer): ...` message.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ §4.3 Inbox layout (Tasks 8-9): cards grouped, decline modal
- ✅ §4.4 Scoring page two-column + 3 states (Tasks 10-12)
- ✅ §4.4.5 anti-anchoring server-side (Task 3) + client defense-in-depth (Task 12 only renders AI in B/C)
- ✅ §4.5 Completed history (Task 13)
- ✅ §4.6 Decline modal (Task 9)
- ✅ §6 All 7 backend endpoints (Tasks 1-7)
- ✅ §8.1 backend tests (Tasks 1-7 each include test-first cycle)
- ✅ §8.2 frontend tests (Tasks 9, 10, 11, 12, 13)
- ✅ §8.3 acceptance criteria (Task 14 manual + Tasks 4 + 12 backend tests for §14.4)
- ✅ §8.5 anti-pattern grep (Task 14 step 5)

**No placeholders detected.** Every step has runnable code, exact paths, exact commands.

**Type consistency:**
- `INBOX_STATES` enum used across `inboxCardStates.js` and `ReviewerInboxPage.jsx` — consistent
- Backend route shapes match design doc §6.2-6.7 — verified
- `score_overall_mine` weights consistent between backend `_SCORE_WEIGHTS` and design doc §4.5
- `pickState` function in `ReviewerScoringPage.jsx` returns one of `"scoring"|"editable"|"locked"` matching the panel's `state` prop
