# Reviewer + Admin consistency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reviewer SIP→VIP IDs, remove the Due column, let reviewers edit reviews anytime, and make the reviewer + admin "view full application" render exactly like leadership (files/video as clickable links).

**Architecture:** Frontend React/Vite + FastAPI backend. Reuse `relabelDisplayId`; remove the 60-min review lock (backend 423 + frontend gates); make leadership's schema-driven `ApplicationTab` reusable via a `signedUrl` prop + a shared `<FullApplication>` component consumed by reviewer + admin, with a new assignment-guarded reviewer signed-URL endpoint.

**Tech Stack:** React 18, Vite, Vitest + @testing-library/react (use `fireEvent`, NOT `@testing-library/user-event` — unresolved in repo). FastAPI, pytest.

**Branch:** worktree on `release/sip-launch-v1` (spec commit `7bc5daa`). Commit per task. **Backend SAM deploy required** (Tasks 3 & 6). No DB migration. Spec: `docs/superpowers/specs/2026-06-29-reviewer-admin-consistency-design.md`.

**Pre-existing test notes:** frontend `FileGridAnswer.test.jsx` historically flaky on a missing dep (currently passing); backend has ~19 unrelated pre-existing failures. Don't fix those.

**Change #2 (filters):** NO code change — the reviewer queue filter+clear bar already exists; it surfaces on deploy. Covered by the final deploy task only.

---

## Task 1: Reviewer queue + CSV — VIP IDs + remove Due (changes 1 & 3)

**Files:**
- Modify: `frontend/src/pages/reviewer/v2/ReviewerQueue.jsx`
- Modify: `frontend/src/pages/reviewer/v2/ReviewerPortal.jsx`
- Test: `frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewerQueue from "../ReviewerQueue.jsx";

const queueAsync = {
  data: [
    {
      id: "id-sip-1", applicationId: "SIP-26623", track: "sip",
      name: "STHANUS Breast Ultrasound", founders: ["Banhimitra Kundu"],
      industry: "Healthcare / MedTech", stage: "Pre-revenue",
      ai: { overall: 8.6 }, myScore: 8.7, reviewStatus: "draft", due: null,
    },
  ],
  loading: false, error: null, reload: () => {},
};

describe("ReviewerQueue", () => {
  it("relabels SIP display IDs to VIP", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={queueAsync} />);
    expect(screen.getAllByText(/VIP-26623/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/SIP-26623/)).not.toBeInTheDocument();
  });
  it("does not render a Due column header", () => {
    render(<ReviewerQueue onOpen={() => {}} queueAsync={queueAsync} />);
    expect(screen.queryByRole("columnheader", { name: /^Due$/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx`
Expected: FAIL — IDs still render `SIP-26623`; a "Due" columnheader still exists.

- [ ] **Step 3: Edit `ReviewerQueue.jsx`**

(a) Add the import after the `ui.jsx` import:
```jsx
import { relabelDisplayId } from "../../../lib/trackLabel.js";
```

(b) Delete the `fmtDue` helper (lines 13-18):
```jsx
function fmtDue(due) {
  if (!due) return "—";
  const d = new Date(due);
  if (isNaN(d.getTime())) return String(due);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
```

(c) Remove the Due `<th>` — delete this line from the `<thead>`:
```jsx
              <th style={{ width: "4%" }}>Due</th>
```

(d) Relabel the project sub-label ID (in the Project `<td>`):
```jsx
                    {s.applicationId} · {s.track === "tir" ? "TIR" : "VIP"}
```
→
```jsx
                    {relabelDisplayId(s.applicationId)} · {s.track === "tir" ? "TIR" : "VIP"}
```

(e) Remove the Due `<td>` — delete this line:
```jsx
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{fmtDue(s.due)}</td>
```

(f) Relabel the ID `<td>`:
```jsx
                <td style={{ fontFamily: "var(--font-code)", fontSize: 11, color: "var(--ink-dim)" }}>{s.applicationId}</td>
```
→
```jsx
                <td style={{ fontFamily: "var(--font-code)", fontSize: 11, color: "var(--ink-dim)" }}>{relabelDisplayId(s.applicationId)}</td>
```

