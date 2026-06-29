from unittest.mock import MagicMock, patch
from workers.daily_digest import handler as h


def _roster():
    return {"reviewers": [
        {"name": "Udita", "email": "u@x.in", "assigned": 6, "completed": 4},
        {"name": "Nirav", "email": "n@x.in", "assigned": 0, "completed": 0},
    ]}


def test_digest_sends_all_reviewers_to_admins():
    svc = MagicMock()
    with patch.object(h, "fetch_roster", return_value=_roster()), \
         patch.object(h, "get_admin_client", return_value=MagicMock()), \
         patch.object(h, "get_admin_emails", return_value=["admin@artpark.in"]), \
         patch.object(h, "get_email_service", return_value=svc):
        out = h.lambda_handler({}, None)
    assert svc.send_daily_digest.call_count == 1
    kwargs = svc.send_daily_digest.call_args.kwargs
    assert kwargs["to"] == ["admin@artpark.in"]
    assert len(kwargs["reviewers"]) == 2
    assert kwargs["total_pending"] == 2     # Udita 2 + Nirav 0
    assert out["sent"] is True


def test_digest_skips_when_no_admins():
    svc = MagicMock()
    with patch.object(h, "fetch_roster", return_value={"reviewers": []}), \
         patch.object(h, "get_admin_client", return_value=MagicMock()), \
         patch.object(h, "get_admin_emails", return_value=[]), \
         patch.object(h, "get_email_service", return_value=svc):
        out = h.lambda_handler({}, None)
    svc.send_daily_digest.assert_not_called()
    assert out["sent"] is False
