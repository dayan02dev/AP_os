"""bs2 group 3: admin people routes + shared auth fixes (S2-ADM-*, S2-SH-*)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import admin_platform, admin_users
from app.routers import auth as auth_mod
from app.routers import jury_invites
from app.services import admin_query, applications_query, user_lookup
from tests.fixtures.fake_supabase import FakeSupabase

ADMIN = {"user_id": "admin-1", "roles": ["admin"], "email": "a@x.in"}


class _Auth:
    def __init__(self, fail=None):
        self.admin = self
        self.updates: list[tuple[str, dict]] = []
        self.fail = fail

    def update_user_by_id(self, uid, payload):
        if self.fail:
            raise Exception(self.fail)
        self.updates.append((uid, payload))
        return SimpleNamespace(user=SimpleNamespace(id=uid))

    def create_user(self, payload):
        return SimpleNamespace(user=SimpleNamespace(id="new-user"))


class _SB(FakeSupabase):
    def __init__(self, tables, auth=None):
        super().__init__(tables)
        self.auth = auth or _Auth()


def _wire(monkeypatch, sb, audits=None):
    for mod in (admin_platform, admin_users, admin_query, applications_query):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb, raising=False)
    sink = (lambda **k: audits.append(k)) if audits is not None else (lambda **k: None)
    monkeypatch.setattr(admin_platform, "write_audit", sink)
    monkeypatch.setattr(admin_users, "write_audit", sink)
    monkeypatch.setattr(admin_platform, "notify_reviewers_assigned", lambda *a, **k: 0)


@pytest.fixture(autouse=True)
def _reset():
    auth_mod._reset_email_rate_limits()
    yield
    auth_mod._reset_email_rate_limits()
    fastapi_app.dependency_overrides.clear()


def _world():
    return {
        "user_roles": [{"user_id": "R", "role": "reviewer"},
                       {"user_id": "admin-1", "role": "admin"}],
        "batches": [{"id": "B", "name": "Batch B"}],
        "batch_reviewers": [{"batch_id": "B", "reviewer_user_id": "R"}],
        "reviewer_assignments": [{"id": "as1", "application_id": "X",
                                  "application_track": "tir", "reviewer_user_id": "R",
                                  "declined_at": None, "reassigned_to": None}],
        "tir_applications": [{"id": "X", "status": "under_review"}],
        "sip_applications": [], "reviews": [], "application_status_log": [],
        "profiles": [{"id": "R", "email": "r@x.in", "full_name": "R"}],
        "reviewer_profiles": [],
    }


# ── S2-ADM-06 ────────────────────────────────────────────────────────────
async def test_invite_existing_applicant_without_delivery_keeps_password(monkeypatch):
    auth = _Auth()
    sb = _SB({"profiles": [{"id": "u1", "email": "u@x.in", "full_name": "U"}],
              "user_roles": [{"user_id": "u1", "role": "applicant"}],
              "reviewer_profiles": [], "batches": []}, auth=auth)
    _wire(monkeypatch, sb)
    monkeypatch.setattr(admin_users, "get_email_service",
                        lambda: SimpleNamespace(send_reviewer_invite=lambda **k: None))
    body = admin_users.CreateUserRequest(email="u@x.in", full_name="U",
                                         roles=["reviewer"], send_invite=False)
    await admin_users.create_user(body, current_user=ADMIN)
    assert not [p for _, p in auth.updates if "password" in p]


async def test_invite_existing_applicant_with_email_still_resets(monkeypatch):
    auth = _Auth()
    sb = _SB({"profiles": [{"id": "u1", "email": "u@x.in", "full_name": "U"}],
              "user_roles": [{"user_id": "u1", "role": "applicant"}],
              "reviewer_profiles": [], "batches": []}, auth=auth)
    _wire(monkeypatch, sb)
    sent = []
    monkeypatch.setattr(admin_users, "get_email_service",
                        lambda: SimpleNamespace(send_reviewer_invite=lambda **k: sent.append(k)))
    body = admin_users.CreateUserRequest(email="u@x.in", full_name="U",
                                         roles=["reviewer"], send_invite=True)
    await admin_users.create_user(body, current_user=ADMIN)
    assert [p for _, p in auth.updates if "password" in p] and sent


# ── S2-ADM-30 ────────────────────────────────────────────────────────────
async def test_invite_existing_account_grants_every_requested_role(monkeypatch):
    sb = _SB({"profiles": [{"id": "u1", "email": "u@x.in", "full_name": "U"}],
              "user_roles": [{"user_id": "u1", "role": "applicant"}],
              "reviewer_profiles": [], "batches": []})
    _wire(monkeypatch, sb)
    monkeypatch.setattr(admin_users, "get_email_service",
                        lambda: SimpleNamespace(send_reviewer_invite=lambda **k: None))
    body = admin_users.CreateUserRequest(email="u@x.in", full_name="U",
                                         roles=["reviewer", "jury"], send_invite=False)
    out = await admin_users.create_user(body, current_user=ADMIN)
    held = {r["role"] for r in sb.tables["user_roles"] if r["user_id"] == "u1"}
    assert {"reviewer", "jury"} <= held and "jury" in out["roles"]


# ── S2-ADM-07 ────────────────────────────────────────────────────────────
def test_admin_cannot_deactivate_own_account(client, monkeypatch):
    fake = _SB({"profiles": [{"id": "admin-1", "email": "a@x.in"}],
                "user_roles": [{"user_id": "admin-1", "role": "admin"}]})
    fake.auth = MagicMock()
    _wire(monkeypatch, fake)
    fastapi_app.dependency_overrides[get_current_user] = lambda: dict(ADMIN, track=None)
    r = client.post("/admin/users/admin-1/deactivate")
    assert r.status_code == 400, r.text
    fake.auth.admin.update_user_by_id.assert_not_called()


def test_admin_can_deactivate_someone_else(client, monkeypatch):
    fake = _SB({"profiles": [{"id": "u2", "email": "u@x.in"}],
                "user_roles": [{"user_id": "admin-1", "role": "admin"}]})
    fake.auth = MagicMock()
    _wire(monkeypatch, fake)
    fastapi_app.dependency_overrides[get_current_user] = lambda: dict(ADMIN, track=None)
    assert client.post("/admin/users/u2/deactivate").status_code == 200


# ── S2-ADM-15 ────────────────────────────────────────────────────────────
async def test_revoke_reviewer_cleans_assignments_and_batch_membership(monkeypatch):
    sb = _SB(_world())
    _wire(monkeypatch, sb)
    await admin_users.revoke_role("R", "reviewer", current_user=ADMIN)
    assert not [a for a in sb.tables["reviewer_assignments"] if a["reviewer_user_id"] == "R"]
    assert not [b for b in sb.tables["batch_reviewers"] if b["reviewer_user_id"] == "R"]
    assert not [r for r in sb.tables["user_roles"] if r["user_id"] == "R"]


# ── S2-ADM-40 / S2-ADM-67 ────────────────────────────────────────────────
async def test_revoke_admin_from_non_admin_is_noop_not_409(monkeypatch):
    audits: list = []
    sb = _SB({"user_roles": [{"user_id": "admin-1", "role": "admin"},
                             {"user_id": "O", "role": "reviewer"}]})
    _wire(monkeypatch, sb, audits)
    out = await admin_users.revoke_role("O", "admin", current_user=ADMIN)
    assert out["ok"] is True and audits == []
    assert any(r["user_id"] == "admin-1" for r in sb.tables["user_roles"])


async def test_revoke_last_admin_still_blocked(monkeypatch):
    sb = _SB({"user_roles": [{"user_id": "admin-1", "role": "admin"}]})
    _wire(monkeypatch, sb)
    with pytest.raises(HTTPException) as e:
        await admin_users.revoke_role("admin-1", "admin", current_user=ADMIN)
    assert e.value.status_code == 409


# ── S2-ADM-19 / S2-ADM-63 ────────────────────────────────────────────────
async def test_reviewer_email_change_fails_loudly_and_writes_nothing(monkeypatch):
    sb = _SB(_world(), auth=_Auth(fail="auth boom"))
    _wire(monkeypatch, sb)
    body = admin_platform.ReviewerProfileBody(email="new@x.in")
    with pytest.raises(HTTPException) as e:
        await admin_platform.update_reviewer_profile("R", body, user=ADMIN)
    assert e.value.status_code == 502
    assert sb.tables["profiles"][0]["email"] == "r@x.in"


async def test_reviewer_email_change_success_syncs_auth(monkeypatch):
    sb = _SB(_world())
    _wire(monkeypatch, sb)
    await admin_platform.update_reviewer_profile(
        "R", admin_platform.ReviewerProfileBody(email="new@x.in"), user=ADMIN)
    assert sb.tables["profiles"][0]["email"] == "new@x.in"
    assert sb.auth.updates and sb.auth.updates[0][1]["email"] == "new@x.in"


async def test_reviewer_edit_rejects_invalid_email_and_non_reviewer(monkeypatch):
    sb = _SB(_world())
    _wire(monkeypatch, sb)
    with pytest.raises(HTTPException) as e:
        await admin_platform.update_reviewer_profile(
            "R", admin_platform.ReviewerProfileBody(email="not-an-email"), user=ADMIN)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        await admin_platform.update_reviewer_profile(
            "admin-1", admin_platform.ReviewerProfileBody(full_name="X"), user=ADMIN)
    assert e.value.status_code == 404
    assert sb.tables["reviewer_profiles"] == []


# ── S2-ADM-41 ────────────────────────────────────────────────────────────
async def test_update_meta_404_for_unknown_application(monkeypatch):
    sb = _SB({"tir_applications": [{"id": "X"}], "sip_applications": [],
              "application_admin_meta": []})
    _wire(monkeypatch, sb)
    body = admin_platform.MetaBody(is_hidden=True)
    with pytest.raises(HTTPException) as e:
        await admin_platform.update_meta("tir", "ghost", body, user=ADMIN)
    assert e.value.status_code == 404
    assert sb.tables["application_admin_meta"] == []
    await admin_platform.update_meta("tir", "X", body, user=ADMIN)
    assert len(sb.tables["application_admin_meta"]) == 1


# ── S2-ADM-69 ────────────────────────────────────────────────────────────
async def test_bulk_assign_and_remove_audit_carry_triples(monkeypatch):
    audits: list = []
    w = _world()
    w["reviewer_assignments"] = []
    w["tir_applications"] = [{"id": "X", "status": "submitted"}]
    sb = _SB(w)
    _wire(monkeypatch, sb, audits)
    body = admin_platform.ReviewerAppsBody.model_validate(
        {"items": [{"application_id": "X", "track": "tir"}]})
    await admin_platform.bulk_assign_reviewer_applications("R", body, user=ADMIN)
    await admin_platform.bulk_remove_reviewer_applications("R", body, user=ADMIN)
    by = {a["action_type"]: a for a in audits}
    assert by["reviewer.bulk_assigned"]["after"]["created"] == [{"application_id": "X", "track": "tir"}]
    assert by["reviewer.bulk_removed"]["before"]["removed"] == [{"application_id": "X", "track": "tir"}]


# ── S2-SH-01 ─────────────────────────────────────────────────────────────
def test_logout_revokes_callers_own_token_not_shared_anon_session(client, monkeypatch):
    anon, admin = MagicMock(), MagicMock()
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: admin)
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "user-B", "email": "b@x.in", "track": None, "roles": []}
    r = client.post("/auth/logout", headers={"Authorization": "Bearer USER_B-token"})
    assert r.status_code == 200
    admin.auth.admin.sign_out.assert_called_once_with("USER_B-token", "global")
    anon.auth.sign_out.assert_not_called()


# ── S2-SH-05 ─────────────────────────────────────────────────────────────
def test_lockout_is_per_email_and_ip(client, monkeypatch):
    anon = MagicMock()
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: MagicMock())
    ip = {"v": "1.1.1.1"}
    monkeypatch.setattr(auth_mod, "_client_ip", lambda request: ip["v"])
    anon.auth.sign_in_with_password.side_effect = Exception("Invalid login credentials")
    for _ in range(5):
        assert client.post("/auth/sign-in-password",
                           json={"email": "victim@artpark.in", "password": "wrongpass1"}).status_code == 401
    assert client.post("/auth/sign-in-password",
                       json={"email": "victim@artpark.in", "password": "wrongpass1"}).status_code == 429
    ip["v"] = "2.2.2.2"   # the real owner, different IP
    anon.auth.sign_in_with_password.side_effect = None
    anon.auth.sign_in_with_password.return_value = SimpleNamespace(
        session=SimpleNamespace(access_token="a" * 20, refresh_token="r" * 20),
        user=SimpleNamespace(id="v", email="victim@artpark.in"))
    r = client.post("/auth/sign-in-password",
                    json={"email": "victim@artpark.in", "password": "Correct#Pass1"})
    assert r.status_code == 200, r.text


def test_verify_otp_lockout_is_per_email_and_ip(client, monkeypatch):
    anon = MagicMock()
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: MagicMock())
    ip = {"v": "1.1.1.1"}
    monkeypatch.setattr(auth_mod, "_client_ip", lambda request: ip["v"])
    anon.auth.verify_otp.side_effect = Exception("bad")
    for _ in range(5):
        client.post("/auth/verify-otp", json={"email": "victim@artpark.in", "token": "000000"})
    ip["v"] = "2.2.2.2"
    anon.auth.verify_otp.side_effect = None
    anon.auth.verify_otp.return_value = SimpleNamespace(
        session=SimpleNamespace(access_token="a" * 20, refresh_token="r" * 20),
        user=SimpleNamespace(id="v", email="victim@artpark.in"))
    r = client.post("/auth/verify-otp", json={"email": "victim@artpark.in", "token": "123456"})
    assert r.status_code == 200, r.text


# ── S2-SH-14 ─────────────────────────────────────────────────────────────
def test_get_contact_auth_fallback_uses_get_user_by_id():
    class Admin:
        def get_user_by_id(self, uid):
            return SimpleNamespace(user=SimpleNamespace(email="real@x.com"))
    sb = FakeSupabase({"profiles": [{"id": "u1", "email": None, "full_name": None}]})
    sb.auth = SimpleNamespace(admin=Admin())
    assert user_lookup.get_contact(sb, "u1") == {"email": "real@x.com", "name": "real@x.com"}


# ── S2-SH-18 ─────────────────────────────────────────────────────────────
def test_role_fetch_failure_is_logged(client, monkeypatch, caplog):
    from app import deps

    class Admin:
        auth = SimpleNamespace(get_user=lambda tok: SimpleNamespace(
            user=SimpleNamespace(id="staff-1", email="s@artpark.in")))

        def table(self, name):
            if name == "user_roles":
                raise RuntimeError("PostgREST 503")
            return FakeSupabase({"profiles": [{"id": "staff-1", "track": "tir"}]}).table(name)

    monkeypatch.setattr(deps, "get_admin_client", lambda: Admin())
    with caplog.at_level("WARNING"):
        client.get("/leadership/stats", headers={"Authorization": "Bearer x"})
    assert any("user_roles fetch failed" in r.getMessage() for r in caplog.records)


# ── S2-SH-19 ─────────────────────────────────────────────────────────────
def test_set_password_same_password_is_422_not_500(client, monkeypatch):
    admin = MagicMock()
    admin.auth.admin.get_user_by_id.return_value = SimpleNamespace(user=SimpleNamespace(app_metadata={}))
    admin.auth.admin.update_user_by_id.side_effect = Exception(
        "New password should be different from the old password.")
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: admin)
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u", "email": "u@x.com", "track": None, "roles": []}
    r = client.post("/auth/set-password", json={"password": "Same#Pass1"},
                    headers={"Authorization": "Bearer t"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "same_password"


# ── S2-SH-21 ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("tir,sip,expected", [(True, True, False), (True, False, True),
                                              (False, True, True), (False, False, True)])
def test_request_otp_without_track_respects_closed_intake(client, monkeypatch, tir, sip, expected):
    from app.config import settings
    monkeypatch.setattr(settings, "tir_submissions_closed", tir)
    monkeypatch.setattr(settings, "sip_submissions_closed", sip)
    anon = MagicMock()
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    r = client.post("/auth/request-otp", json={"email": "brand-new@gmail.com"})
    assert r.status_code == 200
    opts = anon.auth.sign_in_with_otp.call_args[0][0]["options"]
    assert opts["should_create_user"] is expected


# ── S2-SH-22 ─────────────────────────────────────────────────────────────
def test_jury_accept_does_not_reset_staff_password():
    admin = MagicMock()
    sb = FakeSupabase({"profiles": [{"id": "adm", "email": "a@x.in"}],
                       "user_roles": [{"user_id": "adm", "role": "admin"}]})
    sb.auth = admin.auth
    uid, created, pw = jury_invites._ensure_jury_account(
        sb, {"email": "a@x.in", "name": "A"}, reset_password=True)
    assert uid == "adm" and not created and pw is None
    admin.auth.admin.update_user_by_id.assert_not_called()


def test_jury_accept_still_resets_plain_account_password():
    admin = MagicMock()
    sb = FakeSupabase({"profiles": [{"id": "p", "email": "p@x.in"}], "user_roles": []})
    sb.auth = admin.auth
    _, _, pw = jury_invites._ensure_jury_account(
        sb, {"email": "p@x.in", "name": "P"}, reset_password=True)
    assert pw
    admin.auth.admin.update_user_by_id.assert_called_once()


# ── fix round: S2-SH-05 per-email ceiling, S2-ADM-15 audit triples ───────
def test_ip_rotation_hits_per_email_ceiling(client, monkeypatch):
    anon = MagicMock()
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: MagicMock())
    ip = {"v": ""}
    monkeypatch.setattr(auth_mod, "_client_ip", lambda request: ip["v"])
    anon.auth.sign_in_with_password.side_effect = Exception("Invalid login credentials")
    codes = []
    for n in range(7):          # 7 IPs x 5 failures = 35 > ceiling of 30
        ip["v"] = f"9.9.9.{n}"
        for _ in range(5):
            codes.append(client.post("/auth/sign-in-password",
                         json={"email": "victim@artpark.in", "password": "wrongpass1"}).status_code)
    assert codes[:30] == [401] * 30
    assert 429 in codes[30:]


def test_ip_rotation_hits_per_email_ceiling_otp(client, monkeypatch):
    anon = MagicMock()
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: MagicMock())
    ip = {"v": ""}
    monkeypatch.setattr(auth_mod, "_client_ip", lambda request: ip["v"])
    anon.auth.verify_otp.side_effect = Exception("bad")
    codes = []
    for n in range(7):
        ip["v"] = f"8.8.8.{n}"
        for _ in range(5):
            codes.append(client.post("/auth/verify-otp",
                         json={"email": "victim@artpark.in", "token": "000000"}).status_code)
    assert 429 in codes[30:]


async def test_revoke_reviewer_audit_records_deleted_triples(monkeypatch):
    audits: list = []
    sb = _SB(_world())
    expected = [{"application_id": a["application_id"], "track": a["application_track"]}
                for a in sb.tables["reviewer_assignments"] if a["reviewer_user_id"] == "R"]
    _wire(monkeypatch, sb, audits)
    await admin_users.revoke_role("R", "reviewer", current_user=ADMIN)
    rec = [a for a in audits if a["action_type"] == "role.revoked"][0]
    assert rec["before"]["role"] == "reviewer"
    assert rec["before"]["removed"] == expected
