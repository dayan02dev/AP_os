"""Convergent generation of the MIS reporting calendar's period rows, and
the read bundle the founder MIS UI is built from.

Same convergent shape as `air_query.ensure_round`, adopted here from the
start rather than rediscovered the hard way: PostgREST offers no
client-side transaction and this project deliberately has no `exec_sql`
RPC, so a period row and its child rows (`vip_mis_metrics` for monthly;
`vip_mis_financials` + `vip_mis_headcount` for quarterly) cannot be written
atomically. `ensure_periods` therefore reconciles state to what it should
be on *every* call: insert whatever periods are missing from the expected
calendar (`mis_periods.expected_periods`), catch a concurrent-insert race
on `vip_mis_periods`' `(application_id, kind, period_key)` unique
constraint and re-read the winner's row, then always reconcile every
period's child rows regardless of whether that period was just created or
already existed. Both writes get the same "insert; on a unique violation,
re-read and trust whoever won" recovery, because the loser of the
period-insert race falls straight into the same unconditional
child-reconciliation loop the winner runs for that same brand-new period,
and can lose a second race there — the exact shape `air_query.ensure_round`
needed two fix rounds to get right the first time it was written.
`_is_unique_violation` is imported from `air_query`, not redefined.

Sorting is done in Python throughout, never via `.order()` — the
FakeSupabase test double treats `.order()` as a no-op, so a sort that only
worked because of `.order()` would pass its tests and be wrong in
production.

Dates read back from `mis_periods.expected_periods` (`period_start`,
`period_end`, `due_date`) are `date` objects, but a real Postgrest client
has no JSON representation for one on the way in (httpx's encoder raises
`TypeError` on a raw `date`) and hands back an ISO string on the way out.
Every insert here therefore serialises those three fields with
`.isoformat()`, and every read normalises them back to `date` objects
(`_normalise_period`), so `mis_periods.is_overdue`'s `due_date < today`
never compares a string against a `date`.

Task 5 seeds a genuinely-created period's child rows from the most recent
*submitted* period of the same kind; the repair path — filling in rows
missing from a period that already existed — must not. `_ensure_period_rows`
latches which period_keys this call genuinely created, before any child
reconciliation runs, and returns that set alongside the period rows: the
same `is_new_round` distinction `air_query.ensure_round` makes, so Task 5
can hook its seeding off this set rather than re-deriving it.

`_reconcile_children` (the per-period dispatch to metrics or
financials+headcount) is the one implementation of "make this period's
child rows complete", shared by both write paths that need it:
`ensure_periods` calls it for every period in the calendar, and
`period_bundle` calls it for just the one period it is about to render —
a detail GET must converge too, not only a list GET, or a period a
crashed request left half-built would render silently incomplete forever
until someone happened to hit the list endpoint for that application.
"""
from __future__ import annotations

from datetime import date

from ..supabase_client import get_admin_client
from . import mis_catalog as cat
from . import mis_periods as mp
from .air_query import _is_unique_violation

_PERIOD_DATE_FIELDS = ("period_start", "period_end", "due_date")

_METRIC_BY_KEY = {m["key"]: m for m in cat.METRICS}
_METRIC_ORDER = {m["key"]: i for i, m in enumerate(cat.METRICS)}
_HEADCOUNT_ORDER = {c["key"]: i for i, c in enumerate(cat.HEADCOUNT_CATEGORIES)}

# Derived from the catalog rather than hand-listed: if mis_catalog ever
# grows a third annual_revenue series, a literal tuple here would silently
# produce no vip_mis_financials rows for it — the UI would render a row
# from catalog.financial_series with nothing to show in financials.
_ANNUAL_REVENUE_SERIES = tuple(s["key"] for s in cat.FINANCIAL_SERIES["annual_revenue"])
# _NEEDS_SERIES stays a literal: it is a justified filtered subset of the
# catalog's "needs" series that deliberately excludes needs_gap (derived
# on read as needs_total - needs_confirmed - needs_projected, never
# stored — see _needs_gap and mis_catalog's own module docstring for why
# a bare stored column would go stale).
_NEEDS_SERIES = ("needs_total", "needs_confirmed", "needs_projected")


# ── date normalisation ───────────────────────────────────────────────────

def _parse_date(value):
    """A date column as Postgrest actually returns it (an ISO string) or as
    mis_periods hands it to us (a `date` object already), normalised to a
    `date` object either way."""
    return date.fromisoformat(value) if isinstance(value, str) else value


