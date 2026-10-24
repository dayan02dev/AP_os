"""End-to-end admin -> reviewer VIP batch lifecycle through the HTTP API.

One mutating in-memory Supabase (tests/fixtures/fake_supabase.py) is patched
into EVERY module that imported `get_admin_client`, auth is overridden per
request, and the whole lifecycle is driven with FastAPI's TestClient:

  create batch -> add apps (mixed statuses + a moved TIR->VIP app) -> add 3
  reviewers one by one -> reviewer opens + submits a review -> remove a
  reviewer -> remove an app -> delete batch -> rename.

After each stage `_cross_view_problems()` compares the four views an admin /
reviewer actually looks at (reviewer queue, admin roster + batch chips, roster
drawer, admin pipeline) and reports every disagreement. Tests marked
"BUG:" assert what a sensible admin would expect and FAIL on the current code;
tests marked "PIN:" document a KNOWN bug and pass.
"""
from __future__ import annotations

import sys

import pytest
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.main import app as fastapi_app
from tests.fixtures.fake_supabase import FakeSupabase

ADMIN = "adm-1"
REVIEWERS = ["rev-1", "rev-2", "rev-3"]

_SCORES = {
    "score_problem": 7, "score_solution": 6, "score_tech": 7,
    "score_founders": 8, "score_commitment": 7,
    "recommendation": "yes", "quick_notes": "solid", "draft": False,
}


def _sip(app_id, status, seq):
    return {
        "id": app_id, "status": status, "display_seq": seq,
        "basic_org": f"Org {app_id}", "basic_full_name": f"Founder {app_id}",
        "basic_email": f"{app_id}@x.io", "submitted_at": f"2026-09-{seq % 28 + 1:02d}T00:00:00+00:00",
        "moved_to_track": None, "basic_teammates": [],
    }


def _seed() -> dict:
    return {
        "user_roles": (
            [{"user_id": ADMIN, "role": "admin"}]
            + [{"user_id": r, "role": "reviewer"} for r in REVIEWERS]
        ),
        "profiles": (
            [{"id": ADMIN, "full_name": "Admin", "email": "admin@x.io"}]
            + [{"id": r, "full_name": f"Rev {r}", "email": f"{r}@x.io"} for r in REVIEWERS]
        ),
        "reviewer_profiles": [{"reviewer_user_id": r, "weight": 1.0} for r in REVIEWERS],
        "sip_applications": [
            _sip("S1", "submitted", 1),
            _sip("S2", "submitted", 2),
            _sip("S3", "under_review", 3),
            _sip("S4", "evaluated", 4),
            _sip("S5", "jury_review", 5),
            _sip("S6", "rejected", 6),
        ],
        # M1 lives in tir_applications but was moved TIR -> VIP.
        "tir_applications": [{**_sip("M1", "submitted", 7), "moved_to_track": "sip"}],
        "batches": [], "batch_reviewers": [], "application_batches": [],
        "reviewer_assignments": [], "reviews": [], "ai_screening": [],
        "industry_categories": [], "admin_decisions": [], "ic_documents": [],
        "application_status_log": [], "audit_log_v2": [], "application_admin_meta": [],
        "jury_selections": [],
    }


