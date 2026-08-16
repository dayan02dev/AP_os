"""Convergent MIS period generation and the read bundle."""
from datetime import date

import pytest

from app.services import mis_catalog as cat
from app.services import mis_periods as mp
from app.services import mis_query as mq
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def fake(monkeypatch):
    f = FakeSupabase({
        "vip_mis_periods": [],
        "vip_mis_metrics": [],
        "vip_mis_financials": [],
        "vip_mis_headcount": [],
        "vip_mis_entries": [],
    })
    monkeypatch.setattr(mq, "get_admin_client", lambda: f)
    return f


class _RaceOnce:
    """Wraps a FakeSupabase so the first insert().execute() on `table_name`
    simulates losing a concurrent-insert race: right as it raises, the
    winner's row(s) appear in the table — as if a competing request's
    insert on the same unique key had just committed — so a re-read
    immediately after the exception finds them. Every call after the
    first behaves like the plain fake. Mirrors test_air_query.py's
    _RaceOnce/_LeverRaceOnce, generalised to whichever MIS table and
    however many winner rows a given race needs (a period-insert race can
    lose on any one of several missing periods in a single bulk insert).
    """

    def __init__(self, inner: FakeSupabase, table_name: str, winner_rows):
        self._inner = inner
        self._table_name = table_name
        self._winner_rows = winner_rows if isinstance(winner_rows, list) else [winner_rows]
        self._armed = True

    def table(self, name):
        q = self._inner.table(name)
        if name == self._table_name and self._armed:
            real_execute = q.execute

            def execute():
                if q._mode == "insert" and self._armed:
                    self._armed = False
                    self._inner.tables[self._table_name].extend(
                        dict(r) for r in self._winner_rows
                    )
                    raise Exception(
                        f'duplicate key value violates unique constraint '
                        f'"{self._table_name}_key" (23505)'
                    )
                return real_execute()

            q.execute = execute
        return q


def _seed_monthly_period(fake, period_id="p1", period_key="2026-08"):
    fake.tables["vip_mis_periods"].append({
        "id": period_id, "application_id": "app1", "kind": "monthly",
        "period_key": period_key, "label": "Aug 2026",
        "period_start": date(2026, 8, 1), "period_end": date(2026, 8, 31),
        "due_date": date(2026, 9, 5), "status": "draft", "narrative": {},
    })


def _seed_quarterly_period(fake, period_id="q1", period_key="FY26-27-Q1"):
    fake.tables["vip_mis_periods"].append({
        "id": period_id, "application_id": "app1", "kind": "quarterly",
        "period_key": period_key, "label": "Q1 FY26-27",
        "period_start": date(2026, 4, 1), "period_end": date(2026, 6, 30),
        "due_date": date(2026, 7, 15), "status": "draft", "narrative": {},
    })


# ── convergent generation ────────────────────────────────────────────────

def test_ensure_periods_creates_drafts_for_the_expected_calendar(fake):
    periods = mq.ensure_periods("app1", "monthly", date(2026, 6, 17), date(2026, 8, 16))
    assert [p["period_key"] for p in periods] == ["2026-06", "2026-07", "2026-08"]
    assert all(p["status"] == "draft" for p in periods)
    assert len(fake.tables["vip_mis_periods"]) == 3


def test_ensure_periods_is_idempotent(fake):
    a = mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 16))
    b = mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 16))
    assert [p["id"] for p in a] == [p["id"] for p in b]
    assert len(fake.tables["vip_mis_periods"]) == 1


def test_second_call_inserts_nothing(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 16))
    periods_count = len(fake.tables["vip_mis_periods"])
    metrics_count = len(fake.tables["vip_mis_metrics"])

    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 16))

    assert len(fake.tables["vip_mis_periods"]) == periods_count
    assert len(fake.tables["vip_mis_metrics"]) == metrics_count


