from datetime import datetime, timezone
from app.services.digest_window import previous_ist_day_utc_range, ist_date_label

def test_window_for_8am_ist_run():
    # 2026-06-26 02:30Z == 08:00 IST on Jun 26 → previous IST day = Jun 25
    now = datetime(2026, 6, 26, 2, 30, tzinfo=timezone.utc)
    start, end = previous_ist_day_utc_range(now)
    assert start == datetime(2026, 6, 24, 18, 30, tzinfo=timezone.utc)  # Jun 25 00:00 IST
    assert end == datetime(2026, 6, 25, 18, 30, tzinfo=timezone.utc)    # Jun 26 00:00 IST
    assert ist_date_label(start) == "25 Jun 2026"

def test_window_crosses_month_boundary():
    now = datetime(2026, 7, 1, 2, 30, tzinfo=timezone.utc)  # Jul 1 08:00 IST
    start, end = previous_ist_day_utc_range(now)
    assert start == datetime(2026, 6, 29, 18, 30, tzinfo=timezone.utc)  # Jun 30 00:00 IST
    assert end == datetime(2026, 6, 30, 18, 30, tzinfo=timezone.utc)
