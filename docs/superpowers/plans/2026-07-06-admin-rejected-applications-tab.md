# Rejected Applications Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th admin-portal tab, "Rejected Applications", that shows only admin-rejected apps (`status=rejected`) and remove those apps from the Applications tab.

**Architecture:** One additive backend filter (`exclude_status`) on the existing pipeline endpoint; the two tabs request disjoint sets (`exclude_status=rejected` vs `status=rejected`). The frontend reuses the existing `AdminPipeline` table via new `baseFilter` / `readOnly` / `heading` props; badges are derived from the already-loaded `/stats` data.

**Tech Stack:** FastAPI + supabase-py (backend), React + Vite + Vitest/RTL (frontend). Work in worktree `.claude/worktrees/feat-admin-rejected-tab` (branch `feat/admin-rejected-tab`). Run backend tests with the primary venv: `/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python`.

**Spec:** `docs/superpowers/specs/2026-07-06-admin-rejected-applications-tab-design.md`

---

### Task 1: Backend — `exclude_status` filter

**Files:**
- Modify: `backend/app/routers/admin_platform.py` (`list_pipeline`, ~L47-70)
- Modify: `backend/app/services/admin_query.py` (`fetch_pipeline`, ~L312 + loop ~L318-327)
- Test: `backend/tests/test_admin_platform.py` (append)

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_admin_platform.py`:

```python
def test_pipeline_exclude_status_drops_rejected(client, monkeypatch, _clear_overrides):
    """?exclude_status=rejected omits rejected rows; total reflects the exclusion."""
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": "a-ev", "status": "evaluated", "display_seq": 26001,
         "basic_full_name": "Ev", "basic_email": "e@x.com", "basic_org": "OrgE",
         "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": "a-rej", "status": "rejected", "display_seq": 26002,
         "basic_full_name": "Rej", "basic_email": "r@x.com", "basic_org": "OrgR",
         "submitted_at": "2026-06-02T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/applications?exclude_status=rejected")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [a["id"] for a in body["applications"]] == ["a-ev"]
    assert body["total"] == 1


def test_pipeline_status_rejected_returns_only_rejected(client, monkeypatch, _clear_overrides):
    """?status=rejected returns only rejected rows (the Rejected tab's fetch)."""
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": "a-ev", "status": "evaluated", "display_seq": 26001,
         "basic_full_name": "Ev", "basic_email": "e@x.com", "basic_org": "OrgE",
         "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": "a-rej", "status": "rejected", "display_seq": 26002,
         "basic_full_name": "Rej", "basic_email": "r@x.com", "basic_org": "OrgR",
         "submitted_at": "2026-06-02T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/applications?status=rejected")
    assert r.status_code == 200, r.text
    assert [a["id"] for a in r.json()["applications"]] == ["a-rej"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_admin_platform.py::test_pipeline_exclude_status_drops_rejected -x -q --no-cov`
Expected: FAIL — `exclude_status` is ignored, so both `a-ev` and `a-rej` are returned (`total == 2`).

- [ ] **Step 3: Add the endpoint param** — in `backend/app/routers/admin_platform.py`, `list_pipeline`: add a param to the signature immediately after the `status:` param:

```python
    status: str | None = None,
    exclude_status: str | None = None,
```

and add the matching key to the `fetch_pipeline({...})` dict, immediately after the `"status": status,` line:

```python
        "status":           status,
        "exclude_status":    exclude_status,
```

- [ ] **Step 4: Honor it in `fetch_pipeline`** — in `backend/app/services/admin_query.py`, add the filter read next to the other post-fetch filters (near `include_hidden = bool(filters.get("include_hidden"))`, ~L310):

```python
    exclude_status = filters.get("exclude_status")
```

Then inside the `for r in rows:` loop, immediately after the hidden/archived `continue` checks (after the `if is_archived and not include_archived: continue` line), add:

```python
        if exclude_status and r.get("status") == exclude_status:
            continue
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_admin_platform.py -q --no-cov`
Expected: PASS (both new tests + the whole file green).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/admin_platform.py backend/app/services/admin_query.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): add exclude_status filter to the pipeline list"
```

---

### Task 2: Frontend — parametrize `AdminPipeline` (baseFilter / readOnly / heading)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`
- Test: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.readonly.test.jsx` (create)

- [ ] **Step 1: Write the failing test** — create `frontend/src/pages/admin/platform/__tests__/AdminPipeline.readonly.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// One rejected row; useAdminData is mocked so no network is hit.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind) => {
    if (kind === "pipeline") {
      return {
        data: { startups: [{
          id: "a1", applicationId: "TIR-1", name: "Proj A", founder: "F. Ounder",
          industry: "AI", stage: "Idea", ai_score_overall: 7, reviewer_score: null,
          status: "rejected", batch: "Batch A", flags: [], submitted_at: "2026-06-01",
        }], total: 1 },
        loading: false, error: null, reload: vi.fn(),
      };
    }
    if (kind === "batches") return { data: { batches: [] }, loading: false, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  },
}));

