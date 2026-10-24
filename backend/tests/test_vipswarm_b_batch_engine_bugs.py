"""Bug-hunt tests: batch/assignment engine vs the rest of the system (VIP/sip).

Every test here asserts the CORRECT behaviour and is expected to FAIL on the
current code (each docstring names the bug).  `CappedFake` adds the real
PostgREST behaviours the shared fake no-ops: a 1000-row response cap and
working `.range()`.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.services import (
    admin_query, applications_query, batch_membership as bm, decisions,
    roster_removal, state_machine,
)
from tests.fixtures.fake_supabase import FakeSupabase, _Query


# ── fake with real-PostgREST cap/range + round-trip counter ────────────────
class _CappedQuery(_Query):
    def __init__(self, store, name, owner):
        super().__init__(store, name)
        self._owner = owner
        self._rng = None

    def range(self, a, b):
        self._rng = (a, b)
        return self

    def execute(self):
        self._owner.calls += 1
        res = super().execute()
        if self._mode == "select" and isinstance(res.data, list):
            data = res.data
            if self._rng:
                data = data[self._rng[0]: self._rng[1] + 1]
            data = data[:1000]  # PostgREST max-rows
            return SimpleNamespace(data=data, count=len(data))
        return res


class CappedFake(FakeSupabase):
    def __init__(self, tables=None):
        super().__init__(tables)
        self.calls = 0

    def table(self, name):
        return _CappedQuery(self.tables, name, self)


@pytest.fixture
def patch_clients(monkeypatch):
    def _do(sb):
        for mod in (decisions, state_machine, applications_query, admin_query):
            monkeypatch.setattr(mod, "get_admin_client", lambda sb=sb: sb)
        monkeypatch.setattr(decisions, "write_audit", lambda **k: None)
        monkeypatch.setattr(decisions.decision_email, "notify_applicant_decided",
                            lambda *a, **k: None)
        return sb
    return _do


# 1 ─ bulk_decide ignores the native-track overlay ─────────────────────────
def test_bulk_decide_rejects_moved_app_when_fe_sends_effective_track(patch_clients):
    """BUG: POST /decisions/bulk passes item.track straight to record_decision
    (no _native_track like /decision has).  The FE sends the EFFECTIVE track
    (row.track), so a TIR-native app moved to VIP is looked up in
    sip_applications -> per-id 'not_found'; the reject silently never happens."""
    from app.routers import admin_platform as ap
    sb = patch_clients(FakeSupabase({
        "tir_applications": [{"id": "a1", "status": "submitted", "moved_to_track": "sip"}],
        "sip_applications": [],
    }))
    body = ap.BulkDecisionBody(items=[ap.BulkDecisionItem(
        track="sip", application_id="a1", decision="rejected", rationale="no fit")])
    out = asyncio.run(ap.bulk_decide(body, {"user_id": "adm", "roles": ["admin"]}))
    assert out["results"][0]["status"] == "decided", out
    assert sb.status_of("tir", "a1") == "rejected"


# 2 ─ batch endpoints key rows by whatever track the FE sends ──────────────
def test_add_apps_to_batch_with_effective_track_creates_orphan_keys(monkeypatch):
    """BUG: assign_applications/add_apps_to_batch never resolves/validates the
    native track (FE sends effective `r.track`).  For a TIR-native app moved to
    VIP this writes application_batches + reviewer_assignments under
    ('a1','sip') - a key that exists in NO table.  advance_to_under_review is a
    no-op (app stays 'submitted'), the reviewer queue can't resolve it, and a
    later Gate-1 reject (native track 'tir') detaches nothing, so the orphan
    rows live forever."""
    sb = FakeSupabase({
        "batch_reviewers": [{"batch_id": "B", "reviewer_user_id": "r1"}],
        "tir_applications": [{"id": "a1", "status": "submitted", "moved_to_track": "sip"}],
        "sip_applications": [], "reviewer_assignments": [],
    })
    monkeypatch.setattr(bm, "_advance", lambda *a, **k: None)
    res = bm.add_apps_to_batch(sb, "B", [("a1", "sip")], actor="adm")
    keys = {(r["application_id"], r["application_track"]) for r in sb.tables["reviewer_assignments"]}
    assert ("a1", "sip") not in keys, "assignment created for an app that does not exist in sip_applications"


def test_gate1_reject_of_moved_app_leaves_orphans_from_effective_track_assign(patch_clients, monkeypatch):
    """Consequence of #2: reject via native track leaves effective-keyed rows."""
    sb = patch_clients(FakeSupabase({
        "batch_reviewers": [{"batch_id": "B", "reviewer_user_id": "r1"}],
        "tir_applications": [{"id": "a1", "status": "submitted", "moved_to_track": "sip"}],
        "sip_applications": [],
    }))
    monkeypatch.setattr(bm, "_advance", lambda *a, **k: None)
    bm.add_apps_to_batch(sb, "B", [("a1", "sip")], actor="adm")   # what the FE does
    decisions.record_decision(track="tir", application_id="a1", decision="rejected",
                              rationale="x", decided_by="adm")   # what /decision does
    assert sb.tables["reviewer_assignments"] == []
    assert sb.tables.get("application_batches", []) == []


