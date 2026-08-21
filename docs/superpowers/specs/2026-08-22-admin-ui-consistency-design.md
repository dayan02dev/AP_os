# Admin portal — single-mode navigation, sequence-aware detail, decision states, list alignment

**Date:** 2026-08-22
**Branch:** `feat/admin-ui-consistency`
**Worktree:** `.claude/worktrees/admin-ui-consistency`
**Base:** `origin/release/sip-launch-v1` @ `6a682ba`
**Surface:** frontend only. No migration, no backend deploy.

Work only in that worktree — concurrent sessions cross-contaminate otherwise.

---

## 1. Why

Four requests, gathered from admin use of the live portal during the 2026 cohort:

1. The same control renders differently on different pages — the track switcher
   is a blue pill on Applications and a grey square on Accepted — and the
   Applications/Rejected filter card reserves a tall empty band under the search
   row even when no filter panel is open.
2. The jury round did not run this cohort, so the **Jury Decision** mode and its
   screens are dead weight in the admin's way. They must come back next cohort,
   so nothing may be deleted outright.
3. Opening an application from a list and coming back loses your place — the
   Gate-1 stack snaps to `1/355` every time — and there is no way to walk to the
   next application without returning to the list first.
4. The Accepted tab gives no at-a-glance sense of which applications have been
   dealt with. Rejected rows vanish entirely, so the tab reads as a queue that
   silently shrinks rather than a record of decisions.

## 2. Scope

In scope: the admin platform portal (`frontend/src/pages/admin/platform/**`) and
`frontend/src/styles/admin-portal.css`.

Out of scope, deliberately:

- **The backend.** Every endpoint, including all jury endpoints, is untouched.
- **The `/jury/*` juror portal.** Its routes stay in `router.jsx`, gated to the
  `jury` capability, so no admin ever sees them and next cohort needs no
  restoration. Confirmed with the user.
- **A full inline-style purge.** There are ~700 `style={{…}}` props across 21
  admin screens. §6 normalises the *list* surfaces only; detail screens
  (`AdminDetail`, `AdminGate1`, `AdminGate2`, `AdminDashboard`, `AdminRoles`,
  `AdminProfessorDetail`) keep their current styling. A full sweep is a separate
  push, not one that lands beside three behavioural changes.
- **Deleting any jury screen.** See §3.

---

## 3. Single-mode navigation

### 3.1 What `decisionMode` does today

`decisionMode` is not a filter — it swaps the entire tab strip:

| | reviewer mode | jury mode |
|---|---|---|
| tabs | Dashboard · Reviewers · Applications · Rejected · Accepted · Admin Review | Dashboard · Academic Jury Roster · Jury · Accepted · Final Gate |
| `reviewers` tab renders | `AdminReviewers` | `AdminJury` |
| `gate1` tab renders | `AdminGate1` ("Admin Review") | `AdminGate2` ("Final Gate") |

Two consequences matter. First, `gate1` and `gate2` share **one tab id**, so
removing jury mode without further change would make `AdminGate2` unreachable —
and `AdminGate2` is the only screen that issues offer / waitlist / on-hold /
reject. Second, the user's screenshots of the Accepted tab were taken in jury
mode, because that is how they have been reaching it.

### 3.2 Target

One flat tab strip, no toggle:

```
Dashboard · Reviewers · Applications · Rejected · Accepted · Admin Review · Final Gate
```

`gate1` → `AdminGate1` (label "Admin Review", sub "PENDING DECISIONS").
`gate2` → `AdminGate2` (label "Final Gate", sub "CONSOLIDATED DECISIONS"), a
**new tab id**, so both gates are reachable at once.

Removed from navigation: **Academic Jury Roster** (`iisc_roster`) and the
**Jury** roster screen.

### 3.3 Removal strategy: unwire, do not delete

`AdminJury.jsx`, `AdminIiscRoster.jsx` and `AdminProfessorDetail.jsx` stay on
disk with their existing tests still running. Only the tab entries and the
`page === 'iisc_roster'` render branch go.

Screens that branch internally on `decisionMode` — `AdminPipeline` (5 branches),
`AdminDetail` (2 branches) — **keep those branches**. The portal simply stops
passing the prop, so it arrives `undefined`: every `decisionMode !== 'jury'`
branch is taken and every `=== 'jury'` branch is skipped, which is exactly
reviewer behaviour. `AdminReviewers` accepts the prop but never reads it; the
prop is dropped at the call site.

