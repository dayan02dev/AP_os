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
    from app.services import applications_query, reviewer_query, state_machine, decisions
    from app.services import decision_email
    from app.services.ai_pipeline import pipeline

    for mod in (tir_r, sip_r, rv, ap, la, applications_query, reviewer_query,
                state_machine, decisions, pipeline):
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

    def run_ai(self):
        # Simulate the SQS worker: the real worker no longer advances status.
        from app.services.ai_pipeline import pipeline
        pipeline.persist(self.ctx.fake, self.app_id, self.track, _canned_score(), advance_status=False)

    def assign(self, reviewer_ids):
        # Reviewers must have a user_roles row; the assign endpoint checks it.
        for rid in reviewer_ids:
            self.ctx.fake.tables.setdefault("user_roles", []).append(
                {"user_id": rid, "role": "reviewer"})
        _as(ADMIN, ["leadership"])
        r = self.client.post(
            f"/leadership/applications/{self.app_id}/reviewers",
            json={"reviewer_user_ids": list(reviewer_ids), "due_at": None},
        )
        assert r.status_code == 200, r.text
        return r

    def assignment_id_for(self, reviewer_id):
        rows = self.ctx.fake.tables.get("reviewer_assignments", [])
        return next(a["id"] for a in rows
                    if a["application_id"] == self.app_id and a["reviewer_user_id"] == reviewer_id)

    def submit_review(self, reviewer_id, draft=False):
        _as(reviewer_id, ["reviewer"])
        body = {
            "application_id": self.app_id,
            "application_track": self.track,
            "assignment_id": self.assignment_id_for(reviewer_id),
            "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
            "score_founders": 7.0, "score_commitment": 7.0,
            "recommendation": "yes", "quick_notes": "solid", "draft": draft,
        }
        r = self.client.post("/reviewer/reviews", json=body)
        assert r.status_code in (200, 201), r.text
        return r

    def decide(self, decision, rationale="ok"):
        _as(ADMIN, ["admin"])
        r = self.client.post(
            f"/admin/platform/applications/{self.track}/{self.app_id}/decision",
            json={"decision": decision, "rationale": rationale},
        )
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


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A2_ai_screening_keeps_submitted(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai()
    assert d.status() == "submitted"  # AI no longer advances status
    scr = fake.table("ai_screening").select("*").eq("application_id", app_id).execute().data
    assert scr and scr[0]["score_overall"] == 5.0  # but scores were written


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A3_assign_moves_to_under_review(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); assert d.status() == "submitted"

    d.assign([REVIEWER])

    assert d.status() == "under_review"  # assignment is THE trigger now
    assert len(fake.tables["reviewer_assignments"]) == 1


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A4_first_review_sets_evaluated(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER, REVIEWER2])
    assert d.status() == "under_review"

    d.submit_review(REVIEWER)                 # FIRST of two
    assert d.status() == "evaluated"          # single review flips it
    d.submit_review(REVIEWER2)                # second is a no-op
    assert d.status() == "evaluated"


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A6_full_happy_path_chain(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit();          assert d.status() == "submitted"
    d.run_ai();          assert d.status() == "submitted"
    d.assign([REVIEWER]); assert d.status() == "under_review"
    d.submit_review(REVIEWER); assert d.status() == "evaluated"
    r = d.decide("jury_review"); assert r.status_code == 200, r.text
    assert d.status() == "jury_review"


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_AI_screens_when_assigned_first(client, monkeypatch, _clear, track):
    """Assign before AI runs -> app is under_review -> worker must still screen."""
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.assign([REVIEWER]); assert d.status() == "under_review"
    # No ai_screening row yet -> worker screens (real persist w/ advance_status=False
    # via handler); simulate the worker's persist directly to stay hermetic:
    d.run_ai()
    assert d.status() == "under_review"  # AI did not change status
    scr = fake.table("ai_screening").select("*").eq("application_id", app_id).execute().data
    assert scr  # screened despite being under_review


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_A5_admin_approve_sets_jury_review(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER]); d.submit_review(REVIEWER)
    assert d.status() == "evaluated"

    r = d.decide("jury_review")
    assert r.status_code == 200, r.text
    assert d.status() == "jury_review"
    # admin_decisions row written (gate1)
    dec = fake.tables["admin_decisions"]
    assert dec and dec[0]["decision"] == "jury_review" and dec[0]["application_id"] == app_id
    # applicant email hook fired for jury_review
    assert any(c.get("decision") == "jury_review" for c in ctx.calls["decision_email"])


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_B3_draft_review_does_not_flip(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER])
    d.submit_review(REVIEWER, draft=True)
    assert d.status() == "under_review"  # a draft is not a submitted review


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_B4_auto_transition_noop_when_not_under_review(client, monkeypatch, _clear, track):
    from app.services import state_machine
    app_id = f"app-{track}"
    fake = FakeSupabase({
        f"{track}_applications": [{"id": app_id, "user_id": APPLICANT, "status": "evaluated"}],
        "reviews": [{"id": "r1", "application_id": app_id, "application_track": track,
                     "status": "submitted", "submitted_at": "2026-07-01T00:00:00Z"}],
    })
    install_fake_db(monkeypatch, fake)
    fired = state_machine.auto_transition_to_evaluated_on_first_review(app_id, track)
    assert fired is False
    assert fake.status_of(track, app_id) == "evaluated"  # unchanged


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_B5_auto_transition_noop_with_no_reviews(client, monkeypatch, _clear, track):
    from app.services import state_machine
    app_id = f"app-{track}"
    fake = FakeSupabase({
        f"{track}_applications": [{"id": app_id, "user_id": APPLICANT, "status": "under_review"}],
        "reviews": [],
    })
    install_fake_db(monkeypatch, fake)
    fired = state_machine.auto_transition_to_evaluated_on_first_review(app_id, track)
    assert fired is False
    assert fake.status_of(track, app_id) == "under_review"


