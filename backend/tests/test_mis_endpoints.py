"""The /founder/mis surface: VIP-only, lazy period generation, freeze-on-
submit with reads staying open, structural ownership, and server-set
trl_level.

Time is frozen for the whole file (see `_frozen_today`) because the router
derives "today" from the real wall clock (`mis_periods.today_ist()`), and
period_key generation (which months/quarters exist) must be deterministic
for the round-trip assertions below to mean anything.

Fixture calendar: onboarded 2026-06-10, frozen "today" 2026-08-16 (IST) ->
monthly periods 2026-06, 2026-07, 2026-08; quarterly periods FY26-27-Q1
(Apr-Jun), FY26-27-Q2 (Jul-Sep, the current one).
"""
from __future__ import annotations

import pytest
from app.deps import get_current_user
from app.main import app
from app.services import air_catalog as air_cat
from app.services import mis_catalog as cat

from tests.fixtures.fake_supabase import FakeSupabase

CUR_MONTH = "2026-08"
CUR_QUARTER = "FY26-27-Q2"


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _frozen_today(freezer):
    # 06:00 UTC = 11:30 IST on the same calendar day — nowhere near a
    # midnight boundary, so this is not accidentally exercising IST/UTC
    # date-rollover behaviour that belongs to test_mis_periods.py instead.
    freezer.move_to("2026-08-16T06:00:00Z")


def _user(track: str):
    return lambda: {"user_id": "u1", "email": "u1@x.com", "track": track,
                    "roles": ["applicant"]}


def _install(monkeypatch, track: str = "sip", onboarded_on: str = "2026-06-10"):
    from app.routers import founder as founder_router
    from app.routers import founder_mis as mis_router
    from app.services import air_query, mis_query

    tables = {
        "sip_applications": [{"id": "sapp1", "user_id": "u1", "status": "onboarded",
                              "submitted_at": "2026-01-01"}],
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-01-01"}],
        "application_status_log": [
            {"id": "log1", "application_id": "sapp1", "application_track": "sip",
             "from_status": "offered", "to_status": "onboarded",
             "changed_at": f"{onboarded_on}T00:00:00+00:00"},
        ],
        "vip_mis_periods": [], "vip_mis_metrics": [], "vip_mis_financials": [],
        "vip_mis_headcount": [], "vip_mis_entries": [],
        "vip_air_assessments": [], "vip_air_lever_scores": [],
    }
    if track == "sip":
        tables["tir_applications"] = []
    fake = FakeSupabase(tables)
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(mis_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(mis_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_query, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _user(track)
    return fake


# ── VIP gate ──────────────────────────────────────────────────────────────

_ALL_ROUTES = [
    ("get", "/founder/mis", None),
    ("get", f"/founder/mis/monthly/{CUR_MONTH}", None),
    ("put", f"/founder/mis/monthly/{CUR_MONTH}/metrics", []),
    ("put", f"/founder/mis/monthly/{CUR_MONTH}/narrative", {}),
    ("put", f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", []),
    ("put", f"/founder/mis/quarterly/{CUR_QUARTER}/financials", []),
    ("put", f"/founder/mis/quarterly/{CUR_QUARTER}/headcount", []),
    ("post", f"/founder/mis/monthly/{CUR_MONTH}/submit", None),
]


def test_tir_callers_409_on_every_endpoint(client, monkeypatch, _clear):
    _install(monkeypatch, track="tir")
    for method, path, body in _ALL_ROUTES:
        r = getattr(client, method)(path, json=body) if body is not None or method != "get" else client.get(path)
        assert r.status_code == 409, f"{method} {path} -> {r.status_code}"
        assert r.json()["detail"]["code"] == "not_available_for_track"


# ── index: lazy period generation ────────────────────────────────────────

def test_get_creates_and_lists_both_kinds_periods(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    r = client.get("/founder/mis")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [p["period_key"] for p in body["monthly"]] == ["2026-06", "2026-07", "2026-08"]
    assert [p["period_key"] for p in body["quarterly"]] == ["FY26-27-Q1", "FY26-27-Q2"]
    assert body["catalog"]["kinds"] == ["monthly", "quarterly"]
    assert len(fake.tables["vip_mis_periods"]) == 5
    assert all(p["status"] == "draft" for p in body["monthly"] + body["quarterly"])


def test_get_is_idempotent(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/mis")
    client.get("/founder/mis")
    assert len(fake.tables["vip_mis_periods"]) == 5


# ── detail bundle ─────────────────────────────────────────────────────────

def test_get_period_bundle(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.get(f"/founder/mis/monthly/{CUR_MONTH}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["period"]["period_key"] == CUR_MONTH
    assert body["period"]["status"] == "draft"
    assert len(body["metrics"]) == len(cat.METRICS)
    trl = next(m for m in body["metrics"] if m["metric_key"] == "trl_level")
    assert trl["actual"] is None  # no verified AIR level yet


def test_unknown_kind_is_404(client, monkeypatch, _clear):
    _install(monkeypatch)
    r = client.get(f"/founder/mis/weekly/{CUR_MONTH}")
    assert r.status_code == 404


def test_unknown_period_key_is_404(client, monkeypatch, _clear):
    _install(monkeypatch)
    r = client.get("/founder/mis/monthly/2099-01")
    assert r.status_code == 404


# ── PUT round-trips ──────────────────────────────────────────────────────

def test_metrics_put_round_trips(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "revenue_month", "actual": 12.5, "target": 10, "commentary": "good month"},
    ])
    assert r.status_code == 200, r.text
    m = next(x for x in r.json()["metrics"] if x["metric_key"] == "revenue_month")
    assert m["actual"] == 12.5
    assert m["target"] == 10
    assert m["commentary"] == "good month"


def test_narrative_put_replaces_wholesale(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/narrative", json={
        "exec.headline_win": "Shipped v2", "exec.biggest_concern": "Runway",
    })
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/narrative", json={
        "exec.headline_win": "Closed pilot",
    })
    assert r.status_code == 200, r.text
    # A genuine REPLACE, not a merge: the second PUT's narrative has no
    # "exec.biggest_concern" key, so it must be gone from the stored blob,
    # not merely overwritten to null.
    assert r.json()["narrative"] == {"exec.headline_win": "Closed pilot"}


def test_entries_put_replaces_section_wholesale(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "Alpha launch", "owner": "Asha", "status": "On Track", "notes": ""},
        {"milestone": "Beta launch", "owner": "Ravi", "status": "Blocked", "notes": "waiting on IP"},
    ])
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "GA launch", "owner": "Asha", "status": "At Risk", "notes": ""},
    ])
    assert r.status_code == 200, r.text
    rows = r.json()["entries"]["milestones"]
    assert len(rows) == 1
    assert rows[0]["data"]["milestone"] == "GA launch"


