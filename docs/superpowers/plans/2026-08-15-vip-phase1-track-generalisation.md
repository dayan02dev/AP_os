# VIP Onboarding — Phase 1: Track Generalisation & Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Founder Portal serve VIP (`sip`) founders as well as TIR ones, so a VIP founder signs in and gets the Current tab, Sign MOU and all five Founders Resources pages working, with a Cohort-management group showing two new (empty) items.

**Architecture:** The portal is not forked. `require_founder_access` becomes track-resolving (TIR table first, then SIP) and puts `track` into the request context; `GET /founder/me` returns it; the sidebar picks its cohort group from it. The five tables genuinely shared between tracks (`founder_mou` + the four Founders-Resources tables) gain a `track` column and lose their hard FK to `tir_applications`, because Postgres has no polymorphic foreign key. The eight TIR-only cohort tables are not touched.

**Tech Stack:** FastAPI + Supabase (service-role client, RLS-denied to everyone else), pytest with the `FakeSupabase` test double, React 18 + react-router 6, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-15-vip-onboarding-design.md` (§3, §8 D6/D7)

## Global Constraints

- Branch `feat/vip-onboarding`, worktree `.claude/worktrees/vip-onboarding`, based on `release/sip-launch-v1` @ `a8f470e`. Work only in this worktree — concurrent sessions cross-contaminate otherwise.
- DB track code is **`sip`**; user-facing label is always **"VIP"**. Never show `sip` in UI copy.
- Migrations are numbered files under `backend/migrations/`. 040-042 exist; this phase adds **043**. Wrap DDL in `begin; … commit;`.
- Prod DDL is Studio-only — never attempt `psql`/Supabase CLI. Migration files are pasted by a human.
- Run single test files with `--no-cov` (coverage gate fails on partial runs).
- There is a **known baseline of ~20-22 pre-existing backend failures and ~2 frontend failures** on this release branch. Before blaming your change, re-run the same test on untouched `release/sip-launch-v1`.
- Commit messages: no `Co-Authored-By` and no Claude/Anthropic/AI reference.
- Backend commands run from `.claude/worktrees/vip-onboarding/backend`; python is `/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python`.
- Frontend commands run from `.claude/worktrees/vip-onboarding/frontend`.

---

### Task 1: Migration 043 — `track` column on the five shared tables

**Files:**
- Create: `backend/migrations/043_vip_track_generalisation.sql`
- Test: `backend/tests/test_vip_migration.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the `track` column that Tasks 4 and 5 filter on. Column contract: `track text not null default 'tir' check (track in ('tir','sip'))` on `founder_mou`, `founder_cart_items`, `founder_resource_requests`, `founder_bookings`, `founder_tickets`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_vip_migration.py`:

```python
"""043 must make every genuinely-shared founder table track-aware.

Guard test: if someone later adds a sixth table shared between TIR and VIP
they must add it here too, or a VIP founder silently reads TIR rows.
"""
from pathlib import Path

SHARED_TABLES = [
    "founder_mou",
    "founder_cart_items",
    "founder_resource_requests",
    "founder_bookings",
    "founder_tickets",
]


def _sql() -> str:
    return Path("migrations/043_vip_track_generalisation.sql").read_text().lower()


def test_every_shared_table_gains_a_track_column():
    sql = _sql()
    for table in SHARED_TABLES:
        assert f"alter table public.{table}" in sql, table
    assert sql.count("add column if not exists track text") == len(SHARED_TABLES)


def test_track_is_constrained_and_defaults_to_tir():
    sql = _sql()
    assert sql.count("default 'tir'") == len(SHARED_TABLES)
    assert sql.count("check (track in ('tir','sip'))") == len(SHARED_TABLES)


def test_hard_fks_to_tir_applications_are_dropped():
    sql = _sql()
    for table in SHARED_TABLES:
        assert f"{table}_application_id_fkey" in sql, table


def test_mou_uniqueness_moves_to_track_plus_application():
    sql = _sql()
    assert "founder_mou_application_id_key" in sql          # old single-column unique dropped
    assert "founder_mou_track_application_uidx" in sql      # new composite unique


def test_migration_is_transactional():
    # `in` rather than startswith: the file opens with a comment header
    # explaining why the FKs are dropped, which is worth keeping.
    sql = _sql()
    assert "begin;" in sql
    assert sql.strip().endswith("commit;")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_vip_migration.py -v --no-cov
```

Expected: FAIL — `FileNotFoundError: migrations/043_vip_track_generalisation.sql`

- [ ] **Step 3: Write the migration**

Create `backend/migrations/043_vip_track_generalisation.sql`:

```sql
-- 043_vip_track_generalisation.sql — let VIP (track 'sip') founders use the
-- shared half of the Founder Portal.
--
-- Only five founder_* tables are genuinely shared between the two tracks:
-- the MOU and the four Founders-Resources tables. The eight TIR-only cohort
-- tables (experiments, tasks, review, team_members, approach, bom_items,
-- equipment_items, procurement_items) are deliberately NOT touched — VIP has
-- its own cohort-management sections and never reads them.
--
-- The FK to tir_applications(id) has to go: Postgres has no polymorphic
-- foreign key, and application_id may now point at either tir_applications or
-- sip_applications. The exposure is contained — RLS denies every non
-- service-role writer, the /founder router is the only writer and it enforces
-- ownership, and applications are never hard-deleted in this system.
--
-- Additive and re-runnable. Existing rows take the 'tir' default.

begin;

-- 1) founder_mou ----------------------------------------------------------
alter table public.founder_mou
  add column if not exists track text not null default 'tir';
alter table public.founder_mou
  drop constraint if exists founder_mou_track_check;
alter table public.founder_mou
  add constraint founder_mou_track_check check (track in ('tir','sip'));
alter table public.founder_mou
  drop constraint if exists founder_mou_application_id_fkey;
-- one MOU per application PER TRACK (was: one per application_id globally)
alter table public.founder_mou
  drop constraint if exists founder_mou_application_id_key;
create unique index if not exists founder_mou_track_application_uidx
  on public.founder_mou (track, application_id);

-- 2) founder_cart_items ---------------------------------------------------
alter table public.founder_cart_items
  add column if not exists track text not null default 'tir';
alter table public.founder_cart_items
  drop constraint if exists founder_cart_items_track_check;
alter table public.founder_cart_items
  add constraint founder_cart_items_track_check check (track in ('tir','sip'));
alter table public.founder_cart_items
  drop constraint if exists founder_cart_items_application_id_fkey;
create index if not exists idx_founder_cart_track_app
  on public.founder_cart_items (track, application_id);

-- 3) founder_resource_requests --------------------------------------------
alter table public.founder_resource_requests
  add column if not exists track text not null default 'tir';
alter table public.founder_resource_requests
  drop constraint if exists founder_resource_requests_track_check;
alter table public.founder_resource_requests
  add constraint founder_resource_requests_track_check check (track in ('tir','sip'));
alter table public.founder_resource_requests
  drop constraint if exists founder_resource_requests_application_id_fkey;
