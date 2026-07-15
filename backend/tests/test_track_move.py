from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import track_move


class _Q:
    def __init__(self, sb, name): self.sb, self.name = sb, name
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def update(self, patch): self.sb.updates.append((self.name, patch)); return self
    def execute(self): return SimpleNamespace(data=self.sb.select_rows)


class _SB:
    def __init__(self, select_rows): self.select_rows = select_rows; self.updates = []
    def table(self, name): return _Q(self, name)


def _patch(monkeypatch, rows):
    sb = _SB(rows)
    monkeypatch.setattr(track_move, "get_admin_client", lambda: sb)
    monkeypatch.setattr(track_move, "write_audit", lambda **k: None)
    return sb


def test_move_sets_flag_to_other_track(monkeypatch):
    sb = _patch(monkeypatch, [{"id": "a1", "moved_to_track": None}])
    out = track_move.move_track(track="tir", application_id="a1", actor_user_id="u1")
    assert out["moved_to_track"] == "sip"
    assert sb.updates[0][0] == "tir_applications"
    assert sb.updates[0][1]["moved_to_track"] == "sip"
    assert sb.updates[0][1]["moved_by"] == "u1"


def test_move_toggles_back_to_null(monkeypatch):
    sb = _patch(monkeypatch, [{"id": "a1", "moved_to_track": "sip"}])
    out = track_move.move_track(track="tir", application_id="a1", actor_user_id="u1")
    assert out["moved_to_track"] is None
    assert sb.updates[0][1] == {"moved_to_track": None, "moved_at": None, "moved_by": None}


def test_vip_moves_to_tir(monkeypatch):
    _patch(monkeypatch, [{"id": "a1", "moved_to_track": None}])
    out = track_move.move_track(track="sip", application_id="a1", actor_user_id="u1")
    assert out["moved_to_track"] == "tir"


def test_missing_app_404(monkeypatch):
    _patch(monkeypatch, [])
    with pytest.raises(HTTPException) as exc:
        track_move.move_track(track="tir", application_id="nope", actor_user_id="u1")
    assert exc.value.status_code == 404


def test_invalid_track_422(monkeypatch):
    _patch(monkeypatch, [])
    with pytest.raises(HTTPException) as exc:
        track_move.move_track(track="bogus", application_id="a1", actor_user_id="u1")
    assert exc.value.status_code == 422


def test_move_fires_applicant_email(monkeypatch):
    sb = _patch(monkeypatch, [{"id": "a1", "moved_to_track": None}])  # not moved -> will move
    calls = []
    monkeypatch.setattr(track_move, "notify_applicant_moved",
        lambda _sb, **kw: calls.append(kw))
    track_move.move_track(track="tir", application_id="a1", actor_user_id="u1")
    assert calls and calls[0]["moved_to_track"] == "sip"


def test_move_back_does_not_email(monkeypatch):
    sb = _patch(monkeypatch, [{"id": "a1", "moved_to_track": "sip"}])  # already moved -> move-back
    calls = []
    monkeypatch.setattr(track_move, "notify_applicant_moved",
        lambda _sb, **kw: calls.append(kw))
    track_move.move_track(track="tir", application_id="a1", actor_user_id="u1")
    assert calls == []
