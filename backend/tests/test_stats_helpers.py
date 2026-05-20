"""Tests for the leadership Applications table row-shaping helpers.

These rewrites land with the 017 migration: derive_project_name applies
spec §2 filler-strip + word-boundary truncation, derive_stage_label
returns {raw, label} dicts with per-track maps from spec §4, and
compose_display_id consumes the integer display_seq from the new
per-track sequences (spec §5).
"""

from __future__ import annotations

from app.services import stats


# ─── derive_project_name (spec §2) ──────────────────────────────────────


def test_derive_project_name_strips_filler():
    row = {
        "solution_describe": (
            "We're building a human-cobot assembly cell that lets factory "
            "workers train robots by demonstration."
        )
    }
    name = stats.derive_project_name(row)
    assert name is not None
    assert not name.lower().startswith("we're building")
    assert name[0].isupper()


def test_derive_project_name_first_sentence_kept_when_short():
    row = {
        "solution_describe": (
            "ESD-safe wearable for shop-floor technicians. Solves static "
            "damage in semicon fabs."
        )
    }
    assert (
        stats.derive_project_name(row)
        == "ESD-safe wearable for shop-floor technicians"
    )


def test_derive_project_name_no_truncation_when_under_60():
    row = {
        "solution_describe": (
            "On-device speech-to-text for 22 Indian languages."
        )
    }
    assert (
        stats.derive_project_name(row)
        == "On-device speech-to-text for 22 Indian languages"
    )


def test_derive_project_name_truncates_long_first_sentence():
    row = {
        "solution_describe": (
            "A human-cobot assembly cell that lets factory workers train "
            "robots by demonstration on a touchscreen UI."
        )
    }
    name = stats.derive_project_name(row)
    assert name is not None
    assert len(name) <= 61  # 60 + ellipsis
    assert name.endswith("…")
    # Must break at a whitespace, not mid-word
    body = name.rstrip("…").rstrip()
    assert " " in body  # not a single mid-word fragment


def test_derive_project_name_falls_back_to_basic_org():
    row = {"solution_describe": "", "basic_org": "Anna University"}
    assert stats.derive_project_name(row) == "Anna University"


def test_derive_project_name_returns_none_when_blank():
    assert stats.derive_project_name({"solution_describe": "", "basic_org": ""}) is None
    assert stats.derive_project_name(None) is None


def test_derive_project_name_capitalizes_first_letter():
    row = {"solution_describe": "a cobot for warehouse picking."}
    name = stats.derive_project_name(row)
    assert name is not None
    assert name[0] == "A"


def test_derive_project_name_uses_extended_text_when_first_sentence_too_short():
    """If the first sentence is < 20 chars but more text exists, use up to
    80 chars of the full description."""
    row = {
        "solution_describe": (
            "We do AI. We make foundation models for code generation and "
            "developer tooling across many languages."
        )
    }
    name = stats.derive_project_name(row)
    assert name is not None
    # First sentence "We do AI." is 9 chars (< 20) so we extend.
    assert len(name) > 9


# ─── derive_stage_label (spec §4) ───────────────────────────────────────


def test_derive_stage_label_tir_lab_demo():
    row = {"track": "tir", "solution_stage": "Lab demos / proof of concept"}
    assert stats.derive_stage_label(row) == {
        "raw": "Lab demos / proof of concept",
        "label": "Lab demo",
    }


def test_derive_stage_label_tir_all_known_mappings():
    cases = {
        "Still exploring": "Exploring",
        "Literature / research stage": "Research",
        "Simulations completed": "Simulation",
        "Lab demos / proof of concept": "Lab demo",
        "Prototype built": "Prototype",
        "Pilot-ready product": "Pilot-ready",
        "Deployed in real setting with real users": "Deployed",
    }
    for raw, short in cases.items():
        row = {"track": "tir", "solution_stage": raw}
        assert stats.derive_stage_label(row) == {"raw": raw, "label": short}


def test_derive_stage_label_sip_active_pilots():
    row = {
        "track": "sip",
        "sip_traction": "Active pilots (paid or unpaid) with design partners",
    }
    assert stats.derive_stage_label(row) == {
        "raw": "Active pilots (paid or unpaid) with design partners",
        "label": "Active pilots",
    }


def test_derive_stage_label_sip_all_known_mappings():
    cases = {
        "Pre-revenue — building toward our first pilot": "Pre-revenue",
        "Active pilots (paid or unpaid) with design partners": "Active pilots",
        "Paying pilots — customers have paid for early access": "Paying pilots",
        "Live paying customers — repeat revenue": "Live revenue",
    }
    for raw, short in cases.items():
        row = {"track": "sip", "sip_traction": raw}
        assert stats.derive_stage_label(row) == {"raw": raw, "label": short}


def test_derive_stage_label_returns_none_when_blank():
    assert stats.derive_stage_label({"track": "tir", "solution_stage": None}) is None
    assert stats.derive_stage_label({"track": "sip", "sip_traction": None}) is None
    assert stats.derive_stage_label(None) is None


def test_derive_stage_label_unknown_raw_surfaces_raw_as_label():
    """When raw text isn't in our map, surface it anyway so leadership
    sees the answer rather than '—'."""
    row = {"track": "tir", "solution_stage": "Something custom"}
    assert stats.derive_stage_label(row) == {
        "raw": "Something custom",
        "label": "Something custom",
    }


def test_derive_stage_label_sip_trl_fallback():
    """When traction is missing but TRL is set, use TRL as a fallback."""
    row = {
        "track": "sip",
        "sip_traction": None,
        "sip_trl": "TRL 5 — pilot-tested in a relevant environment",
    }
    out = stats.derive_stage_label(row)
    assert out is not None
    assert out["raw"] == "TRL 5 — pilot-tested in a relevant environment"


# ─── compose_display_id (spec §5) ───────────────────────────────────────


def test_compose_display_id_with_seq():
    assert stats.compose_display_id("tir", 26013) == "TIR-26013"
    assert stats.compose_display_id("sip", 26001) == "SIP-26001"


def test_compose_display_id_handles_none():
    assert stats.compose_display_id("tir", None) == "TIR-?????"
    assert stats.compose_display_id("sip", "") == "SIP-?????"


def test_compose_display_id_accepts_string_seq():
    """Supabase returns numerics as either int or str depending on driver;
    coerce safely."""
    assert stats.compose_display_id("tir", "26013") == "TIR-26013"


def test_compose_display_id_invalid_seq_returns_placeholder():
    assert stats.compose_display_id("tir", "not-a-number") == "TIR-?????"


def test_compose_display_id_unknown_track_uppercases():
    assert stats.compose_display_id("xyz", 100) == "XYZ-100"
