"""/founder/mis/{kind}/{period_key}/import (+ /import/commit): upload the
real ARTPARK .docx, get a preview back, and only ever write what the
founder explicitly confirms in a second call.

Time is frozen the same way test_mis_endpoints.py freezes it, and the fixed
calendar (onboarded 2026-06-10, "today" 2026-08-16 IST) gives the same
monthly/quarterly periods that file documents.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from app.deps import get_current_user
from app.main import app

from tests.fixtures.fake_supabase import FakeSupabase

CUR_MONTH = "2026-08"
CUR_QUARTER = "FY26-27-Q2"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FIXTURES = Path(__file__).parent / "fixtures"
MONTHLY_DOCX = FIXTURES / "mis_monthly_template.docx"
QUARTERLY_DOCX = FIXTURES / "mis_quarterly_template.docx"


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _frozen_today(freezer):
    freezer.move_to("2026-08-16T06:00:00Z")


def _user(track: str = "sip"):
    return lambda: {"user_id": "u1", "email": "u1@x.com", "track": track, "roles": ["applicant"]}


class _Bucket:
    def __init__(self):
        self.uploaded: list[tuple[str, bytes, str]] = []

    def upload(self, path, data, opts=None):
        self.uploaded.append((path, data, (opts or {}).get("content-type")))
        return {"path": path}


class _Storage:
    def __init__(self):
        self.bucket = _Bucket()

    def from_(self, name):
        return self.bucket


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
    fake.storage = _Storage()
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(mis_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(mis_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_query, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _user(track)
    return fake


def _upload_monthly(client, path=MONTHLY_DOCX, filename="filled.docx", mime=DOCX_MIME):
    return client.post(
        f"/founder/mis/monthly/{CUR_MONTH}/import",
        files={"file": (filename, io.BytesIO(path.read_bytes()), mime)},
    )


def _upload_quarterly(client, path=QUARTERLY_DOCX, filename="filled.docx", mime=DOCX_MIME):
    return client.post(
        f"/founder/mis/quarterly/{CUR_QUARTER}/import",
        files={"file": (filename, io.BytesIO(path.read_bytes()), mime)},
    )


# ── gate: only a draft period can be imported into ───────────────────────

FIRST_MONTH = "2026-06"  # no earlier period to block its submit


def test_import_requires_draft_period(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post(f"/founder/mis/monthly/{FIRST_MONTH}/submit")
    assert r.status_code == 200, r.text
    r = client.post(
        f"/founder/mis/monthly/{FIRST_MONTH}/import",
        files={"file": ("filled.docx", io.BytesIO(MONTHLY_DOCX.read_bytes()), DOCX_MIME)},
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "mis_already_submitted"


def test_commit_requires_draft_period(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    client.post(f"/founder/mis/monthly/{FIRST_MONTH}/submit")
    r = client.post(f"/founder/mis/monthly/{FIRST_MONTH}/import/commit", json={
        "narrative": {"exec.headline_win": "should not land"},
    })
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "mis_already_submitted"


def test_commit_with_empty_body_still_409s_on_submitted_period(client, monkeypatch, _clear):
    """No sub-writer (put_narrative/put_metrics/...) is even called when the
    confirmed body is entirely empty, so THIS assertion only holds if the
    endpoint's own top-level freeze gate actually runs before returning."""
    _install(monkeypatch)
    client.get("/founder/mis")
    client.post(f"/founder/mis/monthly/{FIRST_MONTH}/submit")
    r = client.post(f"/founder/mis/monthly/{FIRST_MONTH}/import/commit", json={})
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "mis_already_submitted"


def test_tir_founder_gets_409_on_import(client, monkeypatch, _clear):
    _install(monkeypatch, track="tir")
    r = _upload_monthly(client)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "not_available_for_track"


# ── upload validation: MIME + size, before anything is read or stored ────

