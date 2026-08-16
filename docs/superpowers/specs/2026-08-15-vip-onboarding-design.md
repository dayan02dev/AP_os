# VIP Onboarding — Founder Portal for the Venture Incubation Programme

**Date:** 2026-08-15
**Branch:** `feat/vip-onboarding` (worktree `.claude/worktrees/vip-onboarding`, based on `release/sip-launch-v1` @ `a8f470e`)
**Status:** design approved in brainstorm; implementation plan to follow

---

## 1. Goal

Give VIP (Venture Incubation Programme, DB track `sip`) founders the same post-onboarding
portal TIR founders got, with the cohort-management half replaced by two new sections —
**TLR evaluation** (the ARTPARK Innovation Readiness scorecard) and **MIS filling**
(monthly + quarterly reporting) — plus a **process dashboard** that is a pure rollup of
those two, and the **admin surface** that closes the verification loop.

Out of scope: changing the MOU (it stays exactly as TIR has it today), changing the
Application tab, changing the five Founders Resources pages.

## 2. Decisions taken in brainstorm

| # | Decision |
|---|---|
| D1 | VIP cohort management contains **only** TLR evaluation + MIS filling. Approach / Organization / Expense management are TIR-only and do not appear for VIP. |
| D2 | AIR levels are **self-assessed then ARTPARK-verified**. Two numbers per lever: `claimed` and `verified`. The dashboard shows verified. |
| D3 | MIS is **bidirectional**: upload the filled ARTPARK `.docx` to prefill the form, and export submitted data to Excel/CSV per-startup and cohort-wide. |
| D4 | Verification happens in a **new "VIP cohort" tab in the existing `/admin` portal**, in scope for this build. No new role. |
| D5 | MIS periods **auto-open on a fixed calendar**, carry forward from the previous period, lock on submit, and only an admin can reopen. |
| D6 | Track generalisation = **`track` column on the 5 genuinely-shared tables**; the 8 TIR-only cohort tables are untouched. |
| D7 | The `COHORT` sidebar group (Programs / TIR overview / VIP overview) is **deleted** — from TIR as well as never added to VIP. |

## 3. Shell, routing and the gate

VIP reuses `/founder/*` entirely. Nothing forks at the URL level; the track is resolved
server-side.

**`require_founder_access` becomes track-resolving.** Today it queries `tir_applications`
for an `offered`/`onboarded` app owned by the caller. It gains a second lookup against
`sip_applications` and returns `track` in the context. Order: TIR first, then SIP; a user
holding both keeps their TIR portal (an edge case that should not occur, but the rule must
be deterministic). The `FOUNDER_PORTAL_ALLOWLIST` gate applies unchanged to both tracks.

`GET /founder/me` gains `"track": "tir" | "sip"`. `FounderPortal.jsx` selects its
cohort-management nav group from it:

```
TIR                              VIP
COHORT MANAGEMENT                COHORT MANAGEMENT
  01 Approach                      01 TLR evaluation
  02 Organization                  02 MIS filling
  03 Expense management
```

**Everything outside cohort management is shared code, not a copy.** A VIP founder renders
the identical components and calls the identical endpoints a TIR founder does. Nothing is
duplicated, forked or re-implemented, so the two tracks cannot drift apart later:

| Sidebar group | Item | For VIP |
|---|---|---|
| Application | Current | identical — `FounderApplication.jsx`, `GET /founder/me` |
| Onboarding | 01 Sign MOU | identical — `FounderMou.jsx`, the v2 four-acknowledgement flow, the same signed-PDF service. Changes to the MOU are explicitly deferred. |
| Founders resources | 01 Art Infra | identical — `FounderStore.jsx`, `/founder/store` |
| Founders resources | 02 ArtConnect | identical — `FounderFundraising.jsx`, `/founder/fundraising` |
| Founders resources | 03 ArtPartners | identical — `FounderPartners.jsx`, `/founder/partners` |
| Founders resources | 04 Art Assets | identical — `FounderAssets.jsx`, `/founder/assets` |
| Founders resources | 05 Art Support | identical — `FounderSupport.jsx`, `/founder/support` |

