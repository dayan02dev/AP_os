# Assignment-Driven Status Workflow (TIR + VIP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reviewer assignment (not AI screening) the trigger for `submitted → under_review`, make the FIRST review flip `under_review → evaluated`, keep approve/reject reaching `jury_review`/`rejected` from submitted/under_review/evaluated — identically for TIR and VIP — then re-map all existing apps and test hermetically + live on staging.

**Architecture:** Backend-only behavior change centered on `state_machine.py` (transition map + two guarded helpers), the AI worker (stop advancing status; guard on "already screened" instead of status), the three assignment routes (advance on assign), and the reviewer submit path (first-review→evaluated). A reversible backfill re-maps live data. The hermetic lifecycle suite is rewritten to the new contract; a staging smoke drives the real account.

**Tech Stack:** Python, FastAPI, pytest, Supabase (via monkeypatched `get_admin_client`). Spec: `docs/superpowers/specs/2026-07-06-status-workflow-assignment-driven-design.md`.

**Working dir for all commands:** `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1/backend`. Single-file pytest runs use `--no-cov`. All commits authored solely by the user — NO "Co-Authored-By"/"Generated with"/Claude/AI references.

---

## File Structure

- **Modify** `backend/app/services/state_machine.py` — add `under_review` to `submitted`'s legal set; add `advance_to_under_review_on_assignment`; replace `auto_transition_to_evaluated_if_complete` with `auto_transition_to_evaluated_on_first_review`.
- **Modify** `backend/workers/ai_screener/handler.py` — `advance_status=False`; guard on existing `ai_screening` row instead of `status == 'submitted'`.
- **Modify** `backend/app/routers/leadership_actions.py`, `backend/app/routers/admin_platform.py`, `backend/app/services/admin_query.py` — advance to `under_review` after assigning.
- **Modify** `backend/app/routers/reviewer.py` — call the renamed first-review helper at both sites.
- **Create** `backend/scripts/backfill_status_workflow.py` + pure `remap_status`.
- **Rewrite** `backend/tests/test_status_lifecycle_e2e.py` to the new contract; **create** `backend/tests/test_backfill_status_workflow.py`.
- **Create** `backend/scripts/smoke_status_workflow.py` — staging live smoke (gated).

---

## Task 1: State machine — `submitted → under_review` legal + assignment helper

**Files:** Modify `backend/app/services/state_machine.py`; Test `backend/tests/test_state_machine.py`

- [ ] **Step 1: Write failing tests** (append to `tests/test_state_machine.py`)

```python
def test_submitted_to_under_review_is_legal():
    from app.services import state_machine
    assert "under_review" in state_machine.LEGAL_TRANSITIONS["submitted"]

def test_advance_to_under_review_only_from_submitted(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({"tir_applications": [{"id": "a1", "status": "submitted"}]})
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.advance_to_under_review_on_assignment("a1", "tir") is True
    assert fake.status_of("tir", "a1") == "under_review"
    # idempotent / no-op when not submitted
    assert state_machine.advance_to_under_review_on_assignment("a1", "tir") is False
    assert fake.status_of("tir", "a1") == "under_review"

def test_advance_noop_when_already_evaluated(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({"sip_applications": [{"id": "a2", "status": "evaluated"}]})
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.advance_to_under_review_on_assignment("a2", "sip") is False
    assert fake.status_of("sip", "a2") == "evaluated"
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_state_machine.py -k "under_review or advance" -v --no-cov`
Expected: FAIL (`under_review` not in set / `advance_to_under_review_on_assignment` missing).

- [ ] **Step 3: Implement**

In `state_machine.py`, change the `submitted` row of `LEGAL_TRANSITIONS`:

```python
    "submitted":        frozenset({"under_review", "jury_review", "rejected", "withdrawn"}),
```

Add this function (after `apply_status_change`):