def test_ensure_periods_separates_applications(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    mq.ensure_periods("app2", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    assert len(fake.tables["vip_mis_periods"]) == 2


def test_ensure_periods_raises_on_onboarding_date_after_today(fake):
    """Constraint: mis_periods.expected_periods silently returns [] when
    onboarded_on > today (bad data). That must not surface to a founder as
    an ordinary, empty "no periods yet" — mis_query makes it loud instead."""
    with pytest.raises(ValueError):
        mq.ensure_periods("app1", "monthly", date(2026, 9, 1), date(2026, 8, 1))


def test_ensure_period_rows_latches_which_periods_are_genuinely_new(fake):
    """Task 5 hooks carry-forward seeding off this set — it must contain
    exactly the periods this call created, not periods that already
    existed (the repair path)."""
    _seed_monthly_period(fake, period_id="existing", period_key="2026-07")

    periods, new_keys = mq._ensure_period_rows(
        "app1", "monthly", date(2026, 7, 1), date(2026, 8, 1)
    )

    assert new_keys == {"2026-08"}
    assert {p["period_key"] for p in periods} == {"2026-07", "2026-08"}


def test_ensure_period_rows_reports_no_new_keys_on_the_repair_path(fake):
    _seed_monthly_period(fake)
    periods, new_keys = mq._ensure_period_rows(
        "app1", "monthly", date(2026, 8, 1), date(2026, 8, 1)
    )
    assert new_keys == set()
    assert len(periods) == 1


# ── metrics reconciliation (monthly) ─────────────────────────────────────

def test_new_monthly_period_gets_thirteen_metric_rows_sourced_from_the_catalog(fake):
    periods = mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    period_id = periods[0]["id"]
    rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == period_id]
    assert len(rows) == 13
    assert {r["metric_key"] for r in rows} == {m["key"] for m in cat.METRICS}
    by_key = {m["key"]: m for m in cat.METRICS}
    for row in rows:
        m = by_key[row["metric_key"]]
        assert row["label"] == m["label"]
        assert row["group_key"] == m["group"]


def test_repair_adds_only_the_missing_metric_rows_without_touching_existing_ones(fake):
    """Simulates a process that died mid-way through a previous
    ensure_periods call, leaving only ten of thirteen metric rows. The
    repair must add exactly the missing three and must not touch the ten
    that already carry real `actual` values."""
    _seed_monthly_period(fake, period_id="existing-period")
    keep_keys = [m["key"] for m in cat.METRICS[:10]]
    for i, key in enumerate(keep_keys):
        fake.tables["vip_mis_metrics"].append({
            "id": f"m-{key}", "period_id": "existing-period", "metric_key": key,
            "label": "stale-label", "group_key": "stale-group", "actual": i + 1,
        })

    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))

    rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == "existing-period"]
    assert len(rows) == 13
    assert {r["metric_key"] for r in rows} == {m["key"] for m in cat.METRICS}
    by_id = {r["id"]: r for r in rows}
    for i, key in enumerate(keep_keys):
        row = by_id[f"m-{key}"]
        assert row["actual"] == i + 1
        assert row["label"] == "stale-label"  # untouched, not re-synced


def test_period_insert_race_is_recovered_by_reread(fake, monkeypatch):
    """Two concurrent GETs on first page load can both see no period for
    the current month and both reach the insert. The loser must hit the
    (application_id, kind, period_key) unique constraint, catch it, and
    read the winner's row back — not propagate a 500."""
    winner = {
        "id": "winner-id", "application_id": "app1", "kind": "monthly",
        "period_key": "2026-08", "label": "Aug 2026",
        "period_start": "2026-08-01", "period_end": "2026-08-31",
        "due_date": "2026-09-05", "status": "draft", "narrative": {},
    }
    racy = _RaceOnce(fake, "vip_mis_periods", winner)
    monkeypatch.setattr(mq, "get_admin_client", lambda: racy)

    periods = mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))

    assert len(periods) == 1
    assert periods[0]["id"] == "winner-id"
    assert periods[0]["due_date"] == date(2026, 9, 5)  # ISO string normalised to a date
    assert len(fake.tables["vip_mis_periods"]) == 1
    # the period found via the race still gets its 13 metrics reconciled
    rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == "winner-id"]
    assert len(rows) == 13


