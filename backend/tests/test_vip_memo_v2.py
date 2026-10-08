"""VIP memo v2 ("Navigator") — read service, exporters and the three surfaces'
GET + download routes. Hermetic: FakeSupabase + a synthetic fixture company
("Acme Robotics"); no real applicant content.
"""
from __future__ import annotations

import copy
import io
import json
from pathlib import Path

import pytest
from docx import Document
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.deps import get_current_user
from app.main import app
from app.services import vip_memo, vip_memo_v2, vip_memo_v2_export
from tests.fixtures.fake_supabase import FakeSupabase

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json").read_text())
PILOT = sorted(vip_memo.PILOT_APPLICATION_IDS)[0]
OTHER_PILOT = sorted(vip_memo.PILOT_APPLICATION_IDS)[1]
NON_PILOT = "99999999-9999-9999-9999-999999999999"

SECTION_TITLES = (
    "Deal snapshot",
    "What does this company do",
    "Why this solution matters",
    "The product",
    "Technology edge",
    "Competitive landscape",
    "Addressable market",
    "Founding team",
    "Milestones",
    "Use of funds",
    "Key risks & mitigants",
    "IC recommendation",
    "Questions for the founders",
    "IC Reviewer Notes",
)
REVIEWER_AREAS = (
    "Moats & Defensibility", "Red Flags", "Commercial Viability", "Team Assessment",
    "Funding & Structure", "Technical Validation", "Go-to-Market Clarity",
    "IP & Entity Structure", "Follow-on Fundability", "Overall Verdict",
)


def _ai_row(app_id: str, memo: dict | None = None, track: str = "sip") -> dict:
    return {
        "application_id": app_id,
        "application_track": track,
        "sections": {"vip_memo_v2": copy.deepcopy(memo if memo is not None else FIXTURE)},
    }


@pytest.fixture
def fake(monkeypatch):
    sb = FakeSupabase({"ai_screening": [_ai_row(PILOT), _ai_row(NON_PILOT)]})
    monkeypatch.setattr(vip_memo_v2, "get_admin_client", lambda: sb)
    return sb


# ─── service ────────────────────────────────────────────────────────────

def test_get_memo_v2_returns_stored_memo_for_pilot(fake):
    memo = vip_memo_v2.get_memo_v2(PILOT)
    assert memo is not None
    assert memo["name"] == "Acme Robotics"
    assert memo["version"] == 2


def test_get_memo_v2_is_pilot_only(fake):
    assert vip_memo_v2.get_memo_v2(NON_PILOT) is None


def test_get_memo_v2_missing_row_returns_none(fake):
    assert vip_memo_v2.get_memo_v2(OTHER_PILOT) is None


def test_get_memo_v2_ignores_tir_track_rows(monkeypatch):
    sb = FakeSupabase({"ai_screening": [_ai_row(PILOT, track="tir")]})
    monkeypatch.setattr(vip_memo_v2, "get_admin_client", lambda: sb)
    assert vip_memo_v2.get_memo_v2(PILOT) is None


@pytest.mark.parametrize("mutate", [
    lambda m: m.update(version=1),
    lambda m: m.pop("sections"),
    lambda m: m.update(sections="nope"),
    lambda m: m["sections"].pop("risks"),
    lambda m: m.pop("name"),
])
def test_get_memo_v2_rejects_bad_shape(monkeypatch, mutate):
    memo = copy.deepcopy(FIXTURE)
    mutate(memo)
    sb = FakeSupabase({"ai_screening": [_ai_row(PILOT, memo)]})
    monkeypatch.setattr(vip_memo_v2, "get_admin_client", lambda: sb)
    assert vip_memo_v2.get_memo_v2(PILOT) is None


def test_get_memo_v2_never_raises(monkeypatch):
    def boom():
        raise RuntimeError("db down")
    monkeypatch.setattr(vip_memo_v2, "get_admin_client", boom)
    assert vip_memo_v2.get_memo_v2(PILOT) is None


def test_download_filename_is_sanitised():
    assert vip_memo_v2.download_filename({"name": "Acme Robotics"}, "pdf") == "Acme_Robotics_IC_Memo.pdf"
    assert vip_memo_v2.download_filename({"name": 'A/b "c"'}, "docx") == "A_b_c_IC_Memo.docx"
    assert vip_memo_v2.download_filename({}, "pdf") == "VIP_IC_Memo.pdf"


# ─── exporters ──────────────────────────────────────────────────────────

def _docx_text(body: bytes) -> tuple[str, str]:
    doc = Document(io.BytesIO(body))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
    header = " ".join(p.text for s in doc.sections for p in s.header.paragraphs)
    return "\n".join(parts), header


def test_render_docx_v2_has_header_and_all_sections():
    body = vip_memo_v2_export.render_docx_v2(FIXTURE)
    assert body[:2] == b"PK"
    text, header = _docx_text(body)
    assert "CONFIDENTIAL" in header
    for title in SECTION_TITLES + REVIEWER_AREAS:
        assert title in text, title
    assert "Acme Robotics" in text
    assert "Acme Robotics advantage" in text
    assert "Reviewer Name" in text and "Signature" in text
    assert "Prepared by: Test fixture team" in text
    assert "CONDITIONAL APPROVAL" in text
    doc = Document(io.BytesIO(body))
    sec = doc.sections[0]
    assert round(sec.page_width.inches, 1) == 8.5
    assert round(sec.left_margin.inches, 1) == 0.8