class World:
    def __init__(self, sb: FakeSupabase, client: TestClient, emails: list):
        self.sb, self.c, self.emails = sb, client, emails
        self.batch_id: str | None = None

    # -- auth switch -----------------------------------------------------
    def as_(self, user_id: str, role: str):
        fastapi_app.dependency_overrides[get_current_user] = lambda: {
            "user_id": user_id, "email": f"{user_id}@x.io", "roles": [role],
        }
        return self.c

    @property
    def admin(self):
        return self.as_(ADMIN, "admin")

    def rev(self, rid):
        return self.as_(rid, "reviewer")

    # -- admin actions ---------------------------------------------------
    def create_batch(self, name="VIP Batch 1"):
        r = self.admin.post("/admin/platform/batches", json={"name": name})
        assert r.status_code == 200, r.text
        self.batch_id = r.json()["id"]
        return self.batch_id

    def add_apps(self, items, batch_id=None):
        return self.admin.post(
            f"/admin/platform/batches/{batch_id or self.batch_id}/applications",
            json={"items": [{"track": t, "application_id": a} for a, t in items]},
        )

    def remove_apps(self, items, batch_id=None):
        return self.admin.post(
            f"/admin/platform/batches/{batch_id or self.batch_id}/applications/remove",
            json={"items": [{"track": t, "application_id": a} for a, t in items]},
        )

    def add_reviewers(self, rids, batch_id=None):
        return self.admin.post(
            f"/admin/platform/batches/{batch_id or self.batch_id}/reviewers",
            json={"reviewer_user_ids": rids},
        )

    def remove_reviewer(self, rid, batch_id=None):
        return self.admin.delete(
            f"/admin/platform/batches/{batch_id or self.batch_id}/reviewers/{rid}")

    # -- views -----------------------------------------------------------
    def queue(self, rid):
        r = self.rev(rid).get("/reviewer/queue")
        assert r.status_code == 200, r.text
        return r.json()

    def roster(self):
        r = self.admin.get("/admin/platform/reviewers")
        assert r.status_code == 200, r.text
        return {x["user_id"]: x for x in r.json()["reviewers"]}

    def drawer(self, rid):
        r = self.admin.get(f"/admin/platform/reviewers/{rid}/applications")
        assert r.status_code == 200, r.text
        return r.json()["applications"]

    def pipeline(self):
        r = self.admin.get("/admin/platform/applications")
        assert r.status_code == 200, r.text
        return {x["id"]: x for x in r.json()["applications"]}

    def assignments(self, rid=None):
        return [a for a in self.sb.tables["reviewer_assignments"]
                if rid is None or a["reviewer_user_id"] == rid]

    def status(self, app_id):
        for t in ("sip_applications", "tir_applications"):
            r = self.sb.row(t, app_id)
            if r:
                return r["status"]

    def submit_review(self, rid, app_id, track="sip"):
        asg = next(a for a in self.assignments(rid)
                   if a["application_id"] == app_id and a["application_track"] == track)
        return self.rev(rid).post("/reviewer/reviews", json={
            "application_id": app_id, "application_track": track,
            "assignment_id": asg["id"], **_SCORES})


@pytest.fixture
def w(monkeypatch):
    sb = FakeSupabase(_seed())
    # Patch the one DB into every module that bound get_admin_client.
    import app.main  # noqa: F401  (make sure every router/service is imported)
    for name, mod in list(sys.modules.items()):
        if name.startswith("app.") and hasattr(mod, "get_admin_client"):
            monkeypatch.setattr(mod, "get_admin_client", lambda: sb)

    # Capture reviewer-assigned emails instead of calling Resend.
    emails: list[dict] = []

    class _Svc:
        def send_reviewer_assigned(self, *, to, reviewer_name, apps, inbox_url, batch_name=None):
            emails.append({"to": to, "apps": [a["applicant_name"] for a in apps],
                           "n": len(apps)})

    from app.services import assignment_email
    monkeypatch.setattr(assignment_email, "get_email_service", lambda: _Svc())
    if hasattr(fastapi_app.state, "limiter"):
        fastapi_app.state.limiter.reset()
    yield World(sb, TestClient(fastapi_app), emails)
    fastapi_app.dependency_overrides.clear()


# ───────────────────────── cross-view consistency ─────────────────────────

