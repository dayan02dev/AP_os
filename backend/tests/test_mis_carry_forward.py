"""MIS carry-forward: a genuinely new period seeds from the most recent
*submitted* period of the same kind (docs/reference/mis-templates.md §4).
The repair path — filling in rows missing from a period that already
existed — must never seed; see test_repair_path_does_not_seed for why that
is the Critical scenario this file exists to pin down.
"""
from datetime import date

import pytest

from app.services import mis_catalog as cat
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


def _period(period_id, period_key, kind="monthly", status="draft", application_id="app1"):
    """A period row with placeholder dates — carry-forward never reads
    period_start/period_end/due_date, only status/period_key/kind/id, so a
    fixed placeholder is fine for every test in this file."""
    return {
        "id": period_id, "application_id": application_id, "kind": kind,
        "period_key": period_key, "label": period_key,
        "period_start": date(2026, 1, 1), "period_end": date(2026, 1, 31),
        "due_date": date(2026, 2, 5), "status": status, "narrative": {},
    }


def _metric_row(row_id, period_id, key, **overrides):
    m = next(x for x in cat.METRICS if x["key"] == key)
    row = {
        "id": row_id, "period_id": period_id, "metric_key": key,
        "label": m["label"], "group_key": m["group"], "unit": m["unit"],
        "is_custom": False, "sort_order": cat.METRICS.index(m),
    }
    row.update(overrides)
    return row


def _entry_row(row_id, period_id, section, data, sort_order=0):
    return {"id": row_id, "period_id": period_id, "section": section,
            "sort_order": sort_order, "data": data}


class _RaceOnce:
    """Wraps a FakeSupabase so the first insert().execute() on `table_name`
    simulates losing a concurrent-insert race: right as it raises, the
    winner's row(s) appear in the table — as if a competing request's
    insert on the same unique key had just committed — so a re-read
    immediately after the exception finds them. Mirrors test_mis_query.py's
    own _RaceOnce; kept local per that file's own precedent of not sharing
    race helpers across test files."""

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


# ── metrics ───────────────────────────────────────────────────────────────

def test_first_ever_period_is_empty(fake):
    """No earlier submitted period exists yet — nothing to seed from."""
    periods = mq.ensure_periods("app1", "monthly", date(2026, 8, 1), date(2026, 8, 1))
    rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == periods[0]["id"]]
    assert len(rows) == 13
    for row in rows:
        assert row.get("target") is None
        assert row.get("actual") is None
        assert row.get("prev_actual") is None
        assert row.get("commentary") is None
    entries = [r for r in fake.tables["vip_mis_entries"] if r["period_id"] == periods[0]["id"]]
    assert entries == []


def test_second_period_copies_target_blanks_actual_and_carries_prev_actual(fake):
    fake.tables["vip_mis_periods"].append(_period("p1", "2026-07", status="submitted"))
    fake.tables["vip_mis_metrics"].append(_metric_row(
        "m1", "p1", "revenue_month", target=50, actual=42, commentary="solid month",
    ))

    periods = mq.ensure_periods("app1", "monthly", date(2026, 7, 1), date(2026, 8, 1))
    p2 = next(p for p in periods if p["period_key"] == "2026-08")
    row = next(
        r for r in fake.tables["vip_mis_metrics"]
        if r["period_id"] == p2["id"] and r["metric_key"] == "revenue_month"
    )

    assert row["target"] == 50
    assert row.get("actual") is None
    assert row.get("commentary") is None
    assert row["prev_actual"] == 42
    # untouched metrics still get their ordinary blank catalog row
    others = [
        r for r in fake.tables["vip_mis_metrics"]
        if r["period_id"] == p2["id"] and r["metric_key"] != "revenue_month"
    ]
    assert len(others) == 12
    assert all(r.get("target") is None for r in others)


