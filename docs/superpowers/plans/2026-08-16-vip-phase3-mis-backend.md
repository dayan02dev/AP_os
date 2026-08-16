# VIP Phase 3 (backend): MIS reporting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve VIP monthly and quarterly reporting from the API — the template catalog, auto-opening periods on a fixed calendar, carry-forward from the previous submitted period, and a submit that locks.

**Architecture:** A server-owned catalog (`mis_catalog.py`) holds the two templates' structure so the browser never keeps its own copy. Five VIP-only tables with real foreign keys to `sip_applications`. Period generation is **convergent** — the same pattern `air_query.ensure_round` arrived at after two fix rounds, adopted here from the start rather than rediscovered.

**Tech Stack:** FastAPI + Supabase (service-role, RLS-denied to all else), pytest with the `FakeSupabase` double.

**Spec:** `docs/superpowers/specs/2026-08-15-vip-onboarding-design.md` §5
**Template source:** `docs/reference/mis-templates.md` — the binding content authority for Task 1.

## Global Constraints

- Branch `feat/vip-onboarding`, worktree `.claude/worktrees/vip-onboarding`. Work only here.
- DB track code is **`sip`**; user-facing label is always **"VIP"**.
- Migrations 043 and 044 are **already applied to staging**. This phase adds **045**; do not modify 043 or 044, and do not apply 045 to any database — a human pastes it into Studio.
- Run pytest from `backend/` with `--no-cov`. Python: `/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python`.
- Known baseline: ~20 pre-existing backend failures, unrelated. Do not fix them.
- Commit messages: no `Co-Authored-By`, no Claude/Anthropic/AI reference.
- MIS is **VIP-only**: reject `ctx["track"] != "sip"` with 409 `not_available_for_track` before any table access, via a shared dependency — copy the `require_vip` shape from `routers/founder_air.py`.

### Lessons from Phase 2 — these are requirements, not advice

Phase 2 paid for each of these. Do not re-derive them.

1. **No fail-open defaults.** Every function taking a `track`, a period kind, or a catalog key takes it as a **required** parameter. A forgotten argument must be a `TypeError`, never a silent default that reads the wrong data.
2. **Convergent creation from the start.** PostgREST cannot run client-side multi-statement transactions and this project has no `exec_sql` RPC. Period creation must therefore: catch a unique violation narrowly on the insert and re-read the winner's row; **always** reconcile missing child rows on every call, not only at creation; and insert missing children as **one bulk insert**. Reuse `air_query._is_unique_violation` rather than writing a second copy. Phase 2 needed two fix rounds because fix one relocated the race to the child table — get both writes right the first time.
3. **Derive, never store, anything that can go stale.** `overdue`, `vs Last Mo`, `needs_gap` and headcount `net_change` are all computed on read. Do not add columns for them.
4. **Dates are IST.** The Indian FY and month boundaries are IST, not UTC. Phase 2 shipped a UTC bug that mislabelled the period for 5.5 hours after every boundary. Compute in IST.
5. **Tests must guard what they claim.** Assert exact values, not shape. A test named for an ordering must use out-of-order fixtures; a test named for a constraint must fail when that constraint is removed. For every test whose name asserts a property, break the property in memory and confirm the test fails — and say so in your report.
6. **Freeze on submit.** Writes reject on a non-draft period with 409 `mis_already_submitted`. **Reads stay open** — Phase 2 over-applied a freeze to a read endpoint and locked founders out of their own documents.

---

### Task 1: `mis_catalog.py` — the two templates as data

**Files:**
- Create: `backend/app/services/mis_catalog.py`
- Test: `backend/tests/test_mis_catalog.py`

**Interfaces produced:**
- `KINDS: tuple[str, ...]` = `("monthly", "quarterly")`
- `METRICS: list[dict]` — the 13 monthly metric rows, each `{"key", "label", "group", "unit", "computed": bool}`. `trl_level` has `computed=True`.
- `METRIC_GROUPS: list[dict]` — `{"key", "label"}` in display order.
- `SECTIONS: dict[str, list[dict]]` — kind → ordered sections, each `{"id", "number", "title", "hint", "type"}` where `type` is `"narrative" | "entries" | "metrics" | "financials" | "headcount"`.
- `NARRATIVE_FIELDS: dict[str, list[dict]]` — section id → `[{"id", "prompt"}]`.
- `ENTRY_FIELDS: dict[str, list[dict]]` — entry section → `[{"key", "label", "type", "options"?}]`. `type` in `text|int|numeric|date|bool|choice`.
- `FINANCIAL_SERIES: dict[str, list[dict]]`, `FINANCIAL_BUCKETS: dict[str, list[str]]`
- `HEADCOUNT_CATEGORIES: list[dict]`
- `CARRY_FORWARD: dict[str, str]` — entry section → `"all" | "open_only" | "buckets:active,in_discussion" | "none"`
- `entry_fields(section) -> list[dict]` and `section(kind, section_id) -> dict | None` — both raise `KeyError` on an unknown key rather than returning a default (constraint 1).