def test_import_rejects_unsupported_mime(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post(
        f"/founder/mis/monthly/{CUR_MONTH}/import",
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert r.status_code == 415, r.text
    assert r.json()["detail"]["code"] == "unsupported_media"


def test_import_rejects_oversized_file(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    big = b"0" * (26_214_400 + 1)
    r = client.post(
        f"/founder/mis/monthly/{CUR_MONTH}/import",
        files={"file": ("big.docx", io.BytesIO(big), DOCX_MIME)},
    )
    assert r.status_code == 413, r.text
    assert r.json()["detail"]["code"] == "too_large"


def test_import_rejects_wrong_template_kind(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = _upload_quarterly(client, path=MONTHLY_DOCX)  # monthly doc into a quarterly period
    # (target kind is quarterly, uploaded doc parses as monthly)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "template_kind_mismatch"


# ── preview: parses, never writes, stores the source doc for audit ───────

def test_import_preview_never_writes_mis_data(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/mis")
    r = _upload_monthly(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["detected_kind"] == "monthly"
    assert len(body["parsed"]["metrics"]) == 13
    assert all(m["actual"] is None for m in body["parsed"]["metrics"])  # blank template
    # Nothing was persisted to the real MIS tables.
    assert fake.tables["vip_mis_metrics"] == [] or all(
        m.get("actual") is None for m in fake.tables["vip_mis_metrics"]
    )
    period = next(p for p in fake.tables["vip_mis_periods"] if p["period_key"] == CUR_MONTH)
    assert period.get("source_doc_path")  # stored for audit even though nothing was imported


def test_import_preview_surfaces_current_values_for_side_by_side(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/narrative", json={
        "exec.headline_win": "Already typed by the founder",
    })
    r = _upload_monthly(client)
    assert r.status_code == 200, r.text
    assert r.json()["current"]["narrative"]["exec.headline_win"] == "Already typed by the founder"


# ── commit: only what is confirmed lands, via the existing PUT paths ─────

def test_commit_writes_only_the_confirmed_narrative_field(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    client.put(f"/founder/mis/monthly/{CUR_MONTH}/narrative", json={
        "exec.biggest_concern": "Runway is tight",
    })
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/import/commit", json={
        "narrative": {"exec.headline_win": "Shipped v2 to three hospitals"},
    })
    assert r.status_code == 200, r.text
    narrative = r.json()["narrative"]
    assert narrative["exec.headline_win"] == "Shipped v2 to three hospitals"
    assert narrative["exec.biggest_concern"] == "Runway is tight"  # untouched, merge semantics


def test_commit_writes_confirmed_metrics_through_the_real_validation(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/import/commit", json={
        "metrics": [{"metric_key": "revenue_month", "target": 10, "actual": 12.5}],
    })
    assert r.status_code == 200, r.text
    m = next(x for x in r.json()["metrics"] if x["metric_key"] == "revenue_month")
    assert m["actual"] == 12.5


def test_commit_rejects_founder_supplied_trl_actual_same_as_direct_put(client, monkeypatch, _clear):
    """The commit endpoint reuses put_metrics wholesale -- it must reject a
    confirmed trl_level.actual exactly like a direct PUT would, proving no
    second, looser write path was built."""
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/import/commit", json={
        "metrics": [{"metric_key": "trl_level", "actual": 7}],
    })
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "computed_metric"


def test_commit_writes_confirmed_entries_section(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/import/commit", json={
        "entries": {"milestones": [
            {"milestone": "Tape out v0.3", "owner": "Priya", "status": "On Track", "notes": ""},
        ]},
    })
    assert r.status_code == 200, r.text
    rows = r.json()["entries"]["milestones"]
    assert len(rows) == 1
    assert rows[0]["data"]["milestone"] == "Tape out v0.3"


def test_commit_with_nothing_confirmed_changes_nothing(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post(f"/founder/mis/monthly/{CUR_MONTH}/import/commit", json={})
    assert r.status_code == 200, r.text
    assert r.json()["narrative"] == {}
    assert all(m.get("actual") is None for m in r.json()["metrics"])


def test_quarterly_commit_writes_financials_and_headcount(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/mis")
    r = client.post(f"/founder/mis/quarterly/{CUR_QUARTER}/import/commit", json={
        "financials": [{"series": "needs_total", "bucket": "Q1 (Current)", "amount": 100}],
        "headcount": [{"category": "artpark_associated", "current_count": 12, "exited": 1}],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    fin = next(f for f in body["financials"] if f["series"] == "needs_total" and f["bucket"] == "Q1 (Current)")
    assert fin["amount"] == 100
    hc = next(h for h in body["headcount"] if h["category"] == "artpark_associated")
    assert hc["current_count"] == 12