def _normalise_period(row: dict) -> dict:
    row = dict(row)
    for field in _PERIOD_DATE_FIELDS:
        if row.get(field) is not None:
            row[field] = _parse_date(row[field])
    return row


def _serialise_period(expected: dict, application_id: str, kind: str) -> dict:
    """An `expected_periods()` row turned into an insertable
    `vip_mis_periods` payload. Date fields become ISO strings — see the
    module docstring for why a raw `date` object cannot go straight into
    an insert payload against a real Postgrest client."""
    return {
        "application_id": application_id,
        "kind": kind,
        "period_key": expected["period_key"],
        "label": expected["label"],
        "period_start": expected["period_start"].isoformat(),
        "period_end": expected["period_end"].isoformat(),
        "due_date": expected["due_date"].isoformat(),
        "status": "draft",
    }


# ── period reads ─────────────────────────────────────────────────────────

def _fetch_periods(application_id: str, kind: str) -> list[dict]:
    """Every existing period row for (application_id, kind), sorted by
    period_key in Python — FakeSupabase treats `.order()` as a no-op, and
    period_key sorts lexicographically in chronological order for both
    formats (`YYYY-MM` and `FYxx-yy-Qn`), the same property
    `air_query._seed_answers` relies on for `round_label`."""
    rows = (
        get_admin_client().table("vip_mis_periods").select("*")
        .eq("application_id", application_id).eq("kind", kind)
        .execute().data or []
    )
    return sorted((_normalise_period(r) for r in rows), key=lambda r: r["period_key"])


def fetch_period(application_id: str, kind: str, period_key: str) -> dict | None:
    rows = (
        get_admin_client().table("vip_mis_periods").select("*")
        .eq("application_id", application_id).eq("kind", kind)
        .eq("period_key", period_key).limit(1).execute().data or []
    )
    return _normalise_period(rows[0]) if rows else None


# ── convergent period-row creation ───────────────────────────────────────

def _ensure_period_rows(
    application_id: str, kind: str, onboarded_on: date, today: date,
) -> tuple[list[dict], set[str]]:
    """Insert whatever periods `mis_periods.expected_periods` says should
    exist but do not yet, recovering from a concurrent-insert race on
    `(application_id, kind, period_key)` the same way
    `air_query.ensure_round` recovers on `(application_id, round_label)`.

    Raises `ValueError` when `onboarded_on` is after `today` rather than
    silently deferring to `expected_periods`' own `[]` for that case:
    `mis_periods` intentionally stays quiet there (it is a pure calendar
    function with no notion of "this is bad data"), but a bad onboarding
    date reaching this far must not surface to a founder as an ordinary,
    empty "no periods yet" — it is a data problem and must be loud.

    Returns (every period row for this application+kind, the set of
    period_keys this call genuinely just created) — latched from this
    call's pre-insert read, before any race recovery, so both the winner
    and the loser of a period-insert race correctly see their period as
    new (both observed no row before inserting), while a later call
    repairing an already-existing period's child rows does not. Task 5
    hooks its carry-forward seeding off this set.
    """
    if onboarded_on > today:
        raise ValueError(
            f"onboarding date {onboarded_on} is after today ({today}) — "
            "refusing to compute MIS periods from what looks like bad data"
        )

    sb = get_admin_client()
    expected = mp.expected_periods(kind, onboarded_on, today)
    existing = _fetch_periods(application_id, kind)
    have = {r["period_key"] for r in existing}
    missing = [e for e in expected if e["period_key"] not in have]

    if not missing:
        return existing, set()

    new_keys = {e["period_key"] for e in missing}
    try:
        sb.table("vip_mis_periods").insert(
            [_serialise_period(e, application_id, kind) for e in missing]
        ).execute()
    except Exception as exc:
        # Two concurrent GETs on first page load can both see the same
        # missing periods and both reach this insert. The loser hits the
        # (application_id, kind, period_key) unique constraint on
        # whichever period the winner committed first. Re-read rather than
        # propagate a 500; anything not resolvable that way is re-raised.
        if not _is_unique_violation(exc):
            raise
        still_missing_keys = new_keys - {
            r["period_key"] for r in _fetch_periods(application_id, kind)
        }
        if still_missing_keys:
            retry = [e for e in missing if e["period_key"] in still_missing_keys]
            sb.table("vip_mis_periods").insert(
                [_serialise_period(e, application_id, kind) for e in retry]
            ).execute()

    return _fetch_periods(application_id, kind), new_keys


