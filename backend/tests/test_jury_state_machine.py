import pytest
from fastapi import HTTPException
from app.services.state_machine import LEGAL_TRANSITIONS, assert_legal_transition


def test_jury_review_exits():
    assert LEGAL_TRANSITIONS["jury_review"] == frozenset(
        {"offered", "waitlisted", "on_hold", "rejected", "withdrawn"})

@pytest.mark.parametrize("to", ["offered", "waitlisted", "on_hold", "rejected"])
def test_gate2_transitions_legal(to):
    assert_legal_transition("jury_review", to)

def test_jury_review_cannot_rewind():
    with pytest.raises(HTTPException) as ei:
        assert_legal_transition("jury_review", "under_review")
    assert ei.value.detail["code"] == "illegal_transition"
