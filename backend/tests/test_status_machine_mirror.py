"""frontend/src/lib/statusMachine.js must mirror state_machine.LEGAL_TRANSITIONS.

The repo keeps a hand-maintained JS copy of the Python transition graph. It had
already drifted once (missing jury_review and on_hold entirely) before anyone
noticed, so this test parses the JS literal and diffs it against the source of
truth. The backend stays authoritative — if this fails, fix the JS.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.services.state_machine import LEGAL_TRANSITIONS

_JS = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "src" / "lib" / "statusMachine.js"
)


def _parse_js_map() -> dict[str, set[str]]:
    """Pull the LEGAL_TRANSITIONS object literal out of the JS and parse it.

    The literal is plain data (unquoted keys, arrays of quoted strings), so we
    quote the keys and strip trailing commas to make it valid JSON rather than
    pulling in a JS parser.
    """
    src = _JS.read_text(encoding="utf-8")
    m = re.search(r"export const LEGAL_TRANSITIONS = \{(.*?)\n\};", src, re.S)
    assert m, "could not locate the LEGAL_TRANSITIONS literal in statusMachine.js"
    body = m.group(1)
    body = re.sub(r"//[^\n]*", "", body)              # drop comments
    body = re.sub(r"(\w+):", r'"\1":', body)          # quote keys
    raw = "{" + body + "\n}"
    raw = re.sub(r",(\s*[\]\}])", r"\1", raw)         # drop trailing commas
    return {k: set(v) for k, v in json.loads(raw).items()}


def test_js_mirror_has_the_same_states():
    js = _parse_js_map()
    assert set(js) == set(LEGAL_TRANSITIONS), (
        "state set differs — "
        f"only in JS: {sorted(set(js) - set(LEGAL_TRANSITIONS))}, "
        f"only in Python: {sorted(set(LEGAL_TRANSITIONS) - set(js))}"
    )


@pytest.mark.parametrize("state", sorted(LEGAL_TRANSITIONS))
def test_js_mirror_has_the_same_transitions(state):
    js = _parse_js_map()
    assert js.get(state, set()) == set(LEGAL_TRANSITIONS[state]), (
        f"transitions for {state!r} differ — "
        f"JS: {sorted(js.get(state, set()))}, Python: {sorted(LEGAL_TRANSITIONS[state])}"
    )


def test_offered_can_reach_onboarded():
    """The MOU-signing transition the Founder Portal depends on."""
    assert "onboarded" in LEGAL_TRANSITIONS["offered"]
    assert "onboarded" in _parse_js_map()["offered"]
