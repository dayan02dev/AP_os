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


# ── Minor-9: product_metric_1/2 labels are the only editable ones ────────

def test_product_metric_label_is_editable(client, monkeypatch, _clear):
    """The template itself marks rows 6/7 as venture-defined with editable
    labels (§2)."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "product_metric_1", "label": "Model accuracy (%)", "actual": 92},
    ])
    assert r.status_code == 200, r.text
    m = next(x for x in r.json()["metrics"] if x["metric_key"] == "product_metric_1")
    assert m["label"] == "Model accuracy (%)"


def test_standard_metric_label_cannot_be_overwritten(client, monkeypatch, _clear):
    """Every metric OTHER than product_metric_1/2 always gets the catalog
    label, even if a request tries to supply one — a founder must not be
    able to rename a standard metric to flatter the numbers (the section's
    own hint: "do not change definitions to make things look better")."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "revenue_month", "label": "Definitely Not Revenue", "actual": 10},
    ])
    assert r.status_code == 200, r.text
    m = next(x for x in r.json()["metrics"] if x["metric_key"] == "revenue_month")
    assert m["label"] == "Revenue this month (₹ Lakh)"


def test_blank_product_metric_label_falls_back_to_the_catalog_placeholder(client, monkeypatch, _clear):
    """An omitted/blank label on product_metric_1/2 must not upsert a
    blank into the NOT NULL `label` column."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "product_metric_2", "actual": 5},
    ])
    assert r.status_code == 200, r.text
    m = next(x for x in r.json()["metrics"] if x["metric_key"] == "product_metric_2")
    assert m["label"] == "Key product metric #2"


def test_narrative_put_merges_into_the_existing_blob(client, monkeypatch, _clear):
    """Important-4 ruling: PUT merges, it does not replace. A second PUT
    naming only "exec.headline_win" must leave "exec.biggest_concern"
    (saved by the FIRST PUT, and not resubmitted here) untouched — the
    footgun a whole-blob replace created for a founder editing one
    narrative section at a time."""
    _install(monkeypatch)
    client.get("/founder/mis")
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/narrative", json={
        "exec.headline_win": "Shipped v2", "exec.biggest_concern": "Runway",
    })
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/narrative", json={
        "exec.headline_win": "Closed pilot",
    })
    assert r.status_code == 200, r.text
    assert r.json()["narrative"] == {
        "exec.headline_win": "Closed pilot", "exec.biggest_concern": "Runway",
    }


def test_narrative_put_null_clears_a_single_field(client, monkeypatch, _clear):
    """The one way to actually blank a field back out under merge
    semantics: submit it with an explicit JSON `null`. Every other
    existing field stays untouched."""
    _install(monkeypatch)
    client.get("/founder/mis")
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/narrative", json={
        "exec.headline_win": "Shipped v2", "exec.biggest_concern": "Runway",
    })
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/narrative", json={
        "exec.biggest_concern": None,
    })
    assert r.status_code == 200, r.text
    assert r.json()["narrative"] == {
        "exec.headline_win": "Shipped v2", "exec.biggest_concern": None,
    }


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
    # Fix 1: both predecessors must be submitted first, or the in-order
    # gate 409s CUR_MONTH — unrelated to what this test actually checks.
    client.post("/founder/mis/monthly/2026-06/submit")
    client.post("/founder/mis/monthly/2026-07/submit")
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
    # Fix 1: clear the in-order gate before submitting CUR_MONTH itself.
    client.post("/founder/mis/monthly/2026-06/submit")
    client.post("/founder/mis/monthly/2026-07/submit")
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
    # Fix 1: FY26-27-Q1 must be submitted first, or the in-order gate
    # 409s CUR_QUARTER — unrelated to what this test actually checks.
    client.post("/founder/mis/quarterly/FY26-27-Q1/submit")
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


# ── Fix 1: enforce in-order submit ────────────────────────────────────────

def test_submit_with_earlier_draft_predecessor_409s_and_names_blocker(client, monkeypatch, _clear):
    """The bug this closes: a founder submitting August while July (and
    June) are still draft — the target `2026-08` has TWO earlier drafts,
    and the 409 must name the EARLIEST of them (`2026-06`), not merely
    "some" earlier draft."""
    _install(monkeypatch)
    client.get("/founder/mis")  # creates 2026-06, 2026-07, 2026-08 (all draft)
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/submit")
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "mis_earlier_period_open"
    assert r.json()["detail"]["period_key"] == "2026-06"
    assert r.json()["detail"]["label"]


def test_submit_earliest_period_succeeds_nothing_before_it(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post("/founder/mis/monthly/2026-06/submit")
    assert r.status_code == 200, r.text
    assert r.json()["period"]["status"] == "submitted"


def test_submit_succeeds_once_every_predecessor_is_submitted(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post("/founder/mis/monthly/2026-06/submit")
    assert r.status_code == 200, r.text
    r = client.post("/founder/mis/monthly/2026-07/submit")
    assert r.status_code == 200, r.text
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/submit")
    assert r.status_code == 200, r.text


def test_submit_gate_uses_period_start_not_period_key_string_order(client, monkeypatch, _clear):
    """period_key string order and period_start date order are made to
    disagree on purpose: the row given the alphabetically LARGER key
    ("9999-99") is seeded with the actually-EARLIER real date, and the
    row given the alphabetically SMALLER key ("0000-00", the one this
    test submits) carries the actually-LATER date. A gate that sorted by
    period_key string would never see "9999-99" as preceding "0000-00"
    and would let this submit through; the correct date-based gate must
    still catch it."""
    fake = _install(monkeypatch)
    fake.tables["vip_mis_periods"].append({
        "id": "earlier-by-date", "application_id": "sapp1", "kind": "monthly",
        "period_key": "9999-99", "label": "Fake Earlier",
        "period_start": "2026-06-01", "period_end": "2026-06-30",
        "due_date": "2026-07-05", "status": "draft", "narrative": {},
    })
    fake.tables["vip_mis_periods"].append({
        "id": "later-by-date", "application_id": "sapp1", "kind": "monthly",
        "period_key": "0000-00", "label": "Fake Later",
        "period_start": "2026-08-01", "period_end": "2026-08-31",
        "due_date": "2026-09-05", "status": "draft", "narrative": {},
    })
    r = client.post("/founder/mis/monthly/0000-00/submit")
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "mis_earlier_period_open"
    assert r.json()["detail"]["period_key"] == "9999-99"


def test_draft_period_of_the_other_kind_does_not_block_submit(client, monkeypatch, _clear):
    """Monthly and quarterly are independent reporting ladders. FY26-27-Q1
    (Apr-Jun) stays draft throughout and starts BEFORE 2026-07 — if kind
    scoping were broken, its still-draft status would wrongly block the
    monthly submit below."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post("/founder/mis/monthly/2026-06/submit")
    assert r.status_code == 200, r.text
    r = client.post("/founder/mis/monthly/2026-07/submit")
    assert r.status_code == 200, r.text


