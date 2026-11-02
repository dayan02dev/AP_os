"""Re-assign paths after a decline or a gate decision.

ASG-V1: the batch fan-out paths (add reviewers to a batch / add apps to a
batch) revive a declined assignment in place, like the admin drawer and the
leadership assign paths do, instead of silently skipping it.
ASG-V2: leadership POST /leadership/applications/{id}/reviewers refuses a
decided app with 'skipped_closed', like the admin bulk-assign path.
"""
from __future__ import annotations

import pytest

from tests.fixtures.assignment_world import (  # noqa: F401  (world is a fixture)
    R1, R2, asg_row, batch_with, seed, world,
)


def _no_dupes(sb):
    keys = [(a["application_id"], a["application_track"], a["reviewer_user_id"])
            for a in sb.tables["reviewer_assignments"]]
    assert len(keys) == len(set(keys)), f"duplicate assignment rows: {keys}"
    assert sb.stats["unique_violations"] == 0


def _declined_world(world):
    sb = seed()
    sb.tables["reviewer_assignments"].append(asg_row(R1, "V1"))
    w = world(sb)
    w.reviewer(R1)
    r = w.client.post(f"/reviewer/assignments/as-{R1}-V1-sip/decline",
                      json={"reason": "conflict of interest here"})
    assert r.status_code == 200, r.text
    assert "V1" not in w.default_view(R1)
    return w


def _assert_revived(w, resp):
    _no_dupes(w.sb)
    rows = w.sb.asg(R1, "V1")
    assert len(rows) == 1 and rows[0]["declined_at"] is None, rows
    assert rows[0]["decline_reason"] is None and rows[0]["reassigned_to"] is None
    assert "V1" in w.default_view(R1), resp
    assert any(e["application_id"] == "V1" and e["reviewer_user_id"] == R1 for e in w.emails)


def test_decline_then_add_reviewer_to_batch_revives(world):
    w = _declined_world(world)
    batch_with(w.sb, "bA", ["V1"], [], assign=False)
    r = w.admin().client.post("/admin/platform/batches/bA/reviewers",
                              json={"reviewer_user_ids": [R1]})
    assert r.status_code == 200, r.text
    _assert_revived(w, r.json())


def test_decline_then_add_app_to_batch_revives(world):
    w = _declined_world(world)
    w.sb.tables["batch_reviewers"].append({"batch_id": "bA", "reviewer_user_id": R1})
    r = w.admin().client.post("/admin/platform/batches/bA/applications",
                              json={"items": [{"track": "sip", "application_id": "V1"}]})
    assert r.status_code == 200, r.text
    _assert_revived(w, r.json())


def test_batch_fanout_leaves_active_assignment_alone(world):
    sb = seed()
    batch_with(sb, "bA", ["V1"], [R1])
    w = world(sb)
    before = dict(w.sb.asg(R1, "V1")[0])
    r = w.admin().client.post("/admin/platform/batches/bA/reviewers",
                              json={"reviewer_user_ids": [R1]})
    assert r.status_code == 200, r.text
    assert w.sb.asg(R1, "V1") == [before]
    assert not w.emails
    _no_dupes(w.sb)


@pytest.mark.parametrize("decision", ["rejected", "jury_review"])
def test_leadership_assign_skips_decided_app(world, decision):
    sb = seed()
    batch_with(sb, "bA", ["V1"], [R1, R2])
    w = world(sb)
    body = {"decision": decision}
    if decision == "rejected":
        body["rationale"] = "not a fit"
    assert w.admin().client.post("/admin/platform/applications/sip/V1/decision",
                                 json=body).status_code == 200
    r = w.lead().client.post("/leadership/applications/V1/reviewers",
                             json={"reviewer_user_ids": [R1]})
    assert r.status_code == 200, r.text
    assert [x["status"] for x in r.json()["results"]] == ["skipped_closed"]
    assert w.sb.asg(R1, "V1") == []
    assert not any(e["application_id"] == "V1" for e in w.emails)


def test_leadership_assign_still_creates_on_open_app(world):
    w = world(seed())
    r = w.lead().client.post("/leadership/applications/V1/reviewers",
                             json={"reviewer_user_ids": [R1]})
    assert [x["status"] for x in r.json()["results"]] == ["created"]
    assert len(w.sb.asg(R1, "V1")) == 1
