# Admin "Manage Applications" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a "Manage Applications" drawer on the Reviewer Roster to view, assign, and remove individual applications for one reviewer (today only whole batches can be removed).

**Architecture:** Add one read endpoint (`GET /admin/platform/reviewers/{user_id}/applications`) that lists a reviewer's active assignments enriched with project/industry/status/batch. Reuse the existing per-app assign/unassign endpoints (`POST/DELETE /leadership/applications/{id}/reviewers`). Fix the dead unassign guard so it checks `submitted_at` (not the never-set `status`). Replace the reviewer-mode Manage button's target with a new `ManageApplicationsDrawer`; keep reviewer-detail editing on the existing "Edit reviewer" button.

**Tech Stack:** FastAPI + Supabase (PostgREST) Python backend; React (Vite/Vitest) frontend. Worktree: `.claude/worktrees/feat-admin-manage-applications`, branch `feat/admin-manage-applications` (off prod tip `9271654`).

**Commit rule:** every commit is solely authored by the user — NO `Co-Authored-By: Claude` / AI trailer. Use `git -c commit.gpgsign=false commit`.

---

## File structure

- `backend/app/services/admin_query.py` — **add** `fetch_reviewer_applications(user_id)`.
- `backend/app/routers/admin_platform.py` — **add** `GET /reviewers/{user_id}/applications`.
- `backend/app/routers/leadership_actions.py` — **fix** unassign guard (`status` → `submitted_at`).
- `backend/tests/test_admin_platform.py` — **add** endpoint test.
- `backend/tests/test_leadership_writes.py` — **add** guard tests (submitted blocks / draft allows).
- `frontend/src/lib/adminPlatformApi.js` — **add** `getReviewerApplications`.
- `frontend/src/lib/adminDataAdapter.js` — **add** `adaptReviewerApplication`.
- `frontend/src/hooks/useAdminData.js` — **add** `reviewerApplications` loader.
- `frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx` — **new** drawer component.
- `frontend/src/pages/admin/platform/screens/AdminReviewers.jsx` — **wire** Manage button → new drawer.
- `frontend/src/pages/admin/platform/__tests__/AdminReviewers.test.jsx` — **add** drawer tests.

---

## Task 1: Backend — `fetch_reviewer_applications(user_id)`

**Files:**
- Modify: `backend/app/services/admin_query.py` (add after `fetch_roster`, ~line 544)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_admin_platform.py` (uses the file's existing `_install_db` + `client` + `_clear_overrides` fixtures):

```python
def test_reviewer_applications_lists_active_assignments(client, monkeypatch, _clear_overrides):
    from app.deps import get_current_user
    from app.main import app
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "admin-1", "roles": ["admin"], "track": "tir",
    }
    _install_db(monkeypatch, {
        "user_roles": [{"user_id": "rev-1", "role": "reviewer"}],
        "reviewer_assignments": [
            {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
             "application_track": "tir", "declined_at": None, "reassigned_to": None,
             "completed_at": None},
            {"id": "as-2", "reviewer_user_id": "rev-1", "application_id": "app-2",
             "application_track": "tir", "declined_at": "2026-06-01", "reassigned_to": None,
             "completed_at": None},  # declined → excluded
        ],
        "tir_applications": [
            {"id": "app-1", "status": "under_review", "basic_org": "Acme",
             "basic_full_name": "A Founder", "display_seq": 101},
            {"id": "app-2", "status": "evaluated", "basic_org": "Beta", "display_seq": 102},
        ],
        "sip_applications": [],
        "ai_screening": [{"application_id": "app-1", "application_track": "tir",
                          "project_name": "Acme Robotics", "industry_category_id": "ind-1"}],
        "industry_categories": [{"id": "ind-1", "label": "Robotics"}],
        "reviews": [{"id": "r-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
                     "application_track": "tir", "submitted_at": None}],
        "application_batches": [{"application_id": "app-1", "application_track": "tir",
                                 "batch_id": "b-1"}],
        "batches": [{"id": "b-1", "name": "Batch A"}],
    })
    r = client.get("/admin/platform/reviewers/rev-1/applications")
    assert r.status_code == 200
    apps = r.json()["applications"]
    assert [a["id"] for a in apps] == ["app-1"]          # declined app-2 excluded
    a = apps[0]
    assert a["project"] == "Acme Robotics"
    assert a["industry"] == "Robotics"
    assert a["status"] == "under_review"
    assert a["batch"] == "Batch A"
    assert a["reviewStatus"] == "pending"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_admin_platform.py::test_reviewer_applications_lists_active_assignments -v`
Expected: FAIL — 404/`AttributeError: fetch_reviewer_applications` (endpoint/function not present yet).

- [ ] **Step 3: Implement `fetch_reviewer_applications`**

Add to `backend/app/services/admin_query.py` after `fetch_roster` (before the `# ─── Task 13` comment, ~line 544):

