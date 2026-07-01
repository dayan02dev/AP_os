from scripts.backfill_sections import select_targets, update_sections


def test_select_targets_skips_drafts():
    rows = [{"id": "a", "status": "draft"}, {"id": "b", "status": "submitted"},
            {"id": "c", "status": "under_review"}]
    assert select_targets(rows) == ["b", "c"]


class _Table:
    def __init__(self, sink): self.sink = sink; self._row = None
    def update(self, row): self._row = row; return self
    def eq(self, col, val): self.sink.setdefault("eqs", []).append((col, val)); return self
    def execute(self):
        self.sink["updated"] = self._row
        return type("R", (), {"data": [{"application_id": "b"}]})()


class _Client:
    def __init__(self): self.sink = {}
    def table(self, name): self.sink["table"] = name; return _Table(self.sink)


def test_update_sections_updates_only_sections_column():
    client = _Client()
    n = update_sections(client, "b", "tir", {"problem": ["x"]})
    assert client.sink["table"] == "ai_screening"
    assert client.sink["updated"] == {"sections": {"problem": ["x"]}}
    assert ("application_id", "b") in client.sink["eqs"]
    assert ("application_track", "tir") in client.sink["eqs"]
    assert n == 1