def _cross_view_problems(w: World, stage: str) -> list[str]:
    """Every pair of views must agree about who is assigned to what."""
    problems: list[str] = []
    roster, pipe = w.roster(), w.pipeline()
    queues = {r: w.queue(r) for r in REVIEWERS}
    live_in_queue = {r: {q["id"] for q in qs if not q["detached"] and not q["closed"]}
                     for r, qs in queues.items()}
    for r in REVIEWERS:
        row = roster[r]
        drawer = w.drawer(r)
        pending_q = {q["id"] for q in queues[r]
                     if q["reviewStatus"] != "submitted" and not q["closed"]}
        done_q = {q["id"] for q in queues[r] if q["reviewStatus"] == "submitted"}
        n_queue = len(pending_q | done_q)
        if row["assigned"] != n_queue:
            problems.append(f"[{stage}] {r}: roster.assigned={row['assigned']} but reviewer "
                            f"queue has {n_queue} ({sorted(pending_q | done_q)})")
        if len(drawer) != row["assigned"]:
            problems.append(f"[{stage}] {r}: drawer rows={len(drawer)} but roster.assigned="
                            f"{row['assigned']}")
        chips = sum(b["count"] for b in row["batches"])
        if chips != row["assigned"]:
            problems.append(f"[{stage}] {r}: batch chips sum={chips} != assigned={row['assigned']}")
        if row["completed"] != len(done_q):
            problems.append(f"[{stage}] {r}: roster.completed={row['completed']} != "
                            f"queue submitted={len(done_q)}")
    for app_id, p in pipe.items():
        who = {r for r in REVIEWERS if app_id in live_in_queue[r]
               or any(q["id"] == app_id and q["reviewStatus"] == "submitted" for q in queues[r])}
        if p["reviewers_assigned"] != len(who):
            problems.append(f"[{stage}] pipeline {app_id}: reviewers_assigned="
                            f"{p['reviewers_assigned']} but {len(who)} reviewers see it in queue")
    return problems


# ───────────────────────────── the e2e scenario ─────────────────────────────

def test_full_vip_lifecycle_cross_view_consistency(w: World):
    """Soft-assert the whole lifecycle; every message is one inconsistency."""
    problems: list[str] = []
    note = problems.append

    # 1. create batch, add apps (mixed statuses) BEFORE any reviewer exists.
    w.create_batch()
    r = w.add_apps([("S1", "sip"), ("S2", "sip"), ("S3", "sip"), ("S4", "sip"),
                    ("S5", "sip"), ("S6", "sip"), ("M1", "tir")])
    assert r.status_code == 200, r.text
    if w.assignments():
        note("add apps with no reviewers created assignments")
    for a in ("S1", "S2", "M1"):
        if w.status(a) != "submitted":
            note(f"[add apps, 0 reviewers] {a} flipped to {w.status(a)} with ZERO "
                 f"reviewers assigned (should stay 'submitted')")

    # 2. assign reviewers one by one.
    for i, rid in enumerate(REVIEWERS, 1):
        r = w.add_reviewers([rid])
        assert r.status_code == 200, r.text
        n = len(w.assignments(rid))
        if n == 0:
            note(f"[assign {rid}] no assignments created")
        # rejected / jury_review apps must not be handed to a reviewer
        for bad in ("S5", "S6"):
            if any(a["application_id"] == bad for a in w.assignments(rid)):
                note(f"[assign {rid}] {bad} (status {w.status(bad)}) was assigned to a reviewer")
        problems += _cross_view_problems(w, f"after assigning {i} reviewer(s)")
    mailed = {e["to"] for e in w.emails}
    if len(w.emails) != 3:
        note(f"expected exactly 3 assignment emails (one per reviewer), got {len(w.emails)}")
    for e in w.emails:
        if "S6" in " ".join(e["apps"]):
            note("assignment email lists rejected app S6")

    # 3. rev-1 opens app detail and submits a review.
    c = w.rev("rev-1")
    d = c.get("/reviewer/applications/sip/S1")
    if d.status_code != 200:
        note(f"reviewer cannot open assigned app S1: {d.status_code} {d.text}")
    sub = w.submit_review("rev-1", "S1")
    if sub.status_code != 201:
        note(f"reviewer submit failed: {sub.status_code} {sub.text}")
    if w.status("S1") != "evaluated":
        note(f"S1 status after first review = {w.status('S1')}")
    problems += _cross_view_problems(w, "after rev-1 submitted S1")
    pipe = w.pipeline()
    if pipe["S1"]["reviews_submitted"] != 1:
        note("pipeline S1 reviews_submitted != 1")
    if pipe["S1"]["reviewers_assigned"] != 3:
        note(f"pipeline S1 reviewers_assigned={pipe['S1']['reviewers_assigned']} expected 3")

    # 4. remove rev-3 from the batch.
    assert w.remove_reviewer("rev-3").status_code == 200
    if w.assignments("rev-3"):
        note(f"rev-3 still has {len(w.assignments('rev-3'))} assignments after batch removal")
    if w.queue("rev-3"):
        note("rev-3 queue not empty after removal from the only batch")
    problems += _cross_view_problems(w, "after removing rev-3")

    # 5. remove S2 from the batch.
    assert w.remove_apps([("S2", "sip")]).status_code == 200
    if any(a["application_id"] == "S2" for a in w.assignments()):
        note("S2 still assigned to someone after removal from its only batch")
    if w.pipeline()["S2"]["batches"]:
        note("pipeline S2 still shows a batch")
    # removing the app leaves it 'under_review' with nobody assigned
    if w.status("S2") == "under_review":
        note("S2 is 'under_review' with 0 reviewers and no batch after removal "
             "(status never reverts)")
    problems += _cross_view_problems(w, "after removing S2")

    # 6. delete the batch.
    assert w.admin.delete(f"/admin/platform/batches/{w.batch_id}").status_code == 200
    # FK cascade (batch_reviewers.batch_id ... on delete cascade) is not modelled
    # by the fake: emulate it so the rest reflects production.
    w.sb.tables["batch_reviewers"][:] = [
        m for m in w.sb.tables["batch_reviewers"] if m["batch_id"] != w.batch_id]
    for rid in ("rev-1", "rev-2"):
        if w.assignments(rid):
            note(f"[delete batch] {rid} keeps {len(w.assignments(rid))} live assignments for "
                 f"apps that no longer belong to ANY batch (queue/roster show 'Unbatched'); "
                 f"no UI path removes them except 'Unassigned' which wipes everything")
            break
    problems += _cross_view_problems(w, "after deleting batch")

    # 7. rename after delete -> 404, not 200
    r = w.admin.patch(f"/admin/platform/batches/{w.batch_id}", json={"name": "x"})
    if r.status_code != 404:
        note(f"rename of deleted batch returned {r.status_code}")

    assert not problems, "\n" + "\n".join(f"- {p}" for p in problems)


