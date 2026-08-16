# VIP Phase 5 — MIS forms UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 24-line `FounderMis.jsx` placeholder with the founder-facing monthly and quarterly MIS reporting screens spec §5 describes: pick a period, fill in its nine sections across five distinct rendering shapes (narrative, key-metrics grid, repeating entries, financial series grids, headcount grid), submit it, and never fight the backend's ordering/freeze/validation rules while doing it.

**Architecture:** One `GET /founder/mis` on mount returns the catalog plus both kinds' period lists (`monthly`, `quarterly` — each already sorted oldest-first by the backend). Selecting a period fires one `GET /founder/mis/{kind}/{period_key}`, which returns everything that one period needs in a single bundle: the period-scoped catalog slice, its metrics/financials/headcount/entries rows, its narrative blob, and `derived` — the values constraint 3 below forbids computing in the browser. Every section on the page is dispatched purely from `bundle.catalog.sections[kind]`; nothing about section numbers, titles, hints, field lists or option labels is hardcoded.

This phase does **not** reuse `Stepper.jsx`. AIR's five steps are a *gated ladder* — you cannot usefully look at Evidence before Technology/Commercial are answered, and Stepper's `furthest`/`onGo` machinery exists to express that gate. MIS has no such gate: a period can have a dozen sections, none blocking any other, and a venture that has been through several onboarding months has *many* periods, not five fixed ones. Forcing that shape into a five-circle stepper would either lie about a gate that doesn't exist or need a stepper that scales to fifteen circles, which is not what the component was built for. Instead: kind tabs (Monthly / Quarterly) + a period list (`PeriodPicker`, oldest-first, matching the in-order-submit rule) + all of the selected period's sections stacked on one scrollable page, each as its own card, submit gate at the bottom. This is also structurally the most honest match for the source: both ARTPARK templates *are* single documents with nine numbered sections, not a wizard.

**Tech Stack:** React 18, react-router-dom, Vitest + @testing-library/react, the existing `founderApi` client and `ui.jsx` atoms (`Loading`, `ErrorState`, `Tile`).

**Spec:** `docs/superpowers/specs/2026-08-15-vip-onboarding-design.md` §5 (§5.1 periods, §5.2 carry-forward, §5.3 structure, §5.4 section coverage, §5.5 TRL sourcing, §5.6/§5.7 import/export — **out of scope**, see below)

**Template source:** `docs/reference/mis-templates.md` — field ids, prompts, entry schemas, carry-forward rules.

**Backend (frozen, read-only reference):** `backend/app/routers/founder_mis.py`, `backend/app/services/mis_catalog.py`, `backend/app/services/mis_query.py`, `backend/app/services/mis_periods.py`, `backend/app/models/mis.py`.

**State doc:** `docs/superpowers/VIP_BUILD_STATE.md` — read "Founder UI conventions" and "Standing constraints" before Task 1. Phase 4 (`FounderTlr.jsx`, `LeverPanel.jsx`, `EvidenceRow.jsx`) is the idiom to match for autosave and null-with-two-causes handling; read those three files before Task 1 too.

## Global Constraints

- **Backend is frozen.** Phase 3 shipped and reviewed the MIS backend (`founder_mis.py`, `mis_catalog.py`, `mis_query.py`, `mis_periods.py`, `models/mis.py`). This phase adds no endpoint, changes no response shape, and touches nothing under `backend/`. If the UI appears to need a backend change, stop and raise it — do not edit the router or its services.

- **`frontend/src/lib/founderApi.js` is not edited by this plan.** It is assumed to already export the eight MIS thunks named in "MIS API surface" below, with those exact signatures. Every task's Interfaces block names only thunks from that list. If a task discovers the real file uses different names or signatures, adapt that task's call sites to match reality and note the discrepancy in the task's completion report — do not rename, add, or remove anything in `founderApi.js` itself.

- **New CSS lives only in `frontend/src/styles/founder-mis.css`, imported once, by `FounderMis.jsx` (Task 7).** Do not add or edit any rule in `frontend/src/styles/founder-portal.css` — another agent is editing it concurrently and a collision there is a merge conflict, not a code-review finding. Reuse founder-portal.css's existing generic classes directly where they already fit (`.tile`, `.card`, `.badge`, `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-sm` / `.btn-destructive`, `.chip`, `.dot` with `.green`/`.amber`/`.coral`, `.eyebrow`, `.hint`, `.fj-table`, `.fj-actions`, `.fj-inline-error`, `.fj-inline-warning`) — do not re-declare them under a new name. Every genuinely new rule (grids, section cards, period chips, RAG cells) gets a `mis-` prefixed class name in `founder-mis.css`, styled with the same custom-property tokens founder-portal.css already uses (`--artblue`, `--accent-violet`, `--accent-coral`, `--accent-green`, `--accent-amber`, `--ink`, `--ink-dim`, `--ink-soft`, `--line`, `--line-strong`, `--paper`, `--paper-soft`). `founder-mis.css` is created in Task 1 and appended to by each later task that introduces a new class — it is not written in one pass at the end.

- **Nothing about the template is hardcoded.** Section numbers/titles/hints, narrative prompts, entry field lists/types/options, metric keys/labels/groups, financial series/bucket labels, headcount categories — all come from `bundle.catalog` (index-level or period-level). A test in every component task renames something in the fixture and asserts the new text renders, the same proof Phase 4 used throughout.

- **Autosave, no save buttons — but not one autosave shape.** Phase 4's AIR wizard fired a PUT on every discrete answer (a radio click), which is cheap because each PUT touches one lever. MIS has three different write shapes and each gets the autosave cadence that shape actually tolerates — get this wrong and either data silently vanishes or the UI hammers the API on every keystroke:
  - **Narrative** (`putMisNarrative`) — merges into the blob; commit one field's value on blur.
  - **Metrics / Financials / Headcount** (`putMisMetrics` / `putMisFinancials` / `putMisHeadcount`) — targeted upsert by key; commit just the one row that changed, on blur for text/number fields, immediately on change for selects.
  - **Entries** (`putMisEntries`) — **wholesale replace of the entire section.** Every write must carry the section's full current row array, including every untouched row, or those rows are deleted server-side. See Task 4 and "Things that will corrupt a report" below — this is the single sharpest trap in this phase.
  - No field anywhere fires a request on every keystroke; every free-text/numeric input commits on blur. Discrete inputs (select, checkbox-equivalent, native date picker) commit immediately on change.