# ── metrics reconciliation (monthly) ─────────────────────────────────────

def _fetch_metrics(period_id: str) -> list[dict]:
    rows = (
        get_admin_client().table("vip_mis_metrics").select("*")
        .eq("period_id", period_id).execute().data or []
    )
    return sorted(rows, key=lambda r: _METRIC_ORDER.get(r.get("metric_key"), 999))


def _missing_metrics(period_id: str) -> list[str]:
    have = {r["metric_key"] for r in _fetch_metrics(period_id)}
    return [m["key"] for m in cat.METRICS if m["key"] not in have]


def _insert_metrics(sb, period_id: str, metric_keys: list[str]) -> None:
    """Blank metric rows for `metric_keys`. `vip_mis_metrics.label` and
    `.group_key` are `NOT NULL` with no default and are not part of the
    unique key, so the minimal "FK + identifying column" shape the
    financials/headcount inserts below use would 23502 here — every row
    must carry `label`/`group_key` sourced from `mis_catalog.METRICS`
    keyed by `metric_key`."""
    rows = []
    for key in metric_keys:
        m = _METRIC_BY_KEY[key]
        rows.append({
            "period_id": period_id,
            "metric_key": key,
            "label": m["label"],
            "group_key": m["group"],
            "unit": m["unit"],
            "is_custom": False,
            "sort_order": _METRIC_ORDER[key],
        })
    sb.table("vip_mis_metrics").insert(rows).execute()


def _reconcile_metrics(sb, period_id: str) -> None:
    missing = _missing_metrics(period_id)
    if not missing:
        return
    try:
        _insert_metrics(sb, period_id, missing)
    except Exception as exc:
        # Same race, one table down: the loser of the period-insert race
        # above falls into this same unconditional reconciliation for the
        # same brand-new period, and can lose a second race on
        # vip_mis_metrics' (period_id, metric_key) constraint.
        if not _is_unique_violation(exc):
            raise
        missing = _missing_metrics(period_id)
        if missing:
            _insert_metrics(sb, period_id, missing)


# ── financials reconciliation (quarterly) ────────────────────────────────

def _fy_start_year(period_start: date) -> int:
    """The calendar year the reporting period's Indian FY starts in — the
    year half of `mis_periods._fy_quarter`'s own rule (FY starts in April),
    applied to a period's own start date rather than "today". Not imported
    from mis_periods: that helper is private, keyed off a quarter number
    this call does not have, and returns a `(fy_start, quarter)` pair when
    only the year is needed here."""
    return period_start.year if period_start.month >= 4 else period_start.year - 1


def _financial_keys(period: dict) -> list[tuple[str, str]]:
    """Every (series, bucket) pair `vip_mis_financials` should carry for
    this quarterly period. Buckets for the annual_revenue series are
    computed relative to the period's own fiscal year via
    `mis_catalog.annual_revenue_buckets` — never a stale literal list."""
    buckets = cat.annual_revenue_buckets(_fy_start_year(period["period_start"]))
    pairs = [(s, b) for s in _ANNUAL_REVENUE_SERIES for b in buckets]
    pairs += [(s, b) for s in _NEEDS_SERIES for b in cat.FINANCIAL_BUCKETS["needs"]]
    return pairs


def _fetch_financials(period: dict) -> list[dict]:
    rows = (
        get_admin_client().table("vip_mis_financials").select("*")
        .eq("period_id", period["id"]).execute().data or []
    )
    order = {key: i for i, key in enumerate(_financial_keys(period))}
    return sorted(rows, key=lambda r: order.get((r.get("series"), r.get("bucket")), 999))


def _missing_financial_keys(period: dict) -> list[tuple[str, str]]:
    have = {(r["series"], r["bucket"]) for r in _fetch_financials(period)}
    return [k for k in _financial_keys(period) if k not in have]


def _insert_financials(sb, period_id: str, keys: list[tuple[str, str]]) -> None:
    rows = [{"period_id": period_id, "series": s, "bucket": b} for s, b in keys]
    sb.table("vip_mis_financials").insert(rows).execute()