```python
def fetch_reviewer_applications(user_id: str) -> dict[str, Any]:
    """Applications actively assigned to one reviewer, enriched for the admin
    "Manage Applications" drawer. Active = declined_at IS NULL AND
    reassigned_to IS NULL. Returns ``{"applications": [...]}`` with each row:
    ``{id, track, project, industry, status, batch, reviewStatus, assignment_id}``.
    ``batch`` is None when the app belongs to no batch (UI → "Random allotment").
    """
    sb = get_admin_client()
    try:
        rows = (
            sb.table("reviewer_assignments")
            .select("*")
            .eq("reviewer_user_id", user_id)
            .execute()
            .data
        ) or []
    except Exception as exc:
        log.warning("reviewer apps: assignments fetch failed", extra={"err": str(exc)})
        return {"applications": []}

    active = [
        a for a in rows
        if a.get("reviewer_user_id") == user_id
        and a.get("declined_at") is None
        and a.get("reassigned_to") is None
    ]
    pairs = [(a["application_track"], a["application_id"]) for a in active]
    if not pairs:
        return {"applications": []}

    project_names = applications_query.fetch_project_names_for(pairs)
    industries = applications_query.fetch_industry_for_pairs(pairs)
    batches = _fetch_batches(pairs)

    # App rows (status + project fallback), one query per track.
    app_rows: dict[tuple[str, str], dict] = {}
    for track, ids in _by_track(pairs).items():
        try:
            data = (
                sb.table(applications_query.track_table(track))
                .select("*").in_("id", ids).execute().data
            ) or []
        except Exception:
            data = []
        for r in data:
            app_rows[(track, r["id"])] = r

    # Which of these apps has this reviewer already SUBMITTED a review for?
    submitted: set[tuple[str, str]] = set()
    try:
        for r in (
            sb.table("reviews").select("*").eq("reviewer_user_id", user_id).execute().data
        ) or []:
            if r.get("reviewer_user_id") == user_id and r.get("submitted_at"):
                submitted.add((r.get("application_track"), r.get("application_id")))
    except Exception:
        pass

    out: list[dict[str, Any]] = []
    for a in active:
        key = (a["application_track"], a["application_id"])
        r = app_rows.get(key) or {}
        project = (
            project_names.get(key)
            or stats.derive_project_name(r)
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
            "reviewStatus":  "submitted" if key in submitted else "pending",
            "assignment_id": a.get("id"),
        })
    out.sort(key=lambda i: (i.get("project") or "").lower())
    return {"applications": out}
```