def test_regression_submitted_periods_vs_last_stays_frozen(client, monkeypatch, _clear):
    """The actual live bug this fix closes (verified live: monthly
    `vs_last` moved 20 -> 40 with the target period still `submitted`).
    With in-order submit enforced, July cannot be submitted while June is
    draft, and a submitted period's writes are already frozen — so there
    is no window left in which editing a predecessor can move a later,
    already-submitted period's derived comparison."""
    _install(monkeypatch)
    client.get("/founder/mis")
    client.put(f"/founder/mis/monthly/2026-06/metrics", json=[
        {"metric_key": "revenue_month", "actual": 20},
    ])
    r = client.post("/founder/mis/monthly/2026-06/submit")
    assert r.status_code == 200, r.text

    client.put(f"/founder/mis/monthly/2026-07/metrics", json=[
        {"metric_key": "revenue_month", "actual": 40},
    ])
    r = client.post("/founder/mis/monthly/2026-07/submit")
    assert r.status_code == 200, r.text
    assert r.json()["derived"]["metrics"]["vs_last"]["revenue_month"] == 20  # 40 - 20

    # The predecessor is submitted (frozen) — a write against it must
    # 409, not silently move July's already-computed vs_last.
    r = client.put(f"/founder/mis/monthly/2026-06/metrics", json=[
        {"metric_key": "revenue_month", "actual": 999},
    ])
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "mis_already_submitted"

    r = client.get("/founder/mis/monthly/2026-07")
    assert r.status_code == 200, r.text
    assert r.json()["derived"]["metrics"]["vs_last"]["revenue_month"] == 20


