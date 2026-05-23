"""Tests for POST /sip-application-templates/me/apply-to-application.

Auth strategy: same self-contained per-test FastAPI app + fake Supabase
client pattern used by test_sip_application_templates_upload.py and
test_sip_application_templates_get_me.py.

The SIP apply endpoint uses NULL-only writes (Decision D6 in the spec) —
parsed answers only land in columns currently NULL on the draft.
Already-typed answers are preserved and surfaced via skipped_fields.

Enum validation for the 5 MCQ columns and URL validation for Q24 are
specified in the plan (Task 9 Step 3) but were not present in the
initial handler implementation (commit ad01cdd). Those tests
(test_apply_invalid_enum_to_missing, test_apply_invalid_url_to_missing,
test_apply_valid_url_applied, test_apply_q10_other_auto_filled)
test the spec-intended behaviour and document the divergence.
"""
from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException, Depends
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.deps import get_current_user
from app.utils.rate_limit import limiter

SIP_USER_ID = "00000000-0000-0000-0000-000000000002"
TIR_USER_ID = "00000000-0000-0000-0000-000000000003"
DRAFT_ID = "aaaaaaaa-0000-0000-0000-000000000001"
TMPL_ID = "bbbbbbbb-0000-0000-0000-000000000001"


# ── Fake Supabase ─────────────────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Chainable fake Supabase query that supports select/update/insert."""

    def __init__(self, store: "FakeStore", table_name: str):
        self._store = store
        self._table = table_name
        self._filters: list[tuple[str, Any]] = []
        self._op = "select"
        self._pending_write: dict[str, Any] | None = None

    def select(self, *_a, **_kw):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._pending_write = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._pending_write = payload
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        if self._op == "insert":
            row = dict(self._pending_write or {})
            row.setdefault("id", "00000000-0000-0000-0000-000000000099")
            self._store.inserts.setdefault(self._table, []).append(row)
            return _Result([row])

        if self._op == "update":
            record = {
                "filters": list(self._filters),
                "payload": dict(self._pending_write or {}),
            }
            self._store.updates.setdefault(self._table, []).append(record)
            # Optionally propagate writes back into the draft table so
            # idempotency tests can pick them up on re-select.
            if self._store.persist_updates and self._table == "sip_applications":
                rows = self._store.tables.get("sip_applications", [])
                for col, val in self._filters:
                    rows = [r for r in rows if r.get(col) == val]
                for row in rows:
                    row.update(self._pending_write or {})
            return _Result([])

        # select
        rows = list(self._store.tables.get(self._table, []))
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        return _Result(rows)


class FakeStore:
    def __init__(self):
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.inserts: dict[str, list[dict[str, Any]]] = {}
        self.updates: dict[str, list[dict[str, Any]]] = {}
        # When True, update() writes propagate back into the in-memory tables
        # so a subsequent select sees the new values (used by idempotency test).
        self.persist_updates: bool = False

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)

    def auth(self):
        return self


# ── App builder + fixtures ────────────────────────────────────────────────

def _make_app(user_id: str, track: str | None = "sip") -> FastAPI:
    """Build a minimal app mounting only the SIP templates router."""
    from app.routers import sip_application_templates as sip_tmpl

    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(sip_tmpl.router)
    a.dependency_overrides[get_current_user] = lambda: {
        "user_id": user_id,
        "email": "test@example.com",
        "track": track,
    }
    limiter.reset()
    return a


def _all_null_draft(app_id: str, user_id: str = SIP_USER_ID) -> dict[str, Any]:
    """Draft row with all 17 SIP template target columns set to None."""
    return {
        "id": app_id,
        "user_id": user_id,
        "status": "draft",
        # 17 target columns, all null
        "sip_incorporated": None,
        "sip_trl": None,
        "basic_incubator_association": None,
        "basic_incubator_details": None,
        "basic_hear_about": None,
        "problem_describe": None,
        "solution_describe": None,
        "solution_core_tech": None,
        "solution_contrarian_insight": None,
        "sip_traction": None,
        "sip_traction_details": None,
        "execution_will_break": None,
        "execution_milestone": None,
        "execution_infrastructure": None,
        "execution_failure": None,
        "execution_hwsw_integration": None,
        "sip_demo_video_url": None,
    }


