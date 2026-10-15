"""Admin trigger + status API for VIP memo generation."""
import pytest
from app.deps import get_current_user
from app.main import app
from fastapi.testclient import TestClient

from tests.fixtures.fake_supabase import FakeSupabase

SIP = "11111111-1111-1111-1111-111111111111"
TIR = "22222222-2222-2222-2222-222222222222"
DRAFT = "33333333-3333-3333-3333-333333333333"
MOVED = "44444444-4444-4444-4444-444444444444"


def _user(roles, uid="admin-1"):
    return lambda: {"user_id": uid, "email": "a@artpark.in", "roles": roles, "track": None}


@pytest.fixture
def env(monkeypatch):
    fake = FakeSupabase({
        "sip_applications": [
            {"id": SIP, "status": "submitted", "moved_to_track": None},
            {"id": DRAFT, "status": "draft", "moved_to_track": None},
        ],
        "tir_applications": [
            {"id": TIR, "status": "submitted", "moved_to_track": None},
            {"id": MOVED, "status": "under_review", "moved_to_track": "sip"},
        ],
    })
    published: list[str] = []
    result = {"ok": True}

    def _pub(memo_id):
        published.append(memo_id)
        return result["ok"]

    monkeypatch.setattr("app.routers.admin_platform.get_admin_client", lambda: fake)
    monkeypatch.setattr("app.services.vip_memo_v2.get_admin_client", lambda: fake)
    monkeypatch.setattr("app.routers.admin_platform.publish_vip_memo", _pub)
    app.dependency_overrides[get_current_user] = _user(["admin"])
    yield fake, published, result
    app.dependency_overrides.clear()


def post(ids, force=False):
    return TestClient(app).post("/admin/platform/vip-memos/generate",
                                json={"application_ids": ids, "force": force})


def test_generate_requires_capability(env):
    app.dependency_overrides[get_current_user] = _user(["leadership"])
    assert post([SIP]).status_code == 403


def test_generate_enqueues_and_creates_version(env):
    fake, published, _ = env
    r = post([SIP])
    assert r.status_code == 200
    res = r.json()["results"][0]
    assert res["application_id"] == SIP and res["status"] == "queued"
    row = fake.tables["vip_memos"][0]
    assert row["id"] == res["memo_id"] == published[0]
    assert (row["native_track"], row["version"], row["triggered_by"]) == ("sip", 1, "admin-1")


def test_generate_skips_ready_unless_force(env):
    fake, published, _ = env
    fake.tables["vip_memos"] = [{"id": "m1", "application_id": SIP, "native_track": "sip",
                                 "version": 1, "status": "ready", "is_current": True}]
    assert post([SIP]).json()["results"] == [{"application_id": SIP, "skipped": "already_ready"}]
    assert published == []
    res = post([SIP], force=True).json()["results"][0]
    assert res["status"] == "queued"
    assert [m["version"] for m in fake.tables["vip_memos"]] == [1, 2]


def test_generate_rejects_tir_and_draft(env):
    _, published, _ = env
    res = post([TIR, DRAFT, "nope"]).json()["results"]
    assert res == [{"application_id": i, "skipped": "not_eligible"} for i in (TIR, DRAFT, "nope")]
    assert published == []


def test_generate_moved_tir_to_vip_is_eligible(env):
    fake, _, _ = env
    res = post([MOVED]).json()["results"][0]
    assert res["status"] == "queued"
    assert fake.tables["vip_memos"][0]["native_track"] == "tir"


def test_generate_queue_unavailable_marks_failed(env):
    fake, _, result = env
    result["ok"] = False
    res = post([SIP]).json()["results"][0]
    assert res["status"] == "failed" and res["error"] == "queue_unavailable"
    row = fake.tables["vip_memos"][0]
    assert row["status"] == "failed" and row["error"] == "queue_unavailable"


def test_status_lists_versions(env):
    fake, _, _ = env
    fake.tables["vip_memos"] = [
        {"id": "m1", "application_id": SIP, "version": 1, "status": "failed", "is_current": False,
         "cost_usd": 0.2, "error": "x", "created_at": "t1", "updated_at": "t2", "memo_json": {"s": 1}},
        {"id": "m2", "application_id": SIP, "version": 2, "status": "ready", "is_current": True,
         "cost_usd": 0.5, "error": None, "created_at": "t3", "updated_at": "t4"},
        {"id": "m3", "application_id": TIR, "version": 1, "status": "ready", "is_current": True},
    ]
    r = TestClient(app).get(f"/admin/platform/vip-memos?application_id={SIP}")
    assert r.status_code == 200
    memos = r.json()["memos"]
    assert [m["id"] for m in memos] == ["m2", "m1"]
    assert set(memos[0]) == {"id", "version", "status", "is_current", "cost_usd", "error",
                             "created_at", "updated_at"}
    app.dependency_overrides[get_current_user] = _user(["leadership"])
    assert TestClient(app).get(f"/admin/platform/vip-memos?application_id={SIP}").status_code == 403


def test_body_limit_25(env):
    assert post([f"id-{i}" for i in range(26)]).status_code == 422
    assert post([]).status_code == 422