Those pages work for VIP purely because migration 043 makes their five backing tables
track-aware; not one line of their UI or route logic changes.

New routes: `/founder/tlr`, `/founder/mis`. The existing `/founder/dashboard` renders
`FounderDashboard` for TIR and `VipDashboard` for SIP.

**Deletion (D7).** The entire `COHORT` sidebar group is removed — the group heading, its
`<nav>`, and the `COHORT_LINKS` constant in `FounderPortal.jsx`. That deletes all three
external links:

- ↗ Programs (`/programs.html`)
- ↗ TIR overview (`/marketing.html`)
- ↗ VIP overview (`/sip-marketing.html`)

It disappears for **TIR founders** (a change to the shipped portal) and is **never added
for VIP**. Since the sidebar is shared, this is a single deletion that satisfies both.
The `FounderPortal.test.jsx` suite gains an assertion that no such group renders, so it
cannot come back by accident.

**Bug fixed in passing.** `_project_name()` reads `app["ai_screening_project_name"]`, an
embed `require_founder_access` never selects — so it returns `""` unconditionally. The
venture name is therefore blank in the MOU body, in the signed PDF, and in the dashboard
`<h1>`, for every founder, in production today. VIP would inherit it. Fix: resolve the
project name with a direct `ai_screening` lookup on `(application_id, application_track)`,
the way `applications_query.fetch_app_ids_by_project_name` already does.

## 4. TLR evaluation (AIR)

### 4.1 The framework as data

Six levers, in two families:

| Family | Lever key | Name |
|---|---|---|
| Technology / R&D | `scientific_principles` | Scientific Principles & Models |
| Technology / R&D | `architecture` | Architecture & System Definition |
| Technology / R&D | `qualification` | Qualification & Final Design |
| Product / Engineering (CRL) | `user_needs` | User Needs & Requirements |
| Product / Engineering (CRL) | `supply_chain` | Supply Chain & Manufacturing |
| Product / Engineering (CRL) | `reliability` | Reliability & Maintainability |

Each lever has three self-assessment questions. Every option carries an AIR level. The
questions are **progressive bands** — for `scientific_principles`, Q1 spans AIR 1-3,
Q2 spans 2-5, Q3 spans 5-9.

### 4.2 Scoring rules

**R1 — Option to level.** Each option maps to its stated AIR level, per the catalog.

**R2 — Lever level is a ladder, not a max.** Walk the lever's questions in order. A
question may only lift the lever's level if the preceding question is answered at its
own maximum. Formally:

```
level = level_of(q1)
if q1 is at max(q1):  level = max(level, level_of(q2))
if q2 is at max(q2):  level = max(level, level_of(q3))
```

Rationale: the bands overlap, so a plain `max()` would let a venture claim AIR 7 on Q3
while admitting AIR 1 on Q1. A stage-gate framework must not allow skipping a gate.
Unanswered questions contribute nothing and stop the ladder.

**R3 — Rollups.**

```
technology_air = min(scientific_principles, architecture, qualification)
commercial_air = min(user_needs, supply_chain, reliability)
overall_air    = min(all six)
```

A venture is only as mature as its weakest lever. Technology/Commercial are surfaced
separately because that TRL-plus-CRL split is the thing AIR exists to express.

**R4 — Claimed vs verified.** Every level above exists twice: computed from the founder's
answers (`claimed`), and as recorded by the ARTPARK verifier (`verified`). Rollups are
computed independently over each set. A lever with no verification yet contributes
nothing to the verified rollup, which therefore reads `null` until all six are verified.

**Source wrinkles to confirm with ARTPARK.** Supply Chain Q3 maps both option A and
option B to AIR 8; Reliability Q2 maps both A and B to AIR 6, and Q3 maps both A and B to
AIR 8. Both options are kept and the ladder uses the higher-lettered one as the max for
that question. Flagged for a content review, not a blocker.

