"""Task 9 — per-app juror assign / unassign (v2 guards).

Exercises POST/DELETE /leadership/applications/{id}/jurors[/{juror}]:
  * assign requires the app to be in jury_review (shortlisted → 409
    not_eligible_for_jury); v2 no longer flips shortlisted → jury_review;
  * per-id result statuses: created | already_assigned | not_a_juror;
  * the inserted jury_assignments row has NO ``state`` column (v2 shape);
  * unassign hard-deletes the assignment AND cascades the juror's pick
    (jury_selections row for the pair);
  * unassign is frozen (409 app_already_decided) once a gate-2
    admin_decisions row exists for the app.

Uses the shared WHERE-aware FakeSupabase (honours .eq/.in_ and mutates on
delete) so the decided-app guard's ``.in_`` filter is genuinely exercised.
Capabilities are granted by overriding get_current_user (admin holds
assign_jurors).
"""

from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


def _override_user(user_id: str, roles: list[str]):
    def _f():
        return {"user_id": user_id, "email": f"{user_id}@x.com", "roles": roles}
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _install_db(monkeypatch, fake: FakeSupabase) -> FakeSupabase:
    from app.routers import leadership_actions as la
    from app.services import applications_query

    monkeypatch.setattr(la, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(la, "write_audit", lambda **k: None)
    return fake


APP = "aaaaaaaa-0000-0000-0000-00000000000{}"
JCREATE = "jjjjjjjj-0000-0000-0000-000000000001"
JDUPE = "jjjjjjjj-0000-0000-0000-000000000002"
JNOPE = "jjjjjjjj-0000-0000-0000-000000000003"


# ─── assign requires jury_review status (v2: no shortlisted flip) ────────


def test_assign_requires_jury_review_status(client, monkeypatch, _clear_overrides):
    app_id = APP.format(1)
    fake = FakeSupabase({
        "tir_applications": [{"id": app_id, "status": "shortlisted"}],
        "user_roles": [{"user_id": JCREATE, "role": "jury"}],
    })
    _install_db(monkeypatch, fake)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    r = client.post(
        f"/leadership/applications/{app_id}/jurors",
        json={"juror_user_ids": [JCREATE]},
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "not_eligible_for_jury"
    assert r.json()["detail"]["status"] == "shortlisted"
    # No assignment should have been created, and status stays put.
    assert fake.tables.get("jury_assignments", []) == []
    assert fake.status_of("tir", app_id) == "shortlisted"


# ─── created | already_assigned | not_a_juror ───────────────────────────


def test_assign_creates_and_dedupes(client, monkeypatch, _clear_overrides):
    app_id = APP.format(2)
    fake = FakeSupabase({
        "tir_applications": [{"id": app_id, "status": "jury_review"}],
        "user_roles": [
            {"user_id": JCREATE, "role": "jury"},
            {"user_id": JDUPE, "role": "jury"},
        ],
        "jury_assignments": [
            {"application_id": app_id, "application_track": "tir", "juror_user_id": JDUPE},
        ],
    })
    _install_db(monkeypatch, fake)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    r = client.post(
        f"/leadership/applications/{app_id}/jurors",
        json={"juror_user_ids": [JCREATE, JDUPE, JNOPE]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["track"] == "tir"
    by_id = {res["juror_user_id"]: res["status"] for res in body["results"]}
    assert by_id == {
        JCREATE: "created",
        JDUPE: "already_assigned",
        JNOPE: "not_a_juror",
    }

    # A new jury_assignments row exists for JCREATE with the v2 shape (no state).
    new = [r for r in fake.tables["jury_assignments"] if r["juror_user_id"] == JCREATE]
    assert len(new) == 1, fake.tables["jury_assignments"]
    row = new[0]
    assert "state" not in row, row
    assert row["application_id"] == app_id
    assert row["application_track"] == "tir"
    assert row["assigned_by"] == "admin-1"
    assert row.get("assigned_at")

    # No duplicate row for JDUPE.
    dupes = [r for r in fake.tables["jury_assignments"] if r["juror_user_id"] == JDUPE]
    assert len(dupes) == 1, dupes

    # v2: status is NOT auto-flipped (it was already jury_review here anyway).
    assert fake.status_of("tir", app_id) == "jury_review"


# ─── unassign hard-deletes assignment AND cascades the pick ──────────────


def test_unassign_deletes_assignment_and_cascades_pick(client, monkeypatch, _clear_overrides):
    app_id = APP.format(3)
    fake = FakeSupabase({
        "tir_applications": [{"id": app_id, "status": "jury_review"}],
        "jury_assignments": [
            {"application_id": app_id, "application_track": "tir", "juror_user_id": JCREATE},
        ],
        "jury_selections": [
            {"application_id": app_id, "application_track": "tir",
             "juror_user_id": JCREATE, "note": "top pick"},
            # a different juror's pick on the same app must survive
            {"application_id": app_id, "application_track": "tir",
             "juror_user_id": JDUPE, "note": "keep me"},
        ],
        "admin_decisions": [],
    })
    _install_db(monkeypatch, fake)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    r = client.delete(f"/leadership/applications/{app_id}/jurors/{JCREATE}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["deleted"] is True

    # Assignment row gone.
    assert not [r for r in fake.tables["jury_assignments"]
                if r["juror_user_id"] == JCREATE]
    # This juror's pick cascaded away…
    assert not [r for r in fake.tables["jury_selections"]
                if r["juror_user_id"] == JCREATE]
    # …but the other juror's pick on the same app survives.
    survivors = [r for r in fake.tables["jury_selections"]
                 if r["juror_user_id"] == JDUPE]
    assert len(survivors) == 1, fake.tables["jury_selections"]


# ─── unassign frozen once a gate-2 decision exists ───────────────────────


def test_unassign_blocked_after_gate2_decision(client, monkeypatch, _clear_overrides):
    app_id = APP.format(4)
    fake = FakeSupabase({
        "tir_applications": [{"id": app_id, "status": "offered"}],
        "jury_assignments": [
            {"application_id": app_id, "application_track": "tir", "juror_user_id": JCREATE},
        ],
        "jury_selections": [
            {"application_id": app_id, "application_track": "tir",
             "juror_user_id": JCREATE, "note": "pick"},
        ],
        "admin_decisions": [
            {"application_id": app_id, "application_track": "tir",
             "gate_stage": "gate2", "decision": "offered"},
        ],
    })
    _install_db(monkeypatch, fake)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    r = client.delete(f"/leadership/applications/{app_id}/jurors/{JCREATE}")
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "app_already_decided"

    # Nothing deleted — the assignment and pick are frozen.
    assert len(fake.tables["jury_assignments"]) == 1
    assert len(fake.tables["jury_selections"]) == 1