- **Never recompute a derived value.** `derived.metrics.vs_last`, `derived.financials.needs_gap`, `derived.headcount.net_change`, `derived.headcount.total`, and the annual-revenue FY bucket labels (`catalog.financial_buckets.annual_revenue`) are all computed server-side and arrive in the bundle. Render them; never re-derive them from raw rows in JavaScript, even when it looks trivial (`needs_gap` looks like `a - b - c`; it is, but computing it client-side duplicates a formula the frontend has no business owning, and Phase 3's own retrospective is explicit that an invented formula is how a sign error shipped past three reviews).

- **Zero is not null, anywhere.** `vs_last`, `needs_gap`, `net_change`, and the headcount Total row's sums can all legitimately be `0` — a real, reportable value, not "nothing entered." Every one of those must render the literal `0` and every renderer that has an "empty" branch must reach it only when the value is actually `null`, never via a falsy check (`value ? … : "—"` breaks this the moment `value` is `0`). Section 2 below enumerates every place this applies; each has its own test.

- **Periods render oldest-first, matching the backend's in-order-submit rule.** `bundle.monthly` / `bundle.quarterly` already arrive oldest-first (`mis_query._fetch_periods` sorts by `period_key` ascending) — `PeriodPicker` renders that array as given and never reverses or re-sorts it.

- **Submitted means frozen for writes, not for reads.** A period whose `status !== "draft"` disables every input in every section component, but the bundle for it still loads and renders normally — including periods *behind* the currently selected one. Never gate a read on status.

- Never put Co-Authored-By, Claude, Anthropic or any AI reference in a commit message. Commits are solely authored by the repo owner.
- Frontend tests run with `cd frontend && npx vitest run`. Every task ends green.

---

## MIS API surface (pre-supplied, `founderApi.js`)

Assumed already present. Every request/response shape below is transcribed directly from `founder_mis.py` / `mis_query.py` / `models/mis.py` — not invented.

| Thunk | Endpoint | Write semantics | Body / notes |
|---|---|---|---|
| `getMis()` | `GET /founder/mis` | read | Returns `{catalog, monthly: [...], quarterly: [...]}`. Each period-list entry: `{period_key, label, status, due_date, overdue}`. `catalog` here is the **index** slice — see "Two catalog shapes" below. |
| `getMisPeriod(kind, periodKey)` | `GET /founder/mis/{kind}/{period_key}` | read | Returns the full period bundle — see "The period bundle" below. 404 `not_found` if the period doesn't exist yet (shouldn't happen for a period `getMis` just listed). |
| `putMisMetrics(kind, periodKey, rows)` | `PUT /founder/mis/{kind}/{period_key}/metrics` | **targeted upsert** | `rows: [{metric_key, label?, target?, actual?, rag?, commentary?}]`. Only rows present in the array are touched. Monthly only (404 on quarterly). `actual` on `metric_key: "trl_level"` 422s `computed_metric` — never send it. `label` is honoured only for `product_metric_1`/`product_metric_2`. Returns the full period bundle. |
| `putMisNarrative(kind, periodKey, fields)` | `PUT /founder/mis/{kind}/{period_key}/narrative` | **merge** | `fields: {field_id: string \| null}`. Unmentioned keys are left untouched; an explicit `null` clears a field. Unknown field ids 422 `unknown_field`. Returns the full period bundle. |
| `putMisEntries(kind, periodKey, section, rows)` | `PUT /founder/mis/{kind}/{period_key}/entries/{section}` | **wholesale replace** | `rows: [{...one dict per row, keyed by that section's own field schema — NO `id`/`sort_order`/`section` envelope}]`. Deletes and reinserts every row for `(period_id, section)`; anything not in `rows` is gone. Returns the full period bundle. |
| `putMisFinancials(kind, periodKey, rows)` | `PUT /founder/mis/{kind}/{period_key}/financials` | **targeted upsert** | `rows: [{series, bucket, amount}]`, keyed by `(series, bucket)`. Quarterly only. `series: "needs_gap"` 422s `computed_metric` — it is never writable. Returns the full period bundle. |
| `putMisHeadcount(kind, periodKey, rows)` | `PUT /founder/mis/{kind}/{period_key}/headcount` | **targeted upsert** | `rows: [{category, current_count?, exited?, remarks?}]`, keyed by `category`. Quarterly only. No `net_change` field exists to send. Returns the full period bundle. |
| `submitMisPeriod(kind, periodKey)` | `POST /founder/mis/{kind}/{period_key}/submit` | write, no body | Freezes the period. 409 `mis_earlier_period_open` (detail carries `period_key`/`label` of the blocker) if an earlier period of the *same kind* is still draft. 409 `mis_already_submitted` if it's already frozen. Returns the full period bundle. |

Every write endpoint validates, never coerces (Global Constraint, restated per-field in each task): a numeric-looking string 422s `invalid_value`; dates must be strict `YYYY-MM-DD`; ints reject non-integer floats. Every "empty" value this UI ever sends is JSON `null`, never `""`.

**Two catalog shapes.** `getMis()`'s `catalog` (index-level) and a period bundle's `catalog` (period-level) are *not* the same shape:

- Index-level: `{kinds, sections, narrative_fields, entry_fields, metrics, metric_groups, headcount_categories, financial_series, financial_buckets: {needs: [...]}}` — `financial_buckets` carries **only** `needs`, because the annual-revenue bucket labels are fiscal-year-relative and only meaningful once a specific period is known.
- Period-level (inside a period bundle): `{kind, sections, entry_fields, narrative_fields, [metrics, metric_groups] (monthly) | [financial_series, financial_buckets: {annual_revenue: [...6 labels for THIS period's FY], needs: [...]}, headcount_categories] (quarterly)}`.

**`FinancialsGrid` (Task 5) must only ever be given the period-level catalog's `financial_buckets.annual_revenue`.** The index-level one doesn't have it. This is a real footgun if a task wires the wrong catalog object in.

**The period bundle**, in full:

```
{
  catalog: { ...period-level shape above... },
  period: { id, kind, period_key, label, period_start, period_end, due_date,
            status, submitted_at, reopened_at },
  metrics: [ {id, period_id, metric_key, label, group_key, unit, target,
              actual, prev_actual, rag, commentary, is_custom, sort_order}, ... ],   // monthly only, else []
  financials: [ {id, period_id, series, bucket, amount, sort_order}, ... ],           // quarterly only, else []
  headcount: [ {id, period_id, category, current_count, exited, remarks}, ... ],      // quarterly only, else []
  entries: { section_id: [ {id, period_id, section, sort_order, data: {...}}, ... ] },
  narrative: { field_id: string | null },
  derived: {
    metrics: { vs_last: { metric_key: number | null } },
    financials: { needs_gap: { bucket: number | null } },
    headcount: {
      net_change: { category: number | null },
      total: { current_count: number | null, exited: number | null },   // NOTE: no net_change key at all
    },
  },
}
```

`entries` is keyed by every entries-section id `kind` has, **unioned with `mis_catalog.SECTION_EXTRA_ENTRIES`** — today that's exactly one extra key, `next_milestones`, hanging off the `planned_vs_actual` section. `bundle.catalog.sections["quarterly"]` has one entry with `id: "planned_vs_actual"`; there is no separate `SECTIONS` row for `next_milestones`. A renderer that walks `sections` and only looks up `entries[section.id]` will silently never render the founder's "Top milestones for next quarter" table. Task 7 handles this explicitly.

---

## Empty and derived-value states this UI must render distinctly

Every row below is a real state a founder will actually hit, not a hypothetical. Each gets its own copy in the task that owns it; this table is the canonical reference the tasks cite by id.

### Page level

| id | State | Cause | Copy / treatment |
|---|---|---|---|
| E1 | `bundle.monthly` and `bundle.quarterly` both `[]` | Founder's application is `offered`, not yet `onboarded` — `get_mis` returns empty calendars rather than guessing a start date. | "MIS reporting opens once your venture is onboarded. Nothing is due yet." No tabs, no period list rendered. |
| E2 | One kind's period list is `[]` while the founder IS onboarded | Defensive only — shouldn't happen once onboarded (both calendars generate from the same `onboarded_on`), but must not crash. | "No {kind} periods yet — check back once your first one opens." |
| E3 | Index fetch in flight | Normal page load. | `Loading` (full page, no form skeleton). |
| E4 | Index or period-bundle fetch failed | Network/permission error. | `ErrorState` — distinct component from E3, never a disabled-looking form (a disabled form reads as E22, not E4). |

### Metrics grid (`MetricsGrid`, Task 3)

