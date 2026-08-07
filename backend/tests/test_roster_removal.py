"""Reviewer / juror roster removal (admin "Delete" action).

The load-bearing invariants, in order of how badly they'd hurt if broken:

  1. Reviews SURVIVE a reviewer delete. The FK is ON DELETE CASCADE from
     auth.users, so any implementation that deletes the auth account silently
     destroys the scored work. These tests pin the behaviour, not the code.
  2. Only the deleted person's assignments are released — a co-reviewer on the
     same application keeps theirs, and the application's batch link is
     untouched.
  3. An account with other roles keeps them (udita@ is admin + leadership +
     jury on prod; removing them from the jury must not cost them admin).
  4. A deleted juror's jury_invites row goes, so the address can be re-invited
     (jury_invites has a UNIQUE index on lower(email)).

Driven by the mutating FakeSupabase double so deletes can be read back.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services import roster_removal
from tests.fixtures.fake_supabase import FakeSupabase

REV = "rev-1"
OTHER_REV = "rev-2"
JUROR = "jur-1"
OTHER_JUROR = "jur-2"


def _reviewer_world() -> FakeSupabase:
    """One reviewer with 2 assignments (one shared with a co-reviewer), 1
    submitted review, 1 batch membership, and a roster profile."""
    return FakeSupabase({
        "user_roles": [
            {"user_id": REV, "role": "reviewer"},
            {"user_id": OTHER_REV, "role": "reviewer"},
        ],
        "profiles": [
            {"id": REV, "email": "rev1@example.com", "full_name": "Rev One"},
            {"id": OTHER_REV, "email": "rev2@example.com", "full_name": "Rev Two"},
        ],
        "reviewer_assignments": [
            {"id": "a1", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": REV},
            {"id": "a2", "application_id": "app-2", "application_track": "sip",
             "reviewer_user_id": REV},
            # Co-reviewer on app-1 — must survive.
            {"id": "a3", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": OTHER_REV},
        ],
        "reviews": [
            {"id": "r1", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": REV, "submitted_at": "2026-07-01T00:00:00Z",
             "score_problem": 8},
            {"id": "r2", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": OTHER_REV, "submitted_at": "2026-07-02T00:00:00Z"},
        ],
        "batch_reviewers": [
            {"batch_id": "b1", "reviewer_user_id": REV},
            {"batch_id": "b1", "reviewer_user_id": OTHER_REV},
        ],
        "reviewer_profiles": [
            {"reviewer_user_id": REV, "weight": 1.0, "expertise_domains": ["ai"]},
        ],
        "application_batches": [
            {"application_id": "app-1", "application_track": "tir", "batch_id": "b1"},
        ],
    })


def _jury_world() -> FakeSupabase:
    return FakeSupabase({
        "user_roles": [
            {"user_id": JUROR, "role": "jury"},
            {"user_id": OTHER_JUROR, "role": "jury"},
        ],
        "profiles": [
            {"id": JUROR, "email": "jur1@example.com", "full_name": "Juror One"},
            {"id": OTHER_JUROR, "email": "jur2@example.com", "full_name": "Juror Two"},
        ],
        "jury_invites": [
            {"id": "inv-1", "email": "jur1@example.com", "status": "accepted"},
            {"id": "inv-2", "email": "jur2@example.com", "status": "accepted"},
        ],
        "jury_profiles": [
            {"juror_user_id": JUROR, "invite_id": "inv-1", "weight": 1.0},
            {"juror_user_id": OTHER_JUROR, "invite_id": "inv-2", "weight": 1.0},
        ],
        "jury_assignments": [
            {"id": "ja1", "application_id": "app-1", "application_track": "tir",
             "juror_user_id": JUROR},
            {"id": "ja2", "application_id": "app-1", "application_track": "tir",
             "juror_user_id": OTHER_JUROR},
        ],
        "jury_selections": [
            {"id": "js1", "application_id": "app-1", "application_track": "tir",
             "juror_user_id": JUROR, "note": "strong"},
            {"id": "js2", "application_id": "app-1", "application_track": "tir",
             "juror_user_id": OTHER_JUROR},
        ],
        "jury_recommendations": [
            {"id": "jr1", "juror_user_id": JUROR, "application_id": "app-1",
             "application_track": "tir", "score": 90},
        ],
    })


# ─── reviewer ────────────────────────────────────────────────────────────


def test_remove_reviewer_keeps_reviews_and_releases_only_their_assignments():
    sb = _reviewer_world()

    result = roster_removal.remove_reviewer(sb, REV, actor="admin-1")

    assert result["assignments_removed"] == 2
    assert result["reviews_kept"] == 1
    assert result["account_retained"] is True

    # Reviews untouched — BOTH rows still there, including the deleted
    # reviewer's own scored work.
    assert len(sb.tables["reviews"]) == 2
    assert any(r["reviewer_user_id"] == REV for r in sb.tables["reviews"])

    # Only the co-reviewer's assignment survives.
    remaining = sb.tables["reviewer_assignments"]
    assert [a["id"] for a in remaining] == ["a3"]
    assert remaining[0]["reviewer_user_id"] == OTHER_REV

    # The application is still in its batch — deleting a reviewer must not
    # unbatch the work.
    assert len(sb.tables["application_batches"]) == 1


def test_remove_reviewer_clears_roster_rows_and_role():
    sb = _reviewer_world()
    roster_removal.remove_reviewer(sb, REV)

    assert sb.tables["reviewer_profiles"] == []
    assert [b["reviewer_user_id"] for b in sb.tables["batch_reviewers"]] == [OTHER_REV]
    assert [r["user_id"] for r in sb.tables["user_roles"]] == [OTHER_REV]


def test_remove_reviewer_preserves_other_roles():
    """A staff member who reviews keeps admin/leadership after de-rostering."""
    sb = _reviewer_world()
    sb.tables["user_roles"].append({"user_id": REV, "role": "admin"})
    sb.tables["user_roles"].append({"user_id": REV, "role": "leadership"})

    result = roster_removal.remove_reviewer(sb, REV)

    assert result["remaining_roles"] == ["admin", "leadership"]
    still = {(r["user_id"], r["role"]) for r in sb.tables["user_roles"]}
    assert (REV, "reviewer") not in still
    assert (REV, "admin") in still and (REV, "leadership") in still


def test_remove_reviewer_404_when_not_a_reviewer():
    sb = _reviewer_world()
    with pytest.raises(HTTPException) as exc:
        roster_removal.remove_reviewer(sb, "nobody")
    assert exc.value.status_code == 404
    assert exc.value.detail["code"] == "not_a_reviewer"


def test_remove_reviewer_is_idempotent_second_call_404s():
    sb = _reviewer_world()
    roster_removal.remove_reviewer(sb, REV)
    with pytest.raises(HTTPException) as exc:
        roster_removal.remove_reviewer(sb, REV)
    assert exc.value.status_code == 404


def test_remove_reviewer_with_no_assignments_still_succeeds():
    sb = FakeSupabase({
        "user_roles": [{"user_id": REV, "role": "reviewer"}],
        "profiles": [{"id": REV, "email": "r@e.com"}],
    })
    result = roster_removal.remove_reviewer(sb, REV)
    assert result["assignments_removed"] == 0
    assert result["reviews_kept"] == 0
    assert result["remaining_roles"] == []


# ─── juror ───────────────────────────────────────────────────────────────


def test_remove_juror_releases_assignments_picks_and_invite():
    sb = _jury_world()

    result = roster_removal.remove_juror(sb, JUROR, actor="admin-1")

    assert result["assignments_removed"] == 1
    assert result["picks_removed"] == 1
    assert result["invite_removed"] is True

    # Co-juror on the same application is untouched.
    assert [a["juror_user_id"] for a in sb.tables["jury_assignments"]] == [OTHER_JUROR]
    assert [s["juror_user_id"] for s in sb.tables["jury_selections"]] == [OTHER_JUROR]

    # Roster rows gone; the other juror's rows stay.
    assert [p["juror_user_id"] for p in sb.tables["jury_profiles"]] == [OTHER_JUROR]
    assert sb.tables["jury_recommendations"] == []
    assert [i["id"] for i in sb.tables["jury_invites"]] == ["inv-2"]
    assert [r["user_id"] for r in sb.tables["user_roles"]] == [OTHER_JUROR]


def test_remove_juror_falls_back_to_email_when_profile_link_missing():
    """No jury_profiles row (or no invite_id on it) → still clear the invite by
    address, otherwise a re-invite silently returns already_invited."""
    sb = _jury_world()
    sb.tables["jury_profiles"] = [
        {"juror_user_id": JUROR, "invite_id": None},
        {"juror_user_id": OTHER_JUROR, "invite_id": "inv-2"},
    ]

    result = roster_removal.remove_juror(sb, JUROR)

    assert result["invite_removed"] is True
    assert [i["id"] for i in sb.tables["jury_invites"]] == ["inv-2"]


def test_remove_juror_preserves_other_roles():
    """udita@ on prod is admin + leadership + jury — removing them from the
    jury roster must not touch their admin access."""
    sb = _jury_world()
    sb.tables["user_roles"].append({"user_id": JUROR, "role": "admin"})
    sb.tables["user_roles"].append({"user_id": JUROR, "role": "leadership"})

    result = roster_removal.remove_juror(sb, JUROR)

    assert result["remaining_roles"] == ["admin", "leadership"]
    assert sb.tables["profiles"]  # account row survives
    assert any(p["id"] == JUROR for p in sb.tables["profiles"])


def test_remove_juror_404_when_not_a_juror():
    sb = _jury_world()
    with pytest.raises(HTTPException) as exc:
        roster_removal.remove_juror(sb, "nobody")
    assert exc.value.status_code == 404
    assert exc.value.detail["code"] == "not_a_juror"


def test_remove_juror_no_invite_row_is_not_an_error():
    sb = FakeSupabase({
        "user_roles": [{"user_id": JUROR, "role": "jury"}],
        "profiles": [{"id": JUROR, "email": "j@e.com"}],
    })
    result = roster_removal.remove_juror(sb, JUROR)
    assert result["invite_removed"] is False
    assert result["assignments_removed"] == 0


# ─── endpoint wiring ─────────────────────────────────────────────────────
#
# The service tests above own the semantics; these pin the route contract:
# the self-delete guard, the audit call, and that the endpoint actually
# reaches the service (a mis-wired import would pass every service test).

from app.routers import admin_platform  # noqa: E402


def _patch_endpoint(monkeypatch, sb):
    monkeypatch.setattr(admin_platform, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_platform, "write_audit", lambda *a, **k: None)


async def test_delete_reviewer_endpoint_removes_and_reports(monkeypatch):
    sb = _reviewer_world()
    _patch_endpoint(monkeypatch, sb)

    out = await admin_platform.delete_reviewer(
        REV, user={"user_id": "admin-1", "roles": ["admin"]})

    assert out["assignments_removed"] == 2
    assert out["reviews_kept"] == 1
    assert len(sb.tables["reviews"]) == 2


async def test_delete_reviewer_endpoint_rejects_self(monkeypatch):
    sb = _reviewer_world()
    _patch_endpoint(monkeypatch, sb)

    with pytest.raises(HTTPException) as exc:
        await admin_platform.delete_reviewer(REV, user={"user_id": REV, "roles": ["admin"]})
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "cannot_remove_self"
    # Nothing was touched.
    assert len(sb.tables["reviewer_assignments"]) == 3


async def test_delete_juror_endpoint_removes_and_reports(monkeypatch):
    sb = _jury_world()
    _patch_endpoint(monkeypatch, sb)

    out = await admin_platform.delete_juror(
        JUROR, user={"user_id": "admin-1", "roles": ["admin"]})

    assert out["assignments_removed"] == 1
    assert out["picks_removed"] == 1
    assert out["invite_removed"] is True


async def test_delete_juror_endpoint_rejects_self(monkeypatch):
    sb = _jury_world()
    _patch_endpoint(monkeypatch, sb)

    with pytest.raises(HTTPException) as exc:
        await admin_platform.delete_juror(JUROR, user={"user_id": JUROR, "roles": ["admin"]})
    assert exc.value.status_code == 409
    assert len(sb.tables["jury_assignments"]) == 2


async def test_delete_endpoints_are_capability_gated():
    """The roster deletes must sit behind the same caps as the roster reads —
    a leadership account holds neither, so it can never de-roster anyone."""
    from app.main import app

    routes = {
        (r.path, tuple(sorted(r.methods))): r
        for r in app.routes if hasattr(r, "methods")
    }
    for path in ("/admin/platform/reviewers/{user_id}",
                 "/admin/platform/jurors/{user_id}"):
        route = routes[(path, ("DELETE",))]
        deps = [d.call for d in route.dependant.dependencies]
        assert deps, f"{path} has no capability dependency"

    from app.rbac import ROLE_CAPABILITIES
    assert "manage_reviewers_roster" not in ROLE_CAPABILITIES["leadership"]
    assert "manage_jury_roster" not in ROLE_CAPABILITIES["leadership"]


# ─── juror identity edit (roster "Manage" drawer) ────────────────────────
#
# The jury roster's Manage drawer now edits name/email alongside weight and
# domains, so the PATCH has to split across jury_profiles and profiles the
# same way the reviewer one does.


class _FakeAuthAdmin:
    def __init__(self):
        self.updates = []

    def update_user_by_id(self, user_id, payload):
        self.updates.append((user_id, payload))


class _SbWithAuth:
    """FakeSupabase + the `.auth.admin` surface the email sync reaches for."""

    def __init__(self, sb):
        self._sb = sb
        self.auth = type("A", (), {"admin": _FakeAuthAdmin()})()

    def table(self, name):
        return self._sb.table(name)

    @property
    def tables(self):
        return self._sb.tables


class _JurorBody:
    def __init__(self, **kw):
        self.weight = kw.get("weight")
        self.expertise_domains = kw.get("expertise_domains")
        self.full_name = kw.get("full_name")
        self.email = kw.get("email")


async def test_patch_juror_updates_name_email_and_syncs_login(monkeypatch):
    sb = _SbWithAuth(_jury_world())
    _patch_endpoint(monkeypatch, sb)

    out = await admin_platform.update_juror_profile(
        JUROR,
        _JurorBody(full_name="Corrected Name", email="fixed@example.com",
                   weight=2.0, expertise_domains=["health"]),
        user={"user_id": "admin-1", "roles": ["admin"]},
    )

    assert out["full_name"] == "Corrected Name"
    prof = next(p for p in sb.tables["profiles"] if p["id"] == JUROR)
    assert prof["full_name"] == "Corrected Name"
    assert prof["email"] == "fixed@example.com"
    jp = next(p for p in sb.tables["jury_profiles"] if p["juror_user_id"] == JUROR)
    assert jp["weight"] == 2.0 and jp["expertise_domains"] == ["health"]
    # Login email kept in step with the roster.
    assert sb.auth.admin.updates == [(JUROR, {"email": "fixed@example.com",
                                              "email_confirm": True})]


async def test_patch_juror_name_only_does_not_touch_auth(monkeypatch):
    """A name-only edit must not call the auth API (and must not need an
    email) — the reviewer patch has the same NOT NULL trap documented."""
    sb = _SbWithAuth(_jury_world())
    _patch_endpoint(monkeypatch, sb)

    await admin_platform.update_juror_profile(
        JUROR, _JurorBody(full_name="Just A Name"),
        user={"user_id": "admin-1", "roles": ["admin"]},
    )

    prof = next(p for p in sb.tables["profiles"] if p["id"] == JUROR)
    assert prof["full_name"] == "Just A Name"
    assert prof["email"] == "jur1@example.com"
    assert sb.auth.admin.updates == []


async def test_patch_juror_rejects_empty_body(monkeypatch):
    sb = _SbWithAuth(_jury_world())
    _patch_endpoint(monkeypatch, sb)
    with pytest.raises(HTTPException) as exc:
        await admin_platform.update_juror_profile(
            JUROR, _JurorBody(), user={"user_id": "admin-1", "roles": ["admin"]})
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "no_fields"