def test_period_insert_partial_race_retries_only_the_still_missing_period(fake, monkeypatch):
    """A bulk insert of several missing periods can lose the race on only
    SOME of them: writer A commits two of the three missing periods before
    our insert fails, so the retry branch must insert exactly the one that
    is genuinely still missing — not resurrect the two that already exist,
    and not skip the retry entirely. Every other race test in this file
    injects the COMPLETE winner set, so the re-read always finds nothing
    still missing and the retry path is never actually exercised; this is
    the one test that forces it."""
    winners = [
        {
            "id": "winner-06", "application_id": "app1", "kind": "monthly",
            "period_key": "2026-06", "label": "Jun 2026",
            "period_start": "2026-06-01", "period_end": "2026-06-30",
            "due_date": "2026-07-05", "status": "draft", "narrative": {},
        },
        {
            "id": "winner-07", "application_id": "app1", "kind": "monthly",
            "period_key": "2026-07", "label": "Jul 2026",
            "period_start": "2026-07-01", "period_end": "2026-07-31",
            "due_date": "2026-08-05", "status": "draft", "narrative": {},
        },
    ]
    racy = _RaceOnce(fake, "vip_mis_periods", winners)
    monkeypatch.setattr(mq, "get_admin_client", lambda: racy)

    periods = mq.ensure_periods("app1", "monthly", date(2026, 6, 1), date(2026, 8, 16))

    assert [p["period_key"] for p in periods] == ["2026-06", "2026-07", "2026-08"]
    assert len(fake.tables["vip_mis_periods"]) == 3
    by_key = {p["period_key"]: p for p in periods}
    assert by_key["2026-06"]["id"] == "winner-06"
    assert by_key["2026-07"]["id"] == "winner-07"
    # 2026-08 was genuinely still missing after the race and must have
    # been inserted for real by the retry — not left absent, and not one
    # of the two injected winner rows.
    assert by_key["2026-08"]["id"] not in ("winner-06", "winner-07")


def test_metrics_race_is_recovered_by_reread(fake, monkeypatch):
    """After a genuinely new monthly period is created, both winner and
    loser of a concurrent request can reach the unconditional metrics
    reconciliation for that same brand-new period and race on
    (period_id, metric_key). The loser must recover the same way the
    period-insert race does — return complete without a 500."""
    _seed_monthly_period(fake, period_id="p1")
    winner_rows = [
        {"id": f"m-{m['key']}", "period_id": "p1", "metric_key": m["key"],
         "label": m["label"], "group_key": m["group"]}
        for m in cat.METRICS
    ]
    racy = _RaceOnce(fake, "vip_mis_metrics", winner_rows)
    monkeypatch.setattr(mq, "get_admin_client", lambda: racy)

    periods = mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))

    assert periods[0]["id"] == "p1"
    rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == "p1"]
    assert len(rows) == 13
    assert {r["metric_key"] for r in rows} == {m["key"] for m in cat.METRICS}


def test_bundle_metrics_are_sorted_in_catalog_order_not_db_order(fake):
    """Mutation-proven the same way air_query's own lever-sort test is:
    shuffle the underlying storage first so the assertion actually
    exercises the sort rather than the insert order it would otherwise
    inherit."""
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    fake.tables["vip_mis_metrics"][:] = list(reversed(fake.tables["vip_mis_metrics"]))
    b = mq.period_bundle("app1", "monthly", "2026-08")
    assert [m["metric_key"] for m in b["metrics"]] == [m["key"] for m in cat.METRICS]


# ── financials + headcount reconciliation (quarterly) ────────────────────

def test_fy_start_year_for_q4_period_is_the_previous_calendar_year(fake):
    """Q4 (Jan-Mar) falls in the calendar year AFTER the FY starts — the
    boundary most likely to be got wrong, mirroring mis_periods._fy_quarter."""
    assert mq._fy_start_year(date(2027, 1, 15)) == 2026
    assert mq._fy_start_year(date(2026, 4, 1)) == 2026


def test_new_quarterly_period_gets_financials_and_headcount_rows(fake):
    periods = mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    period_id = periods[0]["id"]
    fin = [r for r in fake.tables["vip_mis_financials"] if r["period_id"] == period_id]
    hc = [r for r in fake.tables["vip_mis_headcount"] if r["period_id"] == period_id]
    # 2 annual_revenue series x 6 buckets + 3 needs series x 5 buckets = 27
    assert len(fin) == 27
    assert {r["series"] for r in fin} == {
        "annual_revenue_booked", "annual_revenue_received",
        "needs_total", "needs_confirmed", "needs_projected",
    }
    assert "needs_gap" not in {r["series"] for r in fin}  # derived, never stored
    assert len(hc) == 4
    assert {r["category"] for r in hc} == {c["key"] for c in cat.HEADCOUNT_CATEGORIES}


def test_repair_adds_only_missing_headcount_categories_without_touching_existing_ones(fake):
    _seed_quarterly_period(fake, period_id="q1")
    fake.tables["vip_mis_headcount"].extend([
        {"id": "h1", "period_id": "q1", "category": "startup", "current_count": 5},
        {"id": "h2", "period_id": "q1", "category": "consultants", "current_count": 2},
    ])

    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))

    rows = [r for r in fake.tables["vip_mis_headcount"] if r["period_id"] == "q1"]
    assert len(rows) == 4
    by_id = {r["id"]: r for r in rows}
    assert by_id["h1"]["current_count"] == 5
    assert by_id["h2"]["current_count"] == 2


