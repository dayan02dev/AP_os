"""Unit tests for the demo cohort planner. Pure functions only — no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from seed_demo_cohort import DEMO_PLAN, reviews_for, select_demo_rows  # noqa: E402


class TestPlanShape:
    def test_twelve_slots(self):
        assert len(DEMO_PLAN) == 12

    def test_every_slot_names_a_track_and_status(self):
        for p in DEMO_PLAN:
            assert p["track"] in ("tir", "sip")
            assert p["status"]

    def test_covers_the_states_the_spec_requires(self):
        statuses = {p["status"] for p in DEMO_PLAN}
        for required in ("submitted", "under_review", "evaluated",
                         "on_hold", "jury_review", "rejected", "offered"):
            assert required in statuses, f"{required} missing from the demo plan"

    def test_exactly_one_slot_is_a_moved_track(self):
        assert sum(1 for p in DEMO_PLAN if p.get("moved")) == 1

    def test_exactly_one_slot_has_a_signed_memo(self):
        assert sum(1 for p in DEMO_PLAN if p.get("memo") == "signed") == 1

    def test_signed_memo_slot_is_visible_on_the_accepted_tab(self):
        # Ruling A (I5, 2026-08-24 review): it is not enough that exactly one
        # slot is signed — it has to be the RIGHT one. The Admin "Selected
        # Applications" tab only ever fetches status=jury_review plus
        # gate-2-rejected rows, and its green ACCEPTED row requires a signed
        # memo. A signed memo on any status other than jury_review (e.g.
        # "offered") could never render as that row anywhere in the demo.
        # This pins the property that actually matters, not just the count.
        signed = [p for p in DEMO_PLAN if p.get("memo") == "signed"]
        assert len(signed) == 1
        assert signed[0]["status"] == "jury_review", (
            "the signed-memo slot must be status=jury_review — that is the "
            "only status the Accepted tab's green ACCEPTED row can render "
            f"for, but this slot is {signed[0]['status']!r}"
        )


class TestSelection:
    def _cands(self, n):
        # Deliberately unsorted, to prove selection does not depend on input order.
        return [{"id": f"{i:04d}-aaaa", "status": "under_review"} for i in reversed(range(n))]

    def test_selects_one_row_per_slot(self):
        got = select_demo_rows(self._cands(30), DEMO_PLAN)
        assert len(got) == len(DEMO_PLAN)

    def test_selection_is_stable_across_input_order(self):
        a = select_demo_rows(self._cands(30), DEMO_PLAN)
        b = select_demo_rows(list(reversed(self._cands(30))), DEMO_PLAN)
        assert [r["id"] for r, _ in a] == [r["id"] for r, _ in b]

    def test_never_reuses_a_row(self):
        got = select_demo_rows(self._cands(30), DEMO_PLAN)
        ids = [r["id"] for r, _ in got]
        assert len(ids) == len(set(ids))

    def test_raises_when_there_are_too_few_candidates(self):
        import pytest
        with pytest.raises(ValueError, match="not enough"):
            select_demo_rows(self._cands(3), DEMO_PLAN)


class TestReviewSets:
    def test_yes_verdict_needs_two_yes_and_under_two_no(self):
        recs = [r["recommendation"] for r in reviews_for("verdict_yes")]
        assert recs.count("yes") >= 2 and recs.count("no") < 2

    def test_no_verdict_needs_two_no_and_under_two_yes(self):
        recs = [r["recommendation"] for r in reviews_for("verdict_no")]
        assert recs.count("no") >= 2 and recs.count("yes") < 2

    def test_split_produces_neither_majority(self):
        recs = [r["recommendation"] for r in reviews_for("split")]
        assert recs.count("yes") < 2 and recs.count("no") < 2

    def test_none_means_no_reviews(self):
        assert reviews_for("none") == []

    def test_every_review_carries_submitted_at(self):
        # The live `reviews` table has NO `status` column — submitted_at is the
        # only signal that a review counts as submitted.
        for spec in ("verdict_yes", "verdict_no", "split"):
            for r in reviews_for(spec):
                assert r.get("submitted_at")
                assert "status" not in r
