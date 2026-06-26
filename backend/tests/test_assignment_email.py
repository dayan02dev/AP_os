from unittest.mock import MagicMock, patch
from app.services import assignment_email as ae


def test_groups_by_reviewer_and_sends_once_each():
    sb = MagicMock()
    rows = [
        {"reviewer_user_id": "r1", "application_id": "aaaaaaaa-1", "application_track": "sip"},
        {"reviewer_user_id": "r1", "application_id": "bbbbbbbb-2", "application_track": "tir"},
        {"reviewer_user_id": "r2", "application_id": "cccccccc-3", "application_track": "sip"},
    ]
    svc = MagicMock()
    with patch.object(ae, "get_email_service", return_value=svc), \
         patch.object(ae, "get_contact", side_effect=lambda _sb, uid: {"email": f"{uid}@x.in", "name": uid}), \
         patch.object(ae, "_fetch_app_names", return_value={}), \
         patch.object(ae, "frontend_url", return_value="https://x/reviewer"):
        ae.notify_reviewers_assigned(sb, rows)
    assert svc.send_reviewer_assigned.call_count == 2  # r1 (2 apps), r2 (1 app)
    r1_call = next(c for c in svc.send_reviewer_assigned.call_args_list if c.kwargs["to"] == "r1@x.in")
    labels = {a["track_label"] for a in r1_call.kwargs["apps"]}
    assert labels == {"VIP", "TIR"}  # sip displayed as VIP


def test_never_raises_when_send_fails():
    sb = MagicMock()
    rows = [{"reviewer_user_id": "r1", "application_id": "a-1", "application_track": "sip"}]
    svc = MagicMock()
    svc.send_reviewer_assigned.side_effect = Exception("smtp down")
    with patch.object(ae, "get_email_service", return_value=svc), \
         patch.object(ae, "get_contact", return_value={"email": "r1@x.in", "name": "r1"}), \
         patch.object(ae, "_fetch_app_names", return_value={}), \
         patch.object(ae, "frontend_url", return_value="https://x/reviewer"):
        ae.notify_reviewers_assigned(sb, rows)  # must NOT raise