# ───────────────────────────── focused bug tests ─────────────────────────────

def test_BUG_add_apps_with_no_reviewers_advances_status(w: World):
    """add_apps_to_batch calls _advance() for every app even when the batch has
    no reviewers, so 'submitted' apps flip to 'under_review' with 0 reviewers.
    (batch_membership.py add_apps_to_batch: `_advance(aid, track)` is outside the
    reviewer loop; assign_reviewers_to_batch only advances apps that got rows.)"""
    w.create_batch()
    assert w.add_apps([("S1", "sip")]).status_code == 200
    assert w.assignments() == []
    assert w.status("S1") == "submitted"
    assert w.pipeline()["S1"]["reviewers_assigned"] == 0


def test_BUG_rejected_and_decided_apps_get_assigned_and_emailed(w: World):
    """Fan-out ignores app status: a rejected app (S6) and a jury_review app (S5)
    receive reviewer assignments + an email telling the reviewer to review them."""
    w.create_batch()
    w.add_reviewers(["rev-1"])
    w.add_apps([("S5", "sip"), ("S6", "sip")])
    assigned = {a["application_id"] for a in w.assignments("rev-1")}
    assert "S6" not in assigned, "rejected app assigned to reviewer"
    assert "S5" not in assigned, "jury_review app assigned to reviewer"
    assert not w.emails, f"reviewer emailed about closed apps: {w.emails}"


def test_BUG_non_reviewer_user_ids_accepted_into_batch(w: World):
    """POST /batches/{id}/reviewers never checks the ids hold the reviewer role
    (bulk_assign_reviewer_apps does: 'not_a_reviewer'). A random/unknown/admin id
    becomes a batch member, gets assignments and an email attempt; in prod the
    auth.users FK makes an unknown id a 500 instead of a 4xx."""
    w.create_batch()
    w.add_apps([("S1", "sip")])
    r = w.add_reviewers(["ghost-user", ADMIN])
    assert r.status_code in (400, 404, 422), (r.status_code, r.text)
    assert not w.assignments("ghost-user")
    assert not w.assignments(ADMIN)


