"""Assignment-flow test world: a PostgREST-like FakeSupabase + a TestClient.

Differences from fake_supabase.FakeSupabase (on purpose, to mimic prod):
  * SELECT without .range() is capped at MAX_ROWS (PostgREST max_rows=1000).
  * .order(col) sorts; .range(a, b) slices.
  * INSERT honours UNIQUE keys (raises a 23505-style error) for the tables
    whose prod schema has a unique constraint.
"""
from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from tests.fixtures.fake_supabase import FakeSupabase, _Query

MAX_ROWS = 1000

UNIQUE = {
    "reviewer_assignments": ("application_id", "application_track", "reviewer_user_id"),
    "reviews": ("application_id", "application_track", "reviewer_user_id"),
    "application_batches": ("application_id", "application_track", "batch_id"),
    "batch_reviewers": ("batch_id", "reviewer_user_id"),
}


class UniqueViolation(Exception):
    code = "23505"


class PgQuery(_Query):
    def __init__(self, store, name, stats):
        super().__init__(store, name)
        self._order_col = None
        self._range = None
        self._stats = stats

    def order(self, col, *_a, **_k):
        self._order_col = col
        return self

    def range(self, a, b):
        self._range = (a, b)
        return self

    def execute(self):
        if self._mode == "insert":
            keys = UNIQUE.get(self._name)
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            if keys:
                seen = {tuple(r.get(k) for k in keys) for r in self._rows}
                for p in payloads:
                    t = tuple(p.get(k) for k in keys)
                    if t in seen:
                        self._stats["unique_violations"] += 1
                        raise UniqueViolation(
                            f'duplicate key value violates unique constraint ({self._name}) {t}')
                    seen.add(t)
            return super().execute()
        if self._mode != "select":
            return super().execute()
        data = [r for r in self._rows if self._match(r)]
        if self._order_col:
            data = sorted(data, key=lambda r: str(r.get(self._order_col) or ""))
        if self._range is not None:
            a, b = self._range
            data = data[a : min(b + 1, a + MAX_ROWS)]
        else:
            if len(data) > MAX_ROWS:
                self._stats["truncated_reads"].append(self._name)
            data = data[:MAX_ROWS]
        if self._limit is not None:
            data = data[: self._limit]
        return self._result(data)


class PgFake(FakeSupabase):
    def __init__(self, tables=None):
        super().__init__(tables)
        self.stats = {"unique_violations": 0, "truncated_reads": []}
        self.storage = SimpleNamespace(from_=lambda *_a, **_k: SimpleNamespace(
            create_signed_url=lambda *_a, **_k: {"signedURL": None}))

    def table(self, name):
        return PgQuery(self.tables, name, self.stats)

    # helpers
    def asg(self, rid, aid=None, track=None):
        return [a for a in self.tables.get("reviewer_assignments", [])
                if a["reviewer_user_id"] == rid
                and (aid is None or a["application_id"] == aid)
                and (track is None or a["application_track"] == track)]


R1, R2, R3 = "rev-1", "rev-2", "rev-3"
ADMIN, LEAD = "admin-1", "lead-1"
SUB = "2026-10-20T00:00:00Z"


def app_row(aid, status="under_review", seq=1, moved=None):
    return {"id": aid, "status": status, "display_seq": seq, "basic_org": f"Org {aid}",
            "basic_full_name": f"Founder {aid}", "basic_email": f"{aid}@f.io",
            "moved_to_track": moved, "submitted_at": "2026-07-01T00:00:00Z"}


def asg_row(rid, aid, track="sip", **kw):
    r = {"id": f"as-{rid}-{aid}-{track}", "application_id": aid, "application_track": track,
         "reviewer_user_id": rid, "declined_at": None, "reassigned_to": None,
         "assigned_at": "2026-10-01T00:00:00Z", "due_at": None, "state": "pending"}
    r.update(kw)
    return r


def review_row(rid, aid, track="sip", submitted=True, **kw):
    r = {"id": f"rv-{rid}-{aid}-{track}", "application_id": aid, "application_track": track,
         "reviewer_user_id": rid, "assignment_id": f"as-{rid}-{aid}-{track}",
         "submitted_at": SUB if submitted else None, "locked_at": None,
         "recommendation": "yes" if submitted else None,
         "score_problem": 7, "score_solution": 7, "score_tech": 7, "score_founders": 7,
         "quick_notes": "draft notes" if not submitted else "notes", "flags": []}
    r.update(kw)
    return r


