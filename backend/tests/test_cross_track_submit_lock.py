"""Tests for the cross-track submission lock.

Rule: a user can submit to only ONE track. If they have any non-draft
sip_applications row, they cannot submit a tir_applications. This file
covers the TIR side (block-on-SIP-submitted). Task 10 will add the
symmetric SIP-side tests.
"""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import applications as apps_mod

TEST_USER_ID = "00000000-0000-0000-0000-0000000000aa"
TEST_USER_EMAIL = "applicant@example.com"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _submittable_row() -> dict:
    """A row that passes every required + format check (no resume_file_id
    so we don't have to mock the storage-existence query)."""
    long_text = (
        "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod "
        "tempor incididunt ut labore et dolore magna aliqua ut enim ad minim "
        "veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex "
        "ea commodo consequat duis aute irure dolor in reprehenderit in voluptate "
        "velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat "
        "cupidatat non proident sunt in culpa qui officia deserunt mollit anim id "
        "est laborum sed ut perspiciatis unde omnis iste natus error sit voluptatem "
        "accusantium doloremque laudantium totam rem aperiam eaque ipsa quae."
    )
    return {
        "id": str(uuid4()),
        "user_id": TEST_USER_ID,
        "status": "draft",
        "current_section": None,
        "completion_pct": 0,
        "submitted_at": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "basic_has_team": "No — going solo for now",
        "basic_teammates": [],
        "basic_full_name": "Dr. Arun Kumar",
        "basic_phone": "+91 98765 43210",
        "basic_email": "arun@example.com",
        "basic_org": "IISc Bangalore",
        "basic_degree": "PhD",
        "basic_incubators": "None",
        "basic_hear_about": "IISc faculty or staff",
        "problem_defined": "Yes, clearly defined",
        "problem_describe": long_text,
        "problem_importance": long_text,
        "solution_stage": "Prototype built",
        "solution_describe": long_text,
        "solution_core_tech": long_text,
        "solution_ten_x": long_text,
        "solution_hurdles": long_text,
        "solution_moat": long_text,
        "solution_national_scale": long_text,
        "solution_customers": long_text,
        "execution_will_break": long_text,
        "execution_milestone": long_text,
        "execution_budget": long_text,
        "execution_failure": long_text,
        "evidence_files": [],
        "evidence_video_url": None,
        "evidence_deck": {"name": "deck.pdf", "size": 1024, "type": "application/pdf"},
        "declaration_truthful": True,
        "declaration_ref_checks": True,
        "declaration_terms": True,
        "declaration_newsletter": False,
        # All three are in _MANDATORY_FIELDS — required to clear the
        # hard-block branch of the submit validator.
        "resume_file_id": "00000000-0000-0000-0000-000000000099",
        "linkedin_url": "https://linkedin.com/in/test",
        "github_url": "https://github.com/test",
    }


@pytest.fixture(autouse=True)
def _override_current_user():
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": TEST_USER_ID,
        "email": TEST_USER_EMAIL,
    }
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_patch_rate_limit():
    apps_mod._reset_patch_rate_limits()
    yield
    apps_mod._reset_patch_rate_limits()


@pytest.fixture
def db(monkeypatch):
    """In-memory DB mock matching the pattern used by test_applications.py."""

    class _DB:
        def __init__(self):
            self.rows: dict[str, dict] = {}
            self.audit_events: list[dict] = []
            self.emails_sent: list[tuple] = []

    state = _DB()

    def fake_fetch(user_id: str):
        row = state.rows.get(user_id)
        return copy.deepcopy(row) if row else None

    def fake_update(application_id: str, patch: dict):
        row = next(
            (r for r in state.rows.values() if r.get("id") == application_id),
            None,
        )
        if row is None:
            raise RuntimeError("update before insert")
        row.update(patch)
        if patch.get("status") == "submitted" and row.get("submitted_at") is None:
            row["submitted_at"] = _now_iso()
        row["updated_at"] = _now_iso()
        return copy.deepcopy(row)

    def fake_audit(*, user_id, action, metadata, request=None):
        state.audit_events.append({"user_id": user_id, "action": action, "metadata": metadata})

    def fake_email(*, user_id, email, full_name, application_id):
        state.emails_sent.append((user_id, email, application_id))

    monkeypatch.setattr(apps_mod, "_fetch_application", fake_fetch)
    monkeypatch.setattr(apps_mod, "_update_application", fake_update)
    monkeypatch.setattr(apps_mod, "_audit", fake_audit)
    monkeypatch.setattr(apps_mod, "_send_submission_email", fake_email)

    return state


def _install_admin_stub(monkeypatch, *, sip_count: int):
    """Stub get_admin_client for the handler's two table touches.

    1. sip_applications cross-track count:
         .table("sip_applications").select(..., count="exact", head=True)
         .eq("user_id", ...).neq("status", "draft").execute()
       → SimpleNamespace(count=sip_count, data=[])
    2. tir_resume_uploads existence check:
         .table("tir_resume_uploads").select("id").eq("id", ...).eq("user_id", ...)
         .limit(1).execute()
       → SimpleNamespace(data=[{"id": ...}])  (always present, so it doesn't
         add an invalid_fields entry that would 422 before our 409.)
    """

    class _Query:
        def __init__(self, table_name: str):
            self.table_name = table_name

        def select(self, *_a, **_kw):
            return self

        def eq(self, *_a, **_kw):
            return self

        def neq(self, *_a, **_kw):
            return self

        def limit(self, *_a, **_kw):
            return self

        def execute(self):
            if self.table_name == "sip_applications":
                return SimpleNamespace(count=sip_count, data=[])
            # tir_resume_uploads existence check — pretend the upload exists.
            return SimpleNamespace(count=0, data=[{"id": "stub"}])

    class _Client:
        def table(self, name: str):
            return _Query(name)

    monkeypatch.setattr(apps_mod, "get_admin_client", lambda: _Client())


# ─── Tests ─────────────────────────────────────────────────────────


def test_tir_submit_blocked_when_sip_submitted(client, db, monkeypatch):
    """Given the user has a submitted SIP application, when they submit
    a TIR draft, then they receive 409 cross_track_submission_blocked."""
    db.rows[TEST_USER_ID] = _submittable_row()
    _install_admin_stub(monkeypatch, sip_count=1)

    res = client.post("/applications/me/submit")

    assert res.status_code == 409, res.text
    body = res.json()
    assert body["error"]["code"] == "cross_track_submission_blocked"
    # Status was NOT flipped.
    assert db.rows[TEST_USER_ID]["status"] == "draft"


def test_tir_submit_succeeds_when_no_sip_submitted(client, db, monkeypatch):
    """Given the user has no SIP submitted rows, when they submit a
    TIR draft, then the submit succeeds normally (no 409)."""
    db.rows[TEST_USER_ID] = _submittable_row()
    _install_admin_stub(monkeypatch, sip_count=0)

    res = client.post("/applications/me/submit")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert db.rows[TEST_USER_ID]["status"] == "submitted"