def test_render_pdf_v2_has_header_and_all_sections():
    body = vip_memo_v2_export.render_pdf_v2(FIXTURE)
    assert body.startswith(b"%PDF")
    reader = PdfReader(io.BytesIO(body))
    pages = [p.extract_text() or "" for p in reader.pages]
    assert len(pages) >= 2
    assert all("CONFIDENTIAL" in p for p in pages)
    text = "\n".join(pages)
    for title in SECTION_TITLES + REVIEWER_AREAS:
        assert title in text, title
    assert "Page 1" in pages[0]
    assert "Prepared by: Test fixture team" in text
    # US Letter
    box = reader.pages[0].mediabox
    assert (round(float(box.width)), round(float(box.height))) == (612, 792)


def test_renderers_tolerate_sparse_memo():
    sparse = {"version": 2, "name": "Acme Robotics", "sections": {}}
    assert vip_memo_v2_export.render_docx_v2(sparse)[:2] == b"PK"
    assert vip_memo_v2_export.render_pdf_v2(sparse).startswith(b"%PDF")


# ─── routes ─────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    yield TestClient(app)
    app.dependency_overrides.clear()


def _as(roles, user_id="u-1"):
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": user_id, "email": "t@example.com", "roles": roles, "track": None,
    }


ROUTES = [
    ("leadership", ["leadership"], "/leadership/applications/{id}/vip-memo-v2"),
    ("admin", ["admin"], "/admin/platform/applications/sip/{id}/vip-memo-v2"),
    ("reviewer", ["reviewer"], "/reviewer/applications/sip/{id}/vip-memo-v2"),
]


@pytest.fixture
def assigned(monkeypatch):
    """Reviewer assignment check: every app is assigned to u-1, nothing to anyone else."""
    from app.services import reviewer_query
    calls = []

    def _fetch(uid, track, app_id):
        calls.append((uid, track, app_id))
        return {"application": {}} if uid == "u-1" else None
    monkeypatch.setattr(reviewer_query, "fetch_application_for_reviewer", _fetch)
    return calls


@pytest.mark.parametrize("surface,roles,path", ROUTES)
def test_get_route_returns_memo(client, fake, assigned, surface, roles, path):
    _as(roles)
    r = client.get(path.format(id=PILOT))
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Acme Robotics"


@pytest.mark.parametrize("surface,roles,path", ROUTES)
def test_get_route_404_when_not_available(client, fake, assigned, surface, roles, path):
    _as(roles)
    for app_id in (NON_PILOT, OTHER_PILOT):
        r = client.get(path.format(id=app_id))
        assert r.status_code == 404
        assert r.json()["detail"]["code"] == "memo_not_available"


@pytest.mark.parametrize("surface,roles,path", ROUTES)
@pytest.mark.parametrize("fmt,magic,ext", [("pdf", b"%PDF", "pdf"), ("docx", b"PK", "docx")])
def test_download_route(client, fake, assigned, surface, roles, path, fmt, magic, ext):
    _as(roles)
    r = client.post(path.format(id=PILOT) + f"/download?format={fmt}")
    assert r.status_code == 200, r.text
    assert r.content.startswith(magic)
    assert f'filename="Acme_Robotics_IC_Memo.{ext}"' in r.headers["content-disposition"]


@pytest.mark.parametrize("surface,roles,path", ROUTES)
def test_download_route_404_and_bad_format(client, fake, assigned, surface, roles, path):
    _as(roles)
    assert client.post(path.format(id=OTHER_PILOT) + "/download?format=pdf").status_code == 404
    assert client.post(path.format(id=PILOT) + "/download?format=exe").status_code == 422


def test_reviewer_route_enforces_assignment(client, fake, assigned):
    _as(["reviewer"], user_id="someone-else")
    r = client.get(f"/reviewer/applications/sip/{PILOT}/vip-memo-v2")
    assert r.status_code == 404
    r = client.post(f"/reviewer/applications/sip/{PILOT}/vip-memo-v2/download?format=pdf")
    assert r.status_code == 404
    assert ("someone-else", "sip", PILOT) in assigned


def test_admin_route_rejects_tir_track(client, fake):
    _as(["admin"])
    r = client.get(f"/admin/platform/applications/tir/{PILOT}/vip-memo-v2")
    assert r.status_code == 404


@pytest.mark.parametrize("roles,path", [
    (["applicant"], f"/leadership/applications/{PILOT}/vip-memo-v2"),
    (["applicant"], f"/admin/platform/applications/sip/{PILOT}/vip-memo-v2"),
    (["applicant"], f"/reviewer/applications/sip/{PILOT}/vip-memo-v2"),
])
def test_routes_require_capability(client, fake, roles, path):
    _as(roles)
    assert client.get(path).status_code == 403
