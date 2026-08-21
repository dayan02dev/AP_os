# Admin UI Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the admin portal to a single navigation mode, make the application-detail view sequence-aware, surface accept/reject state on the Accepted tab, and unify the filter toolbars across every admin list screen.

**Architecture:** Frontend-only. `AdminPortal` stops branching on `decisionMode` and gains a `detailSeq` array that list screens hand to `goDetail`, which drives real Prev/Next on `AdminDetail`. The Accepted tab derives row state from data already on every pipeline row (`gate2_decision`) plus the IC-document map it already loads. A new `ListToolbar` component plus a CSS consolidation pass replaces three competing implementations of the same filter bar.

**Tech Stack:** React 18, Vite 5, Vitest 2 + @testing-library/react, plain CSS (no preprocessor, no CSS-in-JS library).

**Spec:** `docs/superpowers/specs/2026-08-22-admin-ui-consistency-design.md`

## Global Constraints

- **Worktree:** work only in `.claude/worktrees/admin-ui-consistency` (branch `feat/admin-ui-consistency`, base `6a682ba`). Concurrent sessions in other worktrees cross-contaminate commits.
- **Frontend only.** Do not modify anything under `backend/`. No migration, no SAM deploy.
- **Test baseline is 2 failed / 601 passed (99 files).** The two failures are pre-existing on the untouched base: `src/pages/admin/platform/__tests__/AdminPipeline.test.js` and `src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx`. Never claim to have fixed them and never attribute a new failure to them without checking.
- **Test command:** `cd frontend && npx vitest run <path>`. Full suite: `cd frontend && npx vitest run`. `node_modules` is already installed in this worktree.
- **Build command:** `cd frontend && npm run build`.
- **Watch a test fail first.** Every new test in this plan must be run against the unmodified code and observed to fail *for the stated reason* before the implementation step. A test that passes before implementation is a broken test, not a finished one.
- **Do not delete any jury screen.** `AdminJury.jsx`, `AdminIiscRoster.jsx`, `AdminProfessorDetail.jsx` and their tests stay. Only navigation into them is removed.
- **Keep `decisionMode` branches inside screens.** `AdminPipeline` and `AdminDetail` keep their internal `decisionMode` branches; the portal simply stops passing the prop.
- **Commit after every task.** No `Co-Authored-By` trailer and no Claude/Anthropic/AI reference in any commit message.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `frontend/src/pages/admin/platform/AdminPortal.jsx` | Portal shell: tab strip, page state, detail sequence | 1, 2 |
| `frontend/src/pages/admin/platform/screens/AdminDetail.jsx` | Detail nav bar (Back / Prev / Next) | 2 |
| `frontend/src/pages/admin/platform/screens/AdminGate1.jsx` | Gate-1 stack position + sequence hand-off | 3 |
| `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` | Sequence hand-off; loses its dead inline CSS | 3, 6 |
| `frontend/src/pages/admin/platform/screens/AdminSelectedApplications.jsx` | Accepted tab: row state, filter, sequence | 3, 4, 5, 7 |
| `frontend/src/pages/admin/platform/screens/ListToolbar.jsx` **(new)** | One filter toolbar for every admin list screen | 6, 7 |
| `frontend/src/styles/admin-portal.css` | Single home for all shared admin CSS | 2, 5, 6 |

---

## Task 1: Collapse the portal to a single navigation mode

**Files:**
- Modify: `frontend/src/pages/admin/platform/AdminPortal.jsx`
- Modify: `frontend/src/pages/admin/platform/__tests__/AdminTabBar.test.jsx`
- Rename + modify: `frontend/src/pages/admin/platform/__tests__/AdminPortal.juryMode.test.jsx` → `AdminPortal.tabs.test.jsx`
- Create: `frontend/src/pages/admin/platform/__tests__/AdminJury.render.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AdminTabBar({ page, setPage, appsBadge, rejectedBadge, reviewBadge, jurySelectedBadge })` — no `decisionMode` prop. Page id `'gate2'` renders `AdminGate2`.

**Background the implementer needs.** `decisionMode` today swaps the whole tab strip, and `gate1`/`gate2` share one tab id, so `AdminGate2` (the only screen that issues offer/waitlist/on-hold/reject) is reachable *only* in jury mode. Giving `gate2` its own id is what keeps it reachable after the toggle goes.

- [ ] **Step 1: Write the failing tab-strip test**

Replace the whole `describe("AdminTabBar — jury vs reviewer tabs", …)` block in `frontend/src/pages/admin/platform/__tests__/AdminTabBar.test.jsx` with:

```jsx
describe("AdminTabBar — single mode", () => {
  it("renders the seven tabs in order", () => {
    render(<AdminTabBar {...base} />);
    const labels = screen
      .getAllByText(/^(Dashboard|Reviewers|Applications|Rejected|Accepted|Admin Review|Final Gate)$/)
      .map((n) => n.textContent);
    expect(labels).toEqual([
      "Dashboard", "Reviewers", "Applications", "Rejected",
      "Accepted", "Admin Review", "Final Gate",
    ]);
  });

  it("no longer offers the jury-mode surfaces", () => {
    render(<AdminTabBar {...base} />);
    expect(screen.queryByText("Academic Jury Roster")).toBeNull();
    expect(screen.queryByText("Jury Decision")).toBeNull();
  });
});
```

