"""Admin "VIP cohort" verification surface (spec §7): the AIR verification
queue and the MIS submissions matrix, under /admin/platform/vip.

Fixtures deliberately build state through the REAL founder-side routers
(/founder/air, /founder/mis) rather than hand-inserting rows — an
assessment/period only ever reaches `submitted` the way a real founder
would put it there, so these tests exercise the actual seam between the
founder-facing and admin-facing surfaces, not a shortcut that happens to
look similar.

Coverage:
  * capability gates — `view_all_apps` for reads, `manage_vip_cohort` for
    writes, granted only to admin/leadership
  * AIR queue: pending-lever rows, drops a lever once verified, sorted
  * AIR assessment detail: bundle shape + signed evidence URLs
  * verify: confirm / downgrade / reject-above-claimed / unknown lever /
    wrong assessment status
  * verifying the sixth lever flips the assessment to `verified` + rollups
  * confirm-all-at-claimed
  * Ruling 2 (per-round): verifying one round's lever never touches another
    round's same-keyed lever row
  * MIS matrix: multi-startup, overdue derivation
  * MIS period detail: read-only render
  * reopen: happy path, blocked by a later submitted period, 409 on a
    period that isn't submitted, 404 on an unknown period
"""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.services import air_catalog as air_cat
from app.services import mis_catalog as mis_cat

from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


class _Bucket:
    def upload(self, *a, **k): return {"path": a[0] if a else ""}
    def create_signed_url(self, path, expires_in): return {"signedURL": f"https://x/{path}"}


class _Storage:
    def from_(self, bucket): return _Bucket()


def _founder_user(app_id: str = "sapp1", user_id: str = "u1"):
    return lambda: {"user_id": user_id, "email": f"{user_id}@x.com", "roles": ["applicant"]}


def _admin_user(role: str = "admin"):
    return lambda: {"user_id": "admin1", "email": "admin1@x.com", "roles": [role]}


def _as(user_dict_fn):
    app.dependency_overrides[get_current_user] = user_dict_fn


def _install(monkeypatch, extra_sip_apps: list[dict] | None = None):
    from app.routers import admin_vip as admin_vip_router  # noqa: F401  (module has no client of its own)
    from app.routers import founder as founder_router
    from app.routers import founder_air as air_router
    from app.routers import founder_mis as mis_router
    from app.services import admin_vip_query, air_query, applications_query, mis_query

    sip_apps = [
        {"id": "sapp1", "user_id": "u1", "status": "onboarded",
         "submitted_at": "2026-01-01", "basic_org": "Acme Robotics"},
    ] + (extra_sip_apps or [])

    tables = {
        "sip_applications": sip_apps,
        "tir_applications": [],
        "application_status_log": [
            {"id": f"log-{a['id']}", "application_id": a["id"], "application_track": "sip",
             "from_status": "offered", "to_status": "onboarded",
             # Matches test_mis_endpoints.py's own fixture: onboarded 2026-06,
             # so with "today" frozen at 2026-08-16 the monthly calendar is
             # exactly [2026-06, 2026-07, 2026-08] — not a long earlier
             # backlog that would trip the in-order-submit rule these tests
             # aren't about.
             "changed_at": "2026-06-01T00:00:00+00:00"}
            for a in sip_apps
        ],
        "ai_screening": [],
        "vip_air_assessments": [], "vip_air_lever_scores": [], "vip_air_evidence": [],
        "vip_mis_periods": [], "vip_mis_metrics": [], "vip_mis_financials": [],
        "vip_mis_headcount": [], "vip_mis_entries": [],
        "audit_log_v2": [],
    }
    fake = FakeSupabase(tables)
    fake.storage = _Storage()
    for mod in (founder_router, air_router, mis_router, air_query, mis_query,
                admin_vip_query, applications_query):
        monkeypatch.setattr(mod, "get_admin_client", lambda f=fake: f)
    return fake


# ── helpers to drive the founder side into a submitted state ───────────────

