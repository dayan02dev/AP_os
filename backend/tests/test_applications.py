"""Applications router tests (Phase 4).

Covers:
  - test_get_creates_draft
  - test_get_returns_existing
  - test_patch_updates_fields
  - test_patch_rejects_unknown_field
  - test_patch_after_submit_returns_409
  - test_submit_missing_required_returns_422
  - test_submit_full_success

All Supabase calls mocked via module-level DB helpers
(`_fetch_application`, `_create_draft`, `_update_application`, `_audit`,
`_send_submission_email`) — this lets tests target behaviour without a
real network round-trip.
"""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import applications as apps_mod

TEST_USER_ID = "00000000-0000-0000-0000-0000000000aa"
TEST_USER_EMAIL = "applicant@example.com"


# ─── Fixtures ──────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _override_current_user():
    """Every test in this module is 'authenticated'."""
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


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _fresh_draft_row(overrides: dict | None = None) -> dict:
    """A realistic freshly-inserted applications row."""
    row = {
        "id": str(uuid4()),
        "user_id": TEST_USER_ID,
        "status": "draft",
        "current_section": None,
        "completion_pct": 0,
        "submitted_at": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        # Form columns default to null/empty/false — same as DB defaults.
        "basic_has_team": None,
        "basic_teammates": [],
        "basic_full_name": None,
        "basic_phone": None,
        "basic_email": None,
        "basic_org": None,
        "basic_degree": None,
        "basic_incubators": None,
        "basic_hear_about": None,
        "problem_defined": None,
        "problem_describe": None,
        "problem_importance": None,
        "solution_stage": None,
        "solution_describe": None,
        "solution_core_tech": None,
        "solution_ten_x": None,
        "solution_hurdles": None,
        "solution_moat": None,
        "solution_national_scale": None,
        "solution_customers": None,
        "execution_will_break": None,
        "execution_milestone": None,
        "execution_budget": None,
        "execution_failure": None,
        "evidence_files": [],
        "evidence_video_url": None,
        "evidence_deck": None,
        "declaration_truthful": False,
        "declaration_ref_checks": False,
        "declaration_terms": False,
        "declaration_newsletter": False,
    }
    if overrides:
        row.update(overrides)
    return row


@pytest.fixture
def db(monkeypatch):
    """Stateful in-memory DB mock.

    Exposes:
        db.rows           — dict keyed by user_id
        db.audit_events   — list of audit_log payloads
        db.emails_sent    — list of (user_id, email, application_id) tuples

    Patches the router's DB helpers to operate on this dict.
    """

    class _DB:
        def __init__(self):
            self.rows: dict[str, dict] = {}
            self.audit_events: list[dict] = []
            self.emails_sent: list[tuple] = []

    state = _DB()

    def fake_fetch(user_id: str):
        row = state.rows.get(user_id)
        return copy.deepcopy(row) if row else None

    def fake_create(user_id: str):
        new = _fresh_draft_row({"user_id": user_id})
        state.rows[user_id] = new
        return copy.deepcopy(new)

    def fake_update(user_id: str, patch: dict):
        row = state.rows.get(user_id)
        if row is None:
            raise RuntimeError("update before insert")
        row.update(patch)
        # Mimic the DB trigger: stamp submitted_at when flipping to submitted.
        if patch.get("status") == "submitted" and row.get("submitted_at") is None:
            row["submitted_at"] = _now_iso()
        row["updated_at"] = _now_iso()
        return copy.deepcopy(row)

    def fake_audit(*, user_id, action, metadata, request=None):
        state.audit_events.append({"user_id": user_id, "action": action, "metadata": metadata})

    def fake_email(*, user_id, email, full_name, application_id):
        state.emails_sent.append((user_id, email, application_id))

    monkeypatch.setattr(apps_mod, "_fetch_application", fake_fetch)
    monkeypatch.setattr(apps_mod, "_create_draft", fake_create)
    monkeypatch.setattr(apps_mod, "_update_application", fake_update)
    monkeypatch.setattr(apps_mod, "_audit", fake_audit)
    monkeypatch.setattr(apps_mod, "_send_submission_email", fake_email)

    return state


# ─── GET ───────────────────────────────────────────────────────────

def test_get_creates_draft(client, db):
    assert TEST_USER_ID not in db.rows

    res = client.get("/applications/me")

    assert res.status_code == 200
    body = res.json()
    assert body["user_id"] == TEST_USER_ID
    assert body["status"] == "draft"
    assert body["completion_pct"] == 0
    # Side effect: row created
    assert TEST_USER_ID in db.rows


def test_get_returns_existing(client, db):
    existing = _fresh_draft_row({"completion_pct": 42, "basic_full_name": "Aisha"})
    db.rows[TEST_USER_ID] = existing

    res = client.get("/applications/me")

    assert res.status_code == 200
    body = res.json()
    # Same row id, not a newly-created one.
    assert body["id"] == existing["id"]
    assert body["basic_full_name"] == "Aisha"
    assert body["completion_pct"] == 42


