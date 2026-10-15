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


def test_in_progress_skipped_unless_force(env):
    fake, published, _ = env
    for st in ("queued", "running"):
        fake.tables["vip_memos"] = [{"id": "m1", "application_id": SIP, "native_track": "sip",
                                     "version": 1, "status": st, "is_current": False}]
        assert post([SIP]).json()["results"] == [{"application_id": SIP, "skipped": "in_progress"}]
        assert published == []
        assert post([SIP], force=True).json()["results"][0]["status"] == "queued"
        published.clear()


def test_non_uuid_post_id_makes_no_db_query(env, monkeypatch):
    def boom(_):
        raise AssertionError("db queried")
    monkeypatch.setattr("app.services.vip_memo_v2.get_admin_client", boom)
    res = post(["not-a-uuid"]).json()["results"]
    assert res == [{"application_id": "not-a-uuid", "skipped": "not_eligible"}]


def test_status_non_uuid_is_422(env):
    assert TestClient(app).get("/admin/platform/vip-memos?application_id=zzz").status_code == 422


def test_one_failure_does_not_lose_batch(env, monkeypatch):
    from app.services.vip_memo_gen import store
    orig = store.create_memo_version

    def flaky(c, app_id, native, by):
        if app_id == SIP:
            raise RuntimeError("db down")
        return orig(c, app_id, native, by)
    monkeypatch.setattr("app.routers.admin_platform.vip_memo_store.create_memo_version", flaky)
    res = post([SIP, MOVED]).json()["results"]
    assert res[0] == {"application_id": SIP, "error": "create_failed"}
    assert res[1]["status"] == "queued"


def test_generate_writes_audit(env, monkeypatch):
    calls = []
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: calls.append(k))
    post([SIP], force=True)
    assert calls[0]["action_type"] == "vip_memo.generate_requested"
    assert calls[0]["actor_user_id"] == "admin-1"
    assert calls[0]["after"]["force"] is True and calls[0]["after"]["application_ids"] == [SIP]
    assert len(calls[0]["after"]["memo_ids"]) == 1


def _ago(hours):
    from datetime import UTC, datetime, timedelta
    return (datetime.now(UTC) - timedelta(hours=hours)).isoformat()


def test_stale_in_flight_row_is_superseded(env):
    fake, published, _ = env
    fake.tables["vip_memos"] = [{"id": "old", "application_id": SIP, "native_track": "sip",
                                 "version": 1, "status": "running", "is_current": False,
                                 "created_at": _ago(5), "updated_at": _ago(3)}]
    res = post([SIP]).json()["results"][0]
    assert res["status"] == "queued" and published == [res["memo_id"]]
    old = fake.row("vip_memos", "old")
    assert (old["status"], old["error"]) == ("failed", "superseded")


def test_fresh_in_flight_row_still_blocks(env):
    fake, published, _ = env
    fake.tables["vip_memos"] = [{"id": "new", "application_id": SIP, "native_track": "sip",
                                 "version": 1, "status": "queued", "is_current": False,
                                 "created_at": _ago(3), "updated_at": _ago(1)}]
    assert post([SIP]).json()["results"] == [{"application_id": SIP, "skipped": "in_progress"}]
    assert published == [] and fake.row("vip_memos", "new")["status"] == "queued"


def test_force_supersedes_fresh_in_flight_rows(env):
    fake, published, _ = env
    fake.tables["vip_memos"] = [{"id": "q", "application_id": SIP, "native_track": "sip",
                                 "version": 1, "status": "queued", "is_current": False,
                                 "updated_at": _ago(0.1)},
                                {"id": "r", "application_id": SIP, "native_track": "sip",
                                 "version": 2, "status": "ready", "is_current": True}]
    res = post([SIP], force=True).json()["results"][0]
    assert res["status"] == "queued"
    assert (fake.row("vip_memos", "q")["status"], fake.row("vip_memos", "q")["error"]) == (
        "failed", "superseded")
    assert fake.row("vip_memos", "r")["status"] == "ready"  # ready rows are not touched
