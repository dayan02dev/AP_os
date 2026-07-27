# Jury Portal Fixes + Suggest-then-Confirm Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three jury "Failed to load / Failed to fetch" errors, convert AI auto-assign into a suggest-then-admin-confirm flow, recolor the jury surfaces to design-system purple (zero green), and style the HOME buttons.

**Architecture:** Backend fixes make three jury endpoints never emit a CORS-less 500 (harden `fetch_juror_applications`, make `put_selections` an atomic bulk write with JSON errors, add a global catch-all middleware that returns 500s *inside* the CORS layer). Frontend keeps the existing `jury_recommendations` (suggestions) vs `jury_assignments` (confirmed) split: the drawer surfaces suggestions as a pre-checked checklist and only writes assignments on "Assign selected"; the bulk button recomputes suggestions without assigning. Recolor swaps three CSS vars + a few inline hexes; HOME buttons get real CSS.

**Tech stack:** FastAPI + supabase-py (PostgREST) + Starlette middleware; React + a `fetch` wrapper; Vitest/RTL; pytest with an in-memory `FakeSupabase`.

**Worktree/branch:** all work in `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1` on `release/sip-launch-v1`. Backend venv: `/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python`.

**Spec:** `docs/superpowers/specs/2026-07-27-jury-portal-fixes-and-suggest-flow-design.md`.

---

## File Structure

Backend:
- `backend/app/services/admin_query.py` — modify `fetch_juror_applications` (~1036-1113) to degrade per-row instead of 500.
- `backend/app/routers/jury.py` — modify `put_selections` (114-154): atomic bulk upsert + try/except → JSON error.
- `backend/app/utils/middleware.py` — add `CorsSafeErrorMiddleware`.
- `backend/app/main.py` — import + register the new middleware (innermost).
- Tests: `backend/tests/test_jury_admin.py` (+1), `backend/tests/test_jury_selections.py` (+1), `backend/tests/test_cors_safe_errors.py` (new).

Frontend:
- `frontend/src/pages/admin/platform/screens/ManageJurorsDrawer.jsx` — suggestion checklist + "Assign selected".
- `frontend/src/pages/admin/platform/screens/AdminJury.jsx` — header button → "Refresh AI suggestions"; accept `go` prop + "← Dashboard" button.
- `frontend/src/pages/admin/platform/AdminPortal.jsx` — pass `go={setPage}` to `<AdminJury/>` (line 395).
- `frontend/src/pages/jury/jury.css` — recolor vars + HOME button rule.
- `frontend/src/pages/jury/JuryPortal.jsx` — avatar hex.
- `frontend/src/pages/jury/JuryQueue.jsx` — score-bar hex.
- `frontend/src/pages/jury/JuryAppView.jsx` — AI-number hex.
- Tests: `frontend/src/pages/admin/platform/screens/__tests__/ManageJurorsDrawer.test.jsx` (new), `frontend/src/pages/admin/platform/__tests__/AdminJury.test.jsx` (update).

---

## Task 1: Setup + confirm the live throw (diagnostic, no code)

**Files:** none.

- [ ] **Step 1: Confirm worktree + branch**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
git status && git rev-parse --abbrev-ref HEAD
```
Expected: branch `release/sip-launch-v1`, clean-ish tree (the spec commit `7f5b3cf` present).

- [ ] **Step 2: Pull the live error for Issue 1 (admin drawer) — best effort**

Run:
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/artpark-eir-api-production \
  --region ap-south-1 \
  --filter-pattern '?"jurors" ?"applications" ?ERROR ?Traceback' \
  --start-time $(python3 -c "import time;print(int((time.time()-172800)*1000))") \
  --max-items 40 --query 'events[].message' --output text | tail -40
```
Note the exception type/line if present. If the AWS CLI is unauthenticated or returns nothing, **proceed** — the hardening in Tasks 2/3 is defensive and covers unknown throws.

- [ ] **Step 3: Pull the live error for Issue 6 (submit picks)**

Run:
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/artpark-eir-api-production \
  --region ap-south-1 \
  --filter-pattern '?"/jury/selections" ?ERROR ?Traceback' \
  --start-time $(python3 -c "import time;print(int((time.time()-172800)*1000))") \
  --max-items 40 --query 'events[].message' --output text | tail -40
