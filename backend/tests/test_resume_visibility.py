"""Unit tests for applications_query.resolve_resume_file (résumé FK → file object)."""
from types import SimpleNamespace


class _Q:
    def __init__(self, rows):
        self._rows = list(rows)
        self._eqs = []

    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        rows = self._rows
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        return SimpleNamespace(data=rows, count=len(rows))


class _Client:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Q(self.tables.get(name, []))


def test_resolve_resume_file_returns_file_object(monkeypatch):
    from app.services import applications_query as aq
    client = _Client({"tir_resume_uploads": [
        {"id": "res-1", "storage_path": "u1/res-1.pdf",
         "original_filename": "alice_cv.pdf", "file_size_bytes": 51200,
         "mime_type": "application/pdf"},
    ]})
    monkeypatch.setattr(aq, "get_admin_client", lambda: client)

    out = aq.resolve_resume_file("tir", {"resume_file_id": "res-1"})
    assert out == {
        "original_filename": "alice_cv.pdf",
        "file_size_bytes": 51200,
        "storage_path": "u1/res-1.pdf",
        "mime_type": "application/pdf",
        "bucket": "tir-resumes",
    }


def test_resolve_resume_file_sip_uses_sip_table_and_bucket(monkeypatch):
    from app.services import applications_query as aq
    client = _Client({"sip_resume_uploads": [
        {"id": "res-9", "storage_path": "u2/res-9.pdf",
         "original_filename": "bob.pdf", "file_size_bytes": 4096,
         "mime_type": "application/pdf"},
    ]})
    monkeypatch.setattr(aq, "get_admin_client", lambda: client)

    out = aq.resolve_resume_file("sip", {"resume_file_id": "res-9"})
    assert out["bucket"] == "sip-resumes"
    assert out["storage_path"] == "u2/res-9.pdf"


def test_resolve_resume_file_none_when_no_id(monkeypatch):
    from app.services import applications_query as aq
    monkeypatch.setattr(aq, "get_admin_client", lambda: _Client({}))
    assert aq.resolve_resume_file("tir", {"resume_file_id": None}) is None
    assert aq.resolve_resume_file("tir", {}) is None


def test_resolve_resume_file_none_when_row_missing(monkeypatch):
    from app.services import applications_query as aq
    monkeypatch.setattr(aq, "get_admin_client",
                        lambda: _Client({"tir_resume_uploads": []}))
    assert aq.resolve_resume_file("tir", {"resume_file_id": "ghost"}) is None