create index if not exists idx_founder_requests_track_app
  on public.founder_resource_requests (track, application_id);

-- 4) founder_bookings -----------------------------------------------------
alter table public.founder_bookings
  add column if not exists track text not null default 'tir';
alter table public.founder_bookings
  drop constraint if exists founder_bookings_track_check;
alter table public.founder_bookings
  add constraint founder_bookings_track_check check (track in ('tir','sip'));
alter table public.founder_bookings
  drop constraint if exists founder_bookings_application_id_fkey;
create index if not exists idx_founder_bookings_track_app
  on public.founder_bookings (track, application_id);

-- 5) founder_tickets ------------------------------------------------------
alter table public.founder_tickets
  add column if not exists track text not null default 'tir';
alter table public.founder_tickets
  drop constraint if exists founder_tickets_track_check;
alter table public.founder_tickets
  add constraint founder_tickets_track_check check (track in ('tir','sip'));
alter table public.founder_tickets
  drop constraint if exists founder_tickets_application_id_fkey;
create index if not exists idx_founder_tickets_track_app
  on public.founder_tickets (track, application_id);

commit;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_vip_migration.py -v --no-cov
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/043_vip_track_generalisation.sql backend/tests/test_vip_migration.py
git commit -m "feat(vip): migration 043 — track column on the five shared founder tables"
```

---

### Task 2: Track-resolving `require_founder_access`

**Files:**
- Modify: `backend/app/routers/founder.py:37-91`
- Test: `backend/tests/test_founder_access.py`

**Interfaces:**
- Consumes: `settings.founder_portal_allows(email) -> bool` (unchanged).
- Produces: `require_founder_access(user) -> FounderContext`, a dict with keys `user_id: str`, `track: Literal["tir","sip"]`, `application_id: str`, `status: str`, `app: dict`. **`track` is new** — every task after this reads `ctx["track"]`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_founder_access.py`:

```python
# ── VIP / sip track ───────────────────────────────────────────────────

_SIP_OFFERED_APP = {
    "sip_applications": [
        {"id": "sapp1", "user_id": "u1", "status": "offered",
         "submitted_at": "2026-07-01"},
    ],
}


def test_sip_offered_owner_gets_access(client, monkeypatch, _clear):
    _install(monkeypatch, _SIP_OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["track"] == "sip"
    assert r.json()["status"] == "offered"


def test_sip_non_offered_user_is_denied(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "sip_applications": [
            {"id": "sapp1", "user_id": "u1", "status": "submitted",
             "submitted_at": "2026-07-01"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 403


def test_other_users_sip_app_is_not_visible(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "sip_applications": [
            {"id": "sapp1", "user_id": "someone_else", "status": "onboarded",
             "submitted_at": "2026-07-01"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 403


def test_tir_wins_when_a_user_holds_both(client, monkeypatch, _clear):
    """Shouldn't happen, but the resolution order must be deterministic."""
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "onboarded",
             "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
        "sip_applications": [
            {"id": "sapp1", "user_id": "u1", "status": "onboarded",
             "submitted_at": "2026-07-02"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["track"] == "tir"
    assert r.json()["application_id"] == "app1"


def test_allowlist_gates_sip_founders_too(client, monkeypatch, _clear, _allowlist):
    _allowlist("founder@artpark.in")
    _install(monkeypatch, _SIP_OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1", "nope@gmail.com")
    r = client.get("/founder/me")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "founder_access_denied"


def test_sip_founder_has_no_grant_amount(client, monkeypatch, _clear):
    """sip_applications has no grant_amount column; /me must not 500."""
    _install(monkeypatch, _SIP_OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["grant_amount"] == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_founder_access.py -v --no-cov
```

Expected: the 9 existing tests PASS; the 6 new ones FAIL with 403 (SIP is never queried) and `KeyError: 'track'`.

- [ ] **Step 3: Make `require_founder_access` track-resolving**

In `backend/app/routers/founder.py`, replace the module docstring's first line, the `FounderContext` docstring, and the whole `require_founder_access` body:

```python
_ACCESS_STATUSES = ("offered", "onboarded")

# Resolution order matters: a user should never hold an offered/onboarded app
# on both tracks, but if they somehow do, TIR wins deterministically rather
# than depending on row order. `sip_applications` has no grant_amount column,
# so each track carries its own projection.
_TRACK_SOURCES: tuple[tuple[str, str, str], ...] = (
    ("tir", "tir_applications", "id,status,grant_amount,submitted_at"),
    ("sip", "sip_applications", "id,status,submitted_at"),
)


class FounderContext(dict):
    """{'user_id', 'track', 'application_id', 'status', 'app'} — the caller's
    onboarded application on whichever track it lives."""


async def require_founder_access(
    user: Annotated[dict, Depends(get_current_user)],
) -> FounderContext:
    """Resolve the caller's most-recent offered/onboarded application, TIR or VIP.

    Two independent gates, both of which must pass:

      1. Soft-launch allow-list. While FOUNDER_PORTAL_ALLOWLIST is non-empty,
         only the listed emails may open the portal — on either track — even
         if an admin advances someone else's application to 'offered'.
      2. Ownership + status: the caller must own an application whose status
         is 'offered' or 'onboarded'.

    403 founder_access_denied on either failure. The two cases return the same
    code deliberately — a non-allow-listed founder shouldn't be able to tell
    the portal exists.
    """
    if not settings.founder_portal_allows(user.get("email")):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "founder_access_denied"},
        )
    sb = get_admin_client()
    for track, table, columns in _TRACK_SOURCES:
        rows = (
            sb.table(table)
            .select(columns)
            .eq("user_id", user["user_id"])
            .in_("status", list(_ACCESS_STATUSES))
            .order("submitted_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        if rows:
            app = rows[0]
            return FounderContext(
                user_id=user["user_id"],
                track=track,
                application_id=app["id"],
                status=app["status"],
                app=app,
            )
    raise HTTPException(
        status_code=http_status.HTTP_403_FORBIDDEN,
        detail={"code": "founder_access_denied"},
    )
```

Also update the module docstring at the top of the file:

```python
"""Post-onboarding Founder Portal endpoints.

Serves both tracks. Gate: the caller must own an application whose status is
'offered' or 'onboarded' in either tir_applications or sip_applications.
Access is by ownership, not RBAC role — this is the applicant's own data. All
reads/writes go through the service-role admin client; the router enforces
application_id ↔ user_id ownership, and every shared table is additionally
scoped by track.
"""
```

- [ ] **Step 4: Add `track` to `/founder/me`**

In the same file, add one line to `get_me`'s return dict, immediately after `"status"`:

```python
        "track": ctx["track"],
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_founder_access.py -v --no-cov
```

Expected: PASS (15 tests)

- [ ] **Step 6: Run the whole founder suite for regressions**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_founder_access.py tests/test_founder_crud.py tests/test_founder_mou.py tests/test_founder_query.py tests/test_founder_journey.py tests/test_founder_resources.py -q --no-cov
```

Expected: PASS (68 tests). If `reportlab` is missing, `pip install reportlab` first — it is pinned in `requirements.txt` but may not be in the shared venv.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/founder.py backend/tests/test_founder_access.py
git commit -m "feat(vip): resolve founder access across both tracks; expose track on /founder/me"
```

