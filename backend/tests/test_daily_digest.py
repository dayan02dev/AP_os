from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from workers.daily_digest import handler as h


def _review(uid, track, sub):
    return {"reviewer_user_id": uid, "application_id": f"{uid}-app", "application_track": track,
            "recommendation": "yes", "submitted_at": sub,
            "score_problem": 8, "score_solution": 8, "score_tech": 8, "score_founders": 8, "score_commitment": 8}

def test_sends_digest_for_prev_day_activity():
    sb = MagicMock()
    sb.table.return_value.select.return_value.execute.return_value = MagicMock(
        data=[_review("r1", "sip", "2026-06-25T05:00:00Z")]  # inside Jun 25 IST day
    )
    svc = MagicMock()
    with patch.object(h, "get_admin_client", return_value=sb), \
         patch.object(h, "get_email_service", return_value=svc), \
         patch.object(h, "get_admin_emails", return_value=["admin@artpark.in"]), \
         patch.object(h, "get_contact", return_value={"email": "r1@x.in", "name": "Rey"}), \
         patch.object(h, "_now_utc", return_value=datetime(2026, 6, 26, 2, 30, tzinfo=timezone.utc)):
        out = h.lambda_handler({}, None)
    assert svc.send_daily_digest.call_count == 1
    assert svc.send_daily_digest.call_args.kwargs["to"] == ["admin@artpark.in"]
    assert out["sent"] is True

def test_skips_when_no_activity():
    sb = MagicMock()
    sb.table.return_value.select.return_value.execute.return_value = MagicMock(data=[])
    svc = MagicMock()
    with patch.object(h, "get_admin_client", return_value=sb), \
         patch.object(h, "get_email_service", return_value=svc), \
         patch.object(h, "get_admin_emails", return_value=["admin@artpark.in"]), \
         patch.object(h, "_now_utc", return_value=datetime(2026, 6, 26, 2, 30, tzinfo=timezone.utc)):
        out = h.lambda_handler({}, None)
    svc.send_daily_digest.assert_not_called()
    assert out["sent"] is False
