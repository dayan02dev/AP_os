# Admin Review + reviewer-filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reviewer filters behind a "Filters" toggle; admin-review cleanup (drop Cutoff variant + Waitlist tally + HOLD), fix batch-Approve emails, show reviewer flags, remove the reviewer-assign panel, make batch rows open the detail, fix Manage→Remove for reviewed apps.

**Architecture:** Frontend React/Vite + FastAPI backend. Most admin edits are in one large file (`AdminGate1.jsx`) so they're consolidated into one task. Backend adds reviewer-flag aggregation to the pipeline payload + relaxes the remove-guard. Plus a prod data fix + an email smoke test.

**Tech Stack:** React 18, Vite, Vitest + @testing-library/react (use `fireEvent`, NOT `@testing-library/user-event`). FastAPI, pytest.

**Branch:** worktree on `release/sip-launch-v1` (spec `afcef6f`). Commit per task. **Backend SAM deploy required** (Task 5). No DB migration. Spec: `docs/superpowers/specs/2026-06-29-admin-review-and-reviewer-filter-design.md`.

**Notes:** A parallel "six admin-portal fixes" spec (`07f3ca9`) is on the branch (docs-only). Admin "Approve" = `jury_review` ("advance to jury") — the established semantics + the value that triggers the applicant email.

---

## Task 1: Reviewer "Filters" toggle button

**Files:**
- Modify: `frontend/src/pages/reviewer/v2/ReviewerQueue.jsx`
- Test: `frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx` (append)

- [ ] **Step 1: Append the failing test** to `ReviewerQueue.test.jsx`:

```jsx
import { fireEvent } from "@testing-library/react";

describe("ReviewerQueue filters toggle", () => {
  const qa = {
    data: [{ id: "1", applicationId: "TIR-1", track: "tir", name: "X", founders: [],
             industry: "EdTech", stage: "Lab demo", ai: { overall: 4 }, reviewStatus: "submitted", due: null }],
    loading: false, error: null, reload: () => {},
  };
  it("hides the Status/Stage/Industry sections until the Filters button is clicked", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={qa} />);
    expect(screen.queryByText("STATUS")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    expect(screen.getByText("STATUS")).toBeInTheDocument();
  });
});
```

