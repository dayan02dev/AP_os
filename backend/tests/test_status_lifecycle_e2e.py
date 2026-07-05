# backend/tests/test_status_lifecycle_e2e.py
"""End-to-end status-lifecycle tests for TIR + VIP.

Drives the REAL endpoints against a mutating FakeSupabase and asserts the
application status after every hop. See
docs/superpowers/specs/2026-07-06-status-lifecycle-e2e-tests-design.md.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase

APPLICANT = "11111111-1111-1111-1111-111111111111"
ADMIN = "22222222-2222-2222-2222-222222222222"
REVIEWER = "33333333-3333-3333-3333-333333333333"
REVIEWER2 = "44444444-4444-4444-4444-444444444444"


def _user(user_id, roles):
    def _f():
        return {"user_id": user_id, "email": f"{user_id}@x.com", "track": None, "roles": roles}
    return _f


def _as(user_id, roles):
    app.dependency_overrides[get_current_user] = _user(user_id, roles)


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _canned_score():
    """A ScoreResult stand-in with exactly the attrs pipeline.persist reads."""
    return SimpleNamespace(
        score_problem=5.0, score_solution=5.0, score_tech=5.0,
        score_founders=5.0, score_commitment=5.0, score_overall=5.0,
        summary="canned", raw_response="{}", model="test",
        new_industry_proposal=None, industry_confidence=None,
        industry_category_id=None, project_name="Test Project", sections=None,
    )


def install_fake_db(monkeypatch, fake: FakeSupabase):
    """Point get_admin_client at `fake` across every module the lifecycle
    touches, and neutralise side effects (SQS, email, audit, rate-limit,
    submit validation/completion). Keep _fetch_application/_update_application
    REAL so submit reads+writes status through the fake."""
    from app.routers import applications as tir_r
    from app.routers import sip_applications as sip_r
    from app.routers import reviewer as rv
    from app.routers import admin_platform as ap
    from app.routers import leadership_actions as la
    from app.services import reviewer_query, state_machine, decisions
    from app.services import decision_email
    from app.services.ai_pipeline import pipeline

    for mod in (tir_r, sip_r, rv, ap, la, reviewer_query, state_machine, decisions, pipeline):
        monkeypatch.setattr(mod, "get_admin_client", lambda: fake, raising=False)

    # No-op audit (each module imported it by name).
    for mod in (rv, la, decisions):
        monkeypatch.setattr(mod, "write_audit", lambda **k: None, raising=False)

    # Applicant email hook on decisions: spy so tests can assert it fired.
    calls = {"decision_email": []}
    monkeypatch.setattr(
        decisions.decision_email, "notify_applicant_decided",
        lambda sb, **k: calls["decision_email"].append(k), raising=False,
    )

    # Submit side effects (both tracks): rate-limit, audit, email, completion,
    # validation → stub; SQS publish → spy. Keep _fetch/_update REAL.
    published: list[tuple] = []
    for mod in (tir_r, sip_r):
        for name in ("check_rate", "record_rate"):
            monkeypatch.setattr(mod, name, lambda *a, **k: None, raising=False)
        monkeypatch.setattr(mod, "_audit", lambda **k: None, raising=False)
        monkeypatch.setattr(mod, "_send_submission_email", lambda **k: None, raising=False)
        monkeypatch.setattr(mod, "_completion_pct", lambda row: (100, []), raising=False)
        monkeypatch.setattr(mod, "_validate_submission", lambda row: ([], []), raising=False)
        monkeypatch.setattr(mod.sqs_publisher, "publish",
                            lambda aid, track: published.append((aid, track)), raising=False)

    return SimpleNamespace(fake=fake, published=published, calls=calls)


SUBMIT_PATH = {"tir": "/applications/me/submit", "sip": "/sip-applications/me/submit"}


class LifecycleDriver:
    """Walks ONE application through the lifecycle via real endpoints + persist."""

    def __init__(self, client, ctx, track: str, app_id: str):
        self.client = client
        self.ctx = ctx
        self.track = track
        self.app_id = app_id

    def status(self):
        return self.ctx.fake.status_of(self.track, self.app_id)

    def submit(self):
        _as(APPLICANT, [])
        r = self.client.post(SUBMIT_PATH[self.track])
        assert r.status_code in (200, 201), r.text
        return r


def _seed_draft(track: str, app_id: str) -> dict:
    """Minimal draft row the submit path can flip. _fetch_application looks up
    by user_id; _update_application writes status by id. Extra columns are
    harmless in the fake."""
    return {"id": app_id, "user_id": APPLICANT, "status": "draft", "track": track}


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A1_submit_sets_submitted(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit()

    assert d.status() == "submitted"
    assert ctx.published == [(app_id, track)]  # enqueued for AI screening
