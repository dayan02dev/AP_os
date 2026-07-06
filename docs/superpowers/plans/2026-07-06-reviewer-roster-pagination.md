# Reviewer Roster Pagination Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the admin reviewer roster showing "No assignments" / wrong batch for reviewers whose assignment rows fall past PostgREST's 1,000-row cap (e.g. `udayanpawar2@gmail.com`, 449 real assignments shown as 0).

**Architecture:** `admin_query.fetch_roster()` bulk-fetches sub-tables with un-ranged `.select("*")` calls that PostgREST silently truncates at 1,000 rows. `reviewer_assignments` now has 3,320 rows, so most reviewers are dropped. Extract a small module-level paginating helper `_fetch_all(make_query)` and route `fetch_roster`'s two nested fetch helpers through it so they read every row.

**Tech Stack:** Python 3.11, FastAPI, supabase-py (PostgREST), pytest.

**Spec:** `docs/superpowers/specs/2026-07-06-reviewer-roster-pagination-design.md`

**⚠ Parallel-session isolation:** A concurrent session owns `admin_query.py`'s assign paths (`assign_reviewers_to_batch`, etc.) + `state_machine.py`, `handler.py`, `leadership_actions.py`, `admin_platform.py`, `reviewer.py`. This plan touches **only** a new module-level `_fetch_all` helper and the two nested helpers inside `fetch_roster` — far from all of that. **Do not push to `release/sip-launch-v1`.**

**Deviation from spec (testability):** spec §4 kept the change inside the nested helpers; this plan extracts a module-level `_fetch_all` so the pagination loop is directly unit-testable (spec §5 asks for a direct test of the paginated helper). Net behavior identical.

---

## Task 0: Environment setup (isolated worktree)

**Files:** none

- [ ] **Step 1: Confirm the worktree + branch**

The worktree already exists. Confirm:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination
git branch --show-current    # expect: fix/reviewer-roster-pagination
git rev-parse --short HEAD    # expect: 2da2d09 (or later, off origin/release/sip-launch-v1)
```

- [ ] **Step 2: Provide test env (reuse the primary venv; copy .env)**

```bash
cp /Users/apple/Desktop/Final_AP_os/backend/.env /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination/backend/.env
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_reviewer_content_sections.py -q --no-cov
```
Expected: PASS (confirms the reused venv + copied `.env` work from this worktree). `.env` is git-ignored.

---

## Task 1: Paginate the roster's bulk fetches

**Files:**
- Modify: `backend/app/services/admin_query.py` — add module-level `_fetch_all` + `_ROSTER_PAGE`; route `fetch_roster`'s nested `_fetch` and `_fetch_in` through it. **Do not touch any other function.**
- Test: `backend/tests/test_roster_pagination.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_roster_pagination.py`:

```python
from app.services import admin_query


class _RangeQuery:
    """Fake PostgREST builder: .range(start,end) slices a fixed row list, mimicking
    the ~1000-row cap (a caller must page to read them all)."""
    def __init__(self, rows):
        self._rows = rows
        self._s = 0
        self._e = None

    def range(self, start, end):
        self._s, self._e = start, end
        return self

    def execute(self):
        data = self._rows[self._s:self._e + 1]
        return type("Resp", (), {"data": data})()


def test_fetch_all_reads_beyond_one_page():
    rows = [{"i": i} for i in range(2400)]        # > 2 pages of 1000
    out = admin_query._fetch_all(lambda: _RangeQuery(rows), page=1000)
    assert len(out) == 2400
    assert out[0]["i"] == 0
    assert out[-1]["i"] == 2399


def test_fetch_all_exact_page_boundary_terminates():
    rows = [{"i": i} for i in range(1000)]        # exactly one full page
    out = admin_query._fetch_all(lambda: _RangeQuery(rows), page=1000)
    assert len(out) == 1000                        # second (empty) page stops the loop


def test_fetch_all_empty():
    out = admin_query._fetch_all(lambda: _RangeQuery([]), page=1000)
    assert out == []