(g) Fix the `colSpan` on the loading/error/empty rows — there are three `colSpan="9"` occurrences; change each to `colSpan="8"` (one column removed).

- [ ] **Step 4: Edit `ReviewerPortal.jsx`** (CSV export, the `exportReviewerQueueCsv` function ~lines 77-112)

(a) Add the import near the top of the file (with the other lib imports):
```jsx
import { relabelDisplayId } from "../../../lib/trackLabel.js";
```

(b) Remove `"Due"` from the headers:
```jsx
  const headers = ["ID", "Project", "Founders", "Industry", "Stage", "Track", "AI Score", "Status", "Due"];
```
→
```jsx
  const headers = ["ID", "Project", "Founders", "Industry", "Stage", "Track", "AI Score", "Status"];
```

(c) In the `rows` mapping: relabel the ID and drop the `s.due` trailing entry:
```jsx
  const rows = queue.map((s) => [
    s.applicationId,
    s.name,
    (s.founders || []).join("; "),
    s.industry,
    s.stage,
    s.track === "tir" ? "TIR" : "VIP",
    s.ai && s.ai.overall != null ? Number(s.ai.overall).toFixed(1) : "",
    STATUS_LABEL[s.reviewStatus] || "",
    s.due || "",
  ]);
```
→
```jsx
  const rows = queue.map((s) => [
    relabelDisplayId(s.applicationId),
    s.name,
    (s.founders || []).join("; "),
    s.industry,
    s.stage,
    s.track === "tir" ? "TIR" : "VIP",
    s.ai && s.ai.overall != null ? Number(s.ai.overall).toFixed(1) : "",
    STATUS_LABEL[s.reviewStatus] || "",
  ]);
```

- [ ] **Step 5: Run test + build**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx && npm run build`
Expected: 2 tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/reviewer/v2/ReviewerQueue.jsx frontend/src/pages/reviewer/v2/ReviewerPortal.jsx frontend/src/pages/reviewer/v2/__tests__/ReviewerQueue.test.jsx
git commit -m "feat(reviewer): VIP display IDs in queue+CSV, remove Due column"
```
(Commit messages must NOT contain any AI/Claude/Anthropic/Co-Authored-By reference.)

---

## Task 2: Reviewer history — Edit enabled anytime (change 4, frontend history)

**Files:**
- Modify: `frontend/src/pages/reviewer/v2/ReviewerHistory.jsx`
- Test: `frontend/src/pages/reviewer/v2/__tests__/ReviewerHistory.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/reviewer/v2/__tests__/ReviewerHistory.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../lib/reviewerApi.js", () => ({
  reviewerApi: {
    getHistory: () =>
      Promise.resolve({
        rows: [
          {
            reviewId: "rv1", name: "Cognitive Warfare AI", date: "2026-06-27T00:00:00Z",
            myScore: 2.1, reco: "no", adminDecision: "rejected", track: "tir", appId: "id1",
            // edit window already expired (1 hour ago):
            editWindowExpiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
          },
        ],
      }),
  },
}));

import ReviewerHistory from "../ReviewerHistory.jsx";

describe("ReviewerHistory edit-anytime", () => {
  it("enables Edit even when the edit window has expired", async () => {
    render(<ReviewerHistory onOpenEval={() => {}} />);
    const btn = await screen.findByRole("button", { name: /Edit/i });
    expect(btn).not.toBeDisabled();
  });
});
```

NOTE: the mock path is relative to the TEST file. `ReviewerHistory.jsx` imports `reviewerApi` from `"../../../lib/reviewerApi.js"`; from the `__tests__/` folder that resolves to `"../../../../lib/reviewerApi.js"`. Verify the import path the component actually uses and mock THAT exact specifier.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/ReviewerHistory.test.jsx`
Expected: FAIL — the Edit button is disabled because `editWindowExpiresAt` is in the past.

- [ ] **Step 3: Edit `ReviewerHistory.jsx`**

Remove the time gate. Delete the `now` line:
```jsx
  const now = Date.now();