# 3 ─ assigning to non-reviewable apps ─────────────────────────────────────
@pytest.mark.parametrize("st", ["rejected", "jury_review", "withdrawn", "offered"])
def test_add_apps_to_batch_skips_closed_apps(monkeypatch, st):
    """BUG: add_apps_to_batch / assign_reviewers_to_batch / drawer bulk-assign /
    leadership assign never look at app status.  A rejected / jury_review app
    gets new assignments and the reviewer is e-mailed ('you've been assigned')
    for an app that already left review."""
    sb = FakeSupabase({
        "batch_reviewers": [{"batch_id": "B", "reviewer_user_id": "r1"}],
        "sip_applications": [{"id": "a1", "status": st}],
    })
    monkeypatch.setattr(bm, "_advance", lambda *a, **k: None)
    res = bm.add_apps_to_batch(sb, "B", [("a1", "sip")], actor="adm")
    assert res["assignments_created"] == 0


# 4 ─ drawer bulk assign never advances submitted -> under_review ──────────
def test_drawer_bulk_assign_advances_status(patch_clients, monkeypatch):
    """BUG: admin_query.bulk_assign_reviewer_apps (POST /reviewers/{id}/applications)
    and rebalance never call advance_to_under_review_on_assignment, unlike the
    batch + leadership paths.  App stays 'submitted' although assigned."""
    sb = patch_clients(FakeSupabase({
        "user_roles": [{"user_id": "r1", "role": "reviewer"}],
        "sip_applications": [{"id": "a1", "status": "submitted"}],
        "reviewer_assignments": [],
    }))
    out = admin_query.bulk_assign_reviewer_apps("r1", [{"application_id": "a1", "track": "sip"}], "adm")
    assert out["results"][0]["status"] == "created"
    assert sb.status_of("sip", "a1") == "under_review"


# 5 ─ rebalance: cap + non-reviewable statuses ─────────────────────────────
def test_rebalance_skips_rejected_and_jury_review(patch_clients):
    """BUG: fetch_unassigned_apps only skips 'draft', so rebalance assigns
    (and e-mails) rejected / jury_review / offered / withdrawn apps."""
    patch_clients(FakeSupabase({
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [
            {"id": "ok", "status": "submitted"},
            {"id": "rej", "status": "rejected"},
            {"id": "jury", "status": "jury_review"},
            {"id": "off", "status": "offered"},
        ],
    }))
    ids = {a["application_id"] for a in admin_query.fetch_unassigned_apps("sip")}
    assert ids == {"ok"}


def test_rebalance_unassigned_scan_survives_1000_row_cap(patch_clients):
    """BUG (1000-row cap): fetch_unassigned_apps does an unpaginated
    select('*') on reviewer_assignments (prod >3000 rows) and on
    sip_/tir_applications.  Everything past row 1000 looks 'unassigned', so
    rebalance re-assigns already-assigned apps (plain insert -> 23505 500 or
    duplicate reviewers) ."""
    apps = [{"id": f"a{i}", "status": "under_review"} for i in range(1200)]
    filler = [{"application_id": f"f{i}", "application_track": "tir",
               "reviewer_user_id": "r1", "declined_at": None, "reassigned_to": None}
              for i in range(1000)]
    asg = filler + [{"application_id": f"a{i}", "application_track": "sip",
            "reviewer_user_id": "r1", "declined_at": None, "reassigned_to": None}
           for i in range(1200)]
    patch_clients(CappedFake({"sip_applications": apps, "tir_applications": [],
                              "reviewer_assignments": asg}))
    assert admin_query.fetch_unassigned_apps("sip") == []