**Content authority:** transcribe from `docs/reference/mis-templates.md` verbatim. Preserve the flagged template quirk (monthly §7 heading with stale 8.1/8.2 sub-numbers — follow the heading).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mis_catalog.py`. It must include, at minimum:

```python
"""The two ARTPARK MIS templates as data.

Structural guards. Content authority: docs/reference/mis-templates.md
"""
import pytest

from app.services import mis_catalog as cat

EXPECTED_METRICS = [
    ("revenue_month", "commercial"), ("active_customers", "commercial"),
    ("new_lois", "commercial"), ("weighted_pipeline", "commercial"),
    ("deployments_field", "product_technology"), ("product_metric_1", "product_technology"),
    ("product_metric_2", "product_technology"), ("trl_level", "product_technology"),
    ("cash_in_bank", "financials"), ("net_burn_month", "financials"),
    ("runway_months", "financials"),
    ("headcount_eom", "team"), ("net_hires_month", "team"),
]


def test_thirteen_metrics_in_source_order():
    """The template grid is 18 rows, but 1 is a header and 4 are group
    headings — only 13 are metrics. Getting this wrong seeds a phantom row."""
    assert [(m["key"], m["group"]) for m in cat.METRICS] == EXPECTED_METRICS


def test_metric_labels_match_the_source_exactly():
    by_key = {m["key"]: m["label"] for m in cat.METRICS}
    assert by_key["revenue_month"] == "Revenue this month (₹ Lakh)"
    assert by_key["trl_level"] == "TRL Level (1–9)"          # en-dash, not hyphen
    assert by_key["cash_in_bank"] == "Cash in bank (₹ Cr)"
    assert by_key["headcount_eom"] == "Headcount (end of month)"


def test_trl_is_the_only_computed_metric():
    """TRL comes from the verified AIR level, never typed — if another metric
    were marked computed the founder would silently lose an input."""
    assert [m["key"] for m in cat.METRICS if m["computed"]] == ["trl_level"]


def test_metric_groups_cover_every_metric_and_are_ordered():
    order = [g["key"] for g in cat.METRIC_GROUPS]
    assert order == ["commercial", "product_technology", "financials", "team"]
    assert {m["group"] for m in cat.METRICS} == set(order)


def test_both_kinds_have_nine_numbered_sections():
    for kind in cat.KINDS:
        secs = cat.SECTIONS[kind]
        assert [s["number"] for s in secs] == list(range(1, 10)), kind


def test_every_section_declares_a_known_type():
    valid = {"narrative", "entries", "metrics", "financials", "headcount"}
    for kind in cat.KINDS:
        for s in cat.SECTIONS[kind]:
            assert s["type"] in valid, (kind, s["id"])


def test_every_entries_section_has_a_field_schema_and_a_carry_rule():
    for kind in cat.KINDS:
        for s in cat.SECTIONS[kind]:
            if s["type"] == "entries":
                assert cat.ENTRY_FIELDS.get(s["id"]), s["id"]
                assert s["id"] in cat.CARRY_FORWARD, s["id"]


def test_every_narrative_section_has_prompts():
    for kind in cat.KINDS:
        for s in cat.SECTIONS[kind]:
            if s["type"] == "narrative":
                assert cat.NARRATIVE_FIELDS.get(s["id"]), s["id"]


def test_choice_fields_declare_their_options():
    for section, fields in cat.ENTRY_FIELDS.items():
        for f in fields:
            if f["type"] == "choice":
                assert f.get("options"), (section, f["key"])


def test_milestone_status_options_match_the_template():
    status = next(f for f in cat.ENTRY_FIELDS["milestones"] if f["key"] == "status")
    assert status["options"] == ["Done", "On Track", "At Risk", "Blocked"]


def test_ask_categories_match_the_template():
    cats = next(f for f in cat.ENTRY_FIELDS["asks"] if f["key"] == "category")
    assert cats["options"] == [
        "customer_partnership_intros", "investor_intros", "hiring_referrals",
        "artgarage_facility", "iisc_labs_faculty", "non_dilutive_capital",
        "regulatory_policy", "advisor_time",
    ]


