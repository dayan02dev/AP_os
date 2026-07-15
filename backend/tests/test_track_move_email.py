from types import SimpleNamespace

from app.services import track_move_email


class _Tbl:
    def __init__(self, rows): self.rows = rows
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return SimpleNamespace(data=self.rows)


class _SB:
    def __init__(self, rows): self.rows = rows
    def table(self, name): return _Tbl(self.rows)


def _patch(monkeypatch):
    sent = []
    class _Svc:
        def send_track_moved(self, **kw): sent.append(kw)
    monkeypatch.setattr(track_move_email, "get_email_service", lambda: _Svc())
    return sent


def test_notify_sends_on_move(monkeypatch):
    sent = _patch(monkeypatch)
    sb = _SB([{"basic_full_name": "Ann", "basic_email": "ann@x.com"}])
    track_move_email.notify_applicant_moved(sb, track="tir", moved_to_track="sip", application_id="a1")
    assert len(sent) == 1
    assert sent[0]["from_label"] == "TIR" and sent[0]["to_label"] == "VIP"
    assert sent[0]["to"] == "ann@x.com"


def test_notify_noop_on_move_back(monkeypatch):
    sent = _patch(monkeypatch)
    sb = _SB([{"basic_full_name": "Ann", "basic_email": "ann@x.com"}])
    track_move_email.notify_applicant_moved(sb, track="tir", moved_to_track=None, application_id="a1")
    assert sent == []


def test_notify_swallows_missing_email(monkeypatch):
    sent = _patch(monkeypatch)
    sb = _SB([{"basic_full_name": "Ann", "basic_email": ""}])
    track_move_email.notify_applicant_moved(sb, track="tir", moved_to_track="sip", application_id="a1")
    assert sent == []
