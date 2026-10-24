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


# ── VIP fix: real column names, rendered list, batch name ──────────────────
import pathlib
import re

from tests.fixtures.fake_supabase import FakeSupabase


def test_fetch_app_names_selects_only_real_columns():
    selected = []
    sb = MagicMock()

    def table(name):
        q = MagicMock()
        q.select.side_effect = lambda cols: (selected.append((name, cols)), q)[1]
        q.in_.return_value = q
        q.execute.return_value = MagicMock(data=[])
        return q

    sb.table.side_effect = table
    ae._fetch_app_names(sb, [
        {"application_id": "a", "application_track": "tir"},
        {"application_id": "b", "application_track": "sip"},
    ])
    assert selected
    mig = "\n".join(p.read_text() for p in pathlib.Path(__file__).resolve().parents[1].glob("migrations/*.sql")) \
        if list(pathlib.Path(__file__).resolve().parents[1].glob("migrations/*.sql")) else ""
    for _t, cols in selected:
        assert "basic_org_name" not in cols
        assert "basic_org" in cols and "display_seq" in cols and "moved_to_track" in cols and "status" in cols
        if mig:
            for c in ("basic_org", "basic_full_name"):
                assert c in mig


def test_names_status_filter_and_count(monkeypatch):
    sb = FakeSupabase({
        "tir_applications": [
            {"id": "t1", "basic_full_name": "Ann", "basic_org": "AnnCo", "display_seq": 5,
             "moved_to_track": None, "status": "under_review"},
            {"id": "t2", "basic_full_name": "Bob", "basic_org": None, "display_seq": 6,
             "moved_to_track": "sip", "status": "submitted"},
            {"id": "t3", "basic_full_name": "Rej", "basic_org": "RejCo", "display_seq": 7,
             "moved_to_track": None, "status": "rejected"},
        ],
        "sip_applications": [],
    })
    monkeypatch.setattr(ae.applications_query, "fetch_project_names_for", lambda pairs: {("tir", "t1"): "ProjOne"})
    info = ae._fetch_app_names(sb, [
        {"application_id": i, "application_track": "tir"} for i in ("t1", "t2", "t3")
    ])
    assert info[("t1", "tir")]["name"] == "ProjOne"
    assert info[("t2", "tir")]["name"] == "Bob"
    assert info[("t2", "tir")]["track_label"] == "VIP"
    assert info[("t2", "tir")]["display_id"] == "TIR-6"

    svc = MagicMock()
    rows = [
        {"reviewer_user_id": "r1", "application_id": i, "application_track": "tir"}
        for i in ("t1", "t2", "t3")
    ] + [{"reviewer_user_id": "r2", "application_id": "t3", "application_track": "tir"}]
    with patch.object(ae, "get_email_service", return_value=svc), \
         patch.object(ae, "get_contact", side_effect=lambda _sb, uid: {"email": f"{uid}@x.in", "name": uid}), \
         patch.object(ae, "frontend_url", return_value="https://x/reviewer"):
        n = ae.notify_reviewers_assigned(sb, rows, batch_name="Defense")
    assert n == 1  # r2 only had a rejected app -> nothing sent
    call = svc.send_reviewer_assigned.call_args
    assert len(call.kwargs["apps"]) == 2
    assert call.kwargs["batch_name"] == "Defense"


def test_notify_returns_zero_on_send_failure():
    svc = MagicMock()
    svc.send_reviewer_assigned.side_effect = Exception("down")
    with patch.object(ae, "get_email_service", return_value=svc), \
         patch.object(ae, "get_contact", return_value={"email": "a@x", "name": "a"}), \
         patch.object(ae, "_fetch_app_names", return_value={}), \
         patch.object(ae, "frontend_url", return_value="u"):
        assert ae.notify_reviewers_assigned(
            MagicMock(), [{"reviewer_user_id": "r", "application_id": "a-1", "application_track": "tir"}]
        ) == 0


def test_template_renders_names_label_batch_and_escapes():
    from app.services.email_service import EmailService
    svc = EmailService()
    sent = {}
    svc.send_raw = lambda to, subject, html, text, **k: sent.update(subject=subject, html=html, text=text) or {}
    apps = [{"applicant_name": "Acme <b>&</b>", "track_label": "VIP", "display_id": "VIP-26668"}]
    svc.send_reviewer_assigned(to="r@x", reviewer_name="Rev", apps=apps, inbox_url="https://x",
                               batch_name="Defense")
    html, text = sent["html"], sent["text"]
    assert "VIP-26668" in html and "VIP" in html and "Defense" in html
    assert "Acme &lt;b&gt;" in html and "<b>&</b>" not in html
    assert "Acme <b>&</b> — VIP · VIP-26668" in text and "Defense" in text
    assert sent["subject"] == "You've been assigned 1 application to review (Defense batch) — ARTPARK"
    apps = apps * 65
    svc.send_reviewer_assigned(to="r@x", reviewer_name="Rev", apps=apps, inbox_url="u")
    assert "and 5 more" in sent["text"] and "and 5 more" in sent["html"]
    assert sent["subject"] == "You've been assigned 65 applications to review — ARTPARK"
