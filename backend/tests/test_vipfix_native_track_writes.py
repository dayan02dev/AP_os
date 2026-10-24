"""Writes must be keyed by NATIVE track (the table the row lives in)."""
from app.routers import admin_platform
from app.services import admin_query, applications_query, batch_membership, state_machine
from tests.fixtures.fake_supabase import FakeSupabase

_real_advance_many = batch_membership.advance_many
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
    monkeypatch.setattr(batch_membership, "advance_many", lambda *a, **k: [])


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
    monkeypatch.setattr(batch_membership, "advance_many", _real_advance_many)
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
    monkeypatch.setattr(batch_membership, "advance_many", lambda sb, keys, changed_by=None: adv.extend(keys))
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


def test_delete_batch_detaches_members_but_keeps_other_batch_supply(monkeypatch):
    import asyncio
    sb = FakeSupabase({
        "batches": [{"id": "A", "name": "A"}, {"id": "B", "name": "B"}],
        "batch_reviewers": [{"batch_id": "A", "reviewer_user_id": "r1"},
                            {"batch_id": "B", "reviewer_user_id": "r1"},
                            {"batch_id": "A", "reviewer_user_id": "r2"}],
        "application_batches": [
            {"application_id": "x", "application_track": "sip", "batch_id": "A"},
            {"application_id": "x", "application_track": "sip", "batch_id": "B"},
            {"application_id": "y", "application_track": "sip", "batch_id": "A"}],
        "reviewer_assignments": [
            {"application_id": a, "application_track": "sip", "reviewer_user_id": r}
            for a in ("x", "y") for r in ("r1", "r2")],
        "reviewer_profiles": [],
    })
    monkeypatch.setattr(admin_platform, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_platform, "write_audit", lambda *a, **k: None)
    out = asyncio.run(admin_platform.delete_batch("A", user=USER))
    left = {(a["application_id"], a["reviewer_user_id"]) for a in sb.tables["reviewer_assignments"]}
    assert left == {("x", "r1")}  # r1 still supplied on x by batch B
    assert out["assignments_removed"] == 3
    assert not [m for m in sb.tables["batch_reviewers"] if m["batch_id"] == "A"]


def test_invite_template_without_password():
    from app.services.email_service import EmailService
    sent = {}
    svc = EmailService()
    svc.send_raw = lambda to, subject, html, text, **k: sent.update(html=html, text=text) or {}
    svc.send_reviewer_invite(to="a@x", reviewer_name="A", login_email="a@x",
                             temp_password=None, inbox_url="https://x")
    assert "existing ARTPARK account" in sent["html"] and "Password:" not in sent["html"]
    assert "existing ARTPARK account" in sent["text"] and "Password:" not in sent["text"]


def _bm_db():
    return FakeSupabase({
        "batch_reviewers": [{"batch_id": "A", "reviewer_user_id": "r1"}],
        "application_batches": [
            {"application_id": a, "application_track": "sip", "batch_id": "A"} for a in ("x", "y")],
        "reviewer_assignments": [
            {"application_id": a, "application_track": "sip", "reviewer_user_id": "r1"} for a in ("x", "y")],
        "reviews": [{"application_id": "x", "application_track": "sip", "reviewer_user_id": "r1",
                     "submitted_at": None, "status": "draft"}],
    })


def test_remove_reviewer_keeps_draft_assignment_and_reports_triples():
    sb = _bm_db()
    res = batch_membership.remove_reviewer_from_batch(sb, "A", "r1", actor="adm")
    assert res["kept_draft"] == 1 and res["removed"] == 1
    assert res["deleted"] == [{"application_id": "y", "application_track": "sip", "reviewer_user_id": "r1"}]
    assert [a["application_id"] for a in sb.tables["reviewer_assignments"]] == ["x"]


def test_remove_app_keeps_draft_and_submitted_does_not_protect():
    sb = _bm_db()
    sb.tables["reviews"].append({"application_id": "y", "application_track": "sip",
                                 "reviewer_user_id": "r1", "submitted_at": "t", "status": "submitted"})
    a = batch_membership.remove_app_from_batch(sb, "A", "x", "sip", actor="adm")
    b = batch_membership.remove_app_from_batch(sb, "A", "y", "sip", actor="adm")
    assert a["kept_draft"] == 1 and a["assignments_removed"] == 0
    assert b["assignments_removed"] == 1 and b["kept_draft"] == 0


def test_delete_batch_audit_has_triples(monkeypatch):
    import asyncio
    sb = _bm_db()
    sb.tables["batches"] = [{"id": "A", "name": "A"}]
    sb.tables["reviewer_profiles"] = []
    audits = []
    monkeypatch.setattr(admin_platform, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_platform, "write_audit", lambda **k: audits.append(k))
    asyncio.run(admin_platform.delete_batch("A", user=USER))
    after = audits[-1]["after"]
    assert after["kept_draft"] == 1 and after["truncated"] is False
    assert after["deleted_assignments"] == [
        {"application_id": "y", "application_track": "sip", "reviewer_user_id": "r1"}]


def test_reserved_batch_names_rejected():
    import pytest
    from fastapi import HTTPException
    for n in ("Unassigned", " ALL ", "Random Allotment", "new", "unbatched"):
        with pytest.raises(HTTPException) as e:
            admin_platform._check_batch_name_reserved(n)
        assert e.value.detail["code"] == "batch_name_reserved"
    admin_platform._check_batch_name_reserved("Defense")


def test_resolve_ex_lookup_failures(monkeypatch):
    import pytest
    sb = _db()
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    orig = sb.table

    def one_fails(name):
        if name == "sip_applications":
            raise RuntimeError("down")
        return orig(name)

    sb.table = one_fails
    native, missing, uncertain = applications_query.resolve_native_tracks_ex(
        [("moved1", "sip"), ("ghost", "sip")])
    assert native["moved1"] == "tir" and uncertain == {"ghost"} and missing == set()

    def both_fail(name):
        raise RuntimeError("down")

    sb.table = both_fail
    with pytest.raises(applications_query.NativeTrackLookupFailed):
        applications_query.resolve_native_tracks_ex([("a", "tir")])


def test_project_names_lookup_is_chunked(monkeypatch):
    sb = FakeSupabase({"ai_screening": []})
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    seen = []
    orig = sb.table

    def spy(name):
        q = orig(name)
        oi = q.in_
        q.in_ = lambda c, v: (seen.append(len(v)), oi(c, v))[1]
        return q

    sb.table = spy
    applications_query.fetch_project_names_for([("tir", f"i{n}") for n in range(400)])
    assert seen and max(seen) <= 150
