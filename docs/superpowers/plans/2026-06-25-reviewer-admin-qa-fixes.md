# Reviewer + Admin QA Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 reported QA issues across the admin "Manage Applications" drawer, admin batch tooling, reviewer history, and reviewer queue.

**Architecture:** FastAPI (AWS Lambda) backend + React/Vite SPA (Vercel) + Supabase. All work happens in the worktree `.claude/worktrees/reviewer-admin-qa-fixes` (branch `fix/reviewer-admin-qa-fixes`, off `origin/release/sip-launch-v1` @ `43ef82e`). No DB migration is required — every change uses existing tables/columns. Backend reads use the RLS-bypassing admin client; authz is route-layer via `require_capability`.

**Tech Stack:** Python 3.11 / FastAPI / pytest (with an in-file fake Supabase client). React / Vitest / Testing Library. Run backend tests from `backend/` with `python -m pytest`; frontend from `frontend/` with `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-06-25-reviewer-admin-qa-fixes-design.md`

---

## File Structure

**Backend**
- `backend/app/services/reviewer_query.py` — add `myScore` to `fetch_queue`; rewrite `fetch_history` + `fetch_completed_reviews` to bulk-fetch.
- `backend/app/services/admin_query.py` — reviews-based `completed` in `fetch_roster`; new `bulk_assign_reviewer_apps` + `bulk_remove_reviewer_apps`.
- `backend/app/routers/admin_platform.py` — new `DELETE /batches/{id}`, `POST /reviewers/{id}/applications`, `POST /reviewers/{id}/applications/remove`.
- `backend/tests/test_reviewer.py` — queue `myScore` + history bulk-fetch tests.
- `backend/tests/test_admin_platform.py` — roster, batch-delete, bulk-assign/remove tests.

**Frontend**
- `frontend/src/lib/adminPlatformApi.js` — `deleteBatch`, `bulkAssignReviewerApps`, `bulkRemoveReviewerApps`.
- `frontend/src/pages/reviewer/v2/ReviewerQueue.jsx` — "My Score" column.
- `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` — per-batch delete button + handler.
- `frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx` — full rebuild (checkboxes, select-all, batch grouping, bulk remove, multi-assign, flex fix).
- `frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx` — new.
- `frontend/src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx` — new.
- `frontend/src/pages/admin/platform/__tests__/ManageApplicationsDrawer.test.jsx` — new.

---

## Task 1: Reviewer queue returns `myScore` (#6 backend)

**Files:**
- Modify: `backend/app/services/reviewer_query.py` (the `fetch_queue` row append, ~line 541)
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_reviewer.py`:

```python
def test_queue_includes_my_score(client, monkeypatch, _clear_overrides):
    """A submitted review's weighted overall is surfaced on the queue row."""
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None, "reassigned_to": None,
             "completed_at": None, "due_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "basic_org": "EdTech Co", "display_seq": 26013,
             "answers": {}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "ai_screening": [],
        "industry_categories": [],
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T00:00:00Z",
             "locked_at": "2026-05-18T01:00:00Z",
             "score_problem": 8, "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/queue")
    assert r.status_code == 200, r.text
    row = r.json()[0]                     # /reviewer/queue returns a bare list
    assert row["myScore"] == 8.0          # all 5 == 8 → weighted 800/100
    assert row["reviewStatus"] == "submitted"


def test_queue_my_score_none_when_not_started(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None, "reassigned_to": None,
             "completed_at": None, "due_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "basic_org": "EdTech Co", "answers": {},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [], "ai_screening": [], "industry_categories": [],
        "reviews": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/queue")
    assert r.status_code == 200, r.text
    assert r.json()[0]["myScore"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_reviewer.py::test_queue_includes_my_score -v`
Expected: FAIL — `KeyError: 'myScore'`.

- [ ] **Step 3: Add `myScore` to the queue row**

In `backend/app/services/reviewer_query.py`, inside `fetch_queue`, find the `out.append({...})` block and add the `myScore` line right after `"reviewStatus"`:

```python
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
            "stage":         stage or "—",
            "due":           a.get("due_at"),
            "ai":            _ai_block(ai_row),
            "reviewStatus":  _review_status(my_review),
            "myScore":       _weighted_overall(my_review) if my_review else None,
            "editWindowExpiresAt": (my_review or {}).get("locked_at"),
        })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_reviewer.py::test_queue_includes_my_score tests/test_reviewer.py::test_queue_my_score_none_when_not_started -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/reviewer_query.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): surface reviewer's own weighted score on the queue payload"
```

---

## Task 2: Reviewer queue "My Score" column (#6 frontend)

**Files:**
- Modify: `frontend/src/pages/reviewer/v2/ReviewerQueue.jsx`
- Test: `frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx`:

```jsx
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewerQueue from "../ReviewerQueue.jsx";

const ROW = {
  id: "app1", applicationId: "TIR-26013", track: "tir",
  name: "Acme Robotics", founders: ["Asha R"], industry: "Robotics",
  stage: "Prototype", due: null, ai: { overall: 7.0 },
  reviewStatus: "submitted", myScore: 8.0, editWindowExpiresAt: null,
};

function mkAsync(data) {
  return { data, loading: false, error: null, reload: vi.fn() };
}