def test_financials_put_round_trips(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/financials", json=[
        {"series": "needs_total", "bucket": "Q1 (Current)", "amount": 500000},
        {"series": "needs_confirmed", "bucket": "Q1 (Current)", "amount": 200000},
        {"series": "needs_projected", "bucket": "Q1 (Current)", "amount": 100000},
    ])
    assert r.status_code == 200, r.text
    body = r.json()
    # FakeSupabase does not apply column defaults, so the many OTHER
    # pre-seeded blank financial rows for this period never got an
    # "amount" key inserted at all (unlike real Postgrest, which would
    # always return amount: null) — .get() rather than [] here on purpose.
    by_key = {(f["series"], f["bucket"]): f.get("amount") for f in body["financials"]}
    assert by_key[("needs_total", "Q1 (Current)")] == 500000
    assert body["derived"]["financials"]["needs_gap"]["Q1 (Current)"] == 200000


def test_headcount_put_round_trips(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/headcount", json=[
        {"category": "startup", "current_count": 5, "exited": 1, "remarks": "grew"},
    ])
    assert r.status_code == 200, r.text
    row = next(h for h in r.json()["headcount"] if h["category"] == "startup")
    assert row["current_count"] == 5
    assert row["exited"] == 1


# ── freeze on submit; reads stay open ────────────────────────────────────