# ── Fix 2: reconcile at the freeze boundary ───────────────────────────────

def test_submit_reconciles_missing_child_rows_before_freezing(client, monkeypatch, _clear):
    """A draft period missing child rows entirely (e.g. a crashed request
    left it half-built — the same "bare period" shape
    test_metrics_upsert_includes_label_and_group_key uses to exercise the
    equivalent gap on PUT) must be repaired by submit, not stay
    permanently holey once frozen — including the trl_level row, whose
    absence would otherwise make the TRL-snapshot write's
    `.eq("metric_key", "trl_level")` a silent no-op."""
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
    fake.tables["vip_mis_periods"].append({
        "id": "bare-period", "application_id": "sapp1", "kind": "monthly",
        "period_key": CUR_MONTH, "label": "Aug 2026",
        "period_start": "2026-08-01", "period_end": "2026-08-31",
        "due_date": "2026-09-05", "status": "draft", "narrative": {},
    })
    assert fake.tables["vip_mis_metrics"] == []

    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/submit")
    assert r.status_code == 200, r.text
    body = r.json()
    assert {m["metric_key"] for m in body["metrics"]} == {m["key"] for m in cat.METRICS}
    trl = next(m for m in body["metrics"] if m["metric_key"] == "trl_level")
    assert trl["actual"] == 4

    row = next(m for m in fake.tables["vip_mis_metrics"]
               if m["period_id"] == "bare-period" and m["metric_key"] == "trl_level")
    assert row["actual"] == 4


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


# ── Important-3: entry VALUE validation, not just key validation ─────────

def test_milestone_status_value_is_validated(client, monkeypatch, _clear):
    """The exact case the review calls out: `_carry_forward_entries`'s
    "open_only" rule keys off `data["status"] != "Done"` (an EXACT string
    match) — a lowercase "done" used to be accepted silently and would
    have carried forward into every future report forever."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "x", "owner": "y", "status": "done", "notes": ""},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_value"
    assert r.json()["detail"]["field"] == "status"


def test_collaboration_bucket_value_is_validated(client, monkeypatch, _clear):
    """The other case the review calls out: `_carry_forward_entries`'s
    "buckets:active,in_discussion" rule keys off `data["bucket"]` — a
    mistyped bucket used to be accepted silently and would have vanished
    from next quarter's collaborations register with no error."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/entries/collaborations", json=[
        {"bucket": "Active", "collaborator": "x"},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_value"
    assert r.json()["detail"]["field"] == "bucket"


