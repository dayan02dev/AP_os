"""Task 8 — admin jury backend: roster v2, juror apps, PATCH, pipeline pick
metrics, and the ``recommended_for`` pipeline filter.

Self-contained fake-Supabase scaffolding in the style of test_admin_platform:
the fake honours ``.eq()`` on SELECT and no-ops ``.in_()`` (bulk callers
re-filter in Python), and records inserts/upserts so the PATCH endpoint's
jury_profiles upsert is inspectable. Capabilities are granted by overriding
``get_current_user`` (NOT require_capability) — admin holds both
``manage_jury_roster`` and ``view_all_apps``.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.deps import get_current_user
from app.main import app


# ─── Fake Supabase admin client (eq honoured, in_ no-op) ────────────────


class _FakeQuery:
    def __init__(self, parent, name: str):
        self._parent = parent
        self._name = name
        self._mode = "select"
        self._payload: Any = None
        self._eqs: list[tuple[str, Any]] = []

    def select(self, *_a, **_k):  return self
    def order(self, *_a, **_k):   return self
    def limit(self, *_a, **_k):   return self
    def in_(self, *_a, **_k):     return self
    def or_(self, *_a, **_k):     return self
    def range(self, *_a, **_k):   return self
    def neq(self, *_a, **_k):     return self
    def ilike(self, *_a, **_k):   return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            self._parent.inserts.append((self._name, row))
        return self

    def upsert(self, payload, on_conflict=None, ignore_duplicates=False, **_k):
        self._mode = "insert"
        self._payload = payload
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            self._parent.inserts.append((self._name, row))
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        self._parent.updates.append((self._name, payload, list(self._eqs)))
        return self

    def delete(self):
        self._mode = "delete"
        self._parent.deletes.append((self._name, list(self._eqs)))
        return self

    def execute(self):
        if self._mode == "delete":
            table = self._parent.tables.setdefault(self._name, [])
            removed = [r for r in table if all(r.get(c) == v for c, v in self._eqs)]
            self._parent.tables[self._name] = [r for r in table if r not in removed]
            return SimpleNamespace(data=removed, count=len(removed))
        if self._mode in ("insert", "update"):
            data = self._payload if isinstance(self._payload, list) else (
                [self._payload] if self._payload else [{"ok": True}]
            )
            return SimpleNamespace(data=data, count=len(data))
        rows = self._parent.tables.get(self._name, [])
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        return SimpleNamespace(data=rows, count=len(rows))


class _FakeAdminClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables = tables or {}
        self.inserts: list[tuple[str, Any]] = []
        self.updates: list[tuple[str, Any, list]] = []
        self.deletes: list[tuple[str, list]] = []

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


def _override_user(user_id: str, roles: list[str] | None = None):
    def _f():
        return {
            "user_id": user_id,
            "email": f"{user_id}@x.com",
            "roles": roles or ["admin"],
        }
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _install_db(monkeypatch, tables):
    from app.routers import admin_platform as ap
    from app.services import admin_query, applications_query, audit, stats
    fake = _FakeAdminClient(tables=tables)
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(audit, "get_admin_client", lambda: fake, raising=False)
    monkeypatch.setattr(ap, "get_admin_client", lambda: fake, raising=False)
    monkeypatch.setattr(stats, "get_admin_client", lambda: fake, raising=False)
    return fake


def _base_tables() -> dict[str, list[dict]]:
    return {
        "tir_applications": [],
        "sip_applications": [],
        "ai_screening": [],
        "admin_decisions": [],
        "application_admin_meta": [],
        "application_batches": [],
        "batches": [],
        "industry_categories": [],
        "reviews": [],
        "reviewer_assignments": [],
        "reviewer_profiles": [],
        "application_status_log": [],
        "user_roles": [],
        "profiles": [],
        "jury_profiles": [],
        "jury_assignments": [],
        "jury_selections": [],
        "jury_invites": [],
        "jury_recommendations": [],
    }


J1 = "aaaaaaaa-0000-0000-0000-000000000001"
J2 = "aaaaaaaa-0000-0000-0000-000000000002"
R1 = "bbbbbbbb-0000-0000-0000-000000000001"
A1 = "11111111-1111-1111-1111-111111111111"
A2 = "22222222-2222-2222-2222-222222222222"
A3 = "33333333-3333-3333-3333-333333333333"
A4 = "44444444-4444-4444-4444-444444444444"


# ─── Router smoke ───────────────────────────────────────────────────────


def test_jurors_route_registered(client):
    r = client.get("/admin/platform/jurors")
    assert r.status_code in (401, 403), f"got {r.status_code}; route may not be registered"


# ─── GET /admin/platform/jurors — roster v2 ─────────────────────────────


def test_roster_lists_only_jury_role_with_row_shape(client, monkeypatch, _clear_overrides):
    tables = _base_tables()
    tables["user_roles"] = [
        {"user_id": J1, "role": "jury"},
        {"user_id": J2, "role": "jury"},
        {"user_id": R1, "role": "reviewer"},  # must NOT appear
    ]
    tables["profiles"] = [
        {"id": J1, "full_name": "Dr J One", "email": "j1@x.com"},
        {"id": J2, "full_name": "Dr J Two", "email": "j2@x.com"},
    ]
    tables["jury_profiles"] = [
        {"juror_user_id": J1, "invite_id": "inv1", "weight": 2.0,
         "expertise_domains": ["Robotics"], "linkedin_url": "https://linkedin.com/in/j1",
         "enrichment_status": "done", "matched_at": "2026-07-05T00:00:00Z"},
    ]
    tables["jury_assignments"] = [
        {"id": "ja1", "juror_user_id": J1, "application_id": A1, "application_track": "tir"},
        {"id": "ja2", "juror_user_id": J1, "application_id": A2, "application_track": "tir"},
    ]
    tables["jury_selections"] = [
        {"id": "js1", "juror_user_id": J1, "application_id": A1, "application_track": "tir",
         "note": "great", "submitted_at": "2026-07-06T10:00:00Z"},
    ]
    tables["jury_invites"] = [
        {"id": "inv1", "name": "Dr J One", "email": "j1@x.com", "status": "accepted",
         "sent_at": "2026-07-01T00:00:00Z"},
        {"id": "inv2", "name": "Pending Person", "email": "pending@x.com", "status": "invited",
         "sent_at": "2026-07-02T00:00:00Z"},
        {"id": "inv3", "name": "Declined Person", "email": "declined@x.com", "status": "declined",
         "sent_at": "2026-07-02T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.get("/admin/platform/jurors")
    assert r.status_code == 200, r.text
    body = r.json()

    ids = {j["user_id"] for j in body["jurors"]}
    assert ids == {J1, J2}  # reviewer excluded

    j1 = next(j for j in body["jurors"] if j["user_id"] == J1)
    assert j1["name"] == "Dr J One"
    assert j1["email"] == "j1@x.com"
    assert j1["weight"] == 2.0
    assert j1["domains"] == ["Robotics"]
    assert j1["linkedin_url"] == "https://linkedin.com/in/j1"
    assert j1["enrichmentStatus"] == "done"
    assert j1["matchedAt"] == "2026-07-05T00:00:00Z"
    assert j1["assigned"] == 2
    assert j1["picks"] == "1 / 3"
    assert j1["picksSubmitted"] == 1
    assert j1["lastActivity"] == "2026-07-06T10:00:00Z"
    assert j1["invite"] == {"status": "accepted"}

    # A juror with no jury_profiles row still renders with defaults.
    j2 = next(j for j in body["jurors"] if j["user_id"] == J2)
    assert j2["weight"] == 1.0
    assert j2["domains"] == []
    assert j2["enrichmentStatus"] == "pending"
    assert j2["assigned"] == 0
    assert j2["picks"] == "0 / 3"
    assert j2["invite"] is None

    # pending_invites: invited-not-answered only; declined + accepted excluded.
    pending = body["pending_invites"]
    assert [p["email"] for p in pending] == ["pending@x.com"]
    assert pending[0]["name"] == "Pending Person"
    assert pending[0]["sent_at"] == "2026-07-02T00:00:00Z"


def test_roster_empty_when_no_jurors(client, monkeypatch, _clear_overrides):
    tables = _base_tables()
    tables["jury_invites"] = [
        {"id": "inv2", "name": "P", "email": "p@x.com", "status": "invited", "sent_at": None},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/jurors")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["jurors"] == []
    # Pending invites still surface even with zero accepted jurors.
    assert [p["email"] for p in body["pending_invites"]] == ["p@x.com"]


# ─── GET /admin/platform/jurors/{uid}/applications ──────────────────────


def test_juror_applications_with_picked_flags(client, monkeypatch, _clear_overrides):
    tables = _base_tables()
    tables["user_roles"] = [{"user_id": J1, "role": "jury"}]
    tables["tir_applications"] = [
        {"id": A1, "status": "jury_review", "display_seq": 26001,
         "basic_full_name": "Asha", "basic_org": "Karkhana",
         "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": A2, "status": "jury_review", "display_seq": 26002,
         "basic_full_name": "Bala", "basic_org": "Bytes",
         "submitted_at": "2026-06-02T00:00:00Z"},
    ]
    tables["jury_assignments"] = [
        {"id": "ja1", "juror_user_id": J1, "application_id": A1, "application_track": "tir"},
        {"id": "ja2", "juror_user_id": J1, "application_id": A2, "application_track": "tir"},
    ]
    tables["jury_selections"] = [
        {"id": "js1", "juror_user_id": J1, "application_id": A1, "application_track": "tir",
         "note": "pick", "submitted_at": "2026-07-06T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.get(f"/admin/platform/jurors/{J1}/applications")
    assert r.status_code == 200, r.text
    apps = {a["id"]: a for a in r.json()["applications"]}
    assert set(apps) == {A1, A2}
    assert apps[A1]["picked"] is True
    assert apps[A2]["picked"] is False
    assert apps[A1]["track"] == "tir"
    assert apps[A1]["status"] == "jury_review"
    assert "assignment_id" in apps[A1]


def test_juror_applications_renders_batched_row(client, monkeypatch, _clear_overrides):
    """A sparse TIR application that HAS a batch link must render FULLY — the
    batch name populated, not a degraded-blank row. `_fetch_batches` returns a
    LIST per (track, id) after the multi-batch migration, so the per-row build
    must use the list accessor; the older `.get("name")`-on-a-list would throw
    and blank the whole row."""
    tables = _base_tables()
    tables["jury_assignments"] = [{
        "id": "ja1", "juror_user_id": "adm-juror",
        "application_id": "bad1", "application_track": "tir",
        "assigned_at": "2026-07-01T00:00:00Z",
    }]
    tables["tir_applications"] = [{"id": "bad1"}]  # deliberately sparse
    tables["jury_selections"] = []
    tables["application_batches"] = [
        {"application_id": "bad1", "application_track": "tir", "batch_id": "b1"},
    ]
    tables["batches"] = [{"id": "b1", "name": "Batch One"}]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.get("/admin/platform/jurors/adm-juror/applications")
    assert r.status_code == 200, r.text
    apps = r.json()["applications"]
    assert len(apps) == 1
    assert apps[0]["id"] == "bad1"
    assert apps[0]["track"] == "tir"
    assert apps[0]["picked"] is False
    # The row renders FULLY: the batch name is populated (not degraded-blank).
    assert apps[0]["batch"] == "Batch One"


# ─── PATCH /admin/platform/jurors/{uid} ─────────────────────────────────


def test_patch_juror_upserts_weight_and_domains(client, monkeypatch, _clear_overrides):
    tables = _base_tables()
    tables["user_roles"] = [{"user_id": J1, "role": "jury"}]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.patch(f"/admin/platform/jurors/{J1}",
                     json={"weight": 3.0, "expertise_domains": ["ML", "Robotics"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["weight"] == 3.0
    assert body["expertise_domains"] == ["ML", "Robotics"]

    upserts = [row for (tbl, row) in fake.inserts if tbl == "jury_profiles"]
    assert upserts and upserts[0]["juror_user_id"] == J1
    assert upserts[0]["weight"] == 3.0
    assert upserts[0]["expertise_domains"] == ["ML", "Robotics"]


def test_patch_juror_no_fields_422(client, monkeypatch, _clear_overrides):
    tables = _base_tables()
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.patch(f"/admin/platform/jurors/{J1}", json={})
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "no_fields"


def test_patch_juror_rejects_batch_id(client, monkeypatch, _clear_overrides):
    # v2 jury_profiles has no batch_id column — the model forbids it.
    tables = _base_tables()
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.patch(f"/admin/platform/jurors/{J1}", json={"batch_id": "b1"})
    assert r.status_code == 422, r.text


# ─── Pipeline jury metric fields ────────────────────────────────────────


def test_pipeline_rows_carry_jury_metrics(client, monkeypatch, _clear_overrides):
    tables = _base_tables()
    tables["user_roles"] = [{"user_id": J1, "role": "jury"}]
    tables["profiles"] = [{"id": J1, "full_name": "Dr J One", "email": "j1@x.com"}]
    tables["tir_applications"] = [
        {"id": A1, "status": "jury_review", "display_seq": 26001,
         "basic_full_name": "Asha", "basic_org": "Karkhana",
         "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": A2, "status": "jury_review", "display_seq": 26002,
         "basic_full_name": "Bala", "basic_org": "Bytes",
         "submitted_at": "2026-06-02T00:00:00Z"},
        {"id": A3, "status": "jury_review", "display_seq": 26003,
         "basic_full_name": "Chn", "basic_org": "Cygnus",
         "submitted_at": "2026-06-03T00:00:00Z"},
        {"id": A4, "status": "jury_review", "display_seq": 26004,
         "basic_full_name": "Dee", "basic_org": "Delta",
         "submitted_at": "2026-06-04T00:00:00Z"},
    ]
    # J1 assigned + picks A1,A2,A3 (a full 3-set → picks_ready true for those).
    tables["jury_assignments"] = [
        {"id": "ja1", "juror_user_id": J1, "application_id": A1, "application_track": "tir"},
        {"id": "ja2", "juror_user_id": J1, "application_id": A2, "application_track": "tir"},
        {"id": "ja3", "juror_user_id": J1, "application_id": A3, "application_track": "tir"},
        # A4 assigned to J2 who has 0 picks → picks_ready false.
        {"id": "ja4", "juror_user_id": J2, "application_id": A4, "application_track": "tir"},
    ]
    tables["jury_selections"] = [
        {"id": "js1", "juror_user_id": J1, "application_id": A1, "application_track": "tir",
         "note": "the best", "submitted_at": "2026-07-06T00:00:00Z"},
        {"id": "js2", "juror_user_id": J1, "application_id": A2, "application_track": "tir",
         "note": None, "submitted_at": "2026-07-06T00:00:00Z"},
        {"id": "js3", "juror_user_id": J1, "application_id": A3, "application_track": "tir",
         "note": None, "submitted_at": "2026-07-06T00:00:00Z"},
    ]
    tables["admin_decisions"] = [
        {"application_id": A1, "application_track": "tir", "gate_stage": "gate2",
         "decision": "offered", "decided_at": "2026-07-08T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    items = {i["id"]: i for i in r.json()["applications"]}

    a1 = items[A1]
    assert a1["jury_assigned"] == 1
    assert a1["jury_assigned_names"] == ["Dr J One"]
    assert a1["picked_by"] == [
        {"juror_user_id": J1, "name": "Dr J One", "note": "the best"}]
    assert a1["picks_ready"] is True
    assert a1["gate2_decision"] == "offered"

    # A4 — assigned to a juror with no full pick-set → not ready, no picks.
    a4 = items[A4]
    assert a4["jury_assigned"] == 1
    assert a4["picked_by"] == []
    assert a4["picks_ready"] is False
    assert a4["gate2_decision"] is None


def test_pipeline_default_behaviour_unchanged_without_jury_data(
    client, monkeypatch, _clear_overrides
):
    # No jury tables populated: rows still return, metrics default to zero.
    tables = _base_tables()
    tables["tir_applications"] = [
        {"id": A1, "status": "under_review", "display_seq": 26001,
         "basic_full_name": "Asha", "basic_org": "Karkhana",
         "submitted_at": "2026-06-01T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    item = r.json()["applications"][0]
    assert item["jury_assigned"] == 0
    assert item["picked_by"] == []
    assert item["picks_ready"] is False
    assert "recommendation" not in item  # only present when recommended_for set


# ─── recommended_for filter ─────────────────────────────────────────────


def test_pipeline_recommended_for_filters_and_attaches(client, monkeypatch, _clear_overrides):
    tables = _base_tables()
    tables["user_roles"] = [{"user_id": J1, "role": "jury"}]
    tables["tir_applications"] = [
        {"id": A1, "status": "jury_review", "display_seq": 26001,
         "basic_full_name": "Asha", "basic_org": "Karkhana",
         "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": A2, "status": "jury_review", "display_seq": 26002,
         "basic_full_name": "Bala", "basic_org": "Bytes",
         "submitted_at": "2026-06-02T00:00:00Z"},
        {"id": A3, "status": "jury_review", "display_seq": 26003,
         "basic_full_name": "Chn", "basic_org": "Cygnus",
         "submitted_at": "2026-06-03T00:00:00Z"},
    ]
    tables["jury_recommendations"] = [
        {"id": "rc1", "juror_user_id": J1, "application_id": A1, "application_track": "tir",
         "score": 75.0, "reason": "solid"},
        {"id": "rc2", "juror_user_id": J1, "application_id": A2, "application_track": "tir",
         "score": 90.0, "reason": "great fit"},
        # A3 recommended for a DIFFERENT juror — must not appear.
        {"id": "rc3", "juror_user_id": J2, "application_id": A3, "application_track": "tir",
         "score": 99.0, "reason": "other juror"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.get(f"/admin/platform/applications?recommended_for={J1}")
    assert r.status_code == 200, r.text
    items = r.json()["applications"]
    # Only J1's recommendations, sorted by score desc (A2=90 then A1=75).
    assert [i["id"] for i in items] == [A2, A1]
    assert items[0]["recommendation"] == {"score": 90.0, "reason": "great fit"}
    assert items[1]["recommendation"] == {"score": 75.0, "reason": "solid"}


def test_pipeline_recommended_for_unset_returns_all(client, monkeypatch, _clear_overrides):
    tables = _base_tables()
    tables["tir_applications"] = [
        {"id": A1, "status": "jury_review", "display_seq": 26001,
         "basic_full_name": "Asha", "basic_org": "Karkhana",
         "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": A2, "status": "jury_review", "display_seq": 26002,
         "basic_full_name": "Bala", "basic_org": "Bytes",
         "submitted_at": "2026-06-02T00:00:00Z"},
    ]
    tables["jury_recommendations"] = [
        {"id": "rc1", "juror_user_id": J1, "application_id": A1, "application_track": "tir",
         "score": 75.0, "reason": "solid"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    ids = {i["id"] for i in r.json()["applications"]}
    assert ids == {A1, A2}  # unfiltered


def test_picks_ready_counts_full_pick_set_under_filtered_pipeline(monkeypatch):
    """`picks_ready` must reflect a juror's FULL 3-set even when the pipeline
    query is narrowed to a subset of their picked apps. Uses the shared
    FakeSupabase (which HONOURS .in_, unlike this file's local fake) so the
    juror-scoped pick read is actually exercised: the old app-scoped read would
    see only 1 of jX's 3 picks for the single-app `pairs` and wrongly report
    picks_ready=False."""
    from app.services import admin_query
    from tests.fixtures.fake_supabase import FakeSupabase

    fake = FakeSupabase({
        "jury_assignments": [
            {"juror_user_id": "jX", "application_id": "aX1", "application_track": "tir"},
            {"juror_user_id": "jX", "application_id": "aX2", "application_track": "tir"},
            {"juror_user_id": "jX", "application_id": "aX3", "application_track": "tir"},
        ],
        "jury_selections": [
            {"juror_user_id": "jX", "application_id": "aX1", "application_track": "tir", "note": "a"},
            {"juror_user_id": "jX", "application_id": "aX2", "application_track": "tir", "note": None},
            {"juror_user_id": "jX", "application_id": "aX3", "application_track": "tir", "note": None},
        ],
        "profiles": [{"id": "jX", "full_name": "JX", "email": "jx@x.com"}],
        "admin_decisions": [],
    })
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: fake)

    # Pipeline narrowed to only aX1 (simulating a filtered query).
    metrics = admin_query._fetch_jury_v2_metrics([("tir", "aX1")])
    row = metrics[("tir", "aX1")]
    assert row["jury_assigned"] == 1
    assert row["picked_by"] == [{"juror_user_id": "jX", "name": "JX", "note": "a"}]
    assert row["picks_ready"] is True  # full 3-set counted juror-scoped