- [ ] **Step 4: Run the test (will still 404 until Task 2's route exists)**

Run: `cd backend && python -m pytest tests/test_admin_platform.py::test_reviewer_applications_lists_active_assignments -v`
Expected: still FAIL (404) — the route is added in Task 2. (The function now exists; importing `admin_query.fetch_reviewer_applications` works.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/admin_query.py backend/tests/test_admin_platform.py
git -c commit.gpgsign=false commit -m "feat(admin): fetch_reviewer_applications query for per-reviewer app list"
```

---

## Task 2: Backend — `GET /admin/platform/reviewers/{user_id}/applications`

**Files:**
- Modify: `backend/app/routers/admin_platform.py` (after `list_reviewers`, ~line 564)

- [ ] **Step 1: Add the route**

Insert immediately after the `list_reviewers` function (ends ~line 564):

```python
@router.get(
    "/reviewers/{user_id}/applications",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def list_reviewer_applications(user_id: str) -> dict[str, Any]:
    """Applications actively assigned to one reviewer (Manage Applications drawer)."""
    return admin_query.fetch_reviewer_applications(user_id)
```

- [ ] **Step 2: Run the Task 1 test — now passes**

Run: `cd backend && python -m pytest tests/test_admin_platform.py::test_reviewer_applications_lists_active_assignments -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/admin_platform.py
git -c commit.gpgsign=false commit -m "feat(admin): GET /admin/platform/reviewers/{id}/applications endpoint"
```

---

## Task 3: Backend — fix the dead unassign guard

The guard in `unassign_reviewer` checks `reviews.status == "submitted"`, but the submit pipeline never sets `reviews.status` (only `submitted_at`). Today the guard never fires, so a submitted score can be orphaned. Fix it to check `submitted_at`, in Python (no `.not_` — keeps the fake test client happy).

**Files:**
- Modify: `backend/app/routers/leadership_actions.py` (~lines 209-230, the pre-check block)
- Test: `backend/tests/test_leadership_writes.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_leadership_writes.py` (reuse its existing fake-DB + client fixtures; match the local idiom for seeding + dependency override — mirror an existing `unassign`/`assign` test in that file for fixture names):

```python
def test_unassign_blocked_when_review_submitted(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "tir_applications": [{"id": "app-1", "status": "under_review"}],
        "sip_applications": [],
        "reviewer_assignments": [{"id": "as-1", "reviewer_user_id": "rev-1",
            "application_id": "app-1", "application_track": "tir",
            "declined_at": None, "reassigned_to": None}],
        "reviews": [{"id": "r-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
            "application_track": "tir", "submitted_at": "2026-06-01T00:00:00Z"}],
    })
    r = client.delete("/leadership/applications/app-1/reviewers/rev-1")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "review_already_submitted"


def test_unassign_allowed_when_review_is_draft(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "tir_applications": [{"id": "app-1", "status": "under_review"}],
        "sip_applications": [],
        "reviewer_assignments": [{"id": "as-1", "reviewer_user_id": "rev-1",
            "application_id": "app-1", "application_track": "tir",
            "declined_at": None, "reassigned_to": None}],
        "reviews": [{"id": "r-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
            "application_track": "tir", "submitted_at": None}],  # draft
    })
    r = client.delete("/leadership/applications/app-1/reviewers/rev-1")
    assert r.status_code == 200
```

(If `test_leadership_writes.py` uses different fixture/seed helper names, adapt these two tests to that file's idiom — same assertions.)

- [ ] **Step 2: Run to verify the submitted-blocks test fails**

Run: `cd backend && python -m pytest tests/test_leadership_writes.py::test_unassign_blocked_when_review_submitted -v`
Expected: FAIL — returns 200 (guard never fires today).

- [ ] **Step 3: Fix the guard**

In `backend/app/routers/leadership_actions.py`, replace the `reviews` pre-check query + condition (the block selecting `id,status` with `.eq("status","submitted")`) with:

```python
        rev = (
            get_admin_client()
            .table("reviews")
            .select("id,submitted_at,application_id,application_track,reviewer_user_id")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
        )
        already_submitted = any(
            row.get("submitted_at")
            for row in (rev.data or [])
            if row.get("application_id") == application_id
            and row.get("application_track") == track
            and row.get("reviewer_user_id") == reviewer_user_id
        )
        if already_submitted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "review_already_submitted",
                    "message": "This reviewer has already submitted a review; their assignment can't be revoked.",
                },
            )
```

- [ ] **Step 4: Run both guard tests**

Run: `cd backend && python -m pytest tests/test_leadership_writes.py -k unassign -v`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/leadership_actions.py backend/tests/test_leadership_writes.py
git -c commit.gpgsign=false commit -m "fix(reviewer): unassign guard checks submitted_at, not never-set status"
```

---

## Task 4: Frontend — API client + adapter + hook loader

**Files:**
- Modify: `frontend/src/lib/adminPlatformApi.js`
- Modify: `frontend/src/lib/adminDataAdapter.js`
- Modify: `frontend/src/hooks/useAdminData.js`

