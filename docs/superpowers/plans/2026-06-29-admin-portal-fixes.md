# Admin Portal — Six Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land six admin-portal fixes — dashboard card cleanup, a Clear-filters button, a working Reviewer Score column, removing the AI-screening status filter, batch-column fan-out to reviewers (assignments + email), and human-readable Last-activity.

**Architecture:** Four changes are frontend-only (`pages/admin/platform/screens/*` + `lib/adminDataAdapter.js`). Two need backend work: the pipeline list (`services/admin_query.py`) gains a weight-adjusted reviewer score per app, and the assign-apps-to-batch endpoint (`routers/admin_platform.py`) additively fans out to the batch's current reviewers and emails them. No DB migration.

**Tech Stack:** Backend FastAPI + Supabase (pytest, fake-Supabase harness in `tests/test_admin_platform.py`); frontend React/Vite (vitest + @testing-library/react). Reuses `reviewer_query._weighted_overall` and `services/assignment_email.notify_reviewers_assigned`.

**Spec:** `docs/superpowers/specs/2026-06-29-admin-portal-fixes-design.md`

---

## Worktree

Execute in an **isolated worktree** branched off `release/sip-launch-v1` (the live prod branch) — required for SAM-deploy safety (`sam build` reads disk, not git HEAD). The spec + this plan are already committed on `release/sip-launch-v1`, so the branch inherits them.

```bash
cd /Users/apple/Desktop/Final_AP_os
git worktree add .claude/worktrees/feat-admin-portal-fixes -b feat/admin-portal-fixes release/sip-launch-v1
cd .claude/worktrees/feat-admin-portal-fixes
```

All file paths below are relative to that worktree root. **Commit messages must NOT add any Claude/AI co-author line** (per repo policy).

---

## File map

| File | Change |
|---|---|
| `frontend/src/pages/admin/platform/screens/AdminDashboard.jsx` | #1 remove subtitle + jury preview badge (reviewer mode) |
| `frontend/src/pages/admin/platform/__tests__/AdminDashboard.test.jsx` | #1 update the jury-badge test |
| `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` | #2 Clear-filters button · #4 drop AI-screening status · #5 success note |
| `frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js` | #2/#4/#5 tests |
| `frontend/src/pages/admin/platform/screens/AdminReviewers.jsx` | #6 `formatLastActivity` helper + apply |
| `frontend/src/pages/admin/platform/__tests__/AdminReviewers.lastActivity.test.jsx` | #6 unit test (new) |
| `frontend/src/lib/adminDataAdapter.js` | #3 map `reviewer_score` → `rev.overall` |
| `frontend/src/lib/__tests__/adminDataAdapter.test.js` | #3 reviewer-score tests (extend) |
| `backend/app/services/admin_query.py` | #3 `_fetch_reviewer_scores` + include in `fetch_pipeline` |
| `backend/app/routers/admin_platform.py` | #5 `assign_applications` additive fan-out |
| `backend/tests/test_admin_platform.py` | #3 + #5 tests (extend) |

---

## Task 1: #1 — Dashboard card cleanup (frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminDashboard.jsx` (`:218`, `:228-230`)
- Test: `frontend/src/pages/admin/platform/__tests__/AdminDashboard.test.jsx`

- [ ] **Step 1: Update the test (was asserting the badge is present)**

In `AdminDashboard.test.jsx`, **replace** the existing `it("renders JURY EVALUATION tile with PreviewBadge and 0 value", …)` block (lines ~71-80) with these two:

```jsx
  it("UNDER REVIEW tile shows no '% of submissions' subtitle (removed)", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    expect(screen.queryByText(/of submissions/i)).toBeNull();
  });

  it("JURY EVALUATION tile shows no Preview badge in reviewer mode (removed)", () => {
    useAdminData.mockReturnValue({ data: SAMPLE_STATS, loading: false, error: null });
    render(<AdminDashboard go={() => {}} decisionMode="reviewer" />);
    expect(screen.getAllByText(/JURY EVALUATION/i).length).toBeGreaterThan(0);
    // No "Preview — backend pending" badge anywhere in reviewer mode.
    expect(screen.queryByText(/Preview/i)).toBeNull();
  });
```