(If `ReviewerQueue.test.jsx` doesn't already import `render, screen` from `@testing-library/react`, add `fireEvent` to the existing import instead of a second import line.)

- [ ] **Step 2: Run → fail**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx`
Expected: FAIL — STATUS section is rendered unconditionally (visible before any click).

- [ ] **Step 3: Edit `ReviewerQueue.jsx`**

(a) Add a state near the other `useState`s (after `const [domainFilter, setDomainFilter] = useState(initialDomain);`):
```jsx
  const [showFilters, setShowFilters] = useState(false);
```

(b) Add an active-filter count near `hasFilters`/`clearAll`:
```jsx
  const activeFilterCount =
    (track !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (stageFilter !== "all" ? 1 : 0) +
    (domainFilter !== "all" ? 1 : 0);
```

(c) In `.lp-filter-row--search`, add a Filters button immediately BEFORE the `{hasFilters && (...Clear filters...)}` block:
```jsx
          <button
            className={`lp-filter-btn${showFilters ? " active" : ""}`}
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
```

(d) Wrap the three `.lp-filter-section` blocks (STATUS, STAGE, INDUSTRY) in `{showFilters && ( … )}`. Concretely, change the opening `<div className="lp-filter-section">` of the STATUS section to be preceded by `{showFilters && (<>` and close `</>)}` after the INDUSTRY section's closing `</div>`. (Search + track row stay always-visible.)

- [ ] **Step 4: Run → pass + build**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx && npm run build`
Expected: PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reviewer/v2/ReviewerQueue.jsx frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx
git commit -m "feat(reviewer): collapse queue filters behind a Filters toggle button"
```
(No AI/Claude/Anthropic/Co-Authored-By in any commit message.)

---

## Task 2: AdminGate1 — remove Cutoff + Waitlist + HOLD, fix approve-email, batch row-click

All edits in `frontend/src/pages/admin/platform/screens/AdminGate1.jsx`. Read the file first.

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminGate1.jsx`
- Test (new): `frontend/src/pages/admin/platform/screens/__tests__/AdminGate1.wiring.test.jsx`

- [ ] **Step 1: Write the failing test** (pure-logic + mapping assertions — avoids rendering the heavy screen):

```jsx
// frontend/src/pages/admin/platform/screens/__tests__/AdminGate1.wiring.test.jsx
import { describe, it, expect } from "vitest";
import { UPPER_TO_WIRE } from "../AdminGate1.jsx";

describe("AdminGate1 decision mapping", () => {
  it("maps batch Approve to jury_review (so the applicant email fires)", () => {
    expect(UPPER_TO_WIRE.APPROVED).toBe("jury_review");
  });
  it("no longer carries a HOLD mapping", () => {
    expect(UPPER_TO_WIRE.HOLD).toBeUndefined();
  });
});
```

This requires exporting `UPPER_TO_WIRE` (Step 3a).

- [ ] **Step 2: Run → fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminGate1.wiring.test.jsx`
Expected: FAIL — `UPPER_TO_WIRE` isn't exported / `APPROVED` is `"shortlisted"` / `HOLD` exists.

- [ ] **Step 3: Edit `AdminGate1.jsx`**

(a) **Fix + export `UPPER_TO_WIRE`** (lines 43-48). Replace:
```jsx
const UPPER_TO_WIRE = {
  APPROVED:   "shortlisted",
  HOLD:       "on_hold",
  REJECTED:   "rejected",
  WAITLISTED: "waitlisted",
};
```
with:
```jsx
export const UPPER_TO_WIRE = {
  APPROVED: "jury_review", // = "advance to jury"; the decision that emails the applicant
  REJECTED: "rejected",
};
```

(b) **Remove the Cutoff variant.** Delete the `GateReviewCutoff` function component (≈lines 367-493). Then in the tab bar + render switch (≈860-879):
- Delete the Cutoff tab: `<div className={"os-tab " + (variant === "cutoff" ? "active" : "")} onClick={() => setVariant("cutoff")}>B · Cutoff slider</div>`
- Re-letter the remaining tab labels: `A · Status`, `B · Batch decision`, `C · My history`:
```jsx
        <div className={"os-tab " + (variant === "stack"   ? "active" : "")} onClick={() => setVariant("stack")}>A · Status</div>
        <div className={"os-tab " + (variant === "batch"   ? "active" : "")} onClick={() => setVariant("batch")}>B · Batch decision</div>
        <div className={"os-tab " + (variant === "history" ? "active" : "")} onClick={() => setVariant("history")}>C · My history</div>
```
- Delete the `variant === "cutoff"` branch from the render switch:
```jsx
      ) : variant === "cutoff" ? (
        <GateReviewCutoff  key={"cutoff-"  + evalRows.length} items={evalRows} reload={reload} />
```
- If `partitionByCutoff` (an exported test helper) is now unused, leave the export (harmless) OR remove it together with its test. Leaving it is fine.

(c) **Remove the Waitlist tally** in Variant A (`GateReviewStack`, line 271). Replace:
```jsx
            {[["Approve", counts.approve, "#2F6F62"], ["Waitlist", counts.waitlist, "#FFB703"], ["Reject", counts.reject, "#FF5A5F"]].map(([label, n, c]) => (
```
with:
```jsx
            {[["Approve", counts.approve, "#2F6F62"], ["Reject", counts.reject, "#FF5A5F"]].map(([label, n, c]) => (
```

(d) **Variant C — remove the HOLD button** (line 636). Delete the line:
```jsx
                      <button className={"os-reco-btn waitlist " + (draft === "HOLD" ? "active" : "")} disabled={busy} onClick={() => handleDraftSelect(s.id, "HOLD")} style={{ padding: "4px 10px", fontSize: 11, flex: 1 }}>Hold</button>
```

(e) **Variant C — make rows open the detail.** Add `goDetail` to the component signature:
```jsx
function GateReviewBatchDecision({ items, reload }) {
```
→
```jsx
function GateReviewBatchDecision({ items, reload, goDetail }) {
```
Pass it from the parent render switch (≈876):
```jsx
        <GateReviewBatchDecision key={"batch-" + evalRows.length} items={evalRows} reload={reload} goDetail={goDetail} />
```
Make each `<tr>` clickable — replace `<tr key={s.id}>` (line 619) with:
```jsx
                <tr
                  key={s.id}
                  onClick={(e) => {
                    if (e.target.closest("button") || e.target.closest("a")) return;
                    if (goDetail) goDetail(s.id, s.track, "gate1");
                  }}
                  style={{ cursor: "pointer" }}
                >
```

- [ ] **Step 4: Run → pass + build**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminGate1.wiring.test.jsx && npm run build`
Expected: 2 tests PASS; build clean (no reference to the deleted `GateReviewCutoff`/`cutoff`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminGate1.jsx frontend/src/pages/admin/platform/screens/__tests__/AdminGate1.wiring.test.jsx
git commit -m "feat(admin): admin-review cleanup — drop cutoff/waitlist/hold, batch approve emails, batch rows open detail"
```

---

## Task 3: adminDataAdapter — surface reviewer flags

**Files:**
- Modify: `frontend/src/lib/adminDataAdapter.js`
- Test: `frontend/src/lib/__tests__/adminDataAdapter.test.js` (append)

- [ ] **Step 1: Append failing tests:**

```jsx
describe("reviewer flags surfacing", () => {
  it("adaptPipelineRow passes backend flags through", () => {
    expect(adaptPipelineRow({ id: "a", flags: ["f1", "f2"] }).flags).toEqual(["f1", "f2"]);
    expect(adaptPipelineRow({ id: "b" }).flags).toEqual([]);
  });
  it("adaptDetail aggregates flags from submitted reviews", () => {
    const d = { id: "x", reviews: [
      { submitted_at: "2026-06-01", flags: ["late"] },
      { submitted_at: "2026-06-02", flags: ["dup", "thin"] },
    ] };
    expect(adaptDetail(d).flags).toEqual(["late", "dup", "thin"]);
  });
});
```
(Ensure `adaptPipelineRow` + `adaptDetail` are imported at the top of the test file.)

- [ ] **Step 2: Run → fail**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminDataAdapter.test.js`
Expected: FAIL — `adaptPipelineRow` hardcodes `flags: []`; `adaptDetail` hardcodes `flags: []`.

- [ ] **Step 3: Edit `adminDataAdapter.js`**

In `adaptPipelineRow`, replace `flags: [],` (line 31) with:
```js
    flags: Array.isArray(row.flags) ? row.flags : [],
```
In `adaptDetail`, replace `flags: [],` (line 135) with:
```js
    flags: reviews.flatMap((r) => (Array.isArray(r.flags) ? r.flags : [])),
```
(`reviews` in `adaptDetail` is the already-adapted submitted-review array via `adaptOneReview`, which preserves each review's `flags`.)

- [ ] **Step 4: Run → pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminDataAdapter.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/adminDataAdapter.js frontend/src/lib/__tests__/adminDataAdapter.test.js
git commit -m "feat(admin): surface reviewer flags in pipeline rows + application detail"
```

---

## Task 4: AdminDetail — remove the Reviewer-Assignment panel

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminDetail.jsx`

(No unit test — verified by build/grep; the page fetches on mount.)

- [ ] **Step 1: Remove the render usage.** Delete this block (≈lines 702-713):
```jsx
          {/* Reviewer Assignment */}
          <ReviewerAssignmentCard
            id={s.id}
            track={track}
            assignments={
              (s.reviewerAssignments && s.reviewerAssignments.length)
                ? s.reviewerAssignments
                : (s.assignedReviewers || []).map(rid => ({ reviewer_user_id: rid }))
            }
            onReload={doLoad}
            setBanner={setBanner}
          />
```

- [ ] **Step 2: Remove the component definition.** Delete the entire `function ReviewerAssignmentCard({ id, track, assignments, onReload, setBanner }) { … }` definition (≈lines 128-253).

- [ ] **Step 3: Clean up now-dead imports.** Grep and remove anything used ONLY by that card:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
grep -nE "ReviewerAssignmentCard|reviewerNameOf|reviewerStatusLabel|leadershipApi\.(assignReviewers|unassignReviewer)" frontend/src/pages/admin/platform/screens/AdminDetail.jsx
```
- `ReviewerAssignmentCard` → 0 matches expected.
- If `reviewerNameOf` / `reviewerStatusLabel` (from `lib/reviewerStatus`) are now unused, remove them from that import. If `leadershipApi` is still used elsewhere (it is — `FullApplication` signedUrl), keep its import; only its `assignReviewers`/`unassignReviewer` calls lived in the card.

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: clean (no undefined `ReviewerAssignmentCard`; no unused-import errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminDetail.jsx
git commit -m "feat(admin): remove the reviewer-assignment panel from application detail"
```

---

## Task 5: Backend — pipeline reviewer-flags aggregation + remove-guard relaxation

**Files:**
- Modify: `backend/app/services/admin_query.py`
- Test: `backend/tests/` (the admin_query/admin_platform test file)

- [ ] **Step 1: Write/adjust failing tests.** In the admin_query test file (find it: `ls backend/tests | grep -iE "admin"`), add tests asserting:
  1. `fetch_pipeline` rows include a `flags` list aggregated from the apps' submitted reviews (seed a fake review with `flags: ["x"]` for an app and assert that app's pipeline row `flags == ["x"]`).
  2. `bulk_remove_reviewer_apps` returns `status: "removed"` (NOT `skipped_submitted`) for an app whose reviewer already submitted a review.
  Match the file's existing fixture/fake-client patterns (read neighboring tests first).

- [ ] **Step 2: Run → fail**

Run: `cd backend && python -m pytest backend/tests -k "pipeline_flags or remove" -q` (adjust `-k` to your test names)
Expected: FAIL.

- [ ] **Step 3a: `fetch_pipeline` flag aggregation.** In `admin_query.fetch_pipeline`, after the existing bulk-fetches (scores / project_names / industry / batch), add a bulk fetch of submitted-review flags keyed exactly like `scores`/`project_names` (same `key`, i.e. the `(track, application_id)` tuple this function already uses). Mirror the existing bulk-fetch style. Then add `"flags"` to each `out_items.append({...})`:
```python
            "flags":            flags_by_key.get(key, []),
```
Where `flags_by_key[key]` is the concatenation (union) of `reviews.flags` for that application's submitted reviews. Sketch of the aggregation (adapt to the file's client/query style — one query per track like the other bulk fetches):
```python
    # Reviewer flags per application (union of each app's submitted reviews' flags).
    flags_by_key: dict[tuple[str, str], list] = {}
    for track in tracks_in_page:                      # however the fn iterates tracks
        rows = (sb.table("reviews").select("application_id,application_track,flags,submitted_at")
                .eq("application_track", track)
                .in_("application_id", ids_for_track).execute().data) or []
        for rv in rows:
            if not rv.get("submitted_at"):
                continue
            fl = rv.get("flags")
            if isinstance(fl, list) and fl:
                k = (rv.get("application_track"), rv.get("application_id"))
                flags_by_key.setdefault(k, []).extend(fl)
```
Use the SAME key construction the function already uses for `scores.get(key)` (check whether `key` is `(track, id)` or `(id, track)` and match it exactly).

- [ ] **Step 3b: Relax the remove-guard** in `bulk_remove_reviewer_apps`. Remove the submitted-review skip so every item proceeds to delete the assignment. Replace the guard block:
```python
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
```
with (drop the `submitted` set + the skip branch — keep the delete; the review row itself is left intact for audit, only the assignment is removed):
```python
    sb = get_admin_client()
    # 2026-06-29: admins may unassign an application even when the reviewer has
    # already submitted a review (the review row is left intact for audit; only
    # the reviewer_assignment is deleted).
    results: list[dict[str, Any]] = []
    for it in items:
        aid = it.get("application_id")
        track = it.get("track")
        try:
```
(The rest of the loop — the `reviewer_assignments` delete + `removed`/`not_found`/`error` results — stays unchanged.)

- [ ] **Step 4: Run → pass**

Run: `cd backend && python -m pytest backend/tests -k "pipeline_flags or remove" -q` then the broader admin_query test file.
Expected: new tests PASS; no NEW failures vs baseline (ignore the pytest-cov "70%" line + the ~19 unrelated pre-existing failures).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/admin_query.py backend/tests/
git commit -m "feat(admin): pipeline reviewer-flag aggregation + allow unassigning reviewed apps"
```

---

## Task 6: Full verification + data fix + email test + deploy

**Files:** none (verification / ops)

- [ ] **Step 1: Full suites + build**

```bash
cd frontend && CI=true npx vitest run && npm run build
cd ../backend && python -m pytest -q
```
Expected: frontend green; backend green except baseline pre-existing failures.

- [ ] **Step 2: Backend SAM deploy** — from the worktree:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
grep -E "TIR_SUBMISSIONS_CLOSED|SIP_SUBMISSIONS_CLOSED" backend/.env.prod   # both MUST be true
aws sts get-caller-identity --query Arn --output text                       # expect artpark-deploy-admin
bash infra/sam/deploy-prod.sh
curl -s https://api.artpark.info/health/ready
```
Expected: deploy succeeds, intake stays closed, health ok.

- [ ] **Step 3: Prod data fix — revert EV Battery Circularity waitlist.** Using `backend/.env.prod` Supabase service-role creds (do NOT print the key), via PostgREST:
  - Find the app: `GET /rest/v1/sip_applications?... or tir_applications?...` — EV Battery Circularity is a TIR app (Image shows "EV Mobility & Services", Batch A, score 8.5). Locate its id + current status (`waitlisted`).
  - Delete/clear its gate1 `admin_decisions` row: `DELETE /rest/v1/admin_decisions?application_id=eq.<id>&decision=eq.waitlisted` (or update to a reverted state — match how a "revert" is represented; simplest: delete the waitlisted admin_decisions row(s) for that app).
  - Set the application status back to `evaluated`: `PATCH /rest/v1/tir_applications?id=eq.<id>` body `{"status":"evaluated"}`.
  - Also append an `application_status_log` row if the codebase expects history continuity (optional; note if skipped).
  Verify the app no longer shows WAITLISTED in admin history.

- [ ] **Step 4: Email smoke test** (Changes 4 + 6). Seed a throwaway evaluated application whose applicant resolves to `udayanpawar03@gmail.com`:
  - First determine how `decision_email.notify_applicant_decided` resolves the recipient (auth email via `user_lookup` vs `basic_email`) — read it. Seed accordingly (set the owner's auth email and/or `basic_email` to `udayanpawar03@gmail.com`).
  - Create a minimal evaluated app row (status `evaluated`) tied to that recipient.
  - From Admin Review (live prod, after frontend promote — OR call the API directly with an admin token), record an **Approve** (→ jury_review) on it and confirm the "advanced to jury" email arrives at udayanpawar03@gmail.com (check Resend dashboard / CloudWatch httpx logs). Repeat with **Reject** (→ rejected) on a second seeded row.
  - **Clean up** the seeded test app row(s) afterward.
  - Report whether both emails fired.

- [ ] **Step 5: Push frontend**

```bash
git push origin release/sip-launch-v1
```
Then the user promotes the new build on Vercel.

- [ ] **Step 6: Post-deploy visual checklist** — reviewer queue shows a "Filters" button that reveals Status/Stage/Industry; Admin Review tabs are A·Status / B·Batch decision / C·My history (no Cutoff); Live Decisions shows only Approve/Reject; batch DRAFT DECISION has only Approve/Reject; batch + history FLAGS columns + detail "Flags Raised" populate where reviewers raised flags; batch-decision rows open the detail; admin detail has no Reviewer-Assignment panel; Manage→Remove unassigns a reviewed app.

---

## Notes / invariants

- `relabelDisplayId` / track logic untouched; `s.track`/`s.id` stay raw.
- `UPPER_TO_WIRE.APPROVED` MUST be `jury_review` (the email-triggering decision) — consistent with Variant A + AdminDetail's `BUTTON_TO_DECISION.approve`.
- Backend flag aggregation must key flags EXACTLY like the existing `scores`/`project_names` maps in `fetch_pipeline` (verify `(track,id)` vs `(id,track)`).
- Removing the remove-guard deletes only `reviewer_assignments`; the `reviews` row is kept for audit.
- Tasks 5 is BACKEND → SAM deploy (Task 6). Flags display (Tasks 2/3 read `s.flags`) only populates once Task 5 backend is deployed.
- Use `fireEvent`, never `@testing-library/user-event`. No AI attribution in commits.