def test_submit_flips_status_and_stamps_timestamps(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/submit")
    assert r.status_code == 200, r.text
    assert r.json()["period"]["status"] == "submitted"
    row = next(p for p in fake.tables["vip_mis_periods"] if p["period_key"] == CUR_MONTH)
    assert row["status"] == "submitted"
    assert row["submitted_at"]
    assert row["updated_at"]


def test_submitted_period_rejects_every_write_but_serves_every_read(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    client.post(f"/founder/mis/monthly/{CUR_MONTH}/submit")

    writes = [
        ("put", f"/founder/mis/monthly/{CUR_MONTH}/metrics", []),
        ("put", f"/founder/mis/monthly/{CUR_MONTH}/narrative", {}),
        ("put", f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", []),
        ("post", f"/founder/mis/monthly/{CUR_MONTH}/submit", None),
    ]
    for method, path, body in writes:
        r = getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
        assert r.status_code == 409, f"{method} {path} -> {r.status_code}"
        assert r.json()["detail"]["code"] == "mis_already_submitted"

    # Reads must still work — this is the exact mistake Phase 2 made on a
    # read endpoint, and the constraint this test exists to guard.
    r = client.get(f"/founder/mis/monthly/{CUR_MONTH}")
    assert r.status_code == 200, r.text
    assert r.json()["period"]["status"] == "submitted"
    r = client.get("/founder/mis")
    assert r.status_code == 200


def test_quarterly_writes_also_freeze_on_submit(client, monkeypatch, _clear):
    """The freeze/reads-stay-open pair above is only exercised on monthly
    (metrics/entries/narrative); financials and headcount are quarterly-only
    writes and need their own proof they freeze the same way."""
    _install(monkeypatch)
    client.get("/founder/mis")
    client.post(f"/founder/mis/quarterly/{CUR_QUARTER}/submit")

    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/financials", json=[])
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "mis_already_submitted"
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/headcount", json=[])
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "mis_already_submitted"

    r = client.get(f"/founder/mis/quarterly/{CUR_QUARTER}")
    assert r.status_code == 200, r.text
    assert r.json()["period"]["status"] == "submitted"


# ── unknown things 404/422 ────────────────────────────────────────────────

def test_unknown_section_is_404(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/not_a_real_section", json=[])
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "unknown_section"


def test_section_belonging_to_the_other_kind_is_404(client, monkeypatch, _clear):
    """"ip_assets" is a genuine mis_catalog entries section — just not one
    monthly owns. A lookup keyed only on ENTRY_FIELDS (ignoring which kind
    a section actually belongs to) would wrongly accept this."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/ip_assets", json=[])
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "unknown_section"


def test_unknown_entry_field_is_422(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "x", "not_a_real_field": "y"},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "unknown_field"


def test_supplying_trl_level_actual_is_422(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "trl_level", "actual": 5},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "computed_metric"


def test_unknown_metric_key_is_422(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "not_a_real_metric", "actual": 1},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "unknown_field"


def test_needs_gap_series_is_rejected_as_computed(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/financials", json=[
        {"series": "needs_gap", "bucket": "Q1 (Current)", "amount": 100},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "computed_metric"


def test_unknown_headcount_category_is_422(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/headcount", json=[
        {"category": "not_a_real_category", "current_count": 1},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "unknown_field"


# ── structural ownership ──────────────────────────────────────────────────

def test_another_applications_period_is_not_reachable(client, monkeypatch, _clear):
    """The foreign row is seeded under the CURRENT period_key deliberately —
    the same key our own application's period will carry — so this cannot
    pass vacuously (e.g. by both sides simply being empty/absent)."""
    fake = _install(monkeypatch)
    fake.tables["vip_mis_periods"].append({
        "id": "foreign-period", "application_id": "someone-else", "kind": "monthly",
        "period_key": CUR_MONTH, "label": "Aug 2026",
        "period_start": "2026-08-01", "period_end": "2026-08-31",
        "due_date": "2026-09-05", "status": "draft", "narrative": {},
    })
    client.get("/founder/mis")  # creates OUR OWN period row for CUR_MONTH
    r = client.get(f"/founder/mis/monthly/{CUR_MONTH}")
    assert r.status_code == 200, r.text
    assert r.json()["period"]["id"] != "foreign-period"

    # And the foreign row is untouched by our submit.
    client.post(f"/founder/mis/monthly/{CUR_MONTH}/submit")
    foreign = next(p for p in fake.tables["vip_mis_periods"] if p["id"] == "foreign-period")
    assert foreign["status"] == "draft"


# ── TRL sourcing (constraint 4) ───────────────────────────────────────────

def test_trl_level_reflects_the_verified_air_level(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    fake.tables["vip_air_assessments"].append({
        "id": "round1", "application_id": "sapp1", "round_label": CUR_QUARTER,
        "status": "submitted",
    })
    for lever in air_cat.LEVER_KEYS:
        fake.tables["vip_air_lever_scores"].append({
            "id": f"score-{lever}", "assessment_id": "round1", "lever": lever,
            "verified_level": 4, "criteria_checked": [],
        })
    client.get("/founder/mis")
    r = client.get(f"/founder/mis/monthly/{CUR_MONTH}")
    trl = next(m for m in r.json()["metrics"] if m["metric_key"] == "trl_level")
    assert trl["actual"] == 4


def test_trl_level_is_null_when_any_lever_unverified(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    fake.tables["vip_air_assessments"].append({
        "id": "round1", "application_id": "sapp1", "round_label": CUR_QUARTER,
        "status": "draft",
    })
    levers = list(air_cat.LEVER_KEYS)
    for lever in levers[:-1]:
        fake.tables["vip_air_lever_scores"].append({
            "id": f"score-{lever}", "assessment_id": "round1", "lever": lever,
            "verified_level": 4, "criteria_checked": [],
        })
    # last lever left unverified (verified_level None)
    fake.tables["vip_air_lever_scores"].append({
        "id": f"score-{levers[-1]}", "assessment_id": "round1", "lever": levers[-1],
        "verified_level": None, "criteria_checked": [],
    })
    client.get("/founder/mis")
    r = client.get(f"/founder/mis/monthly/{CUR_MONTH}")
    trl = next(m for m in r.json()["metrics"] if m["metric_key"] == "trl_level")
    assert trl["actual"] is None