def test_financial_series_and_buckets():
    assert cat.FINANCIAL_SERIES["annual_revenue"] == [
        {"key": "annual_revenue_booked", "label": "Revenue: orders / paid pilots on books"},
        {"key": "annual_revenue_received", "label": "Revenue: payment received"},
    ]
    needs = [s["key"] for s in cat.FINANCIAL_SERIES["needs"]]
    assert needs == ["needs_total", "needs_confirmed", "needs_projected", "needs_gap"]
    assert len(cat.FINANCIAL_BUCKETS["needs"]) == 5


def test_headcount_categories_match_the_template():
    assert [c["key"] for c in cat.HEADCOUNT_CATEGORIES] == [
        "artpark_associated", "startup", "consultants", "interns"]


def test_carry_forward_rules_match_the_source():
    assert cat.CARRY_FORWARD["ip_assets"] == "all"
    assert cat.CARRY_FORWARD["funding"] == "all"
    assert cat.CARRY_FORWARD["products"] == "all"
    assert cat.CARRY_FORWARD["milestones"] == "open_only"
    assert cat.CARRY_FORWARD["collaborations"].startswith("buckets:")
    for s in ("risks", "asks", "publications", "planned_vs_actual", "next_milestones"):
        assert cat.CARRY_FORWARD[s] == "none", s


def test_lookups_fail_closed_on_an_unknown_key():
    """No silent default — a typo must raise, not return an empty schema."""
    with pytest.raises(KeyError):
        cat.entry_fields("nonsense")
    with pytest.raises(KeyError):
        cat.section("monthly", "nonsense")
```

- [ ] **Step 2: Run to verify it fails** — `ModuleNotFoundError`.

- [ ] **Step 3: Write the catalog** from `docs/reference/mis-templates.md`, matching the interfaces above.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Mutation check.** Temporarily delete one metric from `METRICS` and confirm `test_thirteen_metrics_in_source_order` fails; change the `trl_level` label's en-dash to a hyphen and confirm the label test fails. Restore. Report both.

- [ ] **Step 6: Commit** — `feat(vip): MIS template catalog — monthly and quarterly structure as data`

---

### Task 2: Migration 045 — the five MIS tables

**Files:**
- Create: `backend/migrations/045_vip_mis.sql`
- Test: `backend/tests/test_vip_mis_migration.py`

Schema per spec §5.3, with the Phase 2 hardening lessons applied **up front**:

```sql
vip_mis_periods
  id uuid pk, application_id uuid not null references sip_applications(id) on delete cascade,
  kind text not null check (kind in ('monthly','quarterly')),
  period_key text not null, label text not null,
  period_start date not null, period_end date not null, due_date date not null,
  status text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz, reopened_at timestamptz, reopened_by uuid,
  narrative jsonb not null default '{}'::jsonb,
  source_doc_path text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (application_id, kind, period_key)

vip_mis_metrics
  id uuid pk, period_id uuid not null references vip_mis_periods(id) on delete cascade,
  metric_key text not null, label text not null, group_key text not null, unit text,
  target numeric, actual numeric, prev_actual numeric,
  rag text check (rag in ('green','amber','red')),
  commentary text, is_custom boolean not null default false, sort_order int not null default 0,
  unique (period_id, metric_key)

vip_mis_financials
  id uuid pk, period_id uuid not null references vip_mis_periods(id) on delete cascade,
  series text not null, bucket text not null, amount numeric, sort_order int not null default 0,
  unique (period_id, series, bucket)

vip_mis_headcount
  id uuid pk, period_id uuid not null references vip_mis_periods(id) on delete cascade,
  category text not null check (category in ('artpark_associated','startup','consultants','interns')),
  current_count int, exited int, remarks text,
  unique (period_id, category)

vip_mis_entries
  id uuid pk, period_id uuid not null references vip_mis_periods(id) on delete cascade,
  section text not null check (section in ('milestones','risks','asks','ip_assets',
    'collaborations','publications','products','funding','planned_vs_actual','next_milestones')),
  sort_order int not null default 0, data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
