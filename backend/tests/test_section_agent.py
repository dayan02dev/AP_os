from app.services.ai_pipeline.section_agent import SectionAgent, SECTIONS


def test_parse_strips_bullet_markers():
    agent = SectionAgent()
    raw = "- First point\n* Second point\n3. Third point\n\n• Fourth"
    assert agent.parse(raw) == ["First point", "Second point", "Third point", "Fourth"]


def test_parse_drops_code_fence_and_language_line():
    agent = SectionAgent()
    raw = "```markdown\n- a\n- b\n- c\n```"
    assert agent.parse(raw) == ["a", "b", "c"]


def test_validate_section_rejects_too_few_and_too_many():
    agent = SectionAgent()
    assert agent._validate_section(["one", "two"])
    assert agent._validate_section(["a", "b", "c", "d", "e", "f"])
    assert agent._validate_section(["a", "b", "c"]) == []


def test_validate_section_rejects_overlong_bullet():
    agent = SectionAgent()
    long_bullet = " ".join(["word"] * 50)
    assert agent._validate_section([long_bullet, "b", "c"])


def test_run_returns_four_sections(monkeypatch):
    agent = SectionAgent()
    monkeypatch.setattr(agent, "_call_api", lambda messages: "- alpha\n- beta\n- gamma")
    result, flags = agent.run("app-1", app_text="some text", no_cache=True)
    assert set(result.keys()) == set(SECTIONS)
    assert result["problem"] == ["alpha", "beta", "gamma"]
    assert flags == ""


def test_run_mock_mode():
    agent = SectionAgent()
    result, flags = agent.run("app-1", app_text="x", mock=True)
    assert set(result.keys()) == set(SECTIONS)
    assert all(len(result[s]) >= 3 for s in SECTIONS)
    assert flags == ""
