# VIP Phase 6 — Process dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 29-line `VipDashboard.jsx` placeholder with the landing screen of a VIP founder's portal: four stat tiles (the fourth dark) then five panels, matching the TIR residency dashboard's visual grammar, with every value derived from the AIR and MIS backends — nothing hardcoded, nothing new stored.

**Architecture:** Two backends are frozen and unmodified — `GET /founder/air` (the current AIR round, one call, no history) and `GET /founder/mis` + `GET /founder/mis/{kind}/{period_key}` (the period calendar plus per-period detail, no bulk read). This phase adds **no backend code**. `VipDashboard.jsx` fetches `me`, `air`, the MIS index, then every monthly and quarterly period's bundle (bounded — a venture owes at most a few dozen periods), and feeds all of it through a new pure module, `vipDashboardRollup.js`, that computes every tile/panel value. Components stay presentational; `VipDashboard.jsx` is the only place that fetches.

**Tech Stack:** React 18, react-router-dom, Vitest + @testing-library/react, the existing `founderApi` client, `StatTile`, `AirBar`, and the `Tile`/`fmtL` atoms from `ui.jsx`.

**Spec:** `docs/superpowers/specs/2026-08-15-vip-onboarding-design.md` §6 ("VIP process dashboard")

**State doc:** `docs/superpowers/VIP_BUILD_STATE.md` — read "Founder UI conventions" and "Standing constraints for later phases" before Task 1. Phases 4 (AIR wizard) and 5 (MIS forms) are both shipped; `founderApi` already carries every AIR and MIS thunk this phase needs.

---

## Global Constraints

