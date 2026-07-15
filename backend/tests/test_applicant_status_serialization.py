"""Regression: applicant READ models must serialize EVERY DB status.

Prod bug (2026-07): `status` was a narrow Literal missing 'evaluated' /
'jury_review' / etc. `GET /applications/me/submitted` (and the SIP twin) ran
`ApplicationRead.model_validate(row)` outside its try/except AND as its
response_model, so any reviewed (`evaluated`) or admin-approved (`jury_review`)
applicant's list 500'd. The frontend `.catch(() => [])` then showed the
"applications closed" screen — most applicants could not see their submission.

Fix: the applicant read type is a permissive `str`, and the submitted-list
endpoints skip (not 500 on) a row that fails to serialize.
"""
from __future__ import annotations

import asyncio

import pytest

from app.models.application import ApplicationRead
from app.models.sip_application import SipApplicationRead

_BASE = {
    "id": "a1",
    "user_id": "u1",
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
}

# The full state-machine status set (backend/app/services/state_machine.py).
_ALL_STATUSES = [
    "draft", "submitted", "ai_screening", "screening_failed", "under_review",
    "evaluated", "on_hold", "shortlisted", "jury_review", "interview",
    "offered", "onboarded", "rejected", "waitlisted", "withdrawn",
]


@pytest.mark.parametrize("status", _ALL_STATUSES)
def test_tir_read_accepts_every_status(status):
    r = ApplicationRead.model_validate({**_BASE, "status": status})
    assert r.status == status


@pytest.mark.parametrize("status", _ALL_STATUSES)
def test_sip_read_accepts_every_status(status):
    r = SipApplicationRead.model_validate({**_BASE, "status": status})
    assert r.status == status


@pytest.mark.parametrize("field", ["problem_describe", "solution_describe"])
def test_tir_read_accepts_overlong_essay(field):
    # Pre-cap rows can hold >5000-char essays; the READ model must not re-impose
    # the input cap (the DB CHECK guards length), else the applicant's own
    # GET /me/submitted 500s on their own answer.
    r = ApplicationRead.model_validate({**_BASE, "status": "evaluated", field: "x" * 6000})
    assert len(getattr(r, field)) == 6000


@pytest.mark.parametrize("field", ["problem_describe", "solution_describe"])
def test_sip_read_accepts_overlong_essay(field):
    r = SipApplicationRead.model_validate({**_BASE, "status": "evaluated", field: "x" * 6000})
    assert len(getattr(r, field)) == 6000


def test_tir_submitted_endpoint_skips_unserializable_row(monkeypatch):
    """A single bad row must not 500 the whole list."""
    from app.routers import applications as ar

    good = {**_BASE, "status": "evaluated"}
    bad = {"id": "b2", "user_id": "u1", "status": "evaluated"}  # missing created_at/updated_at

    monkeypatch.setattr(ar, "_fetch_submitted_applications", lambda uid: [good, bad])
    monkeypatch.setattr(ar, "edit_deadline_for", lambda track: None)

    out = asyncio.run(ar.list_submitted_applications(current_user={"user_id": "u1"}))
    ids = [o.id for o in out]
    assert "a1" in ids
    assert "b2" not in ids