### 4.3 What the founder does per lever

1. Answer the three questions (radio per question).
2. Tick the **measurement criteria** for the level those answers produce — roughly three
   checks, drawn from the framework's per-level criteria, not all ~150.
3. Upload the **qualifying document** the submission guide names for that level. Lower
   levels' documents are listed as optional backfill, not required.

Then submit the round. A verifier confirms or downgrades each lever with a note.

### 4.4 Wizard

Five steps, matching the TIR idiom (teaching copy → data → data → evidence → gate):

```
01 Overview        what AIR is, the six levers, the two families, how gates work
02 Technology      scientific_principles · architecture · qualification
03 Commercial      user_needs · supply_chain · reliability
04 Evidence        upload the qualifying document per claimed level
05 Scorecard       computed lever levels, Technology / Commercial / Overall, submit
```

Step 05 is the gate, structurally the same as TIR's Mentor review step: `draft` →
`submitted` → `verified`.

### 4.5 Rounds

Assessments are **periodic, one round per quarter**, aligned to the MIS quarterly
calendar, so the dashboard can plot AIR 3 → 4 → 5 over time rather than showing one
static number. A new round seeds its answers from the previous round so the founder
edits deltas.

Seeding covers only `q1_option`/`q2_option`/`q3_option` and `criteria_checked` — never
`verified_level`, `verifier_note`, `verified_at`/`verified_by`, or evidence, all of
which belong to the round they were actually performed on. **Evidence from prior
rounds is not reachable**: all three `/founder/air/evidence` endpoints resolve only
the current quarter's round. Reopening a prior round's evidence (e.g. to reuse a
still-valid document without re-uploading it) is deliberately deferred to the admin
phase, not built here.

### 4.6 Tables

These tables are VIP-only, so they carry no `track` column and keep a real foreign key
to `sip_applications(id)`. Only the five *shared* tables of D6 lose their FK.

```sql
vip_air_assessments
  id, application_id → sip_applications(id) on delete cascade,
  round_label,
  status ('draft'|'submitted'|'verified'),
  submitted_at, verified_at, verified_by,
  overall_claimed, overall_verified,
  tech_claimed, tech_verified, comm_claimed, comm_verified
  unique (application_id, round_label)

vip_air_lever_scores
  id, assessment_id → vip_air_assessments(id) on delete cascade, lever,
  q1_option, q2_option, q3_option,      -- 'A'..'E'
  criteria_checked jsonb,
  claimed_level, verified_level, verifier_note, verified_at, verified_by
  unique (assessment_id, lever)

vip_air_evidence
  id, assessment_id → vip_air_assessments(id) on delete cascade,
  lever, air_level, doc_label,
  storage_path, filename, size_bytes, content_type, uploaded_at
```

`air_catalog.py` owns the 6 levers, the 18 questions with their option→level maps, the
per-`(lever, level)` measurement criteria, and the per-`(lever, level)` required document
name. Server-owned and served to the browser, so wording changes need no frontend deploy —
the same pattern as `founder_catalog.py` and `founder_mou.ACKNOWLEDGEMENTS`.

## 5. MIS filling

### 5.1 Period model

Two kinds on fixed calendars:

- **Monthly** — one per calendar month from the venture's onboarding month to the current
  month. `period_key` = `YYYY-MM`. Due the 5th of the following month.
- **Quarterly** — Indian FY quarters (Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar),
  matching the template's "submit in April, July, October, January for the quarter just
  concluded". `period_key` = `FY26-27-Q1`. Due the 15th of the month after quarter end.

Periods are **generated lazily on read** of `GET /founder/mis`: compute the expected set,
insert any missing rows as `draft`. Idempotent, and no cron to operate.

Lifecycle: `draft` → `submitted` (locked) → admin `reopen` → `draft` again, with
`reopened_at` / `reopened_by` recorded. **Overdue** is derived, not stored:
`status = 'draft' AND due_date < today`.