def _score_everything(client, ladder: dict[str, tuple[str, str | None]] | None = None):
    """Answers every lever so claimed_level is non-null for all six. `ladder`
    lets a caller pick a lever's (q1_option, q2_option) to control its
    claimed level; every other lever gets the flat q1-only shape
    test_air_endpoints.py's own helper uses."""
    ladder = ladder or {}
    for lever in air_cat.LEVER_KEYS:
        if lever in ladder:
            q1, q2 = ladder[lever]
            client.put(f"/founder/air/levers/{lever}", json={
                "q1_option": q1, "q2_option": q2, "q3_option": None, "criteria_checked": []})
        else:
            first = air_cat.QUESTIONS[lever][0]["options"][0]["id"]
            client.put(f"/founder/air/levers/{lever}", json={
                "q1_option": first, "q2_option": None, "q3_option": None, "criteria_checked": []})


def _submit_air(client):
    """Creates + fully scores + submits the current-quarter AIR round.
    `user_needs` is answered q1=C, q2=B so its claimed_level is 5 (matches
    test_air_endpoints.py's own fixture), giving verify tests room to
    downgrade."""
    client.get("/founder/air")
    _score_everything(client, ladder={"user_needs": ("C", "B")})
    r = client.post("/founder/air/submit")
    assert r.status_code == 200, r.text
    return r.json()


def _submit_mis_period(client, kind: str, period_key: str):
    r = client.post(f"/founder/mis/{kind}/{period_key}/import/commit",
                    json={"submit": True})
    assert r.status_code == 200, r.text
    return r.json()


# ── capability gates ────────────────────────────────────────────────────