# 6 ─ paginated reads over 1000 ────────────────────────────────────────────
def test_remove_reviewer_from_batch_handles_batch_over_1000_apps():
    """BUG: apps_in_batch is unpaginated -> only the first 1000 apps of a big
    batch are processed; the reviewer keeps assignments on the rest after being
    'removed' from the batch."""
    n = 1100
    sb = CappedFake({
        "batch_reviewers": [{"batch_id": "B", "reviewer_user_id": "r1"}],
        "application_batches": [{"application_id": f"a{i}", "application_track": "sip",
                                 "batch_id": "B"} for i in range(n)],
        "reviewer_assignments": [{"application_id": f"a{i}", "application_track": "sip",
                                  "reviewer_user_id": "r1"} for i in range(n)],
    })
    bm.remove_reviewer_from_batch(sb, "B", "r1", actor="adm")
    assert sb.tables["reviewer_assignments"] == []


def test_has_submitted_review_unpaginated_select_star():
    """BUG: has_submitted_review reads select('*') of ALL the reviewer's reviews
    (capped at 1000) and filters in Python; a protected review beyond row 1000
    is missed and remove_app_from_batch deletes a reviewed assignment."""
    rev = [{"application_id": f"a{i}", "application_track": "sip", "reviewer_user_id": "r1",
            "status": "draft"} for i in range(1000)]
    rev.append({"application_id": "target", "application_track": "sip",
                "reviewer_user_id": "r1", "status": "submitted", "submitted_at": "t"})
    sb = CappedFake({"reviews": rev})
    assert bm.has_submitted_review(sb, "target", "sip", "r1") is True


# 7 ─ round trips vs 29 s Lambda ───────────────────────────────────────────
def _big_assignments(n=3200):
    return [{"application_id": f"x{i}", "application_track": "tir", "reviewer_user_id": "other",
             "declined_at": None, "reassigned_to": None} for i in range(n)]


def test_add_40_apps_4_reviewers_round_trips(patch_clients):
    """BUG (perf): _ensure_assignment upserts ONE row per HTTP call
    (apps x reviewers = 160 calls) + full-table assignment scan (4 pages) +
    3-4 calls per app for the status advance.  ~250+ sequential calls; at
    ~80 ms RTT that is ~20 s, and BatchAssign allows 500 apps (2000+ calls ->
    guaranteed 29 s timeout).  Budget asserted: <= 40 calls."""
    apps = [{"id": f"a{i}", "status": "submitted"} for i in range(40)]
    sb = patch_clients(CappedFake({
        "batch_reviewers": [{"batch_id": "B", "reviewer_user_id": f"r{i}"} for i in range(4)],
        "sip_applications": apps, "reviewer_assignments": _big_assignments(),
    }))
    sb.calls = 0
    bm.add_apps_to_batch(sb, "B", [(a["id"], "sip") for a in apps], actor="adm")
    assert sb.calls <= 40, f"{sb.calls} sequential PostgREST calls"


def test_remove_reviewer_from_40_app_batch_round_trips():
    """BUG (perf): per app: app_batch_ids + (batch_reviewers per other batch) +
    DELETE = >=2-3 calls/app; unbounded for big batches."""
    sb = CappedFake({
        "batch_reviewers": [{"batch_id": "B", "reviewer_user_id": "r1"}],
        "application_batches": [{"application_id": f"a{i}", "application_track": "sip",
                                 "batch_id": b} for i in range(40) for b in ("B", "C")],
        "reviewer_assignments": [{"application_id": f"a{i}", "application_track": "sip",
                                  "reviewer_user_id": "r1"} for i in range(40)],
    })
    sb.calls = 0
    bm.remove_reviewer_from_batch(sb, "B", "r1", actor="adm")
    assert sb.calls <= 10, f"{sb.calls} sequential PostgREST calls"