import { AdminPipeline } from "../screens/AdminPipeline";

describe("AdminPipeline read-only (Rejected tab)", () => {
  it("hides selection checkboxes + bulk Reject and shows the batch as text", () => {
    render(<AdminPipeline goDetail={() => {}} readOnly baseFilter={{ status: "rejected" }} heading="Rejected applications" />);
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(screen.queryByRole("button", { name: /^reject$/i })).toBeNull();
    // batch rendered as static text, not a <select>
    expect(screen.getByText("Batch A")).toBeTruthy();
    expect(document.querySelector("select")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.readonly.test.jsx`
Expected: FAIL — `AdminPipeline` ignores `readOnly`, so checkboxes and the batch `<select>` still render.

- [ ] **Step 3: Add the props** — in `AdminPipeline.jsx` change the signature (L117) and the data hook (L118):

```jsx
export function AdminPipeline({ goDetail, decisionMode, baseFilter = {}, readOnly = false, heading }) {
  const { data, loading, error, reload } = useAdminData("pipeline", baseFilter);
```

- [ ] **Step 4: Make the heading configurable** — replace the title line (L794):

```jsx
          <div className="dash-card-title" style={{ fontFamily: 'var(--font-serif)' }}>{heading || <>All <em>applications</em></>}</div>
```

- [ ] **Step 5: Gate the select-all checkbox header** — wrap the `<th style={{ width: 40 }}>…</th>` block (L985-991) so it only renders when not read-only:

```jsx
            {!readOnly && (
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.length === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                />
              </th>
            )}
```

- [ ] **Step 6: Gate the per-row checkbox cell** — wrap the per-row `<td>…checkbox…</td>` block (L1013-1019):

```jsx
                {!readOnly && (
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(s.id)}
                      onChange={() => toggleSelect(s.id)}
                    />
                  </td>
                )}
```

- [ ] **Step 7: Render batch as static text when read-only** — in the batch cell, replace the non-jury `<select>` branch (L1079-1092) so read-only shows the name:

```jsx
                  ) : readOnly ? (
                    <span className="os-text-sm">{s.batch || 'Unassigned'}</span>
                  ) : (
                    <select
                      className="os-select sm"
                      style={{ padding: '2px 6px', fontSize: 12, height: 26 }}
                      value={s.batch || 'Unassigned'}
                      onChange={e => changeIndividualBatch(s, e.target.value)}
                    >
                      <option value="Unassigned">Unassigned</option>
                      {getAvailableBatches().map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                      <option value="new">+ New Batch...</option>
                    </select>
                  )}
```

- [ ] **Step 8: Gate the floating bulk-action bar** — change its render condition (L1102):

```jsx
      {!readOnly && selectedIds.length > 0 && (
        <div className="os-floating-bar">
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.readonly.test.jsx`
Expected: PASS.

- [ ] **Step 10: Run the existing AdminPipeline tests (no regressions)**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx src/pages/admin/platform/__tests__/AdminPipeline.juryLabel.test.jsx`
Expected: PASS (default `baseFilter={}` / `readOnly=false` preserves current behavior).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminPipeline.jsx frontend/src/pages/admin/platform/__tests__/AdminPipeline.readonly.test.jsx
git commit -m "feat(admin): AdminPipeline supports baseFilter + readOnly + heading"
```

---

### Task 3: Frontend — badge helper + new tab in AdminPortal

**Files:**
- Create: `frontend/src/lib/adminBadges.js`
- Test: `frontend/src/lib/__tests__/adminBadges.test.js` (create)
- Modify: `frontend/src/pages/admin/platform/AdminPortal.jsx`

- [ ] **Step 1: Write the failing test** — create `frontend/src/lib/__tests__/adminBadges.test.js`:

```js
import { describe, it, expect } from "vitest";
import { pipelineBadges } from "../adminBadges";

describe("pipelineBadges", () => {
  it("subtracts rejected from the Applications badge and exposes the rejected count", () => {
    const stats = { totals: { apps_submitted: 595 }, statusCounts: [
      { id: "rejected", n: 20 }, { id: "evaluated", n: 5 },
    ]};
    expect(pipelineBadges(stats, false)).toEqual({ appsBadge: 575, rejectedBadge: 20 });
  });
  it("returns nulls while stats are loading", () => {
    expect(pipelineBadges(null, true)).toEqual({ appsBadge: null, rejectedBadge: null });
  });
  it("treats a missing rejected bucket as 0", () => {
    const stats = { totals: { apps_submitted: 10 }, statusCounts: [{ id: "evaluated", n: 3 }] };
    expect(pipelineBadges(stats, false)).toEqual({ appsBadge: 10, rejectedBadge: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminBadges.test.js`
Expected: FAIL — `adminBadges.js` does not exist.

- [ ] **Step 3: Create the helper** — `frontend/src/lib/adminBadges.js`:

```js
// Admin tab-badge counts derived from /stats. Rejected apps live in their own
// tab, so the Applications badge excludes them. statusCounts entries are
// { id, n }. Returns nulls while loading so no fabricated number is shown.
export function pipelineBadges(statsData, statsLoading) {
  if (statsLoading) return { appsBadge: null, rejectedBadge: null };
  const statusCounts = statsData?.statusCounts || [];
  const rejectedEntry = statusCounts.find(s => s.id === "rejected");
  const rejectedBadge = rejectedEntry ? (rejectedEntry.n ?? 0) : 0;
  const submitted = statsData?.totals?.apps_submitted;
  const appsBadge = submitted == null ? null : Math.max(0, submitted - rejectedBadge);
  return { appsBadge, rejectedBadge };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminBadges.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the helper into AdminPortal** — in `AdminPortal.jsx`, add the import near the other lib imports (mirror the existing `useAdminData` import depth):

```jsx
import { pipelineBadges } from "../../../lib/adminBadges";
```

Replace the badge line (L303) — keep the `evaluated`/`reviewBadge` lines as-is — with:

```jsx
  const { data: statsData, loading: statsLoading } = useAdminData('stats');
  const { appsBadge, rejectedBadge } = pipelineBadges(statsData, statsLoading);
```

- [ ] **Step 6: Add the tab entry** — in `AdminTabBar`, extend the destructure and the `tabs` array. Signature (L252):

```jsx
function AdminTabBar({ page, setPage, decisionMode, appsBadge, rejectedBadge, reviewBadge }) {
```

Insert a new entry immediately after the `pipeline` tab object (after its closing `},` at L264):

```jsx
    { id:'rejected',     label:'Rejected Applications', sub:'REJECTED BY ADMIN', badge: rejectedBadge == null ? null : String(rejectedBadge) },
```

- [ ] **Step 7: Pass the new badge + render the tab** — in `AdminApp`'s render, pass `rejectedBadge` to `AdminTabBar` (add to the props at L366-372):

```jsx
            <AdminTabBar
              page={page}
              setPage={setPage}
              decisionMode={decisionMode}
              appsBadge={appsBadge}
              rejectedBadge={rejectedBadge}
              reviewBadge={reviewBadge}
            />
```

Change the Applications render (L376) to exclude rejected, and add the Rejected render branch right after it:

```jsx
            {page === 'pipeline'    && <AdminPipeline goDetail={goDetail} decisionMode={decisionMode} baseFilter={{ exclude_status: 'rejected' }} />}
            {page === 'rejected'    && <AdminPipeline goDetail={goDetail} decisionMode={decisionMode} baseFilter={{ status: 'rejected' }} readOnly heading="Rejected applications" />}
```

- [ ] **Step 8: Write a render test for the 5th tab** — create `frontend/src/pages/admin/platform/__tests__/AdminPortal.rejectedTab.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind) => {
    if (kind === "stats") {
      return { data: { totals: { apps_submitted: 100 },
        statusCounts: [{ id: "rejected", n: 12 }, { id: "evaluated", n: 4 }] },
        loading: false, error: null, reload: vi.fn() };
    }
    return { data: { startups: [], total: 0, reviewers: [], batches: [] },
      loading: false, error: null, reload: vi.fn() };
  },
  loadDetail: vi.fn(),
}));

import AdminPortalDefault from "../AdminPortal";

describe("AdminPortal — Rejected Applications tab", () => {
  it("renders the 5th tab with the rejected count and a reduced Applications count", () => {
    render(<AdminPortalDefault />);
    expect(screen.getByText("Rejected Applications")).toBeTruthy();
    expect(screen.getByText("88")).toBeTruthy();  // apps badge = 100 - 12
    expect(screen.getByText("12")).toBeTruthy();  // rejected badge
  });
});
```

> Note: confirm `AdminPortal.jsx`'s default export name; the import above assumes `export default`. If it exports `AdminApp` differently, import the actual exported component. Adjust the mock's relative depth only if the test file location differs.

- [ ] **Step 9: Run the AdminPortal test**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPortal.rejectedTab.test.jsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/adminBadges.js frontend/src/lib/__tests__/adminBadges.test.js frontend/src/pages/admin/platform/AdminPortal.jsx frontend/src/pages/admin/platform/__tests__/AdminPortal.rejectedTab.test.jsx
git commit -m "feat(admin): Rejected Applications tab + badge split"
```

---

### Task 4 (optional polish): hide the empty `rejected` option from the Applications status filter

**Files:** Modify `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` (the Filters "Status" option list).

Since rejected rows are excluded server-side in the Applications tab, selecting `rejected` there yields an empty list. Optional refinement: when `!readOnly` (Applications view), omit the `rejected` option from the status-filter dropdown. Locate the status-filter option list in `AdminPipeline.jsx` (search for the STATUS filter options), and filter out the `rejected` entry when not `readOnly`.

- [ ] **Step 1:** Locate the status-filter options array in `AdminPipeline.jsx` (grep for the status filter select/options).
- [ ] **Step 2:** When rendering the Applications view (`!readOnly`), exclude the option whose value is `rejected`.
- [ ] **Step 3:** Manually verify the Applications Filters no longer lists "Rejected"; commit.

*Skip if the empty-filter state is acceptable — it is harmless.*

---

## Verification (whole feature)

- Backend: `cd backend && .venv/bin/python -m pytest tests/test_admin_platform.py -q --no-cov` → green.
- Frontend: `cd frontend && npx vitest run src/pages/admin/platform src/lib/__tests__/adminBadges.test.js` → green.
- Manual (after deploy): admin portal shows 5 tabs; Applications count excludes rejected; the Rejected tab lists only rejected apps, read-only (no checkboxes / bulk bar / batch dropdown), with working search / filter / sort / Export / click-into-detail.