- **Backend is frozen — no edit under `backend/`.** `air_query.py`, `air_scoring.py`, `mis_query.py`, `mis_periods.py`, `founder_air.py`, `founder_mis.py` are shipped and reviewed. If a tile appears to need data no existing response carries, that is not license to add an endpoint — see "Open questions" below; raise it, do not build around it silently.
- **Do not edit `frontend/src/lib/founderApi.js`.** Every thunk this phase needs already exists: `me`, `getAir`, `getMis`, `getMisPeriod(kind, periodKey)`. No AIR-round-history thunk exists because no such endpoint exists (see Open Question 2).
- **New CSS lives in `frontend/src/styles/vip-dashboard.css`, imported by `VipDashboard.jsx`.** Do not edit `frontend/src/styles/founder-portal.css` — another agent is editing it concurrently. Read it (read-only) where this plan tells you to confirm a class's geometry; never write to it. New classes are prefixed `vipd-` so they can never collide with `founder-portal.css`'s `fj-*`/`eir-*` classes.
- **Reuse `AirBar`, `StatTile`, and `Tile` unchanged.** Do not fork or restyle `AirBar.jsx` — Phase 6 is the reason it was built standalone. `StatTile.jsx` and the `Tile`/`fmtL`/`Loading`/`ErrorState` atoms in `ui.jsx` are equally reusable as-is; this phase adds no new stat-tile or k/v-tile component.
- **Reuse existing CSS shapes before inventing new ones.** `founder-portal.css` already styles `.fj-dash-tiles` (the 4-up grid), `.fj-dash-header`/`.fj-dash-sub` (header), `.fj-dash-two`/`.fj-dash-card`/`.fj-dash-card-title`/`.fj-dash-card-head` (panel shells), `.fj-dash-feed-list`/`.fj-dash-feed-row`/`.fj-dash-feed-dot`/`.fj-dash-feed-text`/`.fj-dash-feed-meta` (the exact row shape the activity feed needs), and `.fj-dash-exp-row`/`.fj-dash-exp-dot`/`.fj-dash-exp-short`/`.fj-dash-exp-status`/`.fj-dash-exp-range` (a labelled row with a status dot — reused for milestones). `vip-dashboard.css` only needs to add what genuinely does not exist: the scorecard's overall-rule marker, the trend small-multiples, and the risk-severity badge.
- **Never recompute a date the backend already derived.** `periods_index` (inside `GET /founder/mis`) already computes `overdue` server-side, in IST, the timezone this project has shipped a real bug around before (see VIP_BUILD_STATE's "Dates are IST" constraint). Every day-one-state branch in this plan is built from `status`/`overdue` fields the backend already returns — never from a frontend `due_date <= today` comparison, which would silently disagree with the backend's own flag across a boundary. The one exception is the cosmetic "days remaining" count on the Next-due tile, which is display-only and documented as such in Task 1.
- **`assessment_bundle` recomputes `rollups.claimed` on every read, regardless of round status.** A `draft` round with all six levers answered already has real, non-null `claimed` rollups — only `verified` is gated by an admin surface that does not exist yet (Phase 7). Do not gate the claimed numbers on `round.status === "submitted"`; that would show "—" for a genuinely-complete draft, which is wrong.
- Never put Co-Authored-By, Claude, Anthropic or any AI reference in a commit message. Commits are solely authored by the repo owner.
- Frontend tests run with `cd frontend && npx vitest run`. Every task ends green.

---

## Open questions — raise before implementing, do not invent a formula

The spec gives the tile/panel list (§6) but not every formula behind it, and two of the gaps below are not formula ambiguity at all — they are data the founder-facing API structurally cannot produce today. Both classes must be raised, not silently resolved. Each entry below states the safe, non-inventive default this plan ships in the meantime, so the dashboard is honest rather than blocked.

1. **AIR rounds carry no due date.** `vip_air_assessments` (spec §4.6) has no `due_date` column, and spec §4.5 never states a due-date rule for a round the way §5.1 states one for MIS periods (5th of the following month / 15th of the month after quarter-end). Tile 4 ("the next MIS period **or AIR round**, with days remaining") cannot compare an MIS due date against an AIR round that has none. **Default shipped here:** Tile 4 surfaces only the next MIS period; the AIR branch is omitted, not guessed. Raise with the spec owner: what is a round's due date?

2. **No founder-facing endpoint returns any AIR round other than the current IST quarter's.** `GET /founder/air` always resolves via `founder_air._label()` to `air_query.current_round_label(today)` — there is no `round_label` path or query parameter, and no endpoint lists `vip_air_assessments` history for a founder. This blocks Tile 1's "delta against the previous round" and the entire "AIR trajectory" panel as specced (per-round-over-time). **Default shipped here:** the delta is omitted from Tile 1 (not shown as zero, not hidden as if there were nothing to show — see Task 7's exact copy); the AIR Trajectory panel (Task 3) renders the one point it can reach plus a permanent, non-error-styled note explaining why history is not available. Raise with the spec owner: is a new read-only endpoint in scope, or does trajectory wait for Phase 7's admin surface?

3. **"Reporting compliance — submitted-on-time over total due."** Two sub-gaps: (a) "on-time" needs each submitted period's `submitted_at` compared to its `due_date`; `submitted_at` is on the full period bundle, not on `periods_index`'s list rows, so true on-time compliance costs one extra fetch per submitted period on top of the fetches this plan already makes for every period (Task 1 already fetches every bundle, so the data is technically available — but "on-time" was never confirmed as the intended definition, only implied by the tile's own name). (b) "total due" itself is undefined: every period whose due date has passed (submitted + overdue), or every period generated so far including ones not yet due? **Default shipped here:** `reportingCompliance` counts `status === "submitted" || overdue` as "due" (composed from fields the backend already derived, sidestepping Open Question item on IST dates entirely) and reports `submitted / due` — with no on-time claim in the copy ("X of Y periods filed", not "on time"). Raise with the spec owner: does the tile need to additionally penalise a late-but-submitted period, and is "due" the right set?

4. **"Cash & runway" tile's runway value.** `runway_months` is a founder-typed MIS metric (`computed: False` in `mis_catalog.METRICS`), not derived from `cash_in_bank`/`net_burn_month` anywhere in the backend. The dashboard could either display the founder's own typed figure, or independently compute `cash_in_bank / net_burn_month` — and the two can disagree. Inventing the second one here is exactly the class of bug flagged in this project's own history (a headcount figure that shipped with a silent sign error). **Default shipped here:** the tile reads `runway_months.actual` verbatim; it does not recompute anything. Raise with the spec owner: should the tile flag a mismatch against `cash_in_bank / net_burn_month` rather than silently trusting one source?

5. **Tile 1's delta — which rollup?** Even setting aside Open Question 2's data gap, the spec's "delta against the previous round" does not say whether it diffs `claimed` or `verified`. Since `verified` is null for every lever of every venture today (no admin surface — Phase 7), a verified-only delta would never render for the foreseeable future. **Default shipped here:** moot until Open Question 2 is resolved, since no previous round is reachable either way; when it is, this still needs an explicit answer before the delta is wired up.

6. **"This period" feed's "milestone status flips."** Spec §6 names this as an event type. `vip_mis_entries` rows carry no `updated_at` and no identity that survives a carry-forward re-insert (`_replace_entries_section` deletes and reinserts fresh rows every write), so there is no reachable signal for "this milestone moved from On Track to At Risk between period N and N+1" without either a schema change or a fragile title-text-match heuristic across two periods. **Default shipped here:** the feed (Task 4) includes only events with a real stored timestamp — MIS period `submitted_at`/`reopened_at`, AIR round `submitted_at`/`verified_at` — and does not attempt to detect a milestone flip. Raise with the spec owner before ever approximating this with a title-match heuristic.

---

## The failure mode this build must not repeat

Five defects in Phase 3 were one shape: a null or empty state with two distinct causes, rendered with a single message that is only true for one of them. A process dashboard is almost entirely empty and near-empty states, so this shape will recur more here than anywhere else in the VIP build unless every one of them is enumerated with its own copy, naming which cause it belongs to.

| # | State | Where it shows | Cause | Copy |
|---|---|---|---|---|
| 1 | `verified_level` null on every lever | Tile 1, AIR Scorecard panel | Structural — no admin verification surface exists yet (Phase 7). Not a bug, not "no data." | Primary number is the **claimed** overall, always; a small badge reads "Awaiting ARTPARK verification" instead of showing a blank verified figure. |
| 2 | AIR round `draft`, zero levers answered | AIR Scorecard panel | Founder has not started this quarter's round. | "You haven't started this quarter's AIR self-assessment yet." All six `AirBar`s still render (with dashes) — never hidden. |
| 3 | AIR round `draft`, some but not all levers answered | AIR Scorecard panel | In progress. One family's rollup can be a real number while the other, and Overall, are still null (`_family_min` is per-family) — this is correct, not a bug. | "Technology / Commercial / Overall AIR appear once every lever in that group has an answer." The overall-rule marker (Task 2) does not render, because there is no overall value to mark. |
| 4 | AIR round `draft`, all six levers answered | AIR Scorecard panel | Claimed rollups are real (see Global Constraints); nothing has been submitted. | "Draft — submit your scorecard from TLR evaluation to send it for ARTPARK review." |
| 5 | AIR round `submitted` | AIR Scorecard panel, AIR Trajectory panel | Waiting on an admin action that cannot happen yet. | "Submitted {date} — awaiting ARTPARK verification." |
| 6 | Zero MIS periods submitted, **nothing overdue** | Metric Trend panel, Cash & Runway tile, Milestones & Risks panel | Genuinely too early — the founder's first period has not come due. | "No monthly update filed yet — your first one is due {due_date}." |
| 7 | Zero MIS periods submitted, **N periods overdue** | Metric Trend panel, Cash & Runway tile, Milestones & Risks panel | Behind on filing — a real backlog. **This is the exact two-causes-one-message trap**: states 6 and 7 must never share copy. | "No monthly update filed yet — {N} period(s) are overdue, starting with {oldest label} (due {oldest due_date})." |
| 8 | Exactly one MIS period submitted | Metric Trend panel | A delta/trend has no basis yet — not an error. | Renders the single point normally, with a caption: "First reported period — a trend appears after your second submission." |
| 9 | Reporting compliance: nothing due yet | Tile 2 | Same cause as state 6, reused. | "Nothing due yet" — never "0%" (division by zero must not render as a percentage). |
| 10 | Reporting compliance: something due, none submitted | Tile 2 | Same cause as state 7, reused. | "0% · {N} overdue." |
| 11 | Next due: no draft period exists at all | Tile 4 | Fully caught up — everything generated so far has been submitted before its due date. Distinct from "nothing generated yet," which cannot happen for an onboarded founder (`ensure_periods` always generates at least the current period). | "All caught up — nothing due right now." |
| 12 | Milestones & Risks panel: a current period exists but has zero milestones or zero risks | Milestones & Risks panel | Single-cause — a period existing but its list being empty is not ambiguous the way "no period submitted at all" is. | "No open milestones this period." / "No risks reported this period." (independent, not a shared empty state). |

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/styles/vip-dashboard.css` | *Create.* Only what `founder-portal.css` does not already provide: the scorecard overall-rule marker, trend small-multiples, risk-severity badge. |
| `frontend/src/pages/founder/vipDashboardRollup.js` | *Create.* Every derived value as a pure function — no fetching, no React. The load-bearing file for the Open Questions defaults. |
| `frontend/src/pages/founder/components/AirScorecardPanel.jsx` | *Create.* Six `AirBar`s grouped Technology/Commercial, rollup `Tile`s, the overall-rule marker, all four AIR states (2-5 above). |
| `frontend/src/pages/founder/components/AirTrajectoryPanel.jsx` | *Create.* The one reachable AIR data point plus the explicit "history not available" note (Open Question 2). |
| `frontend/src/pages/founder/components/ActivityFeedPanel.jsx` | *Create.* Real-event "This period" feed, replacing TIR's hardcoded `feed` array — reuses `.fj-dash-feed-*` classes unchanged. |
| `frontend/src/pages/founder/components/MetricTrendPanel.jsx` | *Create.* Small multiples across submitted monthly periods: revenue, cash, runway, headcount, deployments, TRL. |
| `frontend/src/pages/founder/components/MilestonesRisksPanel.jsx` | *Create.* Open milestones by status chip, open red/amber risks. |
| `frontend/src/pages/founder/VipDashboard.jsx` | *Rewrite.* Fetch orchestration, header, four `StatTile`s, wires every panel above. |
| `frontend/src/pages/founder/__tests__/vipDashboardRollup.test.js` | *Create.* |
| `frontend/src/pages/founder/__tests__/AirScorecardPanel.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/AirTrajectoryPanel.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/ActivityFeedPanel.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/MetricTrendPanel.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/MilestonesRisksPanel.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/VipDashboard.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx` | *Modify.* Its one dashboard assertion still checks for the placeholder's "Your programme dashboard" copy — update it to the real dashboard's content, the same way Phase 4's Task 5 updated this file's AIR placeholder assertion. |

---

### Task 1: `vipDashboardRollup.js` — every derived value, as pure functions

**Files:**
- Create: `frontend/src/pages/founder/vipDashboardRollup.js`
- Test: `frontend/src/pages/founder/__tests__/vipDashboardRollup.test.js`

**Interfaces:**
- Consumes: plain data shaped exactly like `founderApi.getAir()`'s response (`air_query.assessment_bundle`), `founderApi.getMis()`'s response (`{catalog, monthly: [...], quarterly: [...]}`, each row `{period_key, label, status, due_date, overdue}`), and an array of `founderApi.getMisPeriod(kind, key)` responses (`mis_query.period_bundle` — `{catalog, period, metrics, financials, headcount, entries, narrative, derived}`).
- Produces (every later task imports these by name, with this exact signature — locked here so Tasks 2-7 cannot drift on parameter order):
  - `misEmptyReason(periodRows)` → `null | {cause: "not_due_yet", due_date, due_label} | {cause: "overdue_backlog", count, oldest_label, oldest_due}`. `periodRows` is one kind's array (e.g. `mis.monthly`), never the combined index.
  - `reportingCompliance(mis)` → `{total_due, submitted, pct}`. `mis` is the whole `getMis()` response (`{catalog, monthly, quarterly}`); reads `.monthly`/`.quarterly` itself.
  - `nextDue(mis, todayIso)` → `null | {period_key, label, kind, due_date, days_remaining}`. Same `mis` shape; `todayIso` is a caller-supplied `"YYYY-MM-DD"` string (see Task 7's `todayISO()`).
  - `cashRunway(monthlyBundles)` → `null | {period_key, period_label, cash_in_bank, net_burn_month, runway_months}`. `monthlyBundles` is an array of `getMisPeriod("monthly", key)` responses, any order.
  - `metricTrend(monthlyBundles)` → `{periods: string[], series: {revenue_month, cash_in_bank, runway_months, headcount_eom, deployments_field, trl_level}}`, each series entry `{period_key, label, value}`. Same `monthlyBundles` shape as `cashRunway`; filters to `submitted` internally.
  - `milestonesAndRisks(latestMonthlyBundle)` → `null | {period_label, milestones_by_status: {"On Track": [...], "At Risk": [...], "Blocked": [...]}, risks: [...]}`. Takes **one** bundle (the latest monthly period, submitted or draft — see Task 6), not an array.
  - `airTile(airBundle)` → see the exact shape in Step 1 below. `airBundle` is the whole `getAir()` response.
  - `activityFeed(airBundle, monthlyBundles, quarterlyBundles)` → `Array<{at, color, text, meta}>`, newest first, capped at 8. Takes the whole AIR bundle plus both period-bundle arrays (monthly and quarterly) so it can surface submit/reopen events from either calendar.

**Behaviour — implement the Open Questions defaults exactly as stated above, with the code comment citing the question number, not a bare guess:**

- [ ] **Step 1: Write the failing tests.** Build small fixtures (a handful of monthly index rows, a couple of full period bundles, a minimal AIR bundle) and cover every state from the table above at the pure-function level:

```js
import { describe, it, expect } from "vitest";
import {
  misEmptyReason, reportingCompliance, nextDue,
  cashRunway, metricTrend, milestonesAndRisks, airTile, activityFeed,
} from "../vipDashboardRollup.js";

const period = (over = {}) => ({
  period_key: "2026-06", label: "June 2026", status: "draft",
  due_date: "2026-07-05", overdue: false, ...over,
});

describe("misEmptyReason", () => {
  it("returns null when at least one period is submitted (not empty)", () => {
    expect(misEmptyReason([period({ status: "submitted" })])).toBeNull();
  });
  it("state 6 — not due yet: zero submitted, zero overdue", () => {
    const r = misEmptyReason([period({ due_date: "2026-07-05", overdue: false })]);
    expect(r).toEqual({ cause: "not_due_yet", due_date: "2026-07-05", due_label: "June 2026" });
  });
  it("state 7 — overdue backlog: zero submitted, N overdue, names the OLDEST", () => {
    const r = misEmptyReason([
      period({ period_key: "2026-04", label: "April 2026", due_date: "2026-05-05", overdue: true }),
      period({ period_key: "2026-05", label: "May 2026", due_date: "2026-06-05", overdue: true }),
    ]);
    expect(r).toEqual({ cause: "overdue_backlog", count: 2, oldest_label: "April 2026", oldest_due: "2026-05-05" });
  });
});

describe("reportingCompliance", () => {
  it("state 9 — nothing due yet: total_due 0, not '0%'", () => {
    expect(reportingCompliance({ monthly: [period({ overdue: false })], quarterly: [] }))
      .toEqual({ total_due: 0, submitted: 0, pct: null });
  });
  it("state 10 — something due, none submitted", () => {
    const r = reportingCompliance({ monthly: [period({ overdue: true })], quarterly: [] });
    expect(r).toEqual({ total_due: 1, submitted: 0, pct: 0 });
  });
  it("counts a submitted period as due even though overdue is always false once submitted", () => {
    const r = reportingCompliance({ monthly: [period({ status: "submitted", overdue: false })], quarterly: [] });
    expect(r).toEqual({ total_due: 1, submitted: 1, pct: 100 });
  });
  it("never reads due_date directly — composes only from status/overdue (Global Constraints)", () => {
    // A period with a due_date in the past but overdue:false (should not happen from the
    // real backend, but this proves the function does not do its own date comparison).
    const r = reportingCompliance({ monthly: [period({ due_date: "2020-01-01", overdue: false })], quarterly: [] });
    expect(r.total_due).toBe(0);
  });
});

describe("nextDue", () => {
  it("state 11 — no draft period at all: fully caught up", () => {
    expect(nextDue({ monthly: [period({ status: "submitted" })], quarterly: [] }, "2026-06-20")).toBeNull();
  });
  it("picks the earliest draft by due_date across monthly and quarterly", () => {
    const r = nextDue({
      monthly: [period({ due_date: "2026-07-05" })],
      quarterly: [period({ period_key: "FY26-27-Q1", label: "Q1 FY26-27", due_date: "2026-06-15" })],
    }, "2026-06-01");
    expect(r.period_key).toBe("FY26-27-Q1");
    expect(r.days_remaining).toBe(14);
  });
  it("days_remaining is negative for an overdue period, not clamped to zero", () => {
    const r = nextDue({ monthly: [period({ due_date: "2026-06-01", overdue: true })], quarterly: [] }, "2026-06-10");
    expect(r.days_remaining).toBe(-9);
  });
});

// cashRunway / metricTrend / milestonesAndRisks / airTile / activityFeed:
// see Step 1 continuation below — one describe block per function, each
// exercising states 1-5 and 8 from the table plus the Open Question defaults.
```

  Continue the file with:
  - `cashRunway`: no submitted monthly bundle → `null`; one submitted bundle → returns `{period_key, period_label, cash_in_bank, net_burn_month, runway_months}` reading `runway_months` **verbatim from the metric row's `actual`**, never `cash_in_bank / net_burn_month` (Open Question 4) — assert this explicitly with a fixture where the two would disagree if computed, so a future "helpful" refactor to compute it trips the test.
  - `metricTrend`: zero submitted → `{ periods: [], series: {...each key: []} }`; one submitted (state 8) → each series has exactly one point; asserts the six keys are exactly `["revenue_month", "cash_in_bank", "runway_months", "headcount_eom", "deployments_field", "trl_level"]`, sourced from `bundle.metrics[].actual` by `metric_key`, sorted ascending by `period.period_key`.
  - `milestonesAndRisks`: `null` bundle → `null`; a bundle with a `"Done"` milestone and an `"On Track"` one → the Done one is excluded from every status group (state 3's "open milestones" reading); risks — assert **every** risk row in the latest period appears (no filtering), with a comment citing that `risks`' `CARRY_FORWARD` is `"none"` and `severity` has no non-open state, so nothing to filter.
  - `airTile`: given a bundle with `rollups.claimed = {technology: 3, commercial: 2, overall: 2}`, `rollups.verified = {technology: null, commercial: null, overall: null}` → returns exactly `{overall_claimed: 2, overall_verified: null, tech_claimed: 3, comm_claimed: 2, delta: {available: false, reason: "no_endpoint_for_prior_rounds"}}` — assert the full object, not a subset, so a future field rename is caught here rather than at `VipDashboard.jsx`'s render layer; assert `delta.available` is `false` unconditionally (Open Questions 2 and 5) — there is no code path that ever sets it `true` yet.
  - `activityFeed`: assert it never emits an event whose type is a milestone-status change (Open Question 6 — a fixture with two monthly bundles whose milestone lists differ must produce zero "flip" events); assert it sorts newest-first and caps at 8; assert an AIR round with `verified_at: null` contributes no "verified" event but a `submitted_at` still contributes a "submitted" one.

- [ ] **Step 2: Run and watch every test fail** — `cd frontend && npx vitest run src/pages/founder/__tests__/vipDashboardRollup.test.js`. Expected: module-not-found.

- [ ] **Step 3: Implement `vipDashboardRollup.js`.** Every exported function is pure (no `founderApi` import, no `Date.now()` inside a function whose test fixes "today" as a parameter — `nextDue` takes `today` explicitly for exactly this reason). Include the Open Question comment block at the top of the file, numbered to match "Open questions" above, so a reader hits the rationale before the code, not after.

- [ ] **Step 4: Run — all pass.**

- [ ] **Step 5: Mutation-check the two highest-risk functions.**
  - `reportingCompliance`: change the "due" predicate from `status === "submitted" || overdue` to `overdue` alone (dropping already-submitted periods from the denominator) and confirm the "counts a submitted period as due" test fails.
  - `cashRunway`: change it to compute `cash_in_bank / net_burn_month` instead of reading `runway_months.actual`, and confirm the disagreeing-fixture test fails. This is the exact class of invented-formula bug this plan exists to prevent — report precisely what broke.
  - Restore both. Report both breaks and the failing test names.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/vipDashboardRollup.js frontend/src/pages/founder/__tests__/vipDashboardRollup.test.js
git commit -m "feat(vip): pure derivations for the VIP process dashboard"
```

---

### Task 2: `AirScorecardPanel` — the centrepiece, replacing TIR's Experiments panel

**Files:**
- Create: `frontend/src/pages/founder/components/AirScorecardPanel.jsx`
- Modify: `frontend/src/styles/vip-dashboard.css` (create if this is the first task to touch it)
- Test: `frontend/src/pages/founder/__tests__/AirScorecardPanel.test.jsx`

**Interfaces:**
- Consumes: `round` and `levers` and `rollups` exactly as returned inside `founderApi.getAir()`'s bundle (`{lever, name, family, claimed_level, verified_level, ...}` per lever; `rollups: {claimed: {technology, commercial, overall}, verified: {...}}`).
- Produces: `<AirScorecardPanel round={bundle.round} levers={bundle.levers} rollups={bundle.rollups} />`. Presentational only — same discipline as `AirBar`, no `founderApi` import.

**Behaviour (states 1-5 from the table):**
1. Always renders all six `AirBar`s, grouped Technology / Commercial (`l.family === "technology" | "commercial"`), using `FAMILY_LABEL` copied from `FounderTlr.jsx` (`{technology: "Technology / R&D", commercial: "Product / Engineering"}` — a 2-line constant, deliberately duplicated rather than imported, matching this codebase's own precedent of a small guard duplicated across module boundaries — see `founder_mis.py`'s `require_vip` docstring).
2. Always renders the three rollups via the existing `Tile` atom (`Technology AIR` / `Commercial AIR` / `Overall AIR`), each `rollups.claimed.X ?? "—"`; when `rollups.verified.X != null` and differs from claimed, an inline secondary value using the **existing** `.fj-air-bar-verified-val` class (do not invent a new class for this — it is already styled for exactly this purpose).
3. A status line, one of the four state-2-through-5 copy strings, chosen from `round.status` and whether `levers.some/every(l => l.claimed_level != null)`.
4. The overall-rule marker: a `position:absolute` line inside a `position:relative` wrapper around each family's bar list, at `left: ${(rollups.claimed.overall / 9 * 100).toFixed(2)}%`, rendered **only when `rollups.claimed.overall != null`** (state 3 — no marker when there is nothing to mark). Confirmed against `founder-portal.css`'s `.fj-air-bar-track { display:grid; grid-template-columns:repeat(9,1fr); gap:3px; }` (read-only — do not edit) and `.fj-air-bar { display:flex; flex-direction:column }`, which has no horizontal padding of its own, so a wrapper matching `.fj-air-bar`'s own width lines the marker up with the 9-segment track directly beneath it.

- [ ] **Step 1: Write the failing tests.**
  - All six levers `claimed_level: null` → renders 6 `AirBar`s (assert via the lever names, not `AirBar`'s internals — that is `AirBar.test.jsx`'s job), status copy is state 2's exact string, no `.vipd-air-rule` element in the DOM, all three `Tile` values read "—".
  - Technology's three levers answered (claimed 2/3/4 → tech rollup real), Commercial's three not answered → `rollups.claimed = {technology: 2, commercial: null, overall: null}` fixture — assert the Technology `Tile` shows a real number, Commercial and Overall show "—", and still no `.vipd-air-rule` (nothing to mark since `overall` is null) — this is the sharpest test in the file; get it wrong and a partial state looks broken.
  - All six answered, `round.status === "draft"` → status copy is state 4's string, `.vipd-air-rule` present with `style.left` equal to the exact computed percentage for the fixture's `overall` value.
  - `round.status === "submitted"` → status copy is state 5's string with the round's `submitted_at` formatted in.

- [ ] **Step 2: Run and watch fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check.** Change the rule's percentage formula to divide by `10` instead of `9` (an off-by-one that would silently misplace every marker) and confirm the exact-percentage test fails. Restore, report.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/AirScorecardPanel.jsx frontend/src/styles/vip-dashboard.css frontend/src/pages/founder/__tests__/AirScorecardPanel.test.jsx
git commit -m "feat(vip): AIR scorecard panel with the four day-one AIR states"
```

---

### Task 3: `AirTrajectoryPanel` — the one reachable point, honestly labelled

**Files:**
- Create: `frontend/src/pages/founder/components/AirTrajectoryPanel.jsx`
- Modify: `frontend/src/styles/vip-dashboard.css`
- Test: `frontend/src/pages/founder/__tests__/AirTrajectoryPanel.test.jsx`

**Interfaces:**
- Consumes: `round` and `rollups` from the AIR bundle — the same slice `AirScorecardPanel` takes, not a new fetch.
- Produces: `<AirTrajectoryPanel round={bundle.round} rollups={bundle.rollups} />`.

**Behaviour:** This is the VIP analogue of TIR's cycle-timeline Gantt, but Open Question 2 means there is exactly one data point reachable today, for every venture, regardless of how many quarters they have actually completed. Render that one point (`round.round_label` → `rollups.claimed.overall ?? "—"`) as a single labelled marker, plus a **permanent** note — not an error state, not a loading state — explaining why there is only one: "Earlier rounds aren't available here yet." This must read as an honest, static fact about the surface, not a bug the founder should retry.

- [ ] **Step 1: Write the failing tests.** One point renders with the round's label and claimed overall; the "not available yet" note is always present (assert it renders whether the round is draft or submitted — it is not conditional on round state, only on Open Question 2 being unresolved); `overall: null` renders "—" for the point rather than omitting it.
- [ ] **Step 2: Run and watch fail. Step 3: Implement. Step 4: Run — pass.**
- [ ] **Step 5: Mutation-check.** Remove the "not available yet" note's render condition entirely (make it disappear when `overall` is non-null, as if data plotted itself out of the caveat) and confirm the always-present test fails. Restore, report.
- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/AirTrajectoryPanel.jsx frontend/src/styles/vip-dashboard.css frontend/src/pages/founder/__tests__/AirTrajectoryPanel.test.jsx
git commit -m "feat(vip): AIR trajectory panel — single point, honest about missing history"
```

---

### Task 4: `ActivityFeedPanel` — "This period," built from real timestamps only

**Files:**
- Create: `frontend/src/pages/founder/components/ActivityFeedPanel.jsx`
- Test: `frontend/src/pages/founder/__tests__/ActivityFeedPanel.test.jsx`

**Interfaces:**
- Consumes: `events` — the exact array `vipDashboardRollup.activityFeed()` returns (`{at, color, text, meta}`, newest first, capped at 8). No fetching.
- Produces: `<ActivityFeedPanel events={events} />`.

**Behaviour:** Deliberately unlike TIR's `FEED`, whose entries are static demo copy — do not copy any of TIR's literal feed strings. Reuses `.fj-dash-feed-list`/`.fj-dash-feed-row`/`.fj-dash-feed-dot`/`.fj-dash-feed-text`/`.fj-dash-feed-meta` from `founder-portal.css` unchanged — no new CSS in this task. Copy the 4-line `FEED_COLOR` token map from `FounderDashboard.jsx` verbatim (green/amber/blue/dim → CSS var tokens) rather than importing it, matching this codebase's small-guard-duplication precedent. Empty `events` (no submissions, no reopens, no verifications yet) has one cause, not two — this is not one of the table-12 states — copy: "Nothing to show yet — your first submission will appear here."

- [ ] **Step 1: Write the failing tests.** Renders events in the given order with dot color from `FEED_COLOR`, falling back to `dim` for an unrecognised color key (mirrors `FounderDashboard.jsx`'s own `FEED_COLOR[f.color] || FEED_COLOR.dim`); empty array renders the one-cause empty copy; renders no more than 8 rows even if given more (defence in depth — `activityFeed` already caps this, but the component must not silently un-cap it either).
- [ ] **Step 2: Run and watch fail. Step 3: Implement. Step 4: Run — pass.**
- [ ] **Step 5: Mutation-check.** Drop the `dim` fallback so an unrecognised color renders `undefined` as the background, and confirm the fallback test fails. Restore, report.
- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/ActivityFeedPanel.jsx frontend/src/pages/founder/__tests__/ActivityFeedPanel.test.jsx
git commit -m "feat(vip): activity feed panel from real AIR/MIS timestamps"
```

---

### Task 5: `MetricTrendPanel` — small multiples across submitted monthly periods

**Files:**
- Create: `frontend/src/pages/founder/components/MetricTrendPanel.jsx`
- Modify: `frontend/src/styles/vip-dashboard.css`
- Test: `frontend/src/pages/founder/__tests__/MetricTrendPanel.test.jsx`

**Interfaces:**
- Consumes: `trend` — the exact shape `vipDashboardRollup.metricTrend()` returns; `emptyReason` — the exact shape `vipDashboardRollup.misEmptyReason()` returns (`null` when at least one period is submitted).
- Produces: `<MetricTrendPanel trend={trend} emptyReason={emptyReason} metricLabels={misIndexBundle.catalog.metrics} />`. `metricLabels` supplies each key's display label/unit from the catalog `GET /founder/mis` already returns — do not hardcode a label the catalog already carries (same "nothing about the framework is hardcoded" discipline Phase 4 enforced for AIR).

**Behaviour:**
- `trend.periods.length === 0` → render states 6/7 from the table via `emptyReason.cause` (`"not_due_yet"` vs `"overdue_backlog"`) with their exact distinct copy — this is the single most important test in this task; a shared fallback string here is precisely the bug class this plan exists to prevent.
- `trend.periods.length === 1` → render the one point per metric (a full-height single bar is a valid mini-chart of one point) plus the state-8 caption.
- `trend.periods.length >= 2` → a small bar-per-period mini chart for each of the six metrics, each metric's bars normalised to that metric's own max across its own series (not a shared cross-metric scale — cash-in-bank and headcount are different units and must not share a y-axis). No charting library; div-width/height bars, matching the hand-rolled `BudgetBar.jsx` idiom already in this codebase.

- [ ] **Step 1: Write the failing tests** covering all three trend-length branches above, plus: a metric whose every point is `null` (founder left it blank every period) renders zero-height bars, not a crash; the six metric keys render in `mis_catalog.METRICS`' own template order, not alphabetical or insertion order.
- [ ] **Step 2: Run and watch fail. Step 3: Implement. Step 4: Run — pass.**
- [ ] **Step 5: Mutation-check.** Swap the "not_due_yet" and "overdue_backlog" copy branches (make the backlog cause show the "not due yet" string) and confirm the two-cause test catches it — this is the test that most directly guards against the failure mode this plan names by name. Restore, report.
- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/MetricTrendPanel.jsx frontend/src/styles/vip-dashboard.css frontend/src/pages/founder/__tests__/MetricTrendPanel.test.jsx
git commit -m "feat(vip): metric trend panel with distinct not-due-yet vs overdue-backlog states"
```

---

### Task 6: `MilestonesRisksPanel` — open milestones by status, open risks

**Files:**
- Create: `frontend/src/pages/founder/components/MilestonesRisksPanel.jsx`
- Modify: `frontend/src/styles/vip-dashboard.css`
- Test: `frontend/src/pages/founder/__tests__/MilestonesRisksPanel.test.jsx`

**Interfaces:**
- Consumes: `data` — the exact shape `vipDashboardRollup.milestonesAndRisks()` returns (`null`, or `{period_label, milestones_by_status: {"On Track": [...], "At Risk": [...], "Blocked": [...]}, risks: [...]}`); `emptyReason` — same shape as Task 5, reused for the `data === null` branch (states 6/7, same two causes, same requirement to stay distinct).
- Produces: `<MilestonesRisksPanel data={data} emptyReason={emptyReason} />`.

**Behaviour:**
- `data === null` (no monthly period exists to read from at all) → states 6/7 via `emptyReason`, identical wording discipline to Task 5 — reuse the exact same two strings, do not re-word them independently (a second hand-written copy of the same two-cause message is exactly how it drifts).
- `data` present but every status group and `risks` empty → the two independent single-cause strings from state 12 ("No open milestones this period." / "No risks reported this period."), rendered separately — a period with milestones but no risks must show real milestones next to the risks empty-copy, not one blanket empty state for the whole panel.
- Milestone rows reuse `.fj-dash-exp-row`/`.fj-dash-exp-dot`/`.fj-dash-exp-short`/`.fj-dash-exp-status` (dot color keyed by status: On Track → `var(--accent-green)`, At Risk → `var(--accent-amber)`, Blocked → `var(--accent-coral)`, mirroring `FounderDashboard.jsx`'s own `EXP_STATUS_COLOR` idiom, copied not imported).
- Risk rows are new: `.vipd-risk-row` + `.vipd-risk-badge` (red/amber), showing `what_happened`/`impact`/`mitigation`.

- [ ] **Step 1: Write the failing tests** covering: `data === null` with each `emptyReason.cause`; milestones present grouped correctly by status with `"Done"` rows never appearing in any group (they were already excluded by `milestonesAndRisks`, but this test guards the render layer from re-introducing them via a careless "show everything" pass); zero milestones + 2 risks renders the milestones empty-copy next to real risk rows (the independence assertion); a risk's severity renders the correct badge color for `red` vs `amber`.
- [ ] **Step 2: Run and watch fail. Step 3: Implement. Step 4: Run — pass.**
- [ ] **Step 5: Mutation-check.** Remove the `"Done"` filter at the render layer (re-derive groups from an unfiltered list) and confirm the "Done never appears" test fails. Restore, report.
- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/MilestonesRisksPanel.jsx frontend/src/styles/vip-dashboard.css frontend/src/pages/founder/__tests__/MilestonesRisksPanel.test.jsx
git commit -m "feat(vip): milestones and risks panel"
```

---

### Task 7: `VipDashboard.jsx` — fetch orchestration and the four stat tiles

**Files:**
- Rewrite: `frontend/src/pages/founder/VipDashboard.jsx`
- Modify: `frontend/src/styles/vip-dashboard.css`
- Modify: `frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx`
- Test: `frontend/src/pages/founder/__tests__/VipDashboard.test.jsx`

**Interfaces:**
- Consumes: `founderApi.me()`, `founderApi.getAir()`, `founderApi.getMis()`, `founderApi.getMisPeriod(kind, periodKey)` (called once per period_key in both `mis.monthly` and `mis.quarterly`), and every function from `vipDashboardRollup.js`, and every component from Tasks 2-6.
- Produces: the route component already wired at `/founder/dashboard` for `track === "sip"` by Phase 1 (`FounderPortal.jsx`'s `case "dashboard": return me.track === "sip" ? <VipDashboard /> : <FounderDashboard />;`). Do not touch routing.

**Fetch orchestration (the only network calls in this phase):**
```js
const [me, air, mis] = await Promise.all([founderApi.me(), founderApi.getAir(), founderApi.getMis()]);
const [monthlyBundles, quarterlyBundles] = await Promise.all([
  Promise.all(mis.monthly.map((p) => founderApi.getMisPeriod("monthly", p.period_key))),
  Promise.all(mis.quarterly.map((p) => founderApi.getMisPeriod("quarterly", p.period_key))),
]);
```
Every period a venture owes is fetched once, up front — there is no bulk-read endpoint (a known cost of the frozen-backend constraint, acceptable at the scale a founder's own backlog can reach). `monthlyBundles`/`quarterlyBundles` feed `metricTrend`, `cashRunway`, `milestonesAndRisks` (monthly only — quarterly's own milestone-shaped sections, `planned_vs_actual`/`next_milestones`, are a different shape and out of this panel's scope), and `activityFeed` (both kinds).

**Layout, reusing `founder-portal.css`'s existing dashboard shell classes exactly as `FounderDashboard.jsx` does:**
- `.fj-dash-header` → h1 is `me.project_name`; no week/cohort clock — `GET /founder/me` carries no onboarding date and no tile or panel in spec §6 needs one, so none is invented here (if the design intends a VIP-equivalent of TIR's "Week X of Y," that needs a new field on `/founder/me`, which is a backend change outside a frozen-backend phase — flag it if raised, don't build it).
- `.fj-dash-tiles` (the existing 4-up grid) with four `StatTile`s, reused unchanged:
  1. `airTile(air)` → value = `overall_claimed` (`"—"` if null) with the verified badge/annotation from state 1; sub = `Technology ${tech_claimed ?? "—"} · Commercial ${comm_claimed ?? "—"}`; `delta.available` is always `false` today, so no delta indicator is rendered (Open Questions 2/5 — see the code comment, not a blank space pretending nothing was planned there).
  2. `reportingCompliance(mis)` → value = `pct == null ? "Nothing due yet" : `${pct}%`` (state 9/10); sub = `${submitted} of ${total_due} periods filed` or, when overdue, `+ ${overdue count} overdue`.
  3. `cashRunway(monthlyBundles)` → `null` → states 6/7 via `misEmptyReason(mis.monthly)` (reused, not re-derived); non-null → value = `fmtL(cash_in_bank)`, sub = `${runway_months} mo runway · as of {period_label}`.
  4. *(dark)* `nextDue(mis, todayISO())` → `null` → state 11 ("All caught up"); non-null → value = the period's `label`, sub = `days_remaining >= 0 ? `Due in ${days_remaining} days` : `${-days_remaining} days overdue`` — `todayISO()` is a small local helper defined in `VipDashboard.jsx` itself (`() => new Date().toISOString().slice(0, 10)`), **not** exported from `vipDashboardRollup.js` — it is the one place in this file that reads the browser clock, documented as display-only per Global Constraints (never used for a compliance/overdue determination, only for this cosmetic count).
- Two-column row (`.fj-dash-two`):
  - `<AirScorecardPanel round={air.round} levers={air.levers} rollups={air.rollups} />` (left, replacing TIR's Experiments panel).
  - `<ActivityFeedPanel events={activityFeed(air, monthlyBundles, quarterlyBundles)} />` (right, replacing TIR's static "This week").
- Full-width cards, in order:
  - `<MetricTrendPanel trend={metricTrend(monthlyBundles)} emptyReason={misEmptyReason(mis.monthly)} metricLabels={mis.catalog.metrics} />`.
  - `<MilestonesRisksPanel data={milestonesAndRisks(monthlyBundles.at(-1) ?? null)} emptyReason={misEmptyReason(mis.monthly)} />` — `monthlyBundles.at(-1)` is "the latest monthly period, draft or submitted," relying on `mis.monthly` (and therefore `monthlyBundles`, fetched via `.map` over it) already being ascending by `period_key`, a contract `mis_query._fetch_periods` guarantees server-side; `?? null` covers the defensive case even though an onboarded founder always has at least the current period.
  - `<AirTrajectoryPanel round={air.round} rollups={air.rollups} />` — the VIP analogue of TIR's Gantt, so it sits in the same bottom position TIR's Gantt card occupies.

- [ ] **Step 1: Write the failing tests.** Mock all four thunks with a fixture set that exercises the day-one states most likely to break at the integration boundary specifically (not re-testing what Tasks 1-6 already proved in isolation):
  - A fresh-onboarded fixture (0 submitted periods, 0 overdue, AIR round untouched) renders every panel's state-2/state-6 copy, not a generic loading/error fallback.
  - An overdue-backlog fixture (3 monthly periods, all draft, all overdue) renders state-7 copy and Tile 4 pointing at the oldest.
  - A fixture with 2 submitted monthly periods renders the Metric Trend panel with two real points and no state-8 caption (caption only applies at exactly one).
  - `getMisPeriod` is called exactly once per period_key present in `mis.monthly` + `mis.quarterly` combined — assert the call count, proving the fetch orchestration does not re-fetch or under-fetch.
  - A failing `getAir`/`getMis`/`getMisPeriod` call surfaces `ErrorState`, not a partial render.
- [ ] **Step 2: Run and watch fail. Step 3: Implement. Step 4: Run — pass.**
- [ ] **Step 5: Mutation-check.** Change the fetch orchestration to only fetch `mis.monthly` bundles and skip `mis.quarterly` (silently dropping quarterly submit/reopen events from the feed and quarterly periods from the compliance denominator) and confirm both the call-count test and the compliance-tile test fail. Restore, report.
- [ ] **Step 6: Update `FounderVipTabs.test.jsx`.** Its dashboard test currently mocks nothing for VIP and asserts on the placeholder's `/Your programme dashboard/i` text with `founderApi.me` alone. Update it to mock `getAir`/`getMis` (empty-but-valid fixtures — a fresh-onboarded shape) alongside `me`, and assert on real dashboard content (e.g. the header's venture name from `project_name`) instead of the placeholder string. Keep the existing assertions that it is *not* `FounderDashboard` (`/Residency dashboard/i`, `/TIR ·/` must still be absent) — those still matter.
- [ ] **Step 7: Full frontend suite**

```bash
cd frontend && npx vitest run
```
Every test green, including the pre-existing founder tests (baseline: ~2 pre-existing frontend failures on this branch per VIP_BUILD_STATE.md — verify any new failure against that baseline before attributing it to this work).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/founder/VipDashboard.jsx frontend/src/styles/vip-dashboard.css frontend/src/pages/founder/__tests__/VipDashboard.test.jsx frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx
git commit -m "feat(vip): process dashboard — tiles, panels, and fetch orchestration"
```

---

## Out of scope

- Any backend change, including a hypothetical AIR-round-history endpoint or an AIR-round due-date column (Open Questions 1-2) — raise, do not build.
- Reaching prior AIR rounds' evidence — already deferred to the admin phase (spec §4.5), unaffected by this phase.
- The admin "VIP cohort" verification surface (Phase 7) — this is the phase whose absence produces state 1 (verified always null) and states 4-5's "awaiting verification" copy; this plan renders those states, it does not build the surface that resolves them.
- Docx import / xlsx export (Phase 8).
- "Milestone status flips" as a feed event (Open Question 6) — do not approximate with a title-match heuristic.
- A VIP-equivalent of TIR's "Week X of Y" onboarding clock — no tile or panel in spec §6 needs one, and `/founder/me` does not carry an onboarding date to build one from.