---

### Task 3: Fix the always-empty venture name

**Files:**
- Modify: `backend/app/routers/founder.py:94-100` (`_project_name`), and its three call sites at `:111`, `:124`, `:159`
- Modify: `backend/app/routers/founder_journey.py` (the `/residency` call site)
- Test: `backend/tests/test_founder_project_name.py`

**Interfaces:**
- Consumes: `ctx["application_id"]`, `ctx["track"]` from Task 2.
- Produces: `_project_name(application_id: str, track: str) -> str`. **Signature changed** from `_project_name(app: dict)`. Every call site must pass the two values.

**Why:** the old implementation read `app["ai_screening_project_name"]`, a PostgREST embed that `require_founder_access` never selects. It therefore returned `""` for every founder — leaving the venture name blank in the MOU body, in the signed PDF, and in the dashboard heading. This is live in production today.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_founder_project_name.py`:

```python
"""The venture name must come from ai_screening, not from a phantom embed.

Regression guard: `_project_name` used to read an `ai_screening_project_name`
key off the application row, which `require_founder_access` never selects, so
it returned "" for every founder — blanking the venture name in the MOU body,
the signed PDF and the dashboard heading.
"""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _override_user(user_id: str):
    return lambda: {"user_id": user_id, "email": f"{user_id}@x.com",
                    "track": "tir", "roles": ["applicant"]}


def _install(monkeypatch, tables: dict) -> FakeSupabase:
    from app.routers import founder as founder_router
    from app.services import founder_query
    fake = FakeSupabase(tables)
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    return fake