This is deliberate. Deleting the branches would churn five test files
(`AdminPipeline.juryLabel`, `AdminTabBar`, `AdminPipeline.test.js`, …) to remove
coverage we want back next cohort. Restoring jury mode later becomes re-adding
the toggle and the tab entries — the screens and their code paths never left.

### 3.4 Changes

**`AdminPortal.jsx`**

- Delete `const [decisionMode, setDecisionMode] = React.useState('reviewer')` and
  the `React.useEffect` that normalises `page` across modes. Keep the legacy
  `jury_tir` / `jury_vip` → `jury_selected` redirect, moved into a mount-time
  effect.
- `AdminCohortHeader`: remove the `lp-toggle-control` block and the
  `decisionMode` / `setDecisionMode` props. The User Roles button stays.
- `AdminTabBar`: drop the `decisionMode` prop and the whole jury branch; return
  the seven-tab list above. Badge props are unchanged.
- Render map: `reviewers` → `AdminReviewers`; add `gate2` → `AdminGate2`;
  `gate1` → `AdminGate1`; delete the `iisc_roster` branch. Stop passing
  `decisionMode` to `AdminPipeline`, `AdminReviewers`, `AdminDetail`.
- `AdminTopbar` loses its `decisionMode` prop.

**Tests**

- `AdminTabBar.test.jsx` — replace the two mode cases with one asserting the
  seven tabs, in order, and no "Jury Decision" control. Keep the merged-Accepted
  case.
- `AdminPortal.juryMode.test.jsx` → rename to `AdminPortal.tabs.test.jsx`. Drop
  the `fireEvent.click(getByText("Jury Decision"))` step from every case. Keep
  the Final Gate and Selected Applications render cases (they guard a real
  missing-import trap that `vite build` cannot catch). The AdminJury case moves
  to a direct-render test in a new `AdminJury.render.test.jsx`, so that trap
  stays guarded for a screen that is no longer reachable by clicking.
- The nine other files passing `decisionMode` to `AdminPipeline` /
  `AdminReviewers` directly are unaffected — those props still exist.

---

## 4. Sequence-aware detail navigation

### 4.1 Root causes

Two independent bugs produce the reported behaviour.

**Prev/Next never appear.** `AdminDetail` already accepts and renders
`onPrev` / `onNext` (`AdminDetail.jsx:348-349`). `AdminPortal` computes them
from `window.OS_DATA?.STARTUPS` — prototype seed data that is empty in
production. So `startups = []`, `currentIdx = -1`, both guards fail, both props
arrive `null`, and only the lone Back button renders.

**The Gate-1 stack resets.** `GateReviewStack` holds its position in
`useState(0)` (`AdminGate1.jsx:174`). Navigating to the detail view unmounts the
whole screen, so the position is lost and returning shows `1/355`. A second
cause compounds it: `AdminGate1` renders the stack with
`key={"stack-" + evalRows.length}`, so any change in row count forces a remount
and wipes the index even without navigation.

### 4.2 Target

`goDetail` carries the sequence the caller was showing:

```js
goDetail(id, track, fromPage, sequence)
// sequence: [{ id, track }, …] — the caller's list, in its CURRENT
// filtered and sorted order, not the unfiltered server order.
```

`AdminPortal` stores it in `detailSeq` and derives
`seqIdx = detailSeq.findIndex(r => r.id === selectedStartupId)`.

- `onPrev` / `onNext` move `selectedStartupId` and `selectedTrack` along
  `detailSeq`; each is `null` at its end so the button disables.
- Callers that pass no sequence get `[]`, both props stay `null`, and the header
  renders exactly as it does today. No caller is forced to opt in.
- Walking with Prev/Next **advances the shared position**, so returning lands on
  the application you stopped at, not the one you entered from.

**Header layout.** `← Back to applications` moves to the left of the header
actions area; the Prev/Next pair groups on the right with a position label
between them:

```
[← Back to applications]                    [← Prev]  12 / 120  [Next →]
```

The label is `{seqIdx + 1} / {detailSeq.length}`, hidden when there is no
sequence.

### 4.3 Position persistence

`GateReviewStack`'s `idx` becomes
`useStickyState("admin.gate1.stack", "idx", 0)` — the same sessionStorage-backed
hook the portal filters already use, so the position survives both the detail
round-trip and a page reload, and a closed tab starts clean.

