"""Reviewer rubric v3.1 — single source for the modal, inline panel, and the
scoring.md download. Weights MUST stay in lockstep with
reviewer_query._SCORE_WEIGHTS (problem 22 / solution 30 / tech 22 / founders 14
/ commit 12). Anchor text is transcribed verbatim from the REVIEWER-UI
prototype's RubricModal."""

import copy

RUBRIC_VERSION = "v3.1"
RUBRIC_DATE = "2026-04-01"  # Date the v3.1 rubric revision was ratified (shown in the modal header).

RUBRIC_DIMENSIONS = [
    {"key": "problem", "name": "Problem Quality", "weight": 22,
     "anchors": {
         "10": "Existential pain for a clearly-defined market segment with quantified $ impact",
         "8": "Clear pain, identified segment, market sized but unverified",
         "6": "Pain articulated, segment vague, no numbers",
         "4": "Pain assumed, no customer evidence",
         "2": "Solution-first thinking — no real problem"}},
    {"key": "solution", "name": "Solution Fit", "weight": 30,
     "anchors": {
         "10": "Solution maps 1:1 to problem · differentiated vs all known alternatives",
         "8": "Solution maps to problem · differentiated vs incumbents",
         "6": "Solution addresses problem · differentiation unclear",
         "4": "Solution loosely tied to problem · me-too risk",
         "2": "Solution looking for a problem"}},
    {"key": "tech", "name": "Tech Depth", "weight": 22,
     "anchors": {
         "10": "Novel IP · multiple patents · published research",
         "8": "Genuine technical edge · known to experts",
         "6": "Solid implementation · standard tech stack",
         "4": "Wrapper / integration play",
         "2": "No defensible tech"}},
    {"key": "founders", "name": "Founder Strength", "weight": 14,
     "anchors": {
         "10": "2-3 founders, complementary, prior exits or domain mastery, full-time",
         "8": "2+ founders, complementary, full-time, deep domain",
         "6": "2 founders, some skill overlap, full-time",
         "4": "Solo founder with strong background OR co-founders with weak match",
         "2": "Solo founder, generalist, part-time"}},
    {"key": "commit", "name": "Commitment", "weight": 12,
     "anchors": {
         "10": "Quit prior job, invested own capital, 2+ years runway personal",
         "8": "Full-time, some personal capital",
         "6": "Full-time, no personal capital",
         "4": "Partial commitment, \"validating\"",
         "2": "Side project"}},
]

RUBRIC_NOTES = [
    "Score independently of the AI baseline.",
    "Notes are recommended — capture what stood out in your assessment.",
    "Flag any inconsistency you spot — admin will reconcile.",
]


def get_rubric(track: str) -> dict:
    label = "TIR" if track == "tir" else "VIP"
    return {
        "version": RUBRIC_VERSION,
        "date": RUBRIC_DATE,
        "title": f"{label} 2026 rubric",
        "dimensions": copy.deepcopy(RUBRIC_DIMENSIONS),
        "notes": list(RUBRIC_NOTES),
    }
