# Admin Portal — UI cleanup + Admin Review fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven admin-portal changes — remove Audit/Analytics tabs (keep backend logging), remove a reviewer sub-label + the Consistency column, clamp reviewer weight to 0–10, redefine roster Progress as work-done, fix Admin Review to show real reviewer evaluations, and remove the Hide/Unhide button.

**Architecture:** FastAPI (Lambda) + React/Vite (Vercel) + Supabase. Work in worktree `.claude/worktrees/admin-portal-ui-and-review` (branch `fix/admin-portal-ui-and-review`, off `origin/release/sip-launch-v1` @ `dc667c3`). No DB migration. Backend reads use the RLS-bypassing admin client; tests use the in-file fake Supabase client.

**Tech Stack:** Python 3.11 / pytest (append `--no-cov` to targeted runs — repo enforces a 70% coverage gate that a single-file run won't meet). React / Vitest. Backend tests from `backend/`; frontend from `frontend/` (`node_modules` is symlinked). Commits: **no Co-Authored-By / AI references** (user's global rule).

**Spec:** `docs/superpowers/specs/2026-06-25-admin-portal-ui-and-review-design.md`

---

## File Structure
- `backend/app/services/admin_query.py` — `fetch_roster` progress = work-done union (#4).
- `backend/app/routers/admin_platform.py` — `ReviewerProfileBody.weight` 0–10 validation (#5 backend).
- `backend/tests/test_admin_platform.py` — tests for #4 + #5.
- `frontend/src/pages/admin/platform/AdminPortal.jsx` — remove Audit/Analytics nav + render + imports (#1).
- `frontend/src/pages/admin/platform/screens/AdminReviewers.jsx` — remove sub-label (#2), Consistency column (#3), weight input clamp (#5 frontend).
- `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` — remove Hide/Unhide button + handler (#7).
- `frontend/src/pages/admin/platform/screens/AdminGate1.jsx` — hydrate Variant-A app with `loadDetail` so reviewer evaluations show (#6).
- Frontend tests extend existing `__tests__/AdminReviewers.test.jsx`, `AdminPipeline.batchDelete.test.jsx`, `AdminGate1Review.test.jsx`.

---

## Task 1: Roster Progress = work done (#4 backend)

**Files:**
- Modify: `backend/app/services/admin_query.py` (`fetch_roster` per-reviewer loop)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing test** — add to `backend/tests/test_admin_platform.py`:

```python
def test_roster_progress_is_work_done_union(client, monkeypatch, _clear_overrides):
    """Progress = reviews done / |active assignments ∪ reviewed apps|.
    A submitted review for an app the reviewer is NO LONGER assigned to still
    counts in both numerator and denominator (the unassign churn case)."""
    tables = _empty_admin_tables()
    tables["user_roles"] = [{"user_id": "rev-1", "role": "reviewer"}]
    tables["profiles"] = [{"id": "rev-1", "full_name": "Ramanpreet", "email": "r@x.com"}]
    tables["reviewer_profiles"] = []
    # 4 current active assignments (app-a..app-d), none reviewed.
    tables["reviewer_assignments"] = [
        {"id": f"as-{c}", "reviewer_user_id": "rev-1", "application_id": f"app-{c}",
         "application_track": "tir", "declined_at": None, "reassigned_to": None,
         "completed_at": None} for c in "abcd"
    ]
    # 2 submitted reviews for OTHER apps (app-x, app-y) — now unassigned.
    tables["reviews"] = [
        {"id": "r-x", "reviewer_user_id": "rev-1", "application_id": "app-x",
         "application_track": "tir", "submitted_at": "2026-06-20T00:00:00Z"},
        {"id": "r-y", "reviewer_user_id": "rev-1", "application_id": "app-y",
         "application_track": "tir", "submitted_at": "2026-06-21T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/reviewers")
    assert r.status_code == 200, r.text
    rev = r.json()["reviewers"][0]
    assert rev["completed"] == 2          # 2 apps reviewed
    assert rev["assigned"] == 6           # 4 active ∪ 2 reviewed (disjoint) = 6
    assert rev["progress"] == "2 / 6"
```

- [ ] **Step 2: Run it to verify it fails** — `cd backend && python -m pytest tests/test_admin_platform.py::test_roster_progress_is_work_done_union -v --no-cov` → expect FAIL (current logic counts reviewed-among-active = 0, assigned = 4).

- [ ] **Step 3: Implement** — In `backend/app/services/admin_query.py`, inside `fetch_roster`'s per-reviewer loop, find the current `assigned`/`completed` block (it currently reads):

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

Replace that whole block with the work-done union:

```python
        # Progress = WORK DONE. `completed` = distinct apps this reviewer has
        # submitted a review for; `assigned` = |active assignments ∪ reviewed|.
        # Counts reviews even for apps the reviewer was later unassigned from
        # (the reassignment churn), and never exceeds 100%. Independent of the
        # unreliable reviewer_assignments.completed_at.
        submitted_keys = {
            (r.get("application_id"), r.get("application_track"))
            for r in reviews_by_rev[rid]
            if r.get("submitted_at")
        }
        active_keys = {
            (a.get("application_id"), a.get("application_track")) for a in active
        }
        completed = len(submitted_keys)
        assigned = len(active_keys | submitted_keys)
```

(The line `"progress": f"{completed} / {assigned}",` later in the appended dict stays as-is.)

- [ ] **Step 4: Run it to verify it passes** — `cd backend && python -m pytest tests/test_admin_platform.py::test_roster_progress_is_work_done_union tests/test_admin_platform.py -k roster -v --no-cov` → expect PASS. Then the whole file: `python -m pytest tests/test_admin_platform.py -q --no-cov`.

- [ ] **Step 5: Commit**
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review
git add backend/app/services/admin_query.py backend/tests/test_admin_platform.py
git commit -m "fix(admin): roster progress = work done (reviewed ∪ assigned), independent of completed_at"
```

---

## Task 2: Clamp reviewer weight to 0–10 (#5 backend)

**Files:**
- Modify: `backend/app/routers/admin_platform.py` (`ReviewerProfileBody`, ~line 585)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing test** — add to `backend/tests/test_admin_platform.py`:

```python
def test_patch_reviewer_rejects_out_of_range_weight(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, _empty_admin_tables())
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    assert client.patch("/admin/platform/reviewers/rev-1", json={"weight": 11}).status_code == 422
    assert client.patch("/admin/platform/reviewers/rev-1", json={"weight": -1}).status_code == 422

def test_patch_reviewer_accepts_in_range_weight(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, _empty_admin_tables())
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    assert client.patch("/admin/platform/reviewers/rev-1", json={"weight": 7.5}).status_code == 200
```

- [ ] **Step 2: Run it to verify it fails** — `cd backend && python -m pytest tests/test_admin_platform.py -k patch_reviewer -v --no-cov` → expect the out-of-range test to FAIL (currently any float is accepted → 200).

- [ ] **Step 3: Implement** — In `backend/app/routers/admin_platform.py`, change the `ReviewerProfileBody` weight field. Find:

```python
class ReviewerProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weight: float | None = None
```

Replace the `weight` line with a 0–10 constrained field (`Field` is already imported):

```python
class ReviewerProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weight: float | None = Field(default=None, ge=0, le=10)
```

- [ ] **Step 4: Run it to verify it passes** — `cd backend && python -m pytest tests/test_admin_platform.py -k patch_reviewer -v --no-cov` → expect PASS. Then `python -m pytest tests/test_admin_platform.py -q --no-cov`.

- [ ] **Step 5: Commit**
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review
git add backend/app/routers/admin_platform.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): validate reviewer weight in 0–10 range (422 otherwise)"
```

---

## Task 3: Remove Audit + Analytics tabs (#1 frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/AdminPortal.jsx`

- [ ] **Step 1: Remove the two NAV entries** — In `AdminPortal.jsx`, delete these two lines (and the preceding `// extension:` comment line):

```jsx
    // extension: surface built Audit/Analytics screens the prototype left unreachable
    { id:'audit',     label:'Audit',     sub:'EVENT TRAIL',   badge:null },
    { id:'analytics', label:'Analytics', sub:'CALIBRATION',   badge:null },
```

- [ ] **Step 2: Remove the two render lines** — delete:

```jsx
            {page === 'audit'       && <AdminAudit />}
            {page === 'analytics'   && <AdminAnalytics />}
```

- [ ] **Step 3: Remove the now-unused imports** — delete:

```jsx
import { AdminAnalytics } from "./screens/AdminAnalytics";
import { AdminAudit } from "./screens/AdminAudit";
```

(Leave the `audit:'AUDIT LOG', analytics:'ANALYTICS'` entry in the label map — harmless and avoids touching an unrelated object. The screen files `AdminAudit.jsx` / `AdminAnalytics.jsx` stay on disk, now unreferenced. **No backend change** — `audit_log_v2`, `write_audit`, `/admin/platform/audit-log`, and `/analytics/reviewer-calibration` are untouched.)

- [ ] **Step 4: Verify** — confirm the tabs/imports are gone and nothing else references them, then run the full frontend suite to ensure no import breakage:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review/frontend
grep -nE "AdminAudit|AdminAnalytics|id:'audit'|id:'analytics'" src/pages/admin/platform/AdminPortal.jsx   # expect: no matches
npx vitest run 2>&1 | tail -5
```
Expected: grep prints nothing; vitest suite passes (pre-existing `FileGridAnswer.test.jsx` collection error from the missing `@testing-library/user-event` dep is unrelated — ignore it).

- [ ] **Step 5: Commit**
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review
git add frontend/src/pages/admin/platform/AdminPortal.jsx
git commit -m "feat(admin): remove Audit + Analytics tabs from the UI (backend logging unchanged)"
```

---

## Task 4: Reviewer roster — remove sub-label + Consistency column + weight clamp (#2, #3, #5 frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminReviewers.jsx`
- Test: `frontend/src/pages/admin/platform/__tests__/AdminReviewers.test.jsx`

- [ ] **Step 1: Write/extend the failing tests** — add to `AdminReviewers.test.jsx` (it already mounts `AdminReviewers` with `useAdminData` mocked + `SAMPLE_REVIEWERS`):

```jsx
  it("does not render the External·paid sub-label or a Consistency column", () => {
    useAdminData.mockReturnValue({ data: { reviewers: SAMPLE_REVIEWERS }, loading: false, error: null, reload: vi.fn() });
    render(<AdminReviewers decisionMode="reviewer" />);
    expect(screen.queryByText(/paid per review/i)).toBeNull();
    expect(screen.queryByText("Consistency")).toBeNull();
  });

  it("weight input is clamped to 0–10 in the edit drawer", () => {
    useAdminData.mockReturnValue({ data: { reviewers: SAMPLE_REVIEWERS }, loading: false, error: null, reload: vi.fn() });
    render(<AdminReviewers decisionMode="reviewer" />);
    fireEvent.click(screen.getByText("Edit reviewer"));
    fireEvent.click(screen.getByText("Edit details"));
    const weightInput = document.querySelector('input[type="number"]');
    expect(weightInput).toBeTruthy();
    expect(weightInput.getAttribute("min")).toBe("0");
    expect(weightInput.getAttribute("max")).toBe("10");
  });
```

- [ ] **Step 2: Run to verify they fail** — `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminReviewers.test.jsx` → expect the two new tests to FAIL.

- [ ] **Step 3a: Remove the "External · paid per review" sub-label** — in `AdminReviewers.jsx`, in the reviewer-mode table's Reviewer cell, change:

```jsx
                      <div className="startup">
                        {r.name || '—'}
                        <small>External · paid per review</small>
                      </div>
```
to:
```jsx
                      <div className="startup">
                        {r.name || '—'}
                      </div>
```

- [ ] **Step 3b: Remove the Consistency column (reviewer-mode table)** — remove the header line:
```jsx
                {renderHeader('Consistency', 'consistency')}
```
and remove the Consistency `<td>` cell block:
```jsx
                    {/* Consistency */}
                    <td>
                      {cons != null ? (
                        <span className={'os-chip ' + consColor}>
                          {(cons * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="os-text-soft">—</span>
                      )}
                    </td>
```
and remove the two now-unused locals in that row's map body:
```jsx
                const cons = r.consistency;
                const consColor = cons >= 0.9 ? 'green' : cons >= 0.8 ? 'amber' : 'red';
```

- [ ] **Step 3c: Remove the Consistency column (jury-mode mock table)** — for UI consistency, also remove its header line `{renderHeader('Consistency', 'consistency')}` and its cell block:
```jsx
                <td>
                  {r.consistency != null ? (
                    <span className={'os-chip ' + (r.consistency >= 0.9 ? 'green' : r.consistency >= 0.8 ? 'amber' : 'red')}>
                      {(r.consistency * 100).toFixed(0)}%
                    </span>
                  ) : <span className="os-text-soft">—</span>}
                </td>
```

- [ ] **Step 3d: Tidy the subtitles** — change the reviewer-mode `sub="Assignments, progress, consistency calibration."` to `sub="Assignments, progress."`. (Leave the jury-mode `sub="Assignments, progress, and alignment calibration."` as-is — it's the mock screen.)

- [ ] **Step 3e: Clamp the weight input** — in the `ManageDrawer`, change the weight `<input>`:
```jsx
              type="number"
              className="os-input"
              ...
              value={weight}
              onChange={e => setWeight(e.target.value)}
```
to add bounds + step:
```jsx
              type="number"
              min="0"
              max="10"
              step="0.1"
              className="os-input"
              ...
              value={weight}
              onChange={e => setWeight(e.target.value)}
```
(keep the other existing attributes on that input). Then clamp on save: find the save body that sends weight (`weight: parseFloat(weight) || 1.0,`) and replace it with a clamped value:
```jsx
        weight: Math.min(10, Math.max(0, parseFloat(weight) || 0)),
```

- [ ] **Step 4: Run to verify they pass** — `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminReviewers.test.jsx` → expect ALL green (existing + 2 new).

- [ ] **Step 5: Commit**
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review
git add frontend/src/pages/admin/platform/screens/AdminReviewers.jsx frontend/src/pages/admin/platform/__tests__/AdminReviewers.test.jsx
git commit -m "feat(admin): roster drops paid-per-review label + Consistency column; weight input clamped 0–10"
```

---

## Task 5: Remove the Hide/Unhide bulk button (#7 frontend)

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`
- Test: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx` (extend)

- [ ] **Step 1: Write the failing test** — add to `AdminPipeline.batchDelete.test.jsx` a check that selecting rows shows Archive but not Hide/Unhide. Since the floating bar appears only when rows are selected, assert at the module level that the rendered component never exposes a "Hide / Unhide" control. Append this test inside the existing `describe`:

```jsx
  it("has no Hide / Unhide bulk button", () => {
    render(<AdminPipeline decisionMode="default" />);
    expect(screen.queryByText("Hide / Unhide")).toBeNull();
  });
```
(The floating bar is only shown with a selection, so "Hide / Unhide" must be absent in the default render — and after this change it is removed entirely.)

- [ ] **Step 2: Run to verify current state** — `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx` → the new test passes already if no row is selected; to make it meaningful, the removal in Step 3 guarantees the button never exists. Proceed to Step 3.

- [ ] **Step 3: Remove the button + handler** — in `AdminPipeline.jsx`, delete the button:
```jsx
          <button className="os-floating-btn" disabled={busy} onClick={handleBulkToggleHide}>Hide / Unhide</button>
```
and delete its handler definition:
```jsx
  const handleBulkToggleHide = () => runBulkMeta({ is_hidden: true }, 'Hide');
```
Leave the `Archive` button, `handleBulkArchive`, `runBulkMeta`, and `adminPlatformApi.patchMeta` intact.

- [ ] **Step 4: Run to verify + grep** — 
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review/frontend
grep -nE "Hide / Unhide|handleBulkToggleHide" src/pages/admin/platform/screens/AdminPipeline.jsx   # expect: no matches
npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx
```
Expected: grep prints nothing; tests pass.

- [ ] **Step 5: Commit**
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review
git add frontend/src/pages/admin/platform/screens/AdminPipeline.jsx frontend/src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx
git commit -m "feat(admin): remove Hide/Unhide bulk action from Applications (Archive retained)"
```

---

## Task 6: Admin Review shows real reviewer evaluations (#6 frontend) — RISKIEST

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminGate1.jsx` (the `GateReviewStack` component, Variant A)
- Test: `frontend/src/pages/admin/platform/__tests__/AdminGate1Review.test.jsx` (extend)

**Context:** `GateReviewStack({ items, reload })` renders one app at a time. `s = items[safeIdx]` is a pipeline-list row (no `reviews`/`rev`). `<ComparativeReviewModel startup={s} />` reads `startup.reviews`; `revScore(s)` reads `s.rev?.overall ?? s.ai?.overall`. We hydrate the displayed app with `loadDetail(track, id)` (returns `{reviews, rev, ...}`) so real evaluations + the reviewer-overall score appear. The decision path (`decide` → `BUTTON_TO_DECISION` → `adminPlatformApi.decide`) already maps approve→shortlisted / waitlist→waitlisted / reject→rejected — verify, don't change.

- [ ] **Step 1: Write the failing test** — add to `AdminGate1Review.test.jsx`. Mock `useAdminData` to return one evaluated app (no reviews on the list row) and mock `loadDetail` to return reviews. Assert the reviewer evaluation renders (the "No reviewer evaluations submitted yet" text disappears). Match the existing file's mock style; if `loadDetail` isn't yet imported there, add it to the `useAdminData` module mock:

```jsx
// in the vi.mock("../../../../hooks/useAdminData", ...) factory, add:
//   loadDetail: vi.fn(),
// then in the test:
import { useAdminData, loadDetail } from "../../../../hooks/useAdminData";

it("hydrates the current app with reviewer evaluations from loadDetail", async () => {
  useAdminData.mockImplementation((kind, params) => {
    if (kind === "pipeline" && params?.status === "evaluated")
      return { data: { startups: [{ id: "app-1", track: "tir", name: "RenewCred", domain: "Climate", stage: "Deployed", ai: { overall: 8.6 } }] }, loading: false, error: null, reload: vi.fn() };
    return { data: { startups: [] }, loading: false, error: null, reload: vi.fn() };
  });
  loadDetail.mockResolvedValue({
    id: "app-1", track: "tir", name: "RenewCred",
    reviews: [{ reviewerName: "Ramanpreet", overall: 7.4, recommendation: "yes", problem: 8, solution: 7, tech: 7, founders: 8, commit: 7, strengths: "Strong team", concerns: "", flags: [] }],
    rev: { overall: 7.4, problem: 8, solution: 7, tech: 7, founders: 8, commit: 7 },
  });
  render(<AdminGate1 goDetail={() => {}} />);
  // Variant A (Status) is the default tab.
  await waitFor(() => {
    expect(screen.queryByText("No reviewer evaluations submitted yet.")).toBeNull();
  });
});
```
(Adjust the import list/mock to match the existing test file's structure; the key assertions are: `loadDetail` is called and the "No reviewer evaluations" text is gone once it resolves.)

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminGate1Review.test.jsx` → expect FAIL (the consensus stays empty because `s` has no reviews).

- [ ] **Step 3: Implement hydration in `GateReviewStack`** — In `AdminGate1.jsx`:

(a) Add `loadDetail` to the existing import from the hooks module:
```jsx
import { useAdminData, loadDetail } from "../../../../hooks/useAdminData";
```

(b) Inside `function GateReviewStack({ items, reload }) {`, after `const s = items[safeIdx];`, add a detail cache + fetch effect and a hydrated row:
```jsx
  const [detailCache, setDetailCache] = useState({});
  useEffect(() => {
    if (!s || !s.id || detailCache[s.id]) return;
    let alive = true;
    loadDetail(s.track, s.id)
      .then(d => { if (alive) setDetailCache(prev => ({ ...prev, [s.id]: d })); })
      .catch(() => {});
    return () => { alive = false; };
  }, [s, detailCache]);
  const sH = (s && detailCache[s.id]) ? { ...s, ...detailCache[s.id] } : s;
```
(`useState`/`useEffect` are already imported by this file — verify the React import line includes them; if not, add them.)

(c) Replace the score line `const scoreVal = revScore(s);` with:
```jsx
  const scoreVal = revScore(sH);
```

(d) In the render, pass the hydrated row to the consensus and use it for the reviewer-overall label. Change:
```jsx
            <ComparativeReviewModel startup={s} />
```
to:
```jsx
            <ComparativeReviewModel startup={sH} />
```
and in the score card, change the two `s.rev` checks to `sH.rev`:
```jsx
                  {sH.rev ? "Reviewer Overall" : "AI Score"}
                ...
                  {sH.rev ? "Weighted reviewer consensus" : "AI screening score (reviewer score unavailable on list)"}
```
(Leave the `decide`, navigation, and progress-dot logic untouched — they key off `s`/`safeIdx`, which is correct.)

- [ ] **Step 4: Verify the decision mapping (no code change expected)** — confirm `BUTTON_TO_DECISION` in `lib/adminDataAdapter.js` is `{ approve: "shortlisted", hold: "on_hold", reject: "rejected", waitlist: "waitlisted" }` and that `decide` calls `adminPlatformApi.decide(s.track, s.id, { decision: wireId, rationale })`. If both hold, the decision path is correct — no change.

- [ ] **Step 5: Run to verify it passes** — `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminGate1Review.test.jsx` → expect PASS. Then run the whole admin platform test dir: `npx vitest run src/pages/admin/platform/__tests__/` → all green.

- [ ] **Step 6: Backend spot-check (read-only)** — confirm `admin_query.fetch_detail` returns `reviews`. Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review/backend
grep -nE '"reviews"|reviews' app/services/admin_query.py | head
```
Expected: `fetch_detail` builds a `reviews` key. If it does NOT (no reviews in the detail payload), STOP and report — a backend reviews sub-fetch would be needed (the FE `adaptDetail` already consumes `d.reviews`). The prod-data check (15 evaluated apps each have reviews) indicates it does.

- [ ] **Step 7: Commit**
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review
git add frontend/src/pages/admin/platform/screens/AdminGate1.jsx frontend/src/pages/admin/platform/__tests__/AdminGate1Review.test.jsx
git commit -m "fix(admin): Admin Review hydrates each app with real reviewer evaluations (loadDetail)"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite** — `cd backend && python -m pytest -q --no-cov 2>&1 | tail -6`
Expected: new tests pass. (The repo has ~19 pre-existing failures in `test_validate_submission_mandatory_fields.py` / `test_validation_limits.py` — unrelated to this work; they fail identically on the base commit. Do NOT fix them.)

- [ ] **Step 2: Frontend suite** — `cd frontend && npx vitest run 2>&1 | tail -8`
Expected: all green except the pre-existing `FileGridAnswer.test.jsx` collection error (missing `@testing-library/user-event` dep — unrelated env artifact).

- [ ] **Step 3: Grep for leftovers** —
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-portal-ui-and-review
grep -rnE "External · paid per review|Hide / Unhide|id:'audit'|id:'analytics'" frontend/src/pages/admin/platform/ || echo "clean ✓"
git diff --name-only dc667c3..HEAD -- backend/migrations   # expect empty (no migration)
```

- [ ] **Step 4: Confirm commit log is clean** — `git log --oneline dc667c3..HEAD` shows the 6 implementation commits + spec/plan docs, no AI/Co-Authored-By trailers.

---

## Deploy (only on explicit go-ahead)
From this worktree only: `cd infra/sam && grep -nE "SUBMISSIONS_CLOSED" .env.prod` — confirm `TIR_SUBMISSIONS_CLOSED=true` and `SIP_SUBMISSIONS_CLOSED=true` are present (the worktree's `.env.prod` may not yet have them — add `=true` if missing, as in the prior deploy). Then `./deploy-prod.sh`, push `release/sip-launch-v1`, and have the user promote the Vercel build. Smoke: roster progress shows work-done; weight rejects >10; Admin Review shows reviewer evaluations; no Audit/Analytics tabs; no Hide/Unhide button.
