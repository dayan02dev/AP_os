"""Substitution engine tests for app/services/agreements.py.

IMPORTANT CONTEXT: as of this commit, ARTPARK has not supplied the real
values for its Facility Agreement constants (term length, insurance limit,
collaboration-agreement date, the six facilities Availability Windows).
agreements.TEMPLATE_CONSTANTS["facility-v1"] therefore ships with every one
of those values set to the UNSET sentinel (None) — see the fail-closed tests
at the bottom of this file, which run against the REAL shipped (unset)
config and prove rendering refuses to run.

Every other test in this file exercises the substitution logic end-to-end,
which requires *some* constants to render against. Those tests use the
`_configured` fixture below, which monkeypatches TEMPLATE_CONSTANTS with
obviously-fake TEST-* values for the duration of the test — never the real
config, and never committed as real data.
"""
import pytest

from app.services import agreements

ONE = [
    {"name": "Aditi Rao", "pan": "ABCDE1234F", "parent_name": "Suresh Rao", "address": "12 MG Road, Bengaluru"}
]
TWO = ONE + [
    {"name": "Kiran Shah", "pan": "PQRSX5678L", "parent_name": "Manoj Shah", "address": "4 Church St, Bengaluru"}
]
THREE = TWO + [
    {"name": "Divya Nair", "pan": "LMNOQ9012Z", "parent_name": "Ravi Nair", "address": "9 Brigade Rd, Bengaluru"}
]

_TEST_CONSTANTS = {
    "term_months": 6,
    "insurance_limit": "TEST-INSURANCE-LIMIT-VALUE",
    "collaboration_agreement_date": "TEST-COLLAB-AGREEMENT-DATE",
    "availability_windows": {
        "dedicated_seating": "TEST-WINDOW-DEDICATED-SEATING",
        "lab_space": "TEST-WINDOW-LAB-SPACE",
        "computing": "TEST-WINDOW-COMPUTING",
        "wifi": "TEST-WINDOW-WIFI",
        "conference_rooms": "TEST-WINDOW-CONFERENCE-ROOMS",
        "access_badge": "TEST-WINDOW-ACCESS-BADGE",
    },
}


@pytest.fixture
def _configured(monkeypatch):
    """Fill in TEMPLATE_CONSTANTS with fake-but-complete TEST-* values so the
    substitution engine can be exercised end to end. Deep-copies so mutation
    inside a test can never leak into another test or into the real module
    state used by the fail-closed tests below."""
    import copy

    fake = copy.deepcopy(_TEST_CONSTANTS)
    monkeypatch.setitem(agreements.TEMPLATE_CONSTANTS, "facility-v1", fake)
    return fake


# ── Collaborator block arity ────────────────────────────────────────────────

def test_one_collaborator_does_not_emit_second_or_third_block(_configured):
    text = agreements.render_preview_text(ONE)
    assert "Collaborator 2" not in text
    assert "Collaborator 3" not in text
    assert "Aditi Rao" in text


def test_two_collaborators_drops_only_the_third_block(_configured):
    text = agreements.render_preview_text(TWO)
    assert "Collaborator 1" in text and "Collaborator 2" in text
    assert "Collaborator 3" not in text
    assert "Kiran Shah" in text


def test_three_collaborators_renders_all_three(_configured):
    text = agreements.render_preview_text(THREE)
    assert all(f"Collaborator {n}" in text for n in (1, 2, 3))
    assert "Divya Nair" in text


def test_collaborator_fields_substitute_in_the_documented_order(_configured):
    """name, PAN, parent_name (s/o/d/o), address — the field-map order."""
    text = agreements.render_preview_text(ONE)
    assert (
        "Aditi Rao, having PAN ABCDE1234F, s/o/d/o Suresh Rao, resident of 12 MG Road, Bengaluru"
        in text
    )


def test_list_sentence_regenerates_for_one_collaborator(_configured):
    text = agreements.render_preview_text(ONE)
    assert 'Collaborator 1 shall be referred to as "Collaborator".' in text
    assert "individually referred to" not in text  # the 2/3-collaborator phrasing must not leak


def test_list_sentence_regenerates_for_three_collaborators(_configured):
    text = agreements.render_preview_text(THREE)
    assert (
        'Collaborator 1, Collaborator 2 and Collaborator 3 shall be individually referred to as '
        '"Collaborator" and collectively referred to as "Collaborators".' in text
    )


def test_invalid_collaborator_count_rejected(_configured):
    with pytest.raises(ValueError, match="1 to 3"):
        agreements.render_preview_text([])
    with pytest.raises(ValueError, match="1 to 3"):
        agreements.render_preview_text(THREE + [{"name": "x", "pan": "y", "parent_name": "z", "address": "w"}])


# ── ARTPARK constants ────────────────────────────────────────────────────

def test_artpark_constants_appear(_configured):
    text = agreements.render_preview_text(ONE)
    c = agreements.TEMPLATE_CONSTANTS["facility-v1"]
    assert c["insurance_limit"] in text
    assert str(c["term_months"]) in text
    assert agreements._MONTH_WORDS[c["term_months"]] in text
    assert c["collaboration_agreement_date"] in text


def test_facilities_schedule_constants_appear_in_order(_configured):
    text = agreements.render_preview_text(ONE)
    c = agreements.TEMPLATE_CONSTANTS["facility-v1"]["availability_windows"]
    assert c["dedicated_seating"] in text
    assert c["access_badge"] in text
    # order in the rendered table matches Schedule II's real row order
    assert text.index(c["dedicated_seating"]) < text.index(c["access_badge"])