def test_int_field_rejects_a_non_numeric_value(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/asks", json=[
        {"priority": "high", "category": "hiring_referrals", "ask": "help"},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_value"
    assert r.json()["detail"]["field"] == "priority"


def test_int_field_rejects_a_bool_value(client, monkeypatch, _clear):
    """`bool` is an `int` subclass in Python — `isinstance(True, int)` is
    `True` — so a naive `isinstance` check would silently accept it."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/asks", json=[
        {"priority": True, "category": "hiring_referrals", "ask": "help"},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_value"
    assert r.json()["detail"]["field"] == "priority"


def test_numeric_field_accepts_a_number(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/entries/collaborations", json=[
        {"bucket": "active", "collaborator": "x", "funding_lakh": 12.5},
    ])
    assert r.status_code == 200, r.text


def test_date_field_rejects_a_non_iso_value(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/entries/publications", json=[
        {"bucket": "published", "kind": "journal", "date": "31/12/2026"},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_value"
    assert r.json()["detail"]["field"] == "date"


def test_date_field_accepts_an_iso_value(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/entries/publications", json=[
        {"bucket": "published", "kind": "journal", "date": "2026-12-31"},
    ])
    assert r.status_code == 200, r.text


def test_a_null_entry_value_is_always_accepted(client, monkeypatch, _clear):
    """Leaving a field blank (JSON `null`) must not be rejected for any
    field type — value validation only applies to a value actually
    supplied."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "x", "owner": None, "status": None, "notes": None},
    ])
    assert r.status_code == 200, r.text


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

    # _with_trl must build a fresh row rather than mutate the one
    # FakeSupabase's .select() handed back — that select() returns a
    # reference straight into the fake's own stored table, not a copy, so
    # an in-place `m["actual"] = trl` would silently write 4 into
    # `vip_mis_metrics`'s stored row too, which is never a real write this
    # endpoint is supposed to make (trl_level's actual is never persisted).
    # Scoped by period_id, not just metric_key: three monthly periods exist
    # (2026-06/07/08), each with its own trl_level row, and only CUR_MONTH's
    # was ever read — matching on metric_key alone would pick up
    # 2026-06's untouched row and pass regardless of whether the mutation
    # bug is present.
    cur_period = next(p for p in fake.tables["vip_mis_periods"]
                       if p["period_key"] == CUR_MONTH and p["kind"] == "monthly")
    stored = next(m for m in fake.tables["vip_mis_metrics"]
                  if m["metric_key"] == "trl_level" and m["period_id"] == cur_period["id"])
    assert stored.get("actual") is None


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


# ── Ruling, part 1: "submitted means frozen" — TRL snapshot at submit ────

def test_trl_level_is_snapshotted_at_submit_and_frozen_thereafter(client, monkeypatch, _clear):
    """`submit_period` writes the CURRENT verified TRL into
    `vip_mis_metrics.actual` once, at submit time. After that, the AIR
    round is re-verified at a different level (exactly what would also
    happen across a quarter rollover) — the already-submitted report's TRL
    must not move."""
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
    # Fix 1: clear the in-order gate before submitting CUR_MONTH itself.
    client.post("/founder/mis/monthly/2026-06/submit")
    client.post("/founder/mis/monthly/2026-07/submit")
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/submit")
    assert r.status_code == 200, r.text
    trl = next(m for m in r.json()["metrics"] if m["metric_key"] == "trl_level")
    assert trl["actual"] == 4

    # The stored row itself must carry the snapshot, not just this one
    # response — the next plain GET reads it back from storage.
    cur_period = next(p for p in fake.tables["vip_mis_periods"]
                       if p["period_key"] == CUR_MONTH and p["kind"] == "monthly")
    stored = next(m for m in fake.tables["vip_mis_metrics"]
                  if m["metric_key"] == "trl_level" and m["period_id"] == cur_period["id"])
    assert stored.get("actual") == 4

    # The AIR round is re-verified at a different level after submission.
    for row in fake.tables["vip_air_lever_scores"]:
        if row["assessment_id"] == "round1":
            row["verified_level"] = 7

    r = client.get(f"/founder/mis/monthly/{CUR_MONTH}")
    trl = next(m for m in r.json()["metrics"] if m["metric_key"] == "trl_level")
    assert trl["actual"] == 4  # frozen, not the now-live 7