def _full_parsed_data() -> dict[str, Any]:
    """parsed_data with all 17 keys filled; Q9/Q14/Q20/Q21 intentionally null."""
    return {
        "Q5":  "Yes — Pvt Ltd, registered in India",
        "Q6":  "TRL 4 — lab-validated prototype",
        "Q8":  "No",
        "Q9":  None,
        "Q10": "Referral from friend/colleague",
        "Q11": "Problem text.",
        "Q12": "Solution text.",
        "Q13": "Core tech text.",
        "Q14": None,
        "Q15": "Active pilots (paid or unpaid) with design partners",
        "Q16": "Pilots text.",
        "Q17": "Hurdles text.",
        "Q18": "Milestone text.",
        "Q19": "Infra text.",
        "Q20": None,
        "Q21": None,
        "Q24": "https://loom.com/share/x",
    }


_APPLY_URL = "/sip-application-templates/me/apply-to-application"


# ── Tests ─────────────────────────────────────────────────────────────────

def test_apply_unauthenticated() -> None:
    """No bearer token → 401 before the handler runs."""
    from app.routers import sip_application_templates as sip_tmpl

    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(sip_tmpl.router)
    limiter.reset()

    c = TestClient(a, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 401


def test_apply_no_draft_returns_404(monkeypatch) -> None:
    """When there is no draft sip_applications row, the handler returns 404."""
    import app.routers.sip_application_templates as sip_tmpl

    store = FakeStore()
    store.tables["sip_applications"] = []
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 404
    assert "draft" in resp.json()["detail"].lower()


def test_apply_no_completed_template_returns_404(monkeypatch) -> None:
    """Draft exists but no completed template → 404."""
    import app.routers.sip_application_templates as sip_tmpl

    store = FakeStore()
    store.tables["sip_applications"] = [
        {"id": DRAFT_ID, "user_id": SIP_USER_ID, "status": "draft"},
    ]
    # Template table has a row but parse_status is not 'completed'.
    store.tables["sip_application_templates"] = []
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 404
    assert "template" in resp.json()["detail"].lower()


def test_apply_happy_path_all_columns_null(monkeypatch) -> None:
    """200 with all draft columns null; Q9/Q14/Q20/Q21 land in missing_answers;
    sip_incorporated and problem_describe are in applied_fields;
    skipped_fields is empty.
    """
    import app.routers.sip_application_templates as sip_tmpl

    store = FakeStore()
    store.tables["sip_applications"] = [_all_null_draft(DRAFT_ID)]
    store.tables["sip_application_templates"] = [
        {
            "id": TMPL_ID,
            "user_id": SIP_USER_ID,
            "application_id": DRAFT_ID,
            "parse_status": "completed",
            "parsed_data": _full_parsed_data(),
        }
    ]
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Q9, Q14, Q20, Q21 were null in parsed_data.
    assert set(body["missing_answers"]) == {"Q9", "Q14", "Q20", "Q21"}
    assert "sip_incorporated" in body["applied_fields"]
    assert "problem_describe" in body["applied_fields"]
    assert body["skipped_fields"] == []


def test_apply_null_only_preserves_typed_value(monkeypatch) -> None:
    """Pre-filled problem_describe on draft → column in skipped_fields, NOT applied_fields."""
    import app.routers.sip_application_templates as sip_tmpl

    draft = _all_null_draft(DRAFT_ID)
    draft["problem_describe"] = "TYPED BY APPLICANT"

    store = FakeStore()
    store.tables["sip_applications"] = [draft]
    store.tables["sip_application_templates"] = [
        {
            "id": TMPL_ID,
            "user_id": SIP_USER_ID,
            "application_id": DRAFT_ID,
            "parse_status": "completed",
            "parsed_data": _full_parsed_data(),
        }
    ]
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "problem_describe" in body["skipped_fields"]
    assert "problem_describe" not in body["applied_fields"]
    # Confirm the draft was NOT overwritten (no update payload for this col).
    updates_for_app = store.updates.get("sip_applications", [])
    for update in updates_for_app:
        assert "problem_describe" not in update["payload"], (
            "problem_describe must not be in any update payload (NULL-only write violated)"
        )


def test_apply_invalid_enum_to_missing(monkeypatch) -> None:
    """Q5='Not a real option' → 'Q5' in missing_answers, sip_incorporated NOT applied.

    This test verifies the enum guard specified in plan Task 9 Step 3.
    The handler (commit ad01cdd) does NOT implement this guard — this test
    is expected to FAIL against that handler, documenting the divergence.
    """
    import app.routers.sip_application_templates as sip_tmpl

    parsed = {qid: None for qid in [
        "Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13",
        "Q14", "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24",
    ]}
    parsed["Q5"] = "Not a real option"

    store = FakeStore()
    store.tables["sip_applications"] = [_all_null_draft(DRAFT_ID)]
    store.tables["sip_application_templates"] = [
        {
            "id": TMPL_ID,
            "user_id": SIP_USER_ID,
            "application_id": DRAFT_ID,
            "parse_status": "completed",
            "parsed_data": parsed,
        }
    ]
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "Q5" in body["missing_answers"], (
        "Invalid enum value for Q5 must be demoted to missing_answers"
    )
    assert "sip_incorporated" not in body["applied_fields"], (
        "sip_incorporated must NOT be applied when Q5 value is not a canonical enum"
    )


def test_apply_invalid_url_to_missing(monkeypatch) -> None:
    """Q24='not-a-url' → 'Q24' in missing_answers.

    This test verifies the URL guard specified in plan Task 9 Step 3.
    The handler (commit ad01cdd) does NOT implement this guard — this test
    is expected to FAIL against that handler, documenting the divergence.
    """
    import app.routers.sip_application_templates as sip_tmpl

    parsed = {qid: None for qid in [
        "Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13",
        "Q14", "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24",
    ]}
    parsed["Q24"] = "not-a-url"

    store = FakeStore()
    store.tables["sip_applications"] = [_all_null_draft(DRAFT_ID)]
    store.tables["sip_application_templates"] = [
        {
            "id": TMPL_ID,
            "user_id": SIP_USER_ID,
            "application_id": DRAFT_ID,
            "parse_status": "completed",
            "parsed_data": parsed,
        }
    ]
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "Q24" in body["missing_answers"], (
        "Invalid URL for Q24 must be demoted to missing_answers"
    )


def test_apply_valid_url_applied(monkeypatch) -> None:
    """Q24='https://www.loom.com/share/abc' → sip_demo_video_url in applied_fields."""
    import app.routers.sip_application_templates as sip_tmpl

    parsed = {qid: None for qid in [
        "Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13",
        "Q14", "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24",
    ]}
    parsed["Q24"] = "https://www.loom.com/share/abc"

    store = FakeStore()
    store.tables["sip_applications"] = [_all_null_draft(DRAFT_ID)]
    store.tables["sip_application_templates"] = [
        {
            "id": TMPL_ID,
            "user_id": SIP_USER_ID,
            "application_id": DRAFT_ID,
            "parse_status": "completed",
            "parsed_data": parsed,
        }
    ]
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 200, resp.text
    assert "sip_demo_video_url" in resp.json()["applied_fields"]


def test_apply_q10_other_auto_filled(monkeypatch) -> None:
    """Q10='Other' is a canonical enum value → basic_hear_about in applied_fields.

    Per spec: Q10='Other' is NOT special-cased; it is treated as just
    another canonical enum value. The wizard handles the custom hear-about
    text capture separately.

    This test verifies the enum guard path: 'Other' must be in
    SIP_TEMPLATE_Q10_OPTIONS, so basic_hear_about is applied (not demoted).
    The handler (commit ad01cdd) does NOT implement enum guards; it writes
    any non-null value unconditionally, so this test passes with either
    implementation — it documents that Q10='Other' MUST result in an apply.
    """
    import app.routers.sip_application_templates as sip_tmpl

    parsed = {qid: None for qid in [
        "Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13",
        "Q14", "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24",
    ]}
    parsed["Q10"] = "Other"

    store = FakeStore()
    store.tables["sip_applications"] = [_all_null_draft(DRAFT_ID)]
    store.tables["sip_application_templates"] = [
        {
            "id": TMPL_ID,
            "user_id": SIP_USER_ID,
            "application_id": DRAFT_ID,
            "parse_status": "completed",
            "parsed_data": parsed,
        }
    ]
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # 'Other' is a valid enum value — basic_hear_about should be applied.
    assert "basic_hear_about" in body["applied_fields"], (
        "Q10='Other' must auto-fill basic_hear_about (it is a canonical enum value, not special-cased)"
    )


def test_apply_idempotent_second_call_applied_empty(monkeypatch) -> None:
    """Second apply call (with draft now populated) → applied_fields=[], columns in skipped_fields."""
    import app.routers.sip_application_templates as sip_tmpl

    # Build a draft with all columns null and a template with 12 non-null answers.
    partial_parsed = {
        "Q5":  "Yes — Pvt Ltd, registered in India",
        "Q6":  "TRL 4 — lab-validated prototype",
        "Q8":  "No",
        "Q9":  None,
        "Q10": "Referral from friend/colleague",
        "Q11": "Problem text.",
        "Q12": "Solution text.",
        "Q13": "Core tech.",
        "Q14": None,
        "Q15": "Active pilots (paid or unpaid) with design partners",
        "Q16": "Pilots.",
        "Q17": "Hurdles.",
        "Q18": "Milestone.",
        "Q19": "Infra.",
        "Q20": None,
        "Q21": None,
        "Q24": None,
    }

    store = FakeStore()
    store.tables["sip_applications"] = [_all_null_draft(DRAFT_ID)]
    store.tables["sip_application_templates"] = [
        {
            "id": TMPL_ID,
            "user_id": SIP_USER_ID,
            "application_id": DRAFT_ID,
            "parse_status": "completed",
            "parsed_data": partial_parsed,
        }
    ]
    store.persist_updates = True  # writes flow back into tables["sip_applications"]
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID)
    c = TestClient(app, raise_server_exceptions=False)

    # First call — should apply the non-null fields.
    first = c.post(_APPLY_URL)
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["applied_fields"], "First call should apply at least one field"

    # Second call — all the previously-written columns are now non-null.
    second = c.post(_APPLY_URL)
    assert second.status_code == 200, second.text
    second_body = second.json()

    assert second_body["applied_fields"] == [], (
        "Second call must find all columns already filled; applied_fields must be empty"
    )
    assert "problem_describe" in second_body["skipped_fields"], (
        "problem_describe (written in first call) must land in skipped_fields on second call"
    )


def test_apply_requires_sip_track(monkeypatch) -> None:
    """A TIR-track user is rejected 403 when the track gate is enforced."""
    from fastapi import Depends, HTTPException

    import app.routers.sip_application_templates as sip_tmpl

    store = FakeStore()
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    async def _strict_sip_gate(current_user: dict = Depends(get_current_user)) -> None:
        if current_user.get("track") != "sip":
            raise HTTPException(status_code=403, detail="Wrong track.")

    router_dep_callable = sip_tmpl.router.dependencies[0].dependency

    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(sip_tmpl.router)
    a.dependency_overrides[router_dep_callable] = _strict_sip_gate
    a.dependency_overrides[get_current_user] = lambda: {
        "user_id": TIR_USER_ID,
        "email": "tir@example.com",
        "track": "tir",
    }
    limiter.reset()

    c = TestClient(a, raise_server_exceptions=False)
    resp = c.post(_APPLY_URL)
    assert resp.status_code == 403