def test_BUG_orphan_assignment_when_app_removed_then_reviewer_removed(w: World):
    """Remove-app skips reviewers who submitted (keeps assignment). If the admin
    then removes the REVIEWER from the batch, apps_in_batch() no longer contains
    the app, so that assignment is never cleaned: reviewer stays assigned to an
    app that is in no batch of theirs, forever (remove_reviewer_from_batch
    iterates only current batch members' apps)."""
    w.create_batch()
    w.add_reviewers(["rev-1"])
    w.add_apps([("S1", "sip"), ("S3", "sip")])
    assert w.submit_review("rev-1", "S3").status_code == 201
    out = w.remove_apps([("S3", "sip")]).json()
    assert out["skipped_submitted"] == 0  # 2026-07-25: submitted reviews no longer protect
    assert w.remove_reviewer("rev-1").status_code == 200
    left = {a["application_id"] for a in w.assignments("rev-1")}
    assert left == set(), f"orphan assignments survive reviewer removal: {left}"


def test_BUG_remove_app_vs_remove_reviewer_inconsistent_for_submitted(w: World):
    """remove_reviewer_from_batch detaches even submitted-review assignments
    (2026-07-25) but remove_app_from_batch still protects them, so the same
    reviewer/app pair ends in different states depending on which side the
    admin removes."""
    w.create_batch()
    w.add_reviewers(["rev-1", "rev-2"])
    w.add_apps([("S3", "sip")])
    for rid in ("rev-1", "rev-2"):
        assert w.submit_review(rid, "S3").status_code == 201
    w.remove_reviewer("rev-1")           # reviewer side: assignment dropped
    w.remove_apps([("S3", "sip")])       # app side: assignment kept
    a1 = [a for a in w.assignments("rev-1") if a["application_id"] == "S3"]
    a2 = [a for a in w.assignments("rev-2") if a["application_id"] == "S3"]
    assert bool(a1) == bool(a2), (a1, a2)


def test_BUG_unknown_or_wrong_track_app_creates_dangling_rows(w: World):
    """add apps does not verify the app exists in that track's table: a typo / a
    TIR id sent as 'sip' returns 200, creates application_batches + a reviewer
    assignment (and sends an email) for a non-existent application."""
    w.create_batch()
    w.add_reviewers(["rev-1"])
    r = w.add_apps([("does-not-exist", "sip"), ("S1", "tir")])  # S1 is a SIP id
    assert r.status_code in (400, 404, 422), (r.status_code, r.text)
    assert not w.sb.tables["application_batches"]
    assert not w.assignments()


def test_BUG_rename_batch_accepts_blank_or_null_name(w: World):
    """BatchRename.name has no min_length (BatchCreate does) and explicit null is
    kept by exclude_unset -> UPDATE batches SET name=NULL (NOT NULL violation ->
    500 in prod) / blank-named batch."""
    bid = w.create_batch()
    for bad in ("", "   ", None):
        r = w.admin.patch(f"/admin/platform/batches/{bid}", json={"name": bad})
        assert r.status_code == 422, (bad, r.status_code, r.text)


def test_BUG_create_batch_blank_name_whitespace(w: World):
    r = w.admin.post("/admin/platform/batches", json={"name": "   "})
    assert r.status_code == 422, (r.status_code, r.text)


def test_BUG_assign_response_counts_already_present_apps(w: World):
    """Idempotent re-add reports assigned=N although 0 apps were new."""
    w.create_batch()
    w.add_apps([("S1", "sip"), ("S2", "sip")])
    again = w.add_apps([("S1", "sip"), ("S2", "sip")]).json()
    assert again["assigned"] == 0, again


def test_idempotent_readd_reviewer_and_apps_no_dupes_no_extra_mail(w: World):
    w.create_batch()
    w.add_apps([("S1", "sip"), ("S2", "sip")])
    w.add_reviewers(["rev-1"])
    n_mail = len(w.emails)
    w.add_reviewers(["rev-1", "rev-1"])
    w.add_apps([("S1", "sip")])
    assert len(w.emails) == n_mail
    keys = [(a["application_id"], a["reviewer_user_id"]) for a in w.assignments()]
    assert len(keys) == len(set(keys)) == 2
    assert len([m for m in w.sb.tables["batch_reviewers"]]) == 1