# ─── PATCH ─────────────────────────────────────────────────────────

def test_patch_updates_fields(client, db):
    db.rows[TEST_USER_ID] = _fresh_draft_row()

    res = client.patch(
        "/applications/me",
        json={
            "basic_full_name": "Priya Sharma",
            "basic_phone": "+91 98765 43210",
            "current_section": "basic",
        },
    )

    assert res.status_code == 200
    body = res.json()
    assert body["basic_full_name"] == "Priya Sharma"
    assert body["basic_phone"] == "+91 98765 43210"
    assert body["current_section"] == "basic"
    # completion_pct recomputed server-side
    assert isinstance(body["completion_pct"], int)
    assert 0 <= body["completion_pct"] <= 100
    # Audit event logged
    assert db.audit_events[-1]["action"] == "application.section_saved"
    saved_fields = db.audit_events[-1]["metadata"]["fields"]
    assert "basic_full_name" in saved_fields
    assert "completion_pct" in saved_fields


def test_patch_rejects_unknown_field(client, db):
    db.rows[TEST_USER_ID] = _fresh_draft_row()

    res = client.patch(
        "/applications/me",
        json={"basic_full_name": "ok", "definitely_not_a_column": "nope"},
    )

    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "unknown_fields"
    assert "definitely_not_a_column" in body["error"]["unknown"]


def test_patch_rejects_enum_mismatch(client, db):
    # Phase-post-launch: basic_degree and basic_hear_about were relaxed
    # from strict Literals to `str` so the UI can encode "Other: <text>"
    # free-form answers. Use a still-strict enum (basic_has_team) to
    # continue covering the Pydantic-validation-error path.
    db.rows[TEST_USER_ID] = _fresh_draft_row()
    res = client.patch("/applications/me", json={"basic_has_team": "Maybe?"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "validation_error"


def test_patch_after_submit_returns_409(client, db):
    db.rows[TEST_USER_ID] = _fresh_draft_row({"status": "submitted"})
    res = client.patch("/applications/me", json={"basic_full_name": "late edit"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "not_draft"


# ─── SUBMIT ────────────────────────────────────────────────────────

def test_submit_missing_required_returns_422(client, db):
    db.rows[TEST_USER_ID] = _fresh_draft_row()
    res = client.post("/applications/me/submit")
    assert res.status_code == 422
    body = res.json()
    assert body["error"]["code"] == "submission_invalid"
    # Every declaration is unticked, so they must all be flagged missing.
    assert "declaration_truthful" in body["missing_fields"]
    assert "declaration_ref_checks" in body["missing_fields"]
    assert "declaration_terms" in body["missing_fields"]
    # Several required text fields are empty too.
    assert "basic_full_name" in body["missing_fields"]


def _build_submittable_row() -> dict:
    """A row that passes every required + format check."""
    long_text = (
        "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod "
        "tempor incididunt ut labore et dolore magna aliqua ut enim ad minim "
        "veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex "
        "ea commodo consequat duis aute irure dolor in reprehenderit in voluptate "
        "velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat "
        "cupidatat non proident sunt in culpa qui officia deserunt mollit anim id "
        "est laborum sed ut perspiciatis unde omnis iste natus error sit voluptatem "
        "accusantium doloremque laudantium totam rem aperiam eaque ipsa quae."
    )  # ~100 words — safely clears the 30/40/60-word minimums.

    return _fresh_draft_row({
        "basic_has_team": "No — going solo for now",
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
        "evidence_deck": {"name": "deck.pdf", "size": 1024, "type": "application/pdf"},
        "declaration_truthful": True,
        "declaration_ref_checks": True,
        "declaration_terms": True,
    })


def test_submit_full_success(client, db):
    db.rows[TEST_USER_ID] = _build_submittable_row()

    res = client.post("/applications/me/submit")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["application_id"] == db.rows[TEST_USER_ID]["id"]
    # Status flipped
    assert db.rows[TEST_USER_ID]["status"] == "submitted"
    assert db.rows[TEST_USER_ID]["submitted_at"] is not None
    # Audit + email side-effects
    assert any(e["action"] == "application.submitted" for e in db.audit_events)
    assert len(db.emails_sent) == 1
    assert db.emails_sent[0][0] == TEST_USER_ID


# ─── COMPLETION ────────────────────────────────────────────────────

def test_completion_reports_missing(client, db):
    db.rows[TEST_USER_ID] = _fresh_draft_row({
        "basic_full_name": "Priya",
        "basic_phone": "+91 98765 43210",
        "current_section": "basic",
    })
    res = client.get("/applications/me/completion")
    assert res.status_code == 200
    body = res.json()
    assert 0 < body["completion_pct"] < 100
    assert "declaration_truthful" in body["missing_required_fields"]
    assert body["current_section"] == "basic"
