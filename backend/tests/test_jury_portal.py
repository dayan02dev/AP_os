"""Tests for the jury v2 portal read API (queue + content + signed-url).

v2 (this build) — jurors PICK apps to mentor; there is NO scoring and NO
reviewer-consensus panel. Coverage:

  1. GET /jury/queue returns only the caller's assignments, each carrying a
     ``picked`` flag (+ ``pickNote``) from jury_selections.
  2. GET /jury/applications/{track}/{id}/content is 404 when the juror has no
     assignment for the app (anti-enumeration; not 403).
  3. Content payload includes ``aiSections``, ``attachments``,
     ``mySelection: None`` and does NOT carry a ``reviewerConsensus`` key.
  4. GET .../files/signed-url → 404 on an unknown path, 400 on a ".." path.

The mutating FakeSupabase double is installed into every module the jury
routes touch (jury_query, the router itself, applications_query). Capability
is granted by overriding get_current_user (NOT require_capability — the gate
builds a fresh closure per route, so patching the shared user dependency is
the only reliable seam).
"""

from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


# ─── Fakes / fixtures ─────────────────────────────────────────────────────


class _FakeStorageBucket:
    def __init__(self, bucket: str):
        self._bucket = bucket

    def create_signed_url(self, path: str, expires_in: int) -> dict:
        return {"signedURL": f"https://fake-storage.example/{self._bucket}/{path}"}


class _FakeStorage:
    def from_(self, bucket: str) -> _FakeStorageBucket:
        return _FakeStorageBucket(bucket)


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _override_user(user_id: str, roles: list[str] | None = None):
    def _f():
        return {
            "user_id": user_id,
            "email": f"{user_id}@x.com",
            "roles": roles if roles is not None else ["jury"],
        }

    return _f


