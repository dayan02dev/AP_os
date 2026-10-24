"""Writes must be keyed by NATIVE track (the table the row lives in)."""
from app.routers import admin_platform
from app.services import admin_query, applications_query, batch_membership, state_machine
from tests.fixtures.fake_supabase import FakeSupabase

USER = {"user_id": "admin", "roles": ["admin"]}


class _Item:
    def __init__(self, a, t):
        self.application_id, self.track = a, t


class _Body:
    def __init__(self, items):
        self.items = [_Item(a, t) for a, t in items]


def _db():
    return FakeSupabase({
        "batches": [{"id": "A", "name": "Defense"}],
        "batch_reviewers": [{"batch_id": "A", "reviewer_user_id": "r1"}],
        "application_batches": [],
        "reviewer_assignments": [],
        "reviews": [],
        "tir_applications": [{"id": "moved1", "status": "submitted", "moved_to_track": "sip"}],
        "sip_applications": [{"id": "vip1", "status": "submitted"}],
    })


def _patch(monkeypatch, sb):
    monkeypatch.setattr(admin_platform, "get_admin_client", lambda: sb)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_platform, "notify_reviewers_assigned", lambda *a, **k: 0)
    monkeypatch.setattr(admin_platform, "write_audit", lambda *a, **k: None)
    monkeypatch.setattr(batch_membership, "_advance", lambda *a, **k: None)


def test_resolve_native_tracks(monkeypatch):
    sb = _db()
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    out = applications_query.resolve_native_tracks(
        [("moved1", "sip"), ("vip1", "sip"), ("ghost", "tir")]
    )
    assert out == {"moved1": "tir", "vip1": "sip", "ghost": "tir"}


def test_resolve_native_tracks_chunks(monkeypatch):
    sb = FakeSupabase({"tir_applications": [], "sip_applications": []})
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    calls = []
    orig = sb.table

    def spy(name):
        q = orig(name)
        oi = q.in_
        q.in_ = lambda c, v: (calls.append(len(v)), oi(c, v))[1]
        return q

    sb.table = spy
    ids = [(f"i{n}", "tir") for n in range(400)]
    applications_query.resolve_native_tracks(ids)
    assert max(calls) <= 150


async def test_assign_applications_moved_app_keyed_native(monkeypatch):
    sb = _db()
    _patch(monkeypatch, sb)
    await admin_platform.assign_applications("A", _Body([("moved1", "sip")]), user=USER)
    assert [(r["application_id"], r["application_track"]) for r in sb.tables["application_batches"]] == [("moved1", "tir")]
    assert {(r["application_track"]) for r in sb.tables["reviewer_assignments"]} == {"tir"}


async def test_bulk_assign_reviewer_apps_moved_app_keyed_native(monkeypatch):
    sb = _db()
    _patch(monkeypatch, sb)
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_query, "_reviewer_user_ids", lambda: ["r1"])
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: sb)

    class B:
        items = [_Item("moved1", "sip")]
    res = await admin_platform.bulk_assign_reviewer_applications("r1", B(), user=USER)
    assert res["results"][0]["track"] == "tir"
    assert [(r["application_track"]) for r in sb.tables["reviewer_assignments"]] == ["tir"]
    assert "reviewers_notified" in res
    # best-effort advance fired
    assert sb.status_of("tir", "moved1") == "under_review"


def test_add_apps_bulk_upsert_and_advance_only_assigned(monkeypatch):
    sb = _db()
    sb.tables["batches"].append({"id": "EMPTY", "name": "Empty"})
    adv = []
    monkeypatch.setattr(batch_membership, "_advance", lambda a, t: adv.append((a, t)))
    upserts = []
    orig = sb.table

    def spy(name):
        q = orig(name)
        if name == "reviewer_assignments":
            ou = q.upsert
            q.upsert = lambda p, **k: (upserts.append(len(p)), ou(p, **k))[1]
        return q

    sb.table = spy
    batch_membership.add_apps_to_batch(sb, "A", [("moved1", "tir"), ("vip1", "sip")], actor="a")
    assert upserts == [2]  # one bulk call
    assert set(adv) == {("moved1", "tir"), ("vip1", "sip")}
    adv.clear()
    batch_membership.add_apps_to_batch(sb, "EMPTY", [("moved1", "tir")], actor="a")
    assert adv == []  # no reviewers -> no status flip