```python
def advance_to_under_review_on_assignment(application_id: str, track: str) -> bool:
    """Guarded submitted -> under_review, fired when a reviewer is assigned.
    No-op (returns False) unless the app is currently 'submitted'. Idempotent."""
    sb = get_admin_client()
    table = "tir_applications" if track == "tir" else "sip_applications"
    rows = (
        sb.table(table).select("status").eq("id", application_id).limit(1).execute().data
        or []
    )
    if not rows or rows[0].get("status") != "submitted":
        return False
    apply_status_change(
        application_id, track,
        to_status="under_review", changed_by=None, reason="reviewer assigned",
    )
    return True
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_state_machine.py -k "under_review or advance" -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/state_machine.py tests/test_state_machine.py
git commit -m "feat(status): assignment moves submitted->under_review (guarded helper + legal transition)"
```

---

## Task 2: State machine — first review flips `under_review → evaluated`

**Files:** Modify `backend/app/services/state_machine.py`; Test `backend/tests/test_state_machine.py`

- [ ] **Step 1: Write failing tests**

```python
def test_first_review_flips_under_review_to_evaluated(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({
        "tir_applications": [{"id": "a1", "status": "under_review"}],
        "reviews": [{"id": "r1", "application_id": "a1", "application_track": "tir",
                     "status": "submitted", "submitted_at": "2026-07-01T00:00:00Z"}],
    })
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.auto_transition_to_evaluated_on_first_review("a1", "tir") is True
    assert fake.status_of("tir", "a1") == "evaluated"

def test_no_review_no_flip(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({"sip_applications": [{"id": "a2", "status": "under_review"}], "reviews": []})
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.auto_transition_to_evaluated_on_first_review("a2", "sip") is False
    assert fake.status_of("sip", "a2") == "under_review"

def test_flip_noop_when_not_under_review(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({
        "tir_applications": [{"id": "a3", "status": "evaluated"}],
        "reviews": [{"id": "r", "application_id": "a3", "application_track": "tir",
                     "status": "submitted", "submitted_at": "2026-07-01T00:00:00Z"}],
    })
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.auto_transition_to_evaluated_on_first_review("a3", "tir") is False
    assert fake.status_of("tir", "a3") == "evaluated"
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_state_machine.py -k "first_review or no_review or flip_noop" -v --no-cov`
Expected: FAIL (function missing).

- [ ] **Step 3: Implement** — REPLACE `auto_transition_to_evaluated_if_complete` with:

```python
def auto_transition_to_evaluated_on_first_review(application_id: str, track: str) -> bool:
    """Fire under_review -> evaluated as soon as the FIRST review is submitted
    for this application. Idempotent; only fires when the current status is
    'under_review'. Returns True iff it fired."""
    sb = get_admin_client()
    try:
        reviews = (
            sb.table("reviews").select("id,status,submitted_at")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .execute().data
        ) or []
    except Exception as exc:  # noqa: BLE001
        log.warning("first_review transition: reviews fetch failed",
                    extra={"application_id": application_id, "track": track, "err": str(exc)})
        return False
    has_submitted_review = any(
        r.get("status") == "submitted" or r.get("submitted_at") for r in reviews
    )
    if not has_submitted_review:
        return False
    table = "tir_applications" if track == "tir" else "sip_applications"
    app_rows = (
        sb.table(table).select("status").eq("id", application_id).limit(1).execute().data
        or []
    )
    if not app_rows or app_rows[0].get("status") != "under_review":
        return False
    apply_status_change(
        application_id, track,
        to_status="evaluated", changed_by=None, reason="first review submitted",
    )
    return True
```

