from app.services import edit_window


def test_edit_open_before_deadline(monkeypatch):
    monkeypatch.setattr(edit_window.settings, "edit_deadline_tir", "2099-01-01T00:00:00+05:30")
    assert edit_window.is_edit_open("tir") is True


def test_edit_closed_after_deadline(monkeypatch):
    monkeypatch.setattr(edit_window.settings, "edit_deadline_tir", "2000-01-01T00:00:00+05:30")
    assert edit_window.is_edit_open("tir") is False


def test_deadline_per_track(monkeypatch):
    monkeypatch.setattr(edit_window.settings, "edit_deadline_sip", "2030-07-05T23:59:59+05:30")
    assert edit_window.edit_deadline_for("sip").year == 2030


def test_edit_window_closed_for_both_tracks():
    """Edit window is CLOSED for both TIR and VIP (deadline set to a past date)."""
    from app.config import settings
    assert settings.edit_deadline_tir == settings.edit_deadline_sip
    assert edit_window.is_edit_open("tir") is False
    assert edit_window.is_edit_open("sip") is False