def test_me_returns_the_project_name_from_ai_screening(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "onboarded",
             "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
        "ai_screening": [
            {"application_id": "app1", "application_track": "tir",
             "project_name": "Neonatal sepsis monitor"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["project_name"] == "Neonatal sepsis monitor"


def test_project_name_is_scoped_to_the_track(client, monkeypatch, _clear):
    """A sip row with the same application_id must not leak into a tir read."""
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "onboarded",
             "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
        "ai_screening": [
            {"application_id": "app1", "application_track": "sip",
             "project_name": "Wrong track"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["project_name"] == ""


def test_missing_ai_screening_row_yields_empty_string(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "onboarded",
             "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["project_name"] == ""
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_founder_project_name.py -v --no-cov
```

Expected: `test_me_returns_the_project_name_from_ai_screening` FAILS — got `""`, expected `"Neonatal sepsis monitor"`. The other two pass for the wrong reason.

- [ ] **Step 3: Rewrite `_project_name`**

In `backend/app/routers/founder.py`, replace the function:

```python
def _project_name(application_id: str, track: str) -> str:
    """The venture name, from the ai_screening row for this application.

    This has to be its own query. ai_screening is a separate table keyed on
    (application_id, application_track) — the same way
    applications_query.fetch_app_ids_by_project_name resolves it. Reading it
    as an embed off the application row silently yields "" because the
    access query does not select it.
    """
    rows = (
        get_admin_client()
        .table("ai_screening")
        .select("project_name")
        .eq("application_id", application_id)
        .eq("application_track", track)
        .limit(1)
        .execute()
        .data
        or []
    )
    return (rows[0].get("project_name") if rows else "") or ""
```

- [ ] **Step 4: Update the three call sites in `founder.py`**

In `get_me`:

```python
        "project_name": _project_name(ctx["application_id"], ctx["track"]),
```

In `get_mou`:

```python
    body = founder_mou.render_body(
        founder_name=_signer_default(ctx),
        venture=_project_name(ctx["application_id"], ctx["track"]),
        date_str="",
    )
```

In `sign_mou`:

```python
            venture=_project_name(ctx["application_id"], ctx["track"]),
```

- [ ] **Step 5: Update the call site in `founder_journey.py`**

Replace the body of `get_residency`:

```python
@router.get("/residency")
async def get_residency(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    team = fq.fetch_team(ctx["application_id"])
    team_names = [t["name"] for t in team if t.get("name")]
    return fjq.residency_bundle(
        ctx["application_id"],
        _project_name(ctx["application_id"], ctx["track"]),
        team_names,
    )
```

- [ ] **Step 6: Run the tests**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_founder_project_name.py tests/test_founder_journey.py tests/test_founder_crud.py -v --no-cov
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/founder.py backend/app/routers/founder_journey.py backend/tests/test_founder_project_name.py
git commit -m "fix(founder): resolve the venture name from ai_screening instead of a phantom embed"
```

---

### Task 4: Track-aware MOU

**Files:**
- Modify: `backend/app/services/founder_query.py:93-100` (`fetch_mou`)
- Modify: `backend/app/services/founder_mou.py:202-286` (`sign_and_onboard`, `signed_pdf_url`)
- Modify: `backend/app/routers/founder.py` — the four MOU call sites
- Test: `backend/tests/test_vip_mou.py`

**Interfaces:**
- Consumes: `ctx["track"]` (Task 2), the `track` column (Task 1).
- Produces:
  - `founder_query.fetch_mou(application_id: str, track: str = "tir") -> dict | None`
  - `founder_mou.sign_and_onboard(*, application_id, user_id, track, signer_name, founder_name, venture, signature_png, acknowledgements) -> dict` — **`track` is a new required keyword argument**
  - `founder_mou.signed_pdf_url(application_id: str, track: str = "tir") -> str | None`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_vip_mou.py`:

```python
"""A VIP founder signs their own MOU; the two tracks never see each other's."""
from __future__ import annotations

import pytest

from app.services import founder_mou, founder_query
from tests.fixtures.fake_supabase import FakeSupabase

_MOU_ROWS = [
    {"id": "m1", "track": "tir", "application_id": "shared-id",
     "signer_name": "Tir Founder", "signed_pdf_path": "shared-id/mou/signed.pdf"},
    {"id": "m2", "track": "sip", "application_id": "shared-id",
     "signer_name": "Vip Founder", "signed_pdf_path": "shared-id/mou/signed.pdf"},
]


def test_fetch_mou_defaults_to_tir(monkeypatch):
    fake = FakeSupabase({"founder_mou": list(_MOU_ROWS)})
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    assert founder_query.fetch_mou("shared-id")["signer_name"] == "Tir Founder"


def test_fetch_mou_reads_the_sip_row_for_sip(monkeypatch):
    fake = FakeSupabase({"founder_mou": list(_MOU_ROWS)})
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    assert founder_query.fetch_mou("shared-id", "sip")["signer_name"] == "Vip Founder"


def test_unsigned_on_one_track_is_unsigned_even_if_signed_on_the_other(monkeypatch):
    fake = FakeSupabase({"founder_mou": [_MOU_ROWS[0]]})
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    assert founder_query.fetch_mou("shared-id", "sip") is None


def test_sign_stamps_the_track_and_flips_the_sip_application(monkeypatch):
    fake = FakeSupabase({
        "founder_mou": [],
        "sip_applications": [{"id": "sapp1", "status": "offered"}],
    })
    monkeypatch.setattr(founder_mou, "get_admin_client", lambda: fake)
    monkeypatch.setattr(founder_mou, "_upload", lambda *a, **k: None)
    monkeypatch.setattr(founder_mou, "render_signed_pdf", lambda **k: b"%PDF-")
    # decode_signature_png enforces the real PNG magic bytes; these tests are
    # about track scoping, and decoding already has its own tests in
    # test_founder_mou.py.
    monkeypatch.setattr(founder_mou, "decode_signature_png", lambda _s: b"\x89PNG\r\n\x1a\n")

    flips: list[tuple] = []
    monkeypatch.setattr(
        founder_mou.state_machine, "apply_status_change",
        lambda app_id, track, **k: flips.append((app_id, track, k.get("to_status"))),
    )

    row = founder_mou.sign_and_onboard(
        application_id="sapp1", user_id="u1", track="sip",
        signer_name="Vip Founder", founder_name="Vip Founder", venture="Dharini",
        signature_png="data:image/png;base64,aGVsbG8gd29ybGQgcGFkZGluZyBzdHJpbmc=",
        acknowledgements=list(founder_mou.REQUIRED_ACK_IDS),
    )
    assert row["track"] == "sip"
    assert flips == [("sapp1", "sip", "onboarded")]


def test_signing_on_sip_is_not_blocked_by_a_tir_row_with_the_same_id(monkeypatch):
    fake = FakeSupabase({
        "founder_mou": [_MOU_ROWS[0]],
        "sip_applications": [{"id": "shared-id", "status": "offered"}],
    })
    monkeypatch.setattr(founder_mou, "get_admin_client", lambda: fake)
    monkeypatch.setattr(founder_mou, "_upload", lambda *a, **k: None)
    monkeypatch.setattr(founder_mou, "render_signed_pdf", lambda **k: b"%PDF-")
    # decode_signature_png enforces the real PNG magic bytes; these tests are
    # about track scoping, and decoding already has its own tests in
    # test_founder_mou.py.
    monkeypatch.setattr(founder_mou, "decode_signature_png", lambda _s: b"\x89PNG\r\n\x1a\n")
    monkeypatch.setattr(founder_mou.state_machine, "apply_status_change",
                        lambda *a, **k: None)

    row = founder_mou.sign_and_onboard(
        application_id="shared-id", user_id="u1", track="sip",
        signer_name="Vip Founder", founder_name="Vip Founder", venture="Dharini",
        signature_png="data:image/png;base64,aGVsbG8gd29ybGQgcGFkZGluZyBzdHJpbmc=",
        acknowledgements=list(founder_mou.REQUIRED_ACK_IDS),
    )
    assert row["track"] == "sip"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_vip_mou.py -v --no-cov
```

Expected: FAIL — `fetch_mou() takes 1 positional argument`, and `sign_and_onboard() got an unexpected keyword argument 'track'`.

- [ ] **Step 3: Make `fetch_mou` track-aware**

In `backend/app/services/founder_query.py`:

```python
def fetch_mou(application_id: str, track: str = "tir") -> dict | None:
    sb = get_admin_client()
    rows = (
        sb.table("founder_mou").select("*")
        .eq("application_id", application_id).eq("track", track)
        .limit(1).execute().data
        or []
    )
    return rows[0] if rows else None
```

- [ ] **Step 4: Make `sign_and_onboard` and `signed_pdf_url` track-aware**

In `backend/app/services/founder_mou.py`, change the signature and the four places that touch a table:

```python
def sign_and_onboard(*, application_id: str, user_id: str, track: str,
                     signer_name: str, founder_name: str, venture: str,
                     signature_png: str,
                     acknowledgements: list[str] | None = None) -> dict:
```

The already-signed lookup gains the track filter:

```python
    existing = (
        sb.table("founder_mou").select("*")
        .eq("application_id", application_id).eq("track", track)
        .limit(1).execute().data or []
    )
```

Storage paths become track-prefixed so two tracks can never collide on a path:

```python
    sig_path = f"{track}/{application_id}/mou/signature.png"
    pdf_path = f"{track}/{application_id}/mou/signed.pdf"
```

The inserted row carries the track:

```python
    row = {
        "application_id": application_id,
        "track": track,
        "signer_name": signer_name,
        "signed_at": datetime.now(UTC).isoformat(),
        "signature_image_path": sig_path,
        "signed_pdf_path": pdf_path,
        "template_version": TEMPLATE_VERSION,
        "acknowledgements": accepted,
    }
```

And the status flip targets the right table and track:

```python
    # 3) flip status only if still 'offered' (idempotent for already-onboarded apps)
    table = "tir_applications" if track == "tir" else "sip_applications"
    current = (
        sb.table(table).select("status")
        .eq("id", application_id).limit(1).execute().data or []
    )
    if current and current[0].get("status") == "offered":
        state_machine.apply_status_change(
            application_id, track, to_status="onboarded",
            changed_by=user_id, reason="MOU signed",
        )
    return row
```

`signed_pdf_url` likewise:

```python
def signed_pdf_url(application_id: str, track: str = "tir") -> str | None:
    sb = get_admin_client()
    rows = (
        sb.table("founder_mou").select("signed_pdf_path")
        .eq("application_id", application_id).eq("track", track)
        .limit(1).execute().data or []
    )
    if not rows or not rows[0].get("signed_pdf_path"):
        return None
    signed = sb.storage.from_(BUCKET).create_signed_url(rows[0]["signed_pdf_path"], 300)
    if isinstance(signed, dict):
        return signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
    return signed
```

- [ ] **Step 5: Update the four call sites in `founder.py`**

```python
# get_me
    mou = founder_query.fetch_mou(ctx["application_id"], ctx["track"])

# get_mou
    mou = founder_query.fetch_mou(ctx["application_id"], ctx["track"])

# sign_mou — add track to the kwargs
        row = founder_mou.sign_and_onboard(
            application_id=ctx["application_id"],
            user_id=ctx["user_id"],
            track=ctx["track"],
            signer_name=payload.signer_name,
            founder_name=payload.signer_name,
            venture=_project_name(ctx["application_id"], ctx["track"]),
            signature_png=payload.signature_png,
            acknowledgements=payload.acknowledgements,
        )

# mou_signed_url
    url = founder_mou.signed_pdf_url(ctx["application_id"], ctx["track"])
```

Also `get_dashboard` in `founder.py` reads the MOU — update it:

```python
    mou_signed = founder_query.fetch_mou(ctx["application_id"], ctx["track"]) is not None
```

- [ ] **Step 6: Run the tests**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_vip_mou.py tests/test_founder_mou.py tests/test_founder_crud.py tests/test_founder_query.py -v --no-cov
```

Expected: PASS. If `test_founder_crud.py::test_sign_mou_flips_status_to_onboarded` fails on the new required `track` kwarg, update that test to pass `track="tir"`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/founder_query.py backend/app/services/founder_mou.py backend/app/routers/founder.py backend/tests/test_vip_mou.py backend/tests/test_founder_crud.py
git commit -m "feat(vip): scope MOU reads, writes and signed-PDF paths by track"
```

---

### Task 5: Track-aware Founders Resources

**Files:**
- Modify: `backend/app/services/founder_resources_query.py:13-43`
- Modify: `backend/app/routers/founder_resources.py` — every `founder_cart_items` / `founder_resource_requests` / `founder_bookings` / `founder_tickets` read, insert and ownership check
- Test: `backend/tests/test_vip_resources.py`

**Interfaces:**
- Consumes: `ctx["track"]` (Task 2), the `track` column (Task 1).
- Produces: every read in `founder_resources_query` takes `track`, defaulting to `"tir"`. Note `fetch_requests` takes it **third**, after `kind`:
  - `fetch_cart(application_id, track="tir")`
  - `fetch_requests(application_id, kind, track="tir")`
  - `fetch_bookings(application_id, track="tir")`
  - `fetch_tickets(application_id, track="tir")`
  - `store_bundle(application_id, track="tir")`
  - `fundraising_bundle(application_id, track="tir")`
  - `partners_bundle(application_id, track="tir")`
  - `assets_bundle(application_id, track="tir")`
  - `support_bundle(application_id, track="tir")`
- Produces: in `founder_resources.py`, two helpers change signature — `_owned_or_404(sb, table, row_id, ctx)` and `_find_request(sb, ctx, kind, ref_id)`, both now taking the whole context so they can filter on track.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_vip_resources.py`:

```python
"""Founders Resources are shared code, but never shared rows."""
from __future__ import annotations

import pytest

from app.services import founder_resources_query as frq
from tests.fixtures.fake_supabase import FakeSupabase

_ROWS = {
    "founder_cart_items": [
        {"id": "c1", "track": "tir", "application_id": "shared", "product_id": "p1", "qty": 1},
        {"id": "c2", "track": "sip", "application_id": "shared", "product_id": "p2", "qty": 5},
    ],
    "founder_tickets": [
        {"id": "t1", "track": "tir", "application_id": "shared", "subject": "TIR ticket"},
        {"id": "t2", "track": "sip", "application_id": "shared", "subject": "VIP ticket"},
    ],
    "founder_bookings": [
        {"id": "b1", "track": "tir", "application_id": "shared", "asset_id": "a1"},
    ],
    "founder_resource_requests": [
        {"id": "r1", "track": "tir", "application_id": "shared", "kind": "intro", "ref_id": "i1"},
        {"id": "r2", "track": "sip", "application_id": "shared", "kind": "intro", "ref_id": "i2"},
    ],
}


@pytest.fixture
def fake(monkeypatch):
    f = FakeSupabase({k: list(v) for k, v in _ROWS.items()})
    monkeypatch.setattr(frq, "get_admin_client", lambda: f)
    return f


def test_cart_defaults_to_tir(fake):
    cart = frq.fetch_cart("shared")
    assert [c["product_id"] for c in cart] == ["p1"]


def test_cart_reads_only_the_sip_rows_for_sip(fake):
    cart = frq.fetch_cart("shared", "sip")
    assert [c["product_id"] for c in cart] == ["p2"]


def test_tickets_are_track_scoped(fake):
    assert [t["subject"] for t in frq.fetch_tickets("shared", "sip")] == ["VIP ticket"]


def test_bookings_empty_on_a_track_with_none(fake):
    assert frq.fetch_bookings("shared", "sip") == []


def test_requests_filter_on_kind_and_track(fake):
    assert [r["ref_id"] for r in frq.fetch_requests("shared", "intro", "sip")] == ["i2"]


def test_bundles_pass_the_track_down(fake):
    """The five *_bundle helpers must not silently read TIR rows for a VIP."""
    assert frq.store_bundle("shared", "sip")["cart"][0]["product_id"] == "p2"
    assert frq.support_bundle("shared", "sip")["tickets"][0]["subject"] == "VIP ticket"
    assert frq.assets_bundle("shared", "sip")["bookings"] == []
```

And add an endpoint-level test for the TIR-only procurement push, in the same file:

```python
import pytest as _pytest

from app.deps import get_current_user
from app.main import app as _app


@_pytest.fixture
def _clear():
    yield
    _app.dependency_overrides.clear()


def test_push_to_procurement_is_rejected_for_vip(client, monkeypatch, _clear):
    """founder_procurement_items is TIR-only and keeps its FK, so VIP must not
    be able to write to it through the shared store."""
    from app.routers import founder as founder_router
    from app.routers import founder_resources as fr_router

    fake = FakeSupabase({
        "sip_applications": [
            {"id": "sapp1", "user_id": "u1", "status": "onboarded",
             "submitted_at": "2026-07-01"},
        ],
        "founder_cart_items": [],
        "founder_procurement_items": [],
    })
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(fr_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(frq, "get_admin_client", lambda: fake)
    _app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "email": "u1@x.com", "track": "sip", "roles": ["applicant"],
    }

    r = client.post("/founder/store/push-to-procurement")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "not_available_for_track"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_vip_resources.py -v --no-cov
```

Expected: FAIL — `fetch_cart() takes from 1 to 2 positional arguments but 3 were given`, and the default-track tests return both rows.

- [ ] **Step 3: Add track to the query layer**

Replace the read helpers in `backend/app/services/founder_resources_query.py`:

```python
def _rows(table: str, application_id: str, track: str = "tir",
          order: str | None = "created_at") -> list[dict]:
    sb = get_admin_client()
    q = (
        sb.table(table).select("*")
        .eq("application_id", application_id)
        .eq("track", track)
    )
    if order:
        try:
            q = q.order(order)
        except Exception:  # noqa: BLE001 — order optional
            pass
    return q.execute().data or []


def fetch_cart(application_id: str, track: str = "tir") -> list[dict]:
    return _rows("founder_cart_items", application_id, track)


def fetch_requests(application_id: str, kind: str, track: str = "tir") -> list[dict]:
    sb = get_admin_client()
    return (
        sb.table("founder_resource_requests").select("*")
        .eq("application_id", application_id).eq("kind", kind).eq("track", track)
        .execute().data
        or []
    )


def fetch_bookings(application_id: str, track: str = "tir") -> list[dict]:
    return _rows("founder_bookings", application_id, track, order="date")


def fetch_tickets(application_id: str, track: str = "tir") -> list[dict]:
    return _rows("founder_tickets", application_id, track, order="created_at")
```

- [ ] **Step 4: Thread track through the five bundles**

Still in `founder_resources_query.py`, the five `*_bundle` functions each call a fetch, so they need the track too. Replace them:

```python
def store_bundle(application_id: str, track: str = "tir") -> dict:
    cart = fetch_cart(application_id, track)
    quote_requests = fetch_requests(application_id, "quote", track)
    return {
        "catalog": merge_catalog(cart, quote_requests),
        "cart": build_cart_view(cart),
        "cart_subtotal": cart_subtotal(cart),
    }


def fundraising_bundle(application_id: str, track: str = "tir") -> dict:
    intro_requests = fetch_requests(application_id, "intro", track)
    return {
        "investors": merge_investors(intro_requests),
        "tools": cat.FR_TOOLS,
    }


def partners_bundle(application_id: str, track: str = "tir") -> dict:
    partner_requests = fetch_requests(application_id, "partner", track)
    return {"partners": merge_partners(partner_requests)}


def assets_bundle(application_id: str, track: str = "tir") -> dict:
    return {
        "assets": cat.ASSETS,
        "bookings": fetch_bookings(application_id, track),
    }


def support_bundle(application_id: str, track: str = "tir") -> dict:
    return {"tickets": fetch_tickets(application_id, track)}
```

Keep each bundle's existing return shape exactly — only the fetch calls change. Read the current bodies first and preserve any keys not shown above.

- [ ] **Step 5: Change the two router helpers**

In `backend/app/routers/founder_resources.py`, both helpers now take the whole context so they can filter on track:

```python
def _owned_or_404(sb, table: str, row_id: str, ctx: dict) -> dict:
    rows = (
        sb.table(table).select("*")
        .eq("id", row_id)
        .eq("application_id", ctx["application_id"])
        .eq("track", ctx["track"])
        .limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    return rows[0]


def _find_request(sb, ctx: dict, kind: str, ref_id: str) -> dict | None:
    rows = (
        sb.table("founder_resource_requests").select("*")
        .eq("application_id", ctx["application_id"])
        .eq("kind", kind).eq("ref_id", ref_id)
        .eq("track", ctx["track"])
        .limit(1).execute().data or []
    )
    return rows[0] if rows else None
```

- [ ] **Step 6: Thread track through all 15 endpoints**

Work the file top to bottom. Three mechanical rules:

1. Every `frq.*_bundle(...)` / `frq.fetch_*(...)` call gains `ctx["track"]` as its last argument.
2. Every `insert({...})` payload on a shared table gains `"track": ctx["track"]`.
3. Every direct `.eq("application_id", application_id)` gains an adjacent `.eq("track", ctx["track"])`.

The exact sites, by current line number:

| Line | Change |
|---|---|
| 59 | `frq.store_bundle(ctx["application_id"], ctx["track"])` |
| 71 | add `.eq("track", ctx["track"])` to the cart lookup |
| 80 | add `"track": ctx["track"]` to the insert payload |
| 84 | `frq.store_bundle(application_id, ctx["track"])` |
| 94 | add `.eq("track", ctx["track"])` to the delete |
| 95 | `frq.store_bundle(application_id, ctx["track"])` |
| 99 | add `.eq("track", ctx["track"])` to the lookup |
| 109 | add `"track": ctx["track"]` to the insert payload |
| 111 | `frq.store_bundle(application_id, ctx["track"])` |
| 119 | add `.eq("track", ctx["track"])` to the delete |
| 120 | `frq.store_bundle(application_id, ctx["track"])` |
| 130 | `_find_request(sb, ctx, "quote", body.product_id)` |
| 132 | add `"track": ctx["track"]` to the insert payload |
| 141 | `frq.fetch_cart(application_id, ctx["track"])` |
| 148 | add `"track": ctx["track"]` to the procurement insert payload |
| 162 | add `.eq("track", ctx["track"])` to the cart clear |
| 169 | `frq.fundraising_bundle(ctx["application_id"], ctx["track"])` |
| 179 | `_find_request(sb, ctx, "intro", body.investor_id)` |
| 184 | add `"track": ctx["track"]` to the insert payload |
| 192 | `frq.partners_bundle(ctx["application_id"], ctx["track"])` |
| 202 | `_find_request(sb, ctx, "partner", body.partner_id)` |
| 207 | add `"track": ctx["track"]` to the insert payload |
| 215 | `frq.assets_bundle(ctx["application_id"], ctx["track"])` |
| 226 | add `"track": ctx["track"]` to the booking insert payload |
| 239 | `_owned_or_404(sb, "founder_bookings", row_id, ctx)` |
| 246 | `frq.support_bundle(ctx["application_id"], ctx["track"])` |
| 253 | `frq.fetch_tickets(application_id, ctx["track"])` |
| 256 | add `"track": ctx["track"]` to the ticket insert payload |

Line 148 writes to `founder_procurement_items`, which is a **TIR-only** table with a live FK — do **not** add a track column there. Instead, guard the whole push-to-procurement endpoint so it only runs for TIR:

```python
@router.post("/store/push-to-procurement")
async def push_to_procurement(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    # Procurement is TIR-only (it feeds the residency expense account). VIP has
    # no procurement table, so the store's push action is not offered there.
    if ctx["track"] != "tir":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={"code": "not_available_for_track"},
        )
```

Then verify nothing was missed:

```bash
cd .claude/worktrees/vip-onboarding/backend
grep -n 'eq("application_id"' app/routers/founder_resources.py
```

Every hit must have an `.eq("track", ...)` within the same statement.

- [ ] **Step 7: Run the tests**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_vip_resources.py tests/test_founder_resources.py -v --no-cov
```

Expected: PASS. `test_founder_resources.py` fixtures will need `"track": "tir"` added to their seeded rows wherever a test now fails on an empty read — that is expected, not a regression.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/founder_resources_query.py backend/app/routers/founder_resources.py backend/tests/test_vip_resources.py backend/tests/test_founder_resources.py
git commit -m "feat(vip): scope Founders Resources rows by track"
```

---

### Task 6: Sidebar — track-aware cohort group, and delete the COHORT group

**Files:**
- Modify: `frontend/src/pages/founder/FounderPortal.jsx:22-51` (NAV + COHORT_LINKS), `:88-131` (FounderSidebar), `:156-216` (render)
- Test: `frontend/src/pages/founder/__tests__/FounderPortal.test.jsx`

**Interfaces:**
- Consumes: `me.track` from `GET /founder/me` (Task 2).
- Produces: `navFor(track) -> Array<{group, locked?, items}>`, exported for testing.

- [ ] **Step 1: Write the failing tests**

Replace the contents of `frontend/src/pages/founder/__tests__/FounderPortal.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderPortal from "../FounderPortal.jsx";
import { founderApi } from "../../../lib/founderApi.js";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "founder@x.com", roles: [] }, logout: () => Promise.resolve() }),
}));

const me = (track) => ({
  status: "onboarded", track, project_name: "Neonatal monitor", mou_signed: true,
  locked: { cohort: false, dashboard: false },
});

const renderPortal = () =>
  render(<MemoryRouter><FounderPortal tab="application" /></MemoryRouter>);

describe("FounderPortal shell", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows a track-neutral gated message on 403", async () => {
    vi.spyOn(founderApi, "me").mockRejectedValue({ status: 403 });
    renderPortal();
    await waitFor(() =>
      expect(screen.getByText(/unlocks once your application is selected/i)).toBeInTheDocument());
  });

  it("renders the TIR cohort group for a tir founder", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me("tir"));
    renderPortal();
    await waitFor(() => expect(screen.getByText("Sign MOU")).toBeInTheDocument());
    expect(screen.getByText("Cohort management")).toBeInTheDocument();
    expect(screen.getByText("Approach")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Expense management")).toBeInTheDocument();
    expect(screen.queryByText("TLR evaluation")).not.toBeInTheDocument();
  });

  it("renders the VIP cohort group for a sip founder", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me("sip"));
    renderPortal();
    await waitFor(() => expect(screen.getByText("TLR evaluation")).toBeInTheDocument());
    expect(screen.getByText("MIS filling")).toBeInTheDocument();
    expect(screen.queryByText("Approach")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Expense management")).not.toBeInTheDocument();
  });

  it("keeps Current, Sign MOU and all five Founders Resources on both tracks", async () => {
    for (const track of ["tir", "sip"]) {
      vi.spyOn(founderApi, "me").mockResolvedValue(me(track));
      const { unmount } = renderPortal();
      await waitFor(() => expect(screen.getByText("Sign MOU")).toBeInTheDocument());
      for (const label of ["Current", "Art Infra", "ArtConnect", "ArtPartners", "Art Assets", "Art Support"]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("no longer renders the Cohort links group on either track", async () => {
    for (const track of ["tir", "sip"]) {
      vi.spyOn(founderApi, "me").mockResolvedValue(me(track));
      const { unmount } = renderPortal();
      await waitFor(() => expect(screen.getByText("Sign MOU")).toBeInTheDocument());
      expect(screen.queryByText("Cohort")).not.toBeInTheDocument();
      expect(screen.queryByText("Programs")).not.toBeInTheDocument();
      expect(screen.queryByText("TIR overview")).not.toBeInTheDocument();
      expect(screen.queryByText("VIP overview")).not.toBeInTheDocument();
      unmount();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd .claude/worktrees/vip-onboarding/frontend
npx vitest run src/pages/founder/__tests__/FounderPortal.test.jsx
```

Expected: FAIL — the VIP group test finds no "TLR evaluation", and the COHORT-deletion test finds "Programs".

- [ ] **Step 3: Replace the NAV constants**

In `frontend/src/pages/founder/FounderPortal.jsx`, replace the `NAV` and `COHORT_LINKS` constants (lines 22-51) with:

```jsx
// Founder nav — grafted onto the applicant `.eir-os-side` sidebar language so
// this reads as a native continuation of the /apply dashboard.
//
// Everything except the cohort-management group is identical on both tracks:
// same components, same endpoints, no duplication. Only the middle group
// swaps, because TIR runs a residency (derisking, payroll, procurement) and
// VIP runs an incubation programme (readiness assessment, MIS reporting).
const NAV_HEAD = [
  { group: "Application", items: [
    { sec: "application", num: "•", label: "Current", to: "/founder" },
  ]},
  { group: "Onboarding", items: [
    { sec: "mou", num: "01", label: "Sign MOU", to: "/founder/mou" },
  ]},
];

const COHORT_TIR = { group: "Cohort management", locked: "cohort", items: [
  { sec: "approach", num: "01", label: "Approach", to: "/founder/approach" },
  { sec: "org", num: "02", label: "Organization", to: "/founder/org" },
  { sec: "expense", num: "03", label: "Expense management", to: "/founder/expense" },
]};

const COHORT_VIP = { group: "Cohort management", locked: "cohort", items: [
  { sec: "tlr", num: "01", label: "TLR evaluation", to: "/founder/tlr" },
  { sec: "mis", num: "02", label: "MIS filling", to: "/founder/mis" },
]};

const NAV_TAIL = [
  { group: "Dashboard reporting", locked: "dashboard", items: [
    { sec: "dashboard", num: "•", label: "Process dashboard", to: "/founder/dashboard" },
  ]},
  { group: "Founders resources", items: [
    { sec: "store", num: "01", label: "Art Infra", to: "/founder/store" },
    { sec: "fundraising", num: "02", label: "ArtConnect", to: "/founder/fundraising" },
    { sec: "partners", num: "03", label: "ArtPartners", to: "/founder/partners" },
    { sec: "assets", num: "04", label: "Art Assets", to: "/founder/assets" },
    { sec: "support", num: "05", label: "Art Support", to: "/founder/support" },
  ]},
];

export function navFor(track) {
  return [...NAV_HEAD, track === "sip" ? COHORT_VIP : COHORT_TIR, ...NAV_TAIL];
}
```

The `COHORT_LINKS` constant is deleted outright — no replacement.

- [ ] **Step 4: Take the nav from props and drop the Cohort `<nav>`**

Change `FounderSidebar` to accept `nav` and remove the external-links block:

```jsx
function FounderSidebar({ nav, tab, locked, navigate }) {
  const isLocked = (group) => group.locked && locked[group.locked];
  return (
    <aside className="eir-os-side">
      {nav.map((g) => (
        <nav className="eir-os-side-group" key={g.group}>
          <div className="eir-mono eir-os-side-title">{g.group}</div>
          {g.items.map((it) => {
            const lock = isLocked(g);
            return (
              <button
                type="button"
                key={it.sec}
                className={`eir-os-nav ${tab === it.sec ? "is-on" : ""}`}
                onClick={() => navigate(it.to)}
                style={lock ? { opacity: 0.5 } : undefined}
                aria-disabled={lock || undefined}
              >
                <span className="eir-mono eir-os-nav-num">{it.num}</span>
                <span className="eir-os-nav-label">{it.label}</span>
                {lock && <span className="eir-mono eir-os-nav-badge">🔒</span>}
              </button>
            );
          })}
        </nav>
      ))}

      <div className="eir-os-side-foot">
        <div className="eir-mono eir-dim">↳ data encrypted at rest</div>
        <div className="eir-mono eir-dim">↳ progress autosaves</div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Make the 403 copy track-neutral and pass the nav down**

In the 403 branch of `FounderPortal`, change the sentence:

```jsx
                  <p className="eir-os-view-sub">
                    This area unlocks once your application is selected.{" "}
                    <a href="/apply">Back to your application →</a>
                  </p>
```

And in the success render, compute the nav and pass it:

```jsx
  const locked = me.locked || { cohort: true, dashboard: true };
  const nav = navFor(me.track);
```

```jsx
          <FounderSidebar nav={nav} tab={tab} locked={locked} navigate={navigate} />
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd .claude/worktrees/vip-onboarding/frontend
npx vitest run src/pages/founder/__tests__/FounderPortal.test.jsx
```

Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/founder/FounderPortal.jsx frontend/src/pages/founder/__tests__/FounderPortal.test.jsx
git commit -m "feat(vip): swap the cohort-management nav by track; remove the Cohort links group"
```

---

### Task 7: `/founder/tlr` and `/founder/mis` routes with empty states

**Files:**
- Create: `frontend/src/pages/founder/FounderTlr.jsx`
- Create: `frontend/src/pages/founder/FounderMis.jsx`
- Modify: `frontend/src/router.jsx:373-384` (founder route block)
- Modify: `frontend/src/pages/founder/FounderPortal.jsx` — imports and `renderTab`
- Test: `frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx`

**Interfaces:**
- Consumes: `navFor` (Task 6), the existing `FounderLocked` component.
- Produces: default-exported `FounderTlr` and `FounderMis` components taking no props. Phase 2 replaces `FounderTlr`'s body with the five-step wizard; Phase 3 replaces `FounderMis`'s.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderPortal from "../FounderPortal.jsx";
import { founderApi } from "../../../lib/founderApi.js";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "founder@x.com", roles: [] }, logout: () => Promise.resolve() }),
}));

const me = (locked) => ({
  status: locked ? "offered" : "onboarded", track: "sip",
  project_name: "Dharini", mou_signed: !locked,
  locked: { cohort: locked, dashboard: locked },
});

describe("VIP cohort tabs", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the TLR evaluation screen", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me(false));
    render(<MemoryRouter><FounderPortal tab="tlr" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/ARTPARK Innovation Readiness/i)).toBeInTheDocument());
  });

  it("renders the MIS screen", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me(false));
    render(<MemoryRouter><FounderPortal tab="mis" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Monthly and quarterly reporting/i)).toBeInTheDocument());
  });

  it("locks both VIP tabs until the MOU is signed", async () => {
    for (const tab of ["tlr", "mis"]) {
      vi.spyOn(founderApi, "me").mockResolvedValue(me(true));
      const { unmount } = render(<MemoryRouter><FounderPortal tab={tab} /></MemoryRouter>);
      await waitFor(() => expect(screen.getByText(/sign your MOU/i)).toBeInTheDocument());
      unmount();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/frontend
npx vitest run src/pages/founder/__tests__/FounderVipTabs.test.jsx
```

Expected: FAIL — the portal falls through to the Application tab for unknown tabs, so none of the expected text is found.

- [ ] **Step 3: Create the two placeholder screens**

Create `frontend/src/pages/founder/FounderTlr.jsx`:

```jsx
// TLR evaluation — the ARTPARK Innovation Readiness (AIR) scorecard.
// Phase 1 ships the route and an empty state; Phase 2 replaces this body with
// the five-step wizard (Overview / Technology / Commercial / Evidence /
// Scorecard). See docs/superpowers/specs/2026-08-15-vip-onboarding-design.md §4.
export default function FounderTlr() {
  return (
    <>
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Cohort management · TLR evaluation</div>
        <h1 className="eir-os-view-title">ARTPARK Innovation Readiness</h1>
        <p className="eir-os-view-sub">
          Assess your venture across six transversal levers — three technology,
          three commercial — and submit the evidence for each level you claim.
        </p>
      </header>
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-h">Coming next</div>
        <p style={{ padding: 16, margin: 0 }}>
          The assessment opens here shortly.
        </p>
      </div>
    </>
  );
}
```

Create `frontend/src/pages/founder/FounderMis.jsx`:

```jsx
// MIS filling — monthly and quarterly reporting periods.
// Phase 1 ships the route and an empty state; Phase 3 replaces this body with
// the period list and the two forms. See
// docs/superpowers/specs/2026-08-15-vip-onboarding-design.md §5.
export default function FounderMis() {
  return (
    <>
      <header className="eir-os-view-head">
        <div className="eir-mono eir-dim eir-os-crumb">Cohort management · MIS filling</div>
        <h1 className="eir-os-view-title">Monthly and quarterly reporting</h1>
        <p className="eir-os-view-sub">
          Your monthly update and quarterly review, captured here and carried
          forward period to period.
        </p>
      </header>
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-h">Coming next</div>
        <p style={{ padding: 16, margin: 0 }}>
          Reporting periods open here shortly.
        </p>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Wire them into `FounderPortal`**

Add the imports beside the other tab imports:

```jsx
import FounderTlr from "./FounderTlr.jsx";
import FounderMis from "./FounderMis.jsx";
```

Extend the cohort lock check and the switch in `renderTab`:

```jsx
    // gate cohort/dashboard tabs until MOU signed
    if (["approach", "org", "expense", "tlr", "mis"].includes(tab) && locked.cohort)
      return <FounderLocked which="cohort" onGoMou={() => navigate("/founder/mou")} />;
```

```jsx
      case "tlr": return <FounderTlr />;
      case "mis": return <FounderMis />;
```

- [ ] **Step 5: Add the routes**

In `frontend/src/router.jsx`, add two routes inside the founder block, after `/founder/expense`:

```jsx
      <Route path="/founder/tlr" element={<FounderRoute tab="tlr" />} />
      <Route path="/founder/mis" element={<FounderRoute tab="mis" />} />
```

Update the founder block's comment to list them:

```jsx
      {/* Founder Portal (post-onboarding). Auth-gated only — FounderRoute
          wraps ProtectedRoute internally; the server `/founder/me` 403 is the
          real access gate, shown inside FounderPortal. Deep-linkable:
          /founder (application) · mou · dashboard · store · fundraising ·
          partners · assets · support — plus the track-specific cohort tabs,
          approach/org/expense for TIR and tlr/mis for VIP. */}
```

- [ ] **Step 6: Run tests to verify they pass**

`FounderLocked` renders "Sign your MOU to unlock {what}" — already confirmed, so the third test's `/sign your MOU/i` assertion matches. Do not change that component.

```bash
cd .claude/worktrees/vip-onboarding/frontend
npx vitest run src/pages/founder
```

Expected: PASS — the whole founder suite, including the 3 new tests here and the 5 from Task 6.

- [ ] **Step 7: Build**

```bash
cd .claude/worktrees/vip-onboarding/frontend
npm run build
```

Expected: build succeeds with no unresolved imports.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/founder/FounderTlr.jsx frontend/src/pages/founder/FounderMis.jsx frontend/src/pages/founder/FounderPortal.jsx frontend/src/router.jsx frontend/src/pages/founder/__tests__/FounderVipTabs.test.jsx
git commit -m "feat(vip): add the TLR evaluation and MIS filling routes with empty states"
```

---

## Phase exit criteria

- [ ] `pytest tests/test_founder_access.py tests/test_founder_crud.py tests/test_founder_mou.py tests/test_founder_query.py tests/test_founder_journey.py tests/test_founder_resources.py tests/test_vip_migration.py tests/test_vip_mou.py tests/test_vip_resources.py tests/test_founder_project_name.py -q --no-cov` is green.
- [ ] `npx vitest run src/pages/founder` is green.
- [ ] `npm run build` succeeds.
- [ ] The full backend suite shows no NEW failures against the ~20-22 pre-existing baseline — confirm any failure reproduces on untouched `release/sip-launch-v1` before treating it as yours.
- [ ] Migration 043 has been applied to the **staging** Supabase project (`exqmxvdtcsvpgtftwjml`) by the user, since DDL is human-applied.
- [ ] A VIP test founder exists on staging with a `sip_applications` row in `offered`, and signing in shows: Current, Sign MOU, Cohort management with TLR evaluation + MIS filling, Process dashboard, and all five Founders Resources pages — with no Cohort links group anywhere.