Also update the module docstring line referencing the old "all reviewers submitted" trigger to "first review submitted".

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_state_machine.py -k "first_review or no_review or flip_noop" -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/state_machine.py tests/test_state_machine.py
git commit -m "feat(status): first review flips under_review->evaluated (was all-reviewers)"
```

---

## Task 3: AI worker — stop advancing status; guard on already-screened

**Files:** Modify `backend/workers/ai_screener/handler.py`; Test `backend/tests/test_ai_screener.py`

- [ ] **Step 1: Write failing test** (append to `tests/test_ai_screener.py`, mirroring its existing fake/monkeypatch pattern; if that file's fake lacks read-back, use `tests.fixtures.fake_supabase.FakeSupabase`)

```python
def test_worker_screens_assigned_app_and_does_not_change_status(monkeypatch):
    """New workflow: AI must screen even when status is already under_review
    (assigned-first), and must NOT change the status."""
    from workers.ai_screener import handler
    from app.services.ai_pipeline import pipeline
    from tests.fixtures.fake_supabase import FakeSupabase

    fake = FakeSupabase({"tir_applications": [{"id": "a1", "status": "under_review"}], "ai_screening": []})
    monkeypatch.setattr(handler, "get_admin_client", lambda: fake)

    persisted = {}
    def _fake_persist(client, app_id, track, result, *, advance_status):
        persisted["advance_status"] = advance_status
        client.table("ai_screening").upsert(
            {"application_id": app_id, "application_track": track, "score_overall": 5.0},
            on_conflict="application_id,application_track").execute()
    monkeypatch.setattr(pipeline, "run_for_application", lambda *a, **k: object())
    monkeypatch.setattr(pipeline, "persist", _fake_persist)

    handler._process_record({"body": {"application_id": "a1", "application_track": "tir"}})

    assert persisted["advance_status"] is False          # no status advance
    assert fake.status_of("tir", "a1") == "under_review"  # unchanged
    assert fake.tables["ai_screening"]                    # screened despite non-submitted status

def test_worker_skips_already_screened(monkeypatch):
    from workers.ai_screener import handler
    from app.services.ai_pipeline import pipeline
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({
        "sip_applications": [{"id": "a2", "status": "submitted"}],
        "ai_screening": [{"application_id": "a2", "application_track": "sip", "score_overall": 7.0}],
    })
    monkeypatch.setattr(handler, "get_admin_client", lambda: fake)
    ran = {"n": 0}
    monkeypatch.setattr(pipeline, "run_for_application", lambda *a, **k: ran.__setitem__("n", ran["n"] + 1))
    handler._process_record({"body": {"application_id": "a2", "application_track": "sip"}})
    assert ran["n"] == 0  # skipped: already has an ai_screening row
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_ai_screener.py -k "does_not_change_status or already_screened" -v --no-cov`
Expected: FAIL (worker still advances / still guards on status).

- [ ] **Step 3: Implement** — in `handler.py::_process_record`, REPLACE the status guard:

```python
    # OLD:
    # current_status = app_row.get("status", "")
    # if current_status != _STATUS_SUBMITTED:
    #     log.info("application_id=%s status=%s (not submitted) — skipping", ...)
    #     return

    # NEW: idempotency now keys on "already screened", decoupled from status —
    # so an app assigned a reviewer (already under_review) still gets scored.
    already = (
        client.table("ai_screening").select("application_id")
        .eq("application_id", application_id)
        .eq("application_track", application_track)
        .limit(1).execute().data
    ) or []
    if already:
        log.info("application_id=%s already screened — skipping", application_id)
        return
```

And change the persist call:

```python
    pipeline.persist(
        client, application_id, application_track, result, advance_status=False,
    )
```

(`_STATUS_SUBMITTED` may become unused — remove it if so.)

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_ai_screener.py -v --no-cov`
Expected: PASS (new tests pass; pre-existing worker tests still pass — if a pre-existing test asserted the old status-advance, update it to the new contract).

- [ ] **Step 5: Commit**

```bash
git add workers/ai_screener/handler.py tests/test_ai_screener.py
git commit -m "feat(status): AI worker no longer advances status; guards on already-screened"
```

---

## Task 4: Assignment routes advance `submitted → under_review`

**Files:** Modify `backend/app/routers/leadership_actions.py`, `backend/app/routers/admin_platform.py`, `backend/app/services/admin_query.py`; Test `backend/tests/test_reviewer_assign_dedup.py` (or a new `tests/test_assign_advances_status.py`)

- [ ] **Step 1: Write failing test** (`backend/tests/test_assign_advances_status.py`)

