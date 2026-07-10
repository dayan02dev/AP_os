from tests.fixtures.fake_supabase import FakeSupabase
from app.services.jury_enrichment import graph as je_graph, run as je_run


def _fake_post_factory(research_text, profile_json, domains_json):
    calls = []
    def _post(messages, *, model=None, json_mode=False):
        calls.append({"model": model, "json_mode": json_mode})
        if len(calls) == 1: return research_text
        if len(calls) == 2: return profile_json
        return domains_json
    return _post, calls

def test_graph_happy_path(monkeypatch):
    post, calls = _fake_post_factory(
        "Dr Rao is a robotics professor at IISc. [source: iisc.ac.in]",
        '{"summary":"Robotics professor","current_role":"Professor, IISc",'
        '"organizations":["IISc"],"education":["PhD"],"notable":[],"years_experience":15,'
        '"sources":["https://iisc.ac.in"]}',
        '{"domains":["Robotics & Automation"],"confidence":"HIGH"}')
    monkeypatch.setattr(je_graph, "_post", post)
    out = je_graph.build_graph().invoke({
        "name": "Dr Rao", "self_domains": ["robotics"], "linkedin_url": None,
        "taxonomy": ["Robotics & Automation", "HealthTech"]})
    assert out["profile"]["summary"] == "Robotics professor"
    assert out["domains"] == ["Robotics & Automation"]
    assert calls[0]["model"].endswith(":online")     # research call is web-grounded
    assert calls[1]["json_mode"] and calls[2]["json_mode"]

def test_graph_llm_failure_sets_error(monkeypatch):
    def _boom(messages, **kw): raise RuntimeError("llm down")
    monkeypatch.setattr(je_graph, "_post", _boom)
    out = je_graph.build_graph().invoke({"name": "X", "self_domains": [], "taxonomy": []})
    assert out.get("error")

def test_run_and_persist_success(monkeypatch):
    fake = FakeSupabase({
        "jury_profiles": [{"juror_user_id": "j1", "expertise_domains": ["ml"],
                           "linkedin_url": None, "enrichment_status": "pending"}],
        "profiles": [{"id": "j1", "full_name": "Dr Rao", "email": "r@x.com"}],
        "industry_categories": [{"id": "c1", "label": "Robotics & Automation"}],
    })
    monkeypatch.setattr(je_run, "get_admin_client", lambda: fake)
    monkeypatch.setattr(je_run, "_invoke_graph", lambda state: {
        "profile": {"summary": "s", "sources": []}, "domains": ["Robotics & Automation"]})
    called = []
    monkeypatch.setattr(je_run, "_run_matching", lambda client, jid: called.append(jid))
    assert je_run.run_and_persist("j1") is True
    row = fake.tables["jury_profiles"][0]
    assert row["enrichment_status"] == "done"
    assert row["enrichment"]["summary"] == "s"
    assert row["expertise_domains"] == ["Robotics & Automation"]
    assert called == ["j1"]                                    # matching chained

def test_run_failure_marks_failed(monkeypatch):
    fake = FakeSupabase({"jury_profiles": [{"juror_user_id": "j2", "enrichment_status": "pending"}],
                         "profiles": [{"id": "j2", "full_name": "Y", "email": "y@x.com"}],
                         "industry_categories": []})
    monkeypatch.setattr(je_run, "get_admin_client", lambda: fake)
    def _boom(state): raise RuntimeError("nope")
    monkeypatch.setattr(je_run, "_invoke_graph", _boom)
    assert je_run.run_and_persist("j2") is False
    assert fake.tables["jury_profiles"][0]["enrichment_status"] == "failed"
