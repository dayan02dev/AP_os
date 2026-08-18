# VIP MIS — graphical rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the founder-facing MIS *forms* (`FounderMis.jsx` + six form
components) with a purely pictorial view — four Chart.js line charts per
venture, sourced from **submitted** monthly periods only — and give admin the
same picture across the whole VIP cohort. The founder write endpoints are
retired; the docx-import path (already built, currently unused by any
frontend) becomes the only writer, ready for the email-ingest trigger a later
cycle builds.

**Architecture:** Reads stay exactly as they are (`GET /founder/mis`,
`GET /founder/mis/{kind}/{period_key}`) — this rebuild does not touch how a
period bundle is shaped. What changes: (1) the five founder PUT handlers and
the submit POST handler lose their `@router.put`/`@router.post` decorators
but keep their function bodies, because `commit_mis_import` already calls all
five directly as plain functions and must keep doing so; (2) the ordering
guard that used to gate a founder's own submit button now gates a `submit`
flag on the import-commit body; (3) a new admin read-only endpoint
aggregates the same four metrics across the whole VIP cohort; (4) the
frontend gets a new shared Chart.js wrapper (`MisLineChart` + `MisChartCard`)
consumed by both a rewritten `FounderMis.jsx` and a new
`AdminVipMisCharts.jsx`.

**Tech Stack:** React 18, `chart.js` (new npm dependency, v4, tree-shaken
import — never `chart.js/auto`, never a CDN), Vitest + @testing-library/react
(chart.js mocked in every test that renders through it — jsdom has no canvas
2D context), FastAPI + Pydantic, pytest + `tests/fixtures/fake_supabase.py`.

**Spec:** `docs/superpowers/specs/2026-08-18-vip-mis-graphical-design.md` — the
authority this plan argues from throughout.

**State doc:** `docs/superpowers/VIP_BUILD_STATE.md` — read its "Founder UI
conventions" and "Standing constraints" sections before Task 1; both bind
every task below.

**Worktree:** `.claude/worktrees/vip-onboarding`, branch `feat/vip-onboarding`.
Frontend commands run from `frontend/`. Backend Python is
`/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python` — call it `$PY`
below.

## Global Constraints

> **Mocking Chart.js under this project's Vitest (2.1.9) — read before Tasks 6, 8 and 10.**
> `vi.mock` factories are hoisted above ordinary top-level `const` declarations,
> so a plain `const chartCtor = vi.fn()` written above `vi.mock("chart.js", ...)`
> throws *"Cannot access 'chartCtor' before initialization"*. Create the mocks
> inside `vi.hoisted()` instead. This was hit and fixed in Task 5; the working
> version is in `frontend/src/components/__tests__/MisLineChart.test.jsx` —
> copy the idiom from there, not from a snippet elsewhere in this plan.
>
> ```js
> const { destroyMock, chartCtor } = vi.hoisted(() => {
>   const destroyMock = vi.fn();
>   const chartCtor = vi.fn(() => ({ destroy: destroyMock }));
>   return { destroyMock, chartCtor };
> });
> vi.mock("chart.js", () => ({
>   Chart: Object.assign(chartCtor, { register: vi.fn() }),
>   LineController: {}, LineElement: {}, PointElement: {}, LinearScale: {},
>   CategoryScale: {}, Filler: {}, Tooltip: {},
> }));
> ```


- **Migrations 043-045 are frozen.** No schema change anywhere in this plan.
  Every new read is built from tables that already exist
  (`vip_mis_periods`, `vip_mis_metrics`).
- **The four chart metrics are all monthly.** `revenue_month`,
  `net_burn_month`, `headcount_eom`, `active_customers` all live in
  `mis_catalog.METRICS` (the §2 Key Metrics grid), which only exists for
  `kind == "monthly"`. Nothing in this plan ever reads `vip_mis_financials`
  or `vip_mis_headcount` for a chart — quarterly periods carry no metrics at
  all (`mis_query.period_bundle`: `metrics = ... if kind == "monthly" else
  []`). Quarterly still gets **period cards** (label/status/received-date) on
  the founder page, just no charts.
