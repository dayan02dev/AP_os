from unittest.mock import MagicMock, patch
from workers.reviewer_reminder import handler as h


def _roster():
    return {"reviewers": [
        {"name": "A", "email": "a@x.in", "assigned": 5, "completed": 2},   # pending 3 → send
        {"name": "B", "email": "b@x.in", "assigned": 4, "completed": 4},   # pending 0 → skip
        {"name": "C", "email": None,     "assigned": 3, "completed": 0},   # no email → skip
    ]}


def test_sends_only_to_reviewers_with_pending_and_email():
    svc = MagicMock()
    with patch.object(h, "fetch_roster", return_value=_roster()), \
         patch.object(h, "get_email_service", return_value=svc):
        out = h.lambda_handler({}, None)
    assert svc.send_reviewer_reminder.call_count == 1
    kwargs = svc.send_reviewer_reminder.call_args.kwargs
    assert kwargs["to"] == "a@x.in"
    assert kwargs["pending_count"] == 3 and kwargs["completed_count"] == 2
    assert out["sent"] == 1 and out["skipped"] == 2