def test_financials_race_does_not_break_headcount_reconciliation_for_the_same_period(fake, monkeypatch):
    """financials and headcount are two independent reconciliation calls
    for the same quarterly period; a caught race in one must not prevent
    the other from completing."""
    _seed_quarterly_period(fake, period_id="q1")
    winner_fin = [
        {"id": f"f-{i}", "period_id": "q1", "series": s, "bucket": b}
        for i, (s, b) in enumerate(
            mq._financial_keys({"period_start": date(2026, 4, 1)})
        )
    ]
    racy = _RaceOnce(fake, "vip_mis_financials", winner_fin)
    monkeypatch.setattr(mq, "get_admin_client", lambda: racy)

    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))

    fin = [r for r in fake.tables["vip_mis_financials"] if r["period_id"] == "q1"]
    hc = [r for r in fake.tables["vip_mis_headcount"] if r["period_id"] == "q1"]
    assert len(fin) == 27
    assert len(hc) == 4


def test_headcount_race_is_recovered_by_reread(fake, monkeypatch):
    """The fourth of the four unique-violation catches this module makes
    (period, metrics, financials, headcount) had no dedicated race test —
    all three others were proven by mutation check 2, this one was only
    structurally similar. Proves it behaviourally: the loser must recover
    the same way the other three do."""
    _seed_quarterly_period(fake, period_id="q1")
    winner_hc = [
        {"id": f"h-{c['key']}", "period_id": "q1", "category": c["key"]}
        for c in cat.HEADCOUNT_CATEGORIES
    ]
    racy = _RaceOnce(fake, "vip_mis_headcount", winner_hc)
    monkeypatch.setattr(mq, "get_admin_client", lambda: racy)

    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))

    hc = [r for r in fake.tables["vip_mis_headcount"] if r["period_id"] == "q1"]
    assert len(hc) == 4
    assert {r["category"] for r in hc} == {c["key"] for c in cat.HEADCOUNT_CATEGORIES}


# ── fetch_period ──────────────────────────────────────────────────────────

def test_fetch_period_returns_none_when_absent(fake):
    assert mq.fetch_period("app1", "monthly", "2026-08") is None


def test_fetch_period_normalises_string_dates_to_date_objects(fake):
    """A real Postgrest client returns date columns as ISO strings;
    is_overdue compares due_date against a date object and must not see a
    string on one side."""
    fake.tables["vip_mis_periods"].append({
        "id": "p1", "application_id": "app1", "kind": "monthly",
        "period_key": "2026-08", "label": "Aug 2026",
        "period_start": "2026-08-01", "period_end": "2026-08-31",
        "due_date": "2026-09-05", "status": "draft", "narrative": {},
    })
    p = mq.fetch_period("app1", "monthly", "2026-08")
    assert p["due_date"] == date(2026, 9, 5)
    assert mp.is_overdue(p, date(2026, 9, 10)) is True


# ── periods_index: overdue is derived ─────────────────────────────────────

def test_periods_index_marks_draft_past_due_as_overdue(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 6, 1), date(2026, 6, 1))
    idx = mq.periods_index("app1", "monthly", date(2026, 7, 10))
    assert idx[0]["overdue"] is True
    assert "overdue" not in fake.tables["vip_mis_periods"][0]  # not stored


def test_periods_index_submitted_period_is_never_overdue(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 6, 1), date(2026, 6, 1))
    fake.tables["vip_mis_periods"][0]["status"] = "submitted"
    idx = mq.periods_index("app1", "monthly", date(2026, 12, 31))
    assert idx[0]["overdue"] is False


def test_periods_index_is_sorted_by_period_key(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 1, 1), date(2026, 3, 1))
    fake.tables["vip_mis_periods"][:] = list(reversed(fake.tables["vip_mis_periods"]))
    idx = mq.periods_index("app1", "monthly", date(2026, 3, 1))
    assert [p["period_key"] for p in idx] == ["2026-01", "2026-02", "2026-03"]


def test_periods_index_raises_on_unknown_kind(fake):
    """No fail-open default: a typo'd kind must be loud, not a silent []
    that reads exactly like "this founder has no periods yet" — the same
    rule mis_periods.expected_periods already enforces for this parameter."""
    with pytest.raises(ValueError):
        mq.periods_index("app1", "weekly", date(2026, 8, 1))