### 5.2 Carry-forward

When a period row is created it seeds from the most recent **submitted** period of the
same kind. This implements the templates' own instructions ("keep the metric list stable
month-on-month", "carry the same list forward so trajectory is visible"):

- **Metrics** — copy `metric_key`, `label`, `group`, `unit`, `target`. Leave `actual` and
  `commentary` blank. Copy the previous `actual` into `prev_actual`, so the template's
  **"vs Last Mo"** column is computed rather than typed.
- **Milestones** — copy forward every row whose status is not `done`.
- **Quarterly cumulative registers** (IP assets, external funding / cap table, product
  portfolio) — copy forward in full; these are cumulative by definition and the founder
  edits deltas.

### 5.3 Structure: typed where numeric, catalog-driven JSON where entity-shaped

The quarterly template states the principle itself: *"narrative bullets where each covers
one entity … grids only where the content is genuinely tabular."* The schema follows that.

**Five tables.**

```sql
vip_mis_periods                   -- VIP-only, so a real FK is kept
  id, application_id → sip_applications(id) on delete cascade,
  kind ('monthly'|'quarterly'),
  period_key, label, period_start, period_end, due_date,
  status ('draft'|'submitted'), submitted_at, reopened_at, reopened_by,
  narrative jsonb,                -- free-text sections, keyed by catalog id
  source_doc_path,                -- the uploaded .docx, retained for audit
  unique (application_id, kind, period_key)

vip_mis_metrics                   -- monthly §2 Key Metrics (charted)
  id, period_id FK, metric_key, label, group_key, unit,
  target, actual, prev_actual, rag ('green'|'amber'|'red'), commentary,
  is_custom, sort_order

vip_mis_financials                -- quarterly §6.1 + §6.2 (charted)
  id, period_id FK, series, bucket, amount, sort_order
  -- series: annual_revenue_booked | annual_revenue_received
  --       | needs_total | needs_confirmed | needs_projected | needs_gap

vip_mis_headcount                 -- quarterly §8 (charted)
  id, period_id FK, category, current_count, exited, remarks
  -- category: artpark_associated | startup | consultants | interns

vip_mis_entries                   -- every entity-list section
  id, period_id FK, section, sort_order, data jsonb
  -- section: milestones | risks | asks
  --        | ip_assets | collaborations | publications | products
  --        | funding | planned_vs_actual | next_milestones
```

`mis_catalog.py` owns the standard 18 metric rows, the section list per kind, and each
entity section's **field schema** (key, label, type, required). That one catalog drives
three things at once: the form fields, the docx parse mapping, and the Excel export column
order. Adding a section later is a catalog edit, not a migration.

### 5.4 Section coverage

**Monthly** — §1 Executive Summary (narrative, 5 prompts) · §2 Key Metrics (`metrics`,
18 seeded rows across Commercial / Product-Technology / Financials / Team, plus custom
rows) · §3 Milestones (`entries.milestones`: milestone, owner, status
Done/On-Track/At-Risk/Blocked, notes) · §4 Traction (narrative: pilots, conversions,
pipeline, losses; market lessons) · §5 Lowlights & Risks (`entries.risks`: severity,
what happened, impact, mitigation) · §6 Team & Hiring (narrative) · §7 Financials &
Fundraising (narrative) · §8 Asks (`entries.asks`: priority, category, ask) · §9 Happy
News (narrative).

**Quarterly** — §1 Quarter at a Glance (narrative) · §2 IP Register
(`entries.ip_assets`, sub-grouped filed / granted / rejected / international / cumulative)
· §3 Collaborations (`entries.collaborations`, sub-grouped active / new / completed /
in-discussion) · §4 Publications (`entries.publications`) · §5 Products
(`entries.products`, includes per-product TRL) · §6 Financials (`financials` +
narrative) · §7 External Funding (`entries.funding`) · §8 People (`headcount` +
narrative) · §9 Milestone Review (`entries.planned_vs_actual`,
`entries.next_milestones`, plus narrative for Governing Council questions).