```
Replace the per-row gate:
```jsx
              const expires = h.editWindowExpiresAt ? new Date(h.editWindowExpiresAt).getTime() : 0;
              const editable = expires > now;
              const adminDec = h.adminDecision || "pending";
```
with:
```jsx
              const adminDec = h.adminDecision || "pending";
```
Replace the Edit button block:
```jsx
                    <button
                      className="os-btn sm ghost"
                      disabled={!editable}
                      title={editable ? "Edit this evaluation" : "Edit window has closed"}
                      onClick={() => editable && onOpenEval(h.track, h.appId)}
                    >
                      ✎ Edit
                    </button>
```
with:
```jsx
                    <button
                      className="os-btn sm ghost"
                      title="Edit this evaluation"
                      onClick={() => onOpenEval(h.track, h.appId)}
                    >
                      ✎ Edit
                    </button>
```
Also update the file's top comment (lines 4-5) that mentions the 60-min window so it reads that edit is always available.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/ReviewerHistory.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reviewer/v2/ReviewerHistory.jsx frontend/src/pages/reviewer/v2/__tests__/ReviewerHistory.test.jsx
git commit -m "feat(reviewer): allow editing a submitted review from history anytime"
```

---

## Task 3: Backend — remove the 60-min review edit lock (change 4, backend)

**Files:**
- Modify: `backend/app/routers/reviewer.py` (PATCH `/reviews/{review_id}` handler, ~lines 513-524)
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Add/adjust the failing test**

Open `backend/tests/test_reviewer.py`. Find the existing test that asserts a PATCH after the lock window returns **423** (search for `423` / `review_locked`). Change it so editing after the window now SUCCEEDS (assert the response is NOT 423 — e.g. 200, matching how the other successful-PATCH tests assert). If no such test exists, add one modeled on the existing successful-PATCH test but with the review's `locked_at` set to a past timestamp, asserting the response status is not 423. Match the file's existing fixtures/fake-client patterns.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_reviewer.py -k "lock or 423 or edit" -q`
Expected: FAIL (the handler still 423s after the window).

- [ ] **Step 3: Edit `reviewer.py`** — remove the lock-expiry rejection in the PATCH handler. Delete this block (~lines 512-524):

```python
    # Lock check — only meaningful for already-submitted (non-draft) reviews
    locked_at_str = existing.get("locked_at")
    if locked_at_str:
        locked_at = datetime.fromisoformat(locked_at_str.replace("Z", "+00:00"))
        # Strict `>` so a PATCH at the exact instant is still allowed
        if datetime.now(UTC) > locked_at:
            raise HTTPException(
                status_code=http_status.HTTP_423_LOCKED,
                detail={
                    "code": "review_locked",
                    "message": f"Edit window closed at {locked_at.isoformat()}.",
                },
            )
```

Replace it with a short comment (keep the surrounding code intact):
```python
    # Edit lock removed (2026-06-29): reviewers may edit a submitted review at
    # any time. `locked_at` is still stamped on submit (used only for display).
```

If `datetime`, `UTC`, or `http_status` become unused after this deletion, leave them — they are used elsewhere in the file. (Do not remove imports without grepping first.)

- [ ] **Step 4: Run test + suite**

Run: `cd backend && python -m pytest tests/test_reviewer.py -q`
Expected: the edited/added lock test PASSES; no NEW failures vs the pre-existing baseline.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): remove 60-minute review edit lock (edit anytime)"
```

---

## Task 4: Reviewer eval — remove the lock countdown UI (change 4, eval screen)

**Files:**
- Modify: `frontend/src/pages/reviewer/v2/ReviewerEval.jsx`

(No new unit test — the eval screen is integration-heavy; verified by build + the History/backend tests. The reviewer can now re-open + save anytime.)

- [ ] **Step 1: Make the form always editable.** In `ReviewerEvalForm`, change:
```jsx
  const expired = expiryMs != null && now > expiryMs;
```
to:
```jsx
  const expired = false; // edit lock removed 2026-06-29 — reviewers edit anytime
```