- **No unit conversion, anywhere.** `revenue_month`/`net_burn_month` are
  already stored in ₹ Lakh (`mis_catalog.METRICS`'s own `unit: "₹L"`) — the
  exact unit `GRAPH`'s titles already state. **Never call `fmtL()` from
  `frontend/src/pages/founder/ui.jsx` on a chart value** — that helper divides
  a raw-rupee amount by 100000 to produce lakhs; applying it to a value that
  is *already* in lakhs produces a number wrong by 100000×, the same class of
  bug the spec's own "why not clawbot's data model" section describes for a
  *different* reason. Chart tooltips format with a small local helper
  instead (Task 5).
- **`--artblue` replaces clawbot's `#3B12B6`, deliberately** (spec §4). Every
  chart stroke/fill/point color derives from that CSS custom property (with
  literal fallback `#3213b7`, matching every other `var(--artblue, #3213b7)`
  in this codebase), resolved once via `getComputedStyle` — a `<canvas>` 2D
  context cannot consume `var()` directly.
- **jsdom has no canvas context.** Any test that renders a *real* Chart.js
  instance will throw `"Failed to create chart: can't acquire context from
  the given item"` (jsdom's `getContext('2d')` returns `null` without the
  optional `canvas` npm package, which is not a dependency here). Every test
  that renders through `MisLineChart` therefore either mocks `chart.js`
  (Task 5's own test) or mocks `MisLineChart` itself (every page-level test
  from Task 6 on). Never install a canvas polyfill to work around this —
  mocking is faster and is what the spec's own testing section asks for:
  *"Tests assert the mapping from bundles to series, not Chart.js
  internals."*
- **Removed ≠ deleted, for five of the six write handlers.**
  `put_metrics`/`put_narrative`/`put_entries`/`put_financials`/`put_headcount`
  lose their HTTP route (spec §3: "The founder write endpoints... are
  removed") but **not their function bodies** —
  `commit_mis_import` already calls all five directly
  (`founder_mis.py:1100-1114`), and that call path is explicitly kept (spec:
  "the import endpoints STAY... the import path becomes the only writer").
  Only `submit_period`'s *logic* moves wholesale into a new function; its
  route is the one handler that disappears completely, because nothing
  else needs to call it as a plain function under its old name or shape.
- **No fail-open defaults, no invented formulas** (VIP_BUILD_STATE.md
  standing constraints). Two derived values below have no formula in the
  spec — the cohort roll-up total and the tooltip unit suffix's edge cases —
  and Task 3 and Task 5 both say explicitly what was picked, why, and that it
  is a documented default pending confirmation, not a silent guess.
- Never put Co-Authored-By, Claude, Anthropic or any AI reference in a commit
  message. Commits are solely authored by the repo owner.
- Frontend tests: `cd frontend && npx vitest run`. Backend tests:
  `cd backend && $PY -m pytest <files> -q --no-cov`. Every task ends green
  against its own files; Task 11 runs the full suite.

## Two things this project keeps getting wrong

**1. Empty states with two causes and one message.** VIP_BUILD_STATE.md:
*"Five defects in phase 4 were a single shape: a null with two distinct
causes and one message true for only one of them."* A chart panel is almost
entirely empty states. This plan names six, each with its own copy, each
scoped to exactly the surface it applies to:

| # | Cause | Surface | Copy |
|---|---|---|---|
| G1 | Venture not yet onboarded — no periods exist for either kind | Founder, page-level | *"MIS reporting opens once your venture is onboarded. Nothing is due yet."* (verbatim, unchanged from today's `FounderMis.jsx`) |
| G2 | Onboarded, periods exist, but **zero submitted monthly periods** yet | Founder, charts-section-level (period cards still render) | `misEmptyCopy(misEmptyReason(...))`'s two existing variants — overdue-backlog vs not-due-yet |
| G3 | Exactly **one** submitted monthly period | Per chart | **Not an empty state.** Renders a single point — spec: *"honest rather than an empty frame."* Must NOT fall into G2 or G4's branch. |
| G4 | 2+ submitted periods exist, but **one specific metric** (e.g. `active_customers`) is null in every one of them | Per chart, within an otherwise-populated grid | *"{title} has not been reported in any submitted period yet."* |
| G5 | Admin only: an onboarded VIP venture with **zero `vip_mis_periods` rows of either kind** — never once opened its own MIS page (periods are lazily created only by a founder's own `GET /founder/mis`) | Admin, per-startup section | *"Hasn't opened MIS reporting yet."* Distinct from G2: G2 means the founder *has* visited and periods exist; G5 means they never have. A founder can never observe G5 about themselves — visiting their own page is what closes it. |
| G6 | Admin only: zero onboarded VIP ventures exist at all | Admin, page-level | *"No VIP startups are onboarded yet."* |

**2. Invented formulas.** VIP_BUILD_STATE.md: *"An earlier phase shipped a
headcount figure reading +3 when the truth was −2, because a formula the
spec did not state was guessed."* Two spots in this plan have exactly that
shape, and neither is resolved silently:

- **The cohort roll-up total** (spec §6: *"total revenue, total burn, total
  headcount across all VIP startups, per month"*). VIP ventures do not share
  a reporting calendar (different onboarding dates), so "per month" is
  ambiguous the instant one venture has reported a month another hasn't.
  Task 3 picks the most conservative reading available —
  **partial sum over whichever startups reported that exact `period_key`,
  never zero-filled, never gated on full-cohort participation** — because it
  is the one option that mirrors an *already-shipped, spec-blessed*
  precedent (`mis_query._partial_sum`'s own "partial entry is still useful
  information" rule) rather than inventing a new one. It is still flagged
  loudly, in code and in this plan, as **not confirmed by the spec** — before
  this number is shown to ARTPARK leadership as an authoritative cohort
  total, someone needs to confirm partial-cohort months should be shown at
  all, versus only once every currently-onboarded venture has reported.
- **The `submit` flag's own shape.** The spec states the *ruling* ("ingest
  marks a period submitted... invoked from the import commit path") but not
  the *mechanism*. Task 1 adds an explicit `submit: bool = False` field to
  the existing commit body rather than making every commit call implicitly
  submit — reasoning given inline in that task. This is an interface
  decision, not a data formula, so it is made and documented rather than
  raised as unresolved.

---

## File Structure

| File | Responsibility |
|---|---|
| **Backend — retire founder writes, add admin charts** | |
| `backend/app/routers/founder_mis.py` | *Modify.* Strip 6 route decorators; add `_finalize_submission`; extend `MisImportCommitBody`. |
| `backend/tests/test_mis_endpoints.py` | *Modify.* Migrate ~80 write/submit call sites onto the import-commit path; add 6 route-gone tests. |
| `backend/tests/test_mis_import.py` | *Modify.* Add `submit` flag + ingest-ordering-guard tests. |
| `backend/tests/test_admin_vip_mis_export.py` | *Modify.* Blast radius: one setup call now 404. |
| `backend/scripts/smoke_vip_portal.py` | *Modify.* Blast radius: the `--writes` section's 3 call sites. |
| `backend/app/services/admin_vip_query.py` | *Modify.* Add `MIS_GRAPH`, `_onboarded_vip_application_ids`, `fetch_mis_charts`. |
| `backend/app/routers/admin_vip.py` | *Modify.* Add `GET /mis/charts`. |
| `backend/tests/test_admin_vip.py` | *Modify (Task 1 + Task 2).* Task 1: fix `_submit_mis_period` helper + one PUT call (blast radius). Task 2: add tests for the new endpoint, including the roll-up default. |
| `backend/scripts/seed_vip_mis_data.py` | *Rewrite.* Cohort of 3 ventures, filled via import/commit (the old PUT/submit routes it called are gone). |
| **Frontend — shared chart infrastructure** | |
| `frontend/package.json` | *Modify.* `npm install chart.js`. |
| `frontend/src/lib/misEmptyState.js` | *Create* (relocated). `misEmptyReason`, `misEmptyCopy`. |
| `frontend/src/pages/founder/vipDashboardRollup.js` | *Modify.* Re-export the two functions from their new home; zero behaviour change. |
| `frontend/src/styles/mis-charts.css` | *Create.* Owned/imported by `MisLineChart.jsx`/`MisChartCard.jsx` — self-contained, not scoped under either portal. |
| `frontend/src/components/MisLineChart.jsx` | *Create.* Chart.js wrapper: gradient, crosshair plugin, point rules, tooltip. |
| `frontend/src/components/MisChartCard.jsx` | *Create.* `GRAPH` constant, card chrome, click-to-expand modal, G3/G4 empty states. |
| **Frontend — founder page** | |
| `frontend/src/pages/founder/misChartData.js` | *Create.* `buildMisChartSeries(monthlyBundles)`, pure. |
| `frontend/src/styles/founder-mis-charts.css` | *Create.* `FounderMis.jsx`'s own page chrome. |
| `frontend/src/pages/founder/FounderMis.jsx` | *Rewrite.* Charts + period cards, no forms. |
| `frontend/src/pages/founder/FounderPortal.jsx` | *Modify.* Nav label "MIS filling" → "MIS". |
| **Frontend — removal** | |
| `frontend/src/pages/founder/components/{PeriodPicker,NarrativeSection,MetricsGrid,EntriesTable,FinancialsGrid,HeadcountGrid}.jsx` | *Delete.* |
| `frontend/src/pages/founder/__tests__/{PeriodPicker,NarrativeSection,MetricsGrid,EntriesTable,FinancialsGrid,HeadcountGrid}.test.jsx` | *Delete.* |
| `frontend/src/styles/{founder-mis,founder-mis-grids}.css` | *Delete.* |
| `frontend/src/lib/founderApi.js` | *Modify.* Remove the 6 dead write thunks. |
| **Frontend — admin page** | |
| `frontend/src/lib/adminVipApi.js` | *Modify.* Add `getMisCharts`. |
| `frontend/src/styles/admin-vip-mis-charts.css` | *Create.* |
| `frontend/src/pages/admin/platform/screens/AdminVipMisCharts.jsx` | *Create.* Cohort roll-up + per-startup sections + table toggle to the untouched `AdminVipMisMatrix`. |
| `frontend/src/pages/admin/platform/screens/AdminVipCohort.jsx` | *Modify.* Swap in `AdminVipMisCharts` as the "mis" subtab. |

`frontend/src/pages/admin/platform/screens/AdminVipMisMatrix.jsx` is
**unchanged** — it becomes a reachable table view inside the new component,
never edited.

---

### Task 1: Backend — retire founder write routes, move submission into import/commit

**Files:**
- Modify: `backend/app/routers/founder_mis.py`
- Modify: `backend/tests/test_mis_endpoints.py`
- Modify: `backend/tests/test_mis_import.py`
- Modify: `backend/tests/test_admin_vip.py` (blast radius, not new coverage —
  see Step 6)
- Modify: `backend/tests/test_admin_vip_mis_export.py` (blast radius — one
  setup call, see Step 6)
- Modify: `backend/scripts/smoke_vip_portal.py` (blast radius — the
  `--writes` section, see Step 6)

**Interfaces:**
- Removes: the HTTP surface of `PUT .../metrics`, `PUT .../narrative`,
  `PUT .../entries/{section}`, `PUT .../financials`, `PUT .../headcount`,
  `POST .../submit`.
- Keeps, as plain (undecorated) functions, unchanged in body:
  `put_metrics`, `put_narrative`, `put_entries`, `put_financials`,
  `put_headcount` — `commit_mis_import` still `await`s all five directly.
- Adds: `_finalize_submission(ctx, kind, period) -> None`,
  `MisImportCommitBody.submit: bool = False`.

- [ ] **Step 1: Write the failing tests first**

  Add to `test_mis_endpoints.py` (new test, parametrised over every removed
  route):

  ```python
  @pytest.mark.parametrize("method,suffix,body", [
      ("put", "/metrics", []),
      ("put", "/narrative", {}),
      ("put", "/entries/milestones", []),
      ("put", "/financials", []),
      ("put", "/headcount", []),
      ("post", "/submit", None),
  ])
  def test_founder_write_routes_are_gone(client, monkeypatch, _clear, method, suffix, body):
      _install(monkeypatch)
      client.get(f"/founder/mis/monthly/{CUR_MONTH}")  # ensure the period row exists
      kwargs = {"json": body} if body is not None else {}
      resp = getattr(client, method)(f"/founder/mis/monthly/{CUR_MONTH}{suffix}", **kwargs)
      assert resp.status_code == 404
  ```

  Add to `test_mis_import.py` (new tests, using its existing `_install`/
  `_user`/`FakeSupabase` fixtures):

  ```python
  def test_commit_with_submit_flips_status_and_stamps_timestamps(client, monkeypatch, _clear):
      fake = _install(monkeypatch)
      client.get(f"/founder/mis/monthly/{CUR_MONTH}")
      resp = client.post(f"/founder/mis/monthly/{CUR_MONTH}/import/commit",
                          json={"narrative": {"exec.headline_win": "Shipped v2"}, "submit": True})
      assert resp.status_code == 200
      body = resp.json()
      assert body["period"]["status"] == "submitted"
      assert body["period"]["submitted_at"] is not None

  def test_commit_with_submit_refuses_while_an_earlier_period_is_draft(client, monkeypatch, _clear):
      fake = _install(monkeypatch)
      client.get("/founder/mis")  # generates 2026-06, 2026-07, 2026-08
      # leave 2026-06 draft; try to submit 2026-07 via commit
      resp = client.post("/founder/mis/monthly/2026-07/import/commit",
                          json={"submit": True})
      assert resp.status_code == 409
      assert resp.json()["detail"]["code"] == "mis_earlier_period_open"
      assert resp.json()["detail"]["period_key"] == "2026-06"

  def test_commit_without_submit_leaves_the_period_draft(client, monkeypatch, _clear):
      fake = _install(monkeypatch)
      client.get(f"/founder/mis/monthly/{CUR_MONTH}")
      resp = client.post(f"/founder/mis/monthly/{CUR_MONTH}/import/commit",
                          json={"narrative": {"exec.headline_win": "Draft only"}})
      assert resp.status_code == 200
      assert resp.json()["period"]["status"] == "draft"
  ```

  Run both files now — every one of these fails (the routes still exist and
  return non-404; `submit` is not a recognised field yet).

- [ ] **Step 2: Strip the six route decorators, keep the six function bodies**

  In `founder_mis.py`, delete only the `@router.put(...)` /
  `@router.post(...)` decorator line above each of `put_metrics`,
  `put_narrative`, `put_entries`, `put_financials`, `put_headcount`. Leave
  every line of their bodies untouched — `commit_mis_import` calls all five
  exactly as they are today.

- [ ] **Step 3: Replace `submit_period` with `_finalize_submission`**

  Delete the entire `submit_period` function (its `@router.post` decorator
  and body, `founder_mis.py:845-900`). Replace it with:

  ```python
  def _finalize_submission(ctx: dict, kind: str, period: dict) -> None:
      """The write side of what used to be `POST /{kind}/{period_key}/submit`
      (Ruling — "submission is no longer a founder act"). Callable only from
      `commit_mis_import` below, when the caller's `submit` flag is set.
      `period` must already be `_own_draft_period`'s return value — this
      function re-checks ordering (`_reject_out_of_order_submit`) but not
      ownership/freeze, which the caller has already established.

      Body is `submit_period`'s own, unchanged: reconcile children while
      still draft (so the TRL-snapshot write below is never a silent no-op
      on a half-built period), snapshot the current verified TRL for a
      monthly period only, then flip status/submitted_at/updated_at. See
      `submit_period`'s own removed docstring in git history for the full
      reasoning on ordering.
      """
      _reject_out_of_order_submit(ctx, kind, period)
      sb = get_admin_client()
      mq._reconcile_children(sb, period, kind)
      now = datetime.now(UTC).isoformat()
      if kind == "monthly":
          trl = _current_verified_trl(ctx["application_id"])
          sb.table("vip_mis_metrics").update({
              "actual": trl,
          }).eq("period_id", period["id"]).eq("metric_key", "trl_level").execute()
      sb.table("vip_mis_periods").update({
          "status": "submitted", "submitted_at": now, "updated_at": now,
      }).eq("id", period["id"]).execute()
  ```

- [ ] **Step 4: Wire `submit` into the commit body and handler**

  In `MisImportCommitBody`, add one field:

  ```python
      submit: bool = False
  ```

  (Placed last, after `entries`. `model_config = ConfigDict(extra="forbid")`
  already guards unknown fields — no change needed there.)

  In `commit_mis_import`, capture the period fetched at the top (today it is
  a bare, discarded call) and finalize at the end:

  ```python
      period = _own_draft_period(ctx, kind, period_key)  # was: bare call, no assignment

      if body.narrative:
          await put_narrative(kind, period_key, body.narrative, ctx)
      if body.metrics:
          await put_metrics(kind, period_key,
                            _merged_rows(ctx, kind, period_key, body.metrics,
                                         "metrics", "metric_key"), ctx)
      if body.financials:
          await put_financials(kind, period_key, body.financials, ctx)
      if body.headcount:
          await put_headcount(kind, period_key,
                              _merged_rows(ctx, kind, period_key, body.headcount,
                                           "headcount", "category"), ctx)
      if body.entries:
          for section, rows in body.entries.items():
              await put_entries(kind, period_key, section, rows, ctx)

      if body.submit:
          _finalize_submission(ctx, kind, period)

      return _bundle(ctx, kind, period_key)
  ```

  **Why an explicit flag, not "every commit submits":** the preview/commit
  split exists so a founder-or-ingest-confirmed subset can be written without
  forcing finality — `import_mis_document` (preview) never writes MIS data at
  all, and `commit_mis_import` today writes only what was confirmed, still
  draft. Making every commit auto-submit would silently change that contract
  for every existing caller of `commit_mis_import` (including Task 3's
  seeder). An explicit, defaulted-false flag preserves "commit = write what
  was confirmed" and adds "commit-and-finalize" as a second, opt-in behaviour
  — the one a real email-ingest trigger will set once it exists (D4, deferred).

- [ ] **Step 5: Migrate the existing write/submit tests off the dead routes**

  `test_mis_endpoints.py` has **over 80 call sites** across ~50 tests that
  PUT/POST directly against the six now-404 routes (confirmed by
  `grep -c 'client\.put(f\?"/founder/mis\|client\.post(f\?"/founder/mis.*submit"'
  tests/test_mis_endpoints.py` before starting — re-run that count after
  this step and expect zero). Enumerating them by test name is exactly the
  kind of list that silently misses one (a setup call inside a test whose
  *name* is about something else) — apply this mechanical, exhaustive rule
  instead, call site by call site, not test by test:

  | Original call | Replacement |
  |---|---|
  | `client.put(f".../{kind}/{key}/metrics", json=X)` | `client.post(f".../{kind}/{key}/import/commit", json={"metrics": X})` |
  | `client.put(f".../{kind}/{key}/narrative", json=X)` | `client.post(f".../{kind}/{key}/import/commit", json={"narrative": X})` |
  | `client.put(f".../{kind}/{key}/entries/{section}", json=X)` | `client.post(f".../{kind}/{key}/import/commit", json={"entries": {section: X}})` |
  | `client.put(f".../{kind}/{key}/financials", json=X)` | `client.post(f".../{kind}/{key}/import/commit", json={"financials": X})` |
  | `client.put(f".../{kind}/{key}/headcount", json=X)` | `client.post(f".../{kind}/{key}/import/commit", json={"headcount": X})` |
  | `client.post(f".../{kind}/{key}/submit")` | `client.post(f".../{kind}/{key}/import/commit", json={"submit": True})` |

  **One call site becomes one commit call — never batch two original calls
  into one commit body.** A test with two sequential PUTs to the same
  section (testing upsert/overwrite behaviour, e.g.
  `test_entries_delete_is_scoped_to_its_own_section`) must keep two
  sequential commit calls, in the same order, each still going through
  `import/commit` — the endpoint accepts a partial body and a draft period
  accepts any number of commits before (optionally) being finalized, so
  this preserves every test's original semantics exactly.

  **The assertions inside every test stay unchanged** — only the request
  shape moves; Step 2 left every validation function's body untouched, so
  the same 422/409/200 outcomes fire for the same reasons.

  `test_submitted_period_rejects_every_write_but_serves_every_read` becomes
  a commit-path assertion: PUT-equivalents via `import/commit` now 409
  `mis_already_submitted` (from `_own_draft_period` inside
  `commit_mis_import` itself, checked before any of the delegated writes
  run), GETs stay 200 unchanged.

  Verify completeness before moving on:
  ```bash
  grep -n 'client\.put(f\?"/founder/mis\|client\.post(f\?"/founder/mis/[^"]*submit"' tests/test_mis_endpoints.py
  ```
  Expect no output.

- [ ] **Step 6: Fix `test_admin_vip.py`'s own MIS fixture helper**

  `test_admin_vip.py`'s docstring states its own philosophy plainly:
  *"Fixtures deliberately build state through the REAL founder-side routers
  ... an assessment/period only ever reaches `submitted` the way a real
  founder would put it there."* Its `_submit_mis_period` helper (line 137)
  and one inline call (line 527, inside
  `test_reopen_returns_a_submitted_period_to_draft`) both call routes this
  step just removed — leaving this file red until Task 2 touches it would
  break "every task ends green." Fix both now, same transform as Step 5:

  *Before:*
  ```python
  def _submit_mis_period(client, kind: str, period_key: str):
      r = client.post(f"/founder/mis/{kind}/{period_key}/submit")
      assert r.status_code == 200, r.text
      return r.json()
  ```
  *After:*
  ```python
  def _submit_mis_period(client, kind: str, period_key: str):
      r = client.post(f"/founder/mis/{kind}/{period_key}/import/commit",
                      json={"submit": True})
      assert r.status_code == 200, r.text
      return r.json()
  ```

  And in `test_reopen_returns_a_submitted_period_to_draft`:

  *Before:*
  ```python
      r2 = client.put("/founder/mis/monthly/2026-06/metrics", json=[])
      assert r2.status_code == 200, r2.text
  ```
  *After:*
  ```python
      r2 = client.post("/founder/mis/monthly/2026-06/import/commit", json={"metrics": []})
      assert r2.status_code == 200, r2.text
  ```

  Every other caller of `_submit_mis_period` (lines 492, 517, 557-559) needs
  no change — they call the helper, not the route, directly.

  `test_admin_vip_mis_export.py` has one setup call site of its own
  (`test_export_startup_scope_xlsx`), same table-driven transform:

  *Before:*
  ```python
  client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
      {"metric_key": "revenue_month", "actual": 12.5, "target": 10},
  ])
  ```
  *After:*
  ```python
  client.post(f"/founder/mis/monthly/{CUR_MONTH}/import/commit", json={"metrics": [
      {"metric_key": "revenue_month", "actual": 12.5, "target": 10},
  ]})
  ```

  Confirm no other call sites remain in either file:
  ```bash
  grep -n 'client\.put(f\?"/founder/mis\|client\.post(f\?"/founder/mis/[^"]*submit"' tests/test_admin_vip.py tests/test_admin_vip_mis_export.py
  ```
  Expect no output.

  `backend/scripts/smoke_vip_portal.py` (the `--writes` section,
  VIP_BUILD_STATE.md's own documented staging smoke tool) has three more
  call sites demonstrating real, still-true behaviour — full-row upsert and
  the out-of-order guard — that must keep working through the new surface,
  not be deleted:

  *Before:*
  ```python
  call("PUT", "/founder/mis/monthly/2026-05/metrics",
       [{"metric_key": "revenue_month", "target": 10, "actual": 4, "commentary": "keep me"}])
  code, b = call("PUT", "/founder/mis/monthly/2026-05/metrics",
       [{"metric_key": "revenue_month", "actual": 7}])
  ...
  code, b = call("PUT", "/founder/mis/monthly/2026-05/metrics",
       [{"metric_key": "revenue_month", "actual": "12"}])
  ...
  code, b = call("POST", "/founder/mis/monthly/2026-08/submit")
  ```
  *After:*
  ```python
  call("POST", "/founder/mis/monthly/2026-05/import/commit",
       {"metrics": [{"metric_key": "revenue_month", "target": 10, "actual": 4, "commentary": "keep me"}]})
  code, b = call("POST", "/founder/mis/monthly/2026-05/import/commit",
       {"metrics": [{"metric_key": "revenue_month", "actual": 7}]})
  ...
  code, b = call("POST", "/founder/mis/monthly/2026-05/import/commit",
       {"metrics": [{"metric_key": "revenue_month", "actual": "12"}]})
  ...
  code, b = call("POST", "/founder/mis/monthly/2026-08/import/commit", {"submit": True})
  ```
  The `out.append(...)` lines that follow each call keep their existing
  text (they read `code`/`b`, not the request shape) — only rename the
  first tuple element of each (`"PUT metrics..."` → `"commit metrics..."`,
  `"POST submit out of order"` → `"commit with submit, out of order"`) so
  the printed report still describes what actually ran.

- [ ] **Step 7: Run every changed/added file — all green**

  ```bash
  cd backend
  $PY -m pytest tests/test_mis_endpoints.py tests/test_mis_import.py tests/test_admin_vip.py tests/test_admin_vip_mis_export.py -q --no-cov
  ```

  `smoke_vip_portal.py` has no pytest coverage by nature (manual, staging
  HTTP script, same as Task 3's seeder) — its fix is verified by reading the
  diff, not by a test run here; it will be exercised for real the next time
  someone runs it against staging with `--writes`.

- [ ] **Step 8: Mutation-check**

  Comment out the `_reject_out_of_order_submit(ctx, kind, period)` call
  inside `_finalize_submission` and confirm
  `test_commit_with_submit_refuses_while_an_earlier_period_is_draft` fails.
  Restore it. Then change `if body.submit:` to `if True:` and confirm
  `test_commit_without_submit_leaves_the_period_draft` fails. Restore.
  Report both.

- [ ] **Step 9: Commit**

  ```bash
  git add backend/app/routers/founder_mis.py backend/tests/test_mis_endpoints.py backend/tests/test_mis_import.py backend/tests/test_admin_vip.py backend/tests/test_admin_vip_mis_export.py backend/scripts/smoke_vip_portal.py
  git commit -m "feat(vip-mis): retire founder write routes, submission moves to import/commit"
  ```

---

### Task 2: Backend — admin cohort MIS charts endpoint

**Files:**
- Modify: `backend/app/services/admin_vip_query.py`
- Modify: `backend/app/routers/admin_vip.py`
- Modify: `backend/tests/test_admin_vip.py`

**Interfaces:**
- Produces: `admin_vip_query.MIS_GRAPH`,
  `admin_vip_query._onboarded_vip_application_ids() -> list[str]`,
  `admin_vip_query.fetch_mis_charts() -> dict`,
  `GET /admin/platform/vip/mis/charts` (gated by `view_all_apps`, same as
  every other read in this router).
- Response shape, exact:

  ```json
  {
    "cohort": {
      "period_keys": ["2026-05", "2026-06", "..."],
      "series": {
        "revenue": [{"period_key": "2026-05", "label": "May 2026", "value": 12.3}, "..."],
        "burn": ["..."], "headcount": ["..."], "paying": ["..."]
      }
    },
    "startups": [
      {
        "application_id": "...",
        "startup": "...",
        "has_any_period": true,
        "monthly_status": [{"period_key": "...", "label": "...", "status": "draft", "due_date": "...", "overdue": false}],
        "latest_period": {"period_key": "...", "label": "...", "submitted_at": "..."},
        "series": {"revenue": ["..."], "burn": ["..."], "headcount": ["..."], "paying": ["..."]}
      }
    ]
  }
  ```

- [ ] **Step 1: Write the failing tests**

  Add to `test_admin_vip.py`, reusing its own established fixture idioms
  exactly: `_install(monkeypatch, extra_sip_apps=[...])`,
  `_founder_user(app_id=..., user_id=...)`/`_admin_user()`/`_as(...)`, the
  `_frozen_mis_today` fixture (onboarded 2026-06-01, frozen "today"
  2026-08-16 → monthly periods 2026-06/07/08 — the exact same calendar
  `test_mis_matrix_shows_startups_and_derives_overdue` already relies on),
  and — since Task 1 already ran — `import/commit` (with `"submit": true`)
  as the only way left to get a period into `submitted`:

  ```python
  def test_mis_charts_includes_a_venture_with_zero_periods_as_has_any_period_false(client, monkeypatch, _clear, _frozen_mis_today):
      _install(monkeypatch, extra_sip_apps=[
          {"id": "sapp_never_opened", "user_id": "u2", "status": "onboarded",
           "submitted_at": "2026-01-01", "basic_org": "NeverOpened Co"},
      ])
      _as(_founder_user())  # sapp1/u1 opens MIS; sapp_never_opened never does
      client.get("/founder/mis")

      _as(_admin_user())
      resp = client.get("/admin/platform/vip/mis/charts")
      assert resp.status_code == 200, resp.text
      startup = next(s for s in resp.json()["startups"] if s["application_id"] == "sapp_never_opened")
      assert startup["has_any_period"] is False
      assert startup["series"]["revenue"] == []

  def test_mis_charts_per_startup_series_is_submitted_only_oldest_first(client, monkeypatch, _clear, _frozen_mis_today):
      _install(monkeypatch)
      _as(_founder_user())
      client.get("/founder/mis")  # generates 2026-06, 2026-07, 2026-08
      client.post("/founder/mis/monthly/2026-06/import/commit",
                  json={"metrics": [{"metric_key": "revenue_month", "actual": 4.5}], "submit": True})
      client.post("/founder/mis/monthly/2026-07/import/commit",
                  json={"metrics": [{"metric_key": "revenue_month", "actual": 6.2}], "submit": True})
      # 2026-08 stays draft — must NOT appear in the series.

      _as(_admin_user())
      startup = next(s for s in client.get("/admin/platform/vip/mis/charts").json()["startups"]
                     if s["application_id"] == "sapp1")
      assert [p["period_key"] for p in startup["series"]["revenue"]] == ["2026-06", "2026-07"]
      assert [p["value"] for p in startup["series"]["revenue"]] == [4.5, 6.2]

  def test_mis_charts_cohort_rollup_sums_only_startups_that_reported_never_zero_fills(client, monkeypatch, _clear, _frozen_mis_today):
      _install(monkeypatch, extra_sip_apps=[
          {"id": "sapp2", "user_id": "u2", "status": "onboarded",
           "submitted_at": "2026-01-01", "basic_org": "Beta Sensors"},
      ])
      _as(_founder_user())  # sapp1/u1
      client.get("/founder/mis")
      client.post("/founder/mis/monthly/2026-06/import/commit",
                  json={"metrics": [{"metric_key": "revenue_month", "actual": 10}], "submit": True})
      # sapp2/u2 never opens MIS at all — contributes nothing to 2026-06.

      _as(_admin_user())
      row = next(r for r in client.get("/admin/platform/vip/mis/charts").json()["cohort"]["series"]["revenue"]
                 if r["period_key"] == "2026-06")
      assert row["value"] == 10  # NOT 5 (zero-filled average), not None (gated on full cohort)

  def test_mis_charts_a_metric_null_in_every_submitted_period_still_appears_as_null_points(client, monkeypatch, _clear, _frozen_mis_today):
      _install(monkeypatch)
      _as(_founder_user())
      client.get("/founder/mis")
      client.post("/founder/mis/monthly/2026-06/import/commit",
                  json={"metrics": [{"metric_key": "revenue_month", "actual": 4.5}], "submit": True})
      client.post("/founder/mis/monthly/2026-07/import/commit",
                  json={"metrics": [{"metric_key": "revenue_month", "actual": 6.2}], "submit": True})
      # active_customers ("paying") is never sent in either commit — stays
      # null, seeded blank by ensure_periods.

      _as(_admin_user())
      startup = next(s for s in client.get("/admin/platform/vip/mis/charts").json()["startups"]
                     if s["application_id"] == "sapp1")
      assert all(p["value"] is None for p in startup["series"]["paying"])
      assert len(startup["series"]["paying"]) == 2  # points still present, not dropped
  ```

  Run — all fail (`fetch_mis_charts` doesn't exist, route 404s).

- [ ] **Step 2: Implement `admin_vip_query.py`**

  ```python
  # ── MIS charts (cohort roll-up + per-startup) ─────────────────────────

  # Hand-synced with frontend/src/components/MisChartCard.jsx's own `GRAPH`
  # constant — same convention as rbac.py/rbac.js (core domain invariant:
  # change one, change the other). All four are monthly-only metrics
  # (mis_catalog.METRICS); quarterly periods carry no metrics at all, so
  # this never touches vip_mis_financials/vip_mis_headcount.
  MIS_GRAPH = (
      ("revenue", "revenue_month"),
      ("burn", "net_burn_month"),
      ("headcount", "headcount_eom"),
      ("paying", "active_customers"),
  )
  _MIS_GRAPH_METRIC_KEYS = {mk for _, mk in MIS_GRAPH}


  def _onboarded_vip_application_ids() -> list[str]:
      """Every VIP (sip) application currently `onboarded` — the roster the
      per-startup chart section walks, INCLUDING a venture with zero
      `vip_mis_periods` rows (one that has never opened its own MIS tab —
      periods are only ever lazily created by a founder's own `GET
      /founder/mis`, mis_query's own module docstring). `fetch_mis_matrix`
      deliberately does NOT do this — it derives its startup list purely
      from existing period rows, silently omitting a never-visited venture
      — but this view's own empty-state contract (spec's "a venture with no
      periods generated" cause, G5) requires seeing that venture to say so.
      """
      sb = get_admin_client()
      rows = _fetch_all(
          lambda: sb.table("sip_applications").select("id").eq("status", "onboarded")
      )
      return sorted({r["id"] for r in rows})


  def fetch_mis_charts() -> dict:
      """Cohort roll-up + per-startup series for the four MIS_GRAPH metrics,
      read from every SUBMITTED monthly period across the VIP cohort (spec
      §6).

      OPEN QUESTION, deliberately not resolved here: what a cohort month's
      total means when startups do not share a reporting calendar. Shipped
      default — a partial sum over whichever startups reported that exact
      period_key, mirroring `mis_query._partial_sum`'s own "partial entry is
      still useful information" rule. NOT zero-filled, NOT gated on every
      onboarded venture having reported. This is a product decision this
      function does not have the authority to make silently — see this
      plan's own "invented formulas" section before treating this number as
      authoritative.
      """
      sb = get_admin_client()
      application_ids = _onboarded_vip_application_ids()
      names = _startup_names(application_ids)
      app_id_set = set(application_ids)

      periods = _fetch_all(
          lambda: sb.table("vip_mis_periods").select("*").eq("kind", "monthly")
      )
      periods = [mis_query._normalise_period(p) for p in periods if p["application_id"] in app_id_set]

      by_app_periods: dict[str, list[dict]] = {aid: [] for aid in application_ids}
      for p in periods:
          by_app_periods[p["application_id"]].append(p)

      submitted_period_ids = [p["id"] for p in periods if p["status"] == "submitted"]
      metrics_by_period: dict[str, dict[str, float | int | None]] = {}
      if submitted_period_ids:
          # PostgREST's ~1000-row cap has silently truncated list reads in
          # this codebase three times before (admin_query.py's own module
          # docstring) — _fetch_all, not a bare .execute(), even though a
          # single cohort is unlikely to hit it soon.
          metric_rows = _fetch_all(
              lambda: sb.table("vip_mis_metrics").select("period_id,metric_key,actual")
              .in_("period_id", submitted_period_ids)
          )
          for r in metric_rows:
              if r["metric_key"] not in _MIS_GRAPH_METRIC_KEYS:
                  continue
              metrics_by_period.setdefault(r["period_id"], {})[r["metric_key"]] = r.get("actual")

      today = mis_periods.today_ist()
      startups = []
      cohort_by_period: dict[str, dict[str, list[float]]] = {}
      period_labels: dict[str, str] = {}

      for aid in application_ids:
          app_periods = sorted(by_app_periods[aid], key=lambda p: p["period_key"])
          submitted = [p for p in app_periods if p["status"] == "submitted"]

          series: dict[str, list[dict]] = {ck: [] for ck, _ in MIS_GRAPH}
          for p in submitted:
              values = metrics_by_period.get(p["id"], {})
              period_labels.setdefault(p["period_key"], p["label"])
              for chart_key, metric_key in MIS_GRAPH:
                  value = values.get(metric_key)
                  series[chart_key].append(
                      {"period_key": p["period_key"], "label": p["label"], "value": value}
                  )
                  if value is not None:
                      cohort_by_period.setdefault(p["period_key"], {}).setdefault(
                          chart_key, []
                      ).append(value)

          monthly_status = [
              {"period_key": p["period_key"], "label": p["label"], "status": p["status"],
               "due_date": p["due_date"], "overdue": mis_periods.is_overdue(p, today)}
              for p in app_periods
          ]
          latest = submitted[-1] if submitted else None

          startups.append({
              "application_id": aid,
              "startup": names.get(aid, "(unnamed)"),
              "has_any_period": len(app_periods) > 0,
              "monthly_status": monthly_status,
              "latest_period": (
                  {"period_key": latest["period_key"], "label": latest["label"],
                   "submitted_at": latest.get("submitted_at")}
                  if latest else None
              ),
              "series": series,
          })
      startups.sort(key=lambda s: s["startup"])

      cohort_period_keys = sorted(cohort_by_period.keys())
      cohort_series: dict[str, list[dict]] = {ck: [] for ck, _ in MIS_GRAPH}
      for pk in cohort_period_keys:
          for chart_key, _ in MIS_GRAPH:
              values = cohort_by_period[pk].get(chart_key, [])
              cohort_series[chart_key].append({
                  "period_key": pk, "label": period_labels[pk],
                  "value": sum(values) if values else None,
              })

      return {
          "cohort": {"period_keys": cohort_period_keys, "series": cohort_series},
          "startups": startups,
      }
  ```

  **Why `mis_query._normalise_period(p)` on every row:** `is_overdue`
  compares `period["due_date"] < today` (a `date` object) directly, with no
  parsing of its own — the same class of bug the repo's "IST due-date"
  standing constraint already names once (a real Postgrest read returns
  `due_date` as an ISO string, not a `date`). Reuse the already-tested
  normaliser rather than re-parsing inline a third time
  (`fetch_mis_matrix` already does it once, inline, for the same reason).

- [ ] **Step 3: Add the route** in `admin_vip.py`:

  ```python
  @router.get("/mis/charts", dependencies=[Depends(require_capability("view_all_apps"))])
  async def get_mis_charts() -> dict[str, Any]:
      """Cohort roll-up + per-startup series for the four MIS chart
      metrics (spec §6)."""
      return vq.fetch_mis_charts()
  ```

- [ ] **Step 4: Run — all pass**

  ```bash
  cd backend && $PY -m pytest tests/test_admin_vip.py -q --no-cov
  ```

- [ ] **Step 5: Mutation-check**

  In `fetch_mis_charts`, change `if values else None` to
  `sum(values) if values else 0` (the zero-fill this plan deliberately
  rejected) and confirm
  `test_mis_charts_cohort_rollup_sums_only_startups_that_reported_that_period_never_zero_fills`
  still passes for the "has data" case but the null-preservation half of
  `test_mis_charts_a_metric_null_in_every_submitted_period_still_appears_as_null_points`-style
  assertion on an entirely-unreported cohort month would now read `0`
  instead of `null` — add one more assertion to the roll-up test for a
  `period_key` with zero reporting startups if one doesn't already exist,
  confirm it catches this exact mutation, then restore.

- [ ] **Step 6: Commit**

  ```bash
  git add backend/app/services/admin_vip_query.py backend/app/routers/admin_vip.py backend/tests/test_admin_vip.py
  git commit -m "feat(vip-mis): admin cohort MIS charts endpoint"
  ```

---

### Task 3: Backend — cohort seeder on the import/commit path

**Files:**
- Rewrite: `backend/scripts/seed_vip_mis_data.py`

**Interfaces:**
- No pytest coverage by nature — this is a manual, staging-only HTTP script
  (mirrors `backend/scripts/smoke_vip_portal.py`'s own precedent), not a
  unit under test. Verification is a described dry run (Step 4), not an
  automated test.

- [ ] **Step 1: Rewrite the per-period fill to use `import/commit`**

  The existing `MONTHS` loop calls `PUT .../metrics`, `PUT .../narrative`,
  `PUT .../entries/{section}` as four separate calls then
  `POST .../submit` — all five routes are gone (Task 1). Collapse each
  period's fill into ONE `POST .../import/commit` call carrying every
  section plus `"submit": true`:

  ```python
      for key, vals, headline in MONTHS:
          code, bundle = call("GET", f"/founder/mis/monthly/{key}")
          if code != 200:
              print(f"  {key}: GET failed {code} {bundle}")
              continue
          if bundle["period"]["status"] != "draft":
              print(f"  {key}: already {bundle['period']['status']}, skipping")
              continue

          rows = []
          for m in bundle["metrics"]:
              k = m["metric_key"]
              if k == "trl_level":
                  continue
              row = {"metric_key": k, "target": m.get("target"),
                     "actual": vals.get(k, m.get("actual")),
                     "rag": "green" if k in vals else m.get("rag"),
                     "commentary": m.get("commentary")}
              if k == "product_metric_1":
                  row |= {"label": "Pick accuracy (%)", "actual": 97.4, "rag": "green"}
              if k == "product_metric_2":
                  row |= {"label": "Mean picks / hour", "actual": 142, "rag": "amber"}
              rows.append(row)

          commit_body = {
              "metrics": rows,
              "narrative": { ... },  # unchanged from the existing dict literal
              "entries": {
                  "milestones": [ ... ],  # unchanged from the existing list literal
                  "risks": [ ... ],
                  "asks": [ ... ],
              },
              "submit": True,
          }
          code, res = call("POST", f"/founder/mis/monthly/{key}/import/commit", commit_body)
          status = res.get("period", {}).get("status") if isinstance(res, dict) else res
          print(f"  monthly {key}: filled -> commit {code} ({status})")
  ```

  Apply the identical transform to the quarterly block: one
  `POST .../import/commit` with `narrative`/`financials`/`headcount`/
  `entries` all in one body plus `"submit": true`, replacing the four PUTs
  and the final POST submit.

- [ ] **Step 2: Extend to a cohort — provision two more onboarded VIP ventures**

  Add a small, idempotent provisioning helper before `main()`. Reuses the
  documented gotcha from this exact class of operation (MEMORY.md: "prod
  auto-creates `profiles` + grants `applicant` role on auth-user create —
  INSERT 23505s → PATCH instead; every failed insert burns a
  `display_seq` nextval"):

  ```python
  COHORT = [
      {"email": "claude-test-vip-2@artpark.in", "org": "SecondCo Robotics",
       "onboarded_on": "2026-05-15"},
      {"email": "claude-test-vip-3@artpark.in", "org": "ThirdCo Sensing",
       "onboarded_on": "2026-07-01"},
  ]


  def _ensure_onboarded_venture(email: str, org: str, onboarded_on: str) -> None:
      """Idempotent: does nothing if `email` already has an onboarded
      sip_applications row. Creates the auth user (or reuses one that
      already exists — auth-user creation 23505s on a rerun), the
      sip_applications row at status='onboarded', and the
      application_status_log row `get_mis`'s own onboarding-date resolution
      reads (founder_mis.py's `_resolve_onboarded_on`)."""
      from app.supabase_client import get_admin_client
      sb = get_admin_client()
      existing = (sb.table("sip_applications").select("id,user_id")
                  .eq("basic_org", org).limit(1).execute().data or [])
      if existing:
          print(f"  {org}: already provisioned, skipping")
          return
      try:
          user = sb.auth.admin.create_user(
              {"email": email, "email_confirm": True}
          ).user
      except Exception:
          # already exists from a prior partial run — look it up instead
          users = sb.auth.admin.list_users()
          user = next(u for u in users if u.email == email)
      # profiles/applicant-role are auto-created by the same trigger prod
      # relies on (MEMORY.md) — verify on staging before assuming it fires
      # there too; if not, insert profiles/role rows explicitly here.
      app_row = sb.table("sip_applications").insert({
          "user_id": user.id, "status": "onboarded", "basic_org": org,
          "submitted_at": f"{onboarded_on}T00:00:00+00:00",
      }).execute().data[0]
      sb.table("application_status_log").insert({
          "application_id": app_row["id"], "application_track": "sip",
          "from_status": "offered", "to_status": "onboarded",
          "changed_at": f"{onboarded_on}T00:00:00+00:00",
      }).execute()
      print(f"  {org}: provisioned onboarded {onboarded_on}")
  ```

  Call `_ensure_onboarded_venture(**v)` for each `COHORT` entry at the top
  of `main()`, then loop the existing per-founder fill logic (Step 1) once
  per founder email (`EMAIL` plus each `COHORT` entry's email), each with
  its own small variation on the `MONTHS` numbers so the cohort roll-up has
  real shape (vary `revenue_month`/`net_burn_month`/`headcount_eom`/
  `active_customers` per venture — reuse the existing `MONTHS` structure,
  scaled).

- [ ] **Step 3: Keep the staging guard**

  `_guard()` (checks `SUPABASE_URL` contains the staging ref) is unchanged
  and still runs first in `main()` — this script must refuse to run against
  prod, exactly as it does today.

- [ ] **Step 4: Manual verification (no pytest — described dry run)**

  ```bash
  cd backend
  set -a && source /Users/apple/Desktop/Final_AP_os/backend/.env.staging && set +a
  python scripts/seed_vip_mis_data.py
  ```

  Confirm: three ventures print `commit 200 (submitted)` for each of their
  three monthly periods and their quarterly period; a subsequent
  `GET /admin/platform/vip/mis/charts` (via the browser QA trick documented
  in VIP_BUILD_STATE.md, or `curl` with a staging admin token) shows all
  three in `startups` with non-empty `series`, and `cohort.series.revenue`
  has at least one point summing more than any single venture's own value.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/scripts/seed_vip_mis_data.py
  git commit -m "chore(vip-mis): cohort seeder on the import/commit path"
  ```

---

### Task 4: Frontend — relocate `misEmptyReason`/`misEmptyCopy`

**Files:**
- Create: `frontend/src/lib/misEmptyState.js`
- Create: `frontend/src/lib/__tests__/misEmptyState.test.js`
- Modify: `frontend/src/pages/founder/vipDashboardRollup.js`

**Interfaces:**
- Produces: `misEmptyState.misEmptyReason(periodRows)`,
  `misEmptyState.misEmptyCopy(reason)` — identical signatures and behaviour
  to today's, just relocated so both `FounderMis.jsx` (Task 8) and
  `AdminVipMisCharts.jsx` (Task 10) can import them without an
  admin→founder-page cross-import (no precedent for that in this codebase;
  `frontend/src/lib/` is the established cross-cutting home —
  `rbac.js`/`api.js`/`adminVipApi.js`/`founderApi.js` all live there).
- `VipDashboard.jsx`, `MetricTrendPanel.jsx`, `MilestonesRisksPanel.jsx` and
  their tests are **untouched** — `vipDashboardRollup.js` re-exports, so
  their existing `import {... misEmptyCopy, misEmptyReason ...} from
  "./vipDashboardRollup.js"` keeps working unchanged.

- [ ] **Step 1: Write the failing test**

  Move the two functions' existing test cases (search
  `vipDashboardRollup.test.js` for `misEmptyReason`/`misEmptyCopy`) into a
  new `frontend/src/lib/__tests__/misEmptyState.test.js`, importing from
  `../misEmptyState.js`. Run it — module not found, fails.

- [ ] **Step 2: Create `misEmptyState.js`**

  Cut `misEmptyCopy`, `misEmptyReason`, and the private `sortByDueDateAsc`
  helper they both depend on, verbatim, out of `vipDashboardRollup.js` into
  the new file. No logic change — a pure relocation.

- [ ] **Step 3: Re-export from `vipDashboardRollup.js`**

  Replace the cut definitions with:

  ```js
  export { misEmptyCopy, misEmptyReason } from "../../lib/misEmptyState.js";
  ```

  placed where the original definitions were, keeping every other export in
  the file (and their relative position/comments) untouched.

- [ ] **Step 4: Run both the new test and the full existing suite**

  ```bash
  cd frontend
  npx vitest run src/lib/__tests__/misEmptyState.test.js src/pages/founder/__tests__/vipDashboardRollup.test.js src/pages/founder/__tests__/VipDashboard.test.jsx src/pages/founder/__tests__/MetricTrendPanel.test.jsx src/pages/founder/__tests__/MilestonesRisksPanel.test.jsx
  ```

  All green, zero changes needed in the four dependent files/tests.

- [ ] **Step 5: Mutation-check**

  In `misEmptyState.js`, swap the `overdue_backlog` and `not_due_yet`
  branches' return shapes (e.g. drop `oldest_label` from the first) and
  confirm the relocated test catches it. Restore.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/lib/misEmptyState.js frontend/src/lib/__tests__/misEmptyState.test.js frontend/src/pages/founder/vipDashboardRollup.js frontend/src/pages/founder/__tests__/vipDashboardRollup.test.js
  git commit -m "refactor(vip): relocate misEmptyReason/misEmptyCopy to a shared module"
  ```

---

### Task 5: Frontend — `chart.js` dependency + `MisLineChart`

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/styles/mis-charts.css`
- Create: `frontend/src/components/MisLineChart.jsx`
- Create: `frontend/src/components/__tests__/MisLineChart.test.jsx`

**Interfaces:**
- Produces: `<MisLineChart series={[{period_key,label,value}, ...]} chartKey="revenue"|"burn"|"headcount"|"paying" enlarged={false} />`.
  Presentational — no `founderApi`/`adminVipApi` import, no fetching. Every
  later task (6, 8, 10) mocks this component by name.
- `chart.js` is imported modularly — never `chart.js/auto`, never a CDN
  `<script>` tag, never the vendored standalone file. Registers exactly
  `LineController, LineElement, PointElement, LinearScale, CategoryScale,
  Filler, Tooltip` plus the custom crosshair plugin — **not** `Legend`
  (spec: `legend: false` — simplest way to guarantee no legend renders is to
  never register the plugin that draws one).

- [ ] **Step 1: Install the dependency**

  ```bash
  cd frontend && npm install chart.js@^4.5.1
  ```

  Confirm `package.json`'s `dependencies` gained exactly one line and
  `package-lock.json` updated. No dev-only install — this ships in the
  bundle.

- [ ] **Step 2: Write the failing tests**

  ```jsx
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render } from "@testing-library/react";

  const destroyMock = vi.fn();
  const chartCtor = vi.fn(() => ({ destroy: destroyMock }));

  vi.mock("chart.js", () => ({
    Chart: Object.assign(chartCtor, { register: vi.fn() }),
    LineController: {}, LineElement: {}, PointElement: {}, LinearScale: {},
    CategoryScale: {}, Filler: {}, Tooltip: {},
  }));

  import MisLineChart from "../MisLineChart.jsx";

  const SERIES = [
    { period_key: "2026-05", label: "May 2026", value: 4.5 },
    { period_key: "2026-06", label: "Jun 2026", value: 6.2 },
  ];

  beforeEach(() => { chartCtor.mockClear(); destroyMock.mockClear(); });

  describe("MisLineChart", () => {
    it("maps series into Chart.js labels/data in order", () => {
      render(<MisLineChart series={SERIES} chartKey="revenue" />);
      const config = chartCtor.mock.calls[0][1];
      expect(config.data.labels).toEqual(["May 2026", "Jun 2026"]);
      expect(config.data.datasets[0].data).toEqual([4.5, 6.2]);
    });

    it("destroys the previous chart instance when the series changes", () => {
      const { rerender } = render(<MisLineChart series={SERIES} chartKey="revenue" />);
      rerender(<MisLineChart series={[...SERIES, { period_key: "2026-07", label: "Jul 2026", value: 9.1 }]} chartKey="revenue" />);
      expect(destroyMock).toHaveBeenCalledTimes(1);
    });

    it("gives only the last point a nonzero radius — 3.5 by default", () => {
      render(<MisLineChart series={SERIES} chartKey="revenue" />);
      const { pointRadius } = chartCtor.mock.calls[0][1].data.datasets[0];
      const dataset = { data: SERIES.map((p) => p.value) };
      expect(pointRadius({ dataIndex: 0, dataset })).toBe(0);
      expect(pointRadius({ dataIndex: 1, dataset })).toBe(3.5);
    });

    it("uses radius 3 for the last point when enlarged", () => {
      render(<MisLineChart series={SERIES} chartKey="revenue" enlarged />);
      const { pointRadius } = chartCtor.mock.calls[0][1].data.datasets[0];
      const dataset = { data: SERIES.map((p) => p.value) };
      expect(pointRadius({ dataIndex: 1, dataset })).toBe(3);
    });

    it("suffixes revenue/burn tooltip values with L but leaves headcount/paying plain", () => {
      render(<MisLineChart series={SERIES} chartKey="revenue" />);
      const revenueLabel = chartCtor.mock.calls[0][1].options.plugins.tooltip.callbacks.label;
      expect(revenueLabel({ parsed: { y: 4.5 } })).toBe("₹4.5L");

      render(<MisLineChart series={SERIES} chartKey="headcount" />);
      const headcountLabel = chartCtor.mock.calls[1][1].options.plugins.tooltip.callbacks.label;
      expect(headcountLabel({ parsed: { y: 7 } })).toBe("7");
    });

    it("sets no legend plugin config and disables intersect on hover", () => {
      render(<MisLineChart series={SERIES} chartKey="revenue" />);
      const { options } = chartCtor.mock.calls[0][1];
      expect(options.plugins.legend).toBeUndefined();
      expect(options.interaction).toEqual({ mode: "index", intersect: false });
    });
  });
  ```

  Run — module not found, all fail.

- [ ] **Step 3: Implement `MisLineChart.jsx`**

  ```jsx
  import { useEffect, useRef } from "react";
  import {
    Chart, LineController, LineElement, PointElement, LinearScale,
    CategoryScale, Filler, Tooltip,
  } from "chart.js";
  import "../styles/mis-charts.css";

  // A vertical line at the hovered index (spec: "index-mode crosshair on
  // hover"). Chart.js's own tooltip already tracks the active element in
  // `mode: 'index'`; this plugin just draws a guide line at that x, which
  // Chart.js has no built-in for.
  const misCrosshairPlugin = {
    id: "misCrosshair",
    afterDatasetsDraw(chart) {
      const active = chart.tooltip?.getActiveElements?.() || [];
      if (!active.length) return;
      const { ctx, chartArea } = chart;
      const x = active[0].element.x;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(148, 148, 158, 0.35)";
      ctx.stroke();
      ctx.restore();
    },
  };

  Chart.register(
    LineController, LineElement, PointElement, LinearScale, CategoryScale,
    Filler, Tooltip, misCrosshairPlugin,
  );

  // A <canvas> 2D context cannot consume var(--artblue) — resolve it once,
  // to a real rgb() triple, with the same literal fallback every other
  // var(--artblue, #3213b7) in this codebase already uses.
  const FALLBACK_ARTBLUE_RGB = [50, 19, 183]; // #3213b7
  function resolveArtblueRgb() {
    if (typeof window === "undefined") return FALLBACK_ARTBLUE_RGB;
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--artblue").trim();
    if (!raw) return FALLBACK_ARTBLUE_RGB;
    const hex = raw.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const num = parseInt(full, 16);
    return Number.isNaN(num) ? FALLBACK_ARTBLUE_RGB : [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  // revenue_month/net_burn_month are ALREADY stored in ₹ Lakh
  // (mis_catalog.METRICS's own unit) — never route this through
  // ui.jsx's fmtL(), which assumes a raw-rupee input and would divide by
  // 100000 a second time. See this plan's Global Constraints.
  function fmtChartValue(chartKey, v) {
    if (v == null) return "";
    return chartKey === "revenue" || chartKey === "burn" ? `₹${v}L` : String(v);
  }

  export default function MisLineChart({ series, chartKey, enlarged = false }) {
    const canvasRef = useRef(null);
    const chartRef = useRef(null);

    useEffect(() => {
      const points = series || [];
      const [r, g, b] = resolveArtblueRgb();
      const lineColor = `rgb(${r}, ${g}, ${b})`;

      chartRef.current = new Chart(canvasRef.current, {
        type: "line",
        data: {
          labels: points.map((p) => p.label),
          datasets: [{
            data: points.map((p) => p.value),
            borderColor: lineColor,
            borderWidth: 1.75,
            tension: 0.4,
            fill: true,
            backgroundColor: (ctx) => {
              const { chart } = ctx;
              if (!chart.chartArea) return null;
              const { top, bottom } = chart.chartArea;
              const gradient = chart.ctx.createLinearGradient(0, top, 0, bottom);
              gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.13)`);
              gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
              return gradient;
            },
            pointRadius: (ctx) => {
              const isLast = ctx.dataIndex === ctx.dataset.data.length - 1;
              if (!isLast) return 0;
              return enlarged ? 3 : 3.5;
            },
            pointHoverRadius: 6,
            pointBackgroundColor: lineColor,
            pointBorderColor: "#fff",
            pointBorderWidth: 1.5,
            spanGaps: true,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            tooltip: {
              backgroundColor: "#191922",
              cornerRadius: 8,
              displayColors: false,
              callbacks: { label: (item) => fmtChartValue(chartKey, item.parsed.y) },
            },
          },
          scales: {
            x: { grid: { display: false } },
            y: { ticks: { maxTicksLimit: 5 } },
          },
        },
        plugins: [misCrosshairPlugin],
      });

      return () => {
        chartRef.current?.destroy();
        chartRef.current = null;
      };
    }, [series, chartKey, enlarged]);

    return (
      <div className={`mis-linechart-wrap${enlarged ? " is-enlarged" : ""}`}>
        <canvas ref={canvasRef} role="img" aria-label={`${chartKey} trend`} />
      </div>
    );
  }
  ```

- [ ] **Step 4: `mis-charts.css`** — size the canvas container (small vs
  enlarged) and define the shared modal chrome Task 6 uses. Self-contained:
  no dependency on `.founder-portal`'s or admin's own scoped modal classes
  (`.founder-portal .modal-bg`/`.modal` only render correctly under a
  `.founder-portal` ancestor; admin's `.os-modal`/`.os-modal-backdrop` are
  a different, also-scoped convention — a component shared by both portals
  cannot borrow either). Minimum:

  ```css
  .mis-linechart-wrap { position: relative; width: 100%; height: 160px; }
  .mis-linechart-wrap.is-enlarged { height: 380px; }

  .mis-chart-modal-backdrop {
    position: fixed; inset: 0; background: rgba(20, 20, 24, 0.5);
    display: flex; align-items: center; justify-content: center;
    padding: 32px; z-index: 1000;
  }
  .mis-chart-modal {
    background: var(--bg-paper, #fff); border-radius: 4px;
    max-width: 720px; width: 92vw; max-height: 86vh; overflow: auto;
  }
  .mis-chart-modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 24px; border-bottom: 1px solid var(--line, #e2e2e6);
  }
  .mis-chart-modal-close {
    background: none; border: none; font-size: 22px; cursor: pointer;
    color: var(--ink-dim, #6b6b74); line-height: 1;
  }
  .mis-chart-modal-body { padding: 16px 24px 24px; }
  ```

- [ ] **Step 5: Run — all pass**

  ```bash
  cd frontend && npx vitest run src/components/__tests__/MisLineChart.test.jsx
  ```

- [ ] **Step 6: Mutation-check**

  Change `ctx.dataIndex === ctx.dataset.data.length - 1` to
  `ctx.dataIndex === 0` and confirm the "only the last point" test fails.
  Restore. Then swap the `fmtChartValue` condition to always append `"L"`
  and confirm the headcount assertion fails. Restore. Report both.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/package.json frontend/package-lock.json frontend/src/styles/mis-charts.css frontend/src/components/MisLineChart.jsx frontend/src/components/__tests__/MisLineChart.test.jsx
  git commit -m "feat(vip-mis): MisLineChart — Chart.js line renderer with crosshair"
  ```

---

### Task 6: Frontend — `MisChartCard` (title, click-to-expand, G3/G4 empty states)

**Files:**
- Create: `frontend/src/components/MisChartCard.jsx`
- Create: `frontend/src/components/__tests__/MisChartCard.test.jsx`

**Interfaces:**
- Produces (named export, the canonical home for the chart contract):
  ```js
  export const GRAPH = [
    { key: "revenue", title: "Revenue (₹L per month)", metricKey: "revenue_month" },
    { key: "burn", title: "Net burn (₹L per month)", metricKey: "net_burn_month" },
    { key: "headcount", title: "Headcount", metricKey: "headcount_eom" },
    { key: "paying", title: "Paying customers", metricKey: "active_customers" },
  ];
  ```
  and default export `<MisChartCard chartKey title series />` — `series` is
  one metric's already-filtered-to-submitted, oldest-first array
  (Task 7/Task 2 both produce this shape). Tasks 8 and 10 both mock
  `MisLineChart.jsx` when testing pages that render this card, per Global
  Constraints.
- Handles G3 (single point — delegates to `MisLineChart`, no special case
  needed there) and G4 (metric never reported — its own copy). G1/G2/G5/G6
  are the CALLER's responsibility (gating whether `MisChartCard` renders at
  all) — see this task's own docstring-equivalent comment on why the split
  is drawn here.

- [ ] **Step 1: Write the failing tests**

  ```jsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";

  vi.mock("../MisLineChart.jsx", () => ({
    default: (props) => <div data-testid="chart" data-enlarged={String(!!props.enlarged)} />,
  }));

  import MisChartCard, { GRAPH } from "../MisChartCard.jsx";

  const POINTS = [
    { period_key: "2026-05", label: "May 2026", value: 4.5 },
    { period_key: "2026-06", label: "Jun 2026", value: 6.2 },
  ];

  describe("GRAPH", () => {
    it("is exactly the four contracted charts, in order", () => {
      expect(GRAPH.map((g) => g.key)).toEqual(["revenue", "burn", "headcount", "paying"]);
      expect(GRAPH.map((g) => g.title)).toEqual([
        "Revenue (₹L per month)", "Net burn (₹L per month)", "Headcount", "Paying customers",
      ]);
    });
  });

  describe("MisChartCard", () => {
    it("renders the small chart when the metric has real values", () => {
      render(<MisChartCard chartKey="revenue" title="Revenue (₹L per month)" series={POINTS} />);
      expect(screen.getByTestId("chart")).toHaveAttribute("data-enlarged", "false");
    });

    it("G4: shows per-chart copy naming this title when every value is null, without hiding other charts' data (proved by a sibling render)", () => {
      const nulled = POINTS.map((p) => ({ ...p, value: null }));
      render(<MisChartCard chartKey="paying" title="Paying customers" series={nulled} />);
      expect(screen.getByText("Paying customers has not been reported in any submitted period yet.")).toBeInTheDocument();
      expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    });

    it("G3: a single point is not treated as empty", () => {
      render(<MisChartCard chartKey="revenue" title="Revenue (₹L per month)" series={[POINTS[0]]} />);
      expect(screen.getByTestId("chart")).toBeInTheDocument();
      expect(screen.queryByText(/has not been reported/)).not.toBeInTheDocument();
    });

    it("opens an enlarged modal on click and closes on backdrop click", () => {
      render(<MisChartCard chartKey="revenue" title="Revenue (₹L per month)" series={POINTS} />);
      fireEvent.click(screen.getByRole("button", { name: /expand revenue/i }));
      const charts = screen.getAllByTestId("chart");
      expect(charts).toHaveLength(2); // small card + modal copy
      expect(charts[1]).toHaveAttribute("data-enlarged", "true");
      fireEvent.click(screen.getByRole("dialog").parentElement); // backdrop
      expect(screen.getAllByTestId("chart")).toHaveLength(1);
    });
  });
  ```

  Run — module not found, fails.

- [ ] **Step 2: Implement `MisChartCard.jsx`**

  ```jsx
  import { useState } from "react";
  import MisLineChart from "./MisLineChart.jsx";

  export const GRAPH = [
    { key: "revenue", title: "Revenue (₹L per month)", metricKey: "revenue_month" },
    { key: "burn", title: "Net burn (₹L per month)", metricKey: "net_burn_month" },
    { key: "headcount", title: "Headcount", metricKey: "headcount_eom" },
    { key: "paying", title: "Paying customers", metricKey: "active_customers" },
  ];

  export default function MisChartCard({ chartKey, title, series }) {
    const [expanded, setExpanded] = useState(false);
    const points = series || [];
    const hasAnyValue = points.some((p) => p.value != null);

    return (
      <div className="mis-chart-card" data-chart-key={chartKey}>
        <h4 className="mis-chart-title">{title}</h4>
        {points.length === 0 || !hasAnyValue ? (
          // G4 (points exist, none have a value) and the defensive
          // points.length === 0 case (the caller should have gated this
          // via G2 before reaching here) share one message — a metric
          // this page has no real data for reads identically either way.
          <p className="mis-chart-empty">{title} has not been reported in any submitted period yet.</p>
        ) : (
          <button
            type="button"
            className="mis-chart-canvas-btn"
            aria-label={`Expand ${title}`}
            onClick={() => setExpanded(true)}
          >
            <MisLineChart series={points} chartKey={chartKey} />
          </button>
        )}

        {expanded && (
          <div className="mis-chart-modal-backdrop" onClick={() => setExpanded(false)}>
            <div
              className="mis-chart-modal" role="dialog" aria-modal="true"
              aria-label={`${title}, enlarged`} onClick={(e) => e.stopPropagation()}
            >
              <div className="mis-chart-modal-head">
                <h2>{title}</h2>
                <button type="button" className="mis-chart-modal-close" aria-label="Close" onClick={() => setExpanded(false)}>×</button>
              </div>
              <div className="mis-chart-modal-body">
                <MisLineChart series={points} chartKey={chartKey} enlarged />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 3: Run — all pass**

  ```bash
  cd frontend && npx vitest run src/components/__tests__/MisChartCard.test.jsx
  ```

- [ ] **Step 4: Mutation-check**

  Change `!hasAnyValue` to `false` (never show G4) and confirm the G4 test
  fails. Restore. Then change the click handler's `aria-label` to drop
  the chart title and confirm the modal-open test's `getByRole("button",
  {name: /expand revenue/i})` lookup fails. Restore. Report both.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/components/MisChartCard.jsx frontend/src/components/__tests__/MisChartCard.test.jsx
  git commit -m "feat(vip-mis): MisChartCard — chart chrome, expand modal, G3/G4 empty states"
  ```

---

### Task 7: Frontend — founder-side chart series builder

**Files:**
- Create: `frontend/src/pages/founder/misChartData.js`
- Create: `frontend/src/pages/founder/__tests__/misChartData.test.js`

**Interfaces:**
- Produces: `buildMisChartSeries(monthlyBundles) -> {revenue: [...], burn: [...], headcount: [...], paying: [...]}`,
  each array shaped `{period_key, label, value}`, **submitted-only,
  oldest-first** — Task 8 is the only caller.

- [ ] **Step 1: Write the failing tests**

  ```js
  import { describe, it, expect } from "vitest";
  import { buildMisChartSeries } from "../misChartData.js";

  function bundle(periodKey, label, status, metrics) {
    return {
      period: { period_key: periodKey, label, status },
      metrics: Object.entries(metrics).map(([metric_key, actual]) => ({ metric_key, actual })),
    };
  }

  describe("buildMisChartSeries", () => {
    it("includes only submitted periods, oldest first, regardless of input order", () => {
      const bundles = [
        bundle("2026-07", "Jul 2026", "draft", { revenue_month: 99 }),
        bundle("2026-05", "May 2026", "submitted", { revenue_month: 4.5, net_burn_month: 22, headcount_eom: 7, active_customers: 2 }),
        bundle("2026-06", "Jun 2026", "submitted", { revenue_month: 6.2, net_burn_month: 24, headcount_eom: 8, active_customers: 3 }),
      ];
      const series = buildMisChartSeries(bundles);
      expect(series.revenue.map((p) => p.period_key)).toEqual(["2026-05", "2026-06"]);
      expect(series.revenue.map((p) => p.value)).toEqual([4.5, 6.2]);
    });

    it("maps each GRAPH key to its own metric_key", () => {
      const bundles = [bundle("2026-05", "May 2026", "submitted", {
        revenue_month: 1, net_burn_month: 2, headcount_eom: 3, active_customers: 4,
      })];
      const series = buildMisChartSeries(bundles);
      expect(series.revenue[0].value).toBe(1);
      expect(series.burn[0].value).toBe(2);
      expect(series.headcount[0].value).toBe(3);
      expect(series.paying[0].value).toBe(4);
    });

    it("null for a metric a submitted period never reported, rather than dropping the point", () => {
      const bundles = [bundle("2026-05", "May 2026", "submitted", { revenue_month: 4.5 })];
      const series = buildMisChartSeries(bundles);
      expect(series.paying[0]).toEqual({ period_key: "2026-05", label: "May 2026", value: null });
    });

    it("returns empty arrays for every key when there are no submitted periods", () => {
      const bundles = [bundle("2026-05", "May 2026", "draft", { revenue_month: 4.5 })];
      const series = buildMisChartSeries(bundles);
      expect(series.revenue).toEqual([]);
    });
  });
  ```

  Run — fails (module not found).

- [ ] **Step 2: Implement**

  ```js
  // Founder-side chart series builder for /founder/mis's four charts (spec
  // §4). Pure — no fetching, no React. Mirrors
  // vipDashboardRollup.js's own metricTrend()/cashRunway() filter-sort
  // pattern verbatim rather than importing it — this codebase's own
  // established small-guard-duplication precedent (see VipDashboard.jsx's
  // header comment): the two consumers are independent surfaces that may
  // evolve separately, and the shared piece is a few lines, not a load-
  // bearing function.
  import { GRAPH } from "../../components/MisChartCard.jsx";

  function metricActual(bundle, metricKey) {
    const row = (bundle.metrics || []).find((m) => m.metric_key === metricKey);
    return row ? row.actual ?? null : null;
  }

  export function buildMisChartSeries(monthlyBundles) {
    const submitted = (monthlyBundles || [])
      .filter((b) => b.period?.status === "submitted")
      .sort((a, b) => {
        if (a.period.period_key < b.period.period_key) return -1;
        if (a.period.period_key > b.period.period_key) return 1;
        return 0;
      });

    const out = {};
    for (const g of GRAPH) {
      out[g.key] = submitted.map((b) => ({
        period_key: b.period.period_key,
        label: b.period.label,
        value: metricActual(b, g.metricKey),
      }));
    }
    return out;
  }
  ```

- [ ] **Step 3: Run — all pass**

  ```bash
  cd frontend && npx vitest run src/pages/founder/__tests__/misChartData.test.js
  ```

- [ ] **Step 4: Mutation-check**

  Change the sort comparator's `-1`/`1` to be swapped (newest-first) and
  confirm the ordering test fails. Restore.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/pages/founder/misChartData.js frontend/src/pages/founder/__tests__/misChartData.test.js
  git commit -m "feat(vip-mis): founder-side chart series builder"
  ```

---

### Task 8: Frontend — `FounderMis.jsx` rewrite + nav label

**Files:**
- Rewrite: `frontend/src/pages/founder/FounderMis.jsx`
- Create: `frontend/src/styles/founder-mis-charts.css`
- Rewrite: `frontend/src/pages/founder/__tests__/FounderMis.test.jsx`
- Modify: `frontend/src/pages/founder/FounderPortal.jsx`
- Modify: `frontend/src/pages/founder/__tests__/FounderPortal.test.jsx`

**Interfaces:**
- Consumes: `founderApi.getMis`, `founderApi.getMisPeriod` (unchanged reads),
  `buildMisChartSeries` (Task 7), `MisChartCard`/`GRAPH` (Task 6),
  `misEmptyReason`/`misEmptyCopy` (Task 4).
- Produces: the route component already wired at `/founder/mis` — routing
  untouched.
- Fetch pattern mirrors `VipDashboard.jsx`'s own `Promise.all` of
  `getMisPeriod` calls verbatim (same established, tested pattern) — one
  `getMis()` for the index, then one `getMisPeriod` per period of both
  kinds, in parallel.

- [ ] **Step 1: Write the failing tests**

  Cover, in `FounderMis.test.jsx` (fixtures built the same way the old file
  built them — real catalog field ids, trimmed):
  - G1: an index with empty `monthly`/`quarterly` arrays renders the
    existing "MIS reporting opens once your venture is onboarded" copy and
    fetches no period bundles.
  - G2: periods exist, none submitted (all draft, one overdue) — renders
    `misEmptyCopy`'s overdue-backlog copy in the charts section, and STILL
    renders the period cards below it.
  - G3: exactly one submitted monthly period — each `MisChartCard` receives
    a one-point series (mock `MisChartCard` to assert props, not
    `MisLineChart` — Task 6 already proves G3 renders correctly given a
    single point; this test only proves `FounderMis.jsx` doesn't gate it
    into G2).
  - G4: two submitted periods, `active_customers` null in both — the
    "paying" `MisChartCard` gets an all-null series while the other three
    get real values (again: mock `MisChartCard`, assert the props it was
    called with per `chartKey`).
  - Period cards: label, status ("Submitted" / "Not yet received" for
    draft), and received date from `bundle.period.submitted_at`, newest
    first, for BOTH kinds via a kind toggle.
  - Kind toggle switches which kind's period cards render; charts are
    unaffected by the toggle (monthly-sourced regardless).
  - `indexError`/read failure renders `ErrorState`.

  Two of these, worked in full (the rest follow the same
  `vi.mock("../../../components/MisChartCard.jsx", ...)` shape):

  ```jsx
  vi.mock("../../../components/MisChartCard.jsx", () => ({
    default: (props) => <div data-testid={`card-${props.chartKey}`} data-values={JSON.stringify((props.series || []).map((p) => p.value))} />,
  }));

  it("G1: not onboarded yet — no charts, no period fetch", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue({ catalog: {}, monthly: [], quarterly: [] });
    const spy = vi.spyOn(founderApi, "getMisPeriod");
    render(<FounderMis />);
    await waitFor(() => expect(screen.getByText(/MIS reporting opens once your venture is onboarded/)).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });

  it("G4: a metric null in every submitted period still renders its own tile, not folded into the others", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue({
      catalog: {},
      monthly: [{ period_key: "2026-05", label: "May 2026", status: "submitted", due_date: "2026-06-05", overdue: false }],
      quarterly: [],
    });
    vi.spyOn(founderApi, "getMisPeriod").mockResolvedValue({
      period: { period_key: "2026-05", label: "May 2026", status: "submitted", submitted_at: "2026-06-01T00:00:00Z" },
      metrics: [
        { metric_key: "revenue_month", actual: 4.5 },
        { metric_key: "active_customers", actual: null },
      ],
    });
    render(<FounderMis />);
    await waitFor(() => expect(screen.getByTestId("card-revenue")).toBeInTheDocument());
    expect(screen.getByTestId("card-revenue")).toHaveAttribute("data-values", "[4.5]");
    expect(screen.getByTestId("card-paying")).toHaveAttribute("data-values", "[null]");
  });
  ```

  Run — fails against the current form-shell `FounderMis.jsx`.

- [ ] **Step 2: Rewrite `FounderMis.jsx`**

  ```jsx
  // MIS — read-only chart view (spec §5). Reports arrive by email; this
  // page is the record, never a form. Four charts sourced from submitted
  // monthly periods (misChartData.buildMisChartSeries), plus period cards
  // for both calendars so a founder can see what's been received without
  // being able to edit it.
  import { useEffect, useState } from "react";
  import { founderApi } from "../../lib/founderApi.js";
  import { Loading, ErrorState } from "./ui.jsx";
  import MisChartCard, { GRAPH } from "../../components/MisChartCard.jsx";
  import { buildMisChartSeries } from "./misChartData.js";
  import { misEmptyReason, misEmptyCopy } from "../../lib/misEmptyState.js";
  import "../../styles/founder-mis-charts.css";

  const KIND_LABELS = { monthly: "Monthly", quarterly: "Quarterly" };

  function MisHeader() {
    return (
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Cohort management · MIS</div>
        <h1 className="eir-os-view-title">Monthly and quarterly reporting</h1>
        <p className="eir-os-view-sub">
          Reports arrive by email — this page is the record of what ARTPARK has received.
        </p>
      </header>
    );
  }

  function PeriodCards({ periodBundles }) {
    const sorted = [...(periodBundles || [])].sort((a, b) => (a.period.period_key < b.period.period_key ? 1 : -1));
    if (sorted.length === 0) {
      return <p className="hint">No periods yet — check back once your first one opens.</p>;
    }
    return (
      <div className="mis-period-cards">
        {sorted.map((b) => {
          const p = b.period;
          return (
            <div className="mis-period-card" key={p.period_key} data-status={p.status}>
              <span className="mis-period-card-label">{p.label}</span>
              <span className={`mis-period-card-status is-${p.status}`}>
                {p.status === "submitted" ? "Submitted" : "Not yet received"}
              </span>
              <span className="mis-period-card-date">
                {p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : "—"}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  export default function FounderMis() {
    const [index, setIndex] = useState(null);
    const [bundles, setBundles] = useState(null); // {monthly: [...], quarterly: [...]}
    const [error, setError] = useState(null);
    const [kind, setKind] = useState("monthly");

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const idx = await founderApi.getMis();
          if (cancelled) return;
          setIndex(idx);
          const isOnboarded = (idx.monthly?.length || 0) > 0 || (idx.quarterly?.length || 0) > 0;
          if (!isOnboarded) return; // G1 — nothing to fetch
          const [monthly, quarterly] = await Promise.all([
            Promise.all(idx.monthly.map((p) => founderApi.getMisPeriod("monthly", p.period_key))),
            Promise.all(idx.quarterly.map((p) => founderApi.getMisPeriod("quarterly", p.period_key))),
          ]);
          if (!cancelled) setBundles({ monthly, quarterly });
        } catch (err) {
          if (!cancelled) setError(err);
        }
      })();
      return () => { cancelled = true; };
    }, []);

    if (error) return <ErrorState error={error} />;
    if (!index) return <Loading label="Loading your MIS reporting…" />;

    const isOnboarded = (index.monthly?.length || 0) > 0 || (index.quarterly?.length || 0) > 0;
    if (!isOnboarded) {
      // G1
      return (
        <div className="mis-shell">
          <MisHeader />
          <p className="hint" style={{ marginTop: 24 }}>
            MIS reporting opens once your venture is onboarded. Nothing is due yet.
          </p>
        </div>
      );
    }

    if (!bundles) return <Loading label="Loading your MIS reporting…" />;

    const chartSeries = buildMisChartSeries(bundles.monthly);
    const emptyReason = misEmptyReason(index.monthly);

    return (
      <div className="mis-shell">
        <MisHeader />

        <div className="mis-charts-grid">
          {emptyReason ? (
            // G2
            <p className="mis-charts-empty">{misEmptyCopy(emptyReason)}</p>
          ) : (
            GRAPH.map((g) => (
              <MisChartCard key={g.key} chartKey={g.key} title={g.title} series={chartSeries[g.key]} />
            ))
          )}
        </div>

        <div className="mis-kind-tabs" role="tablist">
          {["monthly", "quarterly"].map((k) => (
            <button
              key={k} type="button" role="tab" aria-selected={kind === k}
              className={`mis-kind-tab${kind === k ? " is-active" : ""}`}
              onClick={() => setKind(k)}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <PeriodCards periodBundles={bundles[kind]} />
      </div>
    );
  }
  ```

- [ ] **Step 3: `founder-mis-charts.css`** — `.mis-charts-grid` (responsive
  grid of `MisChartCard`s), `.mis-period-cards`/`.mis-period-card` (the new
  period-card list), `.mis-kind-tabs`/`.mis-kind-tab` (may reuse the exact
  rules the deleted `founder-mis.css` had for these last two classnames —
  copy them forward rather than re-inventing, since Task 9 deletes that
  file). Do not touch `founder-portal.css`.

- [ ] **Step 4: Nav label** — in `FounderPortal.jsx`, change
  `{ sec: "mis", num: "02", label: "MIS filling", to: "/founder/mis" }` to
  `label: "MIS"`. In `FounderPortal.test.jsx`, change the assertion
  `expect(screen.getByText("MIS filling")).toBeInTheDocument();` to expect
  `"MIS"`.

- [ ] **Step 5: Run — all pass**

  ```bash
  cd frontend && npx vitest run src/pages/founder/__tests__/FounderMis.test.jsx src/pages/founder/__tests__/FounderPortal.test.jsx
  ```

- [ ] **Step 6: Mutation-check**

  Change the G2 gate from `if (emptyReason)` to `if (false)` and confirm the
  G2 test fails (charts render instead of the empty message on a
  zero-submitted fixture). Restore. Then swap `PeriodCards`' sort direction
  and confirm a period-cards-ordering assertion fails (add one if the test
  list above didn't already assert order explicitly). Restore. Report both.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/src/pages/founder/FounderMis.jsx frontend/src/styles/founder-mis-charts.css frontend/src/pages/founder/__tests__/FounderMis.test.jsx frontend/src/pages/founder/FounderPortal.jsx frontend/src/pages/founder/__tests__/FounderPortal.test.jsx
  git commit -m "feat(vip-mis): FounderMis — graphical view replaces the form shell"
  ```

---

### Task 9: Frontend — remove the six form components and dead client code

**Files:**
- Delete: `frontend/src/pages/founder/components/{PeriodPicker,NarrativeSection,MetricsGrid,EntriesTable,FinancialsGrid,HeadcountGrid}.jsx`
- Delete: `frontend/src/pages/founder/__tests__/{PeriodPicker,NarrativeSection,MetricsGrid,EntriesTable,FinancialsGrid,HeadcountGrid}.test.jsx`
- Delete: `frontend/src/styles/founder-mis.css`, `frontend/src/styles/founder-mis-grids.css`
- Modify: `frontend/src/lib/founderApi.js`

**Interfaces:** none produced — pure removal. Task 8 already stopped
`FounderMis.jsx` from importing any of these; this task proves nothing else
does either.

- [ ] **Step 1: Prove nothing still references them (this task's "failing
  test")**

  ```bash
  cd frontend
  grep -rln "components/PeriodPicker\|components/NarrativeSection\|components/MetricsGrid\|components/EntriesTable\|components/FinancialsGrid\|components/HeadcountGrid" src/ || echo "NONE"
  grep -rln "founder-mis\.css\|founder-mis-grids\.css" src/ || echo "NONE"
  grep -n "putMisMetrics\|putMisNarrative\|putMisEntries\|putMisFinancials\|putMisHeadcount\|submitMisPeriod" src/lib/founderApi.js
  ```

  Confirm the first two print `NONE` (Task 8 already removed the only
  referencing imports) and the third still lists all six — that's this
  task's own "before" state.

- [ ] **Step 2: Delete the six components + their tests + the two
  stylesheets**

  ```bash
  git rm frontend/src/pages/founder/components/PeriodPicker.jsx frontend/src/pages/founder/components/NarrativeSection.jsx frontend/src/pages/founder/components/MetricsGrid.jsx frontend/src/pages/founder/components/EntriesTable.jsx frontend/src/pages/founder/components/FinancialsGrid.jsx frontend/src/pages/founder/components/HeadcountGrid.jsx
  git rm frontend/src/pages/founder/__tests__/PeriodPicker.test.jsx frontend/src/pages/founder/__tests__/NarrativeSection.test.jsx frontend/src/pages/founder/__tests__/MetricsGrid.test.jsx frontend/src/pages/founder/__tests__/EntriesTable.test.jsx frontend/src/pages/founder/__tests__/FinancialsGrid.test.jsx frontend/src/pages/founder/__tests__/HeadcountGrid.test.jsx
  git rm frontend/src/styles/founder-mis.css frontend/src/styles/founder-mis-grids.css
  ```

- [ ] **Step 3: Remove the six dead write thunks from `founderApi.js`**

  Delete `putMisMetrics`, `putMisNarrative`, `putMisEntries`,
  `putMisFinancials`, `putMisHeadcount`, `submitMisPeriod` and their
  preceding comment block. Keep `getMis`, `getMisPeriod` untouched.

- [ ] **Step 4: Run the full frontend suite and the build**

  ```bash
  cd frontend
  npx vitest run
  npm run build
  ```

  Every test green (nothing references the deleted files); build succeeds
  with no unresolved-import errors.

- [ ] **Step 5: Commit**

  ```bash
  git add -A -- frontend/src/pages/founder/components frontend/src/pages/founder/__tests__ frontend/src/styles frontend/src/lib/founderApi.js
  git commit -m "chore(vip-mis): remove the six MIS form components and dead write thunks"
  ```

---

### Task 10: Frontend — admin cohort MIS charts screen

**Files:**
- Modify: `frontend/src/lib/adminVipApi.js`
- Create: `frontend/src/styles/admin-vip-mis-charts.css`
- Create: `frontend/src/pages/admin/platform/screens/AdminVipMisCharts.jsx`
- Create: `frontend/src/pages/admin/platform/screens/__tests__/AdminVipMisCharts.test.jsx`
- Modify: `frontend/src/pages/admin/platform/screens/AdminVipCohort.jsx`
- Modify: `frontend/src/pages/admin/platform/screens/__tests__/AdminVipCohort.test.jsx`

**Interfaces:**
- Consumes: `adminVipApi.getMisCharts()` (new), `MisChartCard`/`GRAPH`
  (Task 6), `misEmptyReason`/`misEmptyCopy` (Task 4).
- Produces: the "mis" subtab's new default content inside `AdminVipCohort`.
  `AdminVipMisMatrix` is imported and rendered unchanged as the table-toggle
  target — never edited.

- [ ] **Step 1: `adminVipApi.js`** — add one line:

  ```js
  getMisCharts: () => api.get(`${BASE}/mis/charts`),
  ```

- [ ] **Step 2: Write the failing tests**

  This test file lives in `screens/__tests__/` — five directories below
  `src/` (`pages/admin/platform/screens/__tests__/`), one deeper than the
  component itself, matching the depth `AdminVipMisMatrix.test.jsx`'s own
  existing `vi.mock("../../../../../lib/adminVipApi.js", ...)` already
  uses — **not** the four-level depth `AdminVipMisCharts.jsx` itself uses
  (Step 3), which is one directory shallower. Same seams-mocked shape as
  that file (network mocked, `useAsync` real):

  ```jsx
  import React from "react";
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, waitFor, fireEvent } from "@testing-library/react";

  vi.mock("../../../../../lib/adminVipApi.js", () => ({
    adminVipApi: { getMisCharts: vi.fn() },
  }));
  vi.mock("../../../../../components/MisChartCard.jsx", () => ({
    default: (props) => <div data-testid={`card-${props.chartKey}`} />,
    GRAPH: [
      { key: "revenue", title: "Revenue (₹L per month)", metricKey: "revenue_month" },
      { key: "burn", title: "Net burn (₹L per month)", metricKey: "net_burn_month" },
      { key: "headcount", title: "Headcount", metricKey: "headcount_eom" },
      { key: "paying", title: "Paying customers", metricKey: "active_customers" },
    ],
  }));
  vi.mock("../AdminVipMisMatrix.jsx", () => ({ AdminVipMisMatrix: () => <div data-testid="matrix" /> }));

  import { adminVipApi } from "../../../../../lib/adminVipApi.js";
  import { AdminVipMisCharts } from "../AdminVipMisCharts.jsx";

  // G6: zero onboarded ventures
  it("shows the no-startups empty state when the cohort is empty", async () => {
    adminVipApi.getMisCharts.mockResolvedValue({ cohort: { period_keys: [], series: {} }, startups: [] });
    render(<AdminVipMisCharts canWrite={false} />);
    await waitFor(() => expect(screen.getByText("No VIP startups are onboarded yet.")).toBeInTheDocument());
  });

  // G5: a startup with zero periods
  it("G5: a startup that never opened MIS gets its own message, not the matrix's default dash", async () => {
    adminVipApi.getMisCharts.mockResolvedValue({
      cohort: { period_keys: [], series: {} },
      startups: [{ application_id: "a1", startup: "NeverOpened Co", has_any_period: false, monthly_status: [], latest_period: null, series: {} }],
    });
    render(<AdminVipMisCharts canWrite={false} />);
    await waitFor(() => expect(screen.getByText("Hasn't opened MIS reporting yet.")).toBeInTheDocument());
  });

  it("toggles to the table view and renders the untouched AdminVipMisMatrix", async () => {
    adminVipApi.getMisCharts.mockResolvedValue({ cohort: { period_keys: [], series: {} }, startups: [] });
    render(<AdminVipMisCharts canWrite={false} />);
    await waitFor(() => screen.getByRole("button", { name: /table/i }));
    fireEvent.click(screen.getByRole("button", { name: /table/i }));
    expect(screen.getByTestId("matrix")).toBeInTheDocument();
  });

  it("renders a cohort roll-up card per GRAPH key when the cohort has data", async () => {
    adminVipApi.getMisCharts.mockResolvedValue({
      cohort: { period_keys: ["2026-05"], series: { revenue: [{ period_key: "2026-05", label: "May 2026", value: 10 }], burn: [], headcount: [], paying: [] } },
      startups: [],
    });
    render(<AdminVipMisCharts canWrite={false} />);
    await waitFor(() => expect(screen.getByTestId("card-revenue")).toBeInTheDocument());
  });
  ```

  Run — module not found, fails.

- [ ] **Step 3: Implement `AdminVipMisCharts.jsx`**

  ```jsx
  import React, { useState } from "react";
  import { adminVipApi } from "../../../../lib/adminVipApi.js";
  import { useAsync } from "../ui.jsx";
  import { LoadingState, ErrorState, EmptyState } from "../ui.jsx";
  import { PageHead } from "../shell/osAtoms";
  import { vipErrorInfo } from "./vipCohortHelpers.js";
  import { AdminVipMisMatrix } from "./AdminVipMisMatrix.jsx";
  import MisChartCard, { GRAPH } from "../../../../components/MisChartCard.jsx";
  import { misEmptyReason, misEmptyCopy } from "../../../../lib/misEmptyState.js";
  import "../../../../styles/admin-vip-mis-charts.css";

  export function AdminVipMisCharts({ canWrite }) {
    const [view, setView] = useState("charts"); // "charts" | "table"
    const { data, loading, error, reload } = useAsync(() => adminVipApi.getMisCharts(), []);

    return (
      <div>
        <PageHead
          eyebrow="VIP COHORT · MIS"
          title="MIS <em>reporting</em>"
          sub="Revenue, burn, headcount and paying customers across the cohort. Switch to the table to chase a missing report."
        />

        <div className="vipc-subnav" role="group" aria-label="MIS view">
          {[["charts", "Charts"], ["table", "Table"]].map(([v, label]) => (
            <button
              key={v} type="button" className={"vipc-subnav-btn" + (view === v ? " active" : "")}
              aria-pressed={view === v} onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "table" ? (
          <AdminVipMisMatrix canWrite={canWrite} />
        ) : loading ? (
          <LoadingState label="Loading the MIS cohort…" />
        ) : error ? (
          <ErrorState error={{ message: vipErrorInfo(error).message }} onRetry={reload} />
        ) : data.startups.length === 0 ? (
          <EmptyState label="No VIP startups are onboarded yet." /> // G6
        ) : (
          <>
            <section className="mis-cohort-rollup">
              <h3>Cohort total</h3>
              <div className="mis-charts-grid">
                {GRAPH.map((g) => (
                  <MisChartCard key={g.key} chartKey={g.key} title={g.title} series={data.cohort.series[g.key] || []} />
                ))}
              </div>
            </section>

            {data.startups.map((s) => (
              <section className="mis-startup-section" key={s.application_id}>
                <h3>{s.startup}</h3>
                {!s.has_any_period ? (
                  <p className="mis-charts-empty">Hasn't opened MIS reporting yet.</p> // G5
                ) : (
                  (() => {
                    const reason = misEmptyReason(s.monthly_status);
                    return reason ? (
                      <p className="mis-charts-empty">{misEmptyCopy(reason)}</p> // G2
                    ) : (
                      <>
                        {s.latest_period && (
                          <p className="mis-startup-latest">Latest: {s.latest_period.label}</p>
                        )}
                        <div className="mis-charts-grid">
                          {GRAPH.map((g) => (
                            <MisChartCard key={g.key} chartKey={g.key} title={g.title} series={s.series[g.key] || []} />
                          ))}
                        </div>
                      </>
                    );
                  })()
                )}
              </section>
            ))}
          </>
        )}
      </div>
    );
  }

  export default AdminVipMisCharts;
  ```

  `misEmptyReason` expects an array shaped `{status, overdue, label,
  due_date}` — `monthly_status` (Task 2's response shape) already matches
  that exactly, which is why Task 2 was built to return it in that shape
  rather than something admin-specific.

- [ ] **Step 4: `admin-vip-mis-charts.css`** — `.mis-cohort-rollup`,
  `.mis-startup-section`, `.mis-startup-latest`; reuse `.mis-chart-card`/
  `.mis-charts-grid`/`.mis-chart-empty` classnames from `mis-charts.css`
  (Task 5) for the shared chart-card chrome — do not redefine them here.
  `.vipc-subnav`/`.vipc-subnav-btn` are already defined in
  `admin-vip-cohort.css` (imported by `AdminVipCohort.jsx`) — do not
  redefine those either.

- [ ] **Step 5: Wire into `AdminVipCohort.jsx`**

  ```jsx
  import { AdminVipMisCharts } from "./AdminVipMisCharts.jsx"; // was: AdminVipMisMatrix
  ...
  {tab === "air" ? <AdminVipAirQueue canWrite={canWrite} /> : <AdminVipMisCharts canWrite={canWrite} />}
  ```

  In `AdminVipCohort.test.jsx`, wherever it currently asserts the "mis" tab
  renders `AdminVipMisMatrix`'s own content, mock `AdminVipMisCharts.jsx`
  instead (same shallow-mock idiom the file already uses for
  `AdminVipAirQueue`) and assert that.

- [ ] **Step 6: Run — all pass**

  ```bash
  cd frontend && npx vitest run src/pages/admin/platform/screens/__tests__/AdminVipMisCharts.test.jsx src/pages/admin/platform/screens/__tests__/AdminVipCohort.test.jsx
  ```

- [ ] **Step 7: Mutation-check**

  Change `!s.has_any_period` to `false` and confirm the G5 test fails
  (falls through to charts instead). Restore. Then change
  `data.startups.length === 0` to `false` and confirm the G6 test fails.
  Restore. Report both.

- [ ] **Step 8: Commit**

  ```bash
  git add frontend/src/lib/adminVipApi.js frontend/src/styles/admin-vip-mis-charts.css frontend/src/pages/admin/platform/screens/AdminVipMisCharts.jsx frontend/src/pages/admin/platform/screens/__tests__/AdminVipMisCharts.test.jsx frontend/src/pages/admin/platform/screens/AdminVipCohort.jsx frontend/src/pages/admin/platform/screens/__tests__/AdminVipCohort.test.jsx
  git commit -m "feat(vip-mis): admin cohort MIS charts screen"
  ```

---

### Task 11: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Backend — the known-good MIS/VIP command plus the new files**

  ```bash
  cd backend
  $PY -m pytest tests/test_founder_access.py tests/test_founder_crud.py tests/test_founder_mou.py \
    tests/test_founder_query.py tests/test_founder_journey.py tests/test_founder_resources.py \
    tests/test_vip_migration.py tests/test_vip_mou.py tests/test_vip_resources.py \
    tests/test_vip_endpoint_isolation.py tests/test_founder_project_name.py \
    tests/test_air_*.py tests/test_vip_air_migration.py tests/test_mis_*.py \
    tests/test_vip_mis_migration.py tests/test_migrations_parse.py \
    tests/test_admin_vip.py tests/test_admin_vip_pagination.py -q --no-cov
  ```

  Compare the failure count against VIP_BUILD_STATE.md's documented
  baseline (~20 pre-existing, unrelated failures) — any NEW failure here is
  this plan's responsibility.

- [ ] **Step 2: Frontend — full suite + build**

  ```bash
  cd frontend
  npx vitest run
  npm run build
  ```

  Compare against the documented baseline (2 known pre-existing failures:
  `AdminPipeline.test.js`, `AdminPipeline.unassign.test.jsx`).

- [ ] **Step 3: Route-removal sanity**

  ```bash
  grep -n "@router.put\|@router.post" backend/app/routers/founder_mis.py
  ```

  Confirm the only remaining decorated routes are `import` and
  `import/commit` (both POST) — no `put`, no bare `submit`.

- [ ] **Step 4: No-CDN sanity**

  ```bash
  grep -rn "cdn.jsdelivr\|unpkg.com\|chart.js/dist/chart.umd" frontend/index.html frontend/src/ 2>/dev/null || echo "NONE"
  grep -n "chart.js" frontend/package.json
  ```

  Confirm `NONE` for the first and exactly one dependency line for the
  second.

- [ ] **Step 5: Report**

  Summarize pass/fail counts for both suites against their documented
  baselines, and list anything Step 3/4 found.

---

## Out of scope

- **Email polling and attachment handling** (D4) — the import endpoints stay
  founder-authenticated HTTP routes, exactly as they are today; nothing in
  this plan adds a service-account/email-triggered caller. That is a later
  cycle's work.
- **The TIR MIS** — TIR has no MIS surface; `require_vip` already 409s a TIR
  caller on every route in `founder_mis.py`, unchanged.
- **Any `vip_mis_*` schema change** — migrations 043-045 stay frozen.
- **The cohort roll-up's exact aggregation rule, as an authoritative
  business number** — Task 2 ships a documented, tested default (partial
  sum, never zero-filled, never gated on full-cohort participation) but this
  plan does not have the authority to declare it final. Flagged in this
  plan's own "invented formulas" section and repeated in the final report.
- **`AdminVipMisPeriod.jsx`** (the matrix's own drill-down screen) — read
  for context, untouched; nothing in this rebuild changes what a single
  period's admin detail view shows.
- **Confirming staging can actually create synthetic auth users the way
  Task 3's `_ensure_onboarded_venture` assumes** — the profiles/role-grant
  trigger this relies on is documented (MEMORY.md) for prod; Task 3 flags
  inline that this needs verifying on staging before the seeder is trusted,
  rather than assuming it.
