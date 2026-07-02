from app.services.email_service import get_email_service, missing_label


def test_missing_label():
    assert missing_label(True, True) == "résumé and LinkedIn profile"
    assert missing_label(True, False) == "résumé"
    assert missing_label(False, True) == "LinkedIn profile"


def test_render_profile_completion(monkeypatch):
    svc = get_email_service()
    sent = {}
    monkeypatch.setattr(svc, "send_raw", lambda **kw: sent.update(kw) or {"message_id": "m", "status": "sent"})
    svc.send_profile_completion_request(
        to="a@b.com", applicant_name="Asha", needs_resume=True, needs_linkedin=False,
        link_url="https://apply.artpark.info/apply/profile-completion/tok123",
    )
    assert sent["to"] == ["a@b.com"]
    assert "résumé" in sent["html"]
    assert "tok123" in sent["html"]
    assert "Asha" in sent["text"]
    assert "24 hours" in sent["html"].lower() or "24 hours" in sent["text"].lower()