- [ ] **Step 2: Always allow re-open.** Find the "Re-open to edit" button guarded by `{!expired && (...)}` (~line 522-524):
```jsx
                {!expired && (
                  <button className="os-btn" onClick={reopenForEdit}>Re-open to edit</button>
                )}
```
Replace with (always show it):
```jsx
                <button className="os-btn" onClick={reopenForEdit}>Re-open to edit</button>
```

- [ ] **Step 3: Drop the "Edit window …" status text.** Find the block (~line 514-517) that renders `{expired ? "Edit window closed" : \`Edit window: … min remaining\`}` and remove that element entirely (it's the countdown line shown while `editable`). Leave the autosave "saved/saving" indicator next to it intact. If removing it leaves `secondsLeft` unused, also remove the `secondsLeft` computation; if `now`/`expiresAt`/the tick effect become unused, remove them too — but grep first (`expiresAt` is still set from PATCH responses at lines ~422/428/442; those setters can stay as harmless no-ops, OR remove them for cleanliness if straightforward). The 423 handler at ~line 407 can stay (defensive; backend no longer 423s).

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds (no unused-var build errors — Vite/esbuild won't fail on unused vars, but keep it tidy).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reviewer/v2/ReviewerEval.jsx
git commit -m "feat(reviewer): drop eval edit-window countdown (edit anytime)"
```

---

## Task 5: Make leadership's renderer reusable via a `signedUrl` prop (change 5a)

**Files:**
- Modify: `frontend/src/pages/leadership/review/answers/FileGridAnswer.jsx`
- Modify: `frontend/src/pages/leadership/review/QuestionBlock.jsx`
- Modify: `frontend/src/pages/leadership/review/SectionBlock.jsx`
- Modify: `frontend/src/pages/leadership/review/ApplicationTab.jsx`
- Modify: `frontend/src/pages/leadership/ReviewApplicationPage.jsx`
- Test (new): `frontend/src/pages/leadership/review/answers/__tests__/FileGridAnswer.signedurl.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/leadership/review/answers/__tests__/FileGridAnswer.signedurl.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FileGridAnswer from "../FileGridAnswer.jsx";

describe("FileGridAnswer signedUrl prop", () => {
  it("calls the injected signedUrl fn (not a hardcoded api) on download", async () => {
    const signedUrl = vi.fn().mockResolvedValue({ url: "https://example.test/file.pdf" });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <FileGridAnswer
        applicationId="app-1"
        signedUrl={signedUrl}
        value={[{ name: "deck.pdf", storage_path: "app-1/pitch-deck/x.pdf", size: 1234 }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Download/i }));
    await waitFor(() => expect(signedUrl).toHaveBeenCalledWith("app-1", "app-1/pitch-deck/x.pdf"));
    openSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/leadership/review/answers/__tests__/FileGridAnswer.signedurl.test.jsx`
Expected: FAIL — `FileGridAnswer` ignores a `signedUrl` prop and calls `leadershipApi.fileSignedUrl` directly.

- [ ] **Step 3: Edit `FileGridAnswer.jsx`** — accept `signedUrl` prop; drop the direct import.

Remove the import:
```jsx
import { leadershipApi } from "../../../../lib/leadershipApi.js";
```
Change the signature:
```jsx
export default function FileGridAnswer({ value, applicationId }) {
```
→
```jsx
export default function FileGridAnswer({ value, applicationId, signedUrl }) {
```
Change the call inside `handleDownload` (and its `useCallback` deps):
```jsx
        const res = await leadershipApi.fileSignedUrl(applicationId, storagePath);
```
→
```jsx
        const res = await signedUrl(applicationId, storagePath);
```
Update the `useCallback` dependency array at the end of `handleDownload` from `[applicationId]` to `[applicationId, signedUrl]`. Also guard the button-disabled checks: where it checks `!applicationId`, also require `signedUrl` — change `disabled={isBusy || !hasPath || !applicationId}` to `disabled={isBusy || !hasPath || !applicationId || !signedUrl}` (and the matching `aria-disabled`). Update the file's header comment to say the signing fn is injected.

- [ ] **Step 4: Thread the prop through the three parents.**

`QuestionBlock.jsx` — change `renderAnswer` to accept + use `signedUrl`, and the component signature:
```jsx
function renderAnswer(question, application, applicationId) {
```
→
```jsx
function renderAnswer(question, application, applicationId, signedUrl) {
```
In the `files`/`file` case:
```jsx
      return <FileGridAnswer value={value} applicationId={applicationId} />;
```
→
```jsx
      return <FileGridAnswer value={value} applicationId={applicationId} signedUrl={signedUrl} />;
```
Component signature + call:
```jsx
export default function QuestionBlock({ question, application, applicationId }) {
```
→
```jsx
export default function QuestionBlock({ question, application, applicationId, signedUrl }) {
```
```jsx
      {renderAnswer(question, application, applicationId)}
```
→
```jsx
      {renderAnswer(question, application, applicationId, signedUrl)}
```

`SectionBlock.jsx`:
```jsx
export default function SectionBlock({ section, totalSections, application, applicationId }) {
```
→
```jsx
export default function SectionBlock({ section, totalSections, application, applicationId, signedUrl }) {
```
```jsx
          <QuestionBlock
            key={q.key}
            question={q}
            application={application}
            applicationId={applicationId}
          />
```
→
```jsx
          <QuestionBlock
            key={q.key}
            question={q}
            application={application}
            applicationId={applicationId}
            signedUrl={signedUrl}
          />
```

`ApplicationTab.jsx`:
```jsx
export default function ApplicationTab({ schema, application, applicationId }) {
```
→
```jsx
export default function ApplicationTab({ schema, application, applicationId, signedUrl }) {
```
```jsx
        <SectionBlock
          key={section.section_number}
          section={section}
          totalSections={schema.length}
          application={application}
          applicationId={applicationId}
        />
```
→
```jsx
        <SectionBlock
          key={section.section_number}
          section={section}
          totalSections={schema.length}
          application={application}
          applicationId={applicationId}
          signedUrl={signedUrl}
        />
```

- [ ] **Step 5: Keep leadership working** — `ReviewApplicationPage.jsx` must pass its signing fn. Add the import if missing (it already imports `leadershipApi`). Change the `<ApplicationTab ... />` usage:
```jsx
                {tab === "application" && (
                  <ApplicationTab
                    schema={schema}
                    application={application}
                    applicationId={id}
                  />
                )}
```
→
```jsx
                {tab === "application" && (
                  <ApplicationTab
                    schema={schema}
                    application={application}
                    applicationId={id}
                    signedUrl={(appId, path) => leadershipApi.fileSignedUrl(appId, path)}
                  />
                )}
```

- [ ] **Step 6: Run tests + build**

Run: `cd frontend && npx vitest run src/pages/leadership/review/answers/__tests__/ && npm run build`
Expected: the new test PASSES; the existing `FileGridAnswer.test.jsx` — if it renders without a `signedUrl` prop and expects `leadershipApi`, UPDATE it to pass a `signedUrl` mock prop (the component no longer imports `leadershipApi`). Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/leadership/review/answers/FileGridAnswer.jsx frontend/src/pages/leadership/review/QuestionBlock.jsx frontend/src/pages/leadership/review/SectionBlock.jsx frontend/src/pages/leadership/review/ApplicationTab.jsx frontend/src/pages/leadership/ReviewApplicationPage.jsx frontend/src/pages/leadership/review/answers/__tests__/
git commit -m "refactor(leadership): inject signedUrl into ApplicationTab renderer (reusable)"
```

---

## Task 6: Shared `<FullApplication>` component (change 5b)

**Files:**
- Create: `frontend/src/components/FullApplication.jsx`
- Test (new): `frontend/src/components/__tests__/FullApplication.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/components/__tests__/FullApplication.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FullApplication from "../FullApplication.jsx";

describe("FullApplication", () => {
  it("renders schema-driven sections from the raw application row", () => {
    const application = {
      problem_describe: "A clear and pressing problem statement here.",
      declaration_truthful: true,
    };
    render(
      <FullApplication
        track="tir"
        application={application}
        applicationId="app-1"
        signedUrl={vi.fn()}
      />,
    );
    expect(screen.getByText(/A clear and pressing problem statement/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/FullApplication.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/FullApplication.jsx`**

```jsx
// FullApplication — schema-driven read-only render of one application,
// reused by leadership (inline), the reviewer eval screen, and the admin
// detail screen so all three render identically. Thin wrapper over the
// leadership ApplicationTab + applicationSchemas; the caller injects a
// `signedUrl(applicationId, storagePath) => Promise<{url}>` function so each
// surface uses its own (authorised) signed-URL endpoint for file downloads.

import ApplicationTab from "../pages/leadership/review/ApplicationTab.jsx";
import { schemaFor } from "../pages/leadership/applicationSchemas.js";
import "../styles/review-application.css";

export default function FullApplication({ track, application, applicationId, signedUrl }) {
  return (
    <ApplicationTab
      schema={schemaFor(track)}
      application={application}
      applicationId={applicationId}
      signedUrl={signedUrl}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/FullApplication.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FullApplication.jsx frontend/src/components/__tests__/FullApplication.test.jsx
git commit -m "feat: shared FullApplication component (leadership renderer, injectable signing)"
```

---

## Task 7: Backend — reviewer `application` payload + signed-URL endpoint (change 5e backend)

**Files:**
- Modify: `backend/app/routers/reviewer.py`
- Test: `backend/tests/test_reviewer.py`

- [ ] **Step 1: Add the `application` key to the content response.** In `get_application_content`, in the returned dict, add `"application": app_row,` (the row is already in scope as `app_row`). Place it near the top of the dict, e.g. after `"track": track,`.

- [ ] **Step 2: Add the reviewer signed-URL endpoint.** Append this handler in `reviewer.py` (near the other application routes). Confirm imports at the top of the file include `Query` from fastapi (`from fastapi import ..., Query`) — add it if missing; `applications_query` (`from ..services import applications_query` or the module's existing import style — match how `reviewer_query`/`review_presenter` are imported); `get_admin_client` (already imported, used by the content endpoint).

```python
@router.get(
    "/applications/{track}/{application_id}/files/signed-url",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_reviewer_file_signed_url(
    track: Literal["tir", "sip"],
    application_id: str,
    storage_path: str = Query(..., min_length=1),
    user: dict = Depends(get_current_user),
) -> dict:
    """Short-lived signed URL for one of an assigned application's files.

    Reviewers don't hold `view_app_detail`, so they can't use the leadership
    endpoint. Authorisation here = the SAME assignment check as the content
    endpoint (`fetch_application_for_reviewer` returns None when unassigned),
    plus a path allow-list rebuilt from the application's own file fields.
    404 (not 403) on unassigned / unknown path — no enumeration.
    """
    if ".." in storage_path:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_storage_path"},
        )
    payload = reviewer_query.fetch_application_for_reviewer(
        user["user_id"], track, application_id,
    )
    if payload is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    app_row = payload["application"]
    allowed = applications_query.collect_application_file_paths(track, app_row)
    bucket = allowed.get(storage_path)
    if bucket is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "file_not_found"})
    try:
        signed = (get_admin_client()
                  .storage.from_(bucket)
                  .create_signed_url(storage_path, 120))
        url = None
        if isinstance(signed, dict):
            url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
        if not url:
            raise RuntimeError("no signed url")
        return {"url": url, "expires_in": 120}
    except Exception as exc:
        msg = str(exc).lower()
        if "not_found" in msg or "not found" in msg:
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                                detail={"code": "file_not_available"}) from exc
        log.warning("reviewer signed-url generation failed",
                    extra={"application_id": application_id, "track": track})
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY,
                            detail={"code": "signed_url_failed"}) from exc
```

- [ ] **Step 3: Add tests** in `backend/tests/test_reviewer.py` (match existing fixtures/fake-client patterns):
  1. content endpoint now includes an `application` key (the raw row) for an assigned reviewer.
  2. signed-url endpoint: an **assigned** reviewer requesting a path that belongs to the app gets `{url, expires_in}`; an **unassigned** reviewer (or unknown path) gets **404**; a `..` path gets **400**.

Write the test bodies following the file's existing patterns for faking `fetch_application_for_reviewer` / the admin client storage. If the fake client doesn't implement `create_signed_url`, assert the 404/400 authorization paths (which don't reach storage) and the content `application` key — those don't need storage.

- [ ] **Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_reviewer.py -q`
Expected: new tests PASS; no new failures vs baseline.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reviewer.py backend/tests/test_reviewer.py
git commit -m "feat(reviewer): expose application payload + assignment-guarded file signed-URL endpoint"
```

---

## Task 8: Reviewer eval — use `<FullApplication>` (change 5e frontend)

**Files:**
- Modify: `frontend/src/lib/reviewerApi.js`
- Modify: `frontend/src/pages/reviewer/v2/ReviewerEval.jsx`

- [ ] **Step 1: Add the reviewer signing method** in `reviewerApi.js`, inside the exported object (e.g. after `getContent`):
```jsx
  fileSignedUrl: (track, id, storagePath) =>
    api.get(
      `/reviewer/applications/${track}/${id}/files/signed-url?storage_path=${encodeURIComponent(storagePath)}`,
    ),
```

- [ ] **Step 2: Replace the local `FullApplicationView` usage in `ReviewerEval.jsx`.**

Add the import near the top:
```jsx
import FullApplication from "../../../components/FullApplication.jsx";
```
Find the render of the local full-app view (~line 460):
```jsx
    return <FullApplicationView content={content} onBack={() => setViewApp(false)} />;
```
Replace with a wrapper that keeps the existing "back" affordance and renders the shared component from the raw `content.application` row:
```jsx
    return (
      <div>
        <button className="os-btn ghost sm" style={{ marginBottom: 16 }} onClick={() => setViewApp(false)}>
          ← Back to evaluation
        </button>
        <FullApplication
          track={content.track}
          application={content.application}
          applicationId={content.id}
          signedUrl={(id, path) => reviewerApi.fileSignedUrl(content.track, id, path)}
        />
      </div>
    );
```
Then DELETE the now-unused local `FullApplicationView` function (the `function FullApplicationView({ content, onBack }) { … }` block, ~lines 103-188). Ensure `reviewerApi` is imported in this file (it is — it's used for getContent/patchReview); if not, add it.

NOTE: `content.application` comes from Task 7's backend change. If the backend isn't deployed, this view shows empty answers — that's expected and resolves on deploy (Tasks 3 & 7 deploy together).

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds; no remaining references to the deleted `FullApplicationView`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/reviewerApi.js frontend/src/pages/reviewer/v2/ReviewerEval.jsx
git commit -m "feat(reviewer): full application view reuses shared leadership renderer"
```

---

## Task 9: Admin — use `<FullApplication>` (change 5d)

**Files:**
- Modify: `frontend/src/lib/adminDataAdapter.js` (`adaptDetail`)
- Modify: `frontend/src/pages/admin/platform/screens/AdminDetail.jsx`
- Remove: `frontend/src/pages/admin/platform/screens/FullApplicationView.jsx`
- Test: `frontend/src/lib/__tests__/adminDataAdapter.test.js`

- [ ] **Step 1: Add a failing adapter test** — in `adminDataAdapter.test.js`, add a case asserting `adaptDetail` passes the raw application through:
```js
  it("passes the raw application row through as `application`", () => {
    const d = { id: "a1", track: "tir", application: { problem_describe: "x", status: "submitted" } };
    expect(adaptDetail(d).application).toEqual({ problem_describe: "x", status: "submitted" });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminDataAdapter.test.js`
Expected: FAIL — `adaptDetail(d).application` is `undefined`.

- [ ] **Step 3: Edit `adaptDetail`** in `adminDataAdapter.js` — add to the returned object (e.g. right after `id: d.id,`):
```js
    application: d.application || null,
```

- [ ] **Step 4: Edit `AdminDetail.jsx`** — replace the placeholder full-app view.

Change the import:
```jsx
import { FullApplicationView } from "./FullApplicationView";
```
→
```jsx
import FullApplication from "../../../../components/FullApplication";
```
Find the render (~line 381):
```jsx
    return <FullApplicationView s={s} onBack={() => setViewApp(false)} />;
```
Replace with a back button + the shared component (admin holds `view_app_detail`, so it uses the leadership signed-URL endpoint via `leadershipApi.fileSignedUrl`, already imported in this file):
```jsx
    return (
      <div>
        <button className="os-btn ghost sm" style={{ marginBottom: 16 }} onClick={() => setViewApp(false)}>
          ← Back
        </button>
        <FullApplication
          track={track}
          application={s.application}
          applicationId={s.id}
          signedUrl={(id, path) => leadershipApi.fileSignedUrl(id, path)}
        />
      </div>
    );
```
(If `s.id` is not the application UUID used by the signed-URL endpoint, use the same id AdminDetail already passes to `adminPlatformApi.decide`/`loadDetail` — i.e. `s.id`. Confirm `s.id` equals the application id; per `adaptDetail`, `id: d.id` is the application id.)

- [ ] **Step 5: Remove the placeholder** `frontend/src/pages/admin/platform/screens/FullApplicationView.jsx` (it's no longer imported). Grep first to confirm no other importer:
```bash
grep -rn "FullApplicationView" frontend/src/ | grep -v "AdminDetail"
```
If only `AdminDetail` referenced it (now changed), delete the file.

- [ ] **Step 6: Run tests + build**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminDataAdapter.test.js && npm run build`
Expected: adapter test PASSES; build succeeds; no dangling `FullApplicationView` import.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/adminDataAdapter.js frontend/src/pages/admin/platform/screens/AdminDetail.jsx frontend/src/lib/__tests__/adminDataAdapter.test.js
git rm frontend/src/pages/admin/platform/screens/FullApplicationView.jsx
git commit -m "feat(admin): full application view reuses shared leadership renderer"
```

---

## Task 10: Full verification + deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Full frontend suite**

Run: `cd frontend && CI=true npx vitest run`
Expected: all suites green (new: ReviewerQueue, ReviewerHistory, FileGridAnswer.signedurl, FullApplication, adminDataAdapter case).

- [ ] **Step 2: Full backend reviewer tests**

Run: `cd backend && python -m pytest tests/test_reviewer.py -q`
Expected: green except any pre-existing unrelated baseline failures.

- [ ] **Step 3: Production build**

Run: `cd frontend && npm run build`
Expected: clean; note the new bundle hash.

- [ ] **Step 4: Backend SAM deploy (controller does this)** — from this worktree:
```bash
grep -E "TIR_SUBMISSIONS_CLOSED|SIP_SUBMISSIONS_CLOSED" backend/.env.prod
```
Both MUST be `true` (intake stays closed) — add them if missing BEFORE deploying. Then run the prod deploy (`./deploy-prod.sh` or the established prod SAM command) from the worktree. Smoke-check `/health/ready` and confirm intake flags still true.

- [ ] **Step 5: Push frontend** — `git push origin release/sip-launch-v1`. The user promotes the new build on Vercel.

- [ ] **Step 6: Visual checklist (post-deploy)** — reviewer queue shows `VIP-…` IDs + no Due column + visible filter/clear bar; CSV has no Due + VIP IDs; reviewer can edit a >60-min-old submitted review; reviewer + admin "view full application" matches leadership (all fields, file/PPT downloads open, video/Drive hyperlinks, 4 declaration checkboxes).

---

## Notes / invariants for the implementer

- `relabelDisplayId` is DISPLAY-ONLY — never use it for API params, routes, or comparisons (`s.track`/`s.id` stay raw).
- Tasks 3 & 7 are BACKEND — they require a SAM deploy; the reviewer full-app view (Task 8) depends on the Task 7 `application` payload, so backend deploys before/with the frontend.
- Reviewer signed-URL endpoint MUST keep the assignment check (`fetch_application_for_reviewer` returns None when unassigned → 404). Never sign an arbitrary path (allow-list via `collect_application_file_paths`).
- Leadership's full-app view must be unchanged in behavior after Task 5 (it now passes its own `signedUrl`).
- Use `fireEvent`, never `@testing-library/user-event`.
- Commit messages: no AI/Claude/Anthropic/Co-Authored-By references.
