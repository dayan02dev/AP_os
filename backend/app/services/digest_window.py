"""Time-window helper for the daily reviewer-activity digest.

The digest runs at 08:00 IST and summarises the PREVIOUS full IST calendar
day. IST is a fixed UTC+5:30 offset (no DST), so the math is exact.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def previous_ist_day_utc_range(now_utc: datetime) -> tuple[datetime, datetime]:
    """Return [start, end) in UTC covering the previous full IST calendar day."""
    now_ist = now_utc.astimezone(IST)
    today_midnight_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    start_ist = today_midnight_ist - timedelta(days=1)
    end_ist = today_midnight_ist
    return start_ist.astimezone(timezone.utc), end_ist.astimezone(timezone.utc)


def ist_date_label(dt_utc: datetime) -> str:
    """Human label like '25 Jun 2026' for a UTC instant, rendered in IST."""
    return dt_utc.astimezone(IST).strftime("%-d %b %Y")