# ── the read bundle ───────────────────────────────────────────────────────

def test_period_bundle_has_the_documented_keys(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    b = mq.period_bundle("app1", "monthly", "2026-08")
    assert set(b.keys()) == {
        "catalog", "period", "metrics", "financials", "headcount",
        "entries", "narrative", "derived",
    }


def test_bundle_raises_for_a_nonexistent_period(fake):
    with pytest.raises(LookupError):
        mq.period_bundle("app1", "monthly", "2026-08")


def test_bundle_entries_includes_the_secondary_next_milestones_table(fake):
    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    b = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")
    assert "next_milestones" in b["entries"]
    assert "planned_vs_actual" in b["entries"]


def test_bundle_entries_excludes_a_row_belonging_to_the_other_kinds_section(fake):
    """vip_mis_entries.section's CHECK constraint is global across both
    templates, not per-kind, so nothing in the database stops a "risks"
    row (monthly-only) from existing against a quarterly period_id. It
    must not surface as a stray key a renderer could draw as a real
    section of the wrong template."""
    periods = mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    period_id = periods[0]["id"]
    fake.tables["vip_mis_entries"].append({
        "id": "stray", "period_id": period_id, "section": "risks",
        "sort_order": 0, "data": {},
    })

    b = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")

    assert "risks" not in b["entries"]
    assert "planned_vs_actual" in b["entries"]  # a genuine quarterly section is unaffected


def test_period_bundle_repairs_partially_missing_metric_rows(fake):
    """period_bundle must converge like ensure_periods does: a detail read
    of a period a crashed request left half-built (10 of 13 metric rows)
    must not silently render an incomplete grid — it must repair first."""
    _seed_monthly_period(fake, period_id="p1")
    keep_keys = [m["key"] for m in cat.METRICS[:10]]
    for key in keep_keys:
        fake.tables["vip_mis_metrics"].append({
            "id": f"m-{key}", "period_id": "p1", "metric_key": key,
            "label": "x", "group_key": "y",
        })

    b = mq.period_bundle("app1", "monthly", "2026-08")

    assert len(b["metrics"]) == 13
    assert {m["metric_key"] for m in b["metrics"]} == {m["key"] for m in cat.METRICS}
    # the 10 pre-existing rows are untouched by the repair
    by_id = {m["id"]: m for m in b["metrics"]}
    for key in keep_keys:
        assert by_id[f"m-{key}"]["label"] == "x"


def test_period_bundle_excludes_internal_period_fields(fake):
    """application_id (redundant — already scoped by the caller),
    reopened_by (an admin's uuid) and source_doc_path (an internal storage
    path) must not ship to the founder UI."""
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    fake.tables["vip_mis_periods"][0]["reopened_by"] = "admin-uuid-1"
    fake.tables["vip_mis_periods"][0]["source_doc_path"] = "s3://internal/path.docx"

    b = mq.period_bundle("app1", "monthly", "2026-08")

    assert "application_id" not in b["period"]
    assert "reopened_by" not in b["period"]
    assert "source_doc_path" not in b["period"]
    assert b["period"]["period_key"] == "2026-08"
    assert b["period"]["status"] == "draft"


def test_period_bundle_narrative_is_not_duplicated_inside_period(fake):
    """narrative lives once, at the bundle's own top-level "narrative" key
    — not also inside bundle["period"]."""
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    fake.tables["vip_mis_periods"][0]["narrative"] = {"exec.headline_win": "shipped v1"}

    b = mq.period_bundle("app1", "monthly", "2026-08")

    assert b["narrative"] == {"exec.headline_win": "shipped v1"}
    assert "narrative" not in b["period"]


def test_catalog_in_bundle_matches_kind(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    b = mq.period_bundle("app1", "monthly", "2026-08")
    assert len(b["catalog"]["metrics"]) == 13
    assert "financial_series" not in b["catalog"]

    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    bq = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")
    assert bq["catalog"]["financial_buckets"]["annual_revenue"][-1] == "FY26-27 Proj"
    assert len(bq["catalog"]["headcount_categories"]) == 4


def test_bundle_vs_last_is_computed_not_stored(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    period_id = fake.tables["vip_mis_periods"][0]["id"]
    for row in fake.tables["vip_mis_metrics"]:
        if row["period_id"] == period_id and row["metric_key"] == "revenue_month":
            row["actual"] = 50
            row["prev_actual"] = 30

    b = mq.period_bundle("app1", "monthly", "2026-08")

    assert b["derived"]["metrics"]["vs_last"]["revenue_month"] == 20
    stored = next(m for m in b["metrics"] if m["metric_key"] == "revenue_month")
    assert "vs_last" not in stored


def test_bundle_vs_last_is_none_when_no_prior_actual(fake):
    mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    b = mq.period_bundle("app1", "monthly", "2026-08")
    assert all(v is None for v in b["derived"]["metrics"]["vs_last"].values())


def test_bundle_needs_gap_equals_total_minus_confirmed_minus_projected(fake):
    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    period_id = fake.tables["vip_mis_periods"][0]["id"]
    bucket = "Q1 (Current)"
    for row in fake.tables["vip_mis_financials"]:
        if row["period_id"] != period_id or row["bucket"] != bucket:
            continue
        if row["series"] == "needs_total":
            row["amount"] = 100
        elif row["series"] == "needs_confirmed":
            row["amount"] = 60
        elif row["series"] == "needs_projected":
            row["amount"] = 15

    b = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")

    assert b["derived"]["financials"]["needs_gap"][bucket] == 25
    assert "needs_gap" not in {r["series"] for r in b["financials"]}


def test_bundle_needs_gap_is_none_when_any_input_is_missing(fake):
    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    b = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")
    assert all(v is None for v in b["derived"]["financials"]["needs_gap"].values())


def test_bundle_needs_gap_is_none_when_partially_filled(fake):
    """The case that matters, which the all-missing test above cannot
    catch: one of the three inputs present is not enough to compute a
    gap — needs_confirmed/needs_projected still missing must not silently
    read as 0, which would understate the gap ARTPARK is meant to see."""
    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    period_id = fake.tables["vip_mis_periods"][0]["id"]
    bucket = "Q1 (Current)"
    for row in fake.tables["vip_mis_financials"]:
        if row["period_id"] == period_id and row["bucket"] == bucket and row["series"] == "needs_total":
            row["amount"] = 100

    b = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")

    assert b["derived"]["financials"]["needs_gap"][bucket] is None


def test_bundle_headcount_total_is_the_sum_of_the_four_categories(fake):
    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    period_id = fake.tables["vip_mis_periods"][0]["id"]
    counts = {"artpark_associated": 3, "startup": 5, "consultants": 1, "interns": 2}
    for row in fake.tables["vip_mis_headcount"]:
        if row["period_id"] == period_id:
            row["current_count"] = counts[row["category"]]
            row["exited"] = 0

    b = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")

    assert b["derived"]["headcount"]["total"]["current_count"] == sum(counts.values())
    assert b["derived"]["headcount"]["total"]["net_change"] == sum(counts.values())
    assert b["derived"]["headcount"]["net_change"]["startup"] == 5


def test_bundle_headcount_total_is_none_when_nothing_is_filled(fake):
    """Important-1: a fresh quarterly period's four headcount rows are all
    NULL current_count/exited. The Total row must read as "no data yet",
    not as "0 / 0 / 0" — the latter is a number nobody typed and would
    silently tell ARTPARK this venture has zero people if a founder
    submitted without noticing."""
    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    b = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")
    assert b["derived"]["headcount"]["total"] == {
        "current_count": None, "exited": None, "net_change": None,
    }
    assert all(v is None for v in b["derived"]["headcount"]["net_change"].values())


def test_bundle_headcount_total_sums_partial_entries_treating_blanks_as_zero(fake):
    """Partial entry (one of four categories filled) is genuine
    information and must still roll up — it must not collapse to None the
    way the wholly-blank case does."""
    mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 4, 1))
    period_id = fake.tables["vip_mis_periods"][0]["id"]
    for row in fake.tables["vip_mis_headcount"]:
        if row["period_id"] == period_id and row["category"] == "startup":
            row["current_count"] = 5
            row["exited"] = 2

    b = mq.period_bundle("app1", "quarterly", "FY26-27-Q1")

    assert b["derived"]["headcount"]["total"]["current_count"] == 5
    assert b["derived"]["headcount"]["total"]["exited"] == 2
    assert b["derived"]["headcount"]["total"]["net_change"] == 3
    assert b["derived"]["headcount"]["net_change"]["startup"] == 3
    # the three untouched categories individually stay None, not 0
    for category in ("artpark_associated", "consultants", "interns"):
        assert b["derived"]["headcount"]["net_change"][category] is None
