"""Round lifecycle: FY-quarter labelling, lazy creation, and the read bundle."""
from datetime import date

import pytest

from app.services import air_query as aq
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def fake(monkeypatch):
    f = FakeSupabase({
        "vip_air_assessments": [],
        "vip_air_lever_scores": [],
        "vip_air_evidence": [],
    })
    monkeypatch.setattr(aq, "get_admin_client", lambda: f)
    return f


# ── Indian FY quarters ────────────────────────────────────────────────

@pytest.mark.parametrize("day,label", [
    (date(2026, 4, 1), "FY26-27-Q1"),
    (date(2026, 6, 30), "FY26-27-Q1"),
    (date(2026, 7, 1), "FY26-27-Q2"),
    (date(2026, 9, 30), "FY26-27-Q2"),
    (date(2026, 10, 1), "FY26-27-Q3"),
    (date(2026, 12, 31), "FY26-27-Q3"),
    (date(2027, 1, 1), "FY26-27-Q4"),
    (date(2027, 3, 31), "FY26-27-Q4"),
    (date(2027, 4, 1), "FY27-28-Q1"),
])
def test_fy_quarter_labels(day, label):
    assert aq.current_round_label(day) == label


def test_january_belongs_to_the_previous_fiscal_year():
    """The Indian FY starts in April, so Jan-Mar is Q4 of the year that began
    the previous April — the boundary most likely to be got wrong."""
    assert aq.current_round_label(date(2026, 1, 15)) == "FY25-26-Q4"


# ── lazy round creation ───────────────────────────────────────────────

def test_ensure_round_creates_a_draft_with_six_lever_rows(fake):
    from app.services import air_catalog as cat
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    assert rnd["status"] == "draft"
    assert rnd["application_id"] == "app1"
    scores = fake.tables["vip_air_lever_scores"]
    assert len(scores) == 6
    assert {s["lever"] for s in scores} == set(cat.LEVER_KEYS)


def test_ensure_round_is_idempotent(fake):
    a = aq.ensure_round("app1", "FY26-27-Q1")
    b = aq.ensure_round("app1", "FY26-27-Q1")
    assert a["id"] == b["id"]
    assert len(fake.tables["vip_air_assessments"]) == 1
    assert len(fake.tables["vip_air_lever_scores"]) == 6


def test_ensure_round_separates_applications(fake):
    aq.ensure_round("app1", "FY26-27-Q1")
    aq.ensure_round("app2", "FY26-27-Q1")
    assert len(fake.tables["vip_air_assessments"]) == 2
    assert len(fake.tables["vip_air_lever_scores"]) == 12


def test_ensure_round_separates_quarters(fake):
    aq.ensure_round("app1", "FY26-27-Q1")
    aq.ensure_round("app1", "FY26-27-Q2")
    assert len(fake.tables["vip_air_assessments"]) == 2


def test_fetch_lever_scores_returns_six_in_catalog_order(fake):
    from app.services import air_catalog as cat
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    got = aq.fetch_lever_scores(rnd["id"])
    assert [s["lever"] for s in got] == list(cat.LEVER_KEYS)


# ── the read bundle ───────────────────────────────────────────────────

def test_bundle_carries_the_catalog_and_six_levers(fake):
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    assert len(b["catalog"]["levers"]) == 6
    assert len(b["levers"]) == 6
    assert b["round"]["status"] == "draft"


def test_bundle_rollups_are_none_before_any_answers(fake):
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    assert b["rollups"]["claimed"] == {"technology": None, "commercial": None, "overall": None}
    assert b["rollups"]["verified"] == {"technology": None, "commercial": None, "overall": None}


def test_bundle_computes_claimed_rollups_from_stored_answers(fake):
    from app.services import air_catalog as cat
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    # top out every lever
    for row in fake.tables["vip_air_lever_scores"]:
        lever = row["lever"]
        for q in cat.QUESTIONS[lever]:
            row[f"{q['id']}_option"] = max(q["options"], key=lambda o: o["level"])["id"]
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    assert b["rollups"]["claimed"]["overall"] == 9
    assert all(l["claimed_level"] == 9 for l in b["levers"])


def test_bundle_exposes_the_required_document_per_lever(fake):
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    for row in fake.tables["vip_air_lever_scores"]:
        if row["lever"] == "user_needs":
            row["q1_option"] = "C"   # AIR 3
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    un = next(l for l in b["levers"] if l["lever"] == "user_needs")
    assert un["claimed_level"] == 3
    assert un["required_document"] == "Customer Discovery Log"
    assert un["criteria"]


def test_bundle_attaches_evidence_to_its_lever(fake):
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    fake.tables["vip_air_evidence"].append({
        "id": "e1", "assessment_id": rnd["id"], "lever": "architecture",
        "air_level": 2, "doc_label": "System Architecture Document",
        "storage_path": "p", "filename": "arch.pdf",
    })
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    arch = next(l for l in b["levers"] if l["lever"] == "architecture")
    assert [e["filename"] for e in arch["evidence"]] == ["arch.pdf"]
    others = [l for l in b["levers"] if l["lever"] != "architecture"]
    assert all(l["evidence"] == [] for l in others)
