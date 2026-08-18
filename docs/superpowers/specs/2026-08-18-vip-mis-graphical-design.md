# VIP MIS — graphical rebuild

**Status:** approved in brainstorm 2026-08-18 · **Target:** VIP (`sip`) staging only
**Branch:** `feat/vip-onboarding` (existing worktree)

## 1. Goal

Replace the founder-facing MIS *forms* with a purely pictorial view, and give the
admin the same picture across every VIP startup. Data arrives by email-ingested
`.docx`, never by typing.

## 2. Decisions taken in brainstorm

| # | Decision |
|---|---|
| D1 | **Email replaces the forms entirely.** Founders email the filled `.docx`; the portal's MIS is view-only. The forms built in phase 5 are removed. |
| D2 | **Our schema wins; only the charts are ported.** `vip_mis_*`, `mis_catalog`, `mis_query` and `mis_template_parser` stay. From `clawbot-automation/apps/mis-pipeline` we take the *visual* layer only. |
| D3 | **Chart.js via npm, bundled.** Not the inlined 4,393-line standalone file, and no CDN — the app is served under a strict origin and every other dependency is bundled. |
| D4 | **Email intake is deferred.** Testing runs on seeded metadata. The ingest trigger is a later cycle. |

### Why not clawbot's data model

Their pipeline reads Neo4j and names the same quantities differently, in
different units: `cash_cr` (crore) against our `cash_in_bank` (lakh),
`burn_lakh`/`revenue_lakh` against `net_burn_month`/`revenue_month`,
`paying_customers` against `active_customers`. Adopting it would mean a
remapping layer whose first mistake is a chart wrong by 100×. Our parser is
already tested against the same source documents.

## 3. What is removed

**Frontend.** `FounderMis.jsx` and the six form components — `PeriodPicker`,
`NarrativeSection`, `MetricsGrid`, `EntriesTable`, `FinancialsGrid`,
`HeadcountGrid` — plus their tests and `founder-mis*.css`.

**Backend.** The founder write endpoints on `/founder/mis`: `put_metrics`,
`put_narrative`, `put_entries`, `put_financials`, `put_headcount`, `submit`.
Reads (`GET /founder/mis`, `GET /founder/mis/{kind}/{period_key}`) stay.

**Kept deliberately:** `mis_template_parser.py` and the import endpoints. The
import path becomes the only writer, which is what email intake will trigger.

### Consequence: submission is no longer a founder act

`_reject_out_of_order_submit` exists because a founder could submit August
before May and shift an already-submitted report's derived comparisons. With
ingestion as the only writer that ordering is a property of the ingest path,
not of a button.

**Ruling:** keep the guard, move it. Ingest marks a period `submitted` and must
refuse to do so while an earlier period of the same kind is still `draft` —
same code, same error, invoked from the import commit rather than a founder
endpoint. Admin reopen (`mis_later_period_submitted`) is unchanged; it was
always admin-side.

## 4. The four charts

Ported verbatim in *behaviour* from `build_dashboard.py`'s `GRAPH` constant:

| key | title | our source |
|---|---|---|
| `revenue` | Revenue (₹L per month) | `revenue_month` |
| `burn` | Net burn (₹L per month) | `net_burn_month` |
| `headcount` | Headcount | `headcount_eom` |
| `paying` | Paying customers | `active_customers` |

Line charts, `tension 0.4`, filled with a vertical gradient fading to
transparent, 1.75px stroke, points hidden except the **latest** point, an
index-mode crosshair on hover, no legend, y-axis capped at 5 ticks.

**One deviation, deliberate:** clawbot strokes `#3B12B6`; we use our own
`--artblue` token. Matching the existing design system outranks matching their
hex — every other surface in this portal is built on those tokens.

Charts are driven by `actual` from **submitted** periods only, oldest first. A
venture with fewer than two submitted periods gets a single point, which is
honest rather than an empty frame.

## 5. Founder view — `/founder/mis`

Header states what MIS now is: reports arrive by email, this page is the record.

- **Four charts** for this venture.
- **Period cards**, newest first: label, status, received date. A `draft`
  period reads as *not yet received* — because the founder cannot fill it.
- **Empty state** distinguishes its two causes, per the standing rule: nothing
  received yet vs. nothing due yet.

Nav label changes from **MIS filling** to **MIS** — nothing is filled here now.

## 6. Admin view — VIP cohort → MIS

Replaces the submissions matrix as the landing view; the matrix stays reachable
as a table toggle, since chasing a missing report needs a grid, not a chart.

- **Cohort roll-up:** total revenue, total burn, total headcount across all VIP
  startups, per month.
- **Per-startup section:** name, latest period, the same four charts.
- **Click any chart → modal** with the enlarged series (clawbot's
  `openChart`/`bigchart`).

Reads through the existing `view_all_apps` gate. No new capability.

## 7. Seeding

`seed_vip_mis_data.py` extends to a **cohort**: several VIP ventures with
several months of submitted history each, numbers that move, so both the
per-startup charts and the roll-up have shape. Staging-guarded, as it is now.

## 8. Testing

- Chart components are presentational and take plain series arrays. Tests
  assert the mapping from bundles to series, not Chart.js internals.
- The removal is itself tested: the founder write endpoints must 404/405, so a
  half-removed surface cannot linger.
- Ingest ordering: committing an import for a later period while an earlier one
  is `draft` must refuse.
- Every empty state asserted separately for each of its causes.

## 9. Out of scope

Email polling and attachment handling. The TIR MIS (TIR has no MIS surface).
Any change to `vip_mis_*` schema — migrations 043-045 are applied to staging
and stay frozen.