def _reconcile_financials(sb, period: dict) -> None:
    missing = _missing_financial_keys(period)
    if not missing:
        return
    try:
        _insert_financials(sb, period["id"], missing)
    except Exception as exc:
        if not _is_unique_violation(exc):
            raise
        missing = _missing_financial_keys(period)
        if missing:
            _insert_financials(sb, period["id"], missing)


# ── headcount reconciliation (quarterly) ─────────────────────────────────

def _fetch_headcount(period: dict) -> list[dict]:
    rows = (
        get_admin_client().table("vip_mis_headcount").select("*")
        .eq("period_id", period["id"]).execute().data or []
    )
    return sorted(rows, key=lambda r: _HEADCOUNT_ORDER.get(r.get("category"), 999))


def _missing_headcount_categories(period: dict) -> list[str]:
    have = {r["category"] for r in _fetch_headcount(period)}
    return [c["key"] for c in cat.HEADCOUNT_CATEGORIES if c["key"] not in have]


def _insert_headcount(sb, period_id: str, categories: list[str]) -> None:
    rows = [{"period_id": period_id, "category": c} for c in categories]
    sb.table("vip_mis_headcount").insert(rows).execute()


def _reconcile_headcount(sb, period: dict) -> None:
    missing = _missing_headcount_categories(period)
    if not missing:
        return
    try:
        _insert_headcount(sb, period["id"], missing)
    except Exception as exc:
        if not _is_unique_violation(exc):
            raise
        missing = _missing_headcount_categories(period)
        if missing:
            _insert_headcount(sb, period["id"], missing)


# ── entries reads ─────────────────────────────────────────────────────────

def _entries_sections_for_kind(kind: str) -> list[str]:
    """Every entries-section id relevant to `kind`, unioned with
    `mis_catalog.SECTION_EXTRA_ENTRIES` per that module's own documented
    convention — skipping the union silently drops a secondary table like
    quarterly's `next_milestones` (§9.2) from the bundle."""
    ids: list[str] = []
    for s in cat.SECTIONS[kind]:
        if s["type"] == "entries":
            ids.append(s["id"])
            ids.extend(cat.SECTION_EXTRA_ENTRIES.get(s["id"], []))
    return ids


def _fetch_entries_by_section(period_id: str, kind: str) -> dict[str, list[dict]]:
    """Every vip_mis_entries row for this period, grouped by section —
    restricted to the sections `kind` actually has. `vip_mis_entries.section`'s
    CHECK constraint (045_vip_mis.sql) is global across both templates, not
    per-kind, so nothing at the database layer stops a row belonging to
    the *other* template's section (e.g. monthly's "risks" on a quarterly
    period_id) from existing; grouping with `setdefault` would surface it
    as a stray key a renderer could draw as a real section of the wrong
    template. Rows outside `kind`'s own sections are dropped here rather
    than surfaced."""
    rows = (
        get_admin_client().table("vip_mis_entries").select("*")
        .eq("period_id", period_id).execute().data or []
    )
    by_section: dict[str, list[dict]] = {sid: [] for sid in _entries_sections_for_kind(kind)}
    for r in rows:
        if r["section"] in by_section:
            by_section[r["section"]].append(r)
    for group in by_section.values():
        group.sort(key=lambda r: r.get("sort_order", 0))
    return by_section


# ── child reconciliation dispatch ───────────────────────────────────────

def _reconcile_children(sb, period: dict, kind: str) -> None:
    """Repairs a period left half-built by a crashed request, and finishes
    a genuinely new one — the same call either way. Runs unconditionally
    on every `ensure_periods` call, not only at creation, which is what a
    transaction would have given us if one were available (it is not; see
    the module docstring). `kind` is already validated by
    `mp.expected_periods` inside `_ensure_period_rows` before this is ever
    reached, so there is no third branch to guard against here."""
    if kind == "monthly":
        _reconcile_metrics(sb, period["id"])
    else:  # "quarterly"
        _reconcile_financials(sb, period)
        _reconcile_headcount(sb, period)