```python
import pytest
from tests.fixtures.fake_supabase import FakeSupabase

def _install(monkeypatch, fake):
    from app.services import state_machine, admin_query
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: fake)
    return fake

@pytest.mark.parametrize("track", ["tir", "sip"])
def test_batch_assign_advances_submitted_apps(monkeypatch, track):
    from app.services import admin_query
    fake = FakeSupabase({
        f"{track}_applications": [{"id": "app1", "status": "submitted"}],
        "application_batches": [{"application_id": "app1", "application_track": track, "batch_id": "b1"}],
        "reviewer_assignments": [],
    })
    _install(monkeypatch, fake)
    admin_query.assign_reviewers_to_batch(fake, "b1", ["rev1"], assigned_by="admin1")
    assert fake.status_of(track, "app1") == "under_review"
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_assign_advances_status.py -v --no-cov`
Expected: FAIL (status stays `submitted`).

- [ ] **Step 3: Implement** — call the guarded helper after each assignment insert, over the apps that were assigned:

(a) `admin_query.assign_reviewers_to_batch` — after the `upsert(rows, ...)` block, advance every distinct app touched:

```python
    from app.services import state_machine  # local import to avoid cycles
    for aid, atrack in {(r["application_id"], r["application_track"]) for r in rows}:
        state_machine.advance_to_under_review_on_assignment(aid, atrack)
```

(b) `leadership_actions.assign_reviewers` — after the assignment loop, before `return`:

```python
    from app.services import state_machine
    if any(r.get("status") == "created" for r in results):
        state_machine.advance_to_under_review_on_assignment(application_id, track)
```

(c) `admin_platform.assign_applications` — after `sb.table("reviewer_assignments").insert(rows).execute()`:

```python
    from app.services import state_machine
    for aid, atrack in {(r["application_id"], r["application_track"]) for r in rows}:
        state_machine.advance_to_under_review_on_assignment(aid, atrack)
```

(The helper is idempotent and only fires from `submitted`, so double-touch across paths is safe.)

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_assign_advances_status.py tests/test_reviewer_assign_dedup.py -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routers/leadership_actions.py app/routers/admin_platform.py app/services/admin_query.py tests/test_assign_advances_status.py
git commit -m "feat(status): all assignment routes advance submitted->under_review"
```

---

## Task 5: Reviewer submit → call the first-review helper

**Files:** Modify `backend/app/routers/reviewer.py`; Test: covered by the e2e rewrite (Task 8) + existing `tests/test_reviewer.py`

- [ ] **Step 1: Update both call sites** — replace the two occurrences of:

```python
        state_machine.auto_transition_to_evaluated_if_complete(
            <app_id_expr>,
            <track_expr>,
            just_completed_assignment_id=<assignment_expr>,
        )
```

with:

```python
        state_machine.auto_transition_to_evaluated_on_first_review(
            <app_id_expr>,
            <track_expr>,
        )
```

(Site 1 in `submit_review`: `body.application_id`, `body.application_track`. Site 2 in `patch_review`: `existing["application_id"]`, `existing["application_track"]`.)

- [ ] **Step 2: Run existing reviewer tests**

Run: `pytest tests/test_reviewer.py -v --no-cov`
Expected: PASS. If a pre-existing reviewer test asserted the old "all reviewers" behavior via the old function name, update it to call/expect the new first-review helper.

- [ ] **Step 3: Commit**

```bash
git add app/routers/reviewer.py tests/test_reviewer.py
git commit -m "feat(status): reviewer submit triggers first-review evaluated transition"
```

---

## Task 6: Backfill pure mapping function + unit tests

**Files:** Create `backend/scripts/backfill_status_workflow.py`; Test `backend/tests/test_backfill_status_workflow.py`

- [ ] **Step 1: Write failing tests**

```python
from scripts.backfill_status_workflow import remap_status, TERMINAL

def test_terminal_kept():
    for s in ["draft", "withdrawn", "rejected", "jury_review", "on_hold", "waitlisted", "shortlisted", "offered", "onboarded"]:
        assert remap_status(s, has_review=True, has_active_assignment=True) == s