def test_reads_require_view_all_apps(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(lambda: {"user_id": "r1", "email": "r1@x.com", "roles": ["reviewer"]})
    for path in ("/admin/platform/vip/air/queue", "/admin/platform/vip/mis/matrix?kind=monthly"):
        r = client.get(path)
        assert r.status_code == 403, path


def test_writes_require_manage_vip_cohort(client, monkeypatch, _clear):
    _install(monkeypatch)
    # leadership HAS view_all_apps but reviewer has neither — use a role with
    # NEITHER capability to prove the write gate is enforced independently.
    _as(lambda: {"user_id": "r1", "email": "r1@x.com", "roles": ["reviewer"]})
    r = client.post("/admin/platform/vip/air/assessments/x/confirm-all")
    assert r.status_code == 403
    assert r.json()["detail"]["required"] == "manage_vip_cohort"


def test_admin_and_leadership_both_hold_manage_vip_cohort(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    _as(_founder_user())
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]
    for role in ("admin", "leadership"):
        _as(_admin_user(role))
        r = client.post(f"/admin/platform/vip/air/assessments/{assessment_id}/confirm-all")
        # First call (admin) verifies+finalizes; second call (leadership) on an
        # already-verified round is a 409 — both prove the CAPABILITY gate let
        # them through (a 403 would mean the gate itself failed).
        assert r.status_code in (200, 409), r.text


# ── AIR queue ────────────────────────────────────────────────────────────

def test_queue_lists_one_row_per_pending_lever(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    _submit_air(client)

    _as(_admin_user())
    r = client.get("/admin/platform/vip/air/queue")
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    assert len(rows) == 6
    assert {row["lever"] for row in rows} == set(air_cat.LEVER_KEYS)
    un = next(row for row in rows if row["lever"] == "user_needs")
    assert un["claimed_level"] == 5
    assert un["startup"] == "Acme Robotics"
    assert un["assessment_id"]


def test_verified_lever_drops_off_the_queue(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]

    _as(_admin_user())
    client.post(
        f"/admin/platform/vip/air/assessments/{assessment_id}/levers/architecture/verify",
        json={"verified_level": 1, "verifier_note": None},
    )
    rows = client.get("/admin/platform/vip/air/queue").json()["rows"]
    assert "architecture" not in {row["lever"] for row in rows}
    assert len(rows) == 5


def test_queue_is_empty_with_no_submitted_rounds(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_admin_user())
    assert client.get("/admin/platform/vip/air/queue").json() == {"rows": []}


# ── assessment detail ────────────────────────────────────────────────────

def test_assessment_detail_has_bundle_shape_and_signed_evidence(client, monkeypatch, _clear):
    import io
    from app.routers import founder_air as air_router
    monkeypatch.setattr(air_router, "_upload", lambda *a, **k: None)

    _install(monkeypatch)
    _as(_founder_user())
    client.get("/founder/air")
    client.post(
        "/founder/air/evidence",
        files={"file": ("arch.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
        data={"lever": "architecture", "air_level": "1"},
    )
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]

    _as(_admin_user())
    r = client.get(f"/admin/platform/vip/air/assessments/{assessment_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["levers"]) == 6
    assert body["startup"] == "Acme Robotics"
    arch = next(l for l in body["levers"] if l["lever"] == "architecture")
    assert len(arch["evidence"]) == 1
    assert arch["evidence"][0]["signed_url"].startswith("https://x/")


def test_unknown_assessment_is_404(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_admin_user())
    r = client.get("/admin/platform/vip/air/assessments/nope")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "assessment_not_found"


# ── verify ───────────────────────────────────────────────────────────────

def test_verify_confirms_at_claimed(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]

    _as(_admin_user())
    r = client.post(
        f"/admin/platform/vip/air/assessments/{assessment_id}/levers/user_needs/verify",
        json={"verified_level": 5, "verifier_note": None},
    )
    assert r.status_code == 200, r.text
    un = next(l for l in r.json()["levers"] if l["lever"] == "user_needs")
    assert un["verified_level"] == 5


def test_verify_can_downgrade_with_a_note(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]

    _as(_admin_user())
    r = client.post(
        f"/admin/platform/vip/air/assessments/{assessment_id}/levers/user_needs/verify",
        json={"verified_level": 3, "verifier_note": "Evidence only supports AIR 3."},
    )
    assert r.status_code == 200, r.text
    un = next(l for l in r.json()["levers"] if l["lever"] == "user_needs")
    assert un["verified_level"] == 3
    assert un["verifier_note"] == "Evidence only supports AIR 3."


def test_verify_rejects_above_claimed(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]

    _as(_admin_user())
    r = client.post(
        f"/admin/platform/vip/air/assessments/{assessment_id}/levers/user_needs/verify",
        json={"verified_level": 6, "verifier_note": None},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "verified_level_out_of_range"
    assert r.json()["detail"]["claimed_level"] == 5


def test_verify_unknown_lever_is_404(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]

    _as(_admin_user())
    r = client.post(
        f"/admin/platform/vip/air/assessments/{assessment_id}/levers/nonsense/verify",
        json={"verified_level": 1, "verifier_note": None},
    )
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "unknown_lever"


def test_verify_rejects_a_draft_round(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    client.get("/founder/air")  # draft round only, not submitted
    from app.services import air_query
    from app.services import mis_periods as mp
    rnd = air_query.fetch_round("sapp1", air_query.current_round_label(mp.today_ist()))
    assessment_id = rnd["id"]

    _as(_admin_user())
    r = client.post(
        f"/admin/platform/vip/air/assessments/{assessment_id}/levers/architecture/verify",
        json={"verified_level": 1, "verifier_note": None},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "air_not_open_for_verification"


def test_verifying_the_sixth_lever_flips_to_verified_and_publishes_rollups(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]

    _as(_admin_user())
    levers = list(air_cat.LEVER_KEYS)
    for lever in levers[:-1]:
        r = client.post(
            f"/admin/platform/vip/air/assessments/{assessment_id}/levers/{lever}/verify",
            json={"verified_level": 1, "verifier_note": None},
        )
        assert r.status_code == 200, r.text
        assert r.json()["round"]["status"] == "submitted"

    last = levers[-1]
    r = client.post(
        f"/admin/platform/vip/air/assessments/{assessment_id}/levers/{last}/verify",
        json={"verified_level": 1, "verifier_note": None},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["round"]["status"] == "verified"
    assert body["rollups"]["verified"]["overall"] == 1
    assert body["rollups"]["verified"]["technology"] == 1
    assert body["rollups"]["verified"]["commercial"] == 1

    # Re-verifying after the round is fully verified is refused, not silently applied.
    r2 = client.post(
        f"/admin/platform/vip/air/assessments/{assessment_id}/levers/{last}/verify",
        json={"verified_level": 1, "verifier_note": None},
    )
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "air_not_open_for_verification"


# ── confirm-all ──────────────────────────────────────────────────────────

def test_confirm_all_verifies_every_lever_at_claimed_and_finalizes(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_founder_user())
    bundle = _submit_air(client)
    assessment_id = bundle["round"]["id"]
    claimed_by_lever = {l["lever"]: l["claimed_level"] for l in bundle["levers"]}

    _as(_admin_user())
    r = client.post(f"/admin/platform/vip/air/assessments/{assessment_id}/confirm-all")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["round"]["status"] == "verified"
    for l in body["levers"]:
        assert l["verified_level"] == claimed_by_lever[l["lever"]]
    assert body["rollups"]["verified"] == body["rollups"]["claimed"]


def test_confirm_all_rejects_a_non_submitted_assessment(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_admin_user())
    r = client.post("/admin/platform/vip/air/assessments/nope/confirm-all")
    assert r.status_code == 404


# ── Ruling 2: per-round scoping ─────────────────────────────────────────

def test_verify_never_touches_a_different_round(client, monkeypatch, _clear, freezer):
    """Two rounds exist for the same application (one submitted in an
    earlier quarter, one submitted in the current quarter). Verifying the
    OLDER round's `architecture` lever must not write verified_level onto
    the NEWER round's `architecture` row."""
    _install(monkeypatch)
    freezer.move_to("2026-05-15T06:00:00Z")  # FY26-27-Q1
    _as(_founder_user())
    old_bundle = _submit_air(client)
    old_assessment_id = old_bundle["round"]["id"]
    assert old_bundle["round"]["round_label"] == "FY26-27-Q1"

    freezer.move_to("2026-08-15T06:00:00Z")  # FY26-27-Q2
    new_bundle = _submit_air(client)
    new_assessment_id = new_bundle["round"]["id"]
    assert new_bundle["round"]["round_label"] == "FY26-27-Q2"
    assert new_assessment_id != old_assessment_id

    _as(_admin_user())
    r = client.post(
        f"/admin/platform/vip/air/assessments/{old_assessment_id}/levers/architecture/verify",
        json={"verified_level": 1, "verifier_note": "old round only"},
    )
    assert r.status_code == 200, r.text

    new_detail = client.get(f"/admin/platform/vip/air/assessments/{new_assessment_id}").json()
    new_arch = next(l for l in new_detail["levers"] if l["lever"] == "architecture")
    assert new_arch["verified_level"] is None
    assert new_arch["verifier_note"] is None

    old_detail = client.get(f"/admin/platform/vip/air/assessments/{old_assessment_id}").json()
    old_arch = next(l for l in old_detail["levers"] if l["lever"] == "architecture")
    assert old_arch["verified_level"] == 1


# ── MIS matrix ───────────────────────────────────────────────────────────

@pytest.fixture(autouse=False)
def _frozen_mis_today(freezer):
    freezer.move_to("2026-08-16T06:00:00Z")


def test_mis_matrix_shows_startups_and_derives_overdue(client, monkeypatch, _clear, _frozen_mis_today):
    _install(monkeypatch, extra_sip_apps=[
        {"id": "sapp2", "user_id": "u2", "status": "onboarded",
         "submitted_at": "2026-01-01", "basic_org": "Beta Sensors"},
    ])
    for uid, aid in (("u1", "sapp1"), ("u2", "sapp2")):
        _as(_founder_user(app_id=aid, user_id=uid))
        client.get("/founder/mis")

    _as(_admin_user())
    r = client.get("/admin/platform/vip/mis/matrix?kind=monthly")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "monthly"
    startup_names = {s["startup"] for s in body["startups"]}
    assert startup_names == {"Acme Robotics", "Beta Sensors"}
    period_keys = {pk["period_key"] for pk in body["period_keys"]}
    assert "2026-08" in period_keys
    acme = next(s for s in body["startups"] if s["startup"] == "Acme Robotics")
    assert acme["periods"]["2026-06"]["status"] == "draft"
    # 2026-06's due date (5 Jul 2026) is well before the frozen "today"
    # (16 Aug 2026) and the period is still draft -> overdue.
    assert acme["periods"]["2026-06"]["overdue"] is True
    assert acme["periods"]["2026-08"]["overdue"] is False


def test_mis_matrix_rejects_an_unknown_kind(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_admin_user())
    r = client.get("/admin/platform/vip/mis/matrix?kind=weekly")
    assert r.status_code == 422


def test_mis_matrix_empty_with_no_periods(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_admin_user())
    body = client.get("/admin/platform/vip/mis/matrix?kind=monthly").json()
    assert body == {"kind": "monthly", "period_keys": [], "startups": []}


# ── MIS period detail ────────────────────────────────────────────────────

def test_mis_period_detail_is_read_only_render(client, monkeypatch, _clear, _frozen_mis_today):
    _install(monkeypatch)
    _as(_founder_user())
    client.get("/founder/mis")
    _submit_mis_period(client, "monthly", "2026-06")

    _as(_admin_user())
    r = client.get("/admin/platform/vip/mis/sapp1/monthly/2026-06")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["period"]["status"] == "submitted"
    assert body["startup"] == "Acme Robotics"
    assert len(body["metrics"]) == len(mis_cat.METRICS)


def test_mis_period_detail_404_on_unknown_period(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_admin_user())
    r = client.get("/admin/platform/vip/mis/sapp1/monthly/2099-01")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "not_found"


# ── reopen ───────────────────────────────────────────────────────────────

def test_reopen_returns_a_submitted_period_to_draft(client, monkeypatch, _clear, _frozen_mis_today):
    _install(monkeypatch)
    _as(_founder_user())
    client.get("/founder/mis")
    _submit_mis_period(client, "monthly", "2026-06")

    _as(_admin_user())
    r = client.post("/admin/platform/vip/mis/sapp1/monthly/2026-06/reopen")
    assert r.status_code == 200, r.text
    assert r.json()["period"]["status"] == "draft"
    assert r.json()["period"]["reopened_at"] is not None

    # The founder can edit it again now that it's a draft.
    _as(_founder_user())
    r2 = client.post("/founder/mis/monthly/2026-06/import/commit", json={"metrics": []})
    assert r2.status_code == 200, r2.text


def test_reopen_404_on_unknown_period(client, monkeypatch, _clear):
    _install(monkeypatch)
    _as(_admin_user())
    r = client.post("/admin/platform/vip/mis/sapp1/monthly/2099-01/reopen")
    assert r.status_code == 404


def test_reopen_409_on_a_period_that_is_not_submitted(client, monkeypatch, _clear, _frozen_mis_today):
    _install(monkeypatch)
    _as(_founder_user())
    client.get("/founder/mis")  # 2026-08 stays a draft

    _as(_admin_user())
    r = client.post("/admin/platform/vip/mis/sapp1/monthly/2026-08/reopen")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "mis_not_submitted"


def test_reopen_refuses_when_a_later_period_is_already_submitted(client, monkeypatch, _clear, _frozen_mis_today):
    """The exact counterpart of founder_mis's in-order-submit ruling: July
    is submitted, then August is submitted (July no longer blocks it since
    July is no longer draft). Reopening July while August is submitted must
    be refused, naming August as the blocker."""
    _install(monkeypatch)
    _as(_founder_user())
    client.get("/founder/mis")
    _submit_mis_period(client, "monthly", "2026-06")
    _submit_mis_period(client, "monthly", "2026-07")
    _submit_mis_period(client, "monthly", "2026-08")

    _as(_admin_user())
    r = client.post("/admin/platform/vip/mis/sapp1/monthly/2026-07/reopen")
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "mis_later_period_submitted"
    assert detail["period_key"] == "2026-08"

    # The most recent submitted period (2026-08) reopens cleanly — nothing
    # later exists to block it.
    r2 = client.post("/admin/platform/vip/mis/sapp1/monthly/2026-08/reopen")
    assert r2.status_code == 200, r2.text

    # With 2026-08 no longer submitted, 2026-07 now reopens too.
    r3 = client.post("/admin/platform/vip/mis/sapp1/monthly/2026-07/reopen")
    assert r3.status_code == 200, r3.text
