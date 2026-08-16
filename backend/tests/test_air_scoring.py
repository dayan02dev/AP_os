"""AIR scoring rules R2 (ladder) and R3 (rollups).

Pure functions over the catalog — these are the rules the whole assessment
rests on, so they get exhaustive treatment.
"""
import pytest

from app.services import air_catalog as cat
from app.services import air_scoring as sc


def _answers(q1=None, q2=None, q3=None):
    return {"q1": q1, "q2": q2, "q3": q3}


# ── R2: the ladder ────────────────────────────────────────────────────

def test_unanswered_lever_has_no_level():
    assert sc.lever_level("scientific_principles", _answers()) is None


def test_q1_alone_sets_the_level():
    # scientific_principles q1: A=1, B=2, C=3
    assert sc.lever_level("scientific_principles", _answers(q1="A")) == 1
    assert sc.lever_level("scientific_principles", _answers(q1="B")) == 2


def test_q2_cannot_lift_the_level_until_q1_is_maxed():
    """The gate-skip rejection — the whole point of a ladder over max()."""
    # q1=B is 2, not q1's max (3). q2=D would be 5 but must not count.
    assert sc.lever_level("scientific_principles", _answers(q1="B", q2="D")) == 2


def test_q2_lifts_the_level_once_q1_is_maxed():
    # q1=C is 3 = max. q2=C is 4.
    assert sc.lever_level("scientific_principles", _answers(q1="C", q2="C")) == 4


def test_q3_cannot_lift_the_level_until_q2_is_maxed():
    # q1=C (3, maxed) → q2=C is 4, not q2's max (5). q3=E would be 9.
    assert sc.lever_level("scientific_principles", _answers(q1="C", q2="C", q3="E")) == 4


def test_the_full_ladder_reaches_nine():
    assert sc.lever_level("scientific_principles", _answers(q1="C", q2="D", q3="E")) == 9


def test_a_high_q3_alone_claims_nothing():
    """A venture cannot claim AIR 9 on q3 while leaving q1 unanswered."""
    assert sc.lever_level("scientific_principles", _answers(q3="E")) is None


def test_a_high_q3_with_a_weak_q1_is_held_at_q1():
    assert sc.lever_level("scientific_principles", _answers(q1="A", q3="E")) == 1


def test_the_level_never_goes_down_when_a_later_answer_is_lower():
    """q2 maxed at 5, then q3=A is also 5 — level stays 5, not reduced."""
    assert sc.lever_level("scientific_principles", _answers(q1="C", q2="D", q3="A")) == 5


def test_an_unknown_option_id_contributes_nothing():
    assert sc.lever_level("scientific_principles", _answers(q1="Z")) is None


def test_a_gap_in_the_middle_stops_the_ladder():
    """q1 maxed but q2 unanswered — q3 must not count."""
    assert sc.lever_level("scientific_principles", _answers(q1="C", q3="E")) == 3


@pytest.mark.parametrize("lever", cat.LEVER_KEYS)
def test_every_lever_reaches_nine_on_its_top_answers(lever):
    top = {}
    for q in cat.QUESTIONS[lever]:
        top[q["id"]] = max(q["options"], key=lambda o: o["level"])["id"]
    assert sc.lever_level(lever, top) == 9


@pytest.mark.parametrize("lever", cat.LEVER_KEYS)
def test_every_lever_bottoms_out_at_its_lowest_q1(lever):
    first = cat.QUESTIONS[lever][0]["options"][0]
    assert sc.lever_level(lever, _answers(q1=first["id"])) == first["level"]


def test_supply_chain_duplicate_q3_options_both_yield_eight():
    """The source's duplicate mapping must not change the ladder's behaviour."""
    a = sc.lever_level("supply_chain", _answers(q1="C", q2="C", q3="A"))
    b = sc.lever_level("supply_chain", _answers(q1="C", q2="C", q3="B"))
    assert a == b == 8


def test_reliability_duplicate_q2_options_both_yield_six():
    a = sc.lever_level("reliability", _answers(q1="C", q2="A"))
    b = sc.lever_level("reliability", _answers(q1="C", q2="B"))
    assert a == b == 6


# ── R3: the rollups ───────────────────────────────────────────────────

FULL = {
    "scientific_principles": 5, "architecture": 4, "qualification": 6,
    "user_needs": 7, "supply_chain": 3, "reliability": 8,
}


def test_rollups_take_the_minimum_of_each_family():
    r = sc.rollups(FULL)
    assert r["technology"] == 4      # min(5, 4, 6)
    assert r["commercial"] == 3      # min(7, 3, 8)
    assert r["overall"] == 3         # min of all six


def test_overall_is_the_minimum_across_both_families():
    r = sc.rollups({**FULL, "architecture": 9, "qualification": 9,
                    "scientific_principles": 9})
    assert r["technology"] == 9
    assert r["commercial"] == 3
    assert r["overall"] == 3


def test_a_family_with_any_unscored_lever_rolls_up_to_none():
    """Not a partial minimum — an incomplete family has no defensible score."""
    r = sc.rollups({**FULL, "architecture": None})
    assert r["technology"] is None
    assert r["commercial"] == 3
    assert r["overall"] is None


def test_all_unscored_rolls_up_to_none():
    r = sc.rollups({k: None for k in cat.LEVER_KEYS})
    assert r == {"technology": None, "commercial": None, "overall": None}


def test_a_missing_lever_key_is_treated_as_unscored():
    r = sc.rollups({"scientific_principles": 5})
    assert r["overall"] is None


def test_score_levers_maps_answers_to_levels():
    got = sc.score_levers({
        "scientific_principles": _answers(q1="C", q2="D", q3="E"),
        "user_needs": _answers(q1="A"),
    })
    assert got["scientific_principles"] == 9
    assert got["user_needs"] == 1
    assert got["architecture"] is None