def test_review_wins():
    assert remap_status("under_review", has_review=True, has_active_assignment=True) == "evaluated"
    assert remap_status("submitted", has_review=True, has_active_assignment=False) == "evaluated"

def test_assignment_only():
    assert remap_status("under_review", has_review=False, has_active_assignment=True) == "under_review"
    assert remap_status("submitted", has_review=False, has_active_assignment=True) == "under_review"

def test_bare_submitted():
    assert remap_status("under_review", has_review=False, has_active_assignment=False) == "submitted"
    assert remap_status("ai_screening", has_review=False, has_active_assignment=False) == "submitted"
    assert remap_status("submitted", has_review=False, has_active_assignment=False) == "submitted"
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_backfill_status_workflow.py -v --no-cov`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** the pure function (rest of the script comes in Task 7)

```python
# backend/scripts/backfill_status_workflow.py
"""Re-map existing application statuses to the assignment-driven workflow.

Rules (matches state_machine after the 2026-07-06 change):
  * decided/terminal statuses are kept as-is
  * else: >=1 submitted review -> evaluated
  * else: >=1 active assignment -> under_review
  * else: submitted
Run with --dry-run (default) to report; --apply to write (backup first)."""
from __future__ import annotations

TERMINAL = frozenset({
    "draft", "withdrawn", "rejected", "jury_review", "on_hold",
    "waitlisted", "shortlisted", "offered", "onboarded", "interview",
})


def remap_status(current: str, *, has_review: bool, has_active_assignment: bool) -> str:
    if current in TERMINAL:
        return current
    if has_review:
        return "evaluated"
    if has_active_assignment:
        return "under_review"
    return "submitted"
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_backfill_status_workflow.py -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill_status_workflow.py tests/test_backfill_status_workflow.py
git commit -m "feat(status): backfill remap_status pure function + tests"
```

---

## Task 7: Backfill driver (dry-run / apply / backup)

**Files:** Modify `backend/scripts/backfill_status_workflow.py`; Test `backend/tests/test_backfill_status_workflow.py`

- [ ] **Step 1: Write failing test** (drives the in-process runner against the fake)

```python
from scripts.backfill_status_workflow import compute_changes

def test_compute_changes_maps_all_branches():
    apps = {
        "tir": [
            {"id": "keep", "status": "jury_review"},
            {"id": "rev", "status": "under_review"},
            {"id": "assigned", "status": "under_review"},
            {"id": "bare", "status": "under_review"},
        ],
    }
    reviews = {("rev", "tir")}                 # has a submitted review
    active_assign = {("assigned", "tir")}      # has an active assignment
    changes = compute_changes(apps, reviews, active_assign)
    by_id = {c["id"]: c["to"] for c in changes}
    # compute_changes returns ONLY rows whose status actually changes.
    assert "keep" not in by_id                 # terminal -> kept -> not in list
    assert by_id["rev"] == "evaluated"         # under_review + review -> evaluated
    assert "assigned" not in by_id             # already under_review -> no change
    assert by_id["bare"] == "submitted"        # under_review, no review/assignment -> submitted
```

- [ ] **Step 2: Run to verify fail**

Run: `pytest tests/test_backfill_status_workflow.py -k compute_changes -v --no-cov`
Expected: FAIL (`compute_changes` missing).

- [ ] **Step 3: Implement** — add to the script:

```python
import argparse
import json
from datetime import datetime, timezone


def compute_changes(apps_by_track, review_keys, active_assignment_keys):
    """apps_by_track: {track: [{id, status}]}. review_keys / active_assignment_keys:
    sets of (app_id, track). Returns [{track, id, frm, to}] for rows that change."""
    out = []
    for track, apps in apps_by_track.items():
        for a in apps:
            aid, cur = a["id"], a.get("status")
            new = remap_status(
                cur,
                has_review=(aid, track) in review_keys,
                has_active_assignment=(aid, track) in active_assignment_keys,
            )
            if new != cur:
                out.append({"track": track, "id": aid, "frm": cur, "to": new})
    return out