def _install(monkeypatch, tables: dict) -> FakeSupabase:
    """Install a mutating FakeSupabase into every module the jury routes call."""
    from app.routers import jury as jury_router
    from app.services import applications_query, jury_query

    fake = FakeSupabase(tables)
    fake.storage = _FakeStorage()  # jury_query signs attachment URLs
    monkeypatch.setattr(jury_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(jury_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    return fake


def _assignment(juror: str, app_id: str, track: str = "tir") -> dict:
    return {
        "id": f"ja-{app_id}",
        "juror_user_id": juror,
        "application_id": app_id,
        "application_track": track,
        "assigned_at": "2026-06-20T09:00:00Z",
        "due_at": None,
    }


def _tir_app(app_id: str, **extra) -> dict:
    row = {
        "id": app_id,
        "basic_org": "ARTPARK Innovations",
        "basic_full_name": "Founder One",
        "solution_stage": "prototype",
        "submitted_at": "2026-06-10T00:00:00Z",
        "status": "jury_review",
    }
    row.update(extra)
    return row


# ─── Test 1: queue returns only my assignments, with picked flags ──────────


def test_queue_returns_only_my_assignments_with_pick_flags(
    client, monkeypatch, _clear_overrides,
):
    me = "juror-a"
    other = "juror-b"
    _install(
        monkeypatch,
        {
            "jury_assignments": [
                _assignment(me, "app1"),
                _assignment(me, "app2"),
                _assignment(other, "app3"),  # someone else's — must not appear
            ],
            "tir_applications": [
                _tir_app("app1"),
                _tir_app("app2"),
                _tir_app("app3"),
            ],
            "jury_selections": [
                {
                    "id": "sel1",
                    "juror_user_id": me,
                    "application_id": "app1",
                    "application_track": "tir",
                    "note": "Strong robotics fit",
                }
            ],
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/jury/queue")
    assert r.status_code == 200, r.text
    items = r.json()
    ids = {it["id"] for it in items}
    assert ids == {"app1", "app2"}  # only mine
    by_id = {it["id"]: it for it in items}
    assert by_id["app1"]["picked"] is True
    assert by_id["app1"]["pickNote"] == "Strong robotics fit"
    assert by_id["app2"]["picked"] is False
    assert by_id["app2"]["pickNote"] is None
    # v2 drops the scoring/review status fields.
    assert "reviewStatus" not in by_id["app1"]
    assert "editWindowExpiresAt" not in by_id["app1"]


def test_queue_empty_when_no_assignments(client, monkeypatch, _clear_overrides):
    _install(monkeypatch, {"jury_assignments": [], "tir_applications": []})
    app.dependency_overrides[get_current_user] = _override_user("juror-a")
    r = client.get("/jury/queue")
    assert r.status_code == 200, r.text
    assert r.json() == []


# ─── Test 2: content 404 when unassigned ───────────────────────────────────


def test_content_404_when_unassigned(client, monkeypatch, _clear_overrides):
    _install(
        monkeypatch,
        {"jury_assignments": [], "tir_applications": [_tir_app("app1")]},
    )
    app.dependency_overrides[get_current_user] = _override_user("juror-a")
    r = client.get("/jury/applications/tir/app1/content")
    assert r.status_code == 404, r.text
    assert r.json()["detail"]["code"] == "not_found"


# ─── Test 3: content payload shape (aiSections / attachments / mySelection) ──


def test_content_includes_ai_sections_attachments_and_no_consensus(
    client, monkeypatch, _clear_overrides,
):
    me = "juror-a"
    _install(
        monkeypatch,
        {
            "jury_assignments": [_assignment(me, "app1")],
            "tir_applications": [
                _tir_app(
                    "app1",
                    problem_describe="Rural students lack tutoring.",
                    solution_describe="An AI tutor.",
                )
            ],
            "ai_screening": [
                {
                    "application_id": "app1",
                    "application_track": "tir",
                    "project_name": "TutorAI",
                    "summary": "AI tutoring for rural India.",
                    "score_overall": 7.5,
                    "sections": {"problem": ["Clear problem."]},
                    "founder_check": {
                        "verdict": "Strong",
                        "confidence": "HIGH",
                        "top_signals": "Ex-IISc robotics lead",
                    },
                }
            ],
            "jury_selections": [],
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/jury/applications/tir/app1/content")
    assert r.status_code == 200, r.text
    body = r.json()

    # Founder-check merged into aiSections just like the reviewer content path.
    assert "aiSections" in body
    assert body["aiSections"]["problem"] == ["Clear problem."]
    assert any("Verdict: Strong" in b for b in body["aiSections"]["founder"])

    # attachments always present (empty when the app has no files).
    assert body["attachments"] == []

    # v2: a picks payload, never a review; no consensus panel.
    assert body["mySelection"] is None
    assert "reviewerConsensus" not in body
    assert "evaluation" not in body

    # presenter + resume passthrough for FE ProfilePills.
    assert "application" in body
    assert "fields" in body and "sections" in body


def test_content_reflects_existing_selection(client, monkeypatch, _clear_overrides):
    me = "juror-a"
    _install(
        monkeypatch,
        {
            "jury_assignments": [_assignment(me, "app1")],
            "tir_applications": [_tir_app("app1")],
            "jury_selections": [
                {
                    "id": "sel1",
                    "juror_user_id": me,
                    "application_id": "app1",
                    "application_track": "tir",
                    "note": "Mentor pick",
                }
            ],
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/jury/applications/tir/app1/content")
    assert r.status_code == 200, r.text
    assert r.json()["mySelection"]["note"] == "Mentor pick"


# ─── Test 4: signed-url guards ─────────────────────────────────────────────


def test_signed_url_400_on_path_traversal(client, monkeypatch, _clear_overrides):
    me = "juror-a"
    _install(monkeypatch, {"jury_assignments": [_assignment(me, "app1")],
                           "tir_applications": [_tir_app("app1")]})
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get(
        "/jury/applications/tir/app1/files/signed-url",
        params={"storage_path": "../../etc/passwd"},
    )
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "invalid_storage_path"


def test_signed_url_404_on_unknown_path(client, monkeypatch, _clear_overrides):
    me = "juror-a"
    _install(monkeypatch, {"jury_assignments": [_assignment(me, "app1")],
                           "tir_applications": [_tir_app("app1")]})
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get(
        "/jury/applications/tir/app1/files/signed-url",
        params={"storage_path": "tir/app1/not-a-real-file.pdf"},
    )
    assert r.status_code == 404, r.text
    assert r.json()["detail"]["code"] == "file_not_found"


def test_signed_url_404_when_unassigned(client, monkeypatch, _clear_overrides):
    _install(monkeypatch, {"jury_assignments": [], "tir_applications": [_tir_app("app1")]})
    app.dependency_overrides[get_current_user] = _override_user("juror-a")
    r = client.get(
        "/jury/applications/tir/app1/files/signed-url",
        params={"storage_path": "tir/app1/file.pdf"},
    )
    assert r.status_code == 404, r.text
    assert r.json()["detail"]["code"] == "not_found"


def test_signed_url_success_for_allowed_evidence_file(
    client, monkeypatch, _clear_overrides,
):
    me = "juror-a"
    _install(
        monkeypatch,
        {
            "jury_assignments": [_assignment(me, "app1")],
            "tir_applications": [
                _tir_app(
                    "app1",
                    evidence_files=[
                        {"name": "demo.pdf", "storage_path": "tir/app1/demo.pdf"}
                    ],
                )
            ],
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get(
        "/jury/applications/tir/app1/files/signed-url",
        params={"storage_path": "tir/app1/demo.pdf"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["expires_in"] == 120
    assert body["url"].startswith("https://fake-storage.example/tir-evidence-files/")


# ─── Capability gate ───────────────────────────────────────────────────────


def test_non_jury_user_gets_403_on_queue(client, monkeypatch, _clear_overrides):
    _install(monkeypatch, {})
    app.dependency_overrides[get_current_user] = _override_user("app-a", roles=["applicant"])
    r = client.get("/jury/queue")
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "missing_capability"
