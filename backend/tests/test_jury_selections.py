"""Tests for the jury v2 selections API: GET /jury/selections/mine and
PUT /jury/selections (atomic set-replace, exactly-3, decided-app freeze).

v2 semantics under test:
  1. PUT must carry exactly 3 distinct (application_id, application_track)
     pairs — otherwise 422 must_pick_exactly_3.
  2. Every picked pair must be in the juror's own jury_assignments —
     otherwise 403 not_your_assignment.
  3. Set-replace: rows for dropped pairs are deleted, rows for kept/new
     pairs are upserted (notes update), submitted_at refreshed.
  4. Decided-app freeze: once an app has a gate-2 admin_decisions row, it
     can neither be dropped from an existing pick set nor newly added —
     both cases 409 app_already_decided.
  5. GET /jury/selections/mine returns the caller's current picks.
"""

from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _override_user(user_id: str, roles: list[str] | None = None):
    def _f():
        return {
            "user_id": user_id,
            "email": f"{user_id}@x.com",
            "roles": roles if roles is not None else ["jury"],
        }

    return _f


def _install(monkeypatch, tables: dict) -> FakeSupabase:
    """Install a mutating FakeSupabase into every module the jury routes call."""
    from app.routers import jury as jury_router
    from app.services import applications_query, jury_query

    fake = FakeSupabase(tables)
    monkeypatch.setattr(jury_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(jury_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    return fake


def _assignment(juror: str, app_id: str, track: str = "tir") -> dict:
    return {
        "id": f"ja-{app_id}",
        "juror_user_id": juror,
        "application_id": app_id,
        "application_track": track,
        "assigned_at": "2026-06-20T09:00:00Z",
        "due_at": None,
    }


def _selection(juror: str, app_id: str, track: str = "tir", note: str | None = None) -> dict:
    return {
        "id": f"sel-{app_id}",
        "juror_user_id": juror,
        "application_id": app_id,
        "application_track": track,
        "note": note,
        "submitted_at": "2026-07-01T00:00:00Z",
    }


def _gate2_decision(app_id: str, track: str = "tir") -> dict:
    return {
        "id": f"dec-{app_id}",
        "application_id": app_id,
        "application_track": track,
        "gate_stage": "gate2",
        "decision": "offered",
        "decided_at": "2026-07-05T00:00:00Z",
    }


J1 = "j1"
_ALL_ASSIGNMENTS = [_assignment(J1, f"a{i}") for i in range(1, 5)]


def _put(client, selections):
    return client.put("/jury/selections", json={"selections": selections})


def _sel(app_id, note=None):
    return {"application_id": app_id, "application_track": "tir", "note": note}


# ─── exactly-3 ──────────────────────────────────────────────────────────────


def test_put_exactly_three_required(client, monkeypatch, _clear_overrides):
    _install(monkeypatch, {"jury_assignments": list(_ALL_ASSIGNMENTS), "jury_selections": []})
    app.dependency_overrides[get_current_user] = _override_user(J1)

    r = _put(client, [_sel("a1"), _sel("a2")])
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "must_pick_exactly_3"


# ─── ownership guard ────────────────────────────────────────────────────────


def test_put_rejects_unassigned_app(client, monkeypatch, _clear_overrides):
    _install(monkeypatch, {"jury_assignments": list(_ALL_ASSIGNMENTS), "jury_selections": []})
    app.dependency_overrides[get_current_user] = _override_user(J1)

    r = _put(client, [_sel("a1"), _sel("a2"), _sel("a5")])  # a5 not assigned to j1
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "not_your_assignment"


# ─── happy path: create ─────────────────────────────────────────────────────


def test_put_creates_three_rows_with_notes(client, monkeypatch, _clear_overrides):
    fake = _install(monkeypatch, {"jury_assignments": list(_ALL_ASSIGNMENTS), "jury_selections": []})
    app.dependency_overrides[get_current_user] = _override_user(J1)

    r = _put(client, [_sel("a1", "note1"), _sel("a2", "note2"), _sel("a3", "note3")])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["submitted_at"]
    assert len(body["selections"]) == 3

    rows = [row for row in fake.tables["jury_selections"] if row.get("juror_user_id") == J1]
    assert len(rows) == 3
    by_app = {row["application_id"]: row for row in rows}
    assert by_app["a1"]["note"] == "note1"
    assert by_app["a2"]["note"] == "note2"
    assert by_app["a3"]["note"] == "note3"
    assert all(row.get("submitted_at") for row in rows)


# ─── set-replace swap ───────────────────────────────────────────────────────


def test_put_set_replace_swaps(client, monkeypatch, _clear_overrides):
    fake = _install(
        monkeypatch,
        {
            "jury_assignments": list(_ALL_ASSIGNMENTS),
            "jury_selections": [
                _selection(J1, "a1", note="old note"),
                _selection(J1, "a2"),
                _selection(J1, "a3"),
            ],
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(J1)

    r = _put(client, [_sel("a1", "updated note"), _sel("a2"), _sel("a4")])
    assert r.status_code == 200, r.text

    rows = [row for row in fake.tables["jury_selections"] if row.get("juror_user_id") == J1]
    keys = {row["application_id"] for row in rows}
    assert keys == {"a1", "a2", "a4"}  # a3 dropped, a4 added
    by_app = {row["application_id"]: row for row in rows}
    assert by_app["a1"]["note"] == "updated note"


# ─── decided-app freeze ─────────────────────────────────────────────────────


def test_put_frozen_decided_app_cannot_be_dropped(client, monkeypatch, _clear_overrides):
    _install(
        monkeypatch,
        {
            "jury_assignments": list(_ALL_ASSIGNMENTS),
            "jury_selections": [
                _selection(J1, "a1"),
                _selection(J1, "a2"),
                _selection(J1, "a3"),
            ],
            "admin_decisions": [_gate2_decision("a1")],
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(J1)

    # dropping a1 (which has a gate-2 decision) in favour of a4
    r = _put(client, [_sel("a2"), _sel("a3"), _sel("a4")])
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "app_already_decided"


def test_put_cannot_add_decided_app(client, monkeypatch, _clear_overrides):
    _install(
        monkeypatch,
        {
            "jury_assignments": list(_ALL_ASSIGNMENTS),
            "jury_selections": [
                _selection(J1, "a1"),
                _selection(J1, "a2"),
                _selection(J1, "a3"),
            ],
            "admin_decisions": [_gate2_decision("a4")],  # not currently picked
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(J1)

    r = _put(client, [_sel("a1"), _sel("a2"), _sel("a4")])  # newly adds decided a4
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "app_already_decided"


# ─── GET mine ───────────────────────────────────────────────────────────────


def test_get_mine_returns_current_set(client, monkeypatch, _clear_overrides):
    _install(
        monkeypatch,
        {
            "jury_assignments": list(_ALL_ASSIGNMENTS),
            "jury_selections": [
                _selection(J1, "a1", note="pick1"),
                _selection(J1, "a2"),
                _selection(J1, "a3"),
                _selection("other-juror", "a1"),  # must not leak into j1's set
            ],
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(J1)

    r = client.get("/jury/selections/mine")
    assert r.status_code == 200, r.text
    body = r.json()
    keys = {row["application_id"] for row in body["selections"]}
    assert keys == {"a1", "a2", "a3"}
    by_app = {row["application_id"]: row for row in body["selections"]}
    assert by_app["a1"]["note"] == "pick1"
