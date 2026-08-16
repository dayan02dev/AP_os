"""The MIS reporting calendar: which periods exist, what they are called,
and when each is due.

Pure functions only — no DB, no I/O, no FastAPI imports. Everything
downstream (lazy period generation, the overdue badge, carry-forward) keys
off what this module returns, so getting the arithmetic right here is what
keeps the rest honest.

Content authority: docs/reference/mis-templates.md §3.

Two rules this module exists to enforce:

1. Dates are IST, not UTC. `today_ist()` reads the real timezone via
   `zoneinfo.ZoneInfo("Asia/Kolkata")` rather than hand-rolling a
   `timedelta(hours=5, minutes=30)` offset onto a naive datetime — the
   naive-offset approach silently breaks across DST-observing systems'
   local clocks and is exactly the shape of bug that mislabelled a period
   for 5.5 hours after every boundary in an earlier pass at this problem.
   The actual UTC->IST conversion lives in `_ist_date`, a pure function
   that takes the instant as a parameter, so it can be tested by injecting
   a fixed instant instead of monkeypatching the system clock.

2. No fail-open defaults. `expected_periods` raises on an unknown `kind`
   rather than returning an empty list or silently defaulting to monthly —
   a typo in a kind string must be loud, not a quietly-empty calendar.

Quarter arithmetic mirrors `air_query.current_round_label` term for term
(same fiscal-year-start-in-April rule, same floor-division shape) so the
two independently computed labels always agree for the same date. This
module does not import `air_query` — that module does DB work and this one
must stay pure — so the agreement is a guardrail enforced by
`tests/test_mis_periods.py`'s cross-check, not by shared code.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

_IST = ZoneInfo("Asia/Kolkata")

# Indian FY quarter -> (start_month, end_month), both 1-12. Q4 (Jan-Mar)
# falls in the calendar year *after* the fiscal year's start year.
_QUARTER_MONTHS: dict[int, tuple[int, int]] = {
    1: (4, 6),
    2: (7, 9),
    3: (10, 12),
    4: (1, 3),
}


def _ist_date(instant: datetime) -> date:
    """The IST calendar date for a given instant.

    A naive `instant` is treated as UTC (matching `datetime.now(timezone.utc)`,
    the only naive input this module ever hands it). Pure and side-effect
    free so tests pin behaviour against a fixed instant rather than
    patching the clock globally.
    """
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    return instant.astimezone(_IST).date()


def today_ist() -> date:
    """The current date in Asia/Kolkata."""
    return _ist_date(datetime.now(timezone.utc))


def _next_month_day(year: int, month: int, day: int) -> date:
    """The `day`-th of the month after (year, month) — the shared shape
    behind both due-date rules ("5th of the following month",
    "15th of the month after quarter end")."""
    if month == 12:
        return date(year + 1, 1, day)
    return date(year, month + 1, day)


def _fy_quarter(d: date) -> tuple[int, int]:
    """(fy_start_year, quarter) for `d`.

    Mirrors `air_query.current_round_label`'s arithmetic exactly: the
    fiscal year starts in April, so January-March belongs to the FY that
    began the *previous* April — the boundary most likely to be got wrong.
    """
    y, m = d.year, d.month
    if m >= 4:
        return y, (m - 4) // 3 + 1
    return y - 1, (m + 8) // 3 + 1


def _fy_label(fy_start: int) -> str:
    return f"FY{fy_start % 100:02d}-{(fy_start + 1) % 100:02d}"


def monthly_periods(onboarded_on: date, today: date) -> list[dict]:
    """One period per calendar month from `onboarded_on`'s month through
    `today`'s month, inclusive. A venture onboarded mid-month still gets
    that whole month as its first period.

    Returns `[]` if `onboarded_on` is after `today` — there is no month to
    generate yet.
    """
    start_index = onboarded_on.year * 12 + (onboarded_on.month - 1)
    end_index = today.year * 12 + (today.month - 1)

    periods = []
    for idx in range(start_index, end_index + 1):
        year, month0 = divmod(idx, 12)
        month = month0 + 1
        period_start = date(year, month, 1)
        period_end = date(year, month, calendar.monthrange(year, month)[1])
        periods.append({
            "period_key": f"{year:04d}-{month:02d}",
            "label": period_start.strftime("%b %Y"),
            "period_start": period_start,
            "period_end": period_end,
            "due_date": _next_month_day(year, month, 5),
        })
    return periods


def quarterly_periods(onboarded_on: date, today: date) -> list[dict]:
    """One period per Indian FY quarter from `onboarded_on`'s quarter
    through `today`'s quarter, inclusive.

    Returns `[]` if `onboarded_on` is after `today`.
    """
    start_fy, start_q = _fy_quarter(onboarded_on)
    end_fy, end_q = _fy_quarter(today)
    start_index = start_fy * 4 + (start_q - 1)
    end_index = end_fy * 4 + (end_q - 1)

    periods = []
    for idx in range(start_index, end_index + 1):
        fy_start, q0 = divmod(idx, 4)
        quarter = q0 + 1
        start_month, end_month = _QUARTER_MONTHS[quarter]
        # Q4 (Jan-Mar) falls in the calendar year after fy_start.
        calendar_year = fy_start + 1 if quarter == 4 else fy_start

        period_start = date(calendar_year, start_month, 1)
        period_end = date(
            calendar_year, end_month, calendar.monthrange(calendar_year, end_month)[1]
        )
        fy_label = _fy_label(fy_start)
        periods.append({
            "period_key": f"{fy_label}-Q{quarter}",
            "label": f"Q{quarter} {fy_label}",
            "period_start": period_start,
            "period_end": period_end,
            "due_date": _next_month_day(calendar_year, end_month, 15),
        })
    return periods


def expected_periods(kind: str, onboarded_on: date, today: date) -> list[dict]:
    """Dispatches to `monthly_periods` or `quarterly_periods`.

    Raises `ValueError` on an unknown `kind` — never returns an empty list
    or silently falls back to monthly. A typo must be loud.
    """
    if kind == "monthly":
        return monthly_periods(onboarded_on, today)
    if kind == "quarterly":
        return quarterly_periods(onboarded_on, today)
    raise ValueError(f"unknown MIS period kind: {kind!r}")


def is_overdue(period: dict, today: date) -> bool:
    """Overdue is derived, never stored: a `draft` period whose due date
    has passed. A `submitted` period is never overdue, however old."""
    return period["status"] == "draft" and period["due_date"] < today