def test_trl_level_snapshot_is_null_when_unverified_at_submit_time(client, monkeypatch, _clear):
    """No AIR round exists at submit time, so the snapshot correctly
    freezes at None rather than 500ing or leaving the row untouched."""
    _install(monkeypatch)
    client.get("/founder/mis")
    # Fix 1: clear the in-order gate before submitting CUR_MONTH itself.
    client.post("/founder/mis/monthly/2026-06/submit")
    client.post("/founder/mis/monthly/2026-07/submit")
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/submit")
    assert r.status_code == 200, r.text
    trl = next(m for m in r.json()["metrics"] if m["metric_key"] == "trl_level")
    assert trl["actual"] is None


def test_quarterly_submit_does_not_touch_trl_level(client, monkeypatch, _clear):
    """Quarterly periods carry no metrics at all — the TRL-snapshot write
    in `submit_period` is gated on `kind == "monthly"` and must not run (or
    error) for a quarterly submit."""
    _install(monkeypatch)
    client.get("/founder/mis")
    # Fix 1: FY26-27-Q1 must be submitted first, or the in-order gate
    # 409s CUR_QUARTER — unrelated to what this test actually checks.
    client.post("/founder/mis/quarterly/FY26-27-Q1/submit")
    r = client.post(f"/founder/mis/quarterly/{CUR_QUARTER}/submit")
    assert r.status_code == 200, r.text
    assert r.json()["metrics"] == []


# ── fix round 1: onboarding-date status gate + fallback logging ──────────

def test_offered_but_not_yet_onboarded_gets_an_empty_calendar(client, monkeypatch, _clear):
    """require_founder_access admits 'offered' as well as 'onboarded', but
    an 'offered' founder owes no MIS reporting yet and has no real
    onboarding date to compute a calendar from. No period rows should be
    created at all — not a calendar seeded from a placeholder date."""
    fake = _install(monkeypatch)
    fake.tables["sip_applications"][0]["status"] = "offered"
    r = client.get("/founder/mis")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["monthly"] == []
    assert body["quarterly"] == []
    assert fake.tables["vip_mis_periods"] == []


def test_missing_status_log_row_falls_back_and_logs_a_warning(client, monkeypatch, _clear, caplog):
    """An onboarded founder with no application_status_log 'onboarded' row
    (state_machine.py's own insert there is best-effort and can be
    swallowed, or the status could have been set by a direct Studio edit)
    must still get a calendar — starting from today, per the fallback —
    AND the gap must be logged, not silent."""
    fake = _install(monkeypatch)
    fake.tables["application_status_log"] = []
    with caplog.at_level("WARNING"):
        r = client.get("/founder/mis")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [p["period_key"] for p in body["monthly"]] == [CUR_MONTH]
    assert [p["period_key"] for p in body["quarterly"]] == [CUR_QUARTER]
    assert any(
        "application_status_log" in rec.message and "sapp1" in str(rec.__dict__)
        for rec in caplog.records
    )


# ── fix round 1: entries race — convergent read-back ──────────────────────