def _load(sb):
    apps_by_track, review_keys, active = {}, set(), set()
    for track in ("tir", "sip"):
        apps_by_track[track] = (
            sb.table(f"{track}_applications").select("id,status").execute().data or []
        )
    for r in (sb.table("reviews").select("application_id,application_track,status,submitted_at").execute().data or []):
        if r.get("status") == "submitted" or r.get("submitted_at"):
            review_keys.add((r["application_id"], r["application_track"]))
    for a in (sb.table("reviewer_assignments").select("application_id,application_track,declined_at,reassigned_to").execute().data or []):
        if a.get("declined_at") is None and a.get("reassigned_to") is None:
            active.add((a["application_id"], a["application_track"]))
    return apps_by_track, review_keys, active


def run(apply: bool):
    from app.supabase_client import get_admin_client
    from app.services import state_machine
    sb = get_admin_client()
    apps_by_track, review_keys, active = _load(sb)
    changes = compute_changes(apps_by_track, review_keys, active)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = f"status_backfill_backup_{ts}.json"
    print(f"{len(changes)} status changes computed. Backup -> {backup_path}")
    for c in changes:
        print(f"  [{c['track']}] {c['id']}: {c['frm']} -> {c['to']}")
    if not apply:
        print("DRY RUN — no writes. Re-run with --apply to write.")
        return
    # Backup every app's current (id, track, status) BEFORE writing.
    backup = [{"track": t, "id": a["id"], "status": a.get("status")}
              for t, apps in apps_by_track.items() for a in apps]
    with open(backup_path, "w") as f:
        json.dump(backup, f)
    for c in changes:
        state_machine.apply_status_change(
            c["id"], c["track"], to_status=c["to"], changed_by=None,
            reason="status workflow backfill 2026-07-06",
        )
    print(f"APPLIED {len(changes)} changes.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    run(apply=p.parse_args().apply)
```

Note: `apply_status_change` asserts legal transitions. `under_review → submitted` and `evaluated → under_review`/`submitted` are rewinds NOT in `LEGAL_TRANSITIONS`, so the backfill must bypass the guard for down-mappings. Implement the backfill write as a DIRECT update + explicit `application_status_log` insert (not via `apply_status_change`) to avoid 422s on legitimate re-maps. Replace the `apply_status_change` call in `run()` with a direct write:

```python
        table = "tir_applications" if c["track"] == "tir" else "sip_applications"
        sb.table(table).update({"status": c["to"]}).eq("id", c["id"]).execute()
        sb.table("application_status_log").insert({
            "application_id": c["id"], "application_track": c["track"],
            "from_status": c["frm"], "to_status": c["to"], "changed_by": None,
            "reason": "status workflow backfill 2026-07-06",
        }).execute()
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_backfill_status_workflow.py -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill_status_workflow.py tests/test_backfill_status_workflow.py
git commit -m "feat(status): backfill driver with dry-run, backup, direct-write remap"
```

---

## Task 8: Rewrite the hermetic lifecycle suite to the new contract

**Files:** Modify `backend/tests/test_status_lifecycle_e2e.py`

- [ ] **Step 1: Update the driver + tests to the NEW rules.**

Change `LifecycleDriver.run_ai` to match the new worker (no status advance):

```python
    def run_ai(self):
        from app.services.ai_pipeline import pipeline
        pipeline.persist(self.ctx.fake, self.app_id, self.track, _canned_score(), advance_status=False)
```

Rewrite the affected tests to the new contract (replace old A2/A3/A4/A6/B bodies):

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A2_ai_screening_keeps_submitted(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)
    d.submit(); d.run_ai()
    assert d.status() == "submitted"  # AI no longer advances status
    scr = fake.table("ai_screening").select("*").eq("application_id", app_id).execute().data
    assert scr and scr[0]["score_overall"] == 5.0  # but scores were written

@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A3_assign_moves_to_under_review(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)
    d.submit(); d.run_ai(); assert d.status() == "submitted"
    d.assign([REVIEWER])
    assert d.status() == "under_review"  # assignment is THE trigger now

@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A4_first_review_sets_evaluated(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)
    d.submit(); d.run_ai(); d.assign([REVIEWER, REVIEWER2])
    assert d.status() == "under_review"
    d.submit_review(REVIEWER)                 # FIRST of two
    assert d.status() == "evaluated"          # single review flips it
    d.submit_review(REVIEWER2)                # second is a no-op
    assert d.status() == "evaluated"

@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A6_full_happy_path_chain(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)
    d.submit();          assert d.status() == "submitted"
    d.run_ai();          assert d.status() == "submitted"
    d.assign([REVIEWER]); assert d.status() == "under_review"
    d.submit_review(REVIEWER); assert d.status() == "evaluated"
    r = d.decide("jury_review"); assert r.status_code == 200, r.text
    assert d.status() == "jury_review"

@pytest.mark.parametrize("track", ["tir", "sip"])
def test_AI_screens_when_assigned_first(client, monkeypatch, _clear, track):
    """Assign before AI runs -> app is under_review -> worker must still screen."""
    from workers.ai_screener import handler
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    monkeypatch.setattr(handler, "get_admin_client", lambda: fake)
    d = LifecycleDriver(client, ctx, track, app_id)
    d.submit(); d.assign([REVIEWER]); assert d.status() == "under_review"
    # No ai_screening row yet -> worker screens (real persist w/ advance_status=False
    # via handler); simulate the worker's persist directly to stay hermetic:
    d.run_ai()
    assert d.status() == "under_review"  # AI did not change status
    scr = fake.table("ai_screening").select("*").eq("application_id", app_id).execute().data
    assert scr  # screened despite being under_review
```

Update `test_D1_approve_directly_from_under_review`: after `d.submit(); d.assign([REVIEWER])` the status is `under_review` (no `run_ai` needed to reach it). Update `test_D2_reject_directly_from_submitted`: still valid (decision from `submitted`). Update `test_F1_F2_track_parity_and_correct_table` expected sequence to the NEW hops:

```python
    assert seq_status["tir"] == seq_status["sip"] == [
        "submitted", "submitted", "under_review", "evaluated", "jury_review"]
```

Delete the OLD `test_B1_B2_two_reviewers_only_flips_on_last` and OLD `test_B3_draft_review_does_not_flip`'s "all reviewers" assumptions; replace B with:

```python
@pytest.mark.parametrize("track", ["tir", "sip"])
def test_B3_draft_review_does_not_flip(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)
    d.submit(); d.run_ai(); d.assign([REVIEWER])
    d.submit_review(REVIEWER, draft=True)
    assert d.status() == "under_review"  # a draft is not a submitted review
```

Update B4/B5 to call `auto_transition_to_evaluated_on_first_review` (new name) with the reviews-based fixtures from Task 2.

- [ ] **Step 2: Run to verify pass**

Run: `pytest tests/test_status_lifecycle_e2e.py -v --no-cov`
Expected: ALL PASS (both tracks) under the new contract.

- [ ] **Step 3: Commit**

```bash
git add tests/test_status_lifecycle_e2e.py
git commit -m "test(status): rewrite lifecycle suite to assignment-driven contract (TIR+VIP)"
```

---

## Task 9: Staging live smoke (gated — runs after staging deploy)

**Files:** Create `backend/scripts/smoke_status_workflow.py`

This task is EXECUTION-GATED: it runs only after the backend is deployed to staging and `udayanpawar03@gmail.com` is provisioned on the staging Supabase with BOTH `admin` and `reviewer` roles.

- [ ] **Step 1: Write the smoke script** — a standalone script (NOT a pytest that runs in CI) that, given `STAGING_API_BASE` and an auth token for `udayanpawar03@`, for each track: creates a draft via the applicant API, submits it, asserts `submitted`; assigns self as reviewer via the admin/leadership API, asserts `under_review`; submits a review via the reviewer API, asserts `evaluated`; posts an approve decision, asserts `jury_review`; then withdraws/cleans up the throwaway app. Print each observed transition. Read `STAGING_API_BASE` + token from env; fail loudly with the HTTP body on any non-2xx or unexpected status.

```python
# backend/scripts/smoke_status_workflow.py
"""Live end-to-end status smoke against STAGING using udayanpawar03@ (admin+reviewer).
Env: STAGING_API_BASE, STAGING_TOKEN (a Supabase JWT for udayanpawar03@).
Usage: python scripts/smoke_status_workflow.py
Creates a throwaway app per track, drives submit->under_review->evaluated->jury_review,
asserts each hop, cleans up. NEVER run against prod."""
import os, sys, httpx

BASE = os.environ["STAGING_API_BASE"].rstrip("/")
TOKEN = os.environ["STAGING_TOKEN"]
H = {"Authorization": f"Bearer {TOKEN}"}

def _check(resp, want, label):
    if resp.status_code not in (200, 201):
        sys.exit(f"{label}: HTTP {resp.status_code} {resp.text}")
    print(f"  {label}: OK")

# NOTE: exact endpoint bodies mirror backend/tests/test_status_lifecycle_e2e.py.
# Fill the submit/assign/review/decide/status calls per track ("tir","sip") using
# the same routes the hermetic tests drive, reading status via the admin detail API.
```

The exact call bodies mirror the hermetic driver (Task 8); the executor completes them against the real staging routes once `STAGING_API_BASE`/token are available. Because this depends on live infra, DO NOT block the plan's completion on it — implement the script, then run it during rollout step 2.

- [ ] **Step 2: Commit the script (do not run yet)**

```bash
git add scripts/smoke_status_workflow.py
git commit -m "test(status): staging live smoke script for assignment-driven workflow"
```

---

## Task 10: Full-suite regression + rollout checklist

- [ ] **Step 1: Run the lifecycle + state-machine + worker + backfill tests**

Run: `pytest tests/test_status_lifecycle_e2e.py tests/test_state_machine.py tests/test_ai_screener.py tests/test_backfill_status_workflow.py tests/test_assign_advances_status.py -v --no-cov`
Expected: ALL PASS.

- [ ] **Step 2: Run the full backend suite (regression)**

Run: `pytest -q`
Expected: no NEW failures vs. the known pre-existing baseline (the ~19 pre-existing failures in `test_resume`/`test_validate_submission_mandatory_fields`/`test_validation_limits` are unrelated; do not attribute them to this work, but DO confirm no additional files started failing).

- [ ] **Step 3: Rollout (execution-time, user-gated — NOT automatic)**

1. Commit all backend changes on `release/sip-launch-v1`.
2. Deploy to **staging** (SAM) → run `scripts/smoke_status_workflow.py` (Task 9).
3. `python scripts/backfill_status_workflow.py` (dry-run) on staging → review report → `--apply` on staging → verify.
4. **STOP for explicit user go.** Then: deploy to prod → dry-run backfill on prod → **explicit go** → `--apply` on prod (backup file retained) → verify a sample of apps in the admin portal.

---

## Self-review notes (spec coverage)

- Spec A (state machine) ⇒ Tasks 1–2. Spec B (AI worker) ⇒ Task 3. Spec C (assignment) ⇒ Task 4. Spec D (reviewer submit) ⇒ Task 5. Spec E (backfill) ⇒ Tasks 6–7. Spec F (tests) ⇒ Tasks 8–9. Spec rollout/blast-radius ⇒ Task 10.
- Decision #3 (approve/reject from `submitted`) preserved: `submitted` keeps `jury_review`/`rejected` in `LEGAL_TRANSITIONS` (Task 1 only ADDS `under_review`); covered by `test_D2`.
- Name consistency: `advance_to_under_review_on_assignment` and `auto_transition_to_evaluated_on_first_review` are defined in Tasks 1–2 and used identically in Tasks 4, 5, 8. `remap_status`/`compute_changes` defined in Tasks 6–7 and used in Task 7 tests.
- Known confirm-at-implementation points (resolve via TDD run→fix): exact old-code anchors in `handler.py` guard; whether a pre-existing `test_ai_screener`/`test_reviewer` test asserted the old behavior (update to new contract); the live-smoke endpoint bodies (mirror the hermetic driver).
```
