from app.services.founder_check import client as fc_client


def test_ocr_pdf_builds_file_part_and_json_mode(monkeypatch):
    captured = {}

    def fake_post(messages, *, json_mode):
        captured["messages"] = messages
        captured["json_mode"] = json_mode
        return '{"ok": true}'

    monkeypatch.setattr(fc_client, "_post", fake_post)
    out = fc_client.ocr_pdf_to_json(b"%PDF-1.4 fake", "EXTRACT PROMPT")

    assert out == '{"ok": true}'
    assert captured["json_mode"] is True
    user_msg = captured["messages"][1]
    parts = user_msg["content"]
    file_part = next(p for p in parts if p["type"] == "file")
    assert file_part["file"]["file_data"].startswith("data:application/pdf;base64,")


def test_structure_text_uses_json_mode(monkeypatch):
    captured = {}
    monkeypatch.setattr(fc_client, "_post",
                        lambda messages, *, json_mode: captured.update(
                            messages=messages, json_mode=json_mode) or "{}")
    fc_client.structure_text_to_json("some resume text", "EXTRACT PROMPT")
    assert captured["json_mode"] is True
    assert "some resume text" in captured["messages"][1]["content"]


def test_scout_is_plain_text_mode(monkeypatch):
    captured = {}
    monkeypatch.setattr(fc_client, "_post",
                        lambda messages, *, json_mode: captured.update(
                            json_mode=json_mode) or "Verdict: STRONG")
    out = fc_client.scout('{"x": 1}', "SCOUT PROMPT")
    assert out == "Verdict: STRONG"
    assert captured["json_mode"] is False