def test_entries_race_converges_instead_of_duplicating(client, monkeypatch, _clear):
    """Simulates the interleaving the entries-replace hazard is about: a
    concurrent writer's own insert landing inside THIS request's
    delete-then-insert window, immediately after this request's own insert
    commits. Proves the convergent read-back in `_replace_entries_section`
    detects the resulting row-count mismatch and cleans it back to exactly
    this writer's own rows — last-writer-wins — rather than leaving the
    union of both writers' rows (a duplicate) behind."""
    from app.routers import founder_mis as mis_router

    fake = _install(monkeypatch)
    client.get("/founder/mis")
    period = next(p for p in fake.tables["vip_mis_periods"]
                  if p["period_key"] == CUR_MONTH and p["kind"] == "monthly")

    class _InjectPhantomOnce:
        """Wraps the fake so the FIRST insert().execute() against
        vip_mis_entries also appends one extra row directly into the
        store, right after the real insert commits — the concurrent
        writer's own row landing in the window. Disarms itself after
        firing once, so the retry `_write()` this triggers behaves like
        the plain fake."""
        def __init__(self, inner):
            self._inner = inner
            self._armed = True

        def table(self, name):
            q = self._inner.table(name)
            if name == "vip_mis_entries" and self._armed:
                real_execute = q.execute

                def execute():
                    result = real_execute()
                    if q._mode == "insert" and self._armed:
                        self._armed = False
                        self._inner.tables["vip_mis_entries"].append({
                            "id": "phantom", "period_id": period["id"],
                            "section": "milestones", "sort_order": 999,
                            "data": {"milestone": "concurrent writer's row"},
                        })
                    return result

                q.execute = execute
            return q

    monkeypatch.setattr(mis_router, "get_admin_client", lambda: _InjectPhantomOnce(fake))

    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "Alpha launch", "owner": "Asha", "status": "On Track", "notes": ""},
    ])
    assert r.status_code == 200, r.text
    rows = r.json()["entries"]["milestones"]
    assert len(rows) == 1
    assert rows[0]["data"]["milestone"] == "Alpha launch"
    stored = [row for row in fake.tables["vip_mis_entries"] if row["section"] == "milestones"]
    assert len(stored) == 1
    assert not any(row.get("id") == "phantom" for row in stored)


def test_entries_delete_is_scoped_to_its_own_section(client, monkeypatch, _clear):
    """Deleting only `.eq("section", section)` must leave every OTHER
    section of the same period untouched. Every existing test before this
    one only ever wrote to a single section per period, so a delete scoped
    to `period_id` alone would have passed them all just as easily."""
    _install(monkeypatch)
    client.get("/founder/mis")
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "Alpha", "owner": "Asha", "status": "On Track", "notes": ""},
    ])
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/risks", json=[
        {"severity": "amber", "what_happened": "vendor delay",
         "impact": "2wk slip", "mitigation": "backup vendor"},
    ])
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "Beta", "owner": "Ravi", "status": "At Risk", "notes": ""},
    ])
    assert r.status_code == 200, r.text
    entries = r.json()["entries"]
    assert len(entries["milestones"]) == 1
    assert entries["milestones"][0]["data"]["milestone"] == "Beta"
    assert len(entries["risks"]) == 1
    assert entries["risks"][0]["data"]["what_happened"] == "vendor delay"


