from app.services.ai_pipeline import pipeline
from workers.ai_screener.scoring import ScoreResult


class _FakeTable:
    def __init__(self, sink): self._sink = sink; self._op = None; self._row = None
    def upsert(self, row, on_conflict=None): self._op = "upsert"; self._row = row; return self
    def insert(self, row): self._op = "insert"; self._row = row; return self
    def update(self, row): self._op = "update"; self._row = row; return self
    def eq(self, *a, **k): return self
    def execute(self):
        if self._op == "upsert": self._sink["ai_screening"] = self._row
        return type("R", (), {"data": []})()


class _FakeClient:
    def __init__(self): self.sink = {}
    def table(self, name): return _FakeTable(self.sink)


def test_persist_writes_sections_column():
    client = _FakeClient()
    result = ScoreResult(
        score_problem=5.0, score_solution=5.0, score_tech=5.0,
        score_founders=5.0, score_commitment=5.0, score_overall=5.0,
        summary="s", model="m", raw_response="{}",
        sections={"problem": ["a", "b", "c"], "solution": [], "moats": [], "watchouts": []},
    )
    pipeline.persist(client, "app-1", "tir", result, advance_status=False)
    assert client.sink["ai_screening"]["sections"] == {
        "problem": ["a", "b", "c"], "solution": [], "moats": [], "watchouts": []
    }


def test_persist_sections_defaults_to_none():
    client = _FakeClient()
    result = ScoreResult(
        score_problem=5.0, score_solution=5.0, score_tech=5.0,
        score_founders=5.0, score_commitment=5.0, score_overall=5.0,
        summary="s", model="m", raw_response="{}",
    )
    pipeline.persist(client, "app-1", "tir", result, advance_status=False)
    # When sections weren't generated (None), the key is OMITTED from the upsert
    # so a failed re-run never NULLs previously-good sections.
    assert "sections" not in client.sink["ai_screening"]


def test_run_for_application_attaches_sections(monkeypatch):
    from app.services.ai_pipeline import pipeline as pl

    class _AppTable:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def maybe_single(self): return self
        def execute(self):
            return type("R", (), {"data": {"id": "app-1", "problem_describe": "x"}})()

    class _Client:
        def table(self, name): return _AppTable()

    monkeypatch.setattr(pl, "_classify", lambda *a, **k: {"project_name": "P"})
    monkeypatch.setattr(pl, "_score", lambda *a, **k: (
        {"problem_impact": {"score": 5.0}, "completeness": {"score": 5.0},
         "technical_depth": {"score": 5.0}, "behavioural": {"score": 5.0},
         "commitment": {"score": 5.0}}, ""))
    monkeypatch.setattr(pl, "_summarize", lambda *a, **k: ("summary", ""))
    monkeypatch.setattr(pl, "_sections", lambda *a, **k: {"problem": ["a", "b", "c"]})

    result = pl.run_for_application("app-1", "tir", client=_Client())
    assert result.sections == {"problem": ["a", "b", "c"]}