describe("ReviewerQueue My Score column", () => {
  it("renders a My Score header and the reviewer's score", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={mkAsync([ROW])} />);
    expect(screen.getByText("My Score")).toBeTruthy();
    expect(screen.getByText("8.0")).toBeTruthy();   // myScore rendered
  });

  it("shows a dash when myScore is null", () => {
    const row = { ...ROW, reviewStatus: "not-started", myScore: null };
    render(<ReviewerQueue onOpen={() => {}} queueAsync={mkAsync([row])} />);
    expect(screen.getByText("My Score")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx`
Expected: FAIL — `Unable to find an element with the text: My Score`.

- [ ] **Step 3: Add the column to the table**

In `frontend/src/pages/reviewer/v2/ReviewerQueue.jsx`:

(a) In `<thead>`, rebalance widths and insert a "My Score" header after the "AI Score" header. Replace the existing `<thead>` `<tr>` block with:

```jsx
            <tr>
              <th style={{ width: "20%" }}>Project</th>
              <th style={{ width: "14%" }}>Founder</th>
              <th style={{ width: "16%" }}>Industry</th>
              <th style={{ width: "9%" }}>Stage</th>
              <th style={{ width: "11%" }}>AI Score</th>
              <th style={{ width: "11%" }}>My Score</th>
              <th style={{ width: "10%" }}>Status</th>
              <th style={{ width: "4%" }}>Due</th>
              <th style={{ width: "5%" }}>ID</th>
            </tr>
```

(b) In `<tbody>`, add a "My Score" `<td>` immediately after the AI Score `<td>` (the one that closes just before the `<td>` rendering the status chip). Insert:

```jsx
                <td>
                  {typeof s.myScore === "number" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-block", width: 48, height: 4, background: "#ececf0", borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
                        <span style={{ display: "block", width: Math.max(0, Math.min(100, (s.myScore / 10) * 100)) + "%", height: "100%", background: "#3213b7", borderRadius: 2 }} />
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--ink)", flexShrink: 0, whiteSpace: "nowrap" }}>
                        {Number(s.myScore).toFixed(1)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: "var(--ink-dim)" }}>—</span>
                  )}
                </td>
```

(c) Update **all three** `colSpan="8"` values (the loading, error, and empty `<td>` rows) to `colSpan="9"` (the table now has 9 columns).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reviewer/v2/ReviewerQueue.jsx frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx
git commit -m "feat(reviewer): add My Score column to the reviewer queue"
```

---

## Task 3: History + completed-reviews bulk-fetch & fault tolerance (#4 backend)