def test_fetch_all_rebuilds_query_each_page():
    # Each page must use a FRESH builder (range() can't be safely reused).
    rows = [{"i": i} for i in range(1500)]
    built = {"n": 0}

    def make_query():
        built["n"] += 1
        return _RangeQuery(rows)

    out = admin_query._fetch_all(make_query, page=1000)
    assert len(out) == 1500
    assert built["n"] == 2        # page0 (1000) + page1 (500) => 2 builds
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination/backend && /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_roster_pagination.py -q --no-cov
```
Expected: FAIL with `AttributeError: module 'app.services.admin_query' has no attribute '_fetch_all'`.

- [ ] **Step 3: Add the module-level helper**

In `backend/app/services/admin_query.py`, add near the top of the module (after the imports / other module-level constants, e.g. just above `def fetch_roster(`):

```python
_ROSTER_PAGE = 1000


def _fetch_all(make_query, *, page: int = _ROSTER_PAGE) -> list[dict]:
    """Read EVERY row from a PostgREST query, paging past the ~1000-row default cap.

    `make_query` is a thunk returning a FRESH query builder on each call — a builder's
    .range() can't be safely re-applied, so every page rebuilds the query (same pattern
    as iter_assignment_rows). Loops until a short page signals the end.
    """
    rows: list[dict] = []
    offset = 0
    while True:
        chunk = (make_query().range(offset, offset + page - 1).execute().data) or []
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination/backend && /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_roster_pagination.py -q --no-cov
```
Expected: PASS (4 passed).

- [ ] **Step 5: Route `fetch_roster`'s helpers through `_fetch_all`**

In `backend/app/services/admin_query.py`, inside `fetch_roster()`, find these two nested helpers (verbatim):

```python
    def _fetch(table: str) -> list[dict]:
        try:
            return (sb.table(table).select("*").execute().data) or []
        except Exception as exc:
            log.warning("roster: fetch failed", extra={"table": table, "err": str(exc)})
            return []

    def _fetch_in(table: str, col: str) -> list[dict]:
        # Filter by the (few) reviewer ids instead of select-all. A bare
        # select("*") is capped at PostgREST's 1000-row default, which silently
        # dropped some reviewers' profiles/assignments once the user table grew
        # past 1000 rows — making the roster fall back to showing raw user-ids.
        if not id_list:
            return []
        try:
            return (sb.table(table).select("*").in_(col, id_list).execute().data) or []
        except Exception as exc:
            log.warning("roster: fetch_in failed", extra={"table": table, "err": str(exc)})
            return []
```

Replace them with (route through the paginating helper — the bare `.select("*")` was itself the bug):

```python
    def _fetch(table: str) -> list[dict]:
        try:
            return _fetch_all(lambda: sb.table(table).select("*"))
        except Exception as exc:
            log.warning("roster: fetch failed", extra={"table": table, "err": str(exc)})
            return []

    def _fetch_in(table: str, col: str) -> list[dict]:
        # Filter by the (few) reviewer ids, and PAGE past PostgREST's 1000-row
        # default cap — reviewer_assignments alone is >3000 rows, so a single
        # select("*") silently dropped most reviewers' assignments (roster showed
        # "No assignments" / wrong batch for the newest reviewers).
        if not id_list:
            return []
        try:
            return _fetch_all(lambda: sb.table(table).select("*").in_(col, id_list))
        except Exception as exc:
            log.warning("roster: fetch_in failed", extra={"table": table, "err": str(exc)})
            return []
```

- [ ] **Step 6: Verify nothing else in `admin_query.py` changed + tests still pass**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination
git diff --stat            # expect ONLY admin_query.py (+ the new test file once added)
cd backend && /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_roster_pagination.py -q --no-cov
```
Expected: `git diff` shows only `backend/app/services/admin_query.py`; tests PASS. Confirm the diff does **not** touch `assign_reviewers_to_batch`, `iter_assignment_rows`, or any other function.

- [ ] **Step 7: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination
git add backend/app/services/admin_query.py backend/tests/test_roster_pagination.py
git commit -m "fix(admin): paginate reviewer-roster fetches past PostgREST 1000-row cap"
```
(No AI attribution in the message.)

---

## Task 2: Full verify, prod check, deploy coordination

**Files:** none (verification + ops)

- [ ] **Step 1: Full backend suite (baseline-aware)**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination/backend && /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest -q
```
Expected: the new pagination tests pass; any pre-existing failures must match the known baseline on `2da2d09` (config/feature-flag tests — submit-validation, cross-track lock, resume upload). If a NEW failure appears that isn't in that baseline, stop and investigate.

- [ ] **Step 2: Confirm the fix against prod data (read-only)**

With `.env.prod` present in this worktree's `backend/` (copy from the primary checkout; it's git-ignored), run a one-off read-only check that `fetch_roster` now sees `udayanpawar2`'s assignments:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination/backend
cp /Users/apple/Desktop/Final_AP_os/backend/.env.prod .env.prod
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python - <<'PY'
from dotenv import load_dotenv; load_dotenv('.env.prod')
from app.services import admin_query
roster = admin_query.fetch_roster()
row = next((r for r in roster["reviewers"] if r.get("reviewer_user_id") == "defd24a9-a52a-46d0-b435-181dcae4e1c9"), None)
print("udayanpawar2 roster row:", {k: row.get(k) for k in ("assigned","batches")} if row else "NOT FOUND")
PY
```
Expected: `assigned` ≈ 449 and `batches` includes Batch B (328) + Batch D (121) — not "No assignments". (Field names: confirm against the roster row shape; the assembly uses `assigned` count + `batches` list.)

- [ ] **Step 3: Push the branch (NOT release)**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/roster-pagination
git push -u origin fix/reviewer-roster-pagination
```
Do **not** push to `release/sip-launch-v1`.

- [ ] **Step 4: Coordinate merge + deploy with the user**

Because the parallel session is mid-flight on `admin_query.py`, do **not** unilaterally merge/deploy. Hand off to the user with these options:
  - (a) User merges `fix/reviewer-roster-pagination` into `release/sip-launch-v1` once the parallel work lands, then deploys once (expected conflict-free — different function).
  - (b) If deploying sooner is required, deploy from a worktree that also carries the parallel session's committed work (since `sam build` reads disk), after re-grepping `.env.prod` for `TIR_/SIP_SUBMISSIONS_CLOSED=true`.
Backend-only (API Lambda); no migration; no frontend/Vercel change.

---

## Self-review notes (author checklist — completed)

- **Spec coverage:** §2 root cause → Task 1 pagination; §4 fix code → Task 1 Steps 3+5; §5 tests → Task 1 Step 1 (direct `_fetch_all` tests incl. boundary + rebuild-per-page); §6 deploy/coordination → Task 2; §3 email (no code) → not a task (ops note only, correct). §7 out-of-scope respected.
- **Placeholder scan:** none — every step has exact code/commands/expected output.
- **Type/name consistency:** `_fetch_all(make_query, *, page=_ROSTER_PAGE)` defined in Step 3, called in Step 5 and tested in Step 1 with matching signature; `_ROSTER_PAGE = 1000` used consistently.
- **Isolation:** only `admin_query.py` (new `_fetch_all` + the two `fetch_roster` nested helpers) + one new test file; verified in Task 1 Step 6; no push to release.
