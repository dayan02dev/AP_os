# Multi-batch Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one application belong to many batches and one reviewer belong to many batches, so an app is reviewed by the union of its batches' reviewers — with provenance-aware "smart remove".

**Architecture:** New `batch_reviewers(batch_id, reviewer_user_id)` table is the source of truth for reviewer↔batch membership. `application_batches` is relaxed to many-to-many (mig 034, already applied to prod). `reviewer_assignments` is unchanged in shape and stays the reviewer-queue truth — it is derived = (union of `batch_reviewers` over the app's batches) ∪ manual assignments. A new `services/batch_membership.py` module owns the add/remove/reconcile engine.

**Tech Stack:** FastAPI + Supabase (PostgREST) backend on Lambda; React/Vite admin SPA; pytest with `backend/tests/fixtures/fake_supabase.py` (mutating, WHERE-aware double).

**Deploy urgency:** mig 034 is live in prod → `POST /admin/platform/batches/{id}/applications` currently 500s (`ON CONFLICT (application_id, application_track)` no longer resolvable). Phase 1 (backend) + SAM deploy closes that window. Phase 2 (frontend) can follow.

**Working dir:** `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-multi-batch-allocation` (branch `feat/multi-batch-allocation`).

**Test runner note:** single-file backend runs need `--no-cov` (repo has ~19 pre-existing unrelated failures under full-suite coverage gating). Run new tests as `pytest backend/tests/<file> --no-cov -v`.

---

## Phase 1 — Backend membership + reconcile engine

### Task 1: `batch_membership.py` — primitives + smart-remove engine

**Files:**
- Create: `backend/app/services/batch_membership.py`
- Test: `backend/tests/test_batch_membership.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_batch_membership.py
from app.services import batch_membership as bm
from tests.fixtures.fake_supabase import FakeSupabase


def _seed():
    return FakeSupabase({
        "batches": [{"id": "A", "name": "Batch A"}, {"id": "B", "name": "Batch B"}],
        "batch_reviewers": [
            {"batch_id": "A", "reviewer_user_id": "r1"},
            {"batch_id": "A", "reviewer_user_id": "shared"},
            {"batch_id": "B", "reviewer_user_id": "r2"},
            {"batch_id": "B", "reviewer_user_id": "shared"},
        ],
        "application_batches": [],
        "reviewer_assignments": [],
        "reviews": [],
        "tir_applications": [{"id": "app1", "status": "submitted"}],
    })


def test_add_apps_to_batch_fans_out_batch_reviewers():
    sb = _seed()
    res = bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    assigned = {(a["reviewer_user_id"]) for a in sb.tables["reviewer_assignments"]}
    assert assigned == {"r1", "shared"}          # only Batch A's reviewers
    assert res["assignments_created"] == 2
    # app is now linked to A
    assert any(l["batch_id"] == "A" and l["application_id"] == "app1"
               for l in sb.tables["application_batches"])


def test_app_in_two_batches_gets_union_of_reviewers():
    sb = _seed()
    bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    bm.add_apps_to_batch(sb, "B", [("app1", "tir")], actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert assigned == {"r1", "r2", "shared"}    # union across A and B


def test_smart_remove_keeps_shared_reviewer_drops_exclusive():
    sb = _seed()
    bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    bm.add_apps_to_batch(sb, "B", [("app1", "tir")], actor="admin")
    res = bm.remove_app_from_batch(sb, "B", "app1", "tir", actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    # r2 was exclusive to B → removed; shared still supplied by A → kept; r1 kept
    assert assigned == {"r1", "shared"}
    assert res["assignments_removed"] == 1
    assert not any(l["batch_id"] == "B" and l["application_id"] == "app1"
                   for l in sb.tables["application_batches"])


def test_smart_remove_never_drops_submitted_reviewer():
    sb = _seed()
    bm.add_apps_to_batch(sb, "B", [("app1", "tir")], actor="admin")
    sb.tables["reviews"].append({
        "application_id": "app1", "application_track": "tir",
        "reviewer_user_id": "r2", "submitted_at": "2026-07-01T00:00:00Z",
        "status": "submitted",
    })
    res = bm.remove_app_from_batch(sb, "B", "app1", "tir", actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert "r2" in assigned                        # submitted review → protected
    assert res["skipped_submitted"] == 1


def test_remove_reviewer_from_batch_smart():
    sb = _seed()
    bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    bm.add_apps_to_batch(sb, "B", [("app1", "tir")], actor="admin")
    # remove "shared" from batch B → still in A for app1 → assignment kept
    res = bm.remove_reviewer_from_batch(sb, "B", "shared", actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert "shared" in assigned
    assert ("B", "shared") not in {(m["batch_id"], m["reviewer_user_id"])
                                   for m in sb.tables["batch_reviewers"]}
    # remove "r2" from B → r2 exclusive to B for app1 → assignment dropped
    bm.remove_reviewer_from_batch(sb, "B", "r2", actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert "r2" not in assigned
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_batch_membership.py --no-cov -v`
Expected: FAIL — `ModuleNotFoundError: app.services.batch_membership`.

- [ ] **Step 3: Implement the module**

```python
# backend/app/services/batch_membership.py
"""Reviewer↔batch membership + application↔batch reconcile engine.

`batch_reviewers` is the source of truth for which reviewers belong to a batch.
`application_batches` is many-to-many (an app may be in many batches). The
effective reviewer set for an app = union of batch_reviewers over the app's
batches (∪ manual assignments, which this module never touches unless they
coincide with a batch member). reviewer_assignments is the derived queue truth.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger("app.batch_membership")


# ─── primitives ──────────────────────────────────────────────────────────
def batch_reviewer_ids(sb: Any, batch_id: str) -> set[str]:
    rows = (sb.table("batch_reviewers").select("reviewer_user_id")
            .eq("batch_id", batch_id).execute().data) or []
    return {r["reviewer_user_id"] for r in rows
            if r.get("batch_id", batch_id) == batch_id and r.get("reviewer_user_id")}


def app_batch_ids(sb: Any, app_id: str, track: str) -> set[str]:
    rows = (sb.table("application_batches").select("batch_id")
            .eq("application_id", app_id).eq("application_track", track)
            .execute().data) or []
    return {r["batch_id"] for r in rows if r.get("batch_id")}


def apps_in_batch(sb: Any, batch_id: str) -> list[tuple[str, str]]:
    rows = (sb.table("application_batches")
            .select("application_id,application_track,batch_id")
            .eq("batch_id", batch_id).execute().data) or []
    return [(r["application_id"], r["application_track"]) for r in rows
            if r.get("batch_id") == batch_id and r.get("application_id")
            and r.get("application_track")]


def reviewers_via_batches(sb: Any, batch_ids: set[str]) -> set[str]:
    out: set[str] = set()
    for b in batch_ids:
        out |= batch_reviewer_ids(sb, b)
    return out


def has_submitted_review(sb: Any, app_id: str, track: str, reviewer_id: str) -> bool:
    for rv in (sb.table("reviews").select("*")
               .eq("reviewer_user_id", reviewer_id).execute().data) or []:
        if (rv.get("application_id") == app_id
                and rv.get("application_track") == track
                and rv.get("reviewer_user_id") == reviewer_id
                and (rv.get("submitted_at") or rv.get("status") == "submitted")):
            return True
    return False


def _ensure_assignment(sb: Any, app_id: str, track: str, reviewer_id: str,
                       assigned_by: str, existing: set[tuple[str, str, str]]) -> dict | None:
    key = (app_id, track, reviewer_id)
    if key in existing:
        return None
    row = {
        "application_id": app_id, "application_track": track,
        "reviewer_user_id": reviewer_id, "assigned_by": assigned_by,
        "assigned_at": datetime.now(UTC).isoformat(),
        "state": "pending", "due_at": None,
    }
    sb.table("reviewer_assignments").upsert(
        [row], on_conflict="application_id,application_track,reviewer_user_id",
        ignore_duplicates=True,
    ).execute()
    existing.add(key)
    return row


def _existing_assignment_keys(sb: Any) -> set[tuple[str, str, str]]:
    from app.services.admin_query import iter_assignment_rows
    return {(a.get("application_id"), a.get("application_track"),
             a.get("reviewer_user_id")) for a in iter_assignment_rows(sb)}


def _advance(app_id: str, track: str) -> None:
    from app.services import state_machine
    try:
        state_machine.advance_to_under_review_on_assignment(app_id, track)
    except Exception:
        log.warning("advance_to_under_review failed",
                    extra={"application_id": app_id, "track": track})


# ─── operations ──────────────────────────────────────────────────────────
def add_apps_to_batch(sb: Any, batch_id: str, items: list[tuple[str, str]],
                      *, actor: str) -> dict[str, Any]:
    """Append apps to a batch and fan out the batch's reviewers to them."""
    now = datetime.now(UTC).isoformat()
    sb.table("application_batches").upsert(
        [{"application_id": aid, "application_track": track,
          "batch_id": batch_id, "added_at": now} for (aid, track) in items],
        on_conflict="application_id,application_track,batch_id",
        ignore_duplicates=True,
    ).execute()

    reviewers = batch_reviewer_ids(sb, batch_id)
    existing = _existing_assignment_keys(sb)
    created: list[dict] = []
    for (aid, track) in items:
        for rid in reviewers:
            row = _ensure_assignment(sb, aid, track, rid, actor, existing)
            if row:
                created.append(row)
        _advance(aid, track)
    return {
        "assigned": len(items),
        "assignments_created": len(created),
        "reviewers_notified": len({r["reviewer_user_id"] for r in created}),
        "created_rows": created,
    }


def remove_app_from_batch(sb: Any, batch_id: str, app_id: str, track: str,
                          *, actor: str) -> dict[str, Any]:
    """Detach app from ONE batch; drop that batch's reviewers unless another of
    the app's remaining batches still supplies them (or they have a submitted
    review)."""
    sb.table("application_batches").delete() \
        .eq("application_id", app_id).eq("application_track", track) \
        .eq("batch_id", batch_id).execute()

    remaining = reviewers_via_batches(sb, app_batch_ids(sb, app_id, track))
    candidates = batch_reviewer_ids(sb, batch_id)
    removed = 0
    skipped = 0
    for rid in candidates - remaining:
        if has_submitted_review(sb, app_id, track, rid):
            skipped += 1
            continue
        res = sb.table("reviewer_assignments").delete() \
            .eq("application_id", app_id).eq("application_track", track) \
            .eq("reviewer_user_id", rid).execute()
        removed += len(res.data or [])
    return {"removed": 1, "assignments_removed": removed,
            "skipped_submitted": skipped}


def remove_reviewer_from_batch(sb: Any, batch_id: str, reviewer_id: str,
                               *, actor: str) -> dict[str, Any]:
    """Remove a reviewer's batch membership; drop their assignments on the
    batch's apps unless another of each app's batches still supplies them (or a
    review was submitted)."""
    sb.table("batch_reviewers").delete() \
        .eq("batch_id", batch_id).eq("reviewer_user_id", reviewer_id).execute()

    removed = 0
    skipped = 0
    for (aid, track) in apps_in_batch(sb, batch_id):
        others = app_batch_ids(sb, aid, track) - {batch_id}
        if reviewer_id in reviewers_via_batches(sb, others):
            continue
        if has_submitted_review(sb, aid, track, reviewer_id):
            skipped += 1
            continue
        res = sb.table("reviewer_assignments").delete() \
            .eq("application_id", aid).eq("application_track", track) \
            .eq("reviewer_user_id", reviewer_id).execute()
        removed += len(res.data or [])
    return {"removed": removed, "skipped_submitted": skipped}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_batch_membership.py --no-cov -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/batch_membership.py backend/tests/test_batch_membership.py
git commit -m "feat(batches): batch_membership reconcile engine (union + smart remove)"
```

---

### Task 2: Wire add-apps endpoint to the engine

**Files:**
- Modify: `backend/app/routers/admin_platform.py:338-462` (`assign_applications`)
- Test: `backend/tests/test_admin_platform_batches.py` (new)

- [ ] **Step 1: Write the failing endpoint test** — assert that adding an app to a batch fans out `batch_reviewers` and no longer relies on the dropped constraint.

```python
# backend/tests/test_admin_platform_batches.py
import pytest
from app.routers import admin_platform
from app.services import admin_query
from tests.fixtures.fake_supabase import FakeSupabase


class _Body:
    def __init__(self, items): self.items = [type("I", (), {"application_id": a, "track": t}) for a, t in items]


@pytest.fixture(autouse=True)
def _patch(monkeypatch):
    sb = FakeSupabase({
        "batches": [{"id": "A", "name": "Batch A"}],
        "batch_reviewers": [{"batch_id": "A", "reviewer_user_id": "r1"}],
        "application_batches": [], "reviewer_assignments": [], "reviews": [],
        "tir_applications": [{"id": "app1", "status": "submitted"}],
    })
    monkeypatch.setattr(admin_platform, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_platform, "notify_reviewers_assigned", lambda *a, **k: None)
    monkeypatch.setattr(admin_platform, "write_audit", lambda *a, **k: None)
    return sb


async def test_assign_applications_appends_and_fans_out(_patch):
    out = await admin_platform.assign_applications(
        "A", _Body([("app1", "tir")]), user={"user_id": "admin", "roles": ["admin"]})
    assert out["assigned"] == 1
    assert out["assignments_created"] == 1
    assert {a["reviewer_user_id"] for a in _patch.tables["reviewer_assignments"]} == {"r1"}
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && pytest tests/test_admin_platform_batches.py::test_assign_applications_appends_and_fans_out --no-cov -v`
Expected: FAIL (current code uses inference fan-out + `on_conflict="application_id,application_track"`).

- [ ] **Step 3: Replace the body of `assign_applications`** (keep signature/route/404 check). Replace the upsert + inference block (lines ~356-449) with a delegation to the engine:

```python
    sb = get_admin_client()
    existing = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "batch_not_found"})

    from app.services import batch_membership
    items = [(item.application_id, item.track) for item in body.items]
    result = batch_membership.add_apps_to_batch(sb, batch_id, items, actor=user["user_id"])
    if result["created_rows"]:
        notify_reviewers_assigned(sb, result["created_rows"])

    write_audit(
        actor_user_id=user["user_id"], actor_role=actor_role_of(user),
        action_type="batch_applications_assigned", target_table="application_batches",
        target_id=batch_id,
        after={"count": result["assigned"],
               "assignments_created": result["assignments_created"],
               "reviewers_notified": result["reviewers_notified"]},
    )
    return {"assigned": result["assigned"],
            "assignments_created": result["assignments_created"],
            "reviewers_notified": result["reviewers_notified"]}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && pytest tests/test_admin_platform_batches.py --no-cov -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/admin_platform.py backend/tests/test_admin_platform_batches.py
git commit -m "feat(batches): add-apps appends to batch + fans out batch_reviewers"
```

---

### Task 3: New smart per-batch app-removal endpoint

**Files:**
- Modify: `backend/app/routers/admin_platform.py` (add route after `assign_applications`)
- Test: `backend/tests/test_admin_platform_batches.py` (add case)

- [ ] **Step 1: Write failing test**

```python
async def test_remove_app_from_one_batch_smart(monkeypatch):
    from app.routers import admin_platform
    sb = FakeSupabase({
        "batches": [{"id": "A", "name": "A"}, {"id": "B", "name": "B"}],
        "batch_reviewers": [{"batch_id": "A", "reviewer_user_id": "r1"},
                            {"batch_id": "B", "reviewer_user_id": "r2"}],
        "application_batches": [
            {"application_id": "app1", "application_track": "tir", "batch_id": "A"},
            {"application_id": "app1", "application_track": "tir", "batch_id": "B"}],
        "reviewer_assignments": [
            {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r1"},
            {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r2"}],
        "reviews": [],
    })
    monkeypatch.setattr(admin_platform, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_platform, "write_audit", lambda *a, **k: None)
    out = await admin_platform.remove_applications_from_batch(
        "B", type("B", (), {"items": [type("I", (), {"application_id": "app1", "track": "tir"})]})(),
        user={"user_id": "admin", "roles": ["admin"]})
    assert out["assignments_removed"] == 1
    assert {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]} == {"r1"}
```

- [ ] **Step 2: Run to verify fail** — `AttributeError: remove_applications_from_batch`.

- [ ] **Step 3: Add the route** (reuse the existing `BatchAssign` body model):

```python
@router.post(
    "/batches/{batch_id}/applications/remove",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def remove_applications_from_batch(
    batch_id: str, body: BatchAssign, user: dict = Depends(get_current_user),
) -> dict:
    """Detach applications from ONE batch (smart remove — keeps reviewers still
    supplied by the app's other batches; never removes a submitted reviewer)."""
    sb = get_admin_client()
    from app.services import batch_membership
    removed = 0
    skipped = 0
    for item in body.items:
        r = batch_membership.remove_app_from_batch(
            sb, batch_id, item.application_id, item.track, actor=user["user_id"])
        removed += r["assignments_removed"]
        skipped += r["skipped_submitted"]
    write_audit(
        actor_user_id=user["user_id"], actor_role=actor_role_of(user),
        action_type="batch_applications_removed", target_table="application_batches",
        target_id=batch_id,
        after={"count": len(body.items), "assignments_removed": removed,
               "skipped_submitted": skipped})
    return {"removed": len(body.items), "assignments_removed": removed,
            "skipped_submitted": skipped}
```

- [ ] **Step 4: Run to verify pass.**  `cd backend && pytest tests/test_admin_platform_batches.py --no-cov -v`

- [ ] **Step 5: Commit** — `feat(batches): POST /batches/{id}/applications/remove (smart per-batch detach)`

---

### Task 4: `assign_reviewers_to_batch` writes `batch_reviewers`

**Files:**
- Modify: `backend/app/services/admin_query.py:1098-1180` (`assign_reviewers_to_batch`)
- Test: `backend/tests/test_batch_membership.py` (add case)

- [ ] **Step 1: Failing test** — after assigning reviewers to a batch, they appear in `batch_reviewers` AND are fanned out to the batch's apps.

```python
def test_assign_reviewers_to_batch_writes_membership():
    from app.services import admin_query
    sb = FakeSupabase({
        "batches": [{"id": "A", "name": "A"}],
        "batch_reviewers": [],
        "application_batches": [{"application_id": "app1", "application_track": "tir", "batch_id": "A"}],
        "reviewer_assignments": [], "reviews": [],
        "tir_applications": [{"id": "app1", "status": "submitted"}],
    })
    admin_query.assign_reviewers_to_batch(sb, "A", ["r1", "r2"], assigned_by="admin")
    members = {(m["batch_id"], m["reviewer_user_id"]) for m in sb.tables["batch_reviewers"]}
    assert members == {("A", "r1"), ("A", "r2")}
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert assigned == {"r1", "r2"}
```

- [ ] **Step 2: Run to verify fail** (no `batch_reviewers` rows written today).

- [ ] **Step 3: Add a membership upsert at the top of `assign_reviewers_to_batch`** (right after `reviewer_ids = list(dict.fromkeys(reviewer_user_ids))`):

```python
    now_iso = datetime.now(UTC).isoformat()
    if reviewer_ids:
        sb.table("batch_reviewers").upsert(
            [{"batch_id": batch_id, "reviewer_user_id": rid,
              "added_by": assigned_by, "added_at": now_iso} for rid in reviewer_ids],
            on_conflict="batch_id,reviewer_user_id", ignore_duplicates=True,
        ).execute()
```

(The existing fan-out that creates reviewer_assignments for apps-in-batch stays.)

- [ ] **Step 4: Run to verify pass.** `cd backend && pytest tests/test_batch_membership.py --no-cov -v`

- [ ] **Step 5: Commit** — `feat(batches): assign_reviewers_to_batch records batch_reviewers membership`

---

### Task 5: `unassign_batch_reviewer` becomes membership-aware smart remove

**Files:**
- Modify: `backend/app/routers/admin_platform.py:558-627` (`unassign_batch_reviewer`)
- Test: `backend/tests/test_admin_platform_batches.py` (add case)

- [ ] **Step 1: Failing test** — a reviewer removed from batch B keeps their assignment on an app also in batch A (if A supplies them).

```python
async def test_unassign_batch_reviewer_is_membership_aware(monkeypatch):
    from app.routers import admin_platform
    sb = FakeSupabase({
        "batches": [{"id": "A", "name": "A"}, {"id": "B", "name": "B"}],
        "batch_reviewers": [{"batch_id": "A", "reviewer_user_id": "shared"},
                            {"batch_id": "B", "reviewer_user_id": "shared"}],
        "application_batches": [
            {"application_id": "app1", "application_track": "tir", "batch_id": "A"},
            {"application_id": "app1", "application_track": "tir", "batch_id": "B"}],
        "reviewer_assignments": [
            {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "shared"}],
        "reviews": [],
    })
    monkeypatch.setattr(admin_platform, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_platform, "write_audit", lambda *a, **k: None)
    out = await admin_platform.unassign_batch_reviewer(
        "B", "shared", user={"user_id": "admin", "roles": ["admin"]})
    assert {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]} == {"shared"}
    assert ("B", "shared") not in {(m["batch_id"], m["reviewer_user_id"])
                                   for m in sb.tables["batch_reviewers"]}
```

- [ ] **Step 2: Run to verify fail** (current code removes the assignment outright).

- [ ] **Step 3: Replace the body** (keep signature/route/404) with delegation:

```python
    sb = get_admin_client()
    existing_batch = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing_batch:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "batch_not_found"})
    from app.services import batch_membership
    result = batch_membership.remove_reviewer_from_batch(
        sb, batch_id, reviewer_user_id, actor=user["user_id"])
    write_audit(
        actor_user_id=user["user_id"], actor_role=actor_role_of(user),
        action_type="batch_reviewers_unassigned", target_table="batches",
        target_id=batch_id,
        after={"reviewer_user_id": reviewer_user_id, "removed": result["removed"],
               "skipped_submitted": result["skipped_submitted"]})
    return {"removed": result["removed"], "skipped_submitted": result["skipped_submitted"]}
```

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** — `feat(batches): batch-reviewer unassign is membership-aware (keeps shared coverage)`

---

### Task 6: `_fetch_batches` returns a list; pipeline emits `batches`

**Files:**
- Modify: `backend/app/services/admin_query.py:125-183` (`_fetch_batches`) and its consumer in `fetch_pipeline`
- Test: `backend/tests/test_admin_platform_batches.py` (add case)

- [ ] **Step 1: Failing test** — an app in two batches yields a `batches` list of length 2.

```python
def test_fetch_batches_returns_list_per_app():
    from app.services import admin_query
    sb = FakeSupabase({
        "batches": [{"id": "A", "name": "Batch A"}, {"id": "B", "name": "Batch B"}],
        "application_batches": [
            {"application_id": "app1", "application_track": "tir", "batch_id": "A"},
            {"application_id": "app1", "application_track": "tir", "batch_id": "B"}],
    })
    import app.services.admin_query as aq
    aq.get_admin_client = lambda: sb  # monkeypatch module-level
    out = admin_query._fetch_batches([("tir", "app1")])
    names = sorted(b["name"] for b in out[("tir", "app1")])
    assert names == ["Batch A", "Batch B"]
```

- [ ] **Step 2: Run to verify fail** (returns a single dict today).

- [ ] **Step 3: Change `_fetch_batches`** to accumulate a list per key and resolve names for all:

```python
def _fetch_batches(pairs):
    """Resolve (track, id) → [ {"id","name"}, ... ] (an app may be in many batches)."""
    out: dict[tuple[str, str], list[dict[str, Any]]] = {}
    if not pairs:
        return out
    links: dict[tuple[str, str], list[str]] = {}
    for track, ids in _by_track(pairs).items():
        if not ids:
            continue
        try:
            res = (get_admin_client().table("application_batches")
                   .select("application_id,batch_id").eq("application_track", track)
                   .in_("application_id", ids).execute())
        except Exception as exc:
            log.warning("admin_query._fetch_batches links failed",
                        extra={"track": track, "err": str(exc)})
            continue
        for row in res.data or []:
            aid, bid = row.get("application_id"), row.get("batch_id")
            if aid and bid:
                links.setdefault((track, aid), []).append(bid)
    needed = {b for bl in links.values() for b in bl}
    names: dict[str, str] = {}
    if needed:
        try:
            res = (get_admin_client().table("batches").select("id,name")
                   .in_("id", list(needed)).execute())
            for row in res.data or []:
                names[row["id"]] = row.get("name")
        except Exception as exc:
            log.warning("admin_query._fetch_batches names failed", extra={"err": str(exc)})
    for key, bids in links.items():
        out[key] = [{"id": b, "name": names.get(b)} for b in bids]
    return out
```

- [ ] **Step 3b: Update `fetch_pipeline`** where it reads the batch map: emit both a `batches` list and a back-compat scalar `batch` (first name). Find the line that does `batch_map.get((track, id))` and set:

```python
        b_list = batch_map.get((track, aid)) or []
        row["batches"] = b_list
        row["batch"] = (b_list[0]["name"] if b_list else None)
```

- [ ] **Step 4: Run to verify pass** — new test + `pytest backend/tests/ -k pipeline --no-cov`.

- [ ] **Step 5: Commit** — `feat(batches): pipeline returns a batches[] list per application`

---

### Task 7: Regression — Gate-1 reject clears a multi-batch app

**Files:**
- Test only: `backend/tests/test_batch_membership.py` (add case). `detach_application_from_review` already deletes by `(app, track)` with no batch filter, so it should handle N batch links.

- [ ] **Step 1: Add test**

```python
def test_reject_detaches_all_batch_links():
    from app.services.applications_query import detach_application_from_review
    sb = FakeSupabase({
        "application_batches": [
            {"application_id": "app1", "application_track": "tir", "batch_id": "A"},
            {"application_id": "app1", "application_track": "tir", "batch_id": "B"}],
        "reviewer_assignments": [
            {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r1"},
            {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r2"}],
    })
    res = detach_application_from_review(sb, "app1", "tir", remove_batch_link=True)
    assert sb.tables["application_batches"] == []
    assert sb.tables["reviewer_assignments"] == []
    assert res["batch_links_removed"] == 2
```

- [ ] **Step 2: Run.** If it passes, no code change (expected). If the fake's delete only removes one row, that's a fixture limitation — verify against real PostgREST semantics (delete removes all matching) and adjust the fake if needed, not the prod code.

- [ ] **Step 3: Commit** — `test(batches): reject detaches all batch links for a multi-batch app`

---

### Task 8: Backend full-suite check + deploy gate

- [ ] **Step 1:** `cd backend && pytest tests/test_batch_membership.py tests/test_admin_platform_batches.py --no-cov -v` → all green.
- [ ] **Step 2:** Run existing batch/roster/status suites for regressions: `pytest tests/ -k "batch or roster or status or assignment" --no-cov -q`.
- [ ] **Step 3: Deploy backend to prod** from this worktree: `bash infra/sam/deploy-prod.sh` (verify `.env.prod` keeps both intake-closed flags true first — grep `SUBMISSIONS_CLOSED`). This closes the 500 window.
- [ ] **Step 4: Smoke prod** — `POST /admin/platform/batches/{id}/applications` returns 200 (was 500). Confirm add-same-app-to-two-batches works.
- [ ] **Step 5: Commit any deploy notes.**

---

## Phase 2 — Frontend multi-batch UI

### Task 9: API wrapper + adapter for `batches[]`

**Files:**
- Modify: `frontend/src/lib/adminPlatformApi.js` (add `removeAppFromBatch`)
- Modify: `frontend/src/lib/adminDataAdapter.js:63-81` (`adaptPipelineRow` → `batches`)

- [ ] **Step 1:** Add wrapper after `assignBatch` (line 48):

```js
  removeAppFromBatch: (id, items) =>
    api.post(`/admin/platform/batches/${id}/applications/remove`, { items }),
```

- [ ] **Step 2:** In `adaptPipelineRow`, add:

```js
    batches: Array.isArray(row.batches) ? row.batches
             : (row.batch ? [{ name: row.batch }] : []),
    batch: row.batch || "Unassigned",
```

- [ ] **Step 3:** Build check: `cd frontend && npm run build` (or `npx vite build`) → no errors.
- [ ] **Step 4: Commit** — `feat(admin): batches[] adapter + removeAppFromBatch wrapper`

---

### Task 10: Pipeline BATCH column → chips (add / smart-remove) + append bulk

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` (batch cell render ~line 1084; bulk `applyBatchToSelected` ~356; per-row `changeIndividualBatch` ~418)
- Test: `frontend/src/pages/admin/platform/screens/__tests__/AdminPipeline.batches.test.jsx` (if a test dir exists; else manual)

- [ ] **Step 1:** Render the batch cell as chips from `s.batches`; each chip (non-readOnly) has an `×` calling `removeAppFromBatch(chip.id||name→id, [{track, application_id}])` then reload; a `+ ▾` control lists batches NOT already on the row and calls `assignBatch` (append). In `readOnly`, render chip names as plain text (no controls). Keep the existing bulk "Assign batch" but change its semantics comment to "append".
- [ ] **Step 2:** Bulk `applyBatchToSelected`: unchanged endpoint (`assignBatch`) now appends server-side — just update the success copy from "Moved" to "Added N to {batch}".
- [ ] **Step 3:** Sorting/filtering by batch: change `sortCol === 'batch'` and the `batchFilter` predicate to test membership across `s.batches` (`(s.batches||[]).some(b => b.name === batchFilter)`).
- [ ] **Step 4:** Build check `cd frontend && npm run build`.
- [ ] **Step 5: Commit** — `feat(admin): multi-batch chips in pipeline (add + smart remove)`

---

### Task 11: Frontend verify + promote

- [ ] **Step 1:** `cd frontend && npm run test` (vitest) if suites exist for admin; else manual dogfood on a preview build.
- [ ] **Step 2:** Push branch; user promotes Vercel to production after backend verified.

---

## Phase 3 — Prod eval (schema already live)

- [ ] Create Batch A + Batch B in prod admin UI.
- [ ] Add the SAME application to both A and B; assign reviewer R1→A, R2→B; a third reviewer "shared"→both.
- [ ] Verify R1, R2, shared all see the app in their reviewer queues (union).
- [ ] Remove the app from B → R2 loses it; R1 and shared keep it (shared still via A).
- [ ] Reject the app at Gate-1 → all batch links + assignments cleared, past reviews retained.
- [ ] Record results in the project memory + a short PR description.

---

## Self-review notes
- Spec coverage: schema (mig 034 done), engine (T1), add (T2), remove-app (T3), assign-reviewers-membership (T4), remove-reviewer (T5), read-side list (T6), reject regression (T7), deploy (T8), FE (T9-11), prod eval (Phase 3). All spec sections mapped.
- Types consistent: `add_apps_to_batch`/`remove_app_from_batch`/`remove_reviewer_from_batch` signatures match between module (T1) and callers (T2/T3/T5). `batches[]` shape `{id,name}` consistent across T6/T9/T10.
- No placeholders: all steps carry runnable code or exact edits.