| id | State | Cause | Copy |
|---|---|---|---|
| E5 | `actual` is `null` | Nothing typed yet this period. | No `vs_last` badge rendered at all — there is nothing to compare *from*. |
| E6 | `actual` present, `vs_last` `null`, this is the first period of its kind | No earlier period exists to compare against. | "First reporting period — nothing to compare yet." |
| E7 | `actual` present, `vs_last` `null`, NOT the first period | An earlier period exists but its own `actual` for this metric was blank. | "No comparable figure last period." |
| E8 | `vs_last` is exactly `0` | A real, reportable "no change." | Render `"0"` (or `"+0"` — pick one, be consistent), never blank, never the E7 copy. |
| E9 | `trl_level.actual` is `null` | **Two indistinguishable causes** — no AIR round exists yet for the current quarter, OR a round exists but not all six levers are verified. The bundle gives no signal telling these apart (`_current_verified_trl` returns `None` identically for both). | One copy, honest for both: "Populated automatically once ARTPARK has verified all six AIR levers this quarter." Do **not** pick one cause and imply the other doesn't exist. |
| E10 | A metrics row exists whose `metric_key` is not one of the 13 catalog keys (`is_custom: true` or unrecognised) | Carried forward from an earlier period; **there is no way to create one today** — `put_metrics` 422s `unknown_field` for any `metric_key` outside the 13-key catalog, so despite the template's own "add rows for your business-specific KPIs" invitation, this endpoint doesn't support it. | Render read-only: "Carried forward from an earlier period. Contact ARTPARK to update it." Do **not** build an "add custom metric" control — see "Do not invent" below. |

### Entries tables (`EntriesTable`, Task 4)

| id | State | Cause | Copy |
|---|---|---|---|
| E11 | A section's row list is `[]`, this is the first period of its kind | Nothing has ever existed to carry forward or type. | "No {section title} yet — this is your first reporting period. Add one below." |
| E12 | A section's row list is `[]`, NOT the first period | Either this section never carries forward (risks/asks/publications/planned_vs_actual/next_milestones — always start empty) or it does carry forward and genuinely produced nothing (e.g. every milestone is Done, or the register is genuinely empty). **The catalog does not expose which**, so one honest, cause-agnostic copy covers both correctly. | "Nothing here for this period yet. Add a row if there's something new." |
| E13 | A bucketed section (`ip_assets`/`collaborations`/`publications`) has a bucket with zero rows | Normal — not every venture has, say, a `rejected` IP filing. | The bucket header still renders (so the founder can see it exists and add into it); body reads "No {bucket label} yet." — no false alarm framing. |

### Financials grid (`FinancialsGrid`, Task 5)

| id | State | Cause | Copy |
|---|---|---|---|
| E14 | `needs_gap[bucket]` is `null` | One or more of `needs_total`/`needs_confirmed`/`needs_projected` for that bucket is still blank. | "Shows once Total, Confirmed and Projected are all filled in." |
| E15 | `needs_gap[bucket]` is exactly `0` | Confirmed + Projected happen to fully cover Total. | Render `"0"`, never the E14 copy. |

### Headcount grid (`HeadcountGrid`, Task 6)

| id | State | Cause | Copy |
|---|---|---|---|
| E16 | A category's `net_change` is `null`, this is the first quarterly period | No previous quarter exists to diff against. | "No prior quarter to compare." |
| E17 | A category's `net_change` is `null`, NOT the first quarterly period | The previous quarter's `current_count` for that category was itself left blank. | "Last quarter's headcount wasn't recorded." |
| E18 | A category's `net_change` is a real number, including `0` or negative | Real stock-over-time delta. | Render the signed number verbatim (`"+2"`, `"-3"`, `"0"`). |
| E19 | The Total row's `net_change` cell | The source template leaves this cell blank by definition — `derived.headcount.total` carries no `net_change` key at all. | **No text, no dash, nothing rendered in that cell** — structurally different from E16/E17, which always render *some* explanatory text. Rendering `"—"` here would wrongly claim "this concept applies but has no value." |
| E20 | Total row `current_count`/`exited` is `null` | Every one of the four categories is itself blank — `_partial_sum` returns `None` only when *all* four are null. | "—" |
| E21 | Total row `current_count`/`exited` is a number, including when some categories are still blank | At least one category has a value; blanks count as 0 in the sum but the row is not itself "empty." | Render the number exactly as `derived.headcount.total` gives it — never re-sum client-side, never collapse a partial sum to "—". |

### Freeze / submit (`FounderMis`, Task 7)

| id | State | Cause | Copy |
|---|---|---|---|
| E22 | `period.status !== "draft"` | Submitted. | Every input in every section disabled; the period still reads normally. |
| E23 | Submit 409s `mis_earlier_period_open` | An earlier period of the same kind is still draft. | Not a generic error banner — a dedicated banner naming `detail.label` with a button that switches selection to `detail.period_key`. |
| E24 | Any write 409s `mis_already_submitted` | Raced — the period was frozen elsewhere (another tab, an admin action) since this page loaded. | Distinct copy ("This period was submitted elsewhere — refreshing.") + refetch the bundle so the UI actually flips to E22, rather than silently failing to save forever. |
| E25 | Any other write failure (422 validation, network) | Genuine bug or connectivity issue — this UI is built to avoid 422s by construction (native typed inputs, `null` for empty), so a 422 reaching here means something upstream drifted. | Generic non-blocking `actionError` banner, same shape as Phase 4's `describeActionError`. |

---

## Formulas and rules this plan does NOT invent — raise, don't guess

Each of these was deliberately left unresolved because inventing an answer risks exactly the kind of silent, plausible-looking mistake the AIR ladder-copy and net_change sign-error retrospectives are about. Flag these to the person who can actually answer them; do not pick an answer and ship it quietly.

1. **Custom metrics have no write path.** The catalog's own hint says "Add rows for your business-specific KPIs" but `put_metrics` 422s any `metric_key` outside its 13-key catalog. This plan renders any existing custom row read-only (E10) and builds no "add metric" UI. Raise this gap; do not add a client-side workaround (e.g. smuggling a custom key through `entries` — there is no entries section for metrics).
2. **Submit has no completeness gate.** Unlike AIR (blocked until all six levers have a claimed level), `submit_period` only checks period ordering — a founder can submit a period with every section blank. This plan does **not** add a client-side "you must fill in X before submitting" requirement of any kind, soft or hard. If that feels wrong, that's a product question for whoever owns the MIS backend, not something to solve by inventing a completeness heuristic in the frontend.
3. **No "days until due" / "days overdue" math.** `overdue` is a backend-computed, IST-anchored boolean; `due_date` is a plain date. Do not compute a day-count from `due_date` against the browser's `Date.now()` — a client clock and a client timezone can disagree with the backend's IST rule right at the boundary, the exact class of bug `mis_periods.py`'s own module docstring says shipped once already (5.5 hours of mislabelled periods). Render `overdue` as given; if a countdown is wanted, that's a backend addition to `periods_index`, not a frontend approximation.
4. **Annual-revenue FY bucket labels are never recomputed client-side.** `annual_revenue_buckets()` on the backend is quarter-boundary-sensitive, real logic (four historical FYs + current-FY YTD/Proj, computed from *this period's* fiscal year). Render `catalog.financial_buckets.annual_revenue` verbatim.
5. **Entries carry-forward classification (`mis_catalog.CARRY_FORWARD`) is not exposed to the frontend** — `_index_catalog`/`_catalog_for_kind` never send it. E12's copy is deliberately cause-agnostic for this reason. Do not hardcode a client-side copy of which sections carry forward "to improve" the copy — that duplicates a server-owned rule outside the server, the same class of drift `rbac.py` ↔ `rbac.js` already has to be hand-synced to avoid elsewhere in this codebase.
6. **No per-section "completeness" concept exists.** If a future progress indicator is wanted (a ring, a checklist), that needs a catalog-level definition of "done" from the backend team — do not invent one (e.g. "at least one row," "every narrative field non-empty") in this phase.

---

## Things that will corrupt a report if you get them wrong

1. **`putMisEntries` replaces the whole section.** A single-row PUT to `/entries/{section}` deletes every other row in that section. Every entries write must carry the section's complete current array. Task 4's highest-value test and mutation check both exist to guard exactly this.
2. **`putMisMetrics`/`putMisFinancials`/`putMisHeadcount` are the opposite shape** — targeted upserts. Sending the *whole* metrics array on every keystroke works but is wasteful and racy against itself; send only the row that changed.
3. **Zero is not null**, anywhere `derived.*` or a Total-row sum appears (E8, E15, E18, E20/E21). A falsy check instead of an explicit `=== null` / `!= null` check silently turns a real `0` into a missing-data message on a report ARTPARK forwards to DST/NM-ICPS and the Governing Council.
4. **`trl_level` is never an editable input**, in any state, draft or submitted — sending any `actual` for it 422s `computed_metric`. Don't render a control that is guaranteed to fail (same principle EvidenceRow already established for AIR's `no_document_required`).
5. **Submitted periods still read** — including periods behind the one currently open. Don't gate a `GET` on status the way writes are gated.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/styles/founder-mis.css` | *Create* (Task 1), *append* (Tasks 2-7). New MIS-specific rules only. |
| `frontend/src/pages/founder/components/PeriodPicker.jsx` | *Create.* Oldest-first period list for one kind, with status/overdue chips and selection. |
| `frontend/src/pages/founder/components/NarrativeSection.jsx` | *Create.* One section's free-text prompts. |
| `frontend/src/pages/founder/components/MetricsGrid.jsx` | *Create.* The §2 Key Metrics grid: 13 catalog rows, grouped, with `vs_last` and the read-only `trl_level`/custom rows. |
| `frontend/src/pages/founder/components/EntriesTable.jsx` | *Create.* Generic repeating-row editor for every `entries`-type section, including bucket sub-grouping. |
| `frontend/src/pages/founder/components/FinancialsGrid.jsx` | *Create.* Quarterly §6: annual-revenue grid + financial-needs grid with the read-only Gap row. |
| `frontend/src/pages/founder/components/HeadcountGrid.jsx` | *Create.* Quarterly §8: four category rows + the Total row with its deliberately blank `net_change` cell. |
| `frontend/src/pages/founder/FounderMis.jsx` | *Rewrite.* Kind tabs, period selection/default, section dispatch, submit gate, 409 handling. |
| `frontend/src/pages/founder/__tests__/PeriodPicker.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/NarrativeSection.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/MetricsGrid.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/EntriesTable.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/FinancialsGrid.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/HeadcountGrid.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/FounderMis.test.jsx` | *Create.* |
| `frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx` | *Modify* (Task 7). Update the one MIS-tab assertion to match the real page; keep the rest of the file untouched. |

