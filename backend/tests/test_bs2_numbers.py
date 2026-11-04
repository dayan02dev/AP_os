"""SWARM2 numbers_consistency — backend repros at 837ccf0.

Each test asserts the CORRECT behaviour, so it FAILS while the bug is present.
Uses a PostgREST-faithful fake (1000-row max_rows cap, .range honoured)."""
from __future__ import annotations

from app.services import admin_query, applications_query, reviewer_query, stats

from tests.fixtures.capped_fake import CappedFakeSupabase


def _install(monkeypatch, sb):
    for mod in (admin_query, applications_query, reviewer_query, stats):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb, raising=False)


def _tir(i):
    return {"id": f"t{i:05d}", "status": "evaluated", "display_seq": 26001 + i,
            "basic_full_name": f"F{i}", "basic_email": f"f{i}@x.io", "basic_org": "Org",
            "submitted_at": "2026-06-01T00:00:00Z"}


def _review(aid, rid, **kw):
    return {"id": f"rv-{aid}-{rid}", "application_id": aid, "application_track": "tir",
            "reviewer_user_id": rid, "submitted_at": "2026-07-01T00:00:00Z",
            "score_problem": 6, "score_solution": 6, "score_tech": 6, "score_founders": 6,
            "recommendation": "yes", **kw}


# ─── NS-2 (still open): flags read is one unpaged .in_() per track ─────────
def test_pipeline_flags_not_lost_past_1000_review_rows(monkeypatch):
    apps = [_tir(i) for i in range(600)]
    reviews = []
    for a in apps:
        for rid in ("r1", "r2"):
            reviews.append(_review(a["id"], rid, flags=["conflict_of_interest"]))
    sb = CappedFakeSupabase({"tir_applications": apps, "sip_applications": [],
                             "reviews": reviews, "reviewer_assignments": []})
    _install(monkeypatch, sb)
    rows = admin_query.fetch_pipeline({})["applications"]
    two_reviews = [r for r in rows if r["reviews_submitted"] == 2]
    no_flags = [r for r in two_reviews if not r["flags"]]
    assert len(two_reviews) == 600
    assert no_flags == [], f"{len(no_flags)} apps show 2 reviews but no reviewer flags"


# ─── NS-1 (still open): un-ORDERed OFFSET paging double-counts a vote ──────
def test_review_stats_paging_cannot_double_count_a_vote(monkeypatch):
    """admin_query._fetch_all pages reviews with .range() and no .order(). If an
    UPDATE (every autosave PATCHes the row) moves the tuple between page reads,
    the same review is returned twice and counted twice in the reco tally."""
    filler = [_review(f"z{i:05d}", "rX", recommendation="no") for i in range(1500)]
    target = _review("t00000", "r1", recommendation="yes")
    reviews = [target] + filler

    def on_select(table, call_no, rows):
        # After page 1 was served, the target row's tuple moves to the end of the heap.
        if table == "reviews" and call_no == 2 and rows and rows[0]["id"] == target["id"]:
            rows.append(rows.pop(0))

    sb = CappedFakeSupabase({"reviews": reviews, "reviewer_assignments": [],
                             "reviewer_profiles": []}, on_select=on_select)
    _install(monkeypatch, sb)
    st = admin_query._fetch_review_stats([("tir", "t00000")])[("tir", "t00000")]
    assert st["submitted"] == 1
    assert st["reco"]["yes"] == 1 and st["review_count"] == 1, st
    assert admin_query.reco_verdict(st["reco"]) is None   # one review → no verdict


# ─── Review-stats read failure is silently reported as "0 reviews" ─────────
def test_review_stats_read_failure_is_not_reported_as_zero_reviews(monkeypatch):
    """_fetch_review_stats returns {} when the reviews read raises; fetch_pipeline
    (and the leadership list) then render every app as 0 reviews / no reco /
    no reviewer score, and the Reco 'No reviews' filter matches every app.
    Nothing in the payload tells the UI the numbers are missing."""
    apps = [_tir(0)]
    sb = CappedFakeSupabase({"tir_applications": apps, "sip_applications": [],
                             "reviews": [_review("t00000", "r1"), _review("t00000", "r2")],
                             "reviewer_assignments": []})
    _install(monkeypatch, sb)
    real_table = sb.table

    def table(name):
        if name == "reviews":
            raise RuntimeError("PostgREST 503")
        return real_table(name)

    monkeypatch.setattr(sb, "table", table)
    try:
        out = admin_query.fetch_pipeline({})
    except Exception:
        return  # surfacing the failure is acceptable
    row = out["applications"][0]
    degraded = out.get("degraded") or row.get("degraded")
    assert degraded or row["reviews_submitted"] == 2, (
        f"reviews read failed but the row claims {row['reviews_submitted']} reviews, "
        f"reco={row['reco']}, reviewer_score={row['reviewer_score']} with no degraded flag")


# ─── Reviewer calibration endpoint reads reviews/profiles/ai unpaged ───────
def test_calibration_counts_every_submitted_review(monkeypatch):
    reviewers = [f"r{i}" for i in range(5)]
    reviews = [_review(f"a{i:05d}", rid) for rid in reviewers for i in range(300)]  # 1500 rows
    sb = CappedFakeSupabase({
        "user_roles": [{"user_id": r, "role": "reviewer"} for r in reviewers],
        "profiles": [{"id": r, "full_name": r} for r in reviewers],
        "reviews": reviews, "ai_screening": [],
    })
    _install(monkeypatch, sb)
    cal = {r["user_id"]: r["n_reviews"] for r in admin_query.fetch_calibration()["reviewers"]}
    assert cal == {r: 300 for r in reviewers}, cal
