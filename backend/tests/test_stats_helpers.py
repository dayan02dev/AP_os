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


def test_derive_project_name_caps_at_four_words():
    """Long first sentences truncate to 4 words + ellipsis."""
    row = {
        "solution_describe": (
            "ESD-safe wearable for shop-floor technicians that ships in Q3."
        )
    }
    name = stats.derive_project_name(row)
    assert name is not None
    # 4 words max → ESD-safe wearable for shop-floor + ellipsis
    body = name.rstrip("…")
    assert len(body.split()) <= 4
    assert name.endswith("…")


def test_derive_project_name_short_sentence_no_ellipsis():
    """If the sentence already has <= 4 words, no ellipsis."""
    row = {"solution_describe": "Microfluidic dengue test."}
    name = stats.derive_project_name(row)
    assert name == "Microfluidic dengue test"


def test_derive_project_name_strips_a_an_the_filler():
    """Leading 'A ' / 'An ' / 'The ' are filler; strip before counting words."""
    row = {"solution_describe": "A cobot for warehouse picking and palletization."}
    name = stats.derive_project_name(row)
    assert name is not None
    # 'A' is stripped; first 4 words of "cobot for warehouse picking and..." → "Cobot for warehouse picking…"
    assert name.lower().startswith("cobot for warehouse picking")
    assert name[0] == "C"


def test_derive_project_name_falls_back_to_basic_org():
    row = {"solution_describe": "", "basic_org": "Anna University"}
    assert stats.derive_project_name(row) == "Anna University"


def test_derive_project_name_returns_none_when_blank():
    assert stats.derive_project_name({"solution_describe": "", "basic_org": ""}) is None
    assert stats.derive_project_name(None) is None


def test_derive_project_name_iterative_filler_strip():
    """Filler stack ('Our solution is a robot') strips repeatedly."""
    row = {"solution_describe": "Our solution is a robot arm for assembly lines."}
    name = stats.derive_project_name(row)
    assert name is not None
    # 'Our solution is' + 'a' both strip; remaining starts with 'robot'
    assert name.lower().startswith("robot")


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