# 8 ─ assignment e-mail .in_ URL length ────────────────────────────────────
def test_assignment_email_in_filter_is_chunked():
    """BUG: _fetch_app_names does .in_('id', ids) with ALL created ids (up to
    500 uuids ~ 19 KB URL) -> 414/400 from PostgREST/API-GW, swallowed, so
    reviewers get 'ab12cd34' instead of names.  Should chunk (<= ~100)."""
    from app.services import assignment_email as ae
    seen = []

    class Q:
        def select(self, *a): return self
        def in_(self, c, ids): seen.append(len(ids)); return self
        def execute(self): return SimpleNamespace(data=[])

    class SB:
        def table(self, n): return Q()

    ids = [f"{i:08d}-0000-0000-0000-000000000000" for i in range(500)]
    ae._fetch_app_names(SB(), [{"application_id": i, "application_track": "sip"} for i in ids])
    assert max(seen) <= 100


# 9 ─ reviewer invite on an existing account ───────────────────────────────
class _AuthAdmin:
    def __init__(self): self.pw_resets = []
    def update_user_by_id(self, uid, attrs): self.pw_resets.append((uid, attrs))


def test_reviewer_invite_of_existing_staff_account_must_not_reset_password(monkeypatch):
    """BUG: create_user() with role reviewer on an existing email calls
    auth.admin.update_user_by_id(password=...) for ANY existing account -
    including an admin/leadership/jury user.  Their password is silently
    replaced (lock-out) and the temp password is returned in the response."""
    from app.routers import admin_users as au

    sb = FakeSupabase({
        "profiles": [{"id": "u-admin", "email": "boss@x.org"}],
        "user_roles": [{"user_id": "u-admin", "role": "admin"},
                       {"user_id": "u-admin", "role": "jury"}],
        "batches": [], "reviewer_profiles": [],
    })
    sb.auth = SimpleNamespace(admin=_AuthAdmin())
    monkeypatch.setattr(au, "get_admin_client", lambda: sb)
    monkeypatch.setattr(au, "write_audit", lambda **k: None)
    body = au.CreateUserRequest(email="boss@x.org", full_name="Boss", roles=["reviewer"],
                                send_invite=False)
    asyncio.run(au.create_user(body, {"user_id": "adm"}))
    assert sb.auth.admin.pw_resets == []


def test_reviewer_invite_existing_user_keeps_jury_role(monkeypatch):
    """BUG: existing-user path deletes every role except reviewer/admin/
    leadership (docstring says only applicant/founder/mentor).  A juror who is
    invited as a reviewer silently loses `jury`."""
    from app.routers import admin_users as au

    sb = FakeSupabase({
        "profiles": [{"id": "u1", "email": "j@x.org"}],
        "user_roles": [{"user_id": "u1", "role": "jury"}],
        "batches": [], "reviewer_profiles": [],
    })
    sb.auth = SimpleNamespace(admin=_AuthAdmin())
    monkeypatch.setattr(au, "get_admin_client", lambda: sb)
    monkeypatch.setattr(au, "write_audit", lambda **k: None)
    body = au.CreateUserRequest(email="j@x.org", full_name="J", roles=["reviewer"], send_invite=False)
    asyncio.run(au.create_user(body, {"user_id": "adm"}))
    roles = {r["role"] for r in sb.tables["user_roles"] if r["user_id"] == "u1"}
    assert roles == {"reviewer", "jury"}


# 11 ─ fake hides: upsert ignore_duplicates overwrites ─────────────────────
def test_fake_upsert_ignore_duplicates_overwrites_existing_row():
    """TEST-HARNESS GAP: prod ON CONFLICT DO NOTHING keeps the existing row;
    the shared fake .update()s it instead (assigned_by/state/declined_at reset)."""
    sb = FakeSupabase({"reviewer_assignments": [
        {"application_id": "a", "application_track": "sip", "reviewer_user_id": "r",
         "state": "accepted"}]})
    sb.table("reviewer_assignments").upsert(
        [{"application_id": "a", "application_track": "sip", "reviewer_user_id": "r",
          "state": "pending"}],
        on_conflict="application_id,application_track,reviewer_user_id",
        ignore_duplicates=True).execute()
    assert sb.tables["reviewer_assignments"][0]["state"] == "accepted"
