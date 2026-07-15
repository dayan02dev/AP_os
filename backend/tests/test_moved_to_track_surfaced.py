from app.services import reviewer_query


def test_fetch_queue_row_includes_moved_to_track(monkeypatch):
    # Minimal fake supabase: one assignment on a moved TIR app.
    from types import SimpleNamespace

    APP = {"id": "a1", "status": "under_review", "basic_org": "Acme",
           "basic_full_name": "Ann", "moved_to_track": "sip", "display_seq": 26001}
    ASSIGN = [{"id": "asg1", "application_id": "a1", "application_track": "tir",
               "declined_at": None, "reassigned_to": None, "assigned_at": None, "due_at": None}]

    class _Tbl:
        def __init__(self, name): self.name = name
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def in_(self, *a, **k): return self
        def execute(self):
            data = {"reviewer_assignments": ASSIGN, "tir_applications": [APP]}.get(self.name, [])
            return SimpleNamespace(data=data)

    class _SB:
        def table(self, name): return _Tbl(name)

    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: _SB())
    rows = reviewer_query.fetch_queue("rev1")
    assert rows and rows[0]["movedToTrack"] == "sip"