def ensure_periods(
    application_id: str, kind: str, onboarded_on: date, today: date,
) -> list[dict]:
    """Every period from onboarding through today for (application_id,
    kind), created as drafts where missing, with every period's child rows
    reconciled to complete on every call — not only at creation. See the
    module docstring for why both writes need the same race-recovery
    discipline `air_query.ensure_round` established, and why reconciliation
    must be unconditional rather than gated on "was this just created".
    """
    sb = get_admin_client()
    periods, _new_keys = _ensure_period_rows(application_id, kind, onboarded_on, today)
    # _new_keys is not yet consumed here — Task 5 (carry-forward) is the
    # first caller that needs to tell genuine creation apart from repair,
    # and hooks its seeding off exactly this set.
    for period in periods:
        _reconcile_children(sb, period, kind)
    return periods


# ── list view ─────────────────────────────────────────────────────────────

def periods_index(application_id: str, kind: str, today: date) -> list[dict]:
    """The list view: every existing period for (application_id, kind),
    each annotated with derived `overdue` (see `mis_periods.is_overdue`) —
    never stored. Reads only; does not create missing periods itself (that
    needs `onboarded_on`, which this function does not take) — call
    `ensure_periods` first so the calendar is complete before listing it.

    Raises `ValueError` on an unknown `kind` rather than the `.eq("kind",
    kind)` filter below silently matching zero rows — a typo'd kind must
    read as an error, not as "no periods yet", the same no-fail-open rule
    `mis_periods.expected_periods` enforces for the same parameter.
    """
    if kind not in cat.KINDS:
        raise ValueError(f"unknown MIS period kind: {kind!r}")
    periods = _fetch_periods(application_id, kind)
    return [
        {
            "period_key": p["period_key"],
            "label": p["label"],
            "status": p["status"],
            "due_date": p["due_date"],
            "overdue": mp.is_overdue(p, today),
        }
        for p in periods
    ]


# ── the read bundle ───────────────────────────────────────────────────────

def _diff(a, b):
    """actual - prev_actual, or None if either side has no value yet — a
    founder's blank input is not the same as a zero."""
    return None if a is None or b is None else a - b


def _needs_gap(financials: list[dict]) -> dict[str, float | int | None]:
    gap: dict[str, float | int | None] = {}
    for bucket in cat.FINANCIAL_BUCKETS["needs"]:
        by_series = {
            r["series"]: r.get("amount") for r in financials
            if r["bucket"] == bucket and r["series"] in _NEEDS_SERIES
        }
        total = by_series.get("needs_total")
        confirmed = by_series.get("needs_confirmed")
        projected = by_series.get("needs_projected")
        gap[bucket] = (
            None if total is None or confirmed is None or projected is None
            else total - confirmed - projected
        )
    return gap


def _partial_sum(values: list) -> int | float | None:
    """`None` if every value is `None` (nothing entered at all — a fresh
    period's Total row must not silently read as "0", which a founder
    would submit as "this venture has zero people" without ever having
    typed a number); otherwise the sum, treating any still-blank value as
    0 (partial entry — three of four filled — is still useful
    information, so it must not collapse to None too)."""
    if all(v is None for v in values):
        return None
    return sum(v or 0 for v in values)


def _net_change(current, exited):
    """current - exited for one category, or `None` if neither side of
    that category has been entered at all — same all-missing-is-None,
    partial-treats-the-blank-side-as-0 rule as `_partial_sum`, just
    expressed as a difference instead of a sum."""
    if current is None and exited is None:
        return None
    return (current or 0) - (exited or 0)


def _headcount_derived(headcount: list[dict]) -> dict:
    """net_change per category, and the Total row across all four.

    Follows the same all-missing-is-None, partial-is-a-real-sum rule
    `_diff`/`_needs_gap` already apply to metrics/financials: a wholly
    blank period must not read as "0 people" (a number nobody typed), but
    partial entry is genuine information and must still roll up.
    """
    net_change = {
        r["category"]: _net_change(r.get("current_count"), r.get("exited"))
        for r in headcount
    }
    return {
        "net_change": net_change,
        "total": {
            "current_count": _partial_sum([r.get("current_count") for r in headcount]),
            "exited": _partial_sum([r.get("exited") for r in headcount]),
            "net_change": _partial_sum(list(net_change.values())),
        },
    }


def _derived(metrics: list[dict], financials: list[dict], headcount: list[dict]) -> dict:
    """The values constraint 3 forbids storing, computed fresh from what
    was just read and never written back: each metric's `vs_last`,
    `needs_gap` per bucket, and headcount `net_change` plus the computed
    Total row."""
    return {
        "metrics": {
            "vs_last": {
                m["metric_key"]: _diff(m.get("actual"), m.get("prev_actual"))
                for m in metrics
            },
        },
        "financials": {"needs_gap": _needs_gap(financials)},
        "headcount": _headcount_derived(headcount),
    }


