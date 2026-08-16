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


class _RaceOnce:
    """Wraps a FakeSupabase so the first insert().execute() on `table_name`
    simulates losing a concurrent-insert race: right as it raises, a
    colliding row appears in the table — as if another request's insert on
    the same (application_id, round_label) had just committed — so a
    re-fetch immediately after the exception finds it. Every call after the
    first behaves like the plain fake.
    """

    def __init__(self, inner: FakeSupabase, table_name: str, winner_row: dict):
        self._inner = inner
        self._table_name = table_name
        self._winner_row = winner_row
        self._armed = True

    def table(self, name):
        q = self._inner.table(name)
        if name == self._table_name and self._armed:
            real_execute = q.execute

            def execute():
                if q._mode == "insert" and self._armed:
                    self._armed = False
                    self._inner.tables[self._table_name].append(dict(self._winner_row))
                    raise Exception(
                        'duplicate key value violates unique constraint '
                        '"vip_air_assessments_application_id_round_label_key" (23505)'
                    )
                return real_execute()

            q.execute = execute
        return q


class _LeverRaceOnce:
    """Wraps a FakeSupabase so the first insert().execute() on
    vip_air_lever_scores simulates losing a concurrent-insert race on the
    (assessment_id, lever) constraint: right as it raises, the six rows a
    competing process would already have written appear in the table — as
    if that process's insert had just committed — so the re-read
    immediately after the exception finds all six and nothing is missing.
    Every call after the first behaves like the plain fake.
    """

    def __init__(self, inner: FakeSupabase, winner_rows: list[dict]):
        self._inner = inner
        self._winner_rows = winner_rows
        self._armed = True

    def table(self, name):
        q = self._inner.table(name)
        if name == "vip_air_lever_scores" and self._armed:
            real_execute = q.execute

            def execute():
                if q._mode == "insert" and self._armed:
                    self._armed = False
                    self._inner.tables["vip_air_lever_scores"].extend(
                        dict(r) for r in self._winner_rows
                    )
                    raise Exception(
                        'duplicate key value violates unique constraint '
                        '"vip_air_lever_scores_assessment_id_lever_key" (23505)'
                    )
                return real_execute()

            q.execute = execute
        return q


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


def test_ensure_round_survives_a_concurrent_insert_race(fake, monkeypatch):
    """Two concurrent GET /founder/air calls can both see no round and both
    reach the insert. The loser must hit the (application_id, round_label)
    unique constraint, catch it, and read the winner's row back — not
    propagate a 500."""
    winner = {
        "id": "winner-id",
        "application_id": "app1",
        "round_label": "FY26-27-Q1",
        "status": "draft",
    }
    racy = _RaceOnce(fake, "vip_air_assessments", winner)
    monkeypatch.setattr(aq, "get_admin_client", lambda: racy)

    rnd = aq.ensure_round("app1", "FY26-27-Q1")

    assert rnd["id"] == "winner-id"
    assert len(fake.tables["vip_air_assessments"]) == 1
    # the round found via the race still gets its six levers reconciled
    scores = fake.tables["vip_air_lever_scores"]
    assert len(scores) == 6
    assert {s["assessment_id"] for s in scores} == {"winner-id"}


def test_ensure_round_survives_a_concurrent_lever_insert_race(fake, monkeypatch):
    """After the round-insert race is recovered from, the loser falls into
    the same unconditional lever-reconciliation path the winner is running
    for that same brand-new round: if both reads land before either insert
    commits, both compute the same `missing` set and both attempt the same
    bulk insert against vip_air_lever_scores' (assessment_id, lever) unique
    constraint. The second insert must recover the same way the round
    insert does — return the round normally with exactly six levers — not
    propagate."""
    from app.services import air_catalog as cat

    # The round already exists, so ensure_round goes straight to lever
    # reconciliation without touching the round-insert race path at all.
    fake.tables["vip_air_assessments"].append({
        "id": "rnd-1", "application_id": "app1",
        "round_label": "FY26-27-Q1", "status": "draft",
    })
    winner_levers = [
        {"id": f"s-{lever}", "assessment_id": "rnd-1", "lever": lever, "criteria_checked": []}
        for lever in cat.LEVER_KEYS
    ]
    racy = _LeverRaceOnce(fake, winner_levers)
    monkeypatch.setattr(aq, "get_admin_client", lambda: racy)

    rnd = aq.ensure_round("app1", "FY26-27-Q1")

    assert rnd["id"] == "rnd-1"
    scores = fake.tables["vip_air_lever_scores"]
    assert len(scores) == 6
    assert {s["lever"] for s in scores} == set(cat.LEVER_KEYS)


def test_ensure_round_repairs_missing_lever_rows_without_touching_existing_ones(fake):
    """Simulates a process that died mid-way through a previous ensure_round
    call, leaving only three of six lever rows. The repair must add exactly
    the missing three and must not touch the three that already carry real
    answers."""
    from app.services import air_catalog as cat

    fake.tables["vip_air_assessments"].append({
        "id": "existing-id",
        "application_id": "app1",
        "round_label": "FY26-27-Q1",
        "status": "draft",
    })
    fake.tables["vip_air_lever_scores"].extend([
        {"id": "s1", "assessment_id": "existing-id", "lever": "scientific_principles",
         "criteria_checked": [], "q1_option": "B"},
        {"id": "s2", "assessment_id": "existing-id", "lever": "architecture",
         "criteria_checked": [], "q1_option": "C"},
        {"id": "s3", "assessment_id": "existing-id", "lever": "qualification",
         "criteria_checked": []},
    ])

    rnd = aq.ensure_round("app1", "FY26-27-Q1")

    assert rnd["id"] == "existing-id"
    scores = fake.tables["vip_air_lever_scores"]
    assert len(scores) == 6
    assert {s["lever"] for s in scores} == set(cat.LEVER_KEYS)
    by_id = {s["id"]: s for s in scores}
    assert by_id["s1"]["q1_option"] == "B"
    assert by_id["s2"]["q1_option"] == "C"
    assert by_id["s3"]["lever"] == "qualification"


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