The `key={"stack-" + evalRows.length}` remount is replaced by a
`useEffect` that clamps `idx` into range when `evalRows.length` shrinks. The
existing `safeIdx = Math.min(idx, Math.max(0, total - 1))` guard already handles
render-time clamping; the effect writes the clamped value back so a stale index
does not persist.

### 4.4 Call sites

| Screen | Sequence passed |
|---|---|
| `AdminGate1` — `GateReviewStack` | `items` in stack order |
| `AdminGate1` — batch + history tabs | their rendered row order |
| `AdminPipeline` (Applications **and** Rejected) | `rows` after filter + sort |
| `AdminSelectedApplications` (Accepted) | `rows` after filter + search |

`AdminPipeline` serves both the Applications and Rejected tabs from one
component, so a single change covers "also make this change in the application
tab section".

---

## 5. Accepted-tab decision states

### 5.1 What the buttons currently do

- **Approve** signs the IC memo PDF in the browser and uploads the signed copy.
  It does **not** change application status. A signed memo already shows a
  `✓ APPROVED` chip, but only inside the Memo cell.
- **Reject** calls `decideGate2(…, {decision: 'rejected'})`, which writes a
  gate-2 `admin_decisions` row and moves status `jury_review → rejected`.

The tab lists `useAdminData("pipeline", { status: "jury_review" })`. So a
rejected row leaves the list immediately and there is nothing left to colour red.

### 5.2 Row state

Per the user's decision, the highlight tracks **the buttons on this screen**,
not the Final Gate outcome:

```js
rejected  ← s.gate2_decision === 'rejected'
accepted  ← doc exists && doc.signed === true
pending   ← neither
```

`gate2_decision` is already present on every pipeline row —
`admin_query.fetch_pipeline` merges `_fetch_jury_v2_metrics` unconditionally
(`admin_query.py:368, 515`), and `adaptPipelineRow` already maps it
(`adminDataAdapter.js:94`). **No backend change.**

### 5.3 Making rejected rows visible again

A second fetch, `useAdminData("pipeline", { status: 'rejected' })`, keeping only
rows where `gate2_decision === 'rejected'`.

The `gate2_decision` filter is what makes this correct: the Rejected tab holds
~120 applications, the overwhelming majority rejected at **gate 1**, which never
reached this tab and must not appear on it. Only a gate-2 rejection means "this
application was on the Accepted tab and was rejected there".

The two lists merge, de-duplicated on `${track}:${id}`, and sort with pending
first, then accepted, then rejected, each group newest-submitted first — so the
tab still opens on work outstanding.

The `of N` count in the toolbar counts the merged set.

### 5.4 Presentation

- Row tint and left border via `.adm-row-accepted` / `.adm-row-rejected` classes
  in `admin-portal.css`, using the existing `--good` / `--bad` tokens. Not
  inline styles.
- A new **Status** column between Memo and Actions carrying an
  `ACCEPTED` / `REJECTED` / `PENDING` chip, reusing `os-chip` tones. The Memo
  cell keeps its existing `✓ APPROVED` detail — that describes the document;
  the new column describes the application.
- On a rejected row, **Memo Upload / Replace Memo** and **Approve** are disabled
  with a title explaining why. **Reject** is hidden — the decision is already
  made. Rejected rows stay clickable through to the detail view.

### 5.5 Filter

A segmented control `All · Pending · Accepted · Rejected` in the shared toolbar
beside the track switcher, persisted as
`useStickyState("admin.selected", "decision", "all")` — matching the existing
`admin.selected` search and track keys.

Track filter and decision filter compose (both applied), and both filter on the
**effective** track, as the track filter does today.

---

## 6. List-surface alignment

### 6.1 Root cause

Three competing definitions of the same controls:

| Source | Defines |
|---|---|
| `AdminPipeline.jsx` inline `<style>` (≈270 lines, from :561) | `.lp-filter-*`, `.lp-filters-toggle`, `.lp-filter-panel` |
| `admin-portal.css:2253` | `.lp-track-group`, `.lp-track-btn` |
| `AdminSelectedApplications.jsx` | the same track switcher, hand-rolled with inline style objects |

That is why one page shows a blue pill and the next a grey square.

### 6.2 `ListToolbar`

New `screens/ListToolbar.jsx` — one markup shape for every admin list surface:

```jsx
<ListToolbar
  search={search} onSearch={setSearch} searchPlaceholder="…" searchLabel="…"
  segments={[…]}                     // optional; renders the track switcher
  filters={<FilterPanel/>}           // optional; renders the Filters button + panel
  activeFilterCount={n}
  count={rows.length} total={all.length}
/>
```

