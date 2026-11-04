"""bs2-g2: decision / track-move / IC-document / memo-store bug fixes (S2-ADM-*)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.main import app
from app.routers import admin_platform as ap
from app.routers import ic_documents
from app.services import (
    admin_query, applications_query, audit, decision_email, decisions, state_machine,
    stats, track_move, track_move_email, vip_memo_v2,
)
from app.services.vip_memo_gen import store
from app.services.vip_memo_gen.schema import SECTION_KEYS
from tests.fixtures.fake_supabase import FakeSupabase

LAMBDA_SYNC_PAYLOAD = 6 * 1024 * 1024


def _admin():
    return {"user_id": "admin-1", "email": "admin@x.com", "roles": ["admin"]}


@pytest.fixture
def sent(monkeypatch):
    out = {"decision": [], "moved": []}

    class _Svc:
        def send_applicant_decision(self, **kw): out["decision"].append(kw)
        def send_track_moved(self, **kw): out["moved"].append(kw)

    monkeypatch.setattr(decision_email, "get_email_service", lambda: _Svc())
    monkeypatch.setattr(track_move_email, "get_email_service", lambda: _Svc())
    return out


def _install(monkeypatch, tables):
    tables.setdefault("admin_decisions", [])
    sb = FakeSupabase(tables)
    for mod in (admin_query, applications_query, decisions, state_machine, stats, track_move, audit, ap):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb, raising=False)
    app.dependency_overrides[get_current_user] = _admin
    return sb


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


def _app(id_, status, **kw):
    return {"id": id_, "status": status, "display_seq": 27000, "basic_full_name": "Asha",
            "basic_email": "asha@x.io", "basic_org": "Acme",
            "submitted_at": "2026-06-01T00:00:00Z", **kw}


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


# S2-ADM-02
def test_ic_upload_cap_fits_through_api_gateway_lambda():
    assert ic_documents._MAX_BYTES * 4 / 3 <= LAMBDA_SYNC_PAYLOAD


# S2-ADM-03
def test_bulk_decide_transient_error_on_one_item_does_not_500_batch(monkeypatch, sent, client):
    sb = _install(monkeypatch, {
        "tir_applications": [_app("B1", "evaluated"), _app("B2", "evaluated"), _app("B3", "evaluated")],
        "sip_applications": [],
    })
    real = state_machine.apply_status_change

    def flaky(application_id, track, **kw):
        if application_id == "B2":
            raise RuntimeError("upstream 503")
        return real(application_id, track, **kw)

    monkeypatch.setattr(state_machine, "apply_status_change", flaky)
    r = client.post("/admin/platform/decisions/bulk", json={"items": [
        {"track": "tir", "application_id": i, "decision": "rejected", "rationale": "weak"}
        for i in ("B1", "B2", "B3")]})
    assert r.status_code == 200
    assert {x["application_id"]: x["status"] for x in r.json()["results"]} == {
        "B1": "decided", "B2": "error", "B3": "decided"}
    # S2-ADM-22/60 shape: the failed item left no orphan decision row.
    assert [d["application_id"] for d in sb.tables["admin_decisions"]] == ["B1", "B3"]


# S2-ADM-22
def test_failed_gate2_reject_leaves_no_orphan_decision(monkeypatch, sent):
    sb = _install(monkeypatch, {"tir_applications": [_app("G1", "jury_review")], "sip_applications": []})

    def boom(*a, **k):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(state_machine, "apply_status_change", boom)
    with pytest.raises(RuntimeError):
        decisions.record_gate2_decision(track="tir", application_id="G1", decision="rejected",
                                        rationale="no", decided_by="a")
    assert sb.tables["admin_decisions"] == []
    assert sb.status_of("tir", "G1") == "jury_review"


# S2-ADM-60
def test_concurrent_decision_race_leaves_no_stray_row(monkeypatch, sent):
    sb = _install(monkeypatch, {"tir_applications": [_app("C1", "evaluated")], "sip_applications": []})
    real_assert = state_machine.assert_legal_transition
    fired = {"done": False}

    def racing_assert(frm, to):
        real_assert(frm, to)
        if to == "jury_review" and not fired["done"]:
            fired["done"] = True
            decisions.record_decision(track="tir", application_id="C1", decision="rejected",
                                      rationale="no", decided_by="admin-B")

    monkeypatch.setattr(state_machine, "assert_legal_transition", racing_assert)
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        decisions.record_decision(track="tir", application_id="C1", decision="jury_review",
                                  rationale=None, decided_by="admin-A")
    assert [d["decision"] for d in sb.tables["admin_decisions"]] == ["rejected"]


# S2-ADM-20 / 49 / 13 (offered part)
def test_gate1_bulk_reject_of_offered_app_is_booked_as_gate2(monkeypatch, sent, client):
    sb = _install(monkeypatch, {"tir_applications": [_app("O1", "offered")], "sip_applications": []})
    r = client.post("/admin/platform/decisions/bulk", json={"items": [
        {"track": "tir", "application_id": "O1", "decision": "rejected", "rationale": "withdrawn"}]})
    assert r.json()["results"][0]["status"] == "decided"
    assert sb.status_of("tir", "O1") == "rejected"
    assert [d["gate_stage"] for d in sb.tables["admin_decisions"]] == ["gate2"]


# S2-ADM-43 / 53 / 54
def test_gate1_reject_email_of_moved_app_uses_effective_label(monkeypatch, sent, client):
    _install(monkeypatch, {"tir_applications": [_app("M1", "evaluated", moved_to_track="sip")],
                           "sip_applications": []})
    r = client.post("/admin/platform/applications/sip/M1/decision",
                    json={"decision": "rejected", "rationale": "x"})
    assert r.status_code == 200
    assert sent["decision"][0]["program_label"] == "VIP"


def test_gate2_reject_email_of_moved_app_uses_effective_label(monkeypatch, sent, client):
    _install(monkeypatch, {"tir_applications": [_app("M2", "jury_review", moved_to_track="sip")],
                           "sip_applications": []})
    r = client.post("/admin/platform/applications/sip/M2/decision",
                    json={"decision": "rejected", "rationale": "x", "gate_stage": "gate2"})
    assert r.status_code == 200
    assert sent["decision"][0]["program_label"] == "VIP"


def test_unmoved_app_email_label_unchanged(monkeypatch, sent, client):
    _install(monkeypatch, {"tir_applications": [_app("M3", "evaluated")], "sip_applications": []})
    client.post("/admin/platform/applications/tir/M3/decision",
                json={"decision": "rejected", "rationale": "x"})
    assert sent["decision"][0]["program_label"] == "TIR"


# S2-ADM-52
def test_move_track_on_rejected_app_does_not_email_applicant(monkeypatch, sent, client):
    sb = _install(monkeypatch, {"tir_applications": [_app("R1", "rejected")], "sip_applications": []})
    r = client.post("/admin/platform/applications/tir/R1/move-track")
    assert r.status_code == 200
    assert sb.row("tir_applications", "R1")["moved_to_track"] == "sip"
    assert sent["moved"] == []


def test_move_track_on_active_app_still_emails(monkeypatch, sent, client):
    _install(monkeypatch, {"tir_applications": [_app("T1", "evaluated")], "sip_applications": []})
    client.post("/admin/platform/applications/tir/T1/move-track")
    assert len(sent["moved"]) == 1


# S2-ADM-50
def test_ic_current_fetch_db_error_is_502_not_empty(monkeypatch):
    from fastapi import HTTPException

    class _Boom:
        def table(self, *_):
            raise RuntimeError("db down")

    with pytest.raises(HTTPException) as ei:
        ic_documents._fetch_current_all(_Boom(), "tir", "A")
    assert ei.value.status_code == 502


# S2-ADM-08
def _memo(tag):
    return {"name": tag, "headline": tag, "in_short": tag, "plain": tag, "snapshot": {},
            "sections": {k: {"tag": tag} for k in SECTION_KEYS},
            "takeaways": {}, "sources": {}, "questions": []}


def test_superseded_run_finishing_late_does_not_become_current(monkeypatch):
    sb = FakeSupabase({
        "sip_applications": [{"id": "bbbbbbbb-0000-0000-0000-000000000002", "status": "jury_review",
                              "moved_to_track": None}],
        "tir_applications": [], "vip_memos": [], "vip_memo_sections": [], "vip_memo_questions": [],
    })
    monkeypatch.setattr(vip_memo_v2, "get_admin_client", lambda: sb)
    monkeypatch.setattr(ap, "publish_vip_memo", lambda _id: True)
    APP = "bbbbbbbb-0000-0000-0000-000000000002"
    v1 = ap._generate_one(sb, APP, False, "a")["memo_id"]
    store.set_status(sb, v1, "running")
    v2 = ap._generate_one(sb, APP, True, "a")["memo_id"]
    assert store.persist_memo(sb, v2, _memo("NEW")) is True
    assert store.persist_memo(sb, v1, _memo("OLD")) is False
    assert store.current_ready(sb, APP)["id"] == v2
    assert store.get_memo(sb, v1)["status"] == "failed"