def test_draft_previous_period_is_not_a_seed_source(fake):
    fake.tables["vip_mis_periods"].append(_period("p1", "2026-07", status="draft"))
    fake.tables["vip_mis_metrics"].append(_metric_row(
        "m1", "p1", "revenue_month", target=999, actual=999,
    ))

    periods = mq.ensure_periods("app1", "monthly", date(2026, 7, 1), date(2026, 8, 1))
    p2 = next(p for p in periods if p["period_key"] == "2026-08")
    row = next(
        r for r in fake.tables["vip_mis_metrics"]
        if r["period_id"] == p2["id"] and r["metric_key"] == "revenue_month"
    )

    assert row.get("target") is None
    assert row.get("prev_actual") is None


# ── entries ───────────────────────────────────────────────────────────────

def test_done_milestone_does_not_carry_but_at_risk_does(fake):
    fake.tables["vip_mis_periods"].append(_period("p1", "2026-07", status="submitted"))
    fake.tables["vip_mis_entries"].append(_entry_row(
        "e-done", "p1", "milestones",
        {"milestone": "Ship v1", "owner": "A", "status": "Done", "notes": ""},
    ))
    fake.tables["vip_mis_entries"].append(_entry_row(
        "e-risk", "p1", "milestones",
        {"milestone": "Close pilot", "owner": "B", "status": "At Risk", "notes": ""},
        sort_order=1,
    ))

    periods = mq.ensure_periods("app1", "monthly", date(2026, 7, 1), date(2026, 8, 1))
    p2 = next(p for p in periods if p["period_key"] == "2026-08")
    rows = [
        r for r in fake.tables["vip_mis_entries"]
        if r["period_id"] == p2["id"] and r["section"] == "milestones"
    ]

    assert len(rows) == 1
    assert rows[0]["data"]["milestone"] == "Close pilot"
    assert rows[0]["data"]["status"] == "At Risk"


def test_risks_and_asks_do_not_carry(fake):
    fake.tables["vip_mis_periods"].append(_period("p1", "2026-07", status="submitted"))
    fake.tables["vip_mis_entries"].append(_entry_row(
        "e-risk", "p1", "risks",
        {"severity": "red", "what_happened": "x", "impact": "y", "mitigation": "z"},
    ))
    fake.tables["vip_mis_entries"].append(_entry_row(
        "e-ask", "p1", "asks",
        {"priority": 1, "category": "hiring_referrals", "ask": "help"},
    ))

    periods = mq.ensure_periods("app1", "monthly", date(2026, 7, 1), date(2026, 8, 1))
    p2 = next(p for p in periods if p["period_key"] == "2026-08")
    entries = [r for r in fake.tables["vip_mis_entries"] if r["period_id"] == p2["id"]]

    assert entries == []


def test_ip_assets_funding_products_carry_in_full(fake):
    fake.tables["vip_mis_periods"].append(_period(
        "q1", "FY26-27-Q1", kind="quarterly", status="submitted",
    ))
    for section in ("ip_assets", "funding", "products"):
        fake.tables["vip_mis_entries"].append(_entry_row(
            f"e-{section}", "q1", section, {"title": f"{section}-row"},
        ))

    periods = mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 7, 1))
    q2 = next(p for p in periods if p["period_key"] == "FY26-27-Q2")

    for section in ("ip_assets", "funding", "products"):
        rows = [
            r for r in fake.tables["vip_mis_entries"]
            if r["period_id"] == q2["id"] and r["section"] == section
        ]
        assert len(rows) == 1
        assert rows[0]["data"]["title"] == f"{section}-row"


def test_collaborations_carries_only_active_and_in_discussion_buckets(fake):
    fake.tables["vip_mis_periods"].append(_period(
        "q1", "FY26-27-Q1", kind="quarterly", status="submitted",
    ))
    for i, bucket in enumerate(("active", "new", "completed", "in_discussion")):
        fake.tables["vip_mis_entries"].append(_entry_row(
            f"e-{bucket}", "q1", "collaborations",
            {"bucket": bucket, "collaborator": bucket}, sort_order=i,
        ))

    periods = mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 7, 1))
    q2 = next(p for p in periods if p["period_key"] == "FY26-27-Q2")
    rows = [
        r for r in fake.tables["vip_mis_entries"]
        if r["period_id"] == q2["id"] and r["section"] == "collaborations"
    ]

    assert {r["data"]["bucket"] for r in rows} == {"active", "in_discussion"}