### 5.5 One number, one source

The monthly metric row **"TRL Level (1-9)"** is not typed. It is populated read-only from
the current **verified** overall AIR level, so the scorecard and the MIS cannot disagree.

### 5.6 Docx ingest

`POST /founder/mis/{period_id}/import` accepts the filled `.docx`. A new
`mis_template_parser.py` builds on the existing `template_parser.py` primitives
(`_docx_concatenated_text`, table extraction, heading anchors) already used by the TIR and
SIP application template uploads. Tables map by header matching with a positional
fallback; narrative sections map by heading anchor.

The endpoint returns a **proposed patch and never writes**. The founder sees a
side-by-side review — parsed value against current value, per field — and accepts wholesale
or per-field. Low-confidence fields are returned blank and flagged rather than guessed.
The source document is stored for audit.

### 5.7 Export

`GET /admin/platform/vip/mis/export?kind=&period=&scope=startup|cohort&format=xlsx|csv`.
One sheet per section; the cohort scope produces one row per startup per section. Column
order comes from `mis_catalog`. Adds `openpyxl` to `backend/requirements.txt`.

## 6. VIP process dashboard

Same visual grammar as the TIR residency dashboard — four stat tiles with the fourth dark,
then panels — but every value is derived from AIR + MIS.

**Tiles**

1. **Overall AIR** — verified, with claimed as a ghost value; Technology and Commercial
   sub-scores beneath; delta against the previous round.
2. **Reporting compliance** — submitted-on-time over total due; next period due date.
3. **Cash & runway** — from the latest submitted monthly metrics.
4. *(dark)* **Next due** — the next MIS period or AIR round, with days remaining.

**Panels**

- **AIR scorecard** — the centrepiece, replacing TIR's Experiments panel. Six horizontal
  lever bars on a 1-9 scale, verified solid with claimed as a ghost, grouped Technology /
  Commercial, with the overall (minimum) marked by a rule across the group.
- **This period** — an activity feed of real events (submissions, verifications, milestone
  status flips, reopens). Deliberately unlike TIR, whose `FEED` is hardcoded demo copy.
- **Metric trend** — small multiples across submitted monthly periods: revenue, cash,
  runway, headcount, deployments, TRL.
- **Milestones & risks** — open milestones grouped by status chip, plus open red/amber
  risks.
- **AIR trajectory** — overall AIR per round; the VIP analogue of TIR's cycle-timeline
  Gantt.

**Derived, not hardcoded.** The TIR dashboard pins `CURWEEK = 3`, `"Cohort 04"` and a
static feed. The VIP dashboard computes its clock from the venture's onboarding date and
its feed from real state changes.

## 7. Admin verification surface

A new **"VIP cohort"** tab in the existing `/admin` portal, using the admin shell and
design system already in place. Two screens.

**AIR verification queue.** Rows are `(startup, lever, claimed level, submitted)`. Opening
a lever shows the three answers, the ticked criteria, and the evidence document behind a
signed URL. The verifier confirms at the claimed level or downgrades, with a note. A
"confirm all at claimed" action exists per assessment for the common case. Verifying the
sixth lever flips the assessment to `verified` and publishes the rollups.

**MIS submissions.** A matrix of startups × periods with status chips (submitted / draft /
overdue). Opening one renders it read-only. Actions: reopen (returns it to `draft` for
correction) and export.

Backend: `routers/admin_vip.py` under `/admin/platform/vip/…`. Reads gated by the existing
`view_all_apps` capability; writes (verify, reopen) gated by a new `manage_vip_cohort`
capability granted to `admin` and `leadership`. **`rbac.py` and `frontend/src/lib/rbac.js`
are hand-synced** — both must change together.

## 8. Migrations

