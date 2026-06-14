"""Unit tests for the §4.3 presenter — pure functions over application rows."""
from app.services.review_presenter import (
    sentence_bullets, build_fields, build_sections, TIR_FIELD_MAP, SIP_FIELD_MAP,
)


def test_sentence_bullets_splits_on_sentences_protecting_decimals():
    text = ("We process 4.5 tonnes daily. Costs fall by ₹2.3 lakh per site. "
            "Pilots run in 3 cities.")
    assert sentence_bullets(text) == [
        "We process 4.5 tonnes daily.",
        "Costs fall by ₹2.3 lakh per site.",
        "Pilots run in 3 cities.",
    ]


def test_sentence_bullets_prefers_bullet_markers():
    text = "• first point • second point"
    assert sentence_bullets(text) == ["first point", "second point"]


def test_build_fields_tir_marks_short_facts_and_bullets_long_text():
    row = {
        "problem_defined": "Yes",
        "problem_describe": "Indian startups face slow valuations. Banks lack data.",
        "solution_stage": "Pilot-ready product",
        "solution_describe": None,
    }
    fields = build_fields(row, TIR_FIELD_MAP)
    by_label = {f["label"]: f for f in fields}
    assert by_label["Problem defined"]["short"] is True
    assert by_label["Problem description"]["bullets"] == [
        "Indian startups face slow valuations.", "Banks lack data."]
    assert "Solution description" not in by_label  # None answers omitted


def test_sentence_bullets_keeps_titles_together():
    text = "Advised by Dr. Smith. Works across India."
    assert sentence_bullets(text) == [
        "Advised by Dr. Smith.",
        "Works across India.",
    ]


def test_sentence_bullets_handles_st_and_prof():
    text = "Based at St. John Hospital. Led by Prof. Rao."
    assert sentence_bullets(text) == [
        "Based at St. John Hospital.",
        "Led by Prof. Rao.",
    ]


def test_build_sections_covers_every_mapped_question():
    row = {col: "x" for _, col, _ in TIR_FIELD_MAP}
    sections = build_sections(row, "tir")
    prompts = [q["prompt"] for s in sections for q in s["questions"]]
    assert len(prompts) >= 10                      # all wizard questions present
    assert sections[0]["num"] == "01"
