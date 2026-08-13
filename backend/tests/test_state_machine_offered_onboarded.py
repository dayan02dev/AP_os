"""offered → onboarded must be a legal transition (founder MOU sign)."""
from app.services.state_machine import LEGAL_TRANSITIONS, legal_next_states


def test_offered_can_advance_to_onboarded():
    assert "onboarded" in LEGAL_TRANSITIONS["offered"]
    assert "onboarded" in legal_next_states("offered")


def test_offered_still_allows_reject_and_withdraw():
    assert {"rejected", "withdrawn"}.issubset(LEGAL_TRANSITIONS["offered"])


def test_onboarded_remains_terminal_except_withdraw():
    assert LEGAL_TRANSITIONS["onboarded"] == frozenset({"withdrawn"})
