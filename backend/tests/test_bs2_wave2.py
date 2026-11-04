"""bs2 wave 2 review-fix round (backend)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import auth as auth_mod
from app.routers import ic_documents
from app.services import reviewer_query
from tests import test_ic_documents as icd
from tests.test_bs2_g3_people_auth import _SB, _Auth, ADMIN, _wire  # noqa: F401
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture(autouse=True)
def _reset():
    auth_mod._reset_email_rate_limits()
    yield
    auth_mod._reset_email_rate_limits()
    fastapi_app.dependency_overrides.clear()


# 1. logout revokes only the caller's own session
def test_logout_uses_local_scope(client, monkeypatch):
    admin = MagicMock()
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: admin)
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u", "email": "b@x.in", "track": None, "roles": []}
    client.post("/auth/logout", headers={"Authorization": "Bearer T"})
    admin.auth.admin.sign_out.assert_called_once_with("T", "local")


# 2. per-email ceiling is 15
def test_email_ceiling_is_15(client, monkeypatch):
    anon = MagicMock()
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: MagicMock())
    ip = {"v": ""}
    monkeypatch.setattr(auth_mod, "_client_ip", lambda request: ip["v"])
    anon.auth.sign_in_with_password.side_effect = Exception("Invalid login credentials")
    codes = []
    for n in range(5):
        ip["v"] = f"8.8.8.{n}"
        for _ in range(5):
            codes.append(client.post("/auth/sign-in-password",
                         json={"email": "v@artpark.in", "password": "wrongpass1"}).status_code)
    assert codes[:15] == [401] * 15
    assert 429 in codes[15:]


# 3. signature path accepts up to 4.4 MiB, upload stays at 4 MiB; list 503s
def _pdf(n):
    return b"%PDF-" + b"x" * (n - 5)


def test_signature_accepts_4_2_mib_but_upload_rejects(monkeypatch):
    icd._install(monkeypatch, icd._tables())
    fastapi_app.dependency_overrides[get_current_user] = icd._override_user(["admin"])
    c = icd._client()
    assert c.post(f"/admin/platform/ic-documents/sip/{icd.APP_ID}",
                  files={"file": ("ic.pdf", icd.PDF, "application/pdf")}).status_code == 201
    big = _pdf(int(4.2 * 1024 * 1024))
    r = c.post(f"/admin/platform/ic-documents/sip/{icd.APP_ID}/signature",
               files={"file": ("s.pdf", big, "application/pdf")}, data={"signer_name": "N"})
    assert r.status_code == 200, r.text
    r = c.post(f"/admin/platform/ic-documents/sip/{icd.APP_ID}",
               files={"file": ("ic.pdf", big, "application/pdf")})
    assert r.status_code == 413
    huge = _pdf(int(4.5 * 1024 * 1024))
    r = c.post(f"/admin/platform/ic-documents/sip/{icd.APP_ID}/signature",
               files={"file": ("s.pdf", huge, "application/pdf")}, data={"signer_name": "N"})
    assert r.status_code == 413


def test_list_ic_documents_db_error_is_503(monkeypatch):
    class _Boom:
        def table(self, _n):
            raise RuntimeError("boom")
    monkeypatch.setattr(ic_documents, "get_admin_client", lambda: _Boom())
    fastapi_app.dependency_overrides[get_current_user] = icd._override_user(["admin"])
    assert icd._client().get("/admin/platform/ic-documents?track=sip").status_code == 503


# 4. existing account, send_invite off: password IS reset and returned
async def test_invite_existing_applicant_no_send_resets_and_returns_password(monkeypatch):
    from app.routers import admin_users
    auth = _Auth()
    sb = _SB({"profiles": [{"id": "u1", "email": "u@x.in", "full_name": "U"}],
              "user_roles": [{"user_id": "u1", "role": "applicant"}],
              "reviewer_profiles": [], "batches": []}, auth=auth)
    _wire(monkeypatch, sb)
    monkeypatch.setattr(admin_users, "get_email_service",
                        lambda: SimpleNamespace(send_reviewer_invite=lambda **k: None))
    body = admin_users.CreateUserRequest(email="u@x.in", full_name="U",
                                         roles=["reviewer"], send_invite=False)
    out = await admin_users.create_user(body, current_user=ADMIN)
    pw = [p["password"] for _, p in auth.updates if "password" in p]
    assert pw and out["temp_password"] == pw[0]


# 5. reviewer-side bucket uses the reached-final rule
def test_admin_decision_reached_final_rejected():
    row = {"decision": "rejected", "_reached_final": True}
    assert reviewer_query._admin_decision("rejected", {"_reached_final": True}, None) == "final_rejected"
    assert reviewer_query._admin_decision("rejected", None, None) == "gate1_rejected"
    assert reviewer_query._admin_decision("rejected", row, None) == "final_rejected"


def test_fetch_gate_context_marks_reached_final():
    sb = FakeSupabase({
        "admin_decisions": [
            {"application_track": "tir", "application_id": "a1", "gate_stage": "gate1",
             "decision": "jury_review", "decided_at": "2026-01-01"},
            {"application_track": "tir", "application_id": "a1", "gate_stage": "gate1",
             "decision": "rejected", "decided_at": "2026-02-01"},
            {"application_track": "tir", "application_id": "a2", "gate_stage": "gate1",
             "decision": "rejected", "decided_at": "2026-02-01"},
        ],
        "ic_documents": [],
    })
    gate2, _ = reviewer_query._fetch_gate_context(sb, {"tir": ["a1", "a2"]})
    assert reviewer_query._admin_decision("rejected", gate2.get(("a1", "tir")), None) == "final_rejected"
    assert reviewer_query._admin_decision("rejected", gate2.get(("a2", "tir")), None) == "gate1_rejected"


# 6. role fetch failure -> 503
def test_role_fetch_failure_is_503(client, monkeypatch):
    from app import deps

    class Admin:
        auth = SimpleNamespace(get_user=lambda tok: SimpleNamespace(
            user=SimpleNamespace(id="staff-1", email="s@artpark.in")))

        def table(self, name):
            if name == "user_roles":
                raise RuntimeError("PostgREST 503")
            return FakeSupabase({"profiles": [{"id": "staff-1", "track": "tir"}]}).table(name)

    monkeypatch.setattr(deps, "get_admin_client", lambda: Admin())
    r = client.get("/leadership/stats", headers={"Authorization": "Bearer x"})
    assert r.status_code == 503