def test_narrative_is_never_copied(fake):
    p1 = _period("p1", "2026-07", status="submitted")
    p1["narrative"] = {"exec.headline_win": "shipped v1"}
    fake.tables["vip_mis_periods"].append(p1)

    periods = mq.ensure_periods("app1", "monthly", date(2026, 7, 1), date(2026, 8, 1))
    p2 = next(p for p in periods if p["period_key"] == "2026-08")

    assert not p2.get("narrative")


def test_quarterly_financials_and_headcount_carry_shape_with_blank_amounts(fake):
    """Financials/headcount need no seeding code of their own — the
    ordinary reconciliation already never writes an amount, seed or no
    seed. This pins that down explicitly per mis-templates.md §4 rather
    than leaving it as an untested side effect."""
    fake.tables["vip_mis_periods"].append(_period(
        "q1", "FY26-27-Q1", kind="quarterly", status="submitted",
    ))
    fake.tables["vip_mis_financials"].append({
        "id": "f1", "period_id": "q1", "series": "annual_revenue_booked",
        "bucket": "FY26-27 YTD", "amount": 12,
    })
    fake.tables["vip_mis_headcount"].append({
        "id": "h1", "period_id": "q1", "category": "startup", "current_count": 7,
    })

    periods = mq.ensure_periods("app1", "quarterly", date(2026, 4, 1), date(2026, 7, 1))
    q2 = next(p for p in periods if p["period_key"] == "FY26-27-Q2")

    fin = [r for r in fake.tables["vip_mis_financials"] if r["period_id"] == q2["id"]]
    hc = [r for r in fake.tables["vip_mis_headcount"] if r["period_id"] == q2["id"]]
    assert len(fin) == 27
    assert all(r.get("amount") is None for r in fin)
    assert len(hc) == 4
    assert all(r.get("current_count") is None for r in hc)


# ── the Critical scenario: repair must never seed ───────────────────────

def test_repair_path_does_not_seed(fake):
    """The repair path — filling in metric rows missing from a period that
    already exists — must never seed, even when a genuine earlier
    submitted period with real answers exists to seed from. If this fired,
    it would silently overwrite a founder's real answers with copied ones
    on every convergent read, with no way to tell afterwards which numbers
    they actually typed — graded Critical by a previous review.
    """
    fake.tables["vip_mis_periods"].append(_period("p1", "2026-07", status="submitted"))
    fake.tables["vip_mis_metrics"].append(_metric_row(
        "m1", "p1", "revenue_month", target=50, actual=42,
    ))
    # The second period already exists (a crashed request created the
    # period row but never reached child-row reconciliation) — it must be
    # repaired, not seeded, even though app1 has a submitted period with
    # real answers it could otherwise have pulled from.
    fake.tables["vip_mis_periods"].append(_period("p2", "2026-08", status="draft"))

    mq.ensure_periods("app1", "monthly", date(2026, 7, 1), date(2026, 8, 1))

    rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == "p2"]
    assert len(rows) == 13
    row = next(r for r in rows if r["metric_key"] == "revenue_month")
    assert row.get("target") is None
    assert row.get("actual") is None
    assert row.get("prev_actual") is None