```

All five: `enable row level security`, no policies. Indexes on the FK columns. Wrapped `begin; … commit;`, all `if not exists`.

**Note the four unique constraints.** Phase 2 shipped without one and needed a fix round when re-uploads duplicated. Every child table here is keyed so that reconciliation is idempotent by construction.

- [ ] **Step 1:** Write `test_vip_mis_migration.py` asserting: all five tables created; real FKs to `sip_applications` and `vip_mis_periods` with `on delete cascade`; each of the four child uniques present; the `kind`, `status`, `rag`, `category` and `section` CHECKs present; `enable row level security` exactly 5 times with no `create policy`; transactional.

  **Assert the CHECK contents, not just their presence** — e.g. that the `section` CHECK lists all ten section names. A CHECK missing one section silently rejects that section's rows at runtime.

- [ ] **Step 2:** Run to verify it fails.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run to verify it passes.
- [ ] **Step 5:** Confirm `tests/test_migrations_parse.py` still passes — it parses every file in `backend/migrations/`, so it will pick up 045 automatically. If it fails, the SQL is genuinely malformed; fix the SQL, do not touch the parse test.
- [ ] **Step 6: Commit** — `feat(vip): migration 045 — MIS periods, metrics, financials, headcount and entries`

---

### Task 3: `mis_periods.py` — the calendar

**Files:**
- Create: `backend/app/services/mis_periods.py`
- Test: `backend/tests/test_mis_periods.py`

**Interfaces produced (all parameters required — constraint 1):**
- `today_ist() -> date` — the current date in IST (constraint 4)
- `monthly_periods(onboarded_on: date, today: date) -> list[dict]` — one per calendar month from onboarding to today inclusive; each `{"period_key","label","period_start","period_end","due_date"}`
- `quarterly_periods(onboarded_on: date, today: date) -> list[dict]` — Indian FY quarters, same shape
- `expected_periods(kind: str, onboarded_on: date, today: date) -> list[dict]` — dispatches; raises on an unknown kind
- `is_overdue(period: dict, today: date) -> bool` — `status == "draft" and due_date < today`

Rules: monthly `period_key` = `YYYY-MM`, label e.g. `Aug 2026`, due the **5th of the following month**. Quarterly `period_key` = `FY26-27-Q1`, label e.g. `Q1 FY26-27`, due the **15th of the month after quarter end**. Quarter boundaries: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar.

- [ ] **Step 1: Write the failing test.** Cover at minimum: a venture onboarded mid-month gets that month as its first period; twelve months of onboarding produce twelve monthly periods; the FY boundary at 1 April and 1 January (Jan–Mar belongs to the FY that began the previous April); due dates including **December → 5 January** and **Q4 → 15 April** (both cross a year boundary); `is_overdue` true only for a draft past its due date and false for a submitted one however old; an unknown kind raises.

  Include an **IST-specific test**: at `2026-08-31T18:31:00Z` the current IST date is 1 September, so August must already be a closed period — a UTC implementation gets this wrong for 5.5 hours after every boundary.

- [ ] **Step 2:** Run to verify it fails.
- [ ] **Step 3:** Write the module. Pure functions — no DB, no I/O.
- [ ] **Step 4:** Run to verify it passes.
- [ ] **Step 5: Commit** — `feat(vip): MIS period calendar — monthly and Indian-FY-quarterly, IST`

---

### Task 4: `mis_query.py` — convergent generation and the read bundle

**Files:**
- Create: `backend/app/services/mis_query.py`
- Test: `backend/tests/test_mis_query.py`

**Interfaces produced:**
- `ensure_periods(application_id: str, kind: str, onboarded_on: date, today: date) -> list[dict]` — convergent (constraint 2): insert missing periods, catch unique violations and re-read, then **always** reconcile each period's child rows (metrics for monthly; financials + headcount for quarterly) via one bulk insert of what is missing.
- `fetch_period(application_id: str, kind: str, period_key: str) -> dict | None`
- `period_bundle(application_id: str, kind: str, period_key: str) -> dict`
- `periods_index(application_id: str, kind: str, today: date) -> list[dict]` — the list view: label, status, due date, derived `overdue`

`period_bundle` returns `{"catalog", "period", "metrics", "financials", "headcount", "entries", "narrative", "derived"}` where `derived` carries the computed values that are never stored (constraint 3): each metric's `vs_last` (`actual − prev_actual`), `needs_gap` per bucket, and headcount `net_change` per category plus the computed Total row.

- [ ] **Step 1: Write the failing test.** Cover: generation is idempotent; a second call inserts nothing; a period missing three of its thirteen metric rows is repaired to thirteen **without touching the ten that exist** (same ids, same `actual` values); a simulated unique violation on the period insert is recovered by re-read; the bundle's `vs_last` is computed not stored; `needs_gap` equals total − confirmed − projected; headcount Total is the sum of the four categories; `overdue` is derived.

- [ ] **Step 2:** Run to verify it fails.
- [ ] **Step 3:** Write the module. Reuse `air_query._is_unique_violation`; do not write a second copy. Sort in Python, not `.order()`.
- [ ] **Step 4:** Run to verify it passes.
- [ ] **Step 5: Mutation check.** Remove the child-row reconciliation and confirm the repair test fails; remove the unique-violation catch and confirm the race test fails. Restore. Report both.
- [ ] **Step 6: Commit** — `feat(vip): MIS period generation (convergent) and the read bundle`

---

### Task 5: carry-forward

**Files:**
- Modify: `backend/app/services/mis_query.py`
- Test: `backend/tests/test_mis_carry_forward.py`

When `ensure_periods` creates a **genuinely new** period, seed it from the most recent **submitted** period of the same kind, per `docs/reference/mis-templates.md` §4:

| What | Rule |
|---|---|
| Metrics | copy `metric_key`, `label`, `group_key`, `unit`, `target`, `is_custom`, `sort_order`; blank `actual` and `commentary`; copy the previous `actual` into `prev_actual` |
| Entries | per `cat.CARRY_FORWARD[section]` — `all`, `open_only` (status ≠ `Done`), `buckets:…`, or `none` |
| Financials / headcount | copy the series/category rows with blank amounts so the grid shape persists |
| Narrative | never copied |

**The repair path must not seed** — only genuine creation does. This is the exact distinction Phase 2's `ensure_round` had to make; mirror it, latching `is_new` from the pre-insert read.

- [ ] **Step 1: Write the failing test.** Cover: the first-ever period is empty; a second period copies targets but blanks actuals; `prev_actual` carries the previous `actual`; a `Done` milestone does not carry but an `At Risk` one does; `ip_assets`, `funding` and `products` carry in full; `risks` and `asks` do not carry; a draft (not submitted) previous period is **not** used as the seed source; the repair path inserts blank rows rather than seeded ones.
- [ ] **Step 2-4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(vip): MIS carry-forward from the previous submitted period`