def test_unresolved_placeholder_raises_instead_of_shipping_broken_text(_configured, monkeypatch):
    """Defensive check inside the renderer itself, not only in tests: if a
    future template edit adds a [•] this code doesn't know how to fill,
    fail loudly rather than emit a document with a visible blank."""
    bad_blocks = agreements._load_template("facility-v1")["blocks"] + [
        {"type": "paragraph", "index": 999, "text": "Unhandled [•] field.", "placeholder_count": 1}
    ]
    monkeypatch.setattr(agreements, "_load_template", lambda slug: {"blocks": bad_blocks})
    with pytest.raises(ValueError, match="placeholder"):
        agreements.render_preview_text(ONE)


def test_agreements_for_track_lists_facility_only():
    for track in ("tir", "sip"):
        ids = [a["slug"] for a in agreements.agreements_for_track(track)]
        assert ids == ["facility-v1"]


# ── No literal placeholder token survives, for any collaborator count ──────

def test_no_placeholder_token_survives_any_collaborator_count(_configured):
    """The failure a reader notices first — checked for every arity, and for
    both placeholder syntaxes the source document actually uses."""
    for collaborators in (ONE, TWO, THREE):
        text = agreements.render_preview_text(collaborators)
        assert "[•]" not in text
        assert "[month]" not in text
        assert "[date]" not in text


def test_execution_month_and_date_are_stamped_not_left_blank(_configured):
    """[month]/[date] use a different bracket syntax and are stamped from
    the actual render-time date (spec §5), not from TEMPLATE_CONSTANTS —
    they always resolve, there is nothing to configure."""
    import datetime as _dt

    text = agreements.render_preview_text(ONE)
    now = _dt.datetime.now(_dt.UTC)
    assert now.strftime("%B") in text
    assert str(now.day) in text


# ═══════════════════════════════════════════════════════════════════════════
# FAIL-CLOSED — run against the REAL, unmodified TEMPLATE_CONSTANTS (no
# `_configured` fixture). This is the state the module actually ships in:
# ARTPARK has not supplied real values, so every one of these must refuse to
# render rather than emit a document with blanks or literal [•] tokens.
# ═══════════════════════════════════════════════════════════════════════════

def test_shipped_constants_are_genuinely_unset():
    """Sanity check on the config block itself, independent of any renderer
    behaviour: if this ever starts failing because someone filled in a real
    value, that's fine — but if it fails because someone filled in a
    *fabricated* one, the tests below are what catch it."""
    c = agreements.TEMPLATE_CONSTANTS["facility-v1"]
    assert c["term_months"] is None
    assert c["insurance_limit"] is None
    assert c["collaboration_agreement_date"] is None
    assert all(v is None for v in c["availability_windows"].values())


def test_render_refuses_when_constants_are_unset_and_names_every_missing_one():
    with pytest.raises(ValueError) as exc_info:
        agreements.render_preview_text(ONE)
    msg = str(exc_info.value)
    for name in (
        "term_months",
        "insurance_limit",
        "collaboration_agreement_date",
        "availability_windows.dedicated_seating",
        "availability_windows.lab_space",
        "availability_windows.computing",
        "availability_windows.wifi",
        "availability_windows.conference_rooms",
        "availability_windows.access_badge",
    ):
        assert name in msg, f"expected {name!r} to be named in the fail-closed error, got: {msg!r}"


def test_render_refuses_for_every_collaborator_arity_when_unset():
    for collaborators in (ONE, TWO, THREE):
        with pytest.raises(ValueError, match="ARTPARK has not supplied"):
            agreements.render_preview_text(collaborators)


def test_partially_configured_constants_still_fail_closed(monkeypatch):
    """Filling in SOME constants but not all must still refuse — never a
    document that's half real values, half blanks."""
    import copy

    partial = copy.deepcopy(_TEST_CONSTANTS)
    partial["insurance_limit"] = None  # still unset
    partial["availability_windows"]["wifi"] = None  # still unset
    monkeypatch.setitem(agreements.TEMPLATE_CONSTANTS, "facility-v1", partial)
    with pytest.raises(ValueError) as exc_info:
        agreements.render_preview_text(ONE)
    msg = str(exc_info.value)
    assert "insurance_limit" in msg
    assert "availability_windows.wifi" in msg
    # and nothing else should be reported as missing
    assert "term_months" not in msg
    assert "collaboration_agreement_date" not in msg


def test_no_output_is_ever_returned_when_constants_are_unset():
    """No partial text ever escapes: the call either raises, or (if it
    somehow didn't) the result must not contain a literal placeholder. This
    is the "under any code path" guarantee — belt and suspenders on top of
    the fail-closed test above."""
    try:
        text = agreements.render_preview_text(ONE)
    except ValueError:
        return  # expected — nothing was returned at all
    assert "[•]" not in text
    assert "[month]" not in text
    assert "[date]" not in text
    pytest.fail("render_preview_text returned output instead of raising for unset constants")


def test_a_value_that_is_itself_a_placeholder_token_still_trips_the_guard(monkeypatch):
    """Defense in depth: even if a constant is technically non-None, a value
    that is itself literally "[•]" (e.g. someone fat-fingers a placeholder
    in as the 'real' value while filling in the config) must still be
    caught — by the leftover-token scan, independent of the is-unset check."""
    import copy

    trap = copy.deepcopy(_TEST_CONSTANTS)
    trap["insurance_limit"] = "[•]"
    monkeypatch.setitem(agreements.TEMPLATE_CONSTANTS, "facility-v1", trap)
    with pytest.raises(ValueError, match="placeholder"):
        agreements.render_preview_text(ONE)