def test_new_and_pre_existing_periods_are_seeded_and_repaired_independently_in_one_call(fake):
    """test_repair_path_does_not_seed's own setup can never reach the
    shape where the gate must actually discriminate within a single call:
    both periods there pre-exist, so _ensure_period_rows returns set() and
    the `period_key in new_keys` check is trivially false for everything.
    Here one period is genuinely new (2026-08, missing entirely) and one
    already exists half-built (2026-07, a crashed earlier request left it
    with zero metric rows) — both produced by the SAME ensure_periods
    call. 2026-07 must be repaired blank even though 2026-06 sits right
    there submitted with real answers; 2026-08 must still be correctly
    seeded from that same 2026-06 period. Fix round 1, folded-in issue 2.
    """
    fake.tables["vip_mis_periods"].append(_period("p-jun", "2026-06", status="submitted"))
    fake.tables["vip_mis_metrics"].append(_metric_row(
        "m-jun", "p-jun", "revenue_month", target=50, actual=42,
    ))
    # 2026-07 already exists (half-built by a crashed earlier request) —
    # must be repaired, not seeded, even though 2026-06 is a submitted
    # period with real answers sitting right there in the same call.
    fake.tables["vip_mis_periods"].append(_period("p-jul", "2026-07", status="draft"))
    # 2026-08 does not exist yet — genuinely new in this call.

    mq.ensure_periods("app1", "monthly", date(2026, 6, 1), date(2026, 8, 1))

    jul_rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == "p-jul"]
    assert len(jul_rows) == 13
    jul_revenue = next(r for r in jul_rows if r["metric_key"] == "revenue_month")
    assert jul_revenue.get("target") is None  # repaired blank, not seeded
    assert jul_revenue.get("prev_actual") is None

    aug_period = next(
        p for p in fake.tables["vip_mis_periods"] if p["period_key"] == "2026-08"
    )
    aug_rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == aug_period["id"]]
    assert len(aug_rows) == 13
    aug_revenue = next(r for r in aug_rows if r["metric_key"] == "revenue_month")
    assert aug_revenue["target"] == 50  # genuinely new, correctly seeded
    assert aug_revenue["prev_actual"] == 42


# ── the Important fix: new_keys must narrow on the race path ────────────

def test_race_loser_does_not_seed(fake, monkeypatch):
    """mis_query.py's `_ensure_period_rows` used to return `new_keys`
    unchanged after the unique-violation recovery, so both the winner AND
    the loser of a period-insert race carried the contested key into the
    `new_keys` gate — harmless for metrics/financials/headcount only by
    accident of their unique constraints rejecting the loser's rows, but
    `vip_mis_entries` has no such constraint by design, so a loser landing
    inside the winner's gap would have duplicated every carried
    milestone/IP-asset/collaboration/product/funding row in a report that
    goes to ARTPARK's Governing Council.

    Simulates the loser side of that race directly: a concurrent winner
    has already committed "2026-08" by the time this call's insert fails,
    so this call must recover via re-read (already-tested existing
    behaviour) AND must not seed the winner's period, even though a
    submitted period with real answers sits right there to seed from.
    Fix round 1, Important finding.
    """
    fake.tables["vip_mis_periods"].append(_period("p1", "2026-07", status="submitted"))
    fake.tables["vip_mis_metrics"].append(_metric_row(
        "m1", "p1", "revenue_month", target=50, actual=42,
    ))
    fake.tables["vip_mis_entries"].append(_entry_row(
        "e1", "p1", "milestones",
        {"milestone": "Ship v1", "owner": "A", "status": "At Risk", "notes": ""},
    ))
    winner = {
        "id": "winner-08", "application_id": "app1", "kind": "monthly",
        "period_key": "2026-08", "label": "Aug 2026",
        "period_start": "2026-08-01", "period_end": "2026-08-31",
        "due_date": "2026-09-05", "status": "draft", "narrative": {},
    }
    racy = _RaceOnce(fake, "vip_mis_periods", winner)
    monkeypatch.setattr(mq, "get_admin_client", lambda: racy)

    periods = mq.ensure_periods("app1", "monthly", date(2026, 7, 1), date(2026, 8, 1))

    p2 = next(p for p in periods if p["period_key"] == "2026-08")
    assert p2["id"] == "winner-08"  # recovered via re-read (pre-existing behaviour)

    rows = [r for r in fake.tables["vip_mis_metrics"] if r["period_id"] == "winner-08"]
    assert len(rows) == 13
    revenue_row = next(r for r in rows if r["metric_key"] == "revenue_month")
    # The Important fix: this call lost the race, so it must not have
    # seeded the winner's period, even though it observed "2026-08" as
    # missing before the race resolved.
    assert revenue_row.get("target") is None
    assert revenue_row.get("prev_actual") is None

    entries = [r for r in fake.tables["vip_mis_entries"] if r["period_id"] == "winner-08"]
    assert entries == []