---

### Task 1: `PeriodPicker` — the oldest-first period list

**Files:**
- Create: `frontend/src/pages/founder/components/PeriodPicker.jsx`
- Create: `frontend/src/styles/founder-mis.css` (first classes: `.mis-period-list`, `.mis-period-chip`, `.mis-period-chip.is-selected`, `.mis-period-status`, `.mis-period-status.is-draft`, `.mis-period-status.is-submitted`, `.mis-period-status.is-overdue`)
- Test: `frontend/src/pages/founder/__tests__/PeriodPicker.test.jsx`

**Interfaces:**
- Consumes: one kind's slice of `getMis()`'s response — an array of `{period_key, label, status, due_date, overdue}`, already oldest-first.
- Produces: `<PeriodPicker kind periods selectedKey onSelect />`. Presentational only, no `founderApi` import.

**Behaviour:**
- Renders `periods` **in array order** — never sorts or reverses. A test proves this directly (fixture deliberately not in an order that would look right if accidentally reversed).
- Each row: `label`, a status chip. `status === "submitted"` → "Submitted" chip. `status === "draft" && overdue === true` → "Overdue" chip (replaces, doesn't sit beside, a plain "Draft" chip). `status === "draft" && !overdue` → "Draft" chip.
- `period_key === selectedKey` → the row carries `aria-current="true"` and a `.is-selected` class.
- Clicking a row calls `onSelect(period_key)`.
- `periods.length === 0` → renders E2's copy ("No {kind} periods yet — check back once your first one opens.") and nothing else. `kind` is used verbatim — it is always exactly `"monthly"` or `"quarterly"` (`mis_catalog.KINDS`), and both read correctly in that sentence with no transformation needed.

- [ ] **Step 1: Write the failing tests**

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PeriodPicker from "../components/PeriodPicker.jsx";

const PERIODS = [
  { period_key: "2026-06", label: "Jun 2026", status: "submitted", due_date: "2026-07-05", overdue: false },
  { period_key: "2026-07", label: "Jul 2026", status: "draft", due_date: "2026-08-05", overdue: true },
  { period_key: "2026-08", label: "Aug 2026", status: "draft", due_date: "2026-09-05", overdue: false },
];

describe("PeriodPicker", () => {
  it("renders periods in the given order, not reversed", () => {
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={() => {}} />);
    const labels = screen.getAllByText(/2026$/).map((el) => el.textContent);
    expect(labels).toEqual(["Jun 2026", "Jul 2026", "Aug 2026"]);
  });

  it("shows Submitted for a submitted period, no Draft/Overdue chip", () => {
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={() => {}} />);
    const row = screen.getByText("Jun 2026").closest("[data-period-key]");
    expect(row).toHaveTextContent("Submitted");
    expect(row).not.toHaveTextContent("Draft");
    expect(row).not.toHaveTextContent("Overdue");
  });

  it("shows Overdue instead of Draft for an overdue draft period", () => {
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={() => {}} />);
    const row = screen.getByText("Jul 2026").closest("[data-period-key]");
    expect(row).toHaveTextContent("Overdue");
    expect(row).not.toHaveTextContent(/^Draft$/);
  });

  it("shows plain Draft for a non-overdue draft period", () => {
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={() => {}} />);
    const row = screen.getByText("Aug 2026").closest("[data-period-key]");
    expect(row).toHaveTextContent("Draft");
    expect(row).not.toHaveTextContent("Overdue");
  });

  it("marks the selected period and calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={onSelect} />);
    const selected = screen.getByText("Jul 2026").closest("[data-period-key]");
    expect(selected).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByText("Aug 2026"));
    expect(onSelect).toHaveBeenCalledWith("2026-08");
  });

  it("renders the empty-calendar copy and nothing else when periods is empty", () => {
    render(<PeriodPicker kind="monthly" periods={[]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText(/No monthly periods yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch every test fail** (module not found).

- [ ] **Step 3: Implement `PeriodPicker.jsx`**, presentational only, `data-period-key` on each row for the tests to key on. Add the CSS classes listed above to `frontend/src/styles/founder-mis.css` (create the file).

- [ ] **Step 4: Run — all pass.**

- [ ] **Step 5: Mutation-check.** Change the overdue condition to check `status === "submitted"` instead of `overdue`. Confirm the "Overdue instead of Draft" test fails AND the "Submitted... no Overdue chip" test fails. Restore both. Report exactly which tests caught it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/PeriodPicker.jsx frontend/src/pages/founder/__tests__/PeriodPicker.test.jsx frontend/src/styles/founder-mis.css
git commit -m "feat(vip): PeriodPicker — oldest-first MIS period list"
```

---

### Task 2: `NarrativeSection` — free-text prompts

**Files:**
- Create: `frontend/src/pages/founder/components/NarrativeSection.jsx`
- Modify: `frontend/src/styles/founder-mis.css` (append `.mis-narrative-field`, `.mis-narrative-prompt`)
- Test: `frontend/src/pages/founder/__tests__/NarrativeSection.test.jsx`

**Interfaces:**
- Consumes: `bundle.catalog.narrative_fields[sectionId]` (`[{id, prompt}]`) and `bundle.narrative` (flat `{field_id: string|null}`, shared across the whole period — a section only ever reads the subset of keys that are its own).
- Produces: `<NarrativeSection fields values disabled onChange />` where `onChange(fieldId, value)` fires with `value` already normalised (a real string, or `null` for empty — never `""`). No `founderApi` import; the caller (Task 7) owns the actual `putMisNarrative` call and its debounce-on-blur timing.

**Behaviour:**
- One `<textarea>` per field in `fields`, labelled with its `prompt` text.
- A field id absent from `values` (never yet touched) renders an empty textarea — this is not an ambiguous empty state (unlike E5-E21): a blank narrative field has exactly one meaning, "not answered yet," so no special copy is needed here beyond the placeholder being empty.
- Typing then blurring fires `onChange(fieldId, trimmedNonEmptyValue)`. Blurring an emptied field fires `onChange(fieldId, null)` — not `""`. Typing alone (no blur) fires nothing.
- `disabled` makes every textarea read-only and `onChange` never fires from user interaction.
- Nothing about prompt text or field ids is hardcoded — sourced entirely from `fields`.

- [ ] **Step 1: Write the failing tests** covering: renders each field's prompt and current value; renders an empty textarea for a field missing from `values`; blur after typing calls `onChange(fieldId, "new text")`; blur after clearing calls `onChange(fieldId, null)` (not `""`); typing without blurring calls `onChange` zero times; `disabled` makes every textarea non-editable and swallows attempts to fire `onChange`; renaming a fixture prompt makes the new text appear (catalog-driven proof).

- [ ] **Step 2: Run — fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check.** Change the blur handler to send the raw (possibly `""`) value instead of normalising to `null`. Confirm the "clearing calls onChange(fieldId, null)" test fails. Restore.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/NarrativeSection.jsx frontend/src/pages/founder/__tests__/NarrativeSection.test.jsx frontend/src/styles/founder-mis.css
git commit -m "feat(vip): NarrativeSection — MIS free-text prompts"
```

---

### Task 3: `MetricsGrid` — the §2 Key Metrics table

**Files:**
- Create: `frontend/src/pages/founder/components/MetricsGrid.jsx`
- Modify: `frontend/src/styles/founder-mis.css` (append `.mis-metrics-grid`, `.mis-metric-group`, `.mis-metric-row`, `.mis-metric-readonly`, `.mis-vs-last`, `.mis-vs-last.is-up`/`.is-down`/`.is-flat`)
- Test: `frontend/src/pages/founder/__tests__/MetricsGrid.test.jsx`

**Interfaces:**
- Consumes: `bundle.metrics`, `bundle.catalog.metric_groups`, `bundle.derived.metrics.vs_last`, and `isFirstPeriod` (a boolean the shell computes — see Task 7 — from whether any earlier monthly period exists).
- Produces: `<MetricsGrid metrics metricGroups vsLast isFirstPeriod disabled onChange />`, `onChange(metricKey, field, value)` where `field` is one of `"target" | "actual" | "rag" | "commentary" | "label"` (`"label"` only ever fires for `product_metric_1`/`product_metric_2`). No `founderApi` import.

**Behaviour:**
1. Group rows by `group_key`, in `metricGroups` catalog order; render each group's `label` as a header.
2. `trl_level` renders **never as an input, in any state** — a plain number when `actual != null`, else E9's copy. Sending any `actual` for it 422s `computed_metric` server-side; do not build a control that can trigger that.
3. A row whose `metric_key` is not one of the 13 catalog keys (`is_custom` or unrecognised) renders read-only with E10's copy, grouped under its own `group_key` if recognised or an "Other" fallback group if not.
4. `product_metric_1`/`product_metric_2` get an editable label text input in addition to the normal target/actual/rag/commentary controls; every other row's label is plain text.
5. `vs_last` column, per E5-E8:
   - `actual == null` → nothing rendered in that column (E5).
   - `actual != null && vsLast[key] == null && isFirstPeriod` → E6 copy.
   - `actual != null && vsLast[key] == null && !isFirstPeriod` → E7 copy.
   - `actual != null && vsLast[key] != null` → the signed number, **including exactly `0`** (E8) — render with `!= null`, never a truthiness check.
6. RAG renders as a `<select>` (green/amber/red/—); commits immediately on change (discrete input).
7. `target`/`actual`/`commentary`/`label` are text/number inputs; commit on blur, normalising an emptied field to `null`.
8. `disabled` disables every editable control (RAG select, target/actual/commentary/label inputs) — `trl_level` and custom rows are already non-interactive regardless.

- [ ] **Step 1: Write the failing tests.** Build a 13-row + 1 custom-row fixture across all 4 groups. Cover, at minimum:
  - renders all 13 catalog metrics under their 4 group headers, in catalog order
  - `trl_level` renders no input anywhere, in both `disabled=false` and `disabled=true`
  - `trl_level` with `actual: 6` shows "6"; with `actual: null` shows the exact E9 copy
  - the custom row renders read-only with the exact E10 copy, and is never targeted by an editable control
  - `vs_last`: `actual: 40, vs_last: null, isFirstPeriod: true` → E6 copy; `actual: 40, vs_last: null, isFirstPeriod: false` → E7 copy (assert the two strings differ); `actual: 40, vs_last: 0` → renders `"0"`, not E7's copy; `actual: null` (any `vs_last`) → no vs_last content rendered at all
  - editing `actual` commits on blur only (type without blur → zero calls; blur → one call with the typed value)
  - clearing `actual` on blur calls `onChange(key, "actual", null)`
  - `product_metric_1`'s label is an editable input; every other row's label is plain text (assert absence of an input for, say, `revenue_month`'s label)
  - `disabled` disables every editable control
  - renaming a metric's label and a group's label in the fixture makes the new text appear (catalog-driven proof)

- [ ] **Step 2: Run — fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check, two separate mutations, both reported:**
  1. Change the `vs_last` branch to check `isFirstPeriod` only when `vs_last === undefined` instead of `=== null` (or otherwise skip the `isFirstPeriod` branch entirely, always rendering E7's copy). Confirm the E6 test fails.
  2. Change the `vs_last` render to `vsLast[key] ? ... : "—"` (a truthiness check). Confirm the "`vs_last: 0` renders `0`" test fails.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/MetricsGrid.jsx frontend/src/pages/founder/__tests__/MetricsGrid.test.jsx frontend/src/styles/founder-mis.css
git commit -m "feat(vip): MetricsGrid — §2 Key Metrics with vs_last and read-only TRL"
```

---

### Task 4: `EntriesTable` — the generic repeating-row editor

This is the highest-risk task in the phase: `PUT .../entries/{section}` **replaces the whole section**. Read "MIS API surface" and "Things that will corrupt a report" above before writing a line of this component.

**Files:**
- Create: `frontend/src/pages/founder/components/EntriesTable.jsx`
- Modify: `frontend/src/styles/founder-mis.css` (append `.mis-entries-table`, `.mis-entries-row`, `.mis-entries-bucket-head`, `.mis-entries-add`, `.mis-entries-remove`, `.mis-entries-empty`)
- Test: `frontend/src/pages/founder/__tests__/EntriesTable.test.jsx`

**Interfaces:**
- Consumes: `bundle.catalog.entry_fields[sectionId]` (`[{key, label, type, options?, option_labels?}]`, `type` one of `text|int|numeric|date|bool|choice`), `bundle.entries[sectionId]` (`[{id, sort_order, data}]`), and `isFirstPeriod`.
- Produces: `<EntriesTable sectionId title fields rows isFirstPeriod disabled onSave />`. `onSave(sectionId, rows)` is called with the **complete, current array of plain `data`-shaped objects** (`rows.map(r => r.data)` plus whatever edit/add/remove just happened) every single time — never a partial diff. The caller (Task 7) is the one that actually calls `putMisEntries(kind, periodKey, sectionId, rows)` and replaces local state from the response bundle's `entries[sectionId]`.

**Behaviour:**
1. **Every mutation — edit a field, add a row, remove a row — calls `onSave` with the section's full row array, not just what changed.** This is the load-bearing property of the whole task; see the dedicated test and mutation check below.
2. Field rendering by `type`:
   - `text` → `<input type="text">`, commits on blur, empty → `null`.
   - `int`/`numeric` → `<input type="number">` (`step="1"` for `int`), commits on blur, empty → `null`.
   - `date` → native `<input type="date">` (structurally produces strict `YYYY-MM-DD` or `""`), commits on change, empty → `null`.
   - `choice` → `<select>` with a blank/"—" option plus `field.options` (using `field.option_labels` for display text when present, e.g. `asks.category`), commits on change, blank → `null`.
   - `bool` → a **tri-state** `<select>` with "—" / "Yes" / "No" — **not a checkbox**. `_validate_entry_value` explicitly accepts `None` for any type, including `bool`, and a checkbox has no way to represent "not answered" distinctly from "No." Selecting "—" writes `null`, "No" writes `false` — these are different values and must stay different.
3. **Bucket sub-grouping.** When `fields` contains a field with `key === "bucket"`, group displayed rows by that field's own value, in the order `field.options` declares (not row order, not alphabetical). Render a header for every bucket in `options`, **even ones with zero rows** (E13) — a founder needs to see the bucket exists to add into it. Sections without a `bucket` field (e.g. `milestones`, `risks`, `asks`) render as a flat list, no bucket headers.
4. **Add row** appends a blank row (every field `null`) and immediately calls `onSave` with the full array including it — there is no "unsaved local-only row" concept; state is always server-truth-driven, matching "no save buttons."
5. **Remove row** calls `onSave` with the array excluding that row, immediately.
6. Empty state (`rows.length === 0`): E11 copy when `isFirstPeriod`, E12 copy otherwise — the two must render different strings; assert both, and assert the copy is NOT conditioned on which specific section it is (E12 is deliberately cause-agnostic per "Formulas... not to invent" #5). **E11's copy interpolates the `title` prop** ("No {title} yet — this is your first reporting period.") — this is what the `title` prop declared in Interfaces is for; a fixture with a distinctive `title` value must show up verbatim in that sentence.
7. `disabled` disables every field control and hides Add/Remove entirely (not just disables them — a disabled Add button next to a frozen report invites clicking it to see what happens).

- [ ] **Step 1: Write the failing tests.** Use two fixtures: a bucketed one (`ip_assets`' real field schema, 5 buckets) and a flat one (`milestones`' real field schema). Cover:
  - renders one row per `rows` entry with each field's current `data` value, columns from `fields`' labels
  - bucketed fixture: rows group under the right bucket headers in `field.options` order; a bucket with zero matching rows still renders its header + E13 copy
  - flat fixture (`milestones`): no bucket headers appear anywhere
  - `choice` field renders a select bound to `data[key]`; changing it fires `onSave` with the updated array
  - `bool` field (use `publications`' `peer_reviewed`) renders three options "—"/"Yes"/"No"; selecting "—" writes `null` for that field in the saved row, not `false`
  - `date` field is a native date input; a value commits on change as the ISO string
  - a `text` field commits on blur only, not on every keystroke
  - **the load-bearing test:** editing ONE field of ONE row in a 3-row fixture calls `onSave` with a 3-row array where the other two rows are byte-for-byte unchanged
  - Add row: calls `onSave` with `rows.length + 1` entries, the new one all-null
  - Remove row: calls `onSave` with `rows.length - 1` entries, the removed one gone, the others unchanged and in the same relative order
  - empty + `isFirstPeriod: true` → E11 copy, containing the fixture's `title` string verbatim; empty + `isFirstPeriod: false` → E12 copy; assert the two differ
  - `disabled`: every field control is non-interactive; Add/Remove controls are not rendered at all
  - renaming a field's label in the fixture makes the new text appear (catalog-driven proof)

- [ ] **Step 2: Run — fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check — the most important one in this phase.** Change the field-edit handler to call `onSave(sectionId, [changedRow])` (only the touched row) instead of the full array. Confirm the load-bearing test fails, and explain in the report exactly what data loss this mutation would cause in production (every other row in the section silently deleted on the next real save). Restore, then also mutation-check the `bool` tri-state by collapsing "—" to send `false` instead of `null`; confirm that test fails too.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/EntriesTable.jsx frontend/src/pages/founder/__tests__/EntriesTable.test.jsx frontend/src/styles/founder-mis.css
git commit -m "feat(vip): EntriesTable — generic MIS repeating-row editor"
```

---

### Task 5: `FinancialsGrid` — quarterly §6 financial series

**Files:**
- Create: `frontend/src/pages/founder/components/FinancialsGrid.jsx`
- Modify: `frontend/src/styles/founder-mis.css` (append `.mis-financials-grid`, `.mis-financials-row`, `.mis-gap-row`, `.mis-gap-cell`)
- Test: `frontend/src/pages/founder/__tests__/FinancialsGrid.test.jsx`

**Interfaces:**
- Consumes: `bundle.financials`, `bundle.catalog.financial_series` (`{annual_revenue: [...], needs: [...]}`), `bundle.catalog.financial_buckets` (**period-level shape** — `{annual_revenue: [...6 labels], needs: [...5 labels]}`, never the index-level one that only has `needs`), and `bundle.derived.financials.needs_gap`.
- Produces: `<FinancialsGrid financials financialSeries financialBuckets needsGap disabled onChange />`, `onChange(series, bucket, amount)` where `amount` is a number or `null`. No `founderApi` import. Unlike `EntriesTable`, this is a **targeted upsert** — each cell edit is independent and the caller sends a single-row array per change; do not batch the whole grid.

**Behaviour:**
1. Two grids, stacked: **Annual revenue** (rows = `financialSeries.annual_revenue`, columns = `financialBuckets.annual_revenue`, rendered verbatim — no client-side FY-label computation, see "Formulas... not to invent" #4) and **Financial needs** (rows = `financialSeries.needs` minus `needs_gap` as an editable row, columns = `financialBuckets.needs`).
2. Every cell in both editable grids is an `<input type="number">`, `amount` from the matching `financials` row (or blank if no row exists yet for that `(series, bucket)`), commits on blur, empty → `null`.
3. The **Gap row** is separate from the editable needs grid, not one of its input rows: label "Gap", one cell per `financialBuckets.needs` bucket, value from `needsGap[bucket]` — **never** from any row in `financials` (no `financials` row for `series: "needs_gap"` is ever created server-side; `put_financials` rejects writing one). Per bucket: `null` → E14 copy; any number including `0` → the number verbatim (E15) — `!= null` check, not truthiness.
4. The Gap row renders **no input anywhere**, in any state — it is never editable, sending `series: "needs_gap"` 422s `computed_metric`.
5. `disabled` disables every editable amount input; the Gap row is unaffected (it was already non-interactive).

- [ ] **Step 1: Write the failing tests** covering: renders the 6 annual-revenue bucket labels exactly as given in a deliberately non-obvious fixture (labels that would look wrong if the component tried to compute its own FY sequence, e.g. `["FY22-23","FY23-24","FY24-25","FY25-26","FY26-27 YTD","FY26-27 Proj"]`) and asserts those exact strings, nothing recomputed; renders the 5 needs buckets from the fixture; Gap row shows E14 copy when `needsGap[bucket]` is `null`; Gap row shows literal `"0"` when `needsGap[bucket]` is `0`, not E14's copy; Gap row contains no `<input>` anywhere; editing an annual-revenue cell calls `onChange("annual_revenue_booked", bucket, value)` with the right series; editing a needs cell calls `onChange` with the right series; clearing a cell on blur calls `onChange` with `null`; `disabled` disables the editable inputs and leaves the (already non-interactive) Gap row unchanged; renaming a series label in the fixture makes the new text appear.

- [ ] **Step 2: Run — fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check.** Change the Gap-row renderer to a truthiness check (`needsGap[bucket] ? val : E14copy`). Confirm the "Gap row shows literal 0" test fails.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/FinancialsGrid.jsx frontend/src/pages/founder/__tests__/FinancialsGrid.test.jsx frontend/src/styles/founder-mis.css
git commit -m "feat(vip): FinancialsGrid — annual revenue + financial needs with read-only Gap"
```

---

### Task 6: `HeadcountGrid` — quarterly §8 People

**Files:**
- Create: `frontend/src/pages/founder/components/HeadcountGrid.jsx`
- Modify: `frontend/src/styles/founder-mis.css` (append `.mis-headcount-grid`, `.mis-headcount-row`, `.mis-headcount-total`, `.mis-net-change`, `.mis-net-change-empty`)
- Test: `frontend/src/pages/founder/__tests__/HeadcountGrid.test.jsx`

**Interfaces:**
- Consumes: `bundle.headcount`, `bundle.catalog.headcount_categories` (`[{key, label}]`), `bundle.derived.headcount` (`{net_change: {category: number|null}, total: {current_count: number|null, exited: number|null}}` — **no `net_change` key inside `total` at all**), and `isFirstPeriod` (computed against the *quarterly* period list specifically).
- Produces: `<HeadcountGrid headcount headcountCategories derived isFirstPeriod disabled onChange />`, `onChange(category, field, value)` where `field` is `"current_count" | "exited" | "remarks"`. Targeted upsert — one row per change, same as `FinancialsGrid`.

**Behaviour:**
1. Four category rows (from `headcountCategories`, in catalog order) plus exactly one Total row, always last.
2. Category row `net_change` cell, per E16-E18: `null` + `isFirstPeriod` → E16 copy; `null` + `!isFirstPeriod` → E17 copy (assert these two strings differ); a real number including `0` or negative → render it signed, verbatim, `!= null` check not truthiness.
3. **The Total row's `net_change` cell renders nothing** — no text node, no dash, no placeholder (E19). This is structurally different from E16/E17's cells, which always render *some* explanatory text. The test for this must assert the cell's rendered text content is the empty string, distinctly from asserting it equals `"—"` (a dash would be wrong here — see E19's own note on why).
4. Total row `current_count`/`exited`: `derived.headcount.total.current_count`/`.exited`, `null` → E20 ("—"), a number (possibly a partial sum, since `_partial_sum` treats blank categories as 0 the moment at least one category has a value) → render it exactly as given (E21) — never re-sum the four category rows client-side.
5. Category rows: `current_count`/`exited` are `<input type="number">`, `remarks` is `<input type="text">`, all commit on blur, empty → `null`.
6. **The Total row has no inputs anywhere** — not just `net_change`; `current_count`/`exited` there are computed display text too, never editable.
7. `disabled` disables every category-row input; the Total row is unaffected (already has none).

- [ ] **Step 1: Write the failing tests** covering: renders exactly 4 category rows + 1 Total row, in catalog order, Total last; Total row contains zero `<input>` elements; category `net_change: null, isFirstPeriod: true` → E16 copy; category `net_change: null, isFirstPeriod: false` → E17 copy (assert different from E16's); category `net_change: 0` → renders `"0"`; category `net_change: -3` → renders the minus sign, not dropped; **the Total row's `net_change` cell has empty text content — not `"—"`, not any string** (the highest-value test in this task); Total `current_count: null` (all 4 categories blank in the fixture) → "—"; Total `current_count` a real partial sum when 2 of 4 categories have values and 2 are `null` → asserts the exact number `derived.headcount.total` gives, not a client-recomputed sum (fixture deliberately sets `derived.headcount.total.current_count` to a value that would NOT match if the component summed the 4 category rows itself, to catch an accidental re-derive); editing `current_count`/`exited` on a category row commits on blur; `disabled` disables every category-row input; renaming a category label makes the new text appear.

- [ ] **Step 2: Run — fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check — guards the exact bug shape this task exists to prevent.** Change the Total row's `net_change` cell to render `"—"` whenever every category's `net_change` is `null` (instead of nothing, unconditionally). Confirm the "Total row net_change cell has empty text content" test fails. Restore, then mutation-check separately: change the Total `current_count` renderer to sum the 4 category rows' own `current_count` values client-side instead of reading `derived.headcount.total.current_count`. Confirm the "real partial sum... not a client-recomputed sum" test fails.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/HeadcountGrid.jsx frontend/src/pages/founder/__tests__/HeadcountGrid.test.jsx frontend/src/styles/founder-mis.css
git commit -m "feat(vip): HeadcountGrid — §8 People with blank Total net_change cell"
```

---

### Task 7: `FounderMis` — the shell

**Files:**
- Rewrite: `frontend/src/pages/founder/FounderMis.jsx`
- Modify: `frontend/src/styles/founder-mis.css` (append `.mis-shell`, `.mis-kind-tabs`, `.mis-kind-tab`, `.mis-section-card`, `.mis-section-head`, `.mis-submit-gate`, `.mis-blocked-banner`)
- Test: `frontend/src/pages/founder/__tests__/FounderMis.test.jsx`
- Modify: `frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx` (update only the "renders the MIS screen" test)

**Interfaces:**
- Consumes: everything from Tasks 1-6, plus `founderApi.getMis`, `founderApi.getMisPeriod`, `founderApi.putMisMetrics`, `founderApi.putMisNarrative`, `founderApi.putMisEntries`, `founderApi.putMisFinancials`, `founderApi.putMisHeadcount`, `founderApi.submitMisPeriod`.
- Produces: the route component already wired at `/founder/mis` by Phase 1 (`router.jsx` line ~380, `FounderPortal.jsx`'s `case "mis"`). Do not touch routing.

**Behaviour:**

1. **Load.** On mount, `founderApi.getMis()` once. E1 (both kind lists empty) renders its dedicated copy and stops — no tabs. Otherwise render kind tabs "Monthly" / "Quarterly". **Switching tabs does not refetch the index** — `getMis()` already returned both kinds' period lists in one call; only the *selected period* triggers a new fetch.

2. **Default period selection**, per kind, computed once its period list is known: the **earliest `draft`** period if any exist (this is exactly the period a founder must file next, per the in-order-submit rule — surfacing anything else first would hide the actual blocker); otherwise the **most recent `submitted`** period (nothing left to do, show the latest filed report); if the list is non-empty but somehow neither (shouldn't happen), fall back to the first entry in the array.

3. **Selecting a period** (via `PeriodPicker.onSelect` or the E23 blocked-period link) fetches `getMisPeriod(kind, periodKey)`. While that fetch is in flight, keep the tabs/`PeriodPicker` visible and show a lightweight inline loading state in the section area only — do not blank the whole page (that would read as E3/E4, not a period switch).

4. **`isFirstPeriod`** for the currently selected period = `periodsForKind[0]?.period_key === selectedPeriodKey` (periodsForKind is already oldest-first — Global Constraint — so this is a direct index check, not a date computation). Threaded into `MetricsGrid`/`EntriesTable`/`HeadcountGrid`.

5. **Section dispatch.** For each `section` in `bundle.catalog.sections[kind]`, render a `.mis-section-card` headed by `section.number`/`section.title`/`section.hint`, body dispatched by `section.type`:
   - `"narrative"` → `<NarrativeSection fields={bundle.catalog.narrative_fields[section.id] || []} values={bundle.narrative} ... />`
   - `"metrics"` → `<MetricsGrid metrics={bundle.metrics} metricGroups={bundle.catalog.metric_groups} vsLast={bundle.derived.metrics.vs_last} isFirstPeriod={isFirstPeriod} ... />`
   - `"entries"` → `<EntriesTable sectionId={section.id} title={section.title} fields={bundle.catalog.entry_fields[section.id]} rows={bundle.entries[section.id] || []} isFirstPeriod={isFirstPeriod} ... />`. **Plus**, when `section.id` has an entry in a client-side constant mirroring `mis_catalog.SECTION_EXTRA_ENTRIES` (today: `{"planned_vs_actual": ["next_milestones"]}`) — this one small, explicitly-named constant is not "inventing a formula" (Formulas-not-to-invent #5 is about the *carry-forward classification*, a behavioural rule; this is a fixed structural fact about which two entries tables exist per template, already fully described in `mis_catalog.py`'s own module docstring and stable across both templates) — render a **second** `EntriesTable` for each extra id, each independently calling `onSave` against its own section id. **Acknowledged, narrow exception to "nothing hardcoded":** the catalog gives `entry_fields["next_milestones"]` (its field schema) but no section object and therefore no `title` for it — `SECTION_EXTRA_ENTRIES` is a field-schema index, not a second `SECTIONS` list. Pass a literal `title="Next-quarter milestones"` (mis-templates.md §9.2's own description, "Top milestones for next quarter") for this one table. This is a hardcoded *display label*, not a hardcoded *rule*; if ARTPARK ever wants that wording changed independently of a code deploy, that is itself a sign the catalog should grow a title for extra-entries tables, and is worth raising rather than solving by inventing a second lookup convention client-side.
   - A section whose `type` is `"entries"` may **also** have narrative fields (`planned_vs_actual`'s §9.3) — render its `NarrativeSection` for any field ids `bundle.catalog.narrative_fields[section.id]` lists, beneath its entries table(s), the same composite layout `mis_catalog.py`'s own comments describe for `financials`/`headcount`.
   - `"financials"` → `<FinancialsGrid financials={bundle.financials} financialSeries={bundle.catalog.financial_series} financialBuckets={bundle.catalog.financial_buckets} needsGap={bundle.derived.financials.needs_gap} ... />` **plus** its narrative sub-fields (`fin6.*`), same composite pattern.
   - `"headcount"` → `<HeadcountGrid headcount={bundle.headcount} headcountCategories={bundle.catalog.headcount_categories} derived={bundle.derived.headcount} isFirstPeriod={isFirstPeriod} ... />` **plus** its narrative sub-fields (`people.*`).

6. **Autosave wiring**, per Global Constraints' write-shape table: each component's `onChange`/`onSave` callback builds the right payload and calls the matching `founderApi.putMis*` thunk with `(kind, selectedPeriodKey, ...)`, then replaces `bundle` with the response (every write endpoint returns the full period bundle) on success. On failure: a non-blocking `actionError` banner via a small `MIS_ERROR_COPY` map (mirroring Phase 4's `describeActionError`) with entries for `mis_already_submitted` (E24 — also triggers a silent refetch so the UI actually flips to E22) and a fallback generic message (E25) for everything else. `mis_earlier_period_open` is **not** routed through this generic banner at all — it only ever occurs on submit, handled separately in step 7.

7. **Submit.** While `period.status === "draft"`, a Submit button is **always enabled** — no client-side completeness gate of any kind (Formulas-not-to-invent #2). On click, `submitMisPeriod(kind, selectedPeriodKey)`:
   - success → replace `bundle` with the response; every section flips to E22 (disabled, read-only).
   - 409 `mis_earlier_period_open` → **do not** show the generic banner. Render E23's dedicated `.mis-blocked-banner`: "Submit {err.details.label} first." with a button that calls the same period-selection function `PeriodPicker` uses, targeting `err.details.period_key` (same `kind`, since blocking is always same-kind).

8. **CSS.** `import "../../styles/founder-mis.css";` at the top of `FounderMis.jsx` — the only place it is imported.

- [ ] **Step 1: Write the failing tests.** Mock every `founderApi` thunk named above. Build fixtures for at least: an onboarded founder with a mixed monthly calendar (one submitted, one draft-not-overdue, one draft-overdue, oldest-first) and a matching quarterly calendar; a not-onboarded founder (`bundle.monthly: [], bundle.quarterly: []`). Cover:
  - E1: not-onboarded fixture renders its dedicated copy, no tabs, no `getMisPeriod` call
  - initial load calls `getMis()` exactly once; renders Monthly/Quarterly tabs
  - default selection picks the **earliest draft** period, not the most recent one and not the most recent submitted one (3-period fixture where the middle one is the earliest draft, proves it's chosen over both a later draft and an earlier submitted period)
  - default selection falls back to the most recent submitted period when none are draft (all-submitted fixture)
  - switching kind tabs does **not** call `getMis()` again, only fetches that kind's default period via `getMisPeriod`
  - selecting a period from `PeriodPicker` calls `getMisPeriod(kind, key)` and renders that period's sections
  - renders every section from `bundle.catalog.sections[kind]` in catalog order, dispatched by `type`
  - the quarterly `planned_vs_actual` section renders both its own entries table and a second one for `next_milestones` (assert both section field sets are present, e.g. by a field label unique to each), plus its §9.3 narrative field
  - a narrative field edit calls `putMisNarrative(kind, key, {field_id: value})` with just that one field
  - a metrics field edit calls `putMisMetrics(kind, key, [oneRow])`
  - an entries field edit calls `putMisEntries(kind, key, sectionId, fullArray)` — assert the array length matches the fixture's full row count for that section, re-proving Task 4's contract at the integration level
  - a financials cell edit calls `putMisFinancials(kind, key, [oneRow])`
  - a headcount cell edit calls `putMisHeadcount(kind, key, [oneRow])`
  - `isFirstPeriod` is `true` when the earliest period of a kind is selected (assert via a copy that depends on it, e.g. `MetricsGrid`'s E6 text appearing for a metric with `actual` set and `vs_last: null`) and `false` for a later one (assert E7's text instead)
  - submit succeeds → calls `submitMisPeriod(kind, key)`, the response bundle flips every input to disabled, Submit is no longer offered
  - submit 409s `mis_earlier_period_open` → renders the E23 banner naming the blocker's label, NOT the generic `actionError` banner; clicking its button switches the selected period to the blocker's `period_key` and fetches its bundle
  - a write 409s `mis_already_submitted` → shows E24's distinct copy and refetches, flipping the UI to E22
  - a submitted period's bundle renders every section's inputs disabled
  - catalog-driven proof: rename a section title in the fixture, assert it renders

- [ ] **Step 2: Run — fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check, two mutations, both reported:**
  1. Change the default-selection logic to always pick `periods[periods.length - 1]` regardless of status. Confirm the "picks earliest draft over a later submitted/draft period" test fails.
  2. Change `isFirstPeriod` to always return `true`. Confirm the "E7 appears for a later period" test fails.

- [ ] **Step 6: Update `FounderVipTabs.test.jsx`.** Its "renders the MIS screen" test currently mocks nothing MIS-specific and asserts the placeholder heading "Monthly and quarterly reporting". Keep that exact heading text in the real `FounderMis.jsx` (no reason to change it — it already matches spec §5's framing) so this assertion keeps passing unmodified; add a `vi.spyOn(founderApi, "getMis").mockResolvedValue(...)` with a minimal realistic fixture so the test exercises the real component instead of the placeholder, and strengthen the assertion to also confirm real content renders (e.g. a period label or a kind tab), not just the static heading. Do not touch any other test in that file.

- [ ] **Step 7: Full frontend suite**

```bash
cd frontend && npx vitest run
```
Every test green, including every pre-existing founder test and Phase 4's AIR suite.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/founder/FounderMis.jsx frontend/src/pages/founder/__tests__/FounderMis.test.jsx frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx frontend/src/styles/founder-mis.css
git commit -m "feat(vip): MIS monthly and quarterly reporting forms"
```

---

## Out of scope

- The VIP process dashboard (Phase 6), the admin verification/MIS-submissions surface (Phase 7).
- `.docx` import review UI and xlsx/csv export (Phase 8, spec §5.6/§5.7) — `POST /founder/mis/{period_id}/import` and `GET /admin/platform/vip/mis/export` are not called anywhere in this phase.
- Reopen. `vip_mis_periods.reopened_at`/`reopened_by` exist in the bundle but no backend reopen endpoint exists yet (VIP_BUILD_STATE's open decision #5); this UI has nothing to call and renders `reopened_at` nowhere.
- Any backend change, including to `mis_catalog.py`'s lack of a custom-metric write path (Formulas-not-to-invent #1) — raise it, don't route around it.
- Any edit to `founder-portal.css` or `founderApi.js`.
