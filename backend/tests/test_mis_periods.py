"""The MIS reporting calendar: monthly and Indian-FY-quarterly periods, IST.

Content authority: docs/reference/mis-templates.md §3.
"""
from datetime import date, datetime, timezone

import pytest

from app.services import air_query as aq
from app.services import mis_periods as mp


# ── monthly periods ──────────────────────────────────────────────────────

def test_mid_month_onboarding_gets_that_whole_month_as_first_period():
    """A venture onboarded on the 17th still gets the whole month as its
    first period, not the following one."""
    periods = mp.monthly_periods(date(2026, 3, 17), date(2026, 3, 17))
    assert len(periods) == 1
    p = periods[0]
    assert p["period_key"] == "2026-03"
    assert p["period_start"] == date(2026, 3, 1)
    assert p["period_end"] == date(2026, 3, 31)


def test_twelve_months_of_onboarding_produce_twelve_periods():
    periods = mp.monthly_periods(date(2025, 9, 5), date(2026, 8, 16))
    assert len(periods) == 12
    assert [p["period_key"] for p in periods] == [
        "2025-09", "2025-10", "2025-11", "2025-12",
        "2026-01", "2026-02", "2026-03", "2026-04",
        "2026-05", "2026-06", "2026-07", "2026-08",
    ]


def test_monthly_label_format():
    periods = mp.monthly_periods(date(2026, 8, 1), date(2026, 8, 1))
    assert periods[0]["label"] == "Aug 2026"


def test_monthly_december_due_5_january():
    """Crosses a year boundary — the case most likely to be got wrong."""
    periods = mp.monthly_periods(date(2025, 12, 1), date(2025, 12, 20))
    assert len(periods) == 1
    assert periods[0]["period_key"] == "2025-12"
    assert periods[0]["due_date"] == date(2026, 1, 5)


def test_monthly_ordinary_month_due_5th_of_next_month():
    periods = mp.monthly_periods(date(2026, 3, 1), date(2026, 3, 1))
    assert periods[0]["due_date"] == date(2026, 4, 5)


def test_monthly_onboarding_after_today_yields_no_periods():
    assert mp.monthly_periods(date(2026, 9, 1), date(2026, 8, 1)) == []


# ── quarterly periods ────────────────────────────────────────────────────

def test_quarterly_q4_due_15_april():
    """Q4 (Jan-Mar) crosses both a calendar-year and a fiscal-year
    boundary on its way to its due date."""
    periods = mp.quarterly_periods(date(2026, 1, 10), date(2026, 1, 10))
    assert len(periods) == 1
    p = periods[0]
    assert p["period_key"] == "FY25-26-Q4"
    assert p["period_start"] == date(2026, 1, 1)
    assert p["period_end"] == date(2026, 3, 31)
    assert p["due_date"] == date(2026, 4, 15)


def test_quarterly_label_format():
    periods = mp.quarterly_periods(date(2026, 4, 1), date(2026, 4, 1))
    assert periods[0]["label"] == "Q1 FY26-27"


@pytest.mark.parametrize("day,period_key", [
    (date(2026, 4, 1), "FY26-27-Q1"),
    (date(2026, 6, 30), "FY26-27-Q1"),
    (date(2026, 7, 1), "FY26-27-Q2"),
    (date(2026, 9, 30), "FY26-27-Q2"),
    (date(2026, 10, 1), "FY26-27-Q3"),
    (date(2026, 12, 31), "FY26-27-Q3"),
    (date(2027, 1, 1), "FY26-27-Q4"),
    (date(2027, 3, 31), "FY26-27-Q4"),
    (date(2027, 4, 1), "FY27-28-Q1"),
])
def test_fy_boundary_lands_in_the_right_quarter(day, period_key):
    """1 April and 1 January both land in the right FY quarter — mirrors
    air_query's own parametrize table so both stay honest about the
    boundary."""
    periods = mp.quarterly_periods(day, day)
    assert periods[-1]["period_key"] == period_key


def test_quarterly_multiple_quarters_span_correctly():
    """Onboarded in Q4 of one FY, today in Q2 of the next — four quarters,
    in order, spanning the FY rollover."""
    periods = mp.quarterly_periods(date(2026, 2, 1), date(2026, 8, 1))
    assert [p["period_key"] for p in periods] == [
        "FY25-26-Q4", "FY26-27-Q1", "FY26-27-Q2",
    ]


# ── cross-check against air_query.current_round_label ───────────────────