| File | Contents |
|---|---|
| `043_vip_track_generalisation.sql` | Add `track text not null default 'tir' check (track in ('tir','sip'))` to `founder_mou`, `founder_cart_items`, `founder_resource_requests`, `founder_bookings`, `founder_tickets`. Drop their FK to `tir_applications(id)`. Replace `founder_mou`'s unique on `application_id` with unique `(track, application_id)`. Existing rows take the default. |
| `044_vip_air.sql` | `vip_air_assessments`, `vip_air_lever_scores`, `vip_air_evidence`, each FK'd to `sip_applications(id)`; private storage bucket `vip-founder-docs`. RLS enabled, no policies — service-role only, same as 040-042. |
| `045_vip_mis.sql` | `vip_mis_periods`, `vip_mis_metrics`, `vip_mis_financials`, `vip_mis_headcount`, `vip_mis_entries`. RLS enabled, no policies. |

All wrapped in `begin/commit`. A consolidated `043_045_vip_PROD_APPLY.sql` follows for
Studio paste at promotion time, since prod DDL is Studio-only.

**Integrity note.** Dropping those five FKs is deliberate (D6): Postgres has no
polymorphic foreign key. The exposure is contained — RLS denies every non-service-role
writer, the `/founder` router is the only writer and it enforces ownership, and
applications are never hard-deleted in this system (de-roster never deletes).

## 9. Testing

**Backend.** `test_vip_access.py` (track resolution, allow-list, cross-track isolation) ·
`test_air_scoring.py` (R1-R4 as pure functions — the ladder, the gate-skip rejection, the
min rollups, unanswered questions, the duplicate-mapping wrinkles) · `test_air_crud.py`
(round lifecycle, evidence, verify/downgrade, ownership) · `test_mis_periods.py`
(generation, idempotency, carry-forward incl. `prev_actual`, lock, reopen, overdue) ·
`test_mis_import.py` (parse of both real templates; low-confidence blanking; never writes)
· `test_mis_export.py` (catalog-driven column order, cohort scope) · `test_admin_vip.py`
(capability gates).

**Frontend.** Vitest for the five wizard steps, the scorecard rendering of claimed vs
verified, the MIS form and its import review, and the dashboard rollups.

**Invariants to keep green.** No new application statuses, so the
`state_machine.py` ↔ `statusMachine.js` mirror test is unaffected. The new capability
requires the `rbac.py` ↔ `rbac.js` pair to move together. Note the known baseline of
~20-22 pre-existing backend and ~2 frontend failures on this release branch — verify any
failure against untouched `release/sip-launch-v1` before attributing it to this work.

## 10. Build order

This is larger than one sitting, so it is phased. Each phase is independently verifiable
and leaves the branch green.

1. **Track generalisation + shell.** Migration 043, track-resolving
   `require_founder_access`, `track` on `/founder/me`, the nav swap, the `COHORT` group
   deletion, the `_project_name` fix. Verifiable by signing in as a VIP founder and
   getting the portal with MOU + all five Founders Resources pages working, and the two
   new nav items rendering empty states.
2. **AIR.** `air_catalog.py`, the scoring functions and their tests, migration 044, the
   `/founder/air` endpoints, the 5-step wizard.
3. **MIS.** `mis_catalog.py`, migration 045, period generation and carry-forward, the
   monthly and quarterly forms.
4. **Dashboard.** The rollup service and `VipDashboard.jsx` — nothing new stored.
5. **Admin.** `admin_vip.py`, the new capability in both rbac files, the verification
   queue and the MIS submissions screen.
6. **Import / export.** `mis_template_parser.py` and the review UI; `openpyxl` export.

Phases 1-2 are the critical path; 6 is the most deferrable if time is short.

## 11. Rollout

Build and verify on `feat/vip-onboarding` against staging (Supabase
`exqmxvdtcsvpgtftwjml`, API `cdw51c7gid`), with a Vercel preview off the branch. Seed a
VIP test founder the way `seed_post_onboarding.py` seeds the TIR one. Promotion to prod is
a separate, later decision and needs the migrations pasted into Supabase Studio by hand.