def test_multibatch_shared_reviewer_survives_removal_from_one(w: World):
    w.create_batch("A")
    a = w.batch_id
    b = w.create_batch("B")
    w.add_apps([("S1", "sip")], a)
    w.add_apps([("S1", "sip")], b)
    w.add_reviewers(["rev-1", "rev-2"], a)
    w.add_reviewers(["rev-1", "rev-3"], b)
    assert {x["reviewer_user_id"] for x in w.assignments()} == {"rev-1", "rev-2", "rev-3"}
    w.remove_apps([("S1", "sip")], b)
    assert {x["reviewer_user_id"] for x in w.assignments()} == {"rev-1", "rev-2"}
    # pipeline shows only batch A, reviewers_assigned == 2, no phantom batch
    row = w.pipeline()["S1"]
    assert [x["name"] for x in row["batches"]] == ["A"]
    assert row["reviewers_assigned"] == 2
    # rename A: pipeline + roster chips follow
    assert w.admin.patch(f"/admin/platform/batches/{a}", json={"name": "A2"}).status_code == 200
    assert w.pipeline()["S1"]["batch"] == "A2"
    assert [x["name"] for x in w.roster()["rev-1"]["batches"]] == ["A2"]


def test_BUG_delete_batch_leaves_assignments_and_members(w: World):
    """Deleting a batch unlinks apps but leaves every reviewer assignment (and, w/o
    FK cascade, batch_reviewers). After delete the apps stay 'under_review' in each
    reviewer's queue under 'Unbatched' with the batch gone; admin expects the
    batch's reviewer workload to go with it (or at least a warning)."""
    w.create_batch()
    w.add_reviewers(["rev-1"])
    w.add_apps([("S1", "sip"), ("S2", "sip")])
    assert w.admin.delete(f"/admin/platform/batches/{w.batch_id}").status_code == 200
    assert w.assignments("rev-1") == []


def test_PIN_moved_app_written_with_effective_track_vanishes_from_queue(w: World):
    """KNOWN: UI sends the effective track ('sip') for the moved TIR app. Rows are
    keyed ('sip', M1) but the app lives in tir_applications, so the reviewer's
    queue silently drops it while roster/drawer/pipeline count it."""
    w.create_batch()
    w.add_reviewers(["rev-1"])
    w.add_apps([("M1", "sip")])          # effective track, as the admin UI sends it
    assert any(a["application_id"] == "M1" for a in w.assignments("rev-1"))
    in_queue = [q for q in w.queue("rev-1") if q["id"] == "M1"]
    # FIXED (native-track resolution): the moved app is keyed ('tir', M1) and
    # therefore visible in the reviewer's queue.
    assert len(in_queue) == 1
    assert all(a["application_track"] == "tir" for a in w.assignments("rev-1")
               if a["application_id"] == "M1")


def test_moved_app_native_track_works_end_to_end(w: World):
    w.create_batch()
    w.add_reviewers(["rev-1"])
    w.add_apps([("M1", "tir")])
    q = {x["id"]: x for x in w.queue("rev-1")}
    assert "M1" in q and q["M1"]["movedToTrack"] == "sip"
    assert w.status("M1") == "under_review"
    assert w.pipeline()["M1"]["reviewers_assigned"] == 1
    assert w.submit_review("rev-1", "M1", "tir").status_code == 201
    assert w.status("M1") == "evaluated"


def test_PIN_evaluated_app_disappears_from_roster_but_not_queue(w: World):
    """KNOWN: first review flips the app to 'evaluated'; reviewers 2/3's unreviewed
    assignments then vanish from roster + drawer but stay in their queues and the
    pipeline still counts them."""
    w.create_batch()
    w.add_reviewers(REVIEWERS)
    w.add_apps([("S1", "sip")])
    assert w.submit_review("rev-1", "S1").status_code == 201
    assert w.status("S1") == "evaluated"
    for rid in ("rev-2", "rev-3"):
        assert any(q["id"] == "S1" for q in w.queue(rid))
        assert w.roster()[rid]["assigned"] == 0          # known bug
        assert w.drawer(rid) == []                       # known bug
    assert w.pipeline()["S1"]["reviewers_assigned"] == 3