---

### Task 6: `/founder/mis` router

**Files:**
- Create: `backend/app/routers/founder_mis.py`, `backend/app/models/mis.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_mis_endpoints.py`

Endpoints, all behind a `require_vip` dependency copied from `founder_air.py`:

| Method | Path | Behaviour |
|---|---|---|
| GET | `/founder/mis` | both kinds' period indexes plus the catalog |
| GET | `/founder/mis/{kind}/{period_key}` | the period bundle |
| PUT | `/founder/mis/{kind}/{period_key}/metrics` | upsert metric rows |
| PUT | `/founder/mis/{kind}/{period_key}/narrative` | replace narrative fields |
| PUT | `/founder/mis/{kind}/{period_key}/entries/{section}` | replace that section's rows wholesale |
| PUT | `/founder/mis/{kind}/{period_key}/financials` | upsert series/bucket amounts |
| PUT | `/founder/mis/{kind}/{period_key}/headcount` | upsert category rows |
| POST | `/founder/mis/{kind}/{period_key}/submit` | draft → submitted, stamping `submitted_at` and `updated_at` |

Every write rejects on a non-draft period with 409 `mis_already_submitted` (constraint 6). **All reads stay open on a submitted period.** Unknown `kind`, `period_key` or `section` → 404. An entry whose keys are not in `cat.entry_fields(section)` → 422 `unknown_field`. `trl_level`'s `actual` is server-set from the verified AIR level and rejected if supplied → 422 `computed_metric`.

Ownership is structural: `application_id` comes from `require_founder_access` and never from the request.

- [ ] **Step 1: Write the failing test** covering: a TIR caller 409s on every endpoint; GET creates and lists periods; each PUT round-trips; a submitted period rejects every write but still serves every read; an unknown section 404s; an unknown entry field 422s; supplying `trl_level` 422s; another application's period is unreachable (seed a foreign period with the **current** period_key so the test is not vacuous).
- [ ] **Step 2-4:** fail → implement → pass.
- [ ] **Step 5:** Run the full MIS + AIR + Phase-1 regression.
- [ ] **Step 6: Commit** — `feat(vip): /founder/mis — periods, sections, submit`

---

## Phase exit criteria

- [ ] Six new suites green, plus AIR and Phase-1 suites unchanged.
- [ ] `tests/test_migrations_parse.py` green including 045.
- [ ] Full backend suite shows no NEW failures against the ~20 baseline.
- [ ] Every mutation check in Tasks 1, 4 reported with its observed failure.
- [ ] Migration 045 applied to **staging** by the user.