(Leave the `decisionMode=jury` test at the bottom unchanged — jury mode keeps its badge.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminDashboard.test.jsx`
Expected: FAIL — `queryByText(/Preview/i)` finds the badge / `queryByText(/of submissions/i)` finds the subtitle.

- [ ] **Step 3: Remove the UNDER REVIEW subtitle**

In `AdminDashboard.jsx`, delete this line (currently `:218`):

```jsx
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{totalSubmitted ? Math.round(inReview / totalSubmitted * 100) : 0}% of submissions</div>
```

- [ ] **Step 4: Remove the JURY EVALUATION preview badge (reviewer mode)**

In the reviewer-mode JURY EVALUATION card, delete this block (currently `:228-230`):

```jsx
            <div style={{ fontSize: 10, color: 'var(--ink-dim)', display: 'flex', alignItems: 'center' }}>
              <PreviewBadge />
            </div>
```

Leave the `PreviewBadge` import (still used by the jury-mode KPI grid at `:179`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminDashboard.test.jsx`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminDashboard.jsx \
        frontend/src/pages/admin/platform/__tests__/AdminDashboard.test.jsx
git commit -m "feat(admin-ui): remove under-review % subtitle and jury preview badge from dashboard"
```

---

## Task 2: #2 — "Clear filters" button on the Applications page (frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` (search/filter bar, around `:839`)
- Test: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js`

- [ ] **Step 1: Write the failing test**

In `AdminPipeline.test.js`, add to the top imports:

```js
import { fireEvent } from "@testing-library/react";
```

Then add inside `describe("AdminPipeline screen (smoke)", …)`:

```js
  it("shows a Clear filters button when a filter is active and clears it", () => {
    render(
      React.createElement(AdminPipeline, { goDetail: vi.fn(), decisionMode: "reviewer" }),
    );
    // No filters initially → no Clear-filters button.
    expect(screen.queryByText(/Clear filters/i)).toBeNull();
    // Activate the VIP track filter.
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    expect(screen.getByText(/Clear filters/i)).toBeTruthy();
    // Clicking it resets filters → the button disappears.
    fireEvent.click(screen.getByText(/Clear filters/i));
    expect(screen.queryByText(/Clear filters/i)).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js`
Expected: FAIL — no "Clear filters" element after activating a track filter.

- [ ] **Step 3: Add the button**

In `AdminPipeline.jsx`, in the `.lp-filter-row--search` block, insert the button **immediately after** the spacer `<div style={{ flex: 1 }} />` (currently `:839`) and before the `<button className={`lp-filters-toggle…`}>`:

```jsx
          {hasFilters && (
            <button
              type="button"
              className="lp-clear-btn"
              style={{ fontSize: 13 }}
              onClick={clearAll}
            >
              Clear filters
            </button>
          )}
```

(`hasFilters` `:217` and `clearAll` `:218` already exist and already cover search + track + status + industry + batch.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminPipeline.jsx \
        frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js
git commit -m "feat(admin-ui): add Clear filters button to Applications filter bar (leadership parity)"
```

---

## Task 3: #4 — Remove "AI screening" from the STATUS filter (frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` (`STATUSES` `:80-81`)
- Test: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js`

- [ ] **Step 1: Write the failing test**

Add inside the same `describe` block:

```js
  it("STATUS filter no longer offers an 'AI screening' option", () => {
    render(
      React.createElement(AdminPipeline, { goDetail: vi.fn(), decisionMode: "reviewer" }),
    );
    // Open the collapsible Filters panel.
    fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
    expect(screen.queryByText("AI screening")).toBeNull();
    // Sanity: a sibling status option is still present.
    expect(screen.getByText("Under review")).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js -t "AI screening"`
Expected: FAIL — the "AI screening" status button is still rendered.

- [ ] **Step 3: Remove the STATUSES entry**

In `AdminPipeline.jsx`, delete this line from the `STATUSES` array (currently `:81`):

```jsx
  { id: 'ai-screening', label: 'AI screening', color: '#3213b7' },
```

Leave `getStatusId`/`getFriendlyStatus`/the CSV inverse map untouched — they map real statuses and render nothing for this filter.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminPipeline.jsx \
        frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js
git commit -m "feat(admin-ui): drop AI screening option from Applications status filter"
```

---

## Task 4: #6 — Human-readable "Last activity" (frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminReviewers.jsx` (add exported helper; apply at `:577` and `:751`)
- Test (new): `frontend/src/pages/admin/platform/__tests__/AdminReviewers.lastActivity.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/platform/__tests__/AdminReviewers.lastActivity.test.jsx`:

```jsx
import { describe, expect, it } from "vitest";
import { formatLastActivity } from "../screens/AdminReviewers";

describe("formatLastActivity", () => {
  it("formats an ISO timestamp as absolute IST date + time", () => {
    // 2026-06-29T05:09:07Z == 10:39 IST (UTC+5:30)
    const out = formatLastActivity("2026-06-29T05:09:07.459686+00:00");
    expect(out).toMatch(/29 Jun 2026/);
    expect(out).toMatch(/10:39\s?AM/);
  });
  it("passes a non-ISO string through unchanged", () => {
    expect(formatLastActivity("2h ago")).toBe("2h ago");
  });
  it("returns an em dash for empty input", () => {
    expect(formatLastActivity("")).toBe("—");
    expect(formatLastActivity(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminReviewers.lastActivity.test.jsx`
Expected: FAIL — `formatLastActivity` is not exported / not defined.

- [ ] **Step 3: Add the helper**

In `AdminReviewers.jsx`, add this **module-level export** near the top (after the imports, before `MOCK_JURY`):

```jsx
// Render a reviewer's last-activity value: ISO timestamps → absolute IST
// date + time ("29 Jun 2026, 10:39 AM"); non-ISO strings (the jury mock's
// "2h ago") pass through; empty → an em dash.
export function formatLastActivity(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
  // en-GB yields "29 Jun 2026, 10:39 am" → uppercase the meridiem.
  return s.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}
```

- [ ] **Step 4: Apply the helper at both Last-activity cells**

Reviewer-mode cell (currently `:751`):

```jsx
                    {/* Last activity */}
                    <td className="os-mono os-text-sm os-text-soft">{formatLastActivity(r.last)}</td>
```

Jury-mode cell (currently `:577`):

```jsx
                <td className="os-mono os-text-sm os-text-soft">{formatLastActivity(r.last)}</td>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminReviewers.lastActivity.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminReviewers.jsx \
        frontend/src/pages/admin/platform/__tests__/AdminReviewers.lastActivity.test.jsx
git commit -m "feat(admin-ui): format reviewer roster Last activity as absolute IST date+time"
```

---

## Task 5: #3 — Backend reviewer score in the pipeline (pytest)

**Files:**
- Modify: `backend/app/services/admin_query.py` (new `_fetch_reviewer_scores` + use in `fetch_pipeline`)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_admin_platform.py`:

```python
def test_pipeline_includes_weight_adjusted_reviewer_score(client, monkeypatch, _clear_overrides):
    app_id = "22222222-2222-2222-2222-222222222222"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "under_review", "display_seq": 26014,
         "basic_full_name": "Bo", "submitted_at": "2026-06-02T00:00:00Z",
         "created_at": "2026-05-21T00:00:00Z"},
    ]

    def _review(rid, v):
        return {"application_id": app_id, "application_track": "tir",
                "reviewer_user_id": rid, "submitted_at": "2026-06-03T00:00:00Z",
                "score_problem": v, "score_solution": v, "score_tech": v,
                "score_founders": v, "score_commitment": v}

    # rev-a: all-6s → weighted_overall 6.0, weight 1.0
    # rev-b: all-10s → weighted_overall 10.0, weight 3.0
    # weight-adjusted mean = (1*6 + 3*10) / (1+3) = 9.0
    tables["reviews"] = [_review("rev-a", 6), _review("rev-b", 10)]
    tables["reviewer_profiles"] = [
        {"reviewer_user_id": "rev-a", "weight": 1.0},
        {"reviewer_user_id": "rev-b", "weight": 3.0},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    item = r.json()["applications"][0]
    assert item["reviewer_score"] == 9.0


def test_pipeline_reviewer_score_none_without_submitted_review(client, monkeypatch, _clear_overrides):
    app_id = "33333333-3333-3333-3333-333333333333"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "under_review", "display_seq": 26015,
         "submitted_at": "2026-06-02T00:00:00Z", "created_at": "2026-05-21T00:00:00Z"},
    ]
    # A draft review (no submitted_at) must NOT count.
    tables["reviews"] = [
        {"application_id": app_id, "application_track": "tir", "reviewer_user_id": "rev-a",
         "submitted_at": None, "score_problem": 8, "score_solution": 8, "score_tech": 8,
         "score_founders": 8, "score_commitment": 8},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    assert r.json()["applications"][0]["reviewer_score"] is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/test_admin_platform.py::test_pipeline_includes_weight_adjusted_reviewer_score tests/test_admin_platform.py::test_pipeline_reviewer_score_none_without_submitted_review -v --no-cov`
Expected: FAIL — `KeyError: 'reviewer_score'` (the key is not in the row yet).

- [ ] **Step 3: Add the `_fetch_reviewer_scores` helper**

In `backend/app/services/admin_query.py`, add this function (e.g. just before `def fetch_pipeline`). `reviewer_query`, `log`, and `get_admin_client` are already imported/defined in this module.

```python
def _fetch_reviewer_scores(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], float | None]:
    """Weight-adjusted mean of submitted reviewers' weighted-overall, per app.

    Keyed by ``(track, application_id)`` to match ``fetch_pipeline``'s row key.
    Weight = ``reviewer_profiles.weight`` (default ``1.0``). Reviews with any
    missing dimension (``_weighted_overall`` → None) and drafts (no
    ``submitted_at``) are skipped. Apps with no scorable review are omitted
    (callers default to None). Bounded by PostgREST's 1000-row default — fine
    at Phase-1 scale.
    """
    if not pairs:
        return {}
    sb = get_admin_client()
    want = set(pairs)  # {(track, id)}
    try:
        reviews = (sb.table("reviews").select("*").execute().data) or []
    except Exception as exc:
        log.warning("admin_query._fetch_reviewer_scores reviews failed",
                    extra={"err": str(exc)})
        return {}
    try:
        rp_rows = (sb.table("reviewer_profiles").select("*").execute().data) or []
    except Exception as exc:
        log.warning("admin_query._fetch_reviewer_scores profiles failed",
                    extra={"err": str(exc)})
        rp_rows = []

    weight_of: dict[str, float] = {}
    for rp in rp_rows:
        rid = rp.get("reviewer_user_id")
        if rid:
            w = rp.get("weight")
            weight_of[rid] = float(w) if w is not None else 1.0

    num: dict[tuple[str, str], float] = {}
    den: dict[tuple[str, str], float] = {}
    for r in reviews:
        if not r.get("submitted_at"):
            continue
        key = (r.get("application_track"), r.get("application_id"))
        if key not in want:
            continue
        wo = reviewer_query._weighted_overall(r)
        if wo is None:
            continue
        w = weight_of.get(r.get("reviewer_user_id"), 1.0)
        num[key] = num.get(key, 0.0) + w * wo
        den[key] = den.get(key, 0.0) + w

    return {key: round(num[key] / den[key], 1) for key in num if den.get(key)}
```

- [ ] **Step 4: Call it in `fetch_pipeline` and add the row field**

In `fetch_pipeline`, after `batches = _fetch_batches(pairs)` (currently `:220`), add:

```python
    reviewer_scores = _fetch_reviewer_scores(pairs)
```

Then in the `out_items.append({…})` row dict (currently `:275-290`), add this key (e.g. right after `"batch": (batch or {}).get("name"),`):

```python
            "reviewer_score":   reviewer_scores.get(key),
```

(`key = (r["track"], r["id"])` is already in scope at `:232`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/test_admin_platform.py::test_pipeline_includes_weight_adjusted_reviewer_score tests/test_admin_platform.py::test_pipeline_reviewer_score_none_without_submitted_review -v --no-cov`
Expected: PASS.

- [ ] **Step 6: Run the whole admin-platform test file (no regressions)**

Run: `cd backend && pytest tests/test_admin_platform.py -v --no-cov`
Expected: PASS (existing pipeline tests still green — they seed no reviews, so `reviewer_score` is `None`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/admin_query.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): pipeline rows carry weight-adjusted reviewer score"
```

---

## Task 6: #3 — Adapter maps reviewer_score → rev.overall (frontend)

**Files:**
- Modify: `frontend/src/lib/adminDataAdapter.js` (`adaptPipelineRow` `:28`)
- Test: `frontend/src/lib/__tests__/adminDataAdapter.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/__tests__/adminDataAdapter.test.js` (the file already imports from `../adminDataAdapter`; add an import for `adaptPipelineRow` if not already present):

```js
import { adaptPipelineRow } from "../adminDataAdapter";

describe("adaptPipelineRow reviewer score", () => {
  it("maps a numeric reviewer_score to rev.overall", () => {
    expect(adaptPipelineRow({ id: "a", reviewer_score: 7.4 }).rev).toEqual({ overall: 7.4 });
  });
  it("leaves rev undefined when reviewer_score is null or absent", () => {
    expect(adaptPipelineRow({ id: "a", reviewer_score: null }).rev).toBeUndefined();
    expect(adaptPipelineRow({ id: "a" }).rev).toBeUndefined();
  });
  it("treats a 0 score as a real score, not missing", () => {
    expect(adaptPipelineRow({ id: "a", reviewer_score: 0 }).rev).toEqual({ overall: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminDataAdapter.test.js -t "reviewer score"`
Expected: FAIL — `rev` is always `undefined` (hard-coded).

- [ ] **Step 3: Update `adaptPipelineRow`**

In `frontend/src/lib/adminDataAdapter.js`, replace the line `rev: undefined,` (`:28`) with:

```js
    rev: row.reviewer_score != null ? { overall: row.reviewer_score } : undefined,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminDataAdapter.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/adminDataAdapter.js frontend/src/lib/__tests__/adminDataAdapter.test.js
git commit -m "feat(admin-ui): populate pipeline Reviewer Score column from reviewer_score"
```

---

## Task 7: #5 — Batch assign fans out to the batch's reviewers + emails (backend)

**Files:**
- Modify: `backend/app/routers/admin_platform.py` (`assign_applications`, `:336-375`)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_admin_platform.py`:

```python
def test_assign_applications_fans_out_to_batch_reviewers(client, monkeypatch, _clear_overrides):
    existing_app = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    new_app = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    tables = _empty_admin_tables()
    tables["batches"] = [{"id": "b1", "name": "Batch A"}]
    tables["application_batches"] = [
        {"application_id": existing_app, "application_track": "tir", "batch_id": "b1"},
    ]
    tables["reviewer_assignments"] = [
        {"application_id": existing_app, "application_track": "tir",
         "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
    ]
    fake = _install_db(monkeypatch, tables)
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    notified = {}
    monkeypatch.setattr(
        "app.routers.admin_platform.notify_reviewers_assigned",
        lambda sb, rows: notified.update({"rows": rows}),
    )
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.post("/admin/platform/batches/b1/applications",
                    json={"items": [{"track": "tir", "application_id": new_app}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assigned"] == 1
    assert body["assignments_created"] == 1
    assert body["reviewers_notified"] == 1
    ra_inserts = [row for (t, row) in fake.inserts if t == "reviewer_assignments"]
    assert any(row["application_id"] == new_app and row["reviewer_user_id"] == "rev-1"
               for row in ra_inserts)
    assert notified.get("rows") and notified["rows"][0]["application_id"] == new_app


def test_assign_applications_skips_existing_assignment(client, monkeypatch, _clear_overrides):
    existing_app = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    new_app = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    tables = _empty_admin_tables()
    tables["batches"] = [{"id": "b1", "name": "Batch A"}]
    tables["application_batches"] = [
        {"application_id": existing_app, "application_track": "tir", "batch_id": "b1"},
    ]
    tables["reviewer_assignments"] = [
        {"application_id": existing_app, "application_track": "tir",
         "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
        # rev-1 already assigned to the new app → must NOT be re-created.
        {"application_id": new_app, "application_track": "tir",
         "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
    ]
    _install_db(monkeypatch, tables)
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    monkeypatch.setattr("app.routers.admin_platform.notify_reviewers_assigned", lambda sb, rows: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.post("/admin/platform/batches/b1/applications",
                    json={"items": [{"track": "tir", "application_id": new_app}]})
    assert r.status_code == 200, r.text
    assert r.json()["assignments_created"] == 0


def test_assign_applications_no_reviewers_no_fanout(client, monkeypatch, _clear_overrides):
    new_app = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    tables = _empty_admin_tables()
    tables["batches"] = [{"id": "b1", "name": "Batch A"}]
    fake = _install_db(monkeypatch, tables)
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    monkeypatch.setattr("app.routers.admin_platform.notify_reviewers_assigned", lambda sb, rows: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.post("/admin/platform/batches/b1/applications",
                    json={"items": [{"track": "tir", "application_id": new_app}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assigned"] == 1
    assert body["assignments_created"] == 0
    assert body["reviewers_notified"] == 0
    assert not any(t == "reviewer_assignments" for (t, _row) in fake.inserts)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && pytest tests/test_admin_platform.py::test_assign_applications_fans_out_to_batch_reviewers tests/test_admin_platform.py::test_assign_applications_skips_existing_assignment tests/test_admin_platform.py::test_assign_applications_no_reviewers_no_fanout -v --no-cov`
Expected: FAIL — `KeyError: 'assignments_created'` (response has only `{"assigned": n}`; no fan-out yet).

- [ ] **Step 3: Replace `assign_applications` with the fan-out version**

In `backend/app/routers/admin_platform.py`, replace the whole `assign_applications` function body (`:340-375`) with:

```python
async def assign_applications(
    batch_id: str,
    body: BatchAssign,
    user: dict = Depends(get_current_user),
) -> dict:
    """Bulk-assign applications to a batch (upsert moves an app between batches).

    Additively fans out to the batch's CURRENT reviewers: every reviewer with an
    active assignment on an app already in the batch gets a new reviewer_assignment
    for each newly-added app (skipping existing triples) and is emailed. Moving an
    app between batches does NOT strip the previous batch's assignments.
    """
    sb = get_admin_client()
    existing = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )
    now = datetime.now(UTC).isoformat()
    new_apps = [(item.application_id, item.track) for item in body.items]
    sb.table("application_batches").upsert(
        [
            {
                "application_id": aid,
                "application_track": track,
                "batch_id": batch_id,
                "added_at": now,
            }
            for (aid, track) in new_apps
        ],
        on_conflict="application_id,application_track",
    ).execute()
    n = len(body.items)

    # ── Additive fan-out to the batch's current reviewers ──────────────────
    # Apps now in the batch (re-filter on batch_id in Python; the fake backend
    # no-ops .eq() for non-PK selects, mirroring production bulk reads).
    link_rows = (
        sb.table("application_batches")
        .select("application_id,application_track,batch_id")
        .eq("batch_id", batch_id)
        .execute()
        .data
    ) or []
    batch_app_keys = {
        (r["application_id"], r["application_track"])
        for r in link_rows
        if r.get("batch_id") == batch_id and r.get("application_id") and r.get("application_track")
    }
    # Batch reviewers = distinct ACTIVE assignees on apps already in the batch.
    all_assignments = (sb.table("reviewer_assignments").select("*").execute().data) or []
    existing_triples: set[tuple[str, str, str]] = set()
    reviewer_ids: list[str] = []
    seen_rev: set[str] = set()
    for a in all_assignments:
        rid = a.get("reviewer_user_id")
        existing_triples.add((a.get("application_id"), a.get("application_track"), rid))
        key = (a.get("application_id"), a.get("application_track"))
        if (
            key in batch_app_keys
            and rid
            and a.get("declined_at") is None
            and a.get("reassigned_to") is None
            and rid not in seen_rev
        ):
            seen_rev.add(rid)
            reviewer_ids.append(rid)

    fan_rows = [
        {
            "application_id": aid,
            "application_track": track,
            "reviewer_user_id": rid,
            "assigned_by": user["user_id"],
            "assigned_at": now,
            "state": "pending",
            "due_at": None,
        }
        for (aid, track) in new_apps
        for rid in reviewer_ids
        if (aid, track, rid) not in existing_triples
    ]
    assignments_created = len(fan_rows)
    reviewers_notified = len({r["reviewer_user_id"] for r in fan_rows})
    if fan_rows:
        sb.table("reviewer_assignments").insert(fan_rows).execute()
        notify_reviewers_assigned(sb, fan_rows)

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_applications_assigned",
        target_table="application_batches",
        target_id=batch_id,
        after={
            "count": n,
            "assignments_created": assignments_created,
            "reviewers_notified": reviewers_notified,
        },
    )
    return {
        "assigned": n,
        "assignments_created": assignments_created,
        "reviewers_notified": reviewers_notified,
    }
```

(`notify_reviewers_assigned` is imported at `:36`; `write_audit`, `actor_role_of`, `datetime`, `UTC`, `http_status`, `HTTPException`, `BatchAssign` are all already imported in this module.)

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd backend && pytest tests/test_admin_platform.py::test_assign_applications_fans_out_to_batch_reviewers tests/test_admin_platform.py::test_assign_applications_skips_existing_assignment tests/test_admin_platform.py::test_assign_applications_no_reviewers_no_fanout -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Run the whole file (existing `test_batch_assign_applications` still green)**

Run: `cd backend && pytest tests/test_admin_platform.py -v --no-cov`
Expected: PASS — the existing assign-apps test seeds no `reviewer_assignments`, so fan-out is a no-op there and it still asserts only the 2 `application_batches` inserts + status 200.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/admin_platform.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): assigning an app to a batch fans out to the batch's reviewers + emails them"
```

---

## Task 8: #5 — Batch-assign success note (frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` (`changeIndividualBatch` `:438-464`, `applyBatchToSelected` `:429`)
- Test: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js`

- [ ] **Step 1: Write the failing test**

In `AdminPipeline.test.js`, update the `adminPlatformApi` mock so `assignBatch` resolves with a notified count:

```js
    assignBatch: vi.fn().mockResolvedValue({ assigned: 1, assignments_created: 2, reviewers_notified: 2 }),
```

Then add a test (the mock pipeline row has `batch: "Batch A"`; we switch it via the per-row select). Note the mock `batches` kind returns only `Batch A`, so add a second batch by extending the `batches` branch of the `useAdminData` mock to:

```js
      data: { batches: [{ id: "b1", name: "Batch A", phase: "" }, { id: "b2", name: "Batch B", phase: "" }] },
```

Test:

```js
  it("shows a 'reviewers notified' note after a per-row batch assign", async () => {
    render(
      React.createElement(AdminPipeline, { goDetail: vi.fn(), decisionMode: "reviewer" }),
    );
    // The per-row batch <select> currently shows "Batch A".
    const select = screen.getByDisplayValue("Batch A");
    fireEvent.change(select, { target: { value: "Batch B" } });
    expect(await screen.findByText(/reviewer\(s\) notified/i)).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js -t "notified"`
Expected: FAIL — `changeIndividualBatch` sets no success note today.

- [ ] **Step 3: Add the note in `changeIndividualBatch`**

Replace `changeIndividualBatch` (`:438-464`) with:

```jsx
  const changeIndividualBatch = async (startup, val) => {
    if (val === 'new') {
      const custom = window.prompt('Enter new batch name:');
      if (!custom) return;
      try {
        const created = await adminPlatformApi.createBatch({ name: custom });
        const resp = await adminPlatformApi.assignBatch(created.id, {
          items: [{ track: startup.track, application_id: startup.id }],
        });
        await reloadBatches();
        await reload();
        setNote({ kind: 'ok', text: `Assigned to ${custom} · ${resp?.reviewers_notified ?? 0} reviewer(s) notified.` });
      } catch (e) {
        setNote({ kind: 'error', text: `Batch create failed: ${e?.message || e}` });
      }
    } else {
      const found = batches.find(b => b.name === val);
      if (!found) return;
      try {
        const resp = await adminPlatformApi.assignBatch(found.id, {
          items: [{ track: startup.track, application_id: startup.id }],
        });
        await reload();
        setNote({ kind: 'ok', text: `Assigned to ${val} · ${resp?.reviewers_notified ?? 0} reviewer(s) notified.` });
      } catch (e) {
        setNote({ kind: 'error', text: `Batch assign failed: ${e?.message || e}` });
      }
    }
  };
```

- [ ] **Step 4: Include the notified count in the bulk note**

In `applyBatchToSelected`, replace the success block (currently `:426-429`):

```jsx
    try {
      const resp = await adminPlatformApi.assignBatch(targetBatchId, {
        items: selectedRows.map((r) => ({ track: r.track, application_id: r.id })),
      });
      await finishBulk({ kind: 'ok', text: `Assigned ${selectedRows.length} to ${targetBatchName}. ${resp?.reviewers_notified ?? 0} reviewer(s) notified.` });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js`
Expected: PASS (whole file).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminPipeline.jsx \
        frontend/src/pages/admin/platform/__tests__/AdminPipeline.test.js
git commit -m "feat(admin-ui): show reviewers-notified note after batch column assign"
```

---

## Task 9: Full-suite verification + build

- [ ] **Step 1: Backend admin suite**

Run: `cd backend && pytest tests/test_admin_platform.py -v --no-cov`
Expected: PASS.

- [ ] **Step 2: Frontend admin-platform + lib tests**

Run: `cd frontend && npx vitest run src/pages/admin/platform src/lib/__tests__/adminDataAdapter.test.js`
Expected: PASS.

- [ ] **Step 3: Frontend production build**

Run: `cd frontend && npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Manual smoke (after deploy — see Deploy)**

Assign an app to a batch from the Applications column → confirm: the batch column reflects it; the reviewer roster's "X of Batch A" + progress increase; the app appears in that reviewer's `/reviewer/queue`; the reviewer receives the assignment email. Confirm the dashboard cards, Clear-filters button, missing AI-screening status option, populated Reviewer Score column, and formatted Last-activity all render.

---

## Deploy

- **Frontend-only changes (Tasks 1, 2, 3, 4, 6, 8)** ship on the frontend deploy.
- **Backend changes (Tasks 5, 7)** require a SAM deploy.

Steps (from this worktree):
1. **Verify intake stays closed:** `grep -E 'TIR_SUBMISSIONS_CLOSED|SIP_SUBMISSIONS_CLOSED' infra/sam/.env.prod` → both must be `true`. Do not deploy if either is unset/false.
2. Backend: `bash infra/sam/deploy-prod.sh` (stack `artpark-eir-api-production`). Smoke `GET /health` after.
3. Push: `git push origin feat/admin-portal-fixes:release/sip-launch-v1` (or merge `feat/admin-portal-fixes` into `release/sip-launch-v1` and push), so the frontend builds from the same commit.
4. User: Vercel **Promote to Production** on the Ready build.

Backend must deploy before/with the frontend (Reviewer Score + batch fan-out depend on the backend changes).

---

## Self-review notes

- **Spec coverage:** #1 → Task 1; #2 → Task 2; #4 → Task 3; #6 → Task 4; #3 → Tasks 5 (backend) + 6 (adapter); #5 → Tasks 7 (backend) + 8 (frontend note). All six covered.
- **Type/shape consistency:** backend row key `(track, id)` matches `_fetch_reviewer_scores`'s `(application_track, application_id)`; `_weighted_overall` returns a 0–10 value (`round(total/100, 2)`); adapter reads `row.reviewer_score`; endpoint returns `{assigned, assignments_created, reviewers_notified}` consumed by the frontend note as `resp.reviewers_notified`.
- **No placeholders:** every code/test step contains complete code and exact run commands.