- [ ] **Step 1: Add the API method**

In `frontend/src/lib/adminPlatformApi.js`, add right after the `getReviewers` line:

```js
  getReviewerApplications: (userId) =>
    api.get(`/admin/platform/reviewers/${encodeURIComponent(userId)}/applications`),
```

- [ ] **Step 2: Add the adapter**

In `frontend/src/lib/adminDataAdapter.js`, add near `adaptReviewer`:

```js
export const adaptReviewerApplication = (a) => ({
  id: a.id,
  track: a.track,
  project: a.project || "—",
  industry: a.industry || "—",
  status: a.status,
  chip: STATUS_TO_CHIP[a.status] || "NEW",
  batch: a.batch || null,               // null → UI shows "Random allotment"
  reviewStatus: a.reviewStatus || "pending",
  assignmentId: a.assignment_id || null,
});
```

- [ ] **Step 3: Register the hook loader**

In `frontend/src/hooks/useAdminData.js`: add `adaptReviewerApplication` to the import from `adminDataAdapter`, then add to `LOADERS`:

```js
  reviewerApplications: async ({ userId }) => {
    const r = await adminPlatformApi.getReviewerApplications(userId);
    return { applications: (r.applications || []).map(adaptReviewerApplication) };
  },
```

- [ ] **Step 4: Build to verify no import/syntax errors**

Run: `cd frontend && npx vite build 2>&1 | tail -5` (or `npm run build`)
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/adminPlatformApi.js frontend/src/lib/adminDataAdapter.js frontend/src/hooks/useAdminData.js
git -c commit.gpgsign=false commit -m "feat(admin): client+adapter+loader for reviewer applications"
```

---

## Task 5: Frontend — `ManageApplicationsDrawer` component

**Files:**
- Create: `frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx`

- [ ] **Step 1: Create the component**

```jsx
// ManageApplicationsDrawer — admin Reviewer Roster "Manage" drawer.
// View a reviewer's assigned applications (project/industry/status/batch),
// assign a new application by search, and remove (unassign) individual apps.
// Reads:  GET /admin/platform/reviewers/{id}/applications  (useAdminData "reviewerApplications")
//         GET /admin/platform/applications                 (useAdminData "pipeline", assign picker)
// Writes: POST/DELETE /leadership/applications/{id}/reviewers (leadershipApi)
import React, { useState, useMemo } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { leadershipApi } from "../../../../lib/leadershipApi";

