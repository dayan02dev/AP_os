"""Founder portal endpoints: MOU sign flow + CRUD (added across Tasks 8-10)."""
from __future__ import annotations

import base64

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase

_PNG = "data:image/png;base64," + base64.b64encode(base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)).decode()


def _all_acks() -> list[str]:
    from app.services import founder_mou
    return list(founder_mou.REQUIRED_ACK_IDS)


_ONE_COLLABORATOR = [
    {"name": "Priya", "pan": "ABCDE1234F", "parent_name": "Rajesh", "address": "1 MG Road, Bengaluru"},
]
_TWO_COLLABORATORS = _ONE_COLLABORATOR + [
    {"name": "Kiran Shah", "pan": "PQRSX5678L", "parent_name": "Manoj Shah", "address": "4 Church St, Bengaluru"},
]
_THREE_COLLABORATORS = _TWO_COLLABORATORS + [
    {"name": "Divya Nair", "pan": "LMNOQ9012Z", "parent_name": "Ravi Nair", "address": "9 Brigade Rd, Bengaluru"},
]


def _sign_body(**over) -> dict:
    """A complete, valid sign payload — all four acknowledgements ticked,
    one collaborator's party details supplied."""
    return {"signer_name": "Priya", "signature_png": _PNG,
            "acknowledgements": _all_acks(), "collaborators": _ONE_COLLABORATOR, **over}


class _Bucket:
    def __init__(self, uploaded_paths):
        self._uploaded_paths = uploaded_paths

    def upload(self, path, *a, **k):
        # Recorded so tests can assert an agreement's PDF was ACTUALLY
        # uploaded, not merely that its signed-url is derivable (the fake
        # create_signed_url below is happy to sign a path for a file that
        # was never uploaded, so that alone can't prove the upload ran).
        self._uploaded_paths.append(path)
        return {"path": path}

    def create_signed_url(self, path, expires_in): return {"signedURL": f"https://x/{path}"}


class _Storage:
    def __init__(self):
        self.uploaded_paths: list[str] = []

    def from_(self, bucket): return _Bucket(self.uploaded_paths)


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _override_user(uid):
    def _f():
        return {"user_id": uid, "email": f"{uid}@x.com", "track": "tir", "roles": ["applicant"]}
    return _f


def _install(monkeypatch, tables):
    from app.routers import founder as fr
    from app.services import founder_mou, founder_query, state_machine
    fake = FakeSupabase(tables)
    fake.storage = _Storage()
    for mod in (fr, founder_mou, founder_query, state_machine):
        monkeypatch.setattr(mod, "get_admin_client", lambda: fake)
    return fake


def test_sign_mou_flips_status_to_onboarded(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "offered",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "profiles": [{"id": "u1", "full_name": "Priya"}],
        "founder_mou": [],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json=_sign_body())
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "onboarded"
    # status actually mutated in the fake store
    assert fake.tables["tir_applications"][0]["status"] == "onboarded"
    assert fake.tables["founder_mou"] and fake.tables["founder_mou"][0]["signed_pdf_path"]
    # the accepted acknowledgements are persisted on the row
    assert fake.tables["founder_mou"][0]["acknowledgements"] == _all_acks()