def test_PIN_known_roster_ignores_prior_evaluated_apps(w: World):
    w.create_batch()
    w.add_reviewers(["rev-1"])
    w.add_apps([("S4", "sip")])          # already 'evaluated'
    assert any(q["id"] == "S4" for q in w.queue("rev-1"))
    assert w.roster()["rev-1"]["assigned"] == 0


def test_audit_trail_for_batch_lifecycle(w: World):
    w.create_batch()
    w.add_apps([("S1", "sip")])
    w.add_reviewers(["rev-1"])
    w.submit_review("rev-1", "S1")
    w.remove_reviewer("rev-1")
    w.remove_apps([("S1", "sip")])
    w.admin.patch(f"/admin/platform/batches/{w.batch_id}", json={"name": "N"})
    w.admin.delete(f"/admin/platform/batches/{w.batch_id}")
    actions = [a["action_type"] for a in w.sb.tables["audit_log_v2"]]
    for expected in ("batch_created", "batch_applications_assigned", "batch_reviewers_assigned",
                     "submit_review", "batch_reviewers_unassigned",
                     "batch_applications_removed", "batch_updated", "batch_deleted"):
        assert expected in actions, (expected, actions)


def test_BUG_audit_gap_auto_status_and_fanout_not_attributed(w: World):
    """The batch-level audit rows only carry counts: they do not record WHICH
    reviewers / apps were assigned or removed, and the submitted->under_review
    flip is logged with changed_by=None. An admin cannot reconstruct who lost
    which assignment from audit_log_v2."""
    w.create_batch()
    w.add_apps([("S1", "sip")])
    w.add_reviewers(["rev-1"])
    w.remove_reviewer("rev-1")
    rows = [a for a in w.sb.tables["audit_log_v2"]
            if a["action_type"] in ("batch_reviewers_assigned", "batch_reviewers_unassigned")]
    blob = repr(rows)
    assert "rev-1" in repr([a for a in rows if a["action_type"] == "batch_reviewers_assigned"]), \
        "assign audit lacks reviewer ids"
    assert "S1" in blob, "audit lacks affected application ids"
    log = [l for l in w.sb.tables["application_status_log"] if l["application_id"] == "S1"]
    assert log and log[0]["changed_by"] is not None, "auto status change has no actor"


def test_BUG_draft_app_can_be_batched_and_shows_in_reviewer_queue(w: World):
    """The pipeline hides drafts, but POST /batches/{id}/applications accepts any
    id; a draft application is assigned + shows in the reviewer queue."""
    w.sb.tables["sip_applications"].append(_sip("D1", "draft", 9))
    w.create_batch()
    w.add_reviewers(["rev-1"])
    r = w.add_apps([("D1", "sip")])
    in_q = [q for q in w.queue("rev-1") if q["id"] == "D1"]
    assert not in_q and r.status_code != 200, "draft application reachable by reviewer"


def test_second_and_third_reviewers_can_still_submit_after_evaluated(w: World):
    w.create_batch()
    w.add_reviewers(REVIEWERS)
    w.add_apps([("S1", "sip")])
    for rid in REVIEWERS:
        assert w.submit_review(rid, "S1").status_code == 201
    row = w.pipeline()["S1"]
    assert row["reviews_submitted"] == 3 and row["reviewers_assigned"] == 3
    assert row["reviewers_detached"] == 0
    assert w.status("S1") == "evaluated"
    # removing one reviewer keeps their review and flags it detached in the pipeline
    w.remove_reviewer("rev-3")
    row = w.pipeline()["S1"]
    assert row["reviews_submitted"] == 3 and row["reviewers_detached"] == 1
    assert [q for q in w.queue("rev-3") if q["id"] == "S1"][0]["detached"] is True
