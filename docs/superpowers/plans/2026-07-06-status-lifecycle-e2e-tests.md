# Status-lifecycle end-to-end tests (TIR + VIP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hermetic pytest suite that drives an application through its full status lifecycle (submit → AI → under_review → evaluated → admin decision) and asserts the status at every hop, parametrized over both tracks (TIR and VIP/`sip`).

**Architecture:** A mutating, WHERE-aware in-memory `FakeSupabase` backs a `LifecycleDriver` that walks one application through the REAL code paths — real HTTP endpoints via FastAPI `TestClient` for the human-actor steps (submit, assign, reviewer-submit, admin-decide), and the real `pipeline.persist(...)` for the async AI step (canned scores, no LLM). `get_admin_client` is monkeypatched to the fake across every module in the path; auth is set via `app.dependency_overrides[get_current_user]`; SQS/email/audit are stubbed.

**Tech Stack:** Python, pytest, FastAPI `TestClient`, monkeypatch. Spec: `docs/superpowers/specs/2026-07-06-status-lifecycle-e2e-tests-design.md`.

**Design facts locked in (from the spec):**
- `submitted → under_review` is done by the AI worker (`pipeline.persist`), NOT by reviewer assignment.
- Assigning a reviewer inserts `reviewer_assignments` and does NOT change status.
- `under_review → evaluated` fires only when the LAST active assignment completes.
- Admin decision maps: Approve→`jury_review`, Reject→`rejected`, Hold→`on_hold`, Waitlist→`waitlisted`.
- Identical, track-agnostic logic for TIR and VIP; only the table name differs.

**Endpoints & shapes (verified):**
- TIR submit: `POST /applications/me/submit` (applicant). VIP submit: `POST /sip-applications/me/submit`.
- AI: `pipeline.persist(fake, app_id, track, result, advance_status=True)` (no endpoint).
- Assign: `POST /leadership/applications/{application_id}/reviewers`, body `{"reviewer_user_ids": [...], "due_at": null}` (needs a `user_roles` row `{user_id, role:"reviewer"}` + the app row).
- Reviewer submit: `POST /reviewer/reviews`, body `ReviewSubmitBody` (`application_id`, `application_track`, `assignment_id`, 5 scores, `recommendation`, `quick_notes`, `draft`).
- Admin decide: `POST /admin/platform/applications/{track}/{application_id}/decision`, body `{"decision": "...", "rationale": "..."}`.
- RBAC (`require_capability`) reads roles from the (overridden) `get_current_user`, so overriding it with the right `roles` satisfies the gate.

---

## File Structure

- **Create** `backend/tests/fixtures/fake_supabase.py` — the mutating, WHERE-aware fake client (reusable).
- **Create** `backend/tests/fixtures/__init__.py` if missing (package marker) — check first; `tests/` is already a package.
- **Create** `backend/tests/test_status_lifecycle_e2e.py` — the `LifecycleDriver`, shared fixtures, and all test cases (built up across tasks).

Run any single-file step with: `pytest tests/test_status_lifecycle_e2e.py -v --no-cov` (single-file runs need `--no-cov` for the coverage gate). Run the fake's own test with `pytest tests/test_fake_supabase.py -v --no-cov`.

---

## Task 1: Mutating WHERE-aware fake Supabase