def test_sign_mou_twice_is_conflict(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "profiles": [{"id": "u1", "full_name": "Priya"}],
        "founder_mou": [{"application_id": "app1", "signer_name": "Priya",
                         "signed_pdf_path": "app1/mou/signed.pdf", "signed_at": "2026-07-10"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json=_sign_body())
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "mou_already_signed"


# ── acknowledgement gate on the sign endpoint ─────────────────────────


def _offered_tables() -> dict:
    return {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "offered",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "profiles": [{"id": "u1", "full_name": "Priya"}],
        "founder_mou": [],
        "application_status_log": [],
    }


def test_sign_without_acknowledgements_is_422(client, monkeypatch, _clear):
    fake = _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign",
                    json={"signer_name": "Priya", "signature_png": _PNG,
                          "collaborators": _ONE_COLLABORATOR})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "acknowledgements_required"
    assert set(r.json()["detail"]["missing"]) == set(_all_acks())
    # nothing was written and the status did NOT move
    assert fake.tables["founder_mou"] == []
    assert fake.tables["tir_applications"][0]["status"] == "offered"


def test_sign_with_partial_acknowledgements_is_422(client, monkeypatch, _clear):
    fake = _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    partial = [i for i in _all_acks() if i != "additional_funding_equity"]
    r = client.post("/founder/mou/sign", json=_sign_body(acknowledgements=partial))
    assert r.status_code == 422
    assert r.json()["detail"]["missing"] == ["additional_funding_equity"]
    assert fake.tables["tir_applications"][0]["status"] == "offered"


def test_get_mou_serves_the_acknowledgement_checklist(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/mou")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [a["id"] for a in body["acknowledgements"]] == _all_acks()
    assert all(a["text"].strip() for a in body["acknowledgements"])
    assert body["accepted_acknowledgements"] == []


# ── agreements catalog + preview (Task 7) ──────────────────────────────


def test_get_mou_includes_the_track_agreement_catalog(client, monkeypatch, _clear):
    """Same catalog pattern as the AIR surface: field labels come from the
    backend, not hardcoded frontend copy."""
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/mou").json()
    slugs = [a["slug"] for a in body["agreements"]]
    assert slugs == ["facility-v1", "collaboration-v1"], "TIR signs both, in TRACK_AGREEMENTS order"
    for entry in body["agreements"]:
        assert entry["min_collaborators"] == 1 and entry["max_collaborators"] == 3
        field_keys = [f["key"] for f in entry["fields"]]
        assert field_keys == ["name", "pan", "parent_name", "address"]


def test_get_mou_reports_current_version_before_anything_is_signed(client, monkeypatch, _clear):
    """Not started: nothing has happened yet, so this is informational
    ('what would I be signing'), never a record of a real event."""
    from app.services import agreements
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/mou").json()
    assert body["signed"] is False
    assert body["template_version"] == ",".join(agreements.TRACK_AGREEMENTS["tir"])


def test_get_mou_reports_the_signed_rows_own_version_not_the_current_constant(client, monkeypatch, _clear):
    """The exact bug this task fixes: production holds one founder_mou row
    signed under 'tir-mou-v2'. It must keep reporting that value forever,
    never the current code's idea of what the latest version is — even
    though the current version now looks completely different in shape
    (comma-joined agreement slugs, not a single free-text version tag)."""
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "founder_mou": [{"application_id": "app1", "signer_name": "OOOO",
                         "template_version": "tir-mou-v2", "signed_pdf_path": "app1/mou/signed.pdf",
                         "signed_at": "2026-08-13", "acknowledgements": []}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/mou").json()
    assert body["template_version"] == "tir-mou-v2"
    assert body["signed"] is True


def test_preview_mou_renders_every_track_agreement_from_one_set_of_details(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/preview", json={"collaborators": _ONE_COLLABORATOR})
    assert r.status_code == 200, r.text
    previews = r.json()["previews"]
    assert [p["slug"] for p in previews] == ["facility-v1", "collaboration-v1"]
    for p in previews:
        assert "Priya" in p["rendered_text"]
        assert "[•]" not in p["rendered_text"]


def test_preview_mou_rejects_zero_collaborators(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/preview", json={"collaborators": []})
    assert r.status_code == 422


def test_preview_mou_rejects_more_than_three_collaborators(client, monkeypatch, _clear):
    """Asserts the pydantic-shaped (list) detail specifically -- proving
    the MouPreviewRequest bound itself catches this, not only
    agreements.py's own independent 1-3 check (which preview_mou also
    guards against turning into a 500, see its ValueError handler)."""
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/preview", json={"collaborators": _THREE_COLLABORATORS + [
        {"name": "Extra", "pan": "ZZZZZ0000Z", "parent_name": "X", "address": "Y"}
    ]})
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list), r.json()


# ── live PDF preview (embedded-document redesign) ────────────────────────


def test_preview_mou_pdf_returns_real_pdf_bytes(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post(
        "/founder/mou/preview/pdf?slug=facility-v1",
        json={"collaborators": _ONE_COLLABORATOR},
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.content[:5] == b"%PDF-"


def test_preview_mou_pdf_works_before_any_signature_is_drawn(client, monkeypatch, _clear):
    """The whole point: this must succeed with no signer_name and no
    signature_png at all -- the founder hasn't reached the Sign step yet."""
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post(
        "/founder/mou/preview/pdf?slug=collaboration-v1",
        json={"collaborators": _ONE_COLLABORATOR},
    )
    assert r.status_code == 200, r.text
    assert r.content[:5] == b"%PDF-"


def test_preview_mou_pdf_embeds_the_signature_once_drawn(client, monkeypatch, _clear):
    """The deliverable: once a signature is drawn (but before Sign &
    Submit), the SAME preview call embeds it in the document."""
    import io as _io

    from pypdf import PdfReader

    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")

    without = client.post(
        "/founder/mou/preview/pdf?slug=facility-v1",
        json={"collaborators": _ONE_COLLABORATOR},
    )
    with_sig = client.post(
        "/founder/mou/preview/pdf?slug=facility-v1",
        json={"collaborators": _ONE_COLLABORATOR, "signer_name": "Priya", "signature_png": _PNG},
    )
    assert without.status_code == 200 and with_sig.status_code == 200

    without_images = list(PdfReader(_io.BytesIO(without.content)).pages[-1].images)
    with_images = list(PdfReader(_io.BytesIO(with_sig.content)).pages[-1].images)
    assert without_images == []
    assert len(with_images) == 1


def test_preview_mou_pdf_unknown_slug_is_404(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post(
        "/founder/mou/preview/pdf?slug=not-a-real-agreement",
        json={"collaborators": _ONE_COLLABORATOR},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "unknown_agreement"


def test_preview_mou_pdf_rejects_a_malformed_signature_with_its_own_code(client, monkeypatch, _clear):
    """A bad signature_png must surface as invalid_signature, not the
    collaborator-shaped invalid_collaborators code -- the frontend maps
    each to different copy (lib/founderApi.js mouErrorCopy)."""
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post(
        "/founder/mou/preview/pdf?slug=facility-v1",
        json={
            "collaborators": _ONE_COLLABORATOR,
            "signer_name": "Priya",
            "signature_png": "data:image/gif;base64,AAAA",
        },
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_signature"


def test_preview_mou_pdf_rejects_zero_collaborators(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/preview/pdf?slug=facility-v1", json={"collaborators": []})
    assert r.status_code == 422


def test_sign_rejects_a_malformed_pan(client, monkeypatch, _clear):
    """Correct LENGTH (10 chars) but wrong FORMAT (all digits, no letters)
    -- this must be caught by the PAN regex validator itself, not by the
    min/max_length=10 constraint (which a 10-digit string already satisfies
    and would let a format-invalid PAN silently through)."""
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    bad = [{**_ONE_COLLABORATOR[0], "pan": "1234567890"}]
    r = client.post("/founder/mou/sign", json=_sign_body(collaborators=bad))
    assert r.status_code == 422


# ── multi-agreement signing (Task 7) ────────────────────────────────────


def test_sign_mou_stamps_every_track_agreement_as_the_version(client, monkeypatch, _clear):
    from app.services import agreements
    fake = _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json=_sign_body())
    assert r.status_code == 200, r.text
    assert fake.tables["founder_mou"][0]["template_version"] == ",".join(agreements.TRACK_AGREEMENTS["tir"])


def test_sign_mou_with_three_collaborators_succeeds(client, monkeypatch, _clear):
    fake = _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json=_sign_body(collaborators=_THREE_COLLABORATORS))
    assert r.status_code == 200, r.text
    assert fake.tables["founder_mou"][0]["signed_pdf_path"]


def test_sign_mou_rejects_four_collaborators(client, monkeypatch, _clear):
    """The model-level bound itself, not agreements.py's own internal 1-3
    check (a second, independent guard — sign_and_onboard would also 422
    via that ValueError path even with this model bound relaxed, so we
    assert the pydantic validation-error SHAPE specifically: a list under
    "detail", not the service layer's {"code": "invalid_signature", ...}
    dict — to prove THIS guard, not just "some" guard, caught it)."""
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    four = _THREE_COLLABORATORS + [{"name": "Extra", "pan": "AAAAA1111A", "parent_name": "X", "address": "Y"}]
    r = client.post("/founder/mou/sign", json=_sign_body(collaborators=four))
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list), r.json()


def test_sign_mou_generates_a_retrievable_pdf_for_every_track_agreement(client, monkeypatch, _clear):
    """The deliverable: sign once, get every agreement's PDF back,
    individually, afterwards."""
    from app.services import agreements
    fake = _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json=_sign_body())
    assert r.status_code == 200, r.text

    slugs = agreements.TRACK_AGREEMENTS["tir"]
    # A real upload happened for EVERY agreement's PDF — not just that a
    # signed-url can be derived for its path (the fake create_signed_url
    # would happily sign a path nothing was ever uploaded to).
    for slug in slugs:
        assert f"app1/mou/{slug}.pdf" in fake.storage.uploaded_paths, (
            f"expected an actual upload for {slug}, got {fake.storage.uploaded_paths}"
        )

    urls = {}
    for slug in slugs:
        resp = client.get(f"/founder/mou/signed-url?agreement={slug}")
        assert resp.status_code == 200, resp.text
        urls[slug] = resp.json()["url"]
    # every agreement resolves to its OWN distinct document
    assert len(set(urls.values())) == len(slugs)

    # the no-slug default still works (backward compatible) and matches
    # the primary (first) agreement's document
    default_url = client.get("/founder/mou/signed-url").json()["url"]
    assert default_url == urls[slugs[0]]


def test_signed_url_for_an_agreement_the_track_never_requires_is_404(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    client.post("/founder/mou/sign", json=_sign_body())
    r = client.get("/founder/mou/signed-url?agreement=not-a-real-agreement")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "unknown_agreement"


def test_signed_url_before_signing_is_mou_not_signed(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/mou/signed-url")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "mou_not_signed"
    r2 = client.get("/founder/mou/signed-url?agreement=collaboration-v1")
    assert r2.status_code == 404
    assert r2.json()["detail"]["code"] == "mou_not_signed", (
        "before ANY signing, every agreement is 'nothing signed yet', not "
        "'this specific agreement was skipped'"
    )


def test_signed_url_for_the_legacy_row_only_serves_its_own_recorded_path(client, monkeypatch, _clear):
    """The one production row (template_version='tir-mou-v2') never
    produced per-slug PDFs — asking for a specific new-style agreement
    against it must be a distinct 'agreement not signed' 404, not a guess
    at a path that was never generated, and not a silent 200."""
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "founder_mou": [{"application_id": "app1", "signer_name": "OOOO",
                         "template_version": "tir-mou-v2", "signed_pdf_path": "app1/mou/signed.pdf",
                         "signed_at": "2026-08-13", "acknowledgements": []}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    default = client.get("/founder/mou/signed-url")
    assert default.status_code == 200
    assert default.json()["url"] == "https://x/app1/mou/signed.pdf"

    specific = client.get("/founder/mou/signed-url?agreement=facility-v1")
    assert specific.status_code == 404
    assert specific.json()["detail"]["code"] == "agreement_not_signed"


def test_me_reports_mou_signed_and_unlocked(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "profiles": [{"id": "u1", "full_name": "Priya"}],
        "founder_mou": [{"application_id": "app1", "signed_pdf_path": "x", "signed_at": "2026-07-10"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    body = r.json()
    assert body["mou_signed"] is True
    assert body["locked"] == {"cohort": False, "dashboard": False}


# ── original source .docx download (MOU tab rebuild) ────────────────────


def test_mou_source_docx_returns_a_signed_url_not_the_bytes(client, monkeypatch, _clear):
    """The original .docx comes back as a signed storage URL.

    It used to be streamed as response bytes, which worked for the 55KB
    Facility Agreement and returned a bare 500 in production for the 7.9MB
    Collaboration Agreement: API Gateway caps a Lambda response payload at
    6MB. A size cliff, not a code-path difference — which is why it looked
    like "one document is broken". Signed URLs go straight from storage to
    the browser and have no such ceiling.
    """
    from app.services import founder_mou as fm

    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")

    seen: list[str] = []

    def _fake_signed(slug, ttl_seconds=300):
        seen.append(slug)
        return f"https://signed.example/{slug}.docx"

    monkeypatch.setattr(fm, "source_docx_signed_url", _fake_signed)

    r = client.get("/founder/mou/source?agreement=facility-v1")
    assert r.status_code == 200, r.text
    assert r.json() == {"url": "https://signed.example/facility-v1.docx"}
    assert seen == ["facility-v1"], "the requested slug must be the one signed"
    # The bytes must NOT come back through the API — that is the whole point.
    assert "officedocument" not in r.headers.get("content-type", "")


def test_source_docx_signed_url_uploads_the_committed_file_when_absent(monkeypatch):
    """First request in a fresh environment uploads the committed source,
    so no environment needs a seeding step and a new project self-heals."""
    from app.services import agreements, founder_mou as fm

    uploaded: dict = {}

    class _Bucket:
        def __init__(self):
            self.have = False

        def create_signed_url(self, path, ttl):
            if not self.have:
                raise RuntimeError("Object not found")
            return {"signedURL": f"https://signed.example/{path}"}

        def upload(self, path, data, opts):
            uploaded["path"] = path
            uploaded["bytes"] = len(data)
            self.have = True

    bucket = _Bucket()
    monkeypatch.setattr(fm, "get_admin_client", lambda: type("C", (), {"storage": type("S", (), {"from_": staticmethod(lambda _b: bucket)})()})())

    url = fm.source_docx_signed_url("facility-v1")
    assert url.startswith("https://signed.example/")
    assert uploaded["path"].endswith(".docx")
    assert uploaded["bytes"] == len(agreements.source_docx_path("facility-v1").read_bytes()), \
        "must upload the real committed file, byte for byte"


def test_mou_source_docx_unknown_agreement_is_404(client, monkeypatch, _clear):
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/mou/source?agreement=not-a-real-agreement")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "unknown_agreement"


def test_mou_source_docx_requires_founder_access(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "submitted",
                              "grant_amount": 0, "submitted_at": "2026-07-01"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/mou/source?agreement=facility-v1")
    assert r.status_code == 403


# ── venture name on the signature page (MOU tab rebuild) ────────────────


def test_sign_mou_forwards_venture_name_into_every_rendered_agreement(client, monkeypatch, _clear):
    from app.services import agreements
    calls = []
    real_render = agreements.render_agreement_pdf

    def _spy(**kwargs):
        calls.append(kwargs)
        return real_render(**kwargs)

    monkeypatch.setattr(agreements, "render_agreement_pdf", _spy)
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json=_sign_body(venture_name="Sarva Robotics"))
    assert r.status_code == 200, r.text
    assert len(calls) == 2, "one render per TIR track agreement"
    assert all(c.get("venture_name") == "Sarva Robotics" for c in calls)


def test_sign_mou_without_venture_name_still_succeeds(client, monkeypatch, _clear):
    """venture_name is optional -- omitting it entirely must not 422."""
    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json=_sign_body())
    assert r.status_code == 200, r.text


def test_preview_mou_pdf_embeds_venture_name_on_the_signature_page(client, monkeypatch, _clear):
    import io as _io

    from pypdf import PdfReader

    _install(monkeypatch, _offered_tables())
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post(
        "/founder/mou/preview/pdf?slug=facility-v1",
        json={"collaborators": _ONE_COLLABORATOR, "venture_name": "Sarva Robotics"},
    )
    assert r.status_code == 200, r.text
    text = PdfReader(_io.BytesIO(r.content)).pages[-1].extract_text() or ""
    assert "Sarva Robotics" in text


def test_team_crud_roundtrip(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "founder_team_members": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/team", json={"name": "Arjun", "title": "CTO",
                                           "employment_type": "full-time", "monthly_cost": 170000})
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert client.get("/founder/team").json()[0]["name"] == "Arjun"
    assert client.patch(f"/founder/team/{rid}", json={"monthly_cost": 175000}).status_code == 200
    assert client.delete(f"/founder/team/{rid}").status_code == 204


def test_cannot_edit_another_apps_row(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "founder_team_members": [{"id": "row-other", "application_id": "app-OTHER", "name": "X"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.patch("/founder/team/row-other", json={"monthly_cost": 1})
    assert r.status_code == 404


def test_expense_bundle_totals_and_budget(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "founder_bom_items": [{"id": "b1", "application_id": "app1", "qty": 6, "unit_cost": 8500}],
        "founder_equipment_items": [{"id": "e1", "application_id": "app1", "cost": 220000}],
        "founder_procurement_items": [
            {"id": "p1", "application_id": "app1", "estimate": 8500, "quote": 8200, "status": "quoted"},
            {"id": "p2", "application_id": "app1", "estimate": 15500, "quote": 0, "status": "estimate"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/expense").json()
    assert body["totals"]["bom_total"] == 51000
    assert body["totals"]["equipment_total"] == 220000
    assert body["budget_drawn"] == 8200          # only committed (quoted) counts
    assert body["budget_pct"] == 0               # 8200 / 2.5M rounds to 0


def test_dashboard_onboarding_pct(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "founder_team_members": [{"id": "m1", "application_id": "app1", "monthly_cost": 180000}],
        "founder_bom_items": [], "founder_equipment_items": [], "founder_procurement_items": [],
        "founder_mou": [{"application_id": "app1", "signed_pdf_path": "x"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/dashboard").json()
    assert body["onboarding_pct"] == 100
    assert body["payroll_monthly"] == 180000
    assert body["payroll_annual"] == 2160000