def _catalog_for_kind(kind: str, period: dict) -> dict:
    """The catalog slice this one period's UI needs to render: its
    sections in order, entry field schemas for its entries sections
    (unioned with SECTION_EXTRA_ENTRIES per mis_catalog's own documented
    convention), narrative prompts for its narrative-bearing sections, and
    — for quarterly only — the financial series/buckets (buckets computed
    relative to this period's own fiscal year, never a stale literal) and
    headcount categories."""
    sections = cat.SECTIONS[kind]
    section_ids = {s["id"] for s in sections}
    catalog: dict = {
        "kind": kind,
        "sections": sections,
        "entry_fields": {
            sid: cat.entry_fields(sid) for sid in _entries_sections_for_kind(kind)
        },
        "narrative_fields": {
            sid: fields for sid, fields in cat.NARRATIVE_FIELDS.items()
            if sid in section_ids
        },
    }
    if kind == "monthly":
        catalog["metrics"] = cat.METRICS
        catalog["metric_groups"] = cat.METRIC_GROUPS
    else:  # "quarterly"
        fy_start_year = _fy_start_year(period["period_start"])
        catalog["financial_series"] = cat.FINANCIAL_SERIES
        catalog["financial_buckets"] = {
            "annual_revenue": cat.annual_revenue_buckets(fy_start_year),
            "needs": cat.FINANCIAL_BUCKETS["needs"],
        }
        catalog["headcount_categories"] = cat.HEADCOUNT_CATEGORIES
    return catalog


# Period fields safe to ship to the founder UI. Excludes application_id
# (redundant — the caller already scoped the read to their own
# application), reopened_by (an admin's uuid, not the founder's
# business), source_doc_path (an internal storage path), and narrative
# (carried once, at the bundle's own top-level "narrative" key — see
# period_bundle's docstring for why it is not duplicated here too).
_PERIOD_BUNDLE_FIELDS = (
    "id", "kind", "period_key", "label", "period_start", "period_end",
    "due_date", "status", "submitted_at", "reopened_at",
)


def _period_for_bundle(period: dict) -> dict:
    return {k: period.get(k) for k in _PERIOD_BUNDLE_FIELDS}


def period_bundle(application_id: str, kind: str, period_key: str) -> dict:
    """Everything the founder MIS UI needs for one period in one read: the
    catalog slice for this kind, the period row (whitelisted — see
    `_PERIOD_BUNDLE_FIELDS`), its metrics/financials/headcount/entries, its
    narrative (present ONLY at this top-level `narrative` key — not
    duplicated inside `period`), and `derived` — the computed-not-stored
    values (see `_derived`).

    Raises `LookupError` if the period does not exist — fail closed, the
    same convention `mis_catalog.section()`/`entry_fields()` use. This
    function does not create the *period row* itself (that is
    `ensure_periods`' job, which needs `onboarded_on`/`today` this
    function does not take; a caller lists via
    `ensure_periods`/`periods_index` first) — but it DOES converge that
    period's child rows before reading them, via the same
    `_reconcile_children` `ensure_periods` uses, scoped to just this one
    `period_id`. Without this, a detail read of a period a crashed
    request left half-built (e.g. 10 of 13 metric rows) would silently
    render an incomplete grid with no error and no repair; a transaction
    would have prevented that state from being observable at all, but one
    is not available here (see the module docstring), so this read
    repairs it the same way every other read in this module does.
    """
    period = fetch_period(application_id, kind, period_key)
    if period is None:
        raise LookupError(f"no such MIS period: {kind}/{period_key} for {application_id}")

    _reconcile_children(get_admin_client(), period, kind)

    metrics = _fetch_metrics(period["id"]) if kind == "monthly" else []
    financials = _fetch_financials(period) if kind == "quarterly" else []
    headcount = _fetch_headcount(period) if kind == "quarterly" else []
    entries = _fetch_entries_by_section(period["id"], kind)

    return {
        "catalog": _catalog_for_kind(kind, period),
        "period": _period_for_bundle(period),
        "metrics": metrics,
        "financials": financials,
        "headcount": headcount,
        "entries": entries,
        "narrative": period.get("narrative") or {},
        "derived": _derived(metrics, financials, headcount),
    }
