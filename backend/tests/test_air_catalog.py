"""The AIR framework as data. Structural guards — a transcription slip in a
59-option catalog is invisible by eye, so assert the shape hard.

Content authority: docs/reference/air-framework.md
"""
from app.services import air_catalog as cat

EXPECTED_LEVERS = [
    ("scientific_principles", "technology"),
    ("architecture", "technology"),
    ("qualification", "technology"),
    ("user_needs", "commercial"),
    ("supply_chain", "commercial"),
    ("reliability", "commercial"),
]

# From docs/reference/air-framework.md §2 — derived from the options, and the
# thing the ladder rule depends on. If a transcription slip changes an option's
# level, this table stops matching.
EXPECTED_MAXIMA = {
    "scientific_principles": (3, 5, 9),
    "architecture": (3, 5, 9),
    "qualification": (3, 5, 9),
    "user_needs": (3, 6, 9),
    "supply_chain": (4, 7, 9),
    "reliability": (5, 7, 9),
}

EXPECTED_OPTION_COUNTS = {
    "scientific_principles": (3, 4, 5),
    "architecture": (3, 3, 4),
    "qualification": (3, 3, 4),
    "user_needs": (3, 3, 3),
    "supply_chain": (3, 3, 3),
    "reliability": (3, 3, 3),
}


def test_six_levers_in_two_families():
    assert [(l["key"], l["family"]) for l in cat.LEVERS] == EXPECTED_LEVERS
    assert cat.TECHNOLOGY_LEVERS == ("scientific_principles", "architecture", "qualification")
    assert cat.COMMERCIAL_LEVERS == ("user_needs", "supply_chain", "reliability")
    assert cat.LEVER_KEYS == tuple(k for k, _ in EXPECTED_LEVERS)


def test_every_lever_has_exactly_three_questions():
    for lever in cat.LEVER_KEYS:
        qs = cat.QUESTIONS[lever]
        assert [q["id"] for q in qs] == ["q1", "q2", "q3"], lever


def test_option_counts_match_the_source():
    for lever, counts in EXPECTED_OPTION_COUNTS.items():
        got = tuple(len(q["options"]) for q in cat.QUESTIONS[lever])
        assert got == counts, lever
    total = sum(len(q["options"]) for lever in cat.LEVER_KEYS for q in cat.QUESTIONS[lever])
    assert total == 59


def test_option_ids_are_sequential_letters():
    for lever in cat.LEVER_KEYS:
        for q in cat.QUESTIONS[lever]:
            ids = [o["id"] for o in q["options"]]
            assert ids == ["A", "B", "C", "D", "E"][: len(ids)], (lever, q["id"])


def test_every_option_level_is_a_valid_air_level():
    for lever in cat.LEVER_KEYS:
        for q in cat.QUESTIONS[lever]:
            for o in q["options"]:
                assert 1 <= o["level"] <= 9, (lever, q["id"], o["id"])


def test_option_levels_are_non_decreasing_within_a_question():
    """Later letters describe more mature states, so levels never go backwards.
    The source's duplicate mappings (supply_chain q3 A/B, reliability q2 A/B and
    q3 A/B) are equal, not decreasing, so they pass."""
    for lever in cat.LEVER_KEYS:
        for q in cat.QUESTIONS[lever]:
            levels = [o["level"] for o in q["options"]]
            assert levels == sorted(levels), (lever, q["id"], levels)


def test_question_maxima_match_the_source_table():
    for lever, maxima in EXPECTED_MAXIMA.items():
        got = (cat.question_max(lever, "q1"),
               cat.question_max(lever, "q2"),
               cat.question_max(lever, "q3"))
        assert got == maxima, lever


def test_the_sources_duplicate_mappings_are_preserved():
    """Deliberately asserted so nobody 'tidies' them away without a decision."""
    sc_q3 = {o["id"]: o["level"] for o in cat.QUESTIONS["supply_chain"][2]["options"]}
    assert sc_q3["A"] == sc_q3["B"] == 8
    rel_q2 = {o["id"]: o["level"] for o in cat.QUESTIONS["reliability"][1]["options"]}
    assert rel_q2["A"] == rel_q2["B"] == 6
    rel_q3 = {o["id"]: o["level"] for o in cat.QUESTIONS["reliability"][2]["options"]}
    assert rel_q3["A"] == rel_q3["B"] == 8


def test_level_for_option_resolves_and_rejects():
    assert cat.level_for_option("scientific_principles", "q3", "E") == 9
    assert cat.level_for_option("user_needs", "q2", "A") == 4
    assert cat.level_for_option("scientific_principles", "q1", "Z") is None
    assert cat.level_for_option("nonsense", "q1", "A") is None


def test_documents_cover_every_defined_level():
    """The source leaves gaps; they must be gaps, not silently filled."""
    assert cat.DOCUMENTS["scientific_principles"][1] == "Research & Feasibility Report"
    assert cat.DOCUMENTS["user_needs"][5] == "Signed MoU / PoC Agreement"
    assert set(cat.DOCUMENTS["supply_chain"]) == {2, 4, 6, 8, 9}
    assert set(cat.DOCUMENTS["reliability"]) == {1, 3, 5, 6, 7, 8, 9}
    for lever in ("scientific_principles", "architecture", "qualification", "user_needs"):
        assert set(cat.DOCUMENTS[lever]) == set(range(1, 10)), lever


def test_required_document_falls_back_to_the_highest_defined_level_below():
    # supply_chain defines 2,4,6,8,9 — a claim of 3 falls back to 2's document
    assert cat.required_document("supply_chain", 3) == "Draft BOM"
    assert cat.required_document("supply_chain", 5) == "DFMA Report"
    assert cat.required_document("supply_chain", 7) == "Sourcing Plan & TCO Model"
    # reliability defines 1,3,5,6,7,8,9 — a claim of 4 falls back to 3's
    assert cat.required_document("reliability", 4) == "Org Chart & RACI"
    assert cat.required_document("reliability", 2) == "Team Roster"
    # exact hits are returned unchanged
    assert cat.required_document("architecture", 8) == "Design Freeze Package"


def test_required_document_is_none_only_where_nothing_is_defined_below():
    assert cat.required_document("supply_chain", 1) is None


def test_criteria_exist_for_every_level_a_document_exists_for():
    for lever in cat.LEVER_KEYS:
        for level in cat.DOCUMENTS[lever]:
            assert cat.criteria_for(lever, level), (lever, level)


def test_criteria_for_is_empty_not_raising_for_an_undefined_level():
    assert cat.criteria_for("supply_chain", 3) == []