The right-aligned count, the search field and the segment group get one set of
dimensions. Additional segment groups (the §5.5 decision filter) pass through
`segments` as a second group, so they inherit the same styling by construction.

### 6.3 CSS consolidation

- Move `.lp-filter-*`, `.lp-filters-toggle`, `.lp-filters-count`,
  `.lp-filters-caret`, `.lp-filter-panel` from `AdminPipeline`'s inline block
  into `admin-portal.css` under `.adm-portal`. Delete the inline block.
- Keep exactly one `.lp-track-group` / `.lp-track-btn` definition; delete the
  duplicate.
- New `.adm-list-shell` wrapper fixing, for every list page: max-width, page
  header spacing, toolbar→table gap, and table density.
- Table shell: one rule set for `.adm-portal .os-table` `th`/`td` padding,
  first/last-cell gutters, `.num` right-alignment, and header row treatment.
  The two current `.os-table` blocks (`admin-portal.css:671` and `:2303`) are
  merged into one.

### 6.4 The empty band

On Applications and Rejected the filter card reserves the collapsed filter
panel's height, leaving the tall empty band visible in the screenshots. The
panel container collapses to zero height when closed, so the card wraps only the
search row.

### 6.5 Applied to

Applications, Rejected (both `AdminPipeline`), Accepted
(`AdminSelectedApplications`), `AdminReviewers`, `AdminAudit`,
`AdminIiscRoster`, `AdminJury`, and the `AdminGate1` history tab.

`AdminIiscRoster` and `AdminJury` are restyled even though §3 unwires their
tabs — leaving them on a deleted stylesheet would hand next cohort a broken
screen.

---

## 7. Verification

**Must stay green.** Every existing admin suite, in particular
`AdminPipeline.*` (8 files), `AdminSelectedApplications.*` (3),
`AdminGate1`, `AdminGate2`, `AdminReviewers.*`, `AdminIiscRoster.*`,
and the four admin `*.stickyFilters.test.jsx` files.

**New tests.**

| Area | Assertion |
|---|---|
| §3 | Tab strip renders the seven tabs in order; no "Jury Decision" control anywhere |
| §3 | Final Gate tab renders `AdminGate2` without throwing |
| §3 | `AdminJury` renders directly without throwing (missing-import guard for the unwired screen) |
| §4 | Prev/Next walk the passed sequence and disable at each end |
| §4 | With no sequence, neither button renders |
| §4 | Gate-1 stack index survives a detail round-trip |
| §5 | Row state resolves correctly for signed / gate-2-rejected / neither |
| §5 | A gate-1 rejected row does **not** appear on the Accepted tab |
| §5 | The decision filter narrows to each category and composes with the track filter |

Per this project's standing rule on vacuous tests: every new test is run against the
**unmodified** code first and must fail for the right reason before the
implementation lands. The gate-1-exclusion case in §5 is the one most likely to
pass vacuously — a fixture with no gate-1 rejects would satisfy it trivially —
so its fixture must contain one.

**Build.** `vite build` clean.

**Backend.** Untouched. `pytest` is run once over the admin-adjacent suites to
confirm no accidental coupling, not as a gate on frontend work.

## 8. Risk and deploy

Frontend-only: no migration, no SAM deploy, no `.env` change. The user promotes
in Vercel.

Two risks worth naming:

1. **§6 touches shared CSS every admin screen reads.** A regression here is
   visual, not functional, and no test in this repo asserts CSS. Mitigation:
   consolidation is move-then-delete, never rewrite — rules keep their existing
   declarations, and the merge is verified by diffing computed rule sets rather
   than by eye alone.
2. **§5's second fetch adds one pipeline call** (~120 rows) to the Accepted tab.
   Acceptable at this scale; the PostgREST 1000-row cap is not in play.

## 9. Decisions taken

1. **Final Gate survives jury-mode removal** as its own tab. Removing it would
   leave no way to issue an offer.
2. **Unwire, do not delete** the jury screens — they return next cohort.
3. **Green = memo signed**, not a Final Gate offer. The highlight reflects the
   buttons on that screen.
4. **Alignment is scoped to list surfaces.** The ~700 inline style props on
   detail screens are a separate push.
5. **`/jury/*` juror routes stay.** Capability-gated, invisible to admins.