**Files:**
- Create: `backend/tests/fixtures/fake_supabase.py`
- Test: `backend/tests/test_fake_supabase.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_fake_supabase.py
from tests.fixtures.fake_supabase import FakeSupabase


def test_update_is_readable_back():
    fake = FakeSupabase({"tir_applications": [{"id": "a1", "status": "submitted"}]})
    fake.table("tir_applications").update({"status": "under_review"}).eq("id", "a1").execute()
    row = fake.table("tir_applications").select("*").eq("id", "a1").execute().data[0]
    assert row["status"] == "under_review"


def test_eq_filters_selects():
    fake = FakeSupabase({"t": [{"id": "1", "k": "x"}, {"id": "2", "k": "y"}]})
    got = fake.table("t").select("*").eq("k", "y").execute().data
    assert [r["id"] for r in got] == ["2"]


def test_insert_appends_and_autoassigns_id():
    fake = FakeSupabase({"reviews": []})
    res = fake.table("reviews").insert({"application_id": "a1"}).execute()
    assert res.data[0]["id"]
    assert len(fake.tables["reviews"]) == 1


def test_maybe_single_returns_dict_or_none():
    fake = FakeSupabase({"t": [{"id": "1"}]})
    assert fake.table("t").select("*").eq("id", "1").maybe_single().execute().data == {"id": "1"}
    assert fake.table("t").select("*").eq("id", "nope").maybe_single().execute().data is None


def test_upsert_on_conflict_updates_existing():
    fake = FakeSupabase({"ai_screening": [{"application_id": "a1", "application_track": "tir", "score_overall": 1.0}]})
    fake.table("ai_screening").upsert(
        {"application_id": "a1", "application_track": "tir", "score_overall": 9.0},
        on_conflict="application_id,application_track",
    ).execute()
    rows = fake.tables["ai_screening"]
    assert len(rows) == 1 and rows[0]["score_overall"] == 9.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_fake_supabase.py -v --no-cov`
Expected: FAIL with `ModuleNotFoundError: tests.fixtures.fake_supabase`.

- [ ] **Step 3: Write the fake**

```python
# backend/tests/fixtures/fake_supabase.py
"""A WHERE-aware, MUTATING in-memory Supabase double for lifecycle tests.

Unlike the per-file _FakeAdminClient copies (which record inserts/updates but
never mutate stored rows and treat .eq() as a no-op on SELECT), this fake:
  * stores tables as dict[str, list[dict]]
  * honors .eq()/.in_()/.is_() filters on select/update/delete
  * actually mutates rows on update/upsert and appends on insert
  * supports maybe_single()/single(), limit()
so a caller can update a status and read it back — the property a full
status-lifecycle test depends on.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import uuid4


class _Query:
    def __init__(self, store: dict[str, list[dict]], name: str):
        self._store = store
        self._name = name
        self._rows = store.setdefault(name, [])
        self._mode = "select"
        self._payload: Any = None
        self._on_conflict: list[str] = []
        self._eqs: list[tuple[str, Any]] = []
        self._ins: list[tuple[str, list]] = []
        self._is_null: list[str] = []
        self._single: str | None = None  # None | "maybe" | "one"
        self._limit: int | None = None

    # chainable no-ops
    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def range(self, *_a, **_k): return self
    def or_(self, *_a, **_k): return self
    def not_(self): return self
    def neq(self, *_a, **_k): return self

    def limit(self, n): self._limit = n; return self
    def eq(self, col, val): self._eqs.append((col, val)); return self
    def in_(self, col, vals): self._ins.append((col, list(vals))); return self

    def is_(self, col, val):
        if val is None:
            self._is_null.append(col)
        return self

    def maybe_single(self): self._single = "maybe"; return self
    def single(self): self._single = "one"; return self

    def insert(self, payload): self._mode = "insert"; self._payload = payload; return self
    def update(self, payload): self._mode = "update"; self._payload = payload; return self
    def delete(self): self._mode = "delete"; return self

    def upsert(self, payload, on_conflict: str | None = None):
        self._mode = "upsert"
        self._payload = payload
        self._on_conflict = [c.strip() for c in on_conflict.split(",")] if on_conflict else []
        return self

    def _match(self, row) -> bool:
        for col, val in self._eqs:
            if row.get(col) != val:
                return False
        for col, vals in self._ins:
            if row.get(col) not in vals:
                return False
        for col in self._is_null:
            if row.get(col) is not None:
                return False
        return True

    def _result(self, data):
        if self._single in ("maybe", "one"):
            return SimpleNamespace(data=(data[0] if data else None), count=len(data))
        return SimpleNamespace(data=data, count=len(data))

    def execute(self):
        if self._mode == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for p in payloads:
                r = dict(p)
                r.setdefault("id", str(uuid4()))
                self._rows.append(r)
                inserted.append(r)
            return self._result(inserted)

        if self._mode == "update":
            hit = [r for r in self._rows if self._match(r)]
            for r in hit:
                r.update(self._payload)
            return self._result(hit)

        if self._mode == "upsert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            out = []
            for p in payloads:
                existing = None
                if self._on_conflict:
                    for r in self._rows:
                        if all(r.get(k) == p.get(k) for k in self._on_conflict):
                            existing = r
                            break
                if existing is not None:
                    existing.update(p)
                    out.append(existing)
                else:
                    r = dict(p)
                    r.setdefault("id", str(uuid4()))
                    self._rows.append(r)
                    out.append(r)
            return self._result(out)

        if self._mode == "delete":
            hit = [r for r in self._rows if self._match(r)]
            for r in hit:
                self._rows.remove(r)
            return self._result(hit)

        # select
        data = [r for r in self._rows if self._match(r)]
        if self._limit is not None:
            data = data[: self._limit]
        return self._result(data)


class FakeSupabase:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables: dict[str, list[dict]] = {
            k: [dict(r) for r in v] for k, v in (tables or {}).items()
        }

    def table(self, name: str) -> _Query:
        return _Query(self.tables, name)

    def row(self, table: str, _id: str) -> dict | None:
        return next((r for r in self.tables.get(table, []) if r.get("id") == _id), None)

    def status_of(self, track: str, _id: str) -> str | None:
        r = self.row(f"{track}_applications", _id)
        return r.get("status") if r else None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_fake_supabase.py -v --no-cov`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/fake_supabase.py tests/test_fake_supabase.py