export function ManageApplicationsDrawer({ reviewer, onClose, onChanged }) {
  const apps = useAdminData("reviewerApplications", { userId: reviewer.id });
  const pipeline = useAdminData("pipeline", {});
  const [sel, setSel] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const assigned = apps.data?.applications ?? [];
  const assignedIds = useMemo(() => new Set(assigned.map(a => a.id)), [assigned]);
  const reviewerBatches = Array.isArray(reviewer.batches)
    ? reviewer.batches.map(b => (typeof b === "string" ? b : b.name))
    : [];

  const candidates = useMemo(() => {
    const all = (pipeline.data?.startups ?? []).filter(s => !assignedIds.has(s.id));
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(s =>
      `${s.name || ""} ${s.domain || ""}`.toLowerCase().includes(q));
  }, [pipeline.data, assignedIds, search]);

  const reload = () => { apps.reload(); onChanged && onChanged(); };

  const handleAssign = async () => {
    const app = candidates.find(c => c.id === sel) ||
      (pipeline.data?.startups ?? []).find(c => c.id === sel);
    if (!app) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await leadershipApi.assignReviewers(app.id, app.track, {
        reviewer_user_ids: [reviewer.id],
      });
      const st = res?.results?.[0]?.status;
      if (st === "already_assigned") setNotice("Already assigned to this reviewer.");
      setSel(""); setSearch("");
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Assign failed.");
    } finally { setBusy(false); }
  };

  const handleRemove = async (app) => {
    setBusy(true); setErr(null); setNotice(null);
    try {
      await leadershipApi.unassignReviewer(app.id, app.track, reviewer.id);
      reload();
    } catch (e) {
      setErr(
        e?.details?.message ||
        (e?.status === 409
          ? "This reviewer already submitted a review; the assignment can't be revoked."
          : e?.message || "Remove failed."),
      );
    } finally { setBusy(false); }
  };

  return (
    <div
      className="os-drawer-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(36,36,36,0.4)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", justifyContent: "flex-end", animation: "osDrawerFadeIn 0.2s ease-out" }}
    >
      <div
        className="os-drawer"
        onClick={e => e.stopPropagation()}
        style={{ width: 760, maxWidth: "92vw", height: "100%", background: "var(--bg-paper)", borderLeft: "1px solid var(--line-strong)", boxShadow: "-10px 0 40px rgba(36,36,36,0.15)", display: "flex", flexDirection: "column", animation: "osDrawerSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>Manage Applications</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
              Reviewer: <strong>{reviewer.name}</strong>{reviewer.domain ? ` · ${reviewer.domain}` : ""}
            </div>
          </div>
          <button className="os-btn sm ghost" onClick={onClose} style={{ padding: "2px 8px", fontSize: 18 }}>&times;</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Assigned batches (read-only) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600 }}>Assigned Batches:</span>
            {reviewerBatches.length ? reviewerBatches.map(b => (
              <span key={b} className="os-chip" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", fontWeight: 600, padding: "3px 8px" }}>{b}</span>
            )) : <span className="os-text-soft" style={{ fontSize: 13 }}>None</span>}
          </div>

          {/* Assign new application */}
          <div style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: 4, padding: 16 }}>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>Assign New Application</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="os-select"
                aria-label="Application"
                style={{ flex: 1, fontSize: 14 }}
                value={sel}
                onChange={e => setSel(e.target.value)}
              >
                <option value="">Search by name or industry…</option>
                {candidates.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.domain || "—"}){c.batch && c.batch !== "Unassigned" ? ` · ${c.batch}` : " · Unassigned"}
                  </option>
                ))}
              </select>
              <button
                className="os-btn"
                style={{ background: "var(--accent)", color: "#fff" }}
                onClick={handleAssign}
                disabled={!sel || busy}
              >
                Assign Application
              </button>
            </div>
          </div>

          {err && (
            <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>{err}</div>
          )}
          {notice && (
            <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 4 }}>{notice}</div>
          )}

          {/* Assigned applications table */}
          <div>
            <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>
              Assigned Applications ({assigned.length})
            </div>
            {apps.loading ? (
              <div className="os-text-soft" style={{ fontSize: 13, padding: 12 }}>Loading…</div>
            ) : apps.error ? (
              <div style={{ color: "var(--bad)", fontSize: 13, padding: 12 }}>
                Failed to load. <button className="os-btn sm ghost" onClick={apps.reload}>Retry</button>
              </div>
            ) : assigned.length === 0 ? (
              <div className="os-text-soft" style={{ fontSize: 13, padding: 12, border: "1px dashed var(--line)", borderRadius: 4 }}>No applications assigned.</div>
            ) : (
              <table className="os-table">
                <thead>
                  <tr><th>Project</th><th>Industry</th><th>Status</th><th>Batch</th><th></th></tr>
                </thead>
                <tbody>
                  {assigned.map(a => (
                    <tr key={a.id}>
                      <td><div className="startup">{a.project}</div></td>
                      <td className="os-text-soft">{a.industry}</td>
                      <td><span className="os-chip">{a.chip}</span></td>
                      <td>
                        {a.batch
                          ? <span className="os-chip" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)" }}>{a.batch}</span>
                          : <span className="os-chip purple">Random allotment</span>}
                      </td>
                      <td>
                        <button
                          className="os-btn sm ghost"
                          style={{ color: "#FF5A5F" }}
                          onClick={() => handleRemove(a)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 12, background: "var(--bg-soft)" }}>
          <button className="os-btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default ManageApplicationsDrawer;
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd frontend && npx vite build 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx
git -c commit.gpgsign=false commit -m "feat(admin): ManageApplicationsDrawer (per-reviewer assign/remove apps)"
```

---

## Task 6: Frontend — wire the Manage button + tests

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminReviewers.jsx`
- Test: `frontend/src/pages/admin/platform/__tests__/AdminReviewers.test.jsx`

- [ ] **Step 1: Wire the button (reviewer mode only)**

In `AdminReviewers.jsx`:
1. Add import near the other imports:
   ```jsx
   import { ManageApplicationsDrawer } from "./ManageApplicationsDrawer";
   ```
2. Add state beside `manageTarget` (~line 543):
   ```jsx
   const [appsTarget, setAppsTarget] = useState(null);
   ```
3. Reviewer-mode Manage button (~line 834): change
   `onClick={() => setManageTarget(r)}` → `onClick={() => setAppsTarget(r)}`.
   (Leave the **jury-mode** Manage button at ~line 630 unchanged — it still opens the mock `ManageDrawer`.)
4. In the reviewer-mode return, render the drawer (next to the existing `{manageTarget && <ManageDrawer .../>}` block, ~line 845):
   ```jsx
   {appsTarget && (
     <ManageApplicationsDrawer
       reviewer={appsTarget}
       onClose={() => setAppsTarget(null)}
       onChanged={reload}
     />
   )}
   ```
   (The "Edit reviewer" picker at ~line 867 still sets `manageTarget` → the existing edit-details `ManageDrawer`. Unchanged.)

- [ ] **Step 2: Write the failing tests**

In `AdminReviewers.test.jsx`: extend the `adminPlatformApi` mock with `getReviewerApplications` + `getPipeline`, add a `leadershipApi` mock, and make `useAdminData` kind-aware. Add:

```jsx
vi.mock("../../../../lib/leadershipApi", () => ({
  leadershipApi: {
    assignReviewers: vi.fn().mockResolvedValue({ results: [{ status: "created" }] }),
    unassignReviewer: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
import { leadershipApi } from "../../../../lib/leadershipApi";

// kind-aware useAdminData for the drawer
function mockUseAdminData() {
  useAdminData.mockImplementation((kind) => {
    if (kind === "reviewerApplications")
      return { data: { applications: [
        { id: "app-1", track: "tir", project: "Saathi Health AI", industry: "MedTech",
          status: "shortlisted", chip: "SHORTLISTED", batch: "Batch A", reviewStatus: "pending" },
      ] }, loading: false, error: null, reload: vi.fn() };
    if (kind === "pipeline")
      return { data: { startups: [
        { id: "app-9", track: "tir", name: "Karkhana Robotics", domain: "Robotics", batch: "Unassigned" },
      ] }, loading: false, error: null, reload: vi.fn() };
    if (kind === "batches")
      return { data: { batches: [] }, loading: false, error: null, reload: vi.fn() };
    return { data: { reviewers: SAMPLE_REVIEWERS }, loading: false, error: null, reload: vi.fn() };
  });
}

it("Manage opens the Manage Applications drawer and lists assigned apps", () => {
  mockUseAdminData();
  render(<AdminReviewers decisionMode="reviewer" />);
  fireEvent.click(screen.getAllByText("Manage")[0]);
  expect(screen.getByText("Manage Applications")).toBeTruthy();
  expect(screen.getByText("Saathi Health AI")).toBeTruthy();
  expect(screen.getByText(/Assigned Applications \(1\)/)).toBeTruthy();
});

it("Remove calls unassignReviewer", async () => {
  mockUseAdminData();
  render(<AdminReviewers decisionMode="reviewer" />);
  fireEvent.click(screen.getAllByText("Manage")[0]);
  fireEvent.click(screen.getByText("Remove"));
  await waitFor(() =>
    expect(leadershipApi.unassignReviewer).toHaveBeenCalledWith("app-1", "tir", "rev-001"));
});

it("Assign calls assignReviewers", async () => {
  mockUseAdminData();
  render(<AdminReviewers decisionMode="reviewer" />);
  fireEvent.click(screen.getAllByText("Manage")[0]);
  fireEvent.change(screen.getByLabelText("Application"), { target: { value: "app-9" } });
  fireEvent.click(screen.getByText("Assign Application"));
  await waitFor(() =>
    expect(leadershipApi.assignReviewers).toHaveBeenCalledWith(
      "app-9", "tir", { reviewer_user_ids: ["rev-001"] }));
});
```

(`SAMPLE_REVIEWERS[0].id` is `"rev-001"` in the existing fixture — keep those ids consistent.)

- [ ] **Step 3: Run the new tests**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminReviewers.test.jsx`
Expected: PASS (all, including the pre-existing edit-drawer tests — those use the "Edit reviewer" path which is unchanged; if a pre-existing test clicked "Manage" expecting the edit drawer, repoint it to the "Edit reviewer" button).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminReviewers.jsx frontend/src/pages/admin/platform/__tests__/AdminReviewers.test.jsx
git -c commit.gpgsign=false commit -m "feat(admin): Manage button opens ManageApplicationsDrawer + tests"
```

---

## Task 7: Verification gate (no success claim without evidence)

**Files:** none (verification only)

- [ ] **Step 1: Backend test suite**

Run: `cd backend && python -m pytest tests/test_admin_platform.py tests/test_leadership_writes.py tests/test_reviewer.py -q`
Expected: all pass (note any pre-existing unrelated failures explicitly — do not mask them).

- [ ] **Step 2: Frontend tests + build**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/ && npx vite build 2>&1 | tail -5`
Expected: tests pass; build succeeds.

- [ ] **Step 3: Manual smoke (local or staging preview)**

Open the admin portal → Reviewers → Manage on a reviewer. Confirm: assigned apps list loads; Assign adds an app (appears in list); Remove unassigns; removing a reviewer who submitted a review shows the 409 message.

---

## Task 8: Ship to production

**Files:** none (deploy). Backend changed → needs a Lambda deploy; Vercel promote alone is insufficient.

- [ ] **Step 1: Staging verify first**

Deploy the branch to staging (`sam build && sam deploy` against the **staging** stack from an isolated worktree; deploy the frontend to a staging Vercel preview). Smoke-test the drawer end-to-end on staging.

- [ ] **Step 2: Merge to the prod branch**

```bash
git checkout release/sip-launch-v1 && git merge --no-ff feat/admin-manage-applications
```
(Resolve trivially; this branch was cut from the prod tip so it fast-forwards cleanly unless prod advanced.)

- [ ] **Step 3: MANDATORY pre-deploy env check**

Run (in the worktree you will deploy from): `grep -E 'TIR_SUBMISSIONS_CLOSED|SIP_SUBMISSIONS_CLOSED' backend/.env.prod`
Expected: BOTH `=true`. **If either is missing/false, STOP** — deploying would reopen intake (2026-06-23 incident). Fix `.env.prod` before continuing.

- [ ] **Step 4: Deploy backend to prod**

From the isolated worktree (no HEAD-flip mid-build): `cd backend && sam build && sam deploy` against `artpark-eir-api-production` (ap-south-1). Confirm the new route responds: `GET https://api.artpark.info/admin/platform/reviewers/<id>/applications` (with an admin JWT) returns 200.

- [ ] **Step 5: Promote frontend in Vercel**

Manually "Promote to Production" the Ready build for `apply.artpark.info` (prod is not git-auto-deploy).

- [ ] **Step 6: Prod smoke test**

On `apply.artpark.info`: open Manage on a real reviewer, assign + remove one application, confirm the reviewer's `/reviewer` queue reflects the change. Verify the 409 guard on a reviewer with a submitted review.

---

## Self-review notes

- **Spec coverage:** assigned-app list (T1/T2), reuse assign/unassign (T5), guard debug (T3), new drawer + wiring (T5/T6), tests (T1/T3/T6/T7), prod deploy with env check (T8). All spec sections mapped.
- **Type consistency:** backend returns `{id,track,project,industry,status,batch,reviewStatus,assignment_id}`; `adaptReviewerApplication` maps to `{id,track,project,industry,status,chip,batch,reviewStatus,assignmentId}`; drawer reads those exact fields. `leadershipApi.assignReviewers(id, track, body)` / `unassignReviewer(id, track, reviewer_user_id)` signatures match Task 6 assertions.
- **No placeholders:** every code step has complete code; deploy steps reference exact env keys/commands.