@pytest.mark.parametrize("track", ["tir", "sip"])
@pytest.mark.parametrize("decision,expected", [
    ("rejected", "rejected"), ("on_hold", "on_hold"), ("waitlisted", "waitlisted"),
])
def test_C1_C2_C3_decision_branches(client, monkeypatch, _clear, track, decision, expected):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER]); d.submit_review(REVIEWER)
    assert d.status() == "evaluated"

    r = d.decide(decision, rationale="because")
    assert r.status_code == 200, r.text
    assert d.status() == expected
    if decision == "rejected":
        assert any(c.get("decision") == "rejected" for c in ctx.calls["decision_email"])


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_C4_reject_without_rationale_is_422_and_status_unchanged(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.run_ai(); d.assign([REVIEWER]); d.submit_review(REVIEWER)
    r = d.decide("rejected", rationale="")
    assert r.status_code == 422
    assert d.status() == "evaluated"  # unchanged


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_D1_approve_directly_from_under_review(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit(); d.assign([REVIEWER])
    assert d.status() == "under_review"       # no reviews at all
    r = d.decide("jury_review")
    assert r.status_code == 200, r.text
    assert d.status() == "jury_review"        # skipped evaluated


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_D2_reject_directly_from_submitted(client, monkeypatch, _clear, track):
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [_seed_draft(track, app_id)]})
    ctx = install_fake_db(monkeypatch, fake)
    d = LifecycleDriver(client, ctx, track, app_id)

    d.submit()
    assert d.status() == "submitted"
    r = d.decide("rejected", rationale="out of scope")
    assert r.status_code == 200, r.text
    assert d.status() == "rejected"


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_D3_illegal_rewind_is_422_and_status_unchanged(client, monkeypatch, _clear, track):
    from app.services import state_machine
    app_id = f"app-{track}"
    fake = FakeSupabase({f"{track}_applications": [
        {"id": app_id, "user_id": APPLICANT, "status": "evaluated"}]})
    install_fake_db(monkeypatch, fake)
    with pytest.raises(Exception) as exc:
        state_machine.apply_status_change(app_id, track, to_status="submitted", changed_by=ADMIN)
    # HTTPException 422 illegal_transition
    assert getattr(exc.value, "status_code", None) == 422
    assert fake.status_of(track, app_id) == "evaluated"  # unchanged


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_E1_ai_worker_is_idempotent_on_already_screened(client, monkeypatch, _clear, track):
    """The worker's idempotency guard now keys on an existing `ai_screening`
    row — decoupled from status, since assignment (not AI screening) drives
    status. An already-screened app (here `under_review`, i.e. assigned
    before or after screening) must not be re-screened. The real module path
    (from backend/, pythonpath=".") is `workers.ai_screener.handler` — NOT
    `app.workers.ai_screener.handler` (there is no `app/workers` package).
    `handler.py` imports `get_admin_client` directly, so patching
    `handler.get_admin_client` is what `_process_record` actually reads."""
    from workers.ai_screener import handler
    from app.services.ai_pipeline import pipeline

    app_id = f"app-{track}"
    fake = FakeSupabase({
        f"{track}_applications": [{"id": app_id, "user_id": APPLICANT, "status": "under_review"}],
        "ai_screening": [{"application_id": app_id, "application_track": track, "score_overall": 7.0}],
    })
    install_fake_db(monkeypatch, fake)
    monkeypatch.setattr(handler, "get_admin_client", lambda: fake, raising=False)
    ran = {"n": 0}
    monkeypatch.setattr(
        pipeline, "run_for_application",
        lambda *a, **k: ran.__setitem__("n", ran["n"] + 1), raising=False,
    )

    handler._process_record({"body": {"application_id": app_id, "application_track": track}})

    assert ran["n"] == 0  # already screened -> skipped, no pipeline run
    assert fake.status_of(track, app_id) == "under_review"  # unchanged


def test_F1_F2_track_parity_and_correct_table(client, monkeypatch, _clear):
    """Same action sequence yields the same status at each hop for both tracks,
    and writes land in the correct per-track table only."""
    seq_status = {}
    for track in ("tir", "sip"):
        app_id = f"app-{track}"
        other = "sip" if track == "tir" else "tir"
        fake = FakeSupabase({
            f"{track}_applications": [_seed_draft(track, app_id)],
            f"{other}_applications": [],
        })
        ctx = install_fake_db(monkeypatch, fake)
        d = LifecycleDriver(client, ctx, track, app_id)

        hops = []
        d.submit(); hops.append(d.status())
        d.run_ai(); hops.append(d.status())
        d.assign([REVIEWER]); hops.append(d.status())
        d.submit_review(REVIEWER); hops.append(d.status())
        d.decide("jury_review"); hops.append(d.status())
        seq_status[track] = hops

        # F2: the other track's table was never written.
        assert fake.tables[f"{other}_applications"] == []
        app.dependency_overrides.clear()

    # F1: identical status sequence for both tracks.
    assert seq_status["tir"] == seq_status["sip"] == [
        "submitted", "submitted", "under_review", "evaluated", "jury_review"]