@pytest.mark.parametrize("day", [
    date(2026, 4, 1), date(2026, 6, 30), date(2026, 7, 1), date(2026, 9, 30),
    date(2026, 10, 1), date(2026, 12, 31), date(2027, 1, 1), date(2027, 3, 31),
    date(2027, 4, 1), date(2026, 1, 15), date(2000, 2, 29),
])
def test_quarter_key_agrees_with_air_query_current_round_label(day):
    """mis_periods deliberately does not import air_query (it does DB work
    and this module must stay pure), so the FY-quarter arithmetic is
    mirrored by hand. This test is the guardrail that the two never
    silently drift apart."""
    periods = mp.quarterly_periods(day, day)
    assert periods[-1]["period_key"] == aq.current_round_label(day)


# ── expected_periods dispatch ─────────────────────────────────────────────

def test_expected_periods_dispatches_monthly():
    assert mp.expected_periods("monthly", date(2026, 8, 1), date(2026, 8, 1)) \
        == mp.monthly_periods(date(2026, 8, 1), date(2026, 8, 1))


def test_expected_periods_dispatches_quarterly():
    assert mp.expected_periods("quarterly", date(2026, 8, 1), date(2026, 8, 1)) \
        == mp.quarterly_periods(date(2026, 8, 1), date(2026, 8, 1))


def test_expected_periods_raises_on_unknown_kind():
    """No fail-open default — a typo must be loud, never silently empty or
    silently monthly."""
    with pytest.raises(ValueError):
        mp.expected_periods("weekly", date(2026, 8, 1), date(2026, 8, 1))


def test_expected_periods_does_not_default_to_monthly_on_typo():
    with pytest.raises(ValueError):
        mp.expected_periods("Monthly", date(2026, 8, 1), date(2026, 8, 1))


# ── is_overdue ────────────────────────────────────────────────────────────

def test_is_overdue_true_for_draft_past_due_date():
    period = {"status": "draft", "due_date": date(2026, 1, 5)}
    assert mp.is_overdue(period, date(2026, 1, 6)) is True


def test_is_overdue_false_for_submitted_however_old():
    period = {"status": "submitted", "due_date": date(2020, 1, 5)}
    assert mp.is_overdue(period, date(2026, 8, 16)) is False


def test_is_overdue_false_for_draft_not_yet_due():
    period = {"status": "draft", "due_date": date(2026, 1, 5)}
    assert mp.is_overdue(period, date(2026, 1, 5)) is False
    assert mp.is_overdue(period, date(2026, 1, 4)) is False


# ── IST, not UTC ──────────────────────────────────────────────────────────

def test_ist_date_rolls_over_before_utc_midnight():
    """At 2026-08-31T18:31:00Z the IST date is already 1 September (UTC+5:30
    carries 18:31 past midnight). A UTC implementation gets this wrong for
    5.5 hours after every boundary.

    Injecting the instant into the pure conversion helper rather than
    monkeypatching datetime.now globally, so the test pins the actual
    conversion logic instead of a mocked clock.
    """
    instant = datetime(2026, 8, 31, 18, 31, 0, tzinfo=timezone.utc)
    assert mp._ist_date(instant) == date(2026, 9, 1)


def test_ist_date_just_before_rollover_is_still_august():
    instant = datetime(2026, 8, 31, 18, 29, 59, tzinfo=timezone.utc)
    assert mp._ist_date(instant) == date(2026, 8, 31)


def test_ist_date_accepts_naive_instant_as_utc():
    instant = datetime(2026, 8, 31, 18, 31, 0)
    assert mp._ist_date(instant) == date(2026, 9, 1)


def test_august_is_a_closed_period_once_ist_rolls_to_september():
    """The scenario the IST rule exists for: once the injected instant's IST
    date is 1 September, September must already exist as its own period —
    a UTC implementation would still read 31 August at this instant and
    stop generating at August, one period short."""
    instant = datetime(2026, 8, 31, 18, 31, 0, tzinfo=timezone.utc)
    ist_today = mp._ist_date(instant)
    utc_today = instant.date()  # what a (wrong) UTC-naive read would use

    assert ist_today == date(2026, 9, 1)
    assert utc_today == date(2026, 8, 31)

    ist_keys = [p["period_key"] for p in mp.monthly_periods(date(2026, 1, 1), ist_today)]
    utc_keys = [p["period_key"] for p in mp.monthly_periods(date(2026, 1, 1), utc_today)]

    assert ist_keys[-1] == "2026-09"
    assert utc_keys[-1] == "2026-08"
    assert len(ist_keys) == len(utc_keys) + 1
