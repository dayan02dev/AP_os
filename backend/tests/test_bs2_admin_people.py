"""SWARM2 (admin_people) @ 837ccf0 — each test asserts the CORRECT behaviour,
so it FAILS while the bug is present."""
from __future__ import annotations

from types import SimpleNamespace

from app.routers import admin_platform, admin_users
from app.services import admin_query, applications_query, batch_membership
from tests.fixtures.fake_supabase import FakeSupabase

ADMIN = {"user_id": "admin-1", "roles": ["admin"], "email": "a@x.in"}


class _Auth:
    def __init__(self):
        self.admin = self
        self.updates: list[tuple[str, dict]] = []
        self.created: list[dict] = []

    def update_user_by_id(self, uid, payload):
        self.updates.append((uid, payload))
        return SimpleNamespace(user=SimpleNamespace(id=uid))

    def create_user(self, payload):
        self.created.append(payload)
        return SimpleNamespace(user=SimpleNamespace(id="new-user"))


class _SB(FakeSupabase):
    def __init__(self, tables, auth=None):
        super().__init__(tables)
        self.auth = auth or _Auth()


def _wire(monkeypatch, sb):
    for mod in (admin_platform, admin_users, admin_query, applications_query):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb, raising=False)
    monkeypatch.setattr(admin_platform, "write_audit", lambda *a, **k: None)
    monkeypatch.setattr(admin_users, "write_audit", lambda *a, **k: None)
    monkeypatch.setattr(admin_platform, "notify_reviewers_assigned", lambda *a, **k: 0)


def _world():
    """App X is in batch B; reviewer R is a member of B and holds the
    batch-supplied assignment on X. App Y is a fresh submitted app."""
    return {
        "user_roles": [{"user_id": "R", "role": "reviewer"},
                       {"user_id": "admin-1", "role": "admin"}],
        "batches": [{"id": "B", "name": "Batch B"}],
        "batch_reviewers": [{"batch_id": "B", "reviewer_user_id": "R"}],
        "application_batches": [{"id": "l1", "application_id": "X",
                                 "application_track": "tir", "batch_id": "B"}],
        "reviewer_assignments": [{"id": "as1", "application_id": "X",
                                  "application_track": "tir", "reviewer_user_id": "R",
                                  "declined_at": None, "reassigned_to": None}],
        "tir_applications": [{"id": "X", "status": "under_review"},
                             {"id": "Y", "status": "submitted"}],
        "sip_applications": [],
        "reviews": [],
        "application_status_log": [],
    }


# ─── NEW-1 (AF-6 style resurrection) ─────────────────────────────────────
def test_drawer_remove_is_not_undone_by_readding_the_app_to_its_batch(monkeypatch):
    """Admin removes app X from reviewer R in the Manage Applications drawer
    (bulk_remove_reviewer_apps). The app stays in batch B and R stays a member
    of B. Later the admin bulk-adds a selection that still contains X to B
    (Applications tab 'Assign batch' does not skip apps already in it).
    add_apps_to_batch fans out to EVERY linkable app, not just new links, so
    R's assignment on X is silently re-created (and R is emailed)."""
    sb = _SB(_world())
    _wire(monkeypatch, sb)
    res = admin_query.bulk_remove_reviewer_apps("R", [{"application_id": "X", "track": "tir"}])
    assert res["results"][0]["status"] == "removed"
    assert sb.tables["reviewer_assignments"] == []

    out = batch_membership.add_apps_to_batch(sb, "B", [("X", "tir"), ("Y", "tir")], actor="admin-1")
    assert out["assigned"] == 1  # only Y is a new link
    triples = {(a["application_id"], a["reviewer_user_id"]) for a in sb.tables["reviewer_assignments"]}
    # Correct: the explicit per-app removal survives; only the NEW app fans out.
    assert ("X", "R") not in triples, "removed per-app assignment was resurrected by batch fan-out"
    assert ("Y", "R") in triples


# ─── NEW-2 existing-account reviewer invite drops other requested roles ─────
# ─── NEW-3 AdminRoles invite of an existing applicant with Reviewer ticked ──
# ─── AP-02 (still open): revoke 'reviewer' leaves roster data behind ────────
# ─── AP-13 (still open) ───────────────────────────────────────────────────
def test_bulk_assign_skips_draft_and_unknown_apps(monkeypatch):
    sb = _SB({
        "user_roles": [{"user_id": "R", "role": "reviewer"}],
        "reviewer_assignments": [],
        "tir_applications": [{"id": "draft1", "status": "draft"}],
        "sip_applications": [], "application_status_log": [],
    })
    _wire(monkeypatch, sb)
    res = admin_query.bulk_assign_reviewer_apps(
        "R", [{"application_id": "draft1", "track": "tir"},
              {"application_id": "ghost", "track": "tir"}], assigned_by="admin-1")
    assert all(r["status"] != "created" for r in res["results"])
    assert sb.tables["reviewer_assignments"] == []