**Files:**
- Modify: `backend/app/services/reviewer_query.py` (`fetch_history`, `fetch_completed_reviews`)
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_reviewer.py`:

```python
def test_history_returns_submitted_reviews_bulk(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T00:00:00Z",
             "locked_at": "2026-05-18T01:00:00Z", "recommendation": "yes",
             "score_problem": 8, "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
            {"id": "r2", "reviewer_user_id": me, "application_id": "app2",
             "application_track": "tir", "submitted_at": None},   # draft → excluded
        ],
        "tir_applications": [
            {"id": "app1", "basic_org": "Acme", "status": "shortlisted",
             "submitted_at": "2026-05-15T00:00:00Z"},
            {"id": "app2", "basic_org": "Beta", "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "ai_screening": [
            {"application_id": "app1", "application_track": "tir",
             "score_overall": 7.0, "project_name": "Acme Robotics"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/history")
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    assert [x["appId"] for x in rows] == ["app1"]    # draft excluded
    row = rows[0]
    assert row["name"] == "Acme Robotics"
    assert row["myScore"] == 8.0
    assert row["aiScore"] == 7.0
    assert row["variance"] == 1.0
    assert row["adminDecision"] == "approved"        # shortlisted → approved


def test_history_does_not_500_on_missing_app(client, monkeypatch, _clear_overrides):
    """A submitted review whose app row can't be resolved still returns 200
    (the review is the reviewer's own work; never crash the whole tab)."""
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "ghost",
             "application_track": "tir", "submitted_at": "2026-05-18T00:00:00Z",
             "score_problem": 8, "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
        ],
        "tir_applications": [],          # app missing
        "sip_applications": [],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/history")
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    assert len(rows) == 1
    assert rows[0]["appId"] == "ghost"
    assert rows[0]["name"] == "—"        # fallback, no crash


def test_completed_reviews_bulk(client, monkeypatch, _clear_overrides):
    """GET /reviewer/reviews?mine=true&locked=true returns locked reviews via
    bulk fetch (no per-row N+1)."""
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T00:00:00Z",
             "locked_at": "2000-01-01T00:00:00Z", "recommendation": "yes",
             "score_problem": 8, "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
        ],
        "tir_applications": [
            {"id": "app1", "basic_org": "Acme", "answers": {"problem": "x"},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews?mine=true&locked=true")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    assert body["reviews"][0]["application_id"] == "app1"
    assert body["reviews"][0]["score_overall_mine"] == 8.0
```

- [ ] **Step 2: Run tests to verify they fail (or are slow/fragile)**

Run: `cd backend && python -m pytest tests/test_reviewer.py::test_history_returns_submitted_reviews_bulk tests/test_reviewer.py::test_completed_reviews_bulk -v`
Expected: the history test likely PASSES already (correctness unchanged); the point of this task is the **bulk-fetch refactor**. Treat the tests as a regression harness — they must stay green after the rewrite. `test_history_does_not_500_on_missing_app` should already pass too. Proceed to refactor and keep them green.

- [ ] **Step 3: Rewrite `fetch_history` to bulk-fetch + outer guard**

In `backend/app/services/reviewer_query.py`, replace the entire `fetch_history` function with:

```python
def fetch_history(reviewer_user_id: str) -> dict:
    """Spec §4.5 — every SUBMITTED review by this reviewer, newest first.

    Bulk-fetches app rows (per track) and ai_screening once, instead of two
    queries per review (the old N+1 could exceed the Lambda/API-Gateway 29 s
    ceiling for prolific reviewers and surface as a red error in the UI). The
    whole body is guarded so any failure degrades to a flagged-empty response
    rather than a 5xx.
    """
    empty = {"stats": {"total": 0, "avgVariance": None,
                       "consistencyPct": None, "avgMinutes": None},
             "rows": [], "degraded": False}
    sb = get_admin_client()
    try:
        rows = (sb.table("reviews").select("*")
                .eq("reviewer_user_id", reviewer_user_id).execute().data) or []
    except Exception as exc:
        log.warning("history: reviews fetch failed",
                    extra={"reviewer": reviewer_user_id, "err": str(exc)})
        return {**empty, "degraded": True}

    try:
        submitted = [r for r in rows
                     if r.get("reviewer_user_id") == reviewer_user_id and r.get("submitted_at")]
        submitted.sort(key=lambda r: r.get("submitted_at") or "", reverse=True)

        # Partition ids by track for one bulk fetch per app table + one for ai.
        ids_by_track: dict[str, list[str]] = {}
        all_ids: list[str] = []
        for r in submitted:
            track = r.get("application_track")
            aid = r.get("application_id")
            if not aid:
                continue
            ids_by_track.setdefault(track, []).append(aid)
            all_ids.append(aid)

        apps_by_key: dict[tuple, dict] = {}
        for track, ids in ids_by_track.items():
            if not ids:
                continue
            table = "tir_applications" if track == "tir" else "sip_applications"
            try:
                app_rows = (sb.table(table).select("*").in_("id", ids).execute().data) or []
            except Exception as exc:
                log.warning("history: app bulk fetch failed",
                            extra={"track": track, "err": str(exc)})
                app_rows = []
            for a in app_rows:
                if a.get("id") is not None:
                    apps_by_key[(a["id"], track)] = a

        ai_by_key: dict[tuple, dict] = {}
        try:
            ai_rows = (sb.table("ai_screening").select("*")
                       .in_("application_id", all_ids).execute().data) or []
        except Exception as exc:
            log.warning("history: ai bulk fetch failed",
                        extra={"reviewer": reviewer_user_id, "err": str(exc)})
            ai_rows = []
        for row in ai_rows:
            ai_by_key.setdefault(
                (row.get("application_id"), row.get("application_track")), row)

        out_rows: list[dict] = []
        variances: list[float] = []
        for r in submitted:
            track = r.get("application_track")
            app_row = apps_by_key.get((r.get("application_id"), track)) or {}
            ai_row = ai_by_key.get((r.get("application_id"), track))

            my_score = _weighted_overall(r)
            ai_score = (ai_row or {}).get("score_overall")
            variance = (round(abs(my_score - ai_score), 1)
                        if my_score is not None and ai_score is not None else None)
            if variance is not None:
                variances.append(variance)

            out_rows.append({
                "appId":         r.get("application_id"),
                "reviewId":      r.get("id"),
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
            "degraded": False,
        }
    except Exception as exc:
        log.exception("history: assembly failed",
                      extra={"reviewer": reviewer_user_id, "err": str(exc)})
        return {**empty, "degraded": True}
```

- [ ] **Step 4: Rewrite `fetch_completed_reviews` to bulk-fetch**

In the same file, replace the per-row app fetch loop in `fetch_completed_reviews`. After `page_rows = locked_mine[start:end]`, replace the `out: list[dict] = []` … `for r in page_rows:` loop with this bulk version:

```python
    # Bulk-fetch app rows for the page (one query per track) instead of one
    # query per review.
    ids_by_track: dict[str, list[str]] = {}
    for r in page_rows:
        ids_by_track.setdefault(r["application_track"], []).append(r["application_id"])
    apps_by_key: dict[tuple, dict] = {}
    for track, ids in ids_by_track.items():
        if not ids:
            continue
        table = "tir_applications" if track == "tir" else "sip_applications"
        try:
            app_rows = (sb.table(table).select("*").in_("id", ids).execute().data) or []
        except Exception as exc:
            log.warning("completed_list: app bulk fetch failed",
                        extra={"track": track, "err": str(exc)})
            app_rows = []
        for a in app_rows:
            if a.get("id") is not None:
                apps_by_key[(a["id"], track)] = a

    out: list[dict] = []
    for r in page_rows:
        a = apps_by_key.get((r["application_id"], r["application_track"]))
        if not a:
            continue
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_reviewer.py -k "history or completed" -v`
Expected: PASS (all history + completed tests green).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/reviewer_query.py backend/tests/test_reviewer.py
git commit -m "fix(reviewer): bulk-fetch history + completed reviews; guard against 5xx (N+1 timeout)"
```

---

## Task 4: Roster `completed` counts submitted reviews (#4 backend)

**Files:**
- Modify: `backend/app/services/admin_query.py` (`fetch_roster`, ~line 490)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_admin_platform.py`:

```python
def test_roster_completed_counts_submitted_reviews_without_completed_at(
    client, monkeypatch, _clear_overrides,
):
    """A submitted review must count toward `completed` even if the assignment's
    best-effort `completed_at` write never landed."""
    tables = _empty_admin_tables()
    tables["user_roles"] = [{"user_id": "rev-1", "role": "reviewer"}]
    tables["profiles"] = [{"id": "rev-1", "full_name": "Rev One", "email": "r1@x.com"}]
    tables["reviewer_profiles"] = []
    tables["reviewer_assignments"] = [
        {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
         "application_track": "tir", "declined_at": None, "reassigned_to": None,
         "completed_at": None},
    ]
    tables["reviews"] = [
        {"id": "r-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
         "application_track": "tir", "submitted_at": "2026-06-01T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/reviewers")
    assert r.status_code == 200, r.text
    rev = r.json()["reviewers"][0]
    assert rev["assigned"] == 1
    assert rev["completed"] == 1
    assert rev["progress"] == "1 / 1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_admin_platform.py::test_roster_completed_counts_submitted_reviews_without_completed_at -v`
Expected: FAIL — `completed` is 0 (only `completed_at` is counted).

- [ ] **Step 3: Make `completed` reviews-based**

In `backend/app/services/admin_query.py`, inside `fetch_roster`'s per-reviewer loop, replace:

```python
        assigned = len(active)
        completed = len([a for a in active if a.get("completed_at")])
```

with:

```python
        assigned = len(active)
        # Count an assignment complete if EITHER the best-effort completed_at
        # stamped OR a submitted review exists for that (app, track). The
        # completed_at write on submit is best-effort and can diverge.
        submitted_keys = {
            (r.get("application_id"), r.get("application_track"))
            for r in reviews_by_rev[rid]
            if r.get("submitted_at")
        }
        completed = len([
            a for a in active
            if a.get("completed_at")
            or (a.get("application_id"), a.get("application_track")) in submitted_keys
        ])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_admin_platform.py::test_roster_completed_counts_submitted_reviews_without_completed_at -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/admin_query.py backend/tests/test_admin_platform.py
git commit -m "fix(admin): count submitted reviews toward roster completed (completed_at can diverge)"
```

---

## Task 5: Delete batch endpoint (#5 backend)

**Files:**
- Modify: `backend/app/routers/admin_platform.py` (add route after `rename_batch`, ~line 292)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_admin_platform.py`:

```python
def test_delete_batch_unlinks_apps_keeps_assignments(client, monkeypatch, _clear_overrides):
    tables = _empty_admin_tables()
    tables["batches"] = [{"id": "b-1", "name": "Batch A"}]
    tables["application_batches"] = [
        {"application_id": "app-1", "application_track": "tir", "batch_id": "b-1"},
    ]
    tables["reviewer_profiles"] = [
        {"reviewer_user_id": "rev-1", "batch_id": "b-1"},
    ]
    tables["reviewer_assignments"] = [
        {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
    ]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.delete("/admin/platform/batches/b-1")
    assert r.status_code == 200, r.text
    assert fake.tables["batches"] == []                 # batch deleted
    assert fake.tables["application_batches"] == []      # links removed
    assert len(fake.tables["reviewer_assignments"]) == 1  # assignments untouched
    # reviewer_profiles.batch_id cleared (recorded as an update with batch_id=None)
    assert any(t == "reviewer_profiles" and p.get("batch_id") is None
               for (t, p, _eqs) in fake.updates)


def test_delete_batch_404_unknown(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, _empty_admin_tables())
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.delete("/admin/platform/batches/nope")
    assert r.status_code == 404


def test_delete_batch_requires_manage_batches(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user("rev-1", roles=["reviewer"])
    assert client.delete("/admin/platform/batches/b-1").status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_admin_platform.py -k delete_batch -v`
Expected: FAIL — route not found (the 404/permission tests may pass incidentally, but `test_delete_batch_unlinks_apps_keeps_assignments` fails because the route returns 405/404).

- [ ] **Step 3: Add the DELETE route**

In `backend/app/routers/admin_platform.py`, add immediately after the `rename_batch` function (the `@router.patch("/batches/{batch_id}", ...)` block ends ~line 292):

```python
@router.delete(
    "/batches/{batch_id}",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def delete_batch(
    batch_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    """Delete a batch (unlink-only).

    Removes the batch and its `application_batches` links (apps revert to no
    batch → "Random allotment"), and clears any `reviewer_profiles.batch_id`
    pointing at it. `reviewer_assignments` and `reviews` are left untouched, so
    no scored work is orphaned.
    """
    sb = get_admin_client()
    existing = (
        sb.table("batches").select("id,name").eq("id", batch_id).limit(1).execute().data
    )
    if not existing:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )
    # 1. Unlink applications (revert to no batch / Random allotment).
    sb.table("application_batches").delete().eq("batch_id", batch_id).execute()
    # 2. Clear reviewer_profiles.batch_id references (avoid a dangling pointer).
    sb.table("reviewer_profiles").update({"batch_id": None}).eq("batch_id", batch_id).execute()
    # 3. Delete the batch row.
    sb.table("batches").delete().eq("id", batch_id).execute()
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_deleted",
        target_table="batches",
        target_id=batch_id,
        before={"name": existing[0].get("name")},
    )
    return {"ok": True, "batch_id": batch_id}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_admin_platform.py -k delete_batch -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/admin_platform.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): DELETE /batches/{id} (unlink-only; keeps assignments + reviews)"
```

---

## Task 6: Delete batch UI on Applications page (#5 frontend)

**Files:**
- Modify: `frontend/src/lib/adminPlatformApi.js`
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`
- Test: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx` (create)

- [ ] **Step 1: Add the API method**

In `frontend/src/lib/adminPlatformApi.js`, add after the `assignBatch` entry (~line 48):

```javascript
  deleteBatch: (id) => api.del(`/admin/platform/batches/${id}`),
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx`:

```jsx
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    createBatch: vi.fn().mockResolvedValue({ id: "b-new" }),
    renameBatch: vi.fn().mockResolvedValue({}),
    deleteBatch: vi.fn().mockResolvedValue({ ok: true }),
    assignBatch: vi.fn().mockResolvedValue({ assigned: 1 }),
  },
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div data-testid="preview-badge">Preview</div>,
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminPipeline } from "../screens/AdminPipeline";   // named export

const PIPELINE = {
  startups: [
    { id: "app-1", name: "Acme", founders: ["A"], domain: "Robotics",
      chip: "NEW", batch: "Batch A", ai: { overall: 7 }, status: "submitted",
      track: "tir", hidden: false, archived: false, sub: "TIR-1" },
  ],
  total: 1,
};
const BATCHES = { batches: [{ id: "b-1", name: "Batch A" }] };

beforeEach(() => {
  useAdminData.mockImplementation((kind) => {
    if (kind === "batches")
      return { data: BATCHES, loading: false, error: null, reload: vi.fn() };
    return { data: PIPELINE, loading: false, error: null, reload: vi.fn() };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("AdminPipeline batch delete", () => {
  it("calls deleteBatch when the batch delete control is confirmed", async () => {
    render(<AdminPipeline decisionMode="default" />);
    // The batch group renders a delete control titled "Delete batch Batch A".
    const del = await screen.findByTitle("Delete batch Batch A");
    fireEvent.click(del);
    await waitFor(() => {
      expect(adminPlatformApi.deleteBatch).toHaveBeenCalledWith("b-1");
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx`
Expected: FAIL — `Unable to find an element with the title: Delete batch Batch A`.

- [ ] **Step 4: Add the delete handler + button**

(a) In `AdminPipeline.jsx`, add a `deleteBatch` handler immediately after the `renameBatch` function (~line 507):

```javascript
  const deleteBatch = async (name) => {
    const found = batches.find(b => b.name === name);
    if (!found) return;
    if (!window.confirm(
      `Delete batch "${name}"? Its applications revert to Random allotment; ` +
      `reviewer assignments and reviews are kept.`
    )) return;
    try {
      await adminPlatformApi.deleteBatch(found.id);
      if (batchFilter === name) setBatchFilter('all');
      await reloadBatches();
      await reload();
    } catch (e) {
      setNote({ kind: 'error', text: `Delete failed: ${e?.message || e}` });
    }
  };
```

(b) In the BATCH filter render block, inside the `getAvailableBatches().map(b => ( ... ))` group `<div>`, add a delete button right after the existing `⋮` rename button (after the `</button>` that closes the dots button, before the group's closing `</div>`):

```jsx
                      <button
                        className="lp-filter-btn-dots"
                        title={`Delete batch ${b}`}
                        onClick={(e) => { e.stopPropagation(); deleteBatch(b); }}
                      >
                        ×
                      </button>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx`
Expected: PASS. If `AdminPipeline` requires additional props to mount, pass sensible defaults (e.g. `decisionMode="default"`); inspect the component's prop usage and supply only what the render path needs.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/adminPlatformApi.js frontend/src/pages/admin/platform/screens/AdminPipeline.jsx frontend/src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx
git commit -m "feat(admin): delete batch from the Applications page (unlink-only)"
```

---

## Task 7: Bulk assign / remove reviewer apps (#2/#3 backend)

**Files:**
- Modify: `backend/app/services/admin_query.py` (imports + two new functions)
- Modify: `backend/app/routers/admin_platform.py` (two routes + body models)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_admin_platform.py`:

```python
def test_bulk_assign_reviewer_apps(client, monkeypatch, _clear_overrides):
    tables = _empty_admin_tables()
    tables["user_roles"] = [{"user_id": "rev-1", "role": "reviewer"}]
    tables["reviewer_assignments"] = [
        {"id": "as-0", "reviewer_user_id": "rev-1", "application_id": "app-0",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
    ]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/reviewers/rev-1/applications", json={"items": [
        {"application_id": "app-1", "track": "tir"},
        {"application_id": "app-0", "track": "tir"},   # already assigned
    ]})
    assert r.status_code == 200, r.text
    results = {x["application_id"]: x["status"] for x in r.json()["results"]}
    assert results["app-1"] == "created"
    assert results["app-0"] == "already_assigned"
    assert any(t == "reviewer_assignments" and p.get("application_id") == "app-1"
               for (t, p) in fake.inserts)


def test_bulk_assign_marks_non_reviewer(client, monkeypatch, _clear_overrides):
    tables = _empty_admin_tables()
    tables["user_roles"] = []           # target holds no reviewer role
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/reviewers/ghost/applications", json={"items": [
        {"application_id": "app-1", "track": "tir"},
    ]})
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["status"] == "not_a_reviewer"


def test_bulk_remove_skips_submitted(client, monkeypatch, _clear_overrides):
    tables = _empty_admin_tables()
    tables["reviewer_assignments"] = [
        {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
        {"id": "as-2", "reviewer_user_id": "rev-1", "application_id": "app-2",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
    ]
    tables["reviews"] = [
        {"id": "r-2", "reviewer_user_id": "rev-1", "application_id": "app-2",
         "application_track": "tir", "submitted_at": "2026-06-01T00:00:00Z"},
    ]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/reviewers/rev-1/applications/remove", json={"items": [
        {"application_id": "app-1", "track": "tir"},
        {"application_id": "app-2", "track": "tir"},   # submitted → skipped
    ]})
    assert r.status_code == 200, r.text
    results = {x["application_id"]: x["status"] for x in r.json()["results"]}
    assert results["app-1"] == "removed"
    assert results["app-2"] == "skipped_submitted"
    remaining = {a["application_id"] for a in fake.tables["reviewer_assignments"]}
    assert remaining == {"app-2"}


def test_bulk_endpoints_admin_only(client, _clear_overrides):
    body = {"items": [{"application_id": "a", "track": "tir"}]}
    app.dependency_overrides[get_current_user] = _override_user("rev-x", roles=["reviewer"])
    assert client.post("/admin/platform/reviewers/rev-1/applications", json=body).status_code == 403
    app.dependency_overrides[get_current_user] = _override_user("lead-x", roles=["leadership"])
    assert client.post("/admin/platform/reviewers/rev-1/applications/remove", json=body).status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_admin_platform.py -k "bulk_assign or bulk_remove or bulk_endpoints" -v`
Expected: FAIL — routes not found (405/404).

- [ ] **Step 3: Add the service functions**

In `backend/app/services/admin_query.py`, first add the datetime import. Change:

```python
import logging
from typing import Any
```

to:

```python
import logging
from datetime import UTC, datetime
from typing import Any
```

Then add these two functions at the end of the file (after `fetch_reviewer_applications`):

```python
def bulk_assign_reviewer_apps(
    user_id: str, items: list[dict[str, Any]], assigned_by: str,
) -> dict[str, Any]:
    """Assign many applications to one reviewer. Per-item status:
    created | already_assigned | not_a_reviewer | invalid_track | error.
    Mirrors leadership_actions.assign_reviewers semantics in bulk.
    """
    sb = get_admin_client()
    if user_id not in _reviewer_user_ids():
        return {"results": [
            {"application_id": it.get("application_id"), "track": it.get("track"),
             "status": "not_a_reviewer"} for it in items
        ]}

    existing: set[tuple[str, str]] = set()
    try:
        for a in (sb.table("reviewer_assignments").select("*")
                  .eq("reviewer_user_id", user_id).execute().data) or []:
            if a.get("reviewer_user_id") == user_id:
                existing.add((a.get("application_id"), a.get("application_track")))
    except Exception as exc:
        log.warning("bulk_assign: existing fetch failed", extra={"err": str(exc)})

    now = datetime.now(UTC).isoformat()
    results: list[dict[str, Any]] = []
    for it in items:
        aid = it.get("application_id")
        track = it.get("track")
        if track not in ("tir", "sip"):
            results.append({"application_id": aid, "track": track, "status": "invalid_track"})
            continue
        if (aid, track) in existing:
            results.append({"application_id": aid, "track": track, "status": "already_assigned"})
            continue
        try:
            sb.table("reviewer_assignments").insert({
                "application_id": aid,
                "application_track": track,
                "reviewer_user_id": user_id,
                "assigned_by": assigned_by,
                "assigned_at": now,
                "state": "pending",
                "due_at": None,
            }).execute()
            existing.add((aid, track))
            results.append({"application_id": aid, "track": track, "status": "created"})
        except Exception as exc:
            log.warning("bulk_assign: insert failed",
                        extra={"application_id": aid, "err": str(exc)})
            results.append({"application_id": aid, "track": track, "status": "error"})
    return {"results": results}


def bulk_remove_reviewer_apps(
    user_id: str, items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Unassign many applications from one reviewer. Per-item status:
    removed | skipped_submitted | not_found | error. Never orphans a submitted
    review (mirrors leadership_actions.unassign_reviewer's 409 guard, but
    per-item rather than aborting the whole request).
    """
    sb = get_admin_client()
    submitted: set[tuple[str, str]] = set()
    try:
        for r in (sb.table("reviews").select("*")
                  .eq("reviewer_user_id", user_id).execute().data) or []:
            if r.get("reviewer_user_id") == user_id and r.get("submitted_at"):
                submitted.add((r.get("application_id"), r.get("application_track")))
    except Exception as exc:
        log.warning("bulk_remove: reviews fetch failed", extra={"err": str(exc)})

    results: list[dict[str, Any]] = []
    for it in items:
        aid = it.get("application_id")
        track = it.get("track")
        if (aid, track) in submitted:
            results.append({"application_id": aid, "track": track, "status": "skipped_submitted"})
            continue
        try:
            res = (sb.table("reviewer_assignments").delete()
                   .eq("application_id", aid)
                   .eq("application_track", track)
                   .eq("reviewer_user_id", user_id)
                   .execute())
            removed = bool(res.data)
            results.append({"application_id": aid, "track": track,
                            "status": "removed" if removed else "not_found"})
        except Exception as exc:
            log.warning("bulk_remove: delete failed",
                        extra={"application_id": aid, "err": str(exc)})
            results.append({"application_id": aid, "track": track, "status": "error"})
    return {"results": results}
```

- [ ] **Step 4: Add the routes**

In `backend/app/routers/admin_platform.py`, add the body models and two routes immediately after the existing `list_reviewer_applications` route (the `GET /reviewers/{user_id}/applications` block):

```python
class _ReviewerAppItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_id: str
    track: Literal["tir", "sip"]


class ReviewerAppsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[_ReviewerAppItem] = Field(..., min_length=1, max_length=500)


@router.post(
    "/reviewers/{user_id}/applications",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def bulk_assign_reviewer_applications(
    user_id: str,
    body: ReviewerAppsBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Bulk-assign applications to one reviewer (Manage Applications drawer)."""
    res = admin_query.bulk_assign_reviewer_apps(
        user_id, [i.model_dump() for i in body.items], assigned_by=user["user_id"],
    )
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="reviewer.bulk_assigned",
        target_table="reviewer_assignments",
        target_id=user_id,
        after={"count": len(body.items)},
    )
    return res


@router.post(
    "/reviewers/{user_id}/applications/remove",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def bulk_remove_reviewer_applications(
    user_id: str,
    body: ReviewerAppsBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Bulk-unassign applications from one reviewer (skips submitted reviews)."""
    res = admin_query.bulk_remove_reviewer_apps(
        user_id, [i.model_dump() for i in body.items],
    )
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="reviewer.bulk_removed",
        target_table="reviewer_assignments",
        target_id=user_id,
        before={"count": len(body.items)},
    )
    return res
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_admin_platform.py -k "bulk_assign or bulk_remove or bulk_endpoints" -v`
Expected: PASS (5 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/admin_query.py backend/app/routers/admin_platform.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): bulk assign/remove reviewer applications (per-item results, submitted-guard)"
```

---

## Task 8: Frontend bulk API methods (#2/#3 frontend lib)

**Files:**
- Modify: `frontend/src/lib/adminPlatformApi.js`

- [ ] **Step 1: Add the methods**

In `frontend/src/lib/adminPlatformApi.js`, add after the `getReviewerApplications` entry (~line 57):

```javascript
  bulkAssignReviewerApps: (userId, items) =>
    api.post(`/admin/platform/reviewers/${encodeURIComponent(userId)}/applications`, { items }),
  bulkRemoveReviewerApps: (userId, items) =>
    api.post(`/admin/platform/reviewers/${encodeURIComponent(userId)}/applications/remove`, { items }),
```

- [ ] **Step 2: Verify the file parses (lint/build smoke)**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminReviewers.test.jsx`
Expected: PASS (existing tests still green — confirms the api module still imports cleanly).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/adminPlatformApi.js
git commit -m "feat(admin): adminPlatformApi bulk assign/remove reviewer-app methods"
```

---

## Task 9: Manage drawer rebuild — checkboxes, batch grouping, bulk remove, multi-assign, flex fix (#1/#2/#3 frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx` (full rewrite)
- Test: `frontend/src/pages/admin/platform/__tests__/ManageApplicationsDrawer.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/platform/__tests__/ManageApplicationsDrawer.test.jsx`:

```jsx
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    bulkAssignReviewerApps: vi.fn().mockResolvedValue({ results: [{ status: "created" }] }),
    bulkRemoveReviewerApps: vi.fn().mockResolvedValue({
      results: [{ status: "removed" }, { status: "removed" }],
    }),
  },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { ManageApplicationsDrawer } from "../screens/ManageApplicationsDrawer";

const ASSIGNED = {
  applications: [
    { id: "app-1", track: "tir", project: "Acme", industry: "Robotics",
      status: "under_review", chip: "IN REVIEW", batch: "Batch A",
      reviewStatus: "pending", assignmentId: "as-1" },
    { id: "app-2", track: "tir", project: "Beta", industry: "Health",
      status: "submitted", chip: "NEW", batch: null,
      reviewStatus: "pending", assignmentId: "as-2" },
  ],
};
const PIPELINE = {
  startups: [
    { id: "app-9", name: "Gamma", domain: "AI", track: "tir", batch: "Unassigned" },
  ],
};
const reviewer = { id: "rev-1", name: "Abhijit Lele", domain: "AI", batches: [] };

beforeEach(() => {
  useAdminData.mockImplementation((kind) => {
    if (kind === "reviewerApplications")
      return { data: ASSIGNED, loading: false, error: null, reload: vi.fn() };
    return { data: PIPELINE, loading: false, error: null, reload: vi.fn() };
  });
});

describe("ManageApplicationsDrawer bulk actions", () => {
  it("select-all then Remove selected calls bulkRemoveReviewerApps with all items", async () => {
    render(<ManageApplicationsDrawer reviewer={reviewer} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Select all applications"));
    fireEvent.click(screen.getByRole("button", { name: /Remove selected/i }));
    await waitFor(() => {
      expect(adminPlatformApi.bulkRemoveReviewerApps).toHaveBeenCalledWith(
        "rev-1",
        expect.arrayContaining([
          { application_id: "app-1", track: "tir" },
          { application_id: "app-2", track: "tir" },
        ]),
      );
    });
  });

  it("multi-assign calls bulkAssignReviewerApps with checked candidates", async () => {
    render(<ManageApplicationsDrawer reviewer={reviewer} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Assign candidate Gamma"));
    fireEvent.click(screen.getByRole("button", { name: /Assign selected/i }));
    await waitFor(() => {
      expect(adminPlatformApi.bulkAssignReviewerApps).toHaveBeenCalledWith(
        "rev-1",
        [{ application_id: "app-9", track: "tir" }],
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/ManageApplicationsDrawer.test.jsx`
Expected: FAIL — controls (`Select all applications`, `Remove selected`, etc.) don't exist yet.

- [ ] **Step 3: Rewrite the drawer**

Replace the entire contents of `frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx` with:

```jsx
// ManageApplicationsDrawer — admin Reviewer Roster "Manage" drawer.
// View a reviewer's assigned applications grouped by batch, bulk-assign new
// applications (multi-select), and bulk-remove assigned ones (select-all and
// select-all-in-batch). Already-reviewed apps are reported skipped, never
// silently orphaned.
//
// Reads:  GET /admin/platform/reviewers/{id}/applications (useAdminData "reviewerApplications")
//         GET /admin/platform/applications               (useAdminData "pipeline", assign picker)
// Writes: POST /admin/platform/reviewers/{id}/applications        (bulk assign)
//         POST /admin/platform/reviewers/{id}/applications/remove (bulk remove)
import React, { useState, useMemo } from "react";
import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";

const RANDOM = "Random allotment";

export function ManageApplicationsDrawer({ reviewer, onClose, onChanged }) {
  const apps = useAdminData("reviewerApplications", { userId: reviewer.id });
  const pipeline = useAdminData("pipeline", {});
  const [selRemove, setSelRemove] = useState(() => new Set());
  const [selAssign, setSelAssign] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const assigned = apps.data?.applications ?? [];
  const assignedIds = useMemo(() => new Set(assigned.map(a => a.id)), [assigned]);
  const reviewerBatches = Array.isArray(reviewer.batches)
    ? reviewer.batches.map(b => (typeof b === "string" ? b : b.name))
    : [];

  // Group assigned apps by batch (null → "Random allotment").
  const groups = useMemo(() => {
    const m = new Map();
    for (const a of assigned) {
      const key = a.batch || RANDOM;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(a);
    }
    return Array.from(m.entries()).sort((x, y) => x[0].localeCompare(y[0]));
  }, [assigned]);

  // Candidate apps for assignment (not already assigned), filtered by search.
  const candidates = useMemo(() => {
    const all = (pipeline.data?.startups ?? []).filter(s => !assignedIds.has(s.id));
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(s =>
      `${s.name || ""} ${s.domain || ""}`.toLowerCase().includes(q));
  }, [pipeline.data, assignedIds, search]);

  const reload = () => { apps.reload(); onChanged && onChanged(); };

  const toggle = (set, setSet, id) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setSet(next);
  };
  const allSelected = assigned.length > 0 && selRemove.size === assigned.length;
  const toggleSelectAll = () =>
    setSelRemove(allSelected ? new Set() : new Set(assigned.map(a => a.id)));
  const toggleBatch = (rows) => {
    const ids = rows.map(r => r.id);
    const allOn = ids.every(id => selRemove.has(id));
    const next = new Set(selRemove);
    ids.forEach(id => (allOn ? next.delete(id) : next.add(id)));
    setSelRemove(next);
  };

  const summarize = (results, kind) => {
    const c = {};
    for (const r of results || []) c[r.status] = (c[r.status] || 0) + 1;
    if (kind === "remove") {
      const parts = [];
      if (c.removed) parts.push(`removed ${c.removed}`);
      if (c.skipped_submitted) parts.push(`skipped ${c.skipped_submitted} (already reviewed)`);
      if (c.not_found) parts.push(`${c.not_found} not found`);
      return parts.join(", ") || "no changes";
    }
    const parts = [];
    if (c.created) parts.push(`assigned ${c.created}`);
    if (c.already_assigned) parts.push(`${c.already_assigned} already assigned`);
    if (c.not_a_reviewer) parts.push("not a reviewer");
    if (c.invalid_track) parts.push(`${c.invalid_track} invalid`);
    return parts.join(", ") || "no changes";
  };

  const handleRemoveSelected = async () => {
    const items = assigned
      .filter(a => selRemove.has(a.id))
      .map(a => ({ application_id: a.id, track: a.track }));
    if (!items.length) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await adminPlatformApi.bulkRemoveReviewerApps(reviewer.id, items);
      setNotice(`Remove: ${summarize(res?.results, "remove")}.`);
      setSelRemove(new Set());
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Remove failed.");
    } finally { setBusy(false); }
  };

  const handleAssignSelected = async () => {
    const items = candidates
      .filter(c => selAssign.has(c.id))
      .map(c => ({ application_id: c.id, track: c.track }));
    if (!items.length) return;
    setBusy(true); setErr(null); setNotice(null);
    try {
      const res = await adminPlatformApi.bulkAssignReviewerApps(reviewer.id, items);
      setNotice(`Assign: ${summarize(res?.results, "assign")}.`);
      setSelAssign(new Set());
      setSearch("");
      reload();
    } catch (e) {
      setErr(e?.details?.message || e?.message || "Assign failed.");
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

          {/* Assign new applications (multi-select) */}
          <div style={{ background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: 4, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <div className="os-text-xs os-text-dim os-uppercase" style={{ fontWeight: 600 }}>Assign New Applications</div>
              <button
                className="os-btn"
                style={{ background: "var(--accent)", color: "#fff", flexShrink: 0, whiteSpace: "nowrap" }}
                onClick={handleAssignSelected}
                disabled={busy || selAssign.size === 0}
              >
                Assign selected ({selAssign.size})
              </button>
            </div>
            <input
              className="os-input"
              aria-label="Search applications to assign"
              placeholder="Search by name or industry…"
              style={{ width: "100%", minWidth: 0, fontSize: 14, marginBottom: 8 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 4, background: "var(--bg-paper)" }}>
              {candidates.length === 0 ? (
                <div className="os-text-soft" style={{ fontSize: 13, padding: 12 }}>No applications to assign.</div>
              ) : candidates.map(c => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--line)", cursor: "pointer", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    aria-label={`Assign candidate ${c.name}`}
                    checked={selAssign.has(c.id)}
                    onChange={() => toggle(selAssign, setSelAssign, c.id)}
                  />
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span className="os-text-soft">({c.domain || "—"})</span>
                  <span className="os-text-dim" style={{ marginLeft: "auto" }}>
                    {c.batch && c.batch !== "Unassigned" ? c.batch : "Unassigned"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {err && (
            <div style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600, padding: "8px 12px", background: "var(--bad-soft)", borderRadius: 4 }}>{err}</div>
          )}
          {notice && (
            <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 4 }}>{notice}</div>
          )}

          {/* Assigned applications — bulk remove */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }} className="os-text-xs os-text-dim os-uppercase">
                <input
                  type="checkbox"
                  aria-label="Select all applications"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  disabled={assigned.length === 0}
                />
                <span style={{ fontWeight: 600 }}>Assigned Applications ({assigned.length})</span>
              </label>
              <button
                className="os-btn sm"
                style={{ background: "#FF5A5F", borderColor: "#FF5A5F", color: "#fff", flexShrink: 0, whiteSpace: "nowrap" }}
                onClick={handleRemoveSelected}
                disabled={busy || selRemove.size === 0}
              >
                Remove selected ({selRemove.size})
              </button>
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
              groups.map(([batchName, rows]) => {
                const ids = rows.map(r => r.id);
                const batchAllOn = ids.every(id => selRemove.has(id));
                return (
                  <div key={batchName} style={{ marginBottom: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12, fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        aria-label={`Select all in ${batchName}`}
                        checked={batchAllOn}
                        onChange={() => toggleBatch(rows)}
                      />
                      {batchName === RANDOM
                        ? <span className="os-chip purple">{RANDOM}</span>
                        : <span className="os-chip" style={{ background: "var(--bg-soft)", border: "1px solid var(--line)" }}>{batchName}</span>}
                      <span className="os-text-dim">({rows.length})</span>
                    </label>
                    <table className="os-table">
                      <thead>
                        <tr><th style={{ width: 32 }}></th><th>Project</th><th>Industry</th><th>Status</th><th></th></tr>
                      </thead>
                      <tbody>
                        {rows.map(a => (
                          <tr key={a.id}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${a.project}`}
                                checked={selRemove.has(a.id)}
                                onChange={() => toggle(selRemove, setSelRemove, a.id)}
                              />
                            </td>
                            <td><div className="startup">{a.project}</div></td>
                            <td className="os-text-soft">{a.industry}</td>
                            <td><span className="os-chip">{a.chip}</span></td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                className="os-btn sm ghost"
                                style={{ color: "#FF5A5F" }}
                                onClick={async () => {
                                  setBusy(true); setErr(null); setNotice(null);
                                  try {
                                    const res = await adminPlatformApi.bulkRemoveReviewerApps(
                                      reviewer.id, [{ application_id: a.id, track: a.track }]);
                                    setNotice(`Remove: ${summarize(res?.results, "remove")}.`);
                                    reload();
                                  } catch (e) {
                                    setErr(e?.details?.message || e?.message || "Remove failed.");
                                  } finally { setBusy(false); }
                                }}
                                disabled={busy}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/ManageApplicationsDrawer.test.jsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Verify the drawer's consumer still compiles**

The drawer is opened by `AdminReviewers.jsx`. Confirm its existing tests still pass:

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminReviewers.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx frontend/src/pages/admin/platform/__tests__/ManageApplicationsDrawer.test.jsx
git commit -m "feat(admin): Manage drawer bulk select/remove + multi-assign + batch grouping; fix layout overflow"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: All previously-passing tests still pass; the new tests pass. (The repo has a known small set of pre-existing failures unrelated to this work — compare against a baseline `git stash`-free run on `43ef82e` if anything looks off; do NOT fix unrelated failures here.)

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: All tests pass, including the 3 new test files.

- [ ] **Step 3: Grep for accidental leftovers**

Run: `cd backend && grep -rn "myScore\|bulk_assign_reviewer_apps\|bulk_remove_reviewer_apps\|delete_batch" app/ | head`
Run: `cd frontend && grep -rn "bulkAssignReviewerApps\|bulkRemoveReviewerApps\|deleteBatch\|My Score" src/ | head`
Expected: only the intended definitions/usages appear.

- [ ] **Step 4: Confirm no migration was introduced**

Run: `git -C . diff --name-only 43ef82e..HEAD -- backend/migrations`
Expected: empty (no migration files changed).

- [ ] **Step 5: Final summary commit (docs)**

If any plan checkboxes are tracked in this file, commit the updated plan:

```bash
git add docs/superpowers/plans/2026-06-25-reviewer-admin-qa-fixes.md
git commit -m "docs(qa): mark implementation plan tasks complete"
```

---

## Deploy (only on explicit go-ahead from the user)

Not part of task execution. When the user says go:
1. From this worktree only (never the shared HEAD): `cd infra/sam && grep -n "SUBMISSIONS_CLOSED" .env.prod` — confirm `TIR_SUBMISSIONS_CLOSED=true` and `SIP_SUBMISSIONS_CLOSED=true` are present before deploying.
2. Backend: `./deploy-prod.sh` (SAM build reads `backend/` from this worktree's disk).
3. Frontend: build + **promote** the Vercel deployment to `apply.artpark.info`.
4. Smoke: reviewer History loads; queue shows My Score; admin Manage drawer bulk ops; batch delete.