Leave `describe("AdminTabBar — the merged Accepted tab", …)` in place, but delete the `decisionMode="jury"` prop from its `render` calls.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminTabBar.test.jsx`
Expected: FAIL — "Final Gate" is not in the strip (reviewer mode has no gate2 tab), so the `toEqual` gets a six-item array.

- [ ] **Step 3: Rewrite `AdminTabBar`**

Replace the entire `AdminTabBar` function in `AdminPortal.jsx` with:

```jsx
export function AdminTabBar({ page, setPage, appsBadge, rejectedBadge, reviewBadge,
  jurySelectedBadge }) {
  // Badges come from real /stats data (passed down from AdminApp). A null
  // badge renders as no badge at all — we never show a fabricated number.
  const tabs = [
    { id:'dashboard',     label:'Dashboard',    sub:'OVERVIEW · PIPELINE',      badge:null },
    { id:'reviewers',     label:'Reviewers',    sub:'ROSTER · PROGRESS',        badge:null },
    { id:'pipeline',      label:'Applications', sub:'ALL SUBMISSIONS',
      badge: appsBadge == null ? null : String(appsBadge) },
    { id:'rejected',      label:'Rejected',     sub:'TIR + VIP',
      badge: rejectedBadge == null ? null : String(rejectedBadge) },
    // One tab for both tracks — the work at this stage (attach the IC memo,
    // approve it) is identical either way, and each row carries a TRACK chip.
    { id:'jury_selected', label:'Accepted',     sub:'TIR + VIP',
      badge: jurySelectedBadge == null ? null : String(jurySelectedBadge) },
    { id:'gate1',         label:'Admin Review', sub:'PENDING DECISIONS',
      badge: reviewBadge == null ? null : String(reviewBadge) },
    // gate2 has its own id (it used to share `gate1`, switched by decision
    // mode). Without a distinct id the Final Gate is unreachable.
    { id:'gate2',         label:'Final Gate',   sub:'CONSOLIDATED DECISIONS',   badge:null },
  ];

  return (
    <div className="lp-tabs">
      {tabs.map(t => (
        <div key={t.id} className={`lp-tab${page === t.id ? ' active' : ''}`} onClick={() => setPage(t.id)}>
          <div className="lp-tab-label">
            {t.label}
            {t.badge && <span className="lp-tab-badge">{t.badge}</span>}
          </div>
          <div className="lp-tab-sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminTabBar.test.jsx`
Expected: PASS.

- [ ] **Step 5: Remove the toggle from `AdminCohortHeader`**

Replace the `AdminCohortHeader` function with:

```jsx
function AdminCohortHeader({ page, setPage }) {
  return (
    <div className="lp-page-header">
      <div className="lp-breadcrumb" style={{marginBottom:8}}>ARTPARK / OS · Admin Portal</div>
      <div className="lp-header-row">
        <div>
          <h1 className="lp-cohort-title">TIR + VIP cohort <span className="lp-year">2026</span></h1>
        </div>
        <div style={{marginTop:4,display:'flex',gap:12,alignItems:'center'}}>
          <button
            className={`os-btn ${page === 'roles' ? '' : 'ghost'}`}
            onClick={() => setPage(page === 'roles' ? 'dashboard' : 'roles')}
          >
            {page === 'roles' ? '← Back to Dashboard' : 'User Roles'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Fix the topbar breadcrumb map**

In `AdminTopbar`, change the signature to `function AdminTopbar({ page, setPage })` and replace `crumbMap` with:

```jsx
  const crumbMap = {
    dashboard:'DASHBOARD', pipeline:'APPLICATIONS', detail:'APPLICATION DETAIL',
    reviewers:'REVIEWERS',
    roles:'USER ROLES',
    gate1:'ADMIN REVIEW',
    psychometry:'PSYCHOMETRY',
    rejected:'REJECTED',
    jury_selected:'ACCEPTED',
    gate2:'FINAL GATE', audit:'AUDIT LOG', analytics:'ANALYTICS',
  };
```

- [ ] **Step 7: Strip mode state out of `AdminApp`**

In `AdminApp`, delete this line:

```jsx
  const [decisionMode, setDecisionMode] = React.useState('reviewer');
```

and replace the mode-normalising effect:

```jsx
  React.useEffect(() => {
    if (decisionMode === 'jury' && (page === 'pipeline' || page === 'rejected')) setPage('dashboard');
    if (decisionMode === 'reviewer' && page === 'iisc_roster') setPage('dashboard');
    // Legacy page ids from when the jury stage had a tab per track.
    if (page === 'jury_tir' || page === 'jury_vip') setPage('jury_selected');
  }, [decisionMode]);   // eslint-disable-line react-hooks/exhaustive-deps
```

with:

```jsx
  // Legacy page ids from when the jury stage had a tab per track, and from
  // when the Academic Jury Roster had a tab. Anything bookmarked at one of
  // those lands somewhere real instead of a blank pane.
  React.useEffect(() => {
    if (page === 'jury_tir' || page === 'jury_vip') setPage('jury_selected');
    if (page === 'iisc_roster') setPage('dashboard');
  }, [page]);
```

- [ ] **Step 8: Update the shell + render map**

In `AdminApp`'s returned JSX:

- `<AdminTopbar page={page} decisionMode={decisionMode} setPage={setPage} />` → `<AdminTopbar page={page} setPage={setPage} />`
- `<AdminCohortHeader page={page} setPage={setPage} decisionMode={decisionMode} setDecisionMode={setDecisionMode} />` → `<AdminCohortHeader page={page} setPage={setPage} />`
- `<AdminTabBar … decisionMode={decisionMode} … />` → drop the `decisionMode` prop only; keep every badge prop.

Then replace these render lines:

```jsx
            {page === 'dashboard'   && <AdminDashboard go={setPage} decisionMode={decisionMode} />}
            {page === 'pipeline'    && <AdminPipeline goDetail={goDetail} decisionMode={decisionMode} baseFilter={{ exclude_status: 'rejected,jury_review' }} scopeKey="applications" />}
            {page === 'rejected'    && <AdminPipeline goDetail={goDetail} decisionMode={decisionMode} baseFilter={{ status: 'rejected' }} readOnly heading="Rejected applications" scopeKey="rejected" />}
```

with:

```jsx
            {page === 'dashboard'   && <AdminDashboard go={setPage} />}
            {page === 'pipeline'    && <AdminPipeline goDetail={goDetail} baseFilter={{ exclude_status: 'rejected,jury_review' }} scopeKey="applications" />}
            {page === 'rejected'    && <AdminPipeline goDetail={goDetail} baseFilter={{ status: 'rejected' }} readOnly heading="Rejected applications" scopeKey="rejected" />}
```

and replace these three lines:

```jsx
            {page === 'reviewers'   && (decisionMode === 'jury' ? <AdminJury /> : <AdminReviewers decisionMode={decisionMode} />)}
            {page === 'iisc_roster' && decisionMode === 'jury' && <AdminIiscRoster />}
            {page === 'gate1'       && (decisionMode === 'jury' ? <AdminGate2 /> : <AdminGate1 goDetail={goDetail} />)}
```

with:

```jsx
            {page === 'reviewers'   && <AdminReviewers />}
            {page === 'gate1'       && <AdminGate1 goDetail={goDetail} />}
            {page === 'gate2'       && <AdminGate2 />}
```

Finally, remove `decisionMode={decisionMode}` from the `<AdminDetail …>` element (leave every other prop alone — Task 2 rewrites them).

The `AdminJury` and `AdminIiscRoster` imports at the top of the file are now unused. **Leave the import for `AdminJury` in place** — Step 10's test imports the screen directly and the import keeps it in the bundle graph. Delete only the `AdminIiscRoster` import.

- [ ] **Step 9: Rewrite the portal-level tab test**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git mv frontend/src/pages/admin/platform/__tests__/AdminPortal.juryMode.test.jsx \
       frontend/src/pages/admin/platform/__tests__/AdminPortal.tabs.test.jsx
```

In the renamed file, replace everything from `describe("AdminPortal — jury decision mode"` to the end of that describe block with:

```jsx
describe("AdminPortal — single-mode tab strip", () => {
  it("has no decision-mode toggle", () => {
    render(<AdminPortalDefault />);
    expect(screen.queryByText("Jury Decision")).toBeNull();
    expect(screen.queryByText("Reviewer Decision")).toBeNull();
  });

  // Missing-import trap: AdminGate2 only ever renders behind a tab click, so
  // `vite build` cannot catch an unimported component — this navigates there
  // for real. AdminGate2 used to be reachable only in jury mode.
  it("renders AdminGate2 on the Final Gate tab without crashing", () => {
    render(<AdminPortalDefault />);
    fireEvent.click(screen.getByText("Final Gate"));
    expect(screen.getAllByText("Final Gate").length).toBeGreaterThan(0);
  });

  it("renders the Selected Applications screen without crashing", () => {
    render(<AdminPortalDefault />);
    fireEvent.click(screen.getByText("Accepted"));
    expect(screen.getByText("No selected applications yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Search selected applications")).toBeInTheDocument();
  });

  it("offers ONE selected tab covering both tracks, not a tab per track", () => {
    render(<AdminPortalDefault />);
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByText("TIR Selected")).toBeNull();
    expect(screen.queryByText("VIP Selected")).toBeNull();
  });

  it("offers the track switcher there so a single track can still be isolated", () => {
    render(<AdminPortalDefault />);
    fireEvent.click(screen.getByText("Accepted"));
    expect(screen.getByRole("button", { name: "TIR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VIP" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Add the direct-render guard for the unwired jury screen**

Create `frontend/src/pages/admin/platform/__tests__/AdminJury.render.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// AdminJury is no longer reachable by clicking — its tab was removed when the
// portal collapsed to a single decision mode. It stays on disk for next
// cohort, so it keeps a direct-render test: without one, nothing would catch a
// missing import or a crash-on-mount until the tab is restored.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: () => ({
    data: { startups: [], total: 0, jurors: [], pendingInvites: [], reviewers: [], batches: [] },
    loading: false, error: null, reload: vi.fn(),
  }),
  loadDetail: vi.fn(),
}));