def test_next_milestones_is_reachable_via_section_extra_entries(client, monkeypatch, _clear):
    """next_milestones (quarterly §9.2) hangs off planned_vs_actual via
    mis_catalog.SECTION_EXTRA_ENTRIES rather than owning its own SECTIONS
    row — exactly the section mis_catalog's own module docstring warns is
    silently droppable by a renderer that does not union
    SECTION_EXTRA_ENTRIES into its section-id lookup."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/entries/next_milestones", json=[
        {"milestone": "Ship v2", "target_date": "2026-10-01"},
    ])
    assert r.status_code == 200, r.text
    rows = r.json()["entries"]["next_milestones"]
    assert len(rows) == 1
    assert rows[0]["data"]["milestone"] == "Ship v2"


# ── fix round 1: rag/duplicate-key validation + metrics NOT NULL columns ──

def test_invalid_rag_value_is_422(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "revenue_month", "rag": "purple"},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_value"


def test_duplicate_metric_key_in_payload_is_422(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "revenue_month", "actual": 1},
        {"metric_key": "revenue_month", "actual": 2},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "duplicate_key"


def test_duplicate_financials_key_in_payload_is_422(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/financials", json=[
        {"series": "needs_total", "bucket": "Q1 (Current)", "amount": 1},
        {"series": "needs_total", "bucket": "Q1 (Current)", "amount": 2},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "duplicate_key"


def test_duplicate_headcount_category_in_payload_is_422(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/headcount", json=[
        {"category": "startup", "current_count": 1},
        {"category": "startup", "current_count": 2},
    ])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "duplicate_key"


def test_metrics_upsert_includes_label_and_group_key(client, monkeypatch, _clear):
    """label/group_key are NOT NULL with no default and are not part of
    the unique key (045_vip_mis.sql), so a PUT against a period whose
    child rows were never reconciled would 23502 on a real Postgrest
    without them — reachable because `_own_draft_period` deliberately does
    not reconcile (only `mis_query.ensure_periods`/`period_bundle` do).

    Deliberately does NOT call `GET /founder/mis` first: doing so would
    reconcile a blank `revenue_month` row (with label/group_key already
    correctly seeded by mis_query's own `_insert_metrics`) before the PUT
    ever runs, so the PUT's upsert would just merge into that pre-existing
    row and this test would pass even if the PUT's own payload omitted
    both fields entirely — exactly what an earlier version of this test
    did, vacuously. Seeding the period row directly, with no metrics rows
    of its own, is what actually exercises the PUT's own insert path.
    """
    fake = _install(monkeypatch)
    fake.tables["vip_mis_periods"].append({
        "id": "bare-period", "application_id": "sapp1", "kind": "monthly",
        "period_key": CUR_MONTH, "label": "Aug 2026",
        "period_start": "2026-08-01", "period_end": "2026-08-31",
        "due_date": "2026-09-05", "status": "draft", "narrative": {},
    })
    r = client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "revenue_month", "actual": 5},
    ])
    assert r.status_code == 200, r.text
    row = next(m for m in fake.tables["vip_mis_metrics"] if m["metric_key"] == "revenue_month")
    expected = next(m for m in cat.METRICS if m["key"] == "revenue_month")
    assert row["label"] == expected["label"]
    assert row["group_key"] == expected["group"]


# ── fix round 1: updated_at stamped on every write kind ───────────────────

def test_every_write_kind_stamps_updated_at(client, monkeypatch, _clear):
    """Metrics, entries, financials and headcount edits all land on a
    child table, not vip_mis_periods directly — unlike narrative and
    submit, which happen to touch vip_mis_periods anyway. This proves each
    of the four still stamps the period's own updated_at via
    `_stamp_updated_at`, so a "last edited" signal reading only
    vip_mis_periods does not lie."""
    fake = _install(monkeypatch)
    client.get("/founder/mis")
    monthly = next(p for p in fake.tables["vip_mis_periods"]
                   if p["period_key"] == CUR_MONTH and p["kind"] == "monthly")
    quarterly = next(p for p in fake.tables["vip_mis_periods"]
                      if p["period_key"] == CUR_QUARTER and p["kind"] == "quarterly")
    assert not monthly.get("updated_at")
    assert not quarterly.get("updated_at")

    client.put(f"/founder/mis/monthly/{CUR_MONTH}/metrics", json=[
        {"metric_key": "revenue_month", "actual": 1}])
    assert monthly.get("updated_at")

    monthly["updated_at"] = None  # isolate the next write's own stamp
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/entries/milestones", json=[
        {"milestone": "x", "owner": "y", "status": "On Track", "notes": ""}])
    assert monthly.get("updated_at")

    client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/financials", json=[
        {"series": "needs_total", "bucket": "Q1 (Current)", "amount": 1}])
    assert quarterly.get("updated_at")

    quarterly["updated_at"] = None  # isolate the next write's own stamp
    client.put(f"/founder/mis/quarterly/{CUR_QUARTER}/headcount", json=[
        {"category": "startup", "current_count": 1}])
    assert quarterly.get("updated_at")


# ── fix round 1: index catalog shape ───────────────────────────────────────

def test_index_catalog_financial_buckets_matches_detail_bundle_shape(client, monkeypatch, _clear):
    """Both the index and the detail bundle must expose the needs buckets
    under the same `financial_buckets.needs` path, not two differently
    named keys a frontend would need two readers for."""
    _install(monkeypatch)
    r = client.get("/founder/mis")
    assert r.json()["catalog"]["financial_buckets"] == {"needs": cat.FINANCIAL_BUCKETS["needs"]}