```
Record findings in the task comment. No commit for this task.

---

## Task 2: Harden `fetch_juror_applications` (Issue 1 — "Failed to load")

**Files:**
- Modify: `backend/app/services/admin_query.py:1059-1113`
- Test: `backend/tests/test_jury_admin.py` (add one test)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_jury_admin.py` (reuse that file's existing fake-admin-client scaffolding + admin `get_current_user` override helper — search the file for how other juror-apps tests build `tables` and override the user; mirror it). The new test seeds one assignment whose TIR application row is malformed enough that the old code path would throw, and asserts a 200 with a graceful row:

```python
def test_juror_applications_degrades_on_bad_row(client, monkeypatch, _clear_overrides):
    # One assignment → a TIR app row missing the fields derive_project_name reads.
    tables = {
        "jury_assignments": [{
            "id": "ja1", "juror_user_id": "adm-juror",
            "application_id": "bad1", "application_track": "tir",
            "assigned_at": "2026-07-01T00:00:00Z",
        }],
        "tir_applications": [{"id": "bad1"}],   # deliberately sparse
        "jury_selections": [],
    }
    _install_admin_fake(monkeypatch, tables)        # mirror existing helper name
    app.dependency_overrides[get_current_user] = _override_admin("admin-1")

    r = client.get("/admin/platform/jurors/adm-juror/applications")
    assert r.status_code == 200, r.text
    apps = r.json()["applications"]
    assert len(apps) == 1
    assert apps[0]["id"] == "bad1"
    assert apps[0]["track"] == "tir"
    assert apps[0]["picked"] is False
```

> If `test_jury_admin.py` names its install/override helpers differently, use those exact names — do not invent `_install_admin_fake`/`_override_admin` if the file already provides equivalents.

- [ ] **Step 2: Run it to confirm it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_jury_admin.py::test_juror_applications_degrades_on_bad_row -v --no-cov`
Expected: FAIL (either a 500 from an unguarded `stats.derive_project_name`, or a helper raising).

- [ ] **Step 3: Harden the builder**

In `backend/app/services/admin_query.py`, replace the body from the enrichment lookups through the return (currently lines ~1059-1113) with a version that (a) guards each enrichment lookup and (b) wraps each row build:

```python
    def _safe(fn, default):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — degrade, never 500 the drawer
            log.warning("juror apps: enrichment lookup failed", extra={"err": str(exc)})
            return default

    project_names = _safe(lambda: applications_query.fetch_project_names_for(pairs), {})
    industries = _safe(lambda: applications_query.fetch_industry_for_pairs(pairs), {})
    batches = _safe(lambda: _fetch_batches(pairs), {})

    # App rows (status + project fallback), one paged query per track.
    app_rows: dict[tuple[str, str], dict] = {}
    for track, ids in _by_track(pairs).items():
        if not ids:
            continue
        try:
            data = _fetch_all(
                lambda tb=track, idl=ids:
                sb.table(applications_query.track_table(tb)).select("*").in_("id", idl)
            )
        except Exception:
            data = []
        for r in data:
            app_rows[(track, r["id"])] = r

    picked_keys: set[tuple[str, str]] = set()
    try:
        for s in _fetch_all(
            lambda: sb.table("jury_selections").select("*").eq("juror_user_id", user_id)
        ):
            if s.get("juror_user_id") == user_id:
                picked_keys.add((s.get("application_track"), s.get("application_id")))
    except Exception:
        pass

    out: list[dict[str, Any]] = []
    for a in active:
        try:
            key = (a["application_track"], a["application_id"])
            r = app_rows.get(key) or {}
            if a["application_track"] == "sip":
                project = r.get("basic_org") or r.get("basic_full_name")
            else:
                project = (
                    project_names.get(key)
                    or _safe(lambda rr=r: stats.derive_project_name(rr), None)
                    or r.get("basic_org")
                    or r.get("basic_full_name")
                )
            out.append({
                "id":            a["application_id"],
                "track":         a["application_track"],
                "project":       project,
                "industry":      (industries.get(key) or {}).get("label"),
                "status":        r.get("status"),
                "batch":         (batches.get(key) or {}).get("name"),
                "picked":        key in picked_keys,
                "assignment_id": a.get("id"),
            })
        except Exception as exc:  # noqa: BLE001 — one bad row must not sink the list
            log.warning("juror apps: row build failed", extra={"err": str(exc)})
            out.append({
                "id": a.get("application_id"), "track": a.get("application_track"),
                "project": None, "industry": None, "status": None,
                "batch": None, "picked": False, "assignment_id": a.get("id"),
            })
    out.sort(key=lambda i: (i.get("project") or "").lower())
    return {"applications": out}
```

(Keep the existing assignment-fetch try/except and the `active`/`pairs` lines above unchanged.)

- [ ] **Step 4: Run the test + the whole file**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_jury_admin.py -v --no-cov`
Expected: PASS, including the new test and all pre-existing jury-admin tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/admin_query.py backend/tests/test_jury_admin.py
git commit -m "fix(jury): admin juror-applications drawer degrades per-row instead of 500"
```

---

## Task 3: Atomic pick write + CORS-safe error in `put_selections` (Issues 5 & 6)

**Files:**
- Modify: `backend/app/routers/jury.py:144-154`
- Test: `backend/tests/test_jury_selections.py` (add one test)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_jury_selections.py` (top-level, after the imports it already has). It injects a client whose `jury_selections` writes raise, and asserts the endpoint returns a **JSON 500** with `selection_write_failed` (not an unhandled crash) and leaves no partial rows:

```python
class _BoomOnSelectionWrite(FakeSupabase):
    """FakeSupabase whose jury_selections upsert/delete raise, to prove the
    endpoint returns a handled JSON error instead of a CORS-less 500."""
    def table(self, name):
        q = super().table(name)
        if name == "jury_selections":
            orig = q.execute
            def _execute():
                if q._mode in ("upsert", "delete"):
                    raise RuntimeError("db down")
                return orig()
            q.execute = _execute
        return q


def test_put_write_failure_returns_json_error(client, monkeypatch, _clear_overrides):
    from app.routers import jury as jury_router
    from app.services import applications_query, jury_query
    fake = _BoomOnSelectionWrite({"jury_assignments": list(_ALL_ASSIGNMENTS),
                                  "jury_selections": []})
    monkeypatch.setattr(jury_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(jury_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(J1)

    r = _put(client, [_sel("a1"), _sel("a2"), _sel("a3")])
    assert r.status_code == 500, r.text
    assert r.json()["detail"]["code"] == "selection_write_failed"
    # no partial persistence
    assert [row for row in fake.tables["jury_selections"] if row.get("juror_user_id") == J1] == []
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_jury_selections.py::test_put_write_failure_returns_json_error -v --no-cov`
Expected: FAIL — currently the `RuntimeError` bubbles as an unhandled 500 (TestClient re-raises), not a JSON `selection_write_failed`.

- [ ] **Step 3: Rewrite the write block**

In `backend/app/routers/jury.py`, replace the write section (currently lines 144-154, from `now = ...` through the `return`) with an atomic bulk upsert wrapped in try/except. **Upsert the 3 picks first (one call), then delete removed keys** — so a failure never loses the current set:

```python
    now = datetime.now(UTC).isoformat()
    try:
        rows = [{
            "juror_user_id": juror_id, "application_id": s.application_id,
            "application_track": s.application_track, "note": s.note,
            "submitted_at": now, "updated_at": now,
        } for s in body.selections]
        sb.table("jury_selections").upsert(
            rows, on_conflict="application_id,application_track,juror_user_id").execute()
        for key in current_keys - new_keys:   # drop de-selected picks
            sb.table("jury_selections").delete().eq("juror_user_id", juror_id) \
                .eq("application_id", key[0]).eq("application_track", key[1]).execute()
    except HTTPException:
        raise
    except Exception:
        log.exception("jury selection write failed", extra={"juror": juror_id})
        raise HTTPException(status_code=500, detail={
            "code": "selection_write_failed",
            "message": "Couldn't save your picks — please try again."})
    return {"selections": jury_query.fetch_my_selections(juror_id), "submitted_at": now}
```

(Leave the exactly-3 / ownership / gate-2-freeze validation above it unchanged — those still raise 422/403/409 before the try.)

- [ ] **Step 4: Run the whole selections file**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_jury_selections.py -v --no-cov`
Expected: PASS — the new test plus all existing ones (`test_put_creates_three_rows_with_notes`, `test_put_set_replace_swaps`, freeze tests, `test_get_mine…`) stay green (the bulk upsert + drop-loop preserves set-replace semantics).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/jury.py backend/tests/test_jury_selections.py
git commit -m "fix(jury): atomic bulk pick write + JSON error on failure (no partial picks, no opaque fetch fail)"
```

---

## Task 4: Global CORS-safe 500 middleware (Issue 6 safety net)

**Files:**
- Modify: `backend/app/utils/middleware.py` (add class)
- Modify: `backend/app/main.py` (import + register innermost)
- Test: `backend/tests/test_cors_safe_errors.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_cors_safe_errors.py`:

```python
"""Any unhandled 500 must be returned INSIDE the CORS layer so the browser
gets Access-Control-Allow-Origin instead of an opaque 'Failed to fetch'."""
from __future__ import annotations

from app.config import settings
from app.deps import get_current_user
from app.main import app


def _override_jury():
    return {"user_id": "j1", "email": "j1@x.com", "roles": ["jury"]}


def test_unhandled_500_carries_cors_headers(client, monkeypatch):
    from app.services import jury_query
    monkeypatch.setattr(jury_query, "fetch_jury_queue",
                        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom")))
    app.dependency_overrides[get_current_user] = _override_jury
    try:
        origin = settings.frontend_origins[0] if settings.frontend_origins else None
        headers = {"Origin": origin} if origin else {}
        r = client.get("/jury/queue", headers=headers)
        assert r.status_code == 500, r.text
        assert r.json()["error"]["code"] == "internal_error"
        if origin:
            assert r.headers.get("access-control-allow-origin") == origin
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_cors_safe_errors.py -v --no-cov`
Expected: FAIL — the `RuntimeError` is re-raised by the TestClient (no catch-all yet), so no JSON 500 body.

- [ ] **Step 3: Add the middleware class**

Append to `backend/app/utils/middleware.py` (it already imports `BaseHTTPMiddleware`, `Request`; add `JSONResponse`):

```python
from starlette.responses import JSONResponse


class CorsSafeErrorMiddleware(BaseHTTPMiddleware):
    """Catch unhandled exceptions and return a JSON 500.

    Registered as the INNERMOST app middleware, so its response travels back
    out through CORSMiddleware (which sits outside it) and picks up
    Access-Control-Allow-Origin. Starlette's built-in ServerErrorMiddleware is
    outside CORS, so without this a bare exception yields a CORS-less 500 that
    the browser reports as 'Failed to fetch'. HTTPExceptions are already handled
    upstream (ExceptionMiddleware) and never reach here.
    """

    async def dispatch(self, request: Request, call_next) -> Any:
        try:
            return await call_next(request)
        except Exception:
            log.exception("unhandled error", extra={"path": request.url.path})
            return JSONResponse(
                status_code=500,
                content={"error": {"code": "internal_error",
                                   "message": "Internal server error"}},
            )
```

- [ ] **Step 4: Register it innermost in `main.py`**

In `backend/app/main.py`, update the import (line 59) and add the registration as the FIRST `add_middleware` call so it is innermost (added first = closest to routes = inside CORS):

```python
from .utils.middleware import (
    CorsSafeErrorMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
```

Then, immediately before the existing `app.add_middleware(RequestContextMiddleware)` (line 129), insert:

```python
# Innermost: convert unhandled exceptions to a JSON 500 that still flows back
# out through CORS below (so cross-origin callers get a real error, not a
# browser 'Failed to fetch').
app.add_middleware(CorsSafeErrorMiddleware)
```

- [ ] **Step 5: Run the test + a broad smoke**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_cors_safe_errors.py backend/tests/test_jury_selections.py backend/tests/test_jury_portal.py -v --no-cov`
Expected: PASS. (Confirms the catch-all handles 500s and does not alter normal 2xx/4xx flows.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/utils/middleware.py backend/app/main.py backend/tests/test_cors_safe_errors.py
git commit -m "fix(api): CORS-safe 500 middleware so cross-origin errors aren't opaque 'Failed to fetch'"
```

---

## Task 5: Suggestion checklist in ManageJurorsDrawer (Issue 2 — per-juror)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/ManageJurorsDrawer.jsx`
- Test (create): `frontend/src/pages/admin/platform/screens/__tests__/ManageJurorsDrawer.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/platform/screens/__tests__/ManageJurorsDrawer.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../lib/leadershipApi", () => ({
  leadershipApi: { assignJurors: vi.fn().mockResolvedValue({ results: [{ status: "assigned" }] }),
                   unassignJuror: vi.fn() },
}));
vi.mock("../../../../../lib/adminPlatformApi", () => ({ adminPlatformApi: {} }));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { leadershipApi } from "../../../../../lib/leadershipApi";
import { ManageJurorsDrawer } from "../ManageJurorsDrawer";

const JUROR = { id: "j1", name: "Dr. Iyer", domain: "Robotics" };
const SUG_A = { id: "app-a", track: "tir", name: "MedAtlas", domain: "Health",
                chip: "JURY REVIEW", recommendation: { score: 92 } };
const SUG_B = { id: "app-b", track: "tir", name: "Biosensors", domain: "Health",
                chip: "JURY REVIEW", recommendation: { score: 88 } };

function setup() {
  useAdminData.mockImplementation((kind) => {
    if (kind === "jurorApplications")
      return { data: { applications: [] }, loading: false, error: null, reload: vi.fn() };
    if (kind === "pipeline")
      return { data: { startups: [SUG_A, SUG_B] }, loading: false, error: null, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

describe("ManageJurorsDrawer — suggest-then-confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows AI suggestions pre-checked and no auto-assign button", () => {
    setup();
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/Suggested matches/i)).toBeTruthy();
    expect(screen.queryByText(/Auto-assign matches/i)).toBeNull();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(2);
    expect(boxes.every(b => b.checked)).toBe(true);
    expect(screen.getByText(/Assign selected \(2\)/i)).toBeTruthy();
  });

  it("assigns only the checked suggestions", async () => {
    setup();
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]);                 // uncheck Biosensors
    expect(screen.getByText(/Assign selected \(1\)/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Assign selected/i));
    await waitFor(() => expect(leadershipApi.assignJurors).toHaveBeenCalledTimes(1));
    expect(leadershipApi.assignJurors).toHaveBeenCalledWith("app-a", "tir", { juror_user_ids: ["j1"] });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ManageJurorsDrawer.test.jsx`
Expected: FAIL — no "Suggested matches" section / checkboxes yet; "Auto-assign matches" still present.

- [ ] **Step 3: Replace the auto-assign button with the checklist**

In `ManageJurorsDrawer.jsx`:

(a) Add `useEffect` to the React import (line 15): `import React, { useState, useMemo, useEffect } from "react";`

(b) Delete `handleAutoAssignJuror` (lines 65-75) and the `autoBusy` state's old use. Keep `const [autoBusy, setAutoBusy] = useState(false);`.

(c) After the `candidates` useMemo (ends line 61), add suggestion state:

```jsx
  const suggestions = useMemo(
    () => candidates.filter(c => c.recommendation?.score != null),
    [candidates]);
  const [checked, setChecked] = useState(null);   // Set<id> | null (uninitialised)
  useEffect(() => {
    if (checked === null && suggestions.length)
      setChecked(new Set(suggestions.map(s => s.id)));
  }, [suggestions, checked]);
  const toggleCheck = (id) => setChecked(prev => {
    const next = new Set(prev || []);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectedCount = checked ? suggestions.filter(s => checked.has(s.id)).length : 0;

  const handleAssignSelected = async () => {
    const picks = suggestions.filter(s => checked?.has(s.id));
    if (!picks.length) return;
    setAutoBusy(true); setErr(null); setNotice(null);
    try {
      for (const appRow of picks) {
        await leadershipApi.assignJurors(appRow.id, appRow.track, { juror_user_ids: [juror.id] });
      }
      setChecked(null);
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Assign failed.");
    } finally { setAutoBusy(false); }
  };
```

(d) Replace the old auto-assign button (lines 172-175) with the suggestions block:

```jsx
            {suggestions.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>
                  Suggested matches (AI)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {suggestions.map(s => (
                    <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        aria-label={`Suggest ${s.name}`}
                        checked={!!checked?.has(s.id)}
                        onChange={() => toggleCheck(s.id)}
                      />
                      <span style={{ flex: 1 }}>{s.name} <span className="os-text-soft">({s.domain || "—"})</span></span>
                      <span className="os-chip purple" style={{ fontSize: 11, padding: "1px 6px", fontWeight: 700 }}>★{Math.round(s.recommendation.score)}</span>
                    </label>
                  ))}
                </div>
                <button
                  className="os-btn secondary sm"
                  style={{ marginTop: 10 }}
                  onClick={handleAssignSelected}
                  disabled={autoBusy || selectedCount === 0}
                >
                  {autoBusy ? "Assigning…" : `Assign selected (${selectedCount})`}
                </button>
              </div>
            )}
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ManageJurorsDrawer.test.jsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/ManageJurorsDrawer.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/ManageJurorsDrawer.test.jsx
git commit -m "feat(jury): drawer suggests AI matches as a pre-checked checklist; admin confirms via Assign selected"
```

---

## Task 6: "Refresh AI suggestions" bulk button (Issue 2 — all jurors)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminJury.jsx`
- Test: `frontend/src/pages/admin/platform/__tests__/AdminJury.test.jsx` (update the auto-assign block)

- [ ] **Step 1: Update the test to the new behavior**

In `AdminJury.test.jsx`, replace the whole `describe("AdminJury v2 — auto-assign", …)` block (lines 187-208) with:

```jsx
describe("AdminJury v2 — refresh suggestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Refresh AI suggestions recomputes for all jurors (no juror id) and does not assign", async () => {
    adminPlatformApi.recomputeRecommendations.mockResolvedValue({ queued: ["j1", "j2"] });
    setup({ jurors: [JUROR_DONE] });
    render(<AdminJury />);
    fireEvent.click(screen.getByText(/Refresh AI suggestions/i));
    await waitFor(() =>
      expect(adminPlatformApi.recomputeRecommendations).toHaveBeenCalledWith());
    expect(adminPlatformApi.autoAssignJury).not.toHaveBeenCalled();
  });

  it("is enabled even when no juror has matchedAt yet", () => {
    setup({ jurors: [JUROR_DONE] });
    render(<AdminJury />);
    expect(screen.getByText(/Refresh AI suggestions/i).closest("button")).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminJury.test.jsx`
Expected: FAIL — button text is still "Auto-assign from AI matches" and calls `autoAssignJury`.

- [ ] **Step 3: Rewire the header button**

In `AdminJury.jsx`, replace `handleAutoAssign` (lines 504-516) with:

```jsx
  const handleRefreshSuggestions = async () => {
    setAutoAssigning(true); setAutoMsg(null);
    try {
      const r = await adminPlatformApi.recomputeRecommendations();   // no id → all jurors
      const n = Array.isArray(r?.queued) ? r.queued.length : 0;
      setAutoMsg(`Refreshing AI suggestions for ${n} juror(s) — open a juror to review & assign.`);
    } catch (e) {
      setAutoMsg(e?.message || "Couldn't refresh suggestions.");
    } finally {
      setAutoAssigning(false);
    }
  };
```

Replace the header "auto" button (lines 532-536) with:

```jsx
          <button key="auto" className="os-btn secondary" onClick={handleRefreshSuggestions}
            disabled={autoAssigning}>
            {autoAssigning ? "Refreshing…" : "Refresh AI suggestions"}
          </button>,
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminJury.test.jsx`
Expected: PASS (all AdminJury tests, including the rewritten block).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminJury.jsx \
        frontend/src/pages/admin/platform/__tests__/AdminJury.test.jsx
git commit -m "feat(jury): header button recomputes AI suggestions for all jurors (assigns nothing)"
```

---

## Task 7: Recolor jury surfaces to purple, zero green (Issue 3)

**Files:**
- Modify: `frontend/src/pages/jury/jury.css:8-12`
- Modify: `frontend/src/pages/jury/JuryPortal.jsx:71`
- Modify: `frontend/src/pages/jury/JuryQueue.jsx:165`
- Modify: `frontend/src/pages/jury/JuryAppView.jsx:130-131`
- Modify: `frontend/src/pages/admin/platform/screens/AdminJury.jsx:436`
- Modify: `frontend/src/pages/admin/platform/screens/ManageJurorsDrawer.jsx:211`

No test (pure CSS/color); verified visually in Task 9.

- [ ] **Step 1: Swap the CSS accent vars**

In `frontend/src/pages/jury/jury.css`, replace lines 6-12 (the comment + `:root` block) with:

```css
   Accent: ARTPARK purple #3213b7 (design-system --accent). */

:root {
  --jry-green: #3213b7;
  --jry-green-soft: #efecfb;
  --jry-green-line: #d9d2f7;
}
```

(Leaving the var *names* keeps every downstream reference working; only the values change. All `.jry-*` rules now render purple.)

- [ ] **Step 2: Swap the inline hexes**

- `JuryPortal.jsx:71` — change `background: "#1a6b3a"` to `background: "#3213b7"`.
- `JuryQueue.jsx:165` — change the score-bar fill `background: "#2f6f62"` to `background: "#3213b7"`.
- `JuryAppView.jsx:130-131` — change the AI-overall `color: "#2f6f62"` to `color: "#3213b7"`.

- [ ] **Step 3: Picked chips → purple (no green)**

- `AdminJury.jsx:436` — change `className="os-chip green"` to `className="os-chip purple"`.
- `ManageJurorsDrawer.jsx:211` — change `className="os-chip green"` to `className="os-chip purple"`.

- [ ] **Step 4: Verify no green remains**

Run:
```bash
grep -rn "1a6b3a\|2f6f62\|os-chip green\|--jry-green: #1a" frontend/src/pages/jury frontend/src/pages/admin/platform/screens/AdminJury.jsx frontend/src/pages/admin/platform/screens/ManageJurorsDrawer.jsx
```
Expected: no matches (empty output).

- [ ] **Step 5: Run the jury frontend tests (regression)**

Run: `cd frontend && npx vitest run src/pages/jury`
Expected: PASS (recolor doesn't change behavior).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/jury/jury.css frontend/src/pages/jury/JuryPortal.jsx \
        frontend/src/pages/jury/JuryQueue.jsx frontend/src/pages/jury/JuryAppView.jsx \
        frontend/src/pages/admin/platform/screens/AdminJury.jsx \
        frontend/src/pages/admin/platform/screens/ManageJurorsDrawer.jsx
git commit -m "style(jury): recolor portal + admin jury to design-system purple, remove all green"
```

---

## Task 8: HOME buttons (Issue 4)

**Files:**
- Modify: `frontend/src/pages/jury/jury.css` (add `.lp-home-btn` rule)
- Modify: `frontend/src/pages/admin/platform/AdminPortal.jsx:395`
- Modify: `frontend/src/pages/admin/platform/screens/AdminJury.jsx` (accept `go`, render button)
- Test: `frontend/src/pages/admin/platform/__tests__/AdminJury.test.jsx` (one assertion)

- [ ] **Step 1: Write the failing test (admin ← Dashboard)**

Append to the `describe("AdminJury v2 — roster tab", …)` block in `AdminJury.test.jsx`:

```jsx
  it("shows a Dashboard back button that calls go('dashboard')", () => {
    const go = vi.fn();
    setup({ jurors: [JUROR_DONE] });
    render(<AdminJury go={go} />);
    fireEvent.click(screen.getByText(/← Dashboard/));
    expect(go).toHaveBeenCalledWith("dashboard");
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminJury.test.jsx`
Expected: FAIL — no "← Dashboard" button.

- [ ] **Step 3: Add the admin button + wire the prop**

In `AdminJury.jsx`, change the signature (line 456) `export function AdminJury() {` → `export function AdminJury({ go } = {}) {`. Immediately inside the returned `<div className="dash-scroll">` (right after the `<style .../>` on line 525), add:

```jsx
      {go && (
        <button className="os-btn ghost sm" style={{ marginBottom: 12 }}
          onClick={() => go("dashboard")}>← Dashboard</button>
      )}
```

In `AdminPortal.jsx:395`, pass the setter:
```jsx
            {page === 'reviewers'   && (decisionMode === 'jury' ? <AdminJury go={setPage} /> : <AdminReviewers decisionMode={decisionMode} />)}
```

- [ ] **Step 4: Style the jury portal HOME button**

Append to `frontend/src/pages/jury/jury.css`:

```css
/* ── Topbar HOME button (was unstyled) ────────────────────────────────── */
.jry-portal .lp-home-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 8px;
  border: 1px solid var(--line-strong, #c8c8d0);
  background: #fff; color: var(--ink, #242424);
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 700;
  letter-spacing: 0.02em; cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.jry-portal .lp-home-btn:hover { background: var(--jry-green-soft); border-color: var(--jry-green-line); color: var(--jry-green); }
.jry-portal .lp-home-btn:focus-visible { outline: 2px solid var(--jry-green); outline-offset: 2px; }
```

- [ ] **Step 5: Run the test**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminJury.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/jury/jury.css frontend/src/pages/admin/platform/AdminPortal.jsx \
        frontend/src/pages/admin/platform/screens/AdminJury.jsx \
        frontend/src/pages/admin/platform/__tests__/AdminJury.test.jsx
git commit -m "style(jury): style jury-portal HOME button + add admin Dashboard back button"
```

---

## Task 9: Full verification + deploy

**Files:** none (build + deploy).

- [ ] **Step 1: Backend suite (targeted)**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_jury_admin.py backend/tests/test_jury_selections.py backend/tests/test_cors_safe_errors.py backend/tests/test_jury_portal.py --no-cov -q`
Expected: all PASS. (Note: the wider suite has ~19-22 pre-existing unrelated failures; confirm any failure here is in a file this plan did NOT touch before treating it as a regression.)

- [ ] **Step 2: Frontend build + tests**

Run:
```bash
cd frontend && npx vitest run src/pages/jury src/pages/admin/platform && npm run build
```
Expected: tests PASS; build succeeds.

- [ ] **Step 3: Pre-deploy intake-flag guard**

Run: `grep -E "TIR_SUBMISSIONS_CLOSED|SIP_SUBMISSIONS_CLOSED" backend/.env.prod`
Expected: both `=true`. **Do not deploy if either is unset/false** (deploy would reopen intake).

- [ ] **Step 4: Backend SAM deploy**

Run: `bash infra/sam/deploy-prod.sh`
Expected: successful CloudFormation deploy of the Lambda.

- [ ] **Step 5: Push branch + verify origin tip**

```bash
git push origin HEAD:release/sip-launch-v1
git rev-parse HEAD && git ls-remote origin release/sip-launch-v1
```
Expected: local HEAD == origin `release/sip-launch-v1` tip.

- [ ] **Step 6: Hand off frontend promote**

Tell the user: backend is deployed; **frontend Vercel promote is theirs to do**. After promote, live-verify: (a) admin Jury → open a juror → drawer loads (no "Failed to load") and shows the AI-suggestion checklist; (b) juror submits 3 picks → "Picks submitted ✓" (no "Failed to fetch"), reload shows all 3; (c) no green anywhere on the jury portal / admin jury; (d) both HOME/Dashboard buttons styled.

---

## Notes / gotchas for the implementer

- **Never** add a `Co-Authored-By` / AI trailer to commits (user's global rule).
- The `unassign_juror` cascade (`backend/app/routers/leadership_actions.py:424-495`) hard-deletes a juror's `jury_selections` when its assignment is removed — this is intended and **out of scope**; do not "fix" it.
- Do not touch the `jury_assignments` schema — the suggest/confirm split reuses `jury_recommendations` (suggestions) vs `jury_assignments` (confirmed). No migration.
- The `POST /admin/platform/jury/auto-assign` endpoint + `auto_assign_from_recommendations` stay in the codebase (still covered by `test_jury_auto_assign.py`); they are simply no longer called from the UI. Do not delete them.
- Run single backend files with `--no-cov` (repo coverage gate fails on single-file runs).