def seed(**extra):
    base = {
        "user_roles": [{"user_id": u, "role": "reviewer"} for u in (R1, R2, R3)]
        + [{"user_id": ADMIN, "role": "admin"}, {"user_id": LEAD, "role": "leadership"}],
        "profiles": [{"id": u, "full_name": u, "email": f"{u}@x.io"}
                     for u in (R1, R2, R3, ADMIN, LEAD)],
        "reviewer_profiles": [{"reviewer_user_id": u, "weight": 1.0} for u in (R1, R2, R3)],
        "batches": [{"id": "bA", "name": "Climate"}, {"id": "bB", "name": "Defense"}],
        "batch_reviewers": [],
        "application_batches": [],
        "reviewer_assignments": [],
        "reviews": [],
        "sip_applications": [app_row("V1", seq=1), app_row("V2", seq=2), app_row("V3", seq=3)],
        "tir_applications": [app_row("T1", seq=10)],
        "ai_screening": [],
        "industry_categories": [],
        "admin_decisions": [],
        "ic_documents": [],
        "application_status_log": [],
        "audit_log_v2": [],
        "gate2_decisions": [],
    }
    base.update(extra)
    return PgFake(base)


def batch_with(sb, batch_id, apps, reviewers, track="sip", assign=True):
    for aid in apps:
        sb.tables["application_batches"].append(
            {"id": f"ab-{batch_id}-{aid}", "application_id": aid,
             "application_track": track, "batch_id": batch_id})
        if assign:
            for rid in reviewers:
                sb.tables["reviewer_assignments"].append(asg_row(rid, aid, track))
    for rid in reviewers:
        sb.tables["batch_reviewers"].append({"batch_id": batch_id, "reviewer_user_id": rid})


class World:
    """One fake DB + a TestClient whose caller identity can be switched."""

    def __init__(self, sb, client, app):
        self.sb = sb
        self.client = client
        self._app = app
        self.emails: list = []

    def as_user(self, uid, roles):
        from app.deps import get_current_user
        self._app.dependency_overrides[get_current_user] = lambda: {
            "user_id": uid, "email": f"{uid}@x.io", "roles": roles}
        return self

    def admin(self):
        return self.as_user(ADMIN, ["admin"])

    def lead(self):
        return self.as_user(LEAD, ["leadership"])

    def reviewer(self, rid):
        return self.as_user(rid, ["reviewer"])

    # reviewer views
    def queue(self, rid):
        self.reviewer(rid)
        r = self.client.get("/reviewer/queue")
        assert r.status_code == 200, r.text
        return r.json()

    def queue_by_id(self, rid):
        return {row["id"]: row for row in self.queue(rid)}

    def default_view(self, rid):
        """Rows the reviewer FE shows by default: neither closed nor detached."""
        return {r["id"]: r for r in self.queue(rid) if not r["closed"] and not r["detached"]}

    def roster(self, rid):
        self.admin()
        r = self.client.get("/admin/platform/reviewers")
        assert r.status_code == 200, r.text
        return {x["user_id"]: x for x in r.json()["reviewers"]}[rid]

    def drawer(self, rid):
        self.admin()
        r = self.client.get(f"/admin/platform/reviewers/{rid}/applications")
        assert r.status_code == 200, r.text
        return {x["id"]: x for x in r.json()["applications"]}


def install(monkeypatch, sb) -> World:
    from app.main import app
    from app.services import staff_exclusions

    monkeypatch.setattr(staff_exclusions, "is_excluded", lambda *_a, **_k: False)
    monkeypatch.setattr(staff_exclusions, "visible", lambda rows, key="id": list(rows or []))
    for name, mod in list(sys.modules.items()):
        if name.startswith("app.") and mod is not None and hasattr(mod, "get_admin_client"):
            monkeypatch.setattr(mod, "get_admin_client", lambda: sb, raising=False)
    emails: list = []

    def _notify(_sb, rows, **_k):
        emails.extend(rows)
        return len({r["reviewer_user_id"] for r in rows})

    for name in ("app.routers.admin_platform", "app.routers.leadership_actions",
                 "app.services.assignment_email"):
        mod = sys.modules.get(name)
        if mod is not None and hasattr(mod, "notify_reviewers_assigned"):
            monkeypatch.setattr(mod, "notify_reviewers_assigned", _notify)
    dmod = sys.modules.get("app.services.decision_email")
    if dmod is not None:
        monkeypatch.setattr(dmod, "notify_applicant_decided", lambda *a, **k: None, raising=False)
    tmod = sys.modules.get("app.services.track_move")
    if tmod is not None:
        monkeypatch.setattr(tmod, "notify_applicant_moved", lambda *a, **k: None)
    if hasattr(app.state, "limiter"):
        app.state.limiter.reset()
    w = World(sb, TestClient(app), app)
    w.emails = emails
    return w


@pytest.fixture
def world(monkeypatch):
    from app.main import app

    holder = {}

    def _make(sb):
        holder["w"] = install(monkeypatch, sb)
        return holder["w"]

    yield _make
    app.dependency_overrides.clear()