git commit -m "test(fixtures): mutating WHERE-aware fake Supabase for lifecycle tests"
```

---

## Task 2: Test scaffold + `install_fake_db` + `LifecycleDriver.submit()` + A1 (submit → submitted)

**Files:**
- Create: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Write the failing test (scaffold + submit)**

```python
# backend/tests/test_status_lifecycle_e2e.py
"""End-to-end status-lifecycle tests for TIR + VIP.

Drives the REAL endpoints against a mutating FakeSupabase and asserts the
application status after every hop. See
docs/superpowers/specs/2026-07-06-status-lifecycle-e2e-tests-design.md.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase

APPLICANT = "11111111-1111-1111-1111-111111111111"
ADMIN = "22222222-2222-2222-2222-222222222222"
REVIEWER = "33333333-3333-3333-3333-333333333333"
REVIEWER2 = "44444444-4444-4444-4444-444444444444"


def _user(user_id, roles):
    def _f():
        return {"user_id": user_id, "email": f"{user_id}@x.com", "track": None, "roles": roles}
    return _f


def _as(user_id, roles):
    app.dependency_overrides[get_current_user] = _user(user_id, roles)


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _canned_score():
    """A ScoreResult stand-in with exactly the attrs pipeline.persist reads."""
    return SimpleNamespace(
        score_problem=5.0, score_solution=5.0, score_tech=5.0,
        score_founders=5.0, score_commitment=5.0, score_overall=5.0,
        summary="canned", raw_response="{}", model="test",
        new_industry_proposal=None, industry_confidence=None,
        industry_category_id=None, project_name="Test Project", sections=None,
    )


def install_fake_db(monkeypatch, fake: FakeSupabase):
    """Point get_admin_client at `fake` across every module the lifecycle
    touches, and neutralise side effects (SQS, email, audit, rate-limit,
    submit validation/completion). Keep _fetch_application/_update_application
    REAL so submit reads+writes status through the fake."""
    from app.routers import applications as tir_r
    from app.routers import sip_applications as sip_r
    from app.routers import reviewer as rv
    from app.routers import admin_platform as ap
    from app.routers import leadership_actions as la
    from app.services import reviewer_query, state_machine, decisions
    from app.services import decision_email
    from app.services.ai_pipeline import pipeline

    for mod in (tir_r, sip_r, rv, ap, la, reviewer_query, state_machine, decisions, pipeline):
        monkeypatch.setattr(mod, "get_admin_client", lambda: fake, raising=False)

    # No-op audit (each module imported it by name).
    for mod in (rv, la, decisions):
        monkeypatch.setattr(mod, "write_audit", lambda **k: None, raising=False)

    # Applicant email hook on decisions: spy so tests can assert it fired.
    calls = {"decision_email": []}
    monkeypatch.setattr(
        decisions.decision_email, "notify_applicant_decided",
        lambda sb, **k: calls["decision_email"].append(k), raising=False,
    )

    # Submit side effects (both tracks): rate-limit, audit, email, completion,
    # validation → stub; SQS publish → spy. Keep _fetch/_update REAL.
    published: list[tuple] = []
    for mod in (tir_r, sip_r):
        for name in ("check_rate", "record_rate"):
            monkeypatch.setattr(mod, name, lambda *a, **k: None, raising=False)
        monkeypatch.setattr(mod, "_audit", lambda **k: None, raising=False)
        monkeypatch.setattr(mod, "_send_submission_email", lambda **k: None, raising=False)
        monkeypatch.setattr(mod, "_completion_pct", lambda row: (100, []), raising=False)
        monkeypatch.setattr(mod, "_validate_submission", lambda row: ([], []), raising=False)
        monkeypatch.setattr(mod.sqs_publisher, "publish",
                            lambda aid, track: published.append((aid, track)), raising=False)

    return SimpleNamespace(fake=fake, published=published, calls=calls)


SUBMIT_PATH = {"tir": "/applications/me/submit", "sip": "/sip-applications/me/submit"}


class LifecycleDriver:
    """Walks ONE application through the lifecycle via real endpoints + persist."""

    def __init__(self, client, ctx, track: str, app_id: str):
        self.client = client
        self.ctx = ctx
        self.track = track
        self.app_id = app_id

    def status(self):
        return self.ctx.fake.status_of(self.track, self.app_id)

    def submit(self):
        _as(APPLICANT, [])
        r = self.client.post(SUBMIT_PATH[self.track])
        assert r.status_code in (200, 201), r.text
        return r


def _seed_draft(track: str, app_id: str) -> dict:
    """Minimal draft row the submit path can flip. _fetch_application looks up
    by user_id; _update_application writes status by id. Extra columns are
    harmless in the fake."""
    return {"id": app_id, "user_id": APPLICANT, "status": "draft", "track": track}


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A1_submit_sets_submitted(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit()

    assert d.status() == "submitted"
    assert ctx.published == [(app_id, track)]  # enqueued for AI screening
```

- [ ] **Step 2: Run test to verify it fails, then wire until green**

Run: `pytest tests/test_status_lifecycle_e2e.py -v --no-cov`
Expected first run: FAIL. Likely fix-ups during this task (resolve by reading the error, not guessing):
- If submit returns 422/409: confirm the seed `status == "draft"` and that `_validate_submission`/`_completion_pct` stubs match the real helper names in `app/routers/applications.py` and `app/routers/sip_applications.py` (mirror the stub list in `tests/test_sip_applications_submit.py` and `tests/test_applications.py`, but do NOT stub `_fetch_application`/`_update_application` — those must stay real so status lands in the fake).
- If `sqs_publisher` patch target is wrong: patch the attribute actually used at the call site (`<module>.sqs_publisher.publish`).

- [ ] **Step 3: Run to verify pass**

Run: `pytest tests/test_status_lifecycle_e2e.py -v --no-cov`
Expected: PASS (2 passed — tir + sip).

- [ ] **Step 4: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): harness + driver.submit + A1 submit->submitted (TIR+VIP)"
```

---

## Task 3: `run_ai()` + A2 (AI → under_review)

**Files:**
- Modify: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Add the driver method + failing test**

Add to `LifecycleDriver`:

```python
    def run_ai(self):
        # Simulate the SQS worker: the real persist() does the submitted->under_review write.
        from app.services.ai_pipeline import pipeline
        pipeline.persist(self.ctx.fake, self.app_id, self.track, _canned_score(), advance_status=True)
```

Add the test:

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A2_ai_screening_sets_under_review(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit()
    assert d.status() == "submitted"
    d.run_ai()
    assert d.status() == "under_review"
    # ai_screening row was written for this app+track.
    scr = fake.table("ai_screening").select("*").eq("application_id", app_id).eq("application_track", track).execute().data
    assert scr and scr[0]["score_overall"] == 5.0
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_status_lifecycle_e2e.py::test_A2_ai_screening_sets_under_review -v --no-cov`
Expected: FAIL (method missing) → after adding method, PASS. If `persist` raises on a missing attr, add it to `_canned_score()`.

- [ ] **Step 3: Run to verify pass**

Run: `pytest tests/test_status_lifecycle_e2e.py -v --no-cov`
Expected: PASS (all so far).

- [ ] **Step 4: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): driver.run_ai + A2 AI->under_review (TIR+VIP)"
```

---

## Task 4: `assign()` + A3 (assign reviewer → stays under_review)

**Files:**
- Modify: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Add driver method + failing test**

Add to `LifecycleDriver`:

```python
    def assign(self, reviewer_ids):
        # Reviewers must have a user_roles row; the assign endpoint checks it.
        for rid in reviewer_ids:
            self.ctx.fake.tables.setdefault("user_roles", []).append(
                {"user_id": rid, "role": "reviewer"})
        _as(ADMIN, ["leadership"])
        r = self.client.post(
            f"/leadership/applications/{self.app_id}/reviewers",
            json={"reviewer_user_ids": list(reviewer_ids), "due_at": None},
        )
        assert r.status_code == 200, r.text
        return r

    def assignment_id_for(self, reviewer_id):
        rows = self.ctx.fake.tables.get("reviewer_assignments", [])
        return next(a["id"] for a in rows
                    if a["application_id"] == self.app_id and a["reviewer_user_id"] == reviewer_id)
```

Add the test:

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A3_assign_reviewer_does_not_change_status(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit()
    d.run_ai()
    assert d.status() == "under_review"

    d.assign([REVIEWER])

    # THE KEY ASSERTION: assignment inserts a row but does NOT move status.
    assert d.status() == "under_review"
    assert len(fake.tables["reviewer_assignments"]) == 1
```

- [ ] **Step 2: Run to verify fail → wire → pass**

Run: `pytest tests/test_status_lifecycle_e2e.py::test_A3_assign_reviewer_does_not_change_status -v --no-cov`
Expected: FAIL then PASS. If the endpoint 404s, confirm `_resolve_app` finds the seeded app row (it queries the `{track}_applications` table for the id — the fake returns it). If reviewer comes back `not_a_reviewer`, confirm the `user_roles` seed row.

- [ ] **Step 3: Run whole file**

Run: `pytest tests/test_status_lifecycle_e2e.py -v --no-cov`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): driver.assign + A3 assignment does not change status (TIR+VIP)"
```

---

## Task 5: `submit_review()` + A4 (reviewer submits → evaluated) + A6 (full chain)

**Files:**
- Modify: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Add driver method + failing tests**

Add to `LifecycleDriver`:

```python
    def submit_review(self, reviewer_id, draft=False):
        _as(reviewer_id, ["reviewer"])
        body = {
            "application_id": self.app_id,
            "application_track": self.track,
            "assignment_id": self.assignment_id_for(reviewer_id),
            "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
            "score_founders": 7.0, "score_commitment": 7.0,
            "recommendation": "yes", "quick_notes": "solid", "draft": draft,
        }
        r = self.client.post("/reviewer/reviews", json=body)
        assert r.status_code in (200, 201), r.text
        return r

    def decide(self, decision, rationale="ok"):
        _as(ADMIN, ["admin"])
        r = self.client.post(
            f"/admin/platform/applications/{self.track}/{self.app_id}/decision",
            json={"decision": decision, "rationale": rationale},
        )
        return r
```

Add the tests:

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A4_last_reviewer_submits_sets_evaluated(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER])
    assert d.status() == "under_review"

    d.submit_review(REVIEWER)

    assert d.status() == "evaluated"


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A6_full_happy_path_chain(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit();          assert d.status() == "submitted"
    d.run_ai();          assert d.status() == "under_review"
    d.assign([REVIEWER]); assert d.status() == "under_review"
    d.submit_review(REVIEWER); assert d.status() == "evaluated"
    r = d.decide("jury_review"); assert r.status_code == 200, r.text
    assert d.status() == "jury_review"
```

- [ ] **Step 2: Run to verify fail → wire → pass**

Run: `pytest tests/test_status_lifecycle_e2e.py -k "A4 or A6" -v --no-cov`
Expected: FAIL then PASS. Common wiring: the reviewer submit endpoint reads the assignment by id and checks `reviewer_user_id == caller` and that it isn't already completed — the seeded assignment satisfies this. `auto_transition` reads `reviewer_assignments` for the app; the fake persisted `completed_at`, so with one assignment it flips to `evaluated`.

- [ ] **Step 3: Run whole file**

Run: `pytest tests/test_status_lifecycle_e2e.py -v --no-cov`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): reviewer-submit + decide drivers; A4 evaluated + A6 full chain (TIR+VIP)"
```

---

## Task 6: A5 (Approve → jury_review + admin_decisions + email hook)

**Files:**
- Modify: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Add failing test**

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A5_admin_approve_sets_jury_review(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER]); d.submit_review(REVIEWER)
    assert d.status() == "evaluated"

    r = d.decide("jury_review")
    assert r.status_code == 200, r.text
    assert d.status() == "jury_review"
    # admin_decisions row written (gate1)
    dec = fake.tables["admin_decisions"]
    assert dec and dec[0]["decision"] == "jury_review" and dec[0]["application_id"] == app_id
    # applicant email hook fired for jury_review
    assert any(c.get("decision") == "jury_review" for c in ctx.calls["decision_email"])
```

- [ ] **Step 2/3: Run fail → pass**

Run: `pytest tests/test_status_lifecycle_e2e.py::test_A5_admin_approve_sets_jury_review -v --no-cov`
Expected: PASS. (If `admin_decisions` isn't in the fake yet, it's created on first insert by the fake's `setdefault`.)

- [ ] **Step 4: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): A5 Approve->jury_review + admin_decisions + email hook (TIR+VIP)"
```

---

## Task 7: Group B — reviewer-completion edges

**Files:**
- Modify: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Add failing tests**

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_B1_B2_two_reviewers_only_flips_on_last(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER, REVIEWER2])

    d.submit_review(REVIEWER)               # 1 of 2
    assert d.status() == "under_review"     # B1: not all complete
    d.submit_review(REVIEWER2)              # 2 of 2
    assert d.status() == "evaluated"        # B2: last one flips it


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_B3_draft_review_does_not_flip(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER])
    d.submit_review(REVIEWER, draft=True)
    assert d.status() == "under_review"     # draft ≠ completion


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_B4_auto_transition_noop_when_not_under_review(client, monkeypatch, _clear, track):
    from app.services import state_machine
    app_id = f"app-{track}"
    fake = FakeSupabase({
        f"{track}_applications": [{"id": app_id, "user_id": APPLICANT, "status": "evaluated"}],
        "reviewer_assignments": [
            {"id": "as1", "application_id": app_id, "application_track": track,
             "reviewer_user_id": REVIEWER, "completed_at": "2026-07-01T00:00:00Z"}],
    })
    install_fake_db(monkeypatch, fake)
    fired = state_machine.auto_transition_to_evaluated_if_complete(app_id, track)
    assert fired is False
    assert fake.status_of(track, app_id) == "evaluated"  # unchanged


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_B5_auto_transition_noop_with_no_assignments(client, monkeypatch, _clear, track):
    from app.services import state_machine
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [
        {"id": app_id, "user_id": APPLICANT, "status": "under_review"}]})
    install_fake_db(monkeypatch, fake)
    fired = state_machine.auto_transition_to_evaluated_if_complete(app_id, track)
    assert fired is False
    assert fake.status_of(track, app_id) == "under_review"
```

- [ ] **Step 2/3: Run fail → pass**

Run: `pytest tests/test_status_lifecycle_e2e.py -k "B1 or B3 or B4 or B5" -v --no-cov`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): group B reviewer-completion edges (TIR+VIP)"
```

---

## Task 8: Group C — admin decision branches

**Files:**
- Modify: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Add failing tests**

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
@pytest.mark.parametrize("decision,expected", [
    ("rejected", "rejected"), ("on_hold", "on_hold"), ("waitlisted", "waitlisted"),
])
def test_C1_C2_C3_decision_branches(client, monkeypatch, _clear, track, decision, expected):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER]); d.submit_review(REVIEWER)
    assert d.status() == "evaluated"

    r = d.decide(decision, rationale="because")
    assert r.status_code == 200, r.text
    assert d.status() == expected
    if decision == "rejected":
        assert any(c.get("decision") == "rejected" for c in ctx.calls["decision_email"])


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_C4_reject_without_rationale_is_422_and_status_unchanged(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER]); d.submit_review(REVIEWER)
    r = d.decide("rejected", rationale="")
    assert r.status_code == 422
    assert d.status() == "evaluated"  # unchanged
```

- [ ] **Step 2/3: Run fail → pass**

Run: `pytest tests/test_status_lifecycle_e2e.py -k "C1 or C2 or C3 or C4" -v --no-cov`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): group C decision branches + rationale gate (TIR+VIP)"
```

---

## Task 9: Group D — skip / illegal transitions

**Files:**
- Modify: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Add failing tests**

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_D1_approve_directly_from_under_review(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai()
    assert d.status() == "under_review"       # no reviews at all
    r = d.decide("jury_review")
    assert r.status_code == 200, r.text
    assert d.status() == "jury_review"        # skipped evaluated


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_D2_reject_directly_from_submitted(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit()
    assert d.status() == "submitted"
    r = d.decide("rejected", rationale="out of scope")
    assert r.status_code == 200, r.text
    assert d.status() == "rejected"


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_D3_illegal_rewind_is_422_and_status_unchanged(client, monkeypatch, _clear, track):
    from app.services import state_machine
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [
        {"id": app_id, "user_id": APPLICANT, "status": "evaluated"}]})
    install_fake_db(monkeypatch, fake)
    with pytest.raises(Exception) as exc:
        state_machine.apply_status_change(app_id, track, to_status="submitted", changed_by=ADMIN)
    # HTTPException 422 illegal_transition
    assert getattr(exc.value, "status_code", None) == 422
    assert fake.status_of(track, app_id) == "evaluated"  # unchanged
```

- [ ] **Step 2/3: Run fail → pass**

Run: `pytest tests/test_status_lifecycle_e2e.py -k "D1 or D2 or D3" -v --no-cov`
Expected: PASS. (`apply_status_change` raises `fastapi.HTTPException`; assert on `status_code`.)

- [ ] **Step 4: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): group D skip + illegal transitions (TIR+VIP)"
```

---

## Task 10: Group E (AI idempotency) + Group F (TIR≡VIP parity + correct table)

**Files:**
- Modify: `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Add failing tests**

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_E1_ai_on_non_submitted_row_is_idempotent(client, monkeypatch, _clear, track):
    """The worker skips non-submitted rows. Simulate by only advancing when
    the app is 'submitted' (matches handler.py guard)."""
    from app.services.ai_pipeline import pipeline
    from app.workers.ai_screener import handler  # noqa: F401  (import path check)
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [
        {"id": app_id, "user_id": APPLICANT, "status": "evaluated"}]})
    install_fake_db(monkeypatch, fake)
    # Directly exercising persist(advance_status=True) is the worker's action AFTER
    # its 'submitted' guard; the guard itself lives in handler._process_record.
    # Assert the guard: worker must NOT screen a non-submitted row.
    from app.workers.ai_screener.handler import _process_record
    monkeypatch.setattr(handler, "get_admin_client", lambda: fake, raising=False)
    _process_record({"body": {"application_id": app_id, "application_track": track}})
    assert fake.status_of(track, app_id) == "evaluated"  # unchanged; not re-screened


def test_F1_F2_track_parity_and_correct_table(client, monkeypatch, _clear):
    """Same action sequence yields the same status at each hop for both tracks,
    and writes land in the correct per-track table only."""
    seq_status = {}
    for track in ("tir", "sip"):
        app_id = f"app-{track}"
        other = "sip" if track == "tir" else "tir"
        fake = FakeSupabase({
            f"{track}_applications": [_seed_draft(track, app_id)],
            f"{other}_applications": [],
        })
        ctx = install_fake_db(monkeypatch, fake)
        d = LifecycleDriver(client, ctx, track, app_id)

        hops = []
        d.submit(); hops.append(d.status())
        d.run_ai(); hops.append(d.status())
        d.assign([REVIEWER]); hops.append(d.status())
        d.submit_review(REVIEWER); hops.append(d.status())
        d.decide("jury_review"); hops.append(d.status())
        seq_status[track] = hops

        # F2: the other track's table was never written.
        assert fake.tables[f"{other}_applications"] == []
        app.dependency_overrides.clear()

    # F1: identical status sequence for both tracks.
    assert seq_status["tir"] == seq_status["sip"] == [
        "submitted", "under_review", "under_review", "evaluated", "jury_review"]
```

- [ ] **Step 2/3: Run fail → pass**

Run: `pytest tests/test_status_lifecycle_e2e.py -k "E1 or F1" -v --no-cov`
Expected: PASS. For E1, confirm the correct import path for the worker (`app.workers.ai_screener.handler`) and that `_process_record` reads its client via `handler.get_admin_client` (patch it). If the worker imports `get_admin_client` differently, patch the actual name it uses.

- [ ] **Step 4: Run the FULL suite**

Run: `pytest tests/test_status_lifecycle_e2e.py tests/test_fake_supabase.py -v --no-cov`
Expected: ALL PASS (both tracks across every group).

- [ ] **Step 5: Regression — run the broader backend suite**

Run: `pytest -q` (full suite, with coverage gate)
Expected: no new failures introduced.

- [ ] **Step 6: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(lifecycle): group E AI idempotency + group F TIR/VIP parity (TIR+VIP)"
```

---

## Self-review notes (spec coverage)

- A1–A6 ⇒ Tasks 2–6 (spine, incl. A3 assignment-no-status and A6 full chain).
- B1–B5 ⇒ Task 7. C1–C4 ⇒ Task 8. D1–D3 ⇒ Task 9. E1 + F1/F2 ⇒ Task 10.
- Group G (frontend display) is referenced in the spec as covered by existing vitest
  tests (`adminDataAdapter` CHIP_META, `AdminPipeline.juryLabel`); not rebuilt here.
- Type/name consistency: `LifecycleDriver` methods (`submit`, `run_ai`, `assign`,
  `assignment_id_for`, `submit_review`, `decide`, `status`) are defined in Tasks
  2–5 and reused verbatim thereafter; `install_fake_db` returns
  `SimpleNamespace(fake, published, calls)` used consistently.
- Known confirm-at-implementation points (resolve via the TDD run→fix loop, not
  guessing): exact submit validation/helper names per track (Task 2), exact
  `sqs_publisher.publish` patch target, and the AI worker's `get_admin_client`
  import name (Task 10 E1).
