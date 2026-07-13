from types import SimpleNamespace

from app.services import applications_query as aq


class _Q:
    def __init__(self, rows): self._rows = rows
    def select(self, *a, **k): return self
    def ilike(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return SimpleNamespace(data=self._rows)


class _SB:
    def __init__(self, rows): self._rows = rows; self.tables = []
    def table(self, name): self.tables.append(name); return _Q(self._rows)


def test_returns_other_track_on_match(monkeypatch):
    sb = _SB([{"id": "x", "status": "submitted", "basic_email": "a@x.com"}])
    monkeypatch.setattr(aq, "get_admin_client", lambda: sb)
    assert aq.also_in_track("A@x.com", "tir") == "sip"
    assert sb.tables == ["sip_applications"]


def test_none_when_no_match(monkeypatch):
    sb = _SB([])
    monkeypatch.setattr(aq, "get_admin_client", lambda: sb)
    assert aq.also_in_track("a@x.com", "sip") is None


def test_ignores_ilike_wildcard_false_positive(monkeypatch):
    # Querying "a_b@x.com": SQL ILIKE would also match "axb@x.com" (`_` is a
    # single-char wildcard). The Python exact-normalized guard must reject it.
    sb = _SB([{"id": "x", "status": "submitted", "basic_email": "axb@x.com"}])
    monkeypatch.setattr(aq, "get_admin_client", lambda: sb)
    assert aq.also_in_track("a_b@x.com", "tir") is None


def test_matches_exact_among_wildcard_rows(monkeypatch):
    # A true exact match present alongside a wildcard near-miss still matches.
    sb = _SB([
        {"id": "x", "status": "submitted", "basic_email": "axb@x.com"},
        {"id": "y", "status": "under_review", "basic_email": "A_B@x.com"},
    ])
    monkeypatch.setattr(aq, "get_admin_client", lambda: sb)
    assert aq.also_in_track("a_b@x.com", "tir") == "sip"


def test_none_for_blank_or_missing_email(monkeypatch):
    def boom():  # must not be called for a blank email
        raise AssertionError("get_admin_client should not run for blank email")
    monkeypatch.setattr(aq, "get_admin_client", boom)
    assert aq.also_in_track("", "tir") is None
    assert aq.also_in_track(None, "tir") is None