vi.mock("../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import { AdminJury } from "../screens/AdminJury";

describe("AdminJury — kept for next cohort", () => {
  it("mounts without crashing", () => {
    render(<AdminJury />);
    expect(screen.getByText("Invite member")).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Run every affected suite**

Run:
```bash
cd frontend && npx vitest run \
  src/pages/admin/platform/__tests__/AdminTabBar.test.jsx \
  src/pages/admin/platform/__tests__/AdminPortal.tabs.test.jsx \
  src/pages/admin/platform/__tests__/AdminJury.render.test.jsx \
  src/pages/admin/platform/__tests__/AdminPortal.rejectedTab.test.jsx \
  src/pages/admin/platform/__tests__/AdminDashboard.test.jsx
```
Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git add frontend/src/pages/admin/platform/AdminPortal.jsx \
        frontend/src/pages/admin/platform/__tests__/
git commit -m "feat(admin): collapse the portal to a single navigation mode

The Jury Decision toggle swapped the entire tab strip, and gate1/gate2
shared one tab id — so Final Gate, the only screen that issues an offer,
was reachable only in jury mode. gate2 now has its own id and its own tab.

Academic Jury Roster and the Jury roster leave the navigation. Both
screens stay on disk with their tests for next cohort; AdminJury gains a
direct-render test since no tab click reaches it any more."
```

---

## Task 2: Sequence-aware detail navigation

**Files:**
- Modify: `frontend/src/pages/admin/platform/AdminPortal.jsx`
- Modify: `frontend/src/pages/admin/platform/screens/AdminDetail.jsx:307-356`
- Modify: `frontend/src/styles/admin-portal.css`
- Create: `frontend/src/pages/admin/platform/__tests__/AdminDetailNav.test.jsx`

**Interfaces:**
- Consumes: Task 1's single-mode `AdminApp`.
- Produces:
  - `goDetail(id, track, fromPage = 'pipeline', sequence = [])` where `sequence` is `[{ id, track }]` in the caller's current rendered order.
  - `AdminDetail({ startupId, track, onBack, onPrev, onNext, seqPosition, decisionMode })` where `seqPosition` is `{ index, total }` (1-based) or `null`.

**Background the implementer needs.** `AdminDetail` already renders `onPrev`/`onNext`. They never appear because `AdminPortal` derives them from `window.OS_DATA?.STARTUPS` — prototype seed data that is empty in production, so `currentIdx` is `-1`, both guards fail and both props arrive `null`. That dead path is being replaced, not extended.

- [ ] **Step 1: Write the failing nav test**

Create `frontend/src/pages/admin/platform/__tests__/AdminDetailNav.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: () => ({ data: { startups: [], total: 0 }, loading: false, error: null, reload: vi.fn() }),
  loadDetail: vi.fn(() => Promise.resolve({
    id: "a1", track: "tir", name: "Alpha", domain: "AI", stage: "Prototype",
    founders: ["F"], sub: "2026-06-01", chip: "EVALUATED", ai: {}, reviews: [],
  })),
}));

vi.mock("../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import { AdminDetail } from "../screens/AdminDetail";

const base = { startupId: "a1", track: "tir", onBack: vi.fn() };

describe("AdminDetail — sequence navigation", () => {
  it("renders neither Prev nor Next when no sequence was handed over", async () => {
    render(<AdminDetail {...base} onPrev={null} onNext={null} seqPosition={null} />);
    expect(await screen.findByText("← Back to applications")).toBeInTheDocument();
    expect(screen.queryByText("← Prev")).toBeNull();
    expect(screen.queryByText("Next →")).toBeNull();
  });

  it("shows the 1-based position and both buttons mid-sequence", async () => {
    render(
      <AdminDetail {...base} onPrev={vi.fn()} onNext={vi.fn()}
        seqPosition={{ index: 12, total: 120 }} />
    );
    expect(await screen.findByText("12 / 120")).toBeInTheDocument();
    expect(screen.getByText("← Prev").closest("button").disabled).toBe(false);
    expect(screen.getByText("Next →").closest("button").disabled).toBe(false);
  });

  it("disables Prev at the head of the sequence", async () => {
    render(
      <AdminDetail {...base} onPrev={null} onNext={vi.fn()}
        seqPosition={{ index: 1, total: 120 }} />
    );
    expect(await screen.findByText("← Prev")).toBeInTheDocument();
    expect(screen.getByText("← Prev").closest("button").disabled).toBe(true);
    expect(screen.getByText("Next →").closest("button").disabled).toBe(false);
  });

  it("disables Next at the tail of the sequence", async () => {
    render(
      <AdminDetail {...base} onPrev={vi.fn()} onNext={null}
        seqPosition={{ index: 120, total: 120 }} />
    );
    expect(await screen.findByText("Next →")).toBeInTheDocument();
    expect(screen.getByText("Next →").closest("button").disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminDetailNav.test.jsx`
Expected: FAIL. The first case may pass incidentally (today both props are `null`); cases 2–4 must fail because there is no `seqPosition` rendering and the buttons are conditionally *absent* rather than *disabled*.

If case 2 reports "Unable to find an element with the text: 12 / 120", that is the right failure.

- [ ] **Step 3: Replace the detail header actions with a full-width nav bar**

In `AdminDetail.jsx`, change the signature:

```jsx
export function AdminDetail({ startupId, track, onBack, onPrev, onNext, seqPosition, decisionMode }) {
```

Then, in the returned JSX, insert the nav bar as the **first** child of the outer `<div>` (immediately before `{/* ── Header ─── */}`):

```jsx
      {/* ── Nav bar ────────────────────────────────────────────────────────
          Back sits hard left, sequence controls hard right. Prev/Next render
          disabled rather than absent at the ends, so the control does not
          jump position as you walk the list. */}
      <div className="adm-detail-nav">
        <button className="os-btn secondary" onClick={onBack}>← Back to applications</button>
        {seqPosition && (
          <div className="os-row gap-sm" style={{ alignItems: 'center' }}>
            <button className="os-btn ghost sm" disabled={!onPrev}
              onClick={() => onPrev && onPrev()}>← Prev</button>
            <span className="adm-detail-seq os-mono">{seqPosition.index} / {seqPosition.total}</span>
            <button className="os-btn ghost sm" disabled={!onNext}
              onClick={() => onNext && onNext()}>Next →</button>
          </div>
        )}
      </div>
```

Then **delete** the old `<div className="lp-section-actions">…</div>` block entirely — the one containing the `os-row` with `← Prev application` / `Next application →` and the `← Back to applications` button (currently `AdminDetail.jsx:346-354`). The breadcrumb `Applications` link above it stays.

- [ ] **Step 4: Add the nav-bar CSS**

Append to `frontend/src/styles/admin-portal.css`:

```css
/* ── Application-detail nav bar ───────────────────────────── */
/* Back hard left, sequence controls hard right. `.lp-section-actions` is a
   right-aligned COLUMN used by every other section head, so the detail nav
   gets its own row rather than a modifier that would fight it. */
.adm-portal .adm-detail-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.adm-portal .adm-detail-seq {
  font-size: 12px;
  color: var(--ink-dim);
  min-width: 64px;
  text-align: center;
  white-space: nowrap;
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminDetailNav.test.jsx`
Expected: PASS (4/4).

- [ ] **Step 6: Replace the dead OS_DATA sequence in `AdminPortal`**

In `AdminApp`, delete these lines:

```jsx
  const startups = window.OS_DATA?.STARTUPS || [];
  const currentIdx = startups.findIndex(s => s.id === selectedStartupId);
```

and:

```jsx
  const onPrev = () => {
    if (currentIdx > 0) {
      setSelectedStartupId(startups[currentIdx - 1].id);
    }
  };

  const onNext = () => {
    if (currentIdx < startups.length - 1) {
      setSelectedStartupId(startups[currentIdx + 1].id);
    }
  };
```

Add `detailSeq` next to the other detail state:

```jsx
  const [detailSeq, setDetailSeq] = React.useState([]);
```

Replace `goDetail` with:

```jsx
  // `sequence` is the caller's list in its CURRENT filtered + sorted order,
  // shaped [{ id, track }]. Callers that pass nothing get no Prev/Next, which
  // is why the parameter is optional rather than required.
  const goDetail = (id, track, fromPage = 'pipeline', sequence = []) => {
    setSelectedStartupId(id);
    setSelectedTrack(track || null);
    setBackPage(fromPage);
    setDetailSeq(Array.isArray(sequence) ? sequence : []);
    setPage('detail');
  };

  const seqIdx = detailSeq.findIndex(r => r.id === selectedStartupId);
  const goSeq = (delta) => {
    const next = seqIdx + delta;
    if (seqIdx < 0 || next < 0 || next >= detailSeq.length) return;
    setSelectedStartupId(detailSeq[next].id);
    setSelectedTrack(detailSeq[next].track || null);
  };
```

- [ ] **Step 7: Wire the new props into `AdminDetail`**

Replace the `<AdminDetail …>` element with:

```jsx
              <AdminDetail
                startupId={selectedStartupId}
                track={selectedTrack}
                onBack={() => setPage(backPage)}
                onPrev={seqIdx > 0 ? () => goSeq(-1) : null}
                onNext={seqIdx >= 0 && seqIdx < detailSeq.length - 1 ? () => goSeq(1) : null}
                seqPosition={seqIdx >= 0 ? { index: seqIdx + 1, total: detailSeq.length } : null}
              />
```

- [ ] **Step 8: Run the portal suites**

Run:
```bash
cd frontend && npx vitest run \
  src/pages/admin/platform/__tests__/AdminDetailNav.test.jsx \
  src/pages/admin/platform/__tests__/AdminApplicationDetail.test.jsx \
  src/pages/admin/platform/__tests__/AdminPortal.tabs.test.jsx
```
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git add frontend/src/pages/admin/platform/AdminPortal.jsx \
        frontend/src/pages/admin/platform/screens/AdminDetail.jsx \
        frontend/src/styles/admin-portal.css \
        frontend/src/pages/admin/platform/__tests__/AdminDetailNav.test.jsx
git commit -m "feat(admin): make the application detail view sequence-aware

AdminDetail already rendered Prev/Next; AdminPortal derived them from
window.OS_DATA.STARTUPS, prototype seed data that is empty in production,
so both props always arrived null and only the Back button showed.

goDetail now carries the caller's list in its current filtered order.
Back moves to the left of a full-width nav bar with the sequence controls
and an N / total position on the right."
```

---

## Task 3: Hand the sequence over, and keep the Gate-1 position

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminGate1.jsx:174, 326, 529, 690`
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx:1078`
- Modify: `frontend/src/pages/admin/platform/screens/AdminSelectedApplications.jsx:545`
- Create: `frontend/src/pages/admin/platform/screens/__tests__/AdminGate1.stackPosition.test.jsx`

**Interfaces:**
- Consumes: `goDetail(id, track, fromPage, sequence)` from Task 2.
- Produces: nothing new. This task only fills in the fourth argument at every call site.

**Background the implementer needs — read before touching the `key`.** `AdminGate1` renders `<GateReviewStack key={"stack-" + evalRows.length} …>`. That key is **load-bearing**: `GateReviewStack` seeds its `decisions` state from `items` in a `useState` initializer, so after a decision changes the row count the remount is what re-seeds it. **Do not remove the key.** Instead, move `idx` into `useStickyState`, which re-reads sessionStorage on mount — so the position survives the remount *and* the detail round-trip. This is a refinement on the spec's §4.3, which proposed removing the key; removing it would silently break decision re-seeding.

- [ ] **Step 1: Write the failing position test**

Create `frontend/src/pages/admin/platform/screens/__tests__/AdminGate1.stackPosition.test.jsx`:

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: `a${i + 1}`, track: "tir", name: `App ${i + 1}`, domain: "AI",
  stage: "Prototype", founders: ["F"], sub: "2026-06-01", chip: "EVALUATED",
  ai: {}, reviews: [], batches: [], flag: null,
}));

vi.mock("../../../../../hooks/useAdminData", () => ({
  useAdminData: (kind, params) => ({
    data: { startups: params?.status === "evaluated" ? ROWS : ROWS, total: ROWS.length },
    loading: false, error: null, reload: vi.fn(),
  }),
  loadDetail: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import AdminGate1 from "../AdminGate1";

describe("AdminGate1 — stack position", () => {
  beforeEach(() => {
    const store = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    });
  });

  it("keeps the position after the screen unmounts and comes back", () => {
    const first = render(<AdminGate1 goDetail={vi.fn()} />);
    expect(screen.getByText("1/5")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("3/5")).toBeInTheDocument();

    // Opening an application unmounts the whole screen; coming back remounts it.
    first.unmount();
    render(<AdminGate1 goDetail={vi.fn()} />);
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("hands the full stack order to goDetail so the detail view can walk it", () => {
    const goDetail = vi.fn();
    render(<AdminGate1 goDetail={goDetail} />);
    fireEvent.click(screen.getByText(/View full application/));
    expect(goDetail).toHaveBeenCalledWith("a1", "tir", "gate1", [
      { id: "a1", track: "tir" }, { id: "a2", track: "tir" }, { id: "a3", track: "tir" },
      { id: "a4", track: "tir" }, { id: "a5", track: "tir" },
    ]);
  });
});
```

Note on the mock path: this test lives one directory deeper than the `__tests__` folder under `platform/`, so the hook path is `../../../../../hooks/…`. If the mock fails to resolve, count the segments from the test file to `frontend/src/hooks/` rather than guessing.

Note on `sessionStorage`: `vi.spyOn` cannot stub jsdom's `sessionStorage` — use `vi.stubGlobal` as above.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminGate1.stackPosition.test.jsx`
Expected: FAIL on both. Case 1 fails at the final assertion — it finds `1/5` because `useState(0)` resets on remount. Case 2 fails because `goDetail` is called with three arguments, not four.

The button renders `View full application →` with a trailing arrow in the same text node, which is why the query is a regex and not an exact string.

- [ ] **Step 3: Make the stack position sticky**

In `AdminGate1.jsx`, replace line 174:

```jsx
  const [idx, setIdx]           = useState(0);
```

with:

```jsx
  // Sticky, not plain state: opening an application unmounts this screen
  // entirely, and a decision remounts it via the `key` below — both used to
  // snap the reviewer back to 1/N. sessionStorage means the position survives
  // navigation and a reload, but a fresh tab starts clean.
  const [idx, setIdx]           = useStickyState("admin.gate1.stack", "idx", 0);
```

`useStickyState` is already imported at `AdminGate1.jsx:34`.

Then, immediately after the existing `const safeIdx = …` line, add the clamp write-back:

```jsx
  // `safeIdx` clamps at render time; this writes the clamped value back so a
  // stale index from a longer list does not persist into the next session.
  useEffect(() => {
    if (idx !== safeIdx) setIdx(safeIdx);
  }, [idx, safeIdx]);   // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Hand the sequence over from all three Gate-1 tabs**

In `GateReviewStack`, add above the `return`:

```jsx
  const seq = items.map(i => ({ id: i.id, track: i.track }));
```

and change the `ApplicationSummaryCard` call:

```jsx
              onViewFullApplication={() => goDetail && goDetail(s.id, s.track, "gate1", seq)}
```

In `GateReviewBatchDecision`, add above the `return`:

```jsx
  const seq = filtered.map(i => ({ id: i.id, track: i.track }));
```

and change the row click:

```jsx
                    if (goDetail) goDetail(s.id, s.track, "gate1", seq);
```

In `GateReviewHistory`, add above the `return`:

```jsx
  const seq = sortedStartups.map(i => ({ id: i.id, track: i.track }));
```

and change `handleRowClick`:

```jsx
                if (goDetail) goDetail(s.id, s.track, "gate1", seq);
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminGate1.stackPosition.test.jsx`
Expected: PASS (2/2).

- [ ] **Step 6: Hand the sequence over from the Applications and Rejected tabs**

In `AdminPipeline.jsx`, the rendered order is `sortedFiltered` (used at line 1072). Add above the `return` of the main component:

```jsx
  const detailSeq = sortedFiltered.map(s => ({ id: s.id, track: s.track }));
```

Then change line 1078:

```jsx
                onClick={() => goDetail && goDetail(s.id, s.track, scopeKey === 'rejected' ? 'rejected' : 'pipeline', detailSeq)}
```

The third argument must be passed explicitly. `AdminPortal` sets `backPage` from it, and this one component serves both the Applications and the Rejected tab — relying on `goDetail`'s `'pipeline'` default would send Back from a rejected application to the wrong tab.

`scopeKey` is already a prop on `AdminPipeline` (`"applications"` or `"rejected"`).

- [ ] **Step 7: Hand the sequence over from the Accepted tab**

In `AdminSelectedApplications.jsx`, `rows` is the rendered order. Change the project-name link's handler:

```jsx
                            onClick={() => goDetail(s.id, s.track, "jury_selected",
                              rows.map(r => ({ id: r.id, track: r.track })))}
```

- [ ] **Step 8: Run every touched suite**

Run:
```bash
cd frontend && npx vitest run \
  src/pages/admin/platform/screens/__tests__/AdminGate1.stackPosition.test.jsx \
  src/pages/admin/platform/screens/__tests__/AdminGate1.wiring.test.jsx \
  src/pages/admin/platform/__tests__/AdminGate1Review.test.jsx \
  src/pages/admin/platform/__tests__/AdminPipeline.stickyFilters.test.jsx \
  src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.test.jsx
```
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git add frontend/src/pages/admin/platform/screens/AdminGate1.jsx \
        frontend/src/pages/admin/platform/screens/AdminPipeline.jsx \
        frontend/src/pages/admin/platform/screens/AdminSelectedApplications.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/AdminGate1.stackPosition.test.jsx
git commit -m "feat(admin): keep the Gate-1 position and pass list order to the detail view

The Gate-1 stack held its index in plain useState, so opening an
application — which unmounts the screen — snapped it back to 1/N every
time. It is now sticky, which also survives the remount the decision
`key` triggers; that key stays because it re-seeds decision state.

Gate-1 (all three tabs), Applications, Rejected and Accepted now hand
their current rendered order to goDetail, so Prev/Next walk the list the
reviewer was actually looking at."
```

---

## Task 4: Bring rejected rows back to the Accepted tab

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminSelectedApplications.jsx:419-443`
- Create: `frontend/src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `decisionStateOf(app, doc) → 'accepted' | 'rejected' | 'pending'`, exported from `AdminSelectedApplications.jsx` for the Task 5 tests.

**Background the implementer needs.** The tab loads `useAdminData("pipeline", { status: "jury_review" })`. **Approve** signs the IC memo and does not change status; **Reject** calls `decideGate2`, which moves status to `rejected` — so the row leaves the list and there is nothing left to colour. Rejected rows must be fetched back.

The filter must be `gate2_decision === 'rejected'`, **not** `status === 'rejected'`. The Rejected tab holds ~120 applications, nearly all rejected at *gate 1*; those never reached the Accepted tab and must never appear on it. `gate2_decision` is already on every pipeline row — `admin_query.fetch_pipeline` merges `_fetch_jury_v2_metrics` unconditionally, and `adaptPipelineRow` maps it at `adminDataAdapter.js:94`. **No backend change.**

- [ ] **Step 1: Write the failing state + merge test**

Create `frontend/src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const SHORTLISTED = [
  { id: "s1", track: "tir", name: "Signed App", domain: "AI", ai: { overall: 8.1 },
    founders: ["F1"], applicationId: "TIR-1", gate2_decision: null },
  { id: "s2", track: "tir", name: "Pending App", domain: "AI", ai: { overall: 7.0 },
    founders: ["F2"], applicationId: "TIR-2", gate2_decision: null },
];

// Two rejected rows with DIFFERENT causes. g1 was rejected at gate 1 and never
// reached this tab; g2 was rejected here. Only g2 may appear. A fixture
// without g1 would let a `status === 'rejected'` implementation pass.
const REJECTED = [
  { id: "g1", track: "tir", name: "Gate1 Reject", domain: "AI", ai: { overall: 4.0 },
    founders: ["F3"], applicationId: "TIR-3", gate2_decision: null },
  { id: "g2", track: "tir", name: "Gate2 Reject", domain: "AI", ai: { overall: 6.0 },
    founders: ["F4"], applicationId: "TIR-4", gate2_decision: "rejected" },
];

vi.mock("../../../../../hooks/useAdminData", () => ({
  useAdminData: (kind, params) => {
    if (kind === "icDocuments") {
      return {
        data: { documents: [], byKey: { "tir:s1": { file_name: "m.pdf", signed: true,
          signer_name: "A", signed_at: "2026-08-01T00:00:00Z" } } },
        loading: false, error: null, reload: vi.fn(),
      };
    }
    const rows = params?.status === "rejected" ? REJECTED : SHORTLISTED;
    return { data: { startups: rows, total: rows.length }, loading: false, error: null, reload: vi.fn() };
  },
  loadDetail: vi.fn(),
}));

vi.mock("../../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import { AdminSelectedApplications, decisionStateOf } from "../AdminSelectedApplications";

describe("decisionStateOf", () => {
  it("is rejected when the gate-2 decision says so", () => {
    expect(decisionStateOf({ gate2_decision: "rejected" }, null)).toBe("rejected");
  });
  it("is accepted when the memo is signed", () => {
    expect(decisionStateOf({ gate2_decision: null }, { signed: true })).toBe("accepted");
  });
  it("is pending with an unsigned memo", () => {
    expect(decisionStateOf({ gate2_decision: null }, { signed: false })).toBe("pending");
  });
  it("is pending with no memo at all", () => {
    expect(decisionStateOf({ gate2_decision: null }, null)).toBe("pending");
  });
  it("prefers rejected over a signed memo", () => {
    expect(decisionStateOf({ gate2_decision: "rejected" }, { signed: true })).toBe("rejected");
  });
});

describe("AdminSelectedApplications — rejected rows return", () => {
  it("lists an application rejected at gate 2", async () => {
    render(<AdminSelectedApplications />);
    expect(await screen.findByText("Gate2 Reject")).toBeInTheDocument();
  });

  it("does NOT list an application rejected at gate 1", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    expect(screen.queryByText("Gate1 Reject")).toBeNull();
  });

  it("counts the merged list", async () => {
    render(<AdminSelectedApplications />);
    // 2 shortlisted + 1 gate-2 reject = 3
    expect(await screen.findByText("3 of 3")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`
Expected: FAIL — `decisionStateOf` is not exported, and "Gate2 Reject" is not in the document because only the `jury_review` list is fetched.

- [ ] **Step 3: Add the state helper**

In `AdminSelectedApplications.jsx`, next to the existing `nativeOf` helper near the top:

```jsx
// Row decision state, derived — never stored.
//
// `accepted` means the IC memo on this screen has been signed via Approve, NOT
// that Final Gate issued an offer. `rejected` means Reject was pressed HERE,
// which writes a gate-2 decision — a gate-1 rejection never reached this tab.
export const decisionStateOf = (app, doc) => {
  if ((app?.gate2_decision || "") === "rejected") return "rejected";
  if (doc?.signed) return "accepted";
  return "pending";
};
```

- [ ] **Step 4: Fetch and merge the gate-2 rejects**

Replace:

```jsx
  const pipeline = useAdminData("pipeline", { status: "jury_review" });
  const docs = useAdminData("icDocuments");
```

with:

```jsx
  const pipeline = useAdminData("pipeline", { status: "jury_review" });
  // Reject moves an application to `rejected`, so it drops out of the list
  // above. Fetch it back — filtered to gate-2 rejections, because the
  // Rejected tab's ~120 rows are overwhelmingly gate-1 and never belonged here.
  const rejectedPipeline = useAdminData("pipeline", { status: "rejected" });
  const docs = useAdminData("icDocuments");
```

Replace:

```jsx
  const all = pipeline.data?.startups ?? [];
```

with:

```jsx
  const all = useMemo(() => {
    const shortlisted = pipeline.data?.startups ?? [];
    const gate2Rejects = (rejectedPipeline.data?.startups ?? [])
      .filter((s) => (s.gate2_decision || "") === "rejected");
    const seen = new Set(shortlisted.map((s) => keyOf(s.track, s.id)));
    return [...shortlisted, ...gate2Rejects.filter((s) => !seen.has(keyOf(s.track, s.id)))];
  }, [pipeline.data, rejectedPipeline.data]);
```

Update `reload` so both lists refresh:

```jsx
  const reload = () => { docs.reload(); pipeline.reload(); rejectedPipeline.reload(); };
```

- [ ] **Step 5: Sort so outstanding work stays on top**

Replace the `rows` memo with:

```jsx
  const ORDER = { pending: 0, accepted: 1, rejected: 2 };
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((s) => track === "all" || s.track === track)
      .filter((s) => !q || `${s.name || ""} ${s.domain || ""} ${(s.founders || []).join(" ")}`
        .toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        const da = ORDER[decisionStateOf(a, byKey[keyOf(nativeOf(a), a.id)])];
        const db = ORDER[decisionStateOf(b, byKey[keyOf(nativeOf(b), b.id)])];
        if (da !== db) return da - db;
        return String(b.submitted_at || "").localeCompare(String(a.submitted_at || ""));
      });
  }, [all, search, track, byKey]);
```

Move the `const byKey = docs.data?.byKey || {};` line **above** this memo if it is not already, so the dependency resolves.

- [ ] **Step 6: Keep the loading and empty states honest**

Replace `pipeline.loading ?` with `(pipeline.loading || rejectedPipeline.loading) ?` and `pipeline.error ?` with `(pipeline.error || rejectedPipeline.error) ?` in the render branch, and pass `reload` (the merged one) to `ErrorState`'s `onRetry` instead of `pipeline.reload`.

- [ ] **Step 7: Run the test and watch it pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`
Expected: PASS (8/8).

- [ ] **Step 8: Run the neighbouring suites**

Run:
```bash
cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminSelectedApplications
```
Expected: all four `AdminSelectedApplications.*` files PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git add frontend/src/pages/admin/platform/screens/AdminSelectedApplications.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx
git commit -m "feat(admin): keep rejected applications visible on the Accepted tab

Rejecting an application moved it out of jury_review, so the row simply
vanished and the tab read as a queue that silently shrank. Rejected rows
are fetched back and merged, filtered on gate2_decision rather than
status — the Rejected tab's rows are overwhelmingly gate-1 rejections
that never reached this screen.

Rows sort pending, then accepted, then rejected, so outstanding work
stays at the top."
```

---

## Task 5: Show the decision on the row, and filter by it

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminSelectedApplications.jsx`
- Modify: `frontend/src/styles/admin-portal.css`
- Modify: `frontend/src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`

**Interfaces:**
- Consumes: `decisionStateOf(app, doc)` from Task 4.
- Produces: sticky key `admin.selected` / field `decision`, values `'all' | 'pending' | 'accepted' | 'rejected'`.

- [ ] **Step 1: Write the failing chip + filter test**

Append to `AdminSelectedApplications.decisionState.test.jsx`:

```jsx
import { fireEvent } from "@testing-library/react";

describe("AdminSelectedApplications — decision presentation", () => {
  it("marks each row with its decision chip", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    expect(screen.getByTestId("decision-s1").textContent).toBe("ACCEPTED");
    expect(screen.getByTestId("decision-s2").textContent).toBe("PENDING");
    expect(screen.getByTestId("decision-g2").textContent).toBe("REJECTED");
  });

  it("tints the row by decision", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    expect(screen.getByTestId("row-s1").className).toContain("adm-row-accepted");
    expect(screen.getByTestId("row-g2").className).toContain("adm-row-rejected");
    expect(screen.getByTestId("row-s2").className).not.toContain("adm-row-");
  });

  it("narrows to a single decision category", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    expect(screen.getByText("Gate2 Reject")).toBeInTheDocument();
    expect(screen.queryByText("Signed App")).toBeNull();
    expect(screen.queryByText("Pending App")).toBeNull();
  });

  it("composes the decision filter with the track filter", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    // Every fixture row is TIR, so an accepted+VIP intersection is empty.
    expect(screen.queryByText("Signed App")).toBeNull();
  });

  it("does not offer Reject on an already-rejected row", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    const row = screen.getByTestId("row-g2");
    expect(row.textContent).not.toContain("Reject");
    expect(row.querySelector("button[disabled]")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`
Expected: FAIL — no `decision-*` or `row-*` test ids exist, and there is no button named "Rejected".

- [ ] **Step 3: Add the decision filter state**

Next to the existing sticky state:

```jsx
  const [decision, setDecision] = useStickyState("admin.selected", "decision", "all");
```

Add the filter to the `rows` memo — insert this line directly after the `track` filter and before the search filter:

```jsx
      .filter((s) => decision === "all"
        || decisionStateOf(s, byKey[keyOf(nativeOf(s), s.id)]) === decision)
```

and add `decision` to the memo's dependency array.

- [ ] **Step 4: Render the decision segmented control**

Directly after the existing `lp-track-group` div in the toolbar row, add:

```jsx
        <div className="lp-track-group" role="group" aria-label="Filter by decision">
          {[["all", "All"], ["pending", "Pending"], ["accepted", "Accepted"], ["rejected", "Rejected"]]
            .map(([v, label]) => (
              <button
                key={v}
                className={`lp-track-btn${decision === v ? " active" : ""}`}
                aria-pressed={decision === v}
                onClick={() => setDecision(v)}
              >
                {label}
              </button>
            ))}
        </div>
```

Note there are now two `All`-ish labels in the toolbar — the track group's is `All tracks`, this one is `All`. Keep them distinct so `getByRole("button", { name: "All" })` is unambiguous.

- [ ] **Step 5: Add the Status column**

In `<thead>`, insert between the Memo and Actions headers:

```jsx
                <th>Status</th>
```

In the row body, compute the state once at the top of the `rows.map` callback:

```jsx
                const doc = byKey[keyOf(nativeOf(s), s.id)];
                const state = decisionStateOf(s, doc);
```

Change the `<tr>` opening tag to:

```jsx
                  <tr key={s.id} data-testid={`row-${s.id}`}
                    className={state === "pending" ? "" : `adm-row-${state}`}>
```

and insert this cell between the Memo `<td>` and the Actions `<td>`:

```jsx
                    <td>
                      <span className={`os-chip adm-decision adm-decision-${state}`}
                        data-testid={`decision-${s.id}`}>
                        {state.toUpperCase()}
                      </span>
                    </td>
```

- [ ] **Step 6: Lock the actions on a rejected row**

Replace the Actions cell's button group with:

```jsx
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="os-btn sm secondary"
                          disabled={state === "rejected"}
                          title={state === "rejected" ? "This application was rejected" : ""}
                          onClick={() => setUploadFor(s)}>
                          {doc ? "Replace Memo" : "Memo Upload"}
                        </button>
                        <button
                          className="os-btn sm"
                          style={doc && state !== "rejected" ? { background: "#3213b7", color: "#fff" } : undefined}
                          disabled={!doc || state === "rejected"}
                          title={state === "rejected"
                            ? "This application was rejected"
                            : (doc ? "" : "Upload the memo first")}
                          onClick={() => setSignFor(s)}
                        >
                          {doc?.signed ? "Re-approve" : "Approve"}
                        </button>
                        {/* Deliberately NOT gated on a memo: rejecting an
                            application should not require first uploading a
                            document about it. Hidden once the decision is made. */}
                        {state !== "rejected" && (
                          <button
                            className="os-btn sm"
                            style={{ background: "#fff0f0", color: "#d23b40", borderColor: "#f8c2c4" }}
                            title="Reject this application (final decision)"
                            onClick={() => setRejectFor(s)}
                          >
                            Reject
                          </button>
                        )}
                      </div>
```

- [ ] **Step 7: Add the row + chip CSS**

Append to `frontend/src/styles/admin-portal.css`:

```css
/* ── Accepted tab: decision state ─────────────────────────── */
/* Tint plus a left rule, so the state survives a greyscale print and does not
   rely on colour alone. */
.adm-portal .os-table tr.adm-row-accepted > td:first-child {
  box-shadow: inset 3px 0 0 #1d6b45;
}
.adm-portal .os-table tr.adm-row-accepted {
  background: #f2faf6;
}
.adm-portal .os-table tr.adm-row-rejected > td:first-child {
  box-shadow: inset 3px 0 0 var(--bad);
}
.adm-portal .os-table tr.adm-row-rejected {
  background: #fdf5f5;
}
.adm-portal .os-table tr.adm-row-accepted:hover { background: #e9f6ef; }
.adm-portal .os-table tr.adm-row-rejected:hover { background: #fbeaea; }

.adm-portal .adm-decision {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 9px;
  white-space: nowrap;
}
.adm-portal .adm-decision-accepted {
  background: #e9f6ef; border: 1px solid #b7ddc8; color: #1d6b45;
}
.adm-portal .adm-decision-rejected {
  background: #fdecec; border: 1px solid #f3c2c4; color: #b3262b;
}
.adm-portal .adm-decision-pending {
  background: var(--bg-soft); border: 1px solid var(--line); color: var(--ink-soft);
}
```

The accepted green is a literal, not a token: `admin-portal.css` defines `--bad` but has no `--good`. Do not invent one for this rule alone.

- [ ] **Step 8: Run the test and watch it pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`
Expected: PASS (13/13).

- [ ] **Step 9: Run the neighbouring suites**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminSelectedApplications`
Expected: all PASS. `AdminSelectedApplications.reject.test.jsx` exercises the Reject modal — if it now fails because its fixture row resolves to `rejected`, fix the **fixture**, not the hiding rule.

- [ ] **Step 10: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git add frontend/src/pages/admin/platform/screens/AdminSelectedApplications.jsx \
        frontend/src/styles/admin-portal.css \
        frontend/src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx
git commit -m "feat(admin): show accept/reject state on the Accepted tab

Each row carries a status chip and a tinted left rule — green once the IC
memo is approved, red once rejected — and a segmented filter narrows the
list to one category. Colour is never the only signal: the chip carries
the word too.

A rejected row's memo and approve actions are disabled and its Reject
button is gone; the decision is already made."
```

---

## Task 6: One toolbar, one stylesheet

**Files:**
- Create: `frontend/src/pages/admin/platform/screens/ListToolbar.jsx`
- Create: `frontend/src/pages/admin/platform/screens/__tests__/ListToolbar.test.jsx`
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx:560-845`
- Modify: `frontend/src/styles/admin-portal.css:2141-2252`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```jsx
<ListToolbar
  search={string} onSearch={fn} searchPlaceholder={string} searchLabel={string}
  segments={[{ ariaLabel, value, onChange, options: [[value, label], …] }, …]}
  trailing={ReactNode}      // Clear-filters / Filters toggle live here
  count={number} total={number}
  panel={ReactNode}         // collapsible body; null when closed
/>
```

**Background the implementer needs — read before moving any CSS.** There are two copies of most `.lp-filter-*` rules: one in `AdminPipeline`'s inline `<style>` block (from line 560) and one in `admin-portal.css:2141-2252`. **The file copy wins every time** — it is prefixed `.adm-portal `, giving it specificity `(0,2,0)` against the inline block's `(0,1,0)`, regardless of source order. So most of the inline block is already dead code.

Rules that exist **only** in the inline block, and therefore actually take effect:
`.lp-active-chip`, `.lp-active-chip-x`, `.lp-active-chips`, `.lp-active-clear`, `.lp-filter-btn-group`, `.lp-filter-btn-group.active`, `.lp-filter-panel`, `.lp-filters-caret`, `.lp-filters-count`, `.lp-filters-toggle`, `.lp-filters-toggle.is-open`, `.adm-pipeline-note*`.

Everything else in that block is a dead duplicate: `.lp-filter-area`, `.lp-filter-row--search`, `.lp-filter-btn`, `.lp-filter-btns`, `.lp-filter-btn.active`, `.lp-filter-label`, `.lp-filter-section`, `.lp-clear-btn`, `.lp-count`, `.lp-track-group`, `.lp-track-btn`, `.lp-track-btn.active`.

**The empty band** in the Applications/Rejected screenshots comes from the live file copy, not the inline block: `.lp-filter-area` has `padding: 40px 40px 32px` and `.lp-filter-row--search` has `margin-bottom: 28px`. With the filter panel closed and no active chips that is 60px of dead space below the search card.

- [ ] **Step 1: Write the failing toolbar test**

Create `frontend/src/pages/admin/platform/screens/__tests__/ListToolbar.test.jsx`:

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ListToolbar from "../ListToolbar";

describe("ListToolbar", () => {
  it("renders a labelled search box and reports typing", () => {
    const onSearch = vi.fn();
    render(<ListToolbar search="" onSearch={onSearch}
      searchLabel="Search things" searchPlaceholder="Type…" count={0} total={0} />);
    const input = screen.getByLabelText("Search things");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onSearch).toHaveBeenCalledWith("abc");
  });

  it("renders each segment group with its options", () => {
    render(<ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={2} total={9}
      segments={[{ ariaLabel: "Track", value: "all", onChange: vi.fn(),
        options: [["all", "All tracks"], ["tir", "TIR"]] }]} />);
    expect(screen.getByRole("group", { name: "Track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "TIR" })).toBeInTheDocument();
  });

  it("marks the active segment with aria-pressed", () => {
    render(<ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={0} total={0}
      segments={[{ ariaLabel: "Track", value: "tir", onChange: vi.fn(),
        options: [["all", "All tracks"], ["tir", "TIR"]] }]} />);
    expect(screen.getByRole("button", { name: "TIR" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All tracks" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the count as 'n of total'", () => {
    render(<ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={3} total={12} />);
    expect(screen.getByText("3 of 12")).toBeInTheDocument();
  });

  it("collapses when there is no panel, and expands when there is", () => {
    const { rerender, container } = render(
      <ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={0} total={0} />);
    expect(container.querySelector(".lp-filter-area").className).toContain("is-collapsed");
    rerender(<ListToolbar search="" onSearch={vi.fn()} searchLabel="s" count={0} total={0}
      panel={<div>panel body</div>} />);
    expect(container.querySelector(".lp-filter-area").className).not.toContain("is-collapsed");
    expect(screen.getByText("panel body")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ListToolbar.test.jsx`
Expected: FAIL — `Failed to resolve import "../ListToolbar"`.

- [ ] **Step 3: Write `ListToolbar`**

Create `frontend/src/pages/admin/platform/screens/ListToolbar.jsx`:

```jsx
// One filter toolbar for every admin list screen.
//
// Before this existed there were three implementations of the same control:
// AdminPipeline's inline <style> block, admin-portal.css, and a hand-rolled
// copy in AdminSelectedApplications whose inline style objects overrode the
// shared class — which is why the identical track switcher rendered as a blue
// pill on one page and a grey square on the next.
//
// Segment groups are a list so a screen can carry more than one (track AND
// decision, say) and the second inherits the first's styling by construction
// rather than by someone remembering to copy it.

export default function ListToolbar({
  search, onSearch, searchPlaceholder = "Search…", searchLabel = "Search",
  segments = [], trailing = null, count = null, total = null, panel = null,
}) {
  // With no panel open the search card's bottom margin and the area's bottom
  // padding leave ~60px of empty band. Collapsing removes it.
  const collapsed = !panel;

  return (
    <div className={`lp-filter-area${collapsed ? " is-collapsed" : ""}`}>
      <div className="lp-filter-row--search">
        <div className="os-search-wrap" style={{ flexShrink: 0 }}>
          <input
            className="os-input search"
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        {segments.map((g, i) => (
          <div key={i} className="lp-track-group" role="group" aria-label={g.ariaLabel}>
            {g.options.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`lp-track-btn${g.value === v ? " active" : ""}`}
                aria-pressed={g.value === v}
                onClick={() => g.onChange(v)}
              >
                {label}
              </button>
            ))}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        {trailing}

        {count != null && (
          <span className="lp-count">
            {count}{total != null ? ` of ${total}` : ""}
          </span>
        )}
      </div>

      {panel && <div className="lp-filter-panel">{panel}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/ListToolbar.test.jsx`
Expected: PASS (5/5).

- [ ] **Step 5: Delete the dead half of AdminPipeline's inline CSS**

In `AdminPipeline.jsx`, inside the `<style dangerouslySetInnerHTML>` block starting at line 560, **delete** these rule blocks — every one is already defined with higher specificity in `admin-portal.css`, so deleting them changes nothing visually:

`.lp-filter-area`, `.lp-filter-row--search`, `.lp-filter-row--search .os-input.search`, `.lp-filter-row--search .os-input.search:focus`, `.lp-track-group`, `.lp-track-btn`, `.lp-track-btn:hover`, `.lp-track-btn.active`, `.lp-filter-section`, `.lp-filter-section:last-child`, `.lp-filter-label`, `.lp-filter-btns`, `.lp-filter-btn`, `.lp-filter-btn:hover`, `.lp-filter-btn.active`, `.lp-filter-btn .sdot`, `.lp-clear-btn`, `.lp-count`.

**Verify before moving on:** `cd frontend && npm run build` must succeed, and the Applications screen must be visually unchanged. If anything shifts, a rule you deleted was NOT a duplicate — restore it and move it in Step 6 instead.

- [ ] **Step 6: Move the live rules into the stylesheet**

Cut the remaining rules from the inline block — `.lp-filter-btn-group`, `.lp-filter-btn-group:hover`, `.lp-filter-btn-group.active`, `.lp-filter-btn-group .lp-filter-btn`, `.lp-filter-btn-group .lp-filter-btn-dots`, `.lp-filter-btn-group .lp-filter-btn-dots:hover`, `.lp-filter-btn-group.active .lp-filter-btn-dots`, `.lp-filter-btn-group.active .lp-filter-btn-dots:hover`, `.lp-filters-toggle`, `.lp-filters-toggle:hover`, `.lp-filters-toggle.is-open`, `.lp-filters-count`, `.lp-filters-caret`, `.lp-filters-toggle.is-open .lp-filters-caret`, `.lp-filter-panel`, `.lp-active-chips`, `.lp-active-chip`, `.lp-active-chip-x`, `.lp-active-clear`, `.lp-active-clear:hover` — and paste them into `admin-portal.css` immediately after the existing `.adm-portal .lp-count` rule (line 2245), **prefixing every selector with `.adm-portal `**.

Keep `.adm-pipeline-note`, `.adm-pipeline-note.is-ok`, `.adm-pipeline-note.is-error` and `.adm-pipeline-note-x` in the inline block — they are pipeline-specific, not shared toolbar chrome.

- [ ] **Step 7: Collapse the empty band**

In `admin-portal.css`, append after the rules you just moved:

```css
/* Filter area with nothing open — no panel, no chips. Without this the search
   card's 28px bottom margin plus the area's 32px bottom padding leave a ~60px
   empty band below the search row on Applications and Rejected. */
.adm-portal .lp-filter-area.is-collapsed {
  padding-bottom: 0;
}
.adm-portal .lp-filter-area.is-collapsed .lp-filter-row--search {
  margin-bottom: 24px;
}
```

- [ ] **Step 8: Apply the collapsed modifier in AdminPipeline**

`AdminPipeline` builds its filter area by hand rather than through `ListToolbar` (it carries a bespoke filter panel and chip row that no other screen has). Add the modifier to its existing markup — change:

```jsx
      <div className="lp-filter-area">
```

to:

```jsx
      <div className={`lp-filter-area${!filtersOpen && activeChips.length === 0 ? ' is-collapsed' : ''}`}>
```

- [ ] **Step 9: Verify the pipeline suites and the build**

Run:
```bash
cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline && npm run build
```
Expected: the same **2 pre-existing failures** (`AdminPipeline.test.js`, `AdminPipeline.unassign.test.jsx`) and no others; build succeeds.

- [ ] **Step 10: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git add frontend/src/pages/admin/platform/screens/ListToolbar.jsx \
        frontend/src/pages/admin/platform/screens/__tests__/ListToolbar.test.jsx \
        frontend/src/pages/admin/platform/screens/AdminPipeline.jsx \
        frontend/src/styles/admin-portal.css
git commit -m "feat(admin): one filter toolbar, one stylesheet

AdminPipeline carried a 270-line inline <style> block, most of which was
dead: admin-portal.css defines the same rules prefixed .adm-portal, so the
file copy won on specificity every time. The dead half is deleted and the
live half moved into the stylesheet.

Adds ListToolbar so list screens stop each rolling their own, and
collapses the ~60px empty band that the filter card left below the search
row when no panel was open."
```

---

## Task 7: Put every list screen on the shared toolbar

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminSelectedApplications.jsx`
- Modify: `frontend/src/pages/admin/platform/screens/AdminIiscRoster.jsx:180`
- Modify: `frontend/src/pages/admin/platform/screens/AdminJury.jsx:367`

**Interfaces:**
- Consumes: `ListToolbar` from Task 6, `decisionStateOf` and the `decision` sticky state from Tasks 4–5.
- Produces: nothing new.

**Scope note.** `AdminReviewers` and `AdminAudit` use `os-input` fields inside *forms*, not list toolbars — `AdminAudit`'s four inputs are a filter form with labelled fields, and `AdminReviewers`' are invite-form fields. Converting either to `ListToolbar` would be a redesign, not an alignment. They are left alone; the spec's §6.5 list is narrowed here to the three screens that genuinely have a search-plus-segments toolbar. Raise this with the user if the Audit screen's alignment still reads wrong after the change.

- [ ] **Step 1: Write the failing parity test**

Append to `frontend/src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`:

```jsx
describe("AdminSelectedApplications — shared toolbar", () => {
  it("uses the shared filter-area shell rather than a hand-rolled row", async () => {
    const { container } = render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    expect(container.querySelector(".lp-filter-area")).toBeTruthy();
    expect(container.querySelector(".lp-filter-row--search")).toBeTruthy();
  });

  it("styles its track switcher from the shared class, with no inline overrides", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    const tir = screen.getByRole("button", { name: "TIR" });
    // An inline background/border is what made this render as a grey square
    // while AdminPipeline's identical control rendered as a blue pill.
    expect(tir.getAttribute("style")).toBeNull();
    expect(tir.className).toContain("lp-track-btn");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`
Expected: FAIL — there is no `.lp-filter-area` on this screen, and the TIR button carries an inline `style` attribute.

- [ ] **Step 3: Replace the hand-rolled toolbar**

In `AdminSelectedApplications.jsx`, add the import:

```jsx
import ListToolbar from "./ListToolbar";
```

Replace the entire `<div className="os-row gap-sm" style={{ flexWrap: "wrap", … }}>…</div>` toolbar block — search input, `lp-track-group`, the decision group added in Task 5, and the count span — with:

```jsx
      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchLabel="Search selected applications"
        searchPlaceholder="Search project, founder or industry…"
        segments={[
          { ariaLabel: "Filter by track", value: track, onChange: setTrack,
            options: [["all", "All tracks"], ["tir", "TIR"], ["sip", "VIP"]] },
          { ariaLabel: "Filter by decision", value: decision, onChange: setDecision,
            options: [["all", "All"], ["pending", "Pending"], ["accepted", "Accepted"], ["rejected", "Rejected"]] },
        ]}
        count={rows.length}
        total={pipeline.data ? all.length : null}
      />
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminSelectedApplications.decisionState.test.jsx`
Expected: PASS (15/15).

If `AdminSelectedApplications.stickyFilters.test.jsx` now fails on a changed input selector, update the **test's** selector to `getByLabelText("Search selected applications")` — the label text is unchanged, so a failure there means the test was querying by placeholder.

- [ ] **Step 5: Convert the Academic Jury Roster toolbar**

In `AdminIiscRoster.jsx`, replace the bare search input at line 180 and the count span beside it with a `ListToolbar`, keeping the screen's existing filter state names. Import `ListToolbar` from `"./ListToolbar"`. Read the surrounding block first: keep every existing filter control by passing it through `trailing`, and keep any segmented control as a `segments` entry.

- [ ] **Step 6: Convert the Jury roster toolbar**

Same change in `AdminJury.jsx` at line 367 — the `os-input` with placeholder `"Search project or industry…"`.

`AdminJury` and `AdminIiscRoster` are unwired from navigation by Task 1 but stay on disk for next cohort; leaving them on deleted styling would hand that cohort a broken screen.

- [ ] **Step 7: Run every list-screen suite and the build**

Run:
```bash
cd frontend && npx vitest run \
  src/pages/admin/platform/screens/__tests__/AdminSelectedApplications \
  src/pages/admin/platform/screens/__tests__/AdminIiscRoster \
  src/pages/admin/platform/__tests__/AdminJury.test.jsx \
  src/pages/admin/platform/__tests__/AdminJury.render.test.jsx && npm run build
```
Expected: all PASS; build succeeds.

- [ ] **Step 8: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git add frontend/src/pages/admin/platform/screens/
git commit -m "refactor(admin): put the list screens on the shared toolbar

AdminSelectedApplications hand-rolled the same track switcher AdminPipeline
uses, then overrode the shared class with inline style objects — which is
exactly why one page showed a blue pill and the other a grey square. The
inline styles are gone and the shared class now wins.

AdminIiscRoster and AdminJury move onto the same toolbar; both are unwired
from navigation this cohort but stay on disk for the next one."
```

---

## Task 8: Whole-suite verification and push

**Files:** none modified.

- [ ] **Step 1: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: **2 failed / 99 files**, and the two must be exactly `AdminPipeline.test.js` and `AdminPipeline.unassign.test.jsx` — the documented pre-existing baseline. Passing count should be ≥ 601 plus every test added by this plan.

If any *other* file fails, fix it before continuing. If one of the two baseline files fails with a *different* error than at baseline, that is a regression, not the baseline — investigate.

- [ ] **Step 2: Confirm the baseline failures are unchanged**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency/frontend
npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.test.js \
               src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx 2>&1 | tail -30
```
Compare the failure messages against the same command run on a checkout of `6a682ba`. They must match.

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: exit 0, no warnings about unresolved imports.

- [ ] **Step 4: Confirm the backend is untouched**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git diff --stat 6a682ba..HEAD -- backend/
```
Expected: **empty output.** Any change here violates the plan's scope.

- [ ] **Step 5: Review the whole diff**

Run: `git diff 6a682ba..HEAD --stat`
Read it. Confirm no jury screen file was deleted, and that `AdminJury.jsx`, `AdminIiscRoster.jsx`, `AdminProfessorDetail.jsx` still exist.

- [ ] **Step 6: Push the branch**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/admin-ui-consistency
git push -u origin feat/admin-ui-consistency
```

Do **not** merge into `release/sip-launch-v1` or push to it without the user's say-so — they promote in Vercel themselves and will want to review the branch preview first.

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §3 Single-mode navigation | 1 |
| §3.3 Unwire not delete | 1 (imports kept, `AdminJury.render.test.jsx` added) |
| §4 Sequence-aware detail | 2 (plumbing + header), 3 (call sites) |
| §4.3 Gate-1 position persistence | 3 — **refined**: the `key` is retained because it re-seeds decision state; sticky state survives the remount anyway |
| §5.2 Row state | 4 (`decisionStateOf`) |
| §5.3 Rejected rows return, gate-2 filtered | 4 |
| §5.4 Presentation, disabled actions | 5 |
| §5.5 Decision filter | 5 (state + control), 7 (moved into shared toolbar) |
| §6.2 `ListToolbar` | 6 |
| §6.3 CSS consolidation | 6 |
| §6.4 Empty band | 6 |
| §6.5 Applied to list screens | 7 — **narrowed**: `AdminReviewers` and `AdminAudit` carry filter *forms*, not list toolbars; converting them is a redesign, not alignment. `AdminGate1` history has no search toolbar to share. |
| §7 Verification | every task, plus 8 |

**Deviations from the spec, both flagged inline above and worth the user's eye:** the Gate-1 `key` retention (§4.3) and the narrowed §6.5 screen list.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Two steps deliberately say "read the surrounding block first" (Task 7 Steps 5–6) because those two screens' filter state is screen-specific and inventing names for it here would be worse than reading it.

**Type consistency.** `decisionStateOf(app, doc)` returns `'accepted' | 'rejected' | 'pending'` and is used with those exact strings in Tasks 4, 5 and 7. `goDetail(id, track, fromPage, sequence)` has the same four-parameter shape at every call site. `seqPosition` is `{ index, total }` in both producer (Task 2 Step 7) and consumer (Task 2 Step 3). Sticky keys are `admin.gate1.stack`/`idx` and `admin.selected`/`decision`, used once each.
