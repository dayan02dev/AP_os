from app.services.founder_check import run as fc_run
from app.services.founder_check import graph as fc_graph


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    """Minimal chainable stub of the supabase-py query builder."""
    def __init__(self, store, table):
        self.store, self.table_name = store, table
        self._filters, self._update = {}, None

    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def maybe_single(self):
        self._single = True
        return self

    def update(self, payload):
        self._update = payload
        return self

    def execute(self):
        rows = self.store.get(self.table_name, [])
        matched = [r for r in rows if all(r.get(k) == v for k, v in self._filters.items())]
        if self._update is not None:
            for r in matched:
                r.update(self._update)
            self.store.setdefault("_writes", []).append((self.table_name, self._update))
            return _Resp(matched)
        if getattr(self, "_single", False):
            return _Resp(matched[0] if matched else None)
        return _Resp(matched)


class _Storage:
    def __init__(self, blob):
        self.blob = blob

    def from_(self, bucket):
        return self

    def download(self, path):
        return self.blob


class _Client:
    def __init__(self, store, blob=b"%PDF"):
        self.store, self.storage = store, _Storage(blob)

    def table(self, name):
        return _Query(self.store, name)


def _fake_graph(verdict):
    class _G:
        def invoke(self, state):
            return {"verdict": verdict}
    return _G()


def test_run_and_persist_skips_non_tir():
    client = _Client({})
    assert fc_run.run_and_persist(client, "app-1", "sip") is None


def test_run_and_persist_noop_when_no_resume():
    store = {"tir_applications": [{"id": "app-1", "resume_file_id": None, "user_id": "u1"}],
             "tir_resume_uploads": []}
    client = _Client(store)
    assert fc_run.run_and_persist(client, "app-1", "tir") is None


def test_run_and_persist_updates_founder_check(monkeypatch):
    store = {
        "tir_applications": [{"id": "app-1", "resume_file_id": "r1", "user_id": "u1"}],
        "tir_resume_uploads": [{"id": "r1", "storage_path": "u1/r1.pdf",
                                "mime_type": "application/pdf"}],
        "ai_screening": [{"application_id": "app-1", "application_track": "tir"}],
    }
    client = _Client(store)
    monkeypatch.setattr(fc_graph, "build_graph",
                        lambda: _fake_graph({"verdict": "STRONG", "confidence": "HIGH"}))
    out = fc_run.run_and_persist(client, "app-1", "tir")
    assert out["verdict"] == "STRONG"
    assert out["model"] == "google/gemini-2.5-flash"
    assert "ran_at" in out
    row = store["ai_screening"][0]
    assert row["founder_check"]["verdict"] == "STRONG"
