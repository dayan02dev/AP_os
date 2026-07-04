from app.services.founder_check import graph as fc_graph
from app.services.founder_check import client as fc_client


def test_parse_verdict_extracts_all_four_fields():
    raw = (
        "Verdict: EXCEPTIONAL (+ confidence: HIGH)\n"
        "Top signals: IISc PhD, granted patent, DRDO pilot\n"
        "Gaps/red flags: no first-team hire\n"
        "What's rare: hardware + enterprise contract pre-team"
    )
    d = fc_graph.parse_verdict(raw)
    assert d["verdict"] == "EXCEPTIONAL"
    assert d["confidence"] == "HIGH"
    assert d["top_signals"] == "IISc PhD, granted patent, DRDO pilot"
    assert d["gaps"] == "no first-team hire"
    assert d["whats_rare"] == "hardware + enterprise contract pre-team"


def test_parse_verdict_multiword_verdict_and_med():
    d = fc_graph.parse_verdict("Verdict: INSUFFICIENT DATA (confidence: MED)")
    assert d["verdict"] == "INSUFFICIENT DATA"
    assert d["confidence"] == "MED"


def test_parse_verdict_defaults_when_unparseable():
    d = fc_graph.parse_verdict("garbage output")
    assert d["verdict"] == "INSUFFICIENT DATA"
    assert d["confidence"] == "LOW"


def test_parse_json_strips_fence_and_repairs():
    assert fc_graph._parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert fc_graph._parse_json('{"a": 1,}') == {"a": 1}   # trailing comma repaired
    assert fc_graph._parse_json("not json at all") == {}


def test_extract_node_unsupported_mime_returns_empty(monkeypatch):
    out = fc_graph._extract_node({"resume_bytes": b"x", "mime": "application/msword"})
    assert out["resume_json"] == {}
    assert "unsupported" in out["error"].lower()


def test_extract_node_pdf_calls_ocr(monkeypatch):
    monkeypatch.setattr(fc_client, "ocr_pdf_to_json",
                        lambda b, p: '{"name": "A", "roles": []}')
    out = fc_graph._extract_node({"resume_bytes": b"%PDF", "mime": "application/pdf"})
    assert out["resume_json"] == {"name": "A", "roles": []}


def test_scout_node_empty_json_is_insufficient():
    out = fc_graph._scout_node({"resume_json": {}})
    assert out["verdict"]["verdict"] == "INSUFFICIENT DATA"
    assert out["verdict"]["confidence"] == "LOW"


def test_scout_node_calls_model(monkeypatch):
    monkeypatch.setattr(fc_client, "scout",
                        lambda j, p: "Verdict: STRONG (confidence: MED)\nTop signals: x")
    out = fc_graph._scout_node({"resume_json": {"name": "A"}})
    assert out["verdict"]["verdict"] == "STRONG"


def test_build_graph_runs_end_to_end(monkeypatch):
    monkeypatch.setattr(fc_client, "ocr_pdf_to_json", lambda b, p: '{"name": "A"}')
    monkeypatch.setattr(fc_client, "scout",
                        lambda j, p: "Verdict: PROMISING (confidence: HIGH)")
    g = fc_graph.build_graph()
    state = g.invoke({"resume_bytes": b"%PDF", "mime": "application/pdf"})
    assert state["verdict"]["verdict"] == "PROMISING"
