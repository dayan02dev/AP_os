# Phase 1 Admin Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Leadership Dashboard and Admin User-Management page from the team's screenshots, wired to real data on the staging Supabase, with backend RBAC + SQS+worker AI pipeline + email notifications + audit log foundations.

**Architecture:** Branch `staging-role_based_dashboard` (forked from `main`, already pushed). Shared staging Lambda (`artpark-eir-api-staging`) and staging Supabase (`exqmxvdtcsvpgtftwjml`). Multi-role RBAC via `user_roles` join + `ROLE_CAPABILITIES` Python constant + FastAPI `require_capability()` dep. AI scoring runs async via SQS → worker Lambda; defaults to deterministic stub mode. Leadership dashboard is lifted from `/Users/apple/Downloads/Application Form - 12 May/src/leadership.jsx` (703 LOC prototype with mock data) and rewired to real API endpoints.

**Tech Stack:** FastAPI + Mangum (Python 3.11 on AWS Lambda arm64), Supabase Postgres + service-role client, React 18 + Vite + react-router-dom, AWS SAM for infra, AWS SQS for AI queue, OpenRouter + Google Gemini Flash for AI scoring (stubbed in Phase 1), Resend for transactional email.

**Source documents:**
- Spec: `docs/superpowers/specs/2026-05-13-admin-platform-design.md`
- Prototype: `/Users/apple/Downloads/Application Form - 12 May/src/leadership.jsx`
- Screenshots: leadership dashboard (5 imgs) + admin user-mgmt page (3 imgs) earlier in the brainstorm
- Local prototype URL: http://localhost:8765 — login `ndedhia18@gmail.com` / `123456`

**Team:** Primary dev does all backend + frontend wiring (~95%). Udita's role is the **terminal UI polish phase** only (Task 29).

**Phase out-of-scope** (do NOT bundle into Phase 1):
- Reviewer scoring screen → Phase 1.5 (next ship after Phase 1)
- Jury portal, psychometry, scoring.md editor, cohort analytics → Phase 2+
- Mentor + founder dashboards → Phase 2+

---

## File Structure

### Backend — new files

| File | Responsibility |
|---|---|
| `backend/app/rbac.py` | `ROLE_CAPABILITIES` constant + `require_capability()` FastAPI dep + helpers |
| `backend/app/routers/admin_users.py` | User CRUD + role grant/revoke + password reset (spec §5.1) |
| `backend/app/routers/leadership.py` | Cross-track applications list + stats endpoints (spec §5.2, §5.3) |
| `backend/app/routers/reviewer.py` | Reviewer inbox stub + decline endpoint (spec §5.4 — minimum surface; full scoring is Phase 1.5) |
| `backend/app/routers/audit_internal.py` | Internal helper service for writing `audit_log_v2` rows (no HTTP surface in Phase 1) |
| `backend/app/ai_worker.py` | Lambda entrypoint for SQS-triggered AI screening (stub-mode default per spec §7.3) |
| `backend/app/ai_rubric.py` | Placeholder prompt template for Gemini Flash; later moves to DB |
| `backend/app/services/notifications.py` | Resend wrappers for the 9 Phase-1 emails (spec §8) |
| `backend/app/services/queue.py` | Thin wrapper for `sqs.send_message()` calls from the API Lambda |
| `backend/scripts/seed_synthetic_cohort.py` | Generates ~40 fake apps in staging Supabase (spec §10.4) |
| `backend/tests/test_rbac.py` | Unit tests for capability resolution |
| `backend/tests/test_admin_users.py` | Integration tests for `/admin/users/*` |
| `backend/tests/test_leadership.py` | Integration tests for `/leadership/*` |
| `backend/tests/test_ai_worker.py` | Stub-mode worker test + idempotency test |

### Backend — modified files

| File | Change |
|---|---|
| `backend/app/main.py` | Register 4 new routers |
| `backend/app/deps.py` | Extend `get_current_user` to fetch `roles` list from `user_roles` and return in user dict |
| `backend/app/routers/auth.py` | `/auth/me` returns roles + active_role |
| `backend/app/routers/applications.py` | On submit, enqueue AI screening SQS message |
| `backend/app/routers/sip_applications.py` | Same — enqueue on submit |

### Backend — infra changes

| File | Change |
|---|---|
| `infra/sam/template.yaml` | Add `AiScreeningQueue` (FIFO), `AiScreeningDLQ`, `AiWorkerFunction`, IAM policies, CloudWatch alarm (spec §7.2) |
| `infra/sam/deploy-staging.sh` | New env vars: `AI_STUB`, `OPENROUTER_API_KEY` (reuses existing), `AI_QUEUE_URL` |

### Frontend — new files

| File | Responsibility |
|---|---|
| `frontend/src/pages/admin/AdminAppShell.jsx` | Header + role badge + sign-out (matches dashboard screenshot top bar) |
| `frontend/src/pages/admin/LeadershipDashboard.jsx` | Wraps the existing leadership.jsx prototype, rewired to real fetches |
| `frontend/src/pages/admin/AdminUserList.jsx` | List page admin uses to find a user → drill into detail |
| `frontend/src/pages/admin/AdminUserDetail.jsx` | The 4-section profile page from screenshots, mode="admin" |
| `frontend/src/pages/admin/AdminAddUser.jsx` | "Create new user" form (spec §5.1 POST /admin/users) |
| `frontend/src/pages/admin/ApplicationDetailStub.jsx` | Phase 1 destination for "Open full review" — just renders the existing AppDrawer content full-page |
| `frontend/src/pages/reviewer/ReviewerInboxStub.jsx` | Empty/list placeholder reviewers land on; Phase 1.5 turns it into a real inbox |
| `frontend/src/components/ProfileShell.jsx` | Shared component for self + admin user-mgmt; 4 sections from screenshots |
| `frontend/src/components/RoleSwitcher.jsx` | Section 02 of profile — 6 role cards; mode="self" shows SWITCH, mode="admin" shows GRANT/REVOKE |
| `frontend/src/components/StatusChip.jsx` | Spec component 8.2 — coloured status pills used in tables/cards |
| `frontend/src/components/ScoreBar.jsx` | Spec component 8.1 — used in drawer + table rows |
| `frontend/src/components/leadership/MetricCard.jsx` | Lifted from prototype |
| `frontend/src/components/leadership/FunnelStrip.jsx` | Lifted from prototype |
| `frontend/src/components/leadership/ScoreHistogram.jsx` | Lifted from prototype |
| `frontend/src/components/leadership/ComponentBars.jsx` | Lifted from prototype |
| `frontend/src/components/leadership/IndustryBars.jsx` | Lifted from prototype |
| `frontend/src/components/leadership/StatusGrid.jsx` | Lifted from prototype |
| `frontend/src/components/leadership/ApplicationsTable.jsx` | Lifted from prototype |
| `frontend/src/components/leadership/AppDrawer.jsx` | Lifted from prototype + 3 buttons wired to real APIs |
| `frontend/src/components/leadership/AssignReviewerModal.jsx` | New — picker triggered from drawer |
| `frontend/src/hooks/useRoles.js` | Read roles from useAuth |
| `frontend/src/hooks/useCapability.js` | Wraps roles → capability check |
| `frontend/src/hooks/useLeadershipStats.js` | SWR-style fetcher for `/leadership/stats/*` |
| `frontend/src/hooks/useAdminUsers.js` | Fetch/create/update users |
| `frontend/src/lib/adminApi.js` | Centralised API client for admin endpoints |
| `frontend/src/lib/rbac.js` | Frontend ROLE_CAPABILITIES mirror (kept in sync via lint check or doc comment) |
| `frontend/src/styles-admin.css` | Lifted admin styles from prototype's styles.css |

### Frontend — modified files

| File | Change |
|---|---|
| `frontend/src/router.jsx` | Add `/admin/*` and `/reviewer/*` route trees |
| `frontend/src/hooks/useAuth.jsx` | Expose `roles` + `activeRole` from session |
| `frontend/src/lib/auth.js` | Parse roles + active_role from `/auth/me` response |
| `frontend/src/pages/SignInPage.jsx` | Post-signin role-aware redirect (applicant-only → `/apply`, otherwise → `/admin/dashboard`) |
| `frontend/src/styles.css` | Append admin shell + status chip + score bar tokens |

---

## Plan Structure

29 tasks total, sequenced for solo execution:

- **Task 1**: Worktree + branch verification + dev env
- **Task 2**: Backend RBAC foundation (`rbac.py` + tests)
- **Task 3**: Extend `get_current_user` to return roles
- **Task 4**: `GET /auth/me` returns roles + active_role
- **Task 5**: `POST /admin/users` (create user + assign role)
- **Task 6**: Frontend post-signin role routing
- **Task 7**: Admin Add User form (minimal end of vertical slice)
- **Task 8**: Reviewer inbox stub
- **Task 9**: **Vertical slice smoke test** (checkpoint — admin creates reviewer → reviewer signs in → sees inbox)
- **Task 10**: `GET /admin/users` + Admin User List page
- **Task 11**: `GET /admin/users/{id}` + `PATCH /admin/users/{id}` + Personal Info section
- **Task 12**: Role grant/revoke endpoints + last-admin protection
- **Task 13**: RoleSwitcher component + active_role switching
- **Task 14**: Password reset + sign out endpoints + UI
- **Task 15**: Audit log writer service + wire to user-mgmt endpoints
- **Task 16**: `GET /leadership/stats/*` endpoints
- **Task 17**: Lift leadership prototype into LeadershipDashboard (Dashboard tab) + wire stats
- **Task 18**: `GET /leadership/applications` endpoint
- **Task 19**: Leadership dashboard Applications tab wired
- **Task 20**: Status transition endpoint + audit + emails
- **Task 21**: Assign reviewer endpoint + modal + 3-cap + self-assignment block
- **Task 22**: Application detail stub page (for "Open full review")
- **Task 23**: SQS queue + DLQ + IAM in SAM template
- **Task 24**: AI worker Lambda + stub-mode + idempotency
- **Task 25**: Enqueue on submit (TIR + SIP routers) + real Gemini call gated behind AI_STUB
- **Task 26**: Email notifications service + 9 Resend triggers
- **Task 27**: Synthetic seed script + run
- **Task 28**: Phase 1 acceptance test pass — all 10 criteria from spec §14
- **Task 29**: **Udita UI polish phase**

---

## Task 1: Worktree, branch verification, and dev env

**Files:**
- Verify: `git branch`, `.env`, `node_modules`, `pip` deps

- [ ] **Step 1.1: Confirm branch state**

```bash
cd /Users/apple/Desktop/Final_AP_os
git branch --show-current
git fetch origin staging-role_based_dashboard
git log --oneline origin/staging-role_based_dashboard -5
```

Expected: current branch is `staging-role_based_dashboard`, log shows `e7b0085 docs(spec): screenshots are canonical, PDFs are context` at top.

- [ ] **Step 1.2: Check Python + Node tooling versions**

```bash
python3 --version
node --version
npm --version
sam --version
aws --version
```

Expected: Python 3.11+, Node 18+, npm 9+, SAM CLI 1.120+, AWS CLI v2.

- [ ] **Step 1.3: Verify staging env files exist and migration 014 is applied**

```bash
ls -la backend/.env.staging
python3 -c "
import pathlib
from supabase import create_client
env={}
for line in pathlib.Path('backend/.env.staging').read_text().splitlines():
    line=line.strip()
    if line and not line.startswith('#') and '=' in line:
        k,v=line.split('=',1); env[k.strip()]=v.strip().strip(chr(34)).strip(chr(39))
c=create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])
tables = ['user_roles','reviewer_assignments','reviews','ai_screening','application_status_log','audit_log_v2']
for t in tables:
    try:
        c.table(t).select('*').limit(1).execute()
        print(f'  ✓ {t}')
    except Exception as e:
        print(f'  ✗ {t} — {str(e)[:80]}')
"
```

Expected: 6 green checks — all migration 014 tables exist.

- [ ] **Step 1.4: Install / refresh dev dependencies**

```bash
cd backend && pip install -r requirements.txt
cd ../frontend && npm install
```

Expected: clean install, no errors.

- [ ] **Step 1.5: Confirm frontend dev server runs against staging API**

```bash
cd frontend
cat .env.local
npm run dev
```

Verify `.env.local` has `VITE_API_BASE_URL=https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com`. Hit http://localhost:5173 in browser, page should load.

- [ ] **Step 1.6: Commit the cleanup of staged state if any**

```bash
git status
# if clean — nothing to commit. if dirty:
# git add . && git commit -m "chore: dev env setup verified"
```

Expected: clean tree.

---

## Task 2: Backend RBAC foundation

**Files:**
- Create: `backend/app/rbac.py`
- Create: `backend/tests/test_rbac.py`

- [ ] **Step 2.1: Write the failing tests first**

Create `backend/tests/test_rbac.py`:

```python
"""Unit tests for the role/capability mapping."""
from app.rbac import (
    ROLE_CAPABILITIES,
    capabilities_for,
    has_capability,
)


def test_applicant_can_manage_own_draft():
    assert has_capability(["applicant"], "manage_own_draft") is True


def test_applicant_cannot_view_all_apps():
    assert has_capability(["applicant"], "view_all_apps") is False


def test_multi_role_unions_capabilities():
    # Someone with leadership + reviewer gets both sets.
    caps = capabilities_for(["leadership", "reviewer"])
    assert "view_all_apps" in caps          # from leadership
    assert "score_app" in caps              # from reviewer


def test_unknown_role_returns_empty():
    assert capabilities_for(["nonsense"]) == set()


def test_admin_can_grant_role():
    assert has_capability(["admin"], "grant_role") is True


def test_leadership_cannot_grant_role():
    # Leadership is strategic; user provisioning is admin-only.
    assert has_capability(["leadership"], "grant_role") is False


def test_admin_and_leadership_both_see_audit():
    assert has_capability(["admin"], "view_audit_log") is True
    assert has_capability(["leadership"], "view_audit_log") is True


def test_six_roles_in_constant():
    # Spec §3.1 — Phase 1 has exactly these six roles.
    assert set(ROLE_CAPABILITIES.keys()) == {
        "applicant", "founder", "reviewer", "mentor", "leadership", "admin"
    }
```

- [ ] **Step 2.2: Run the tests to confirm they fail with ImportError**

```bash
cd backend && pytest tests/test_rbac.py -v
```

Expected: All 8 tests fail with `ModuleNotFoundError: No module named 'app.rbac'`.

- [ ] **Step 2.3: Create the rbac module**

Create `backend/app/rbac.py`:

```python
"""Role-based access control — Phase 1.

Kept intentionally simple: a static role → capability map plus a FastAPI
dependency that asserts the caller's roles include a given capability.

If rules grow conditional/temporal (e.g. "reviewer can score X only if
assigned AND in their sector AND not already scored 3 times"), migrate
to Casbin or Cerbos. The `require_capability()` dep is the only API
surface to swap — handlers don't change.
"""
from __future__ import annotations

from typing import Set

from fastapi import Depends, HTTPException, status

from .deps import get_current_user


# ─── Capability map ──────────────────────────────────────────────────
# Keep in sync with frontend/src/lib/rbac.js — there's a code comment
# in both files reminding any editor to update the other.

ROLE_CAPABILITIES: dict[str, Set[str]] = {
    "applicant": {
        "manage_own_draft",
        "submit_app",
        "view_own_status",
    },
    "founder": {
        "view_own_milestones",
        "upload_milestone_evidence",
    },
    "reviewer": {
        "view_assigned_apps",
        "score_app",
        "comment_app",
        "decline_assignment",
    },
    "mentor": {
        "view_assigned_founders",
        "comment_founder",
    },
    "leadership": {
        "view_all_apps",
        "view_app_detail",
        "assign_reviewers",
        "change_app_status",
        "view_stats",
        "export_data",
        "view_audit_log",
    },
    "admin": {
        "manage_users",
        "grant_role",
        "revoke_role",
        "reset_password",
        "view_all_apps",
        "view_app_detail",
        "change_app_status",
        "view_audit_log",
        "manage_support",
    },
}


def capabilities_for(roles: list[str]) -> set[str]:
    """Union of capabilities across a user's roles."""
    out: set[str] = set()
    for r in roles:
        out |= ROLE_CAPABILITIES.get(r, set())
    return out


def has_capability(roles: list[str], cap: str) -> bool:
    return cap in capabilities_for(roles)


# ─── FastAPI dep factory ─────────────────────────────────────────────

def require_capability(cap: str):
    """Build a FastAPI dependency that 403s if the current user lacks `cap`.

    Reads roles from the dict returned by get_current_user (extended in
    Task 3 to include a `roles` list).
    """
    async def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        roles = current_user.get("roles", []) or []
        if not has_capability(roles, cap):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "missing_capability",
                    "required": cap,
                    "your_roles": roles,
                },
            )
        return current_user
    return _dep
```

- [ ] **Step 2.4: Run tests — all 8 should pass**

```bash
pytest tests/test_rbac.py -v
```

Expected: 8 passed.

- [ ] **Step 2.5: Commit**

```bash
git add backend/app/rbac.py backend/tests/test_rbac.py
git commit -m "feat(rbac): role→capability map + require_capability FastAPI dep

Phase 1 spec §3.2. Six roles (applicant, founder, reviewer, mentor,
leadership, admin) with disjoint-but-overlapping capabilities. Multi-role
users get the union of their capabilities. require_capability(cap) is
the only API surface — handlers attach it as a dep and get a 403 with
{code: missing_capability, required, your_roles} when missing."
```

---

## Task 3: Extend `get_current_user` to return roles

**Files:**
- Modify: `backend/app/deps.py`
- Modify: `backend/tests/test_rbac.py` (add an integration test)

- [ ] **Step 3.1: Read current deps.py to find the insertion point**

```bash
grep -n "return {" backend/app/deps.py
```

Find the line `return {"user_id": user.id, "email": user.email, "track": track}` (currently the only return).

- [ ] **Step 3.2: Modify deps.py to fetch and include roles**

Edit `backend/app/deps.py` to replace the final return with:

```python
    # Fetch the user's roles for RBAC. Single query per request; cheap.
    # Empty list if user is brand new (no roles granted yet — they're an
    # applicant only and we leave the inference to the frontend by URL).
    roles: list[str] = []
    try:
        roles_res = (
            client.table("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .execute()
        )
        roles = [row["role"] for row in (roles_res.data or [])]
    except Exception:
        # Non-fatal: routes that don't depend on a specific capability
        # still work; routes that do will 403 via require_capability.
        pass

    return {
        "user_id": user.id,
        "email": user.email,
        "track": track,
        "roles": roles,
    }
```

- [ ] **Step 3.3: Verify the change compiles**

```bash
cd backend
python3 -c "from app.deps import get_current_user; print(get_current_user.__name__)"
```

Expected: `get_current_user`.

- [ ] **Step 3.4: Manual sanity check against staging — call /auth/me with a real token**

```bash
# Skip if you don't have a session handy; the integration test in Task 4 will catch it.
```

- [ ] **Step 3.5: Commit**

```bash
git add backend/app/deps.py
git commit -m "feat(deps): include roles list in get_current_user return

Fetches user_roles for the authed user in a single query per request.
Empty list when no roles granted (pure applicants). Roles are consumed
by require_capability() and surfaced via /auth/me in Task 4."
```

---

## Task 4: `GET /auth/me` returns roles + active_role

**Files:**
- Modify: `backend/app/routers/auth.py`
- Modify: `backend/app/models/auth.py` (if not present, create the response model)

- [ ] **Step 4.1: Find or create the auth router's /me endpoint**

```bash
grep -rn "auth/me\|/me\b" backend/app/routers/auth.py
```

If `/auth/me` already exists, jump to step 4.3. If not, continue.

- [ ] **Step 4.2: Add the /me endpoint to auth.py**

Append to `backend/app/routers/auth.py`:

```python
from ..deps import get_current_user
from ..supabase_client import get_admin_client


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Returns the authenticated user's identity + roles + active_role.

    Frontend useAuth() reads this on app boot to populate the session
    object. Roles drive the post-signin redirect; active_role drives
    which dashboard renders.
    """
    user_id = current_user["user_id"]
    client = get_admin_client()

    # Pull profile fields including active_role (added by migration 014).
    prof_res = (
        client.table("profiles")
        .select("active_role, full_name, phone, linkedin_url, location_city")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    prof = (prof_res.data or [{}])[0]

    return {
        "user_id": user_id,
        "email": current_user["email"],
        "track": current_user.get("track"),
        "roles": current_user.get("roles", []),
        "active_role": prof.get("active_role"),
        "profile": {
            "full_name": prof.get("full_name"),
            "phone": prof.get("phone"),
            "linkedin_url": prof.get("linkedin_url"),
            "location_city": prof.get("location_city"),
        },
    }
```

- [ ] **Step 4.3: Manually test against staging**

Sign in via the existing wizard, grab the JWT from devtools, then:

```bash
TOKEN="paste-jwt-here"
curl -s -H "Authorization: Bearer $TOKEN" \
  https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com/auth/me \
  | python3 -m json.tool
```

Expected: JSON with user_id, email, roles (likely empty for fresh users), active_role (null), profile object.

- [ ] **Step 4.4: Commit**

```bash
git add backend/app/routers/auth.py
git commit -m "feat(auth): /auth/me returns roles + active_role + profile fields

Frontend useAuth() will read this on boot to populate session and drive
role-aware post-signin redirect. active_role is the UI navigation
device (NOT a permission gate)."
```

---

## Task 5: `POST /admin/users` (create user + assign role)

**Files:**
- Create: `backend/app/routers/admin_users.py`
- Modify: `backend/app/main.py` (register the router)
- Create: `backend/tests/test_admin_users.py`

- [ ] **Step 5.1: Create the router**

Create `backend/app/routers/admin_users.py`:

```python
"""Admin endpoints for user provisioning + role management.

Implements spec §5.1. Every endpoint is gated by an admin capability:
  - manage_users for list/create/edit
  - grant_role / revoke_role for role mutations
  - reset_password for password reset
"""
from __future__ import annotations

import logging
import re
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field

from ..deps import get_current_user
from ..rbac import ROLE_CAPABILITIES, require_capability
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/users", tags=["admin"])


# ─── Request models ─────────────────────────────────────────────────

class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    organization: str | None = Field(default=None, max_length=200)
    role_title: str | None = Field(default=None, max_length=200)
    roles: list[str] = Field(..., min_length=1, max_length=6)
    send_invite: bool = Field(default=True)


# ─── Endpoints ──────────────────────────────────────────────────────

@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_capability("manage_users"))],
)
async def create_user(
    body: CreateUserRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a new auth user, write profile, assign roles, optionally
    send a magic-link invite via Supabase.

    Validates that every requested role is one of the 6 known roles.
    Stores `granted_by` = current admin's user_id for audit purposes.
    """
    client = get_admin_client()

    # Validate every role is known
    valid_roles = set(ROLE_CAPABILITIES.keys())
    bad = [r for r in body.roles if r not in valid_roles]
    if bad:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_role",
                "invalid": bad,
                "valid": sorted(valid_roles),
            },
        )

    # Create auth user. Use a strong temp password the admin shares
    # manually, OR send Supabase's magic-link email if send_invite=true.
    temp_password = secrets.token_urlsafe(16)
    try:
        if body.send_invite:
            invite = client.auth.admin.invite_user_by_email(body.email)
            new_user = invite.user
        else:
            create = client.auth.admin.create_user({
                "email": body.email,
                "password": temp_password,
                "email_confirm": True,
            })
            new_user = create.user
    except Exception as exc:
        msg = str(exc)
        # Most common case — email already exists in auth.
        if "already" in msg.lower() or "registered" in msg.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "email_exists", "email": body.email},
            )
        log.error("admin create_user failed",
                  extra={"email": body.email, "err": msg})
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "auth_create_failed", "message": msg[:200]},
        )

    new_user_id = new_user.id

    # Upsert profile row (Supabase auth user trigger may have created
    # an empty profile; we fill the fields the admin gave us).
    client.table("profiles").upsert({
        "id": new_user_id,
        "email": body.email,
        "full_name": body.full_name,
        "phone": body.phone,
        "location_city": body.organization,   # reuses existing column
        # role_title isn't in profiles yet — track in user_roles only for now
    }).execute()

    # Insert user_roles rows
    rows = [
        {
            "user_id": new_user_id,
            "role": r,
            "granted_by": current_user["user_id"],
        }
        for r in body.roles
    ]
    client.table("user_roles").insert(rows).execute()

    return {
        "id": new_user_id,
        "email": body.email,
        "full_name": body.full_name,
        "roles": body.roles,
        "temp_password": None if body.send_invite else temp_password,
        "invite_sent": body.send_invite,
    }
```

- [ ] **Step 5.2: Register the router in main.py**

Edit `backend/app/main.py` — find the existing `app.include_router(...)` calls and append:

```python
from .routers import admin_users
# ... existing includes ...
app.include_router(admin_users.router)
```

- [ ] **Step 5.3: Write integration test**

Create `backend/tests/test_admin_users.py`:

```python
"""Smoke test for admin user creation. Skipped in CI by default — runs
against staging Supabase, which means it actually mutates data. Run
manually with:
    pytest tests/test_admin_users.py -v -m staging
"""
import os
import pytest
import secrets

pytestmark = pytest.mark.staging


@pytest.mark.skipif(
    not os.getenv("RUN_STAGING_TESTS"),
    reason="set RUN_STAGING_TESTS=1 to enable",
)
def test_admin_can_create_reviewer(staging_admin_token, staging_base_url):
    """Admin creates a brand new reviewer; verifies the response shape
    and that the user_roles row landed."""
    import httpx

    rand_email = f"test-rv-{secrets.token_hex(4)}@artpark.in"
    r = httpx.post(
        f"{staging_base_url}/admin/users",
        headers={"Authorization": f"Bearer {staging_admin_token}"},
        json={
            "email": rand_email,
            "full_name": "Test Reviewer",
            "phone": "+91 99999 00000",
            "roles": ["reviewer"],
            "send_invite": False,
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["email"] == rand_email
    assert data["roles"] == ["reviewer"]
    assert data["temp_password"]  # not none since send_invite=false
```

(The fixtures `staging_admin_token` and `staging_base_url` need to be defined in `conftest.py` — add them in Task 9 when we do the smoke test.)

- [ ] **Step 5.4: Deploy backend to staging**

```bash
cd infra/sam && ./deploy-staging.sh
```

Expected: stack update succeeds.

- [ ] **Step 5.5: Manually verify endpoint exists (will 401 without auth)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com/admin/users
```

Expected: `401`. (Endpoint exists; auth missing.)

- [ ] **Step 5.6: Commit**

```bash
git add backend/app/routers/admin_users.py backend/app/main.py backend/tests/test_admin_users.py
git commit -m "feat(admin): POST /admin/users — provision new user + assign roles

Spec §5.1 first endpoint. Admin-only (require_capability(manage_users)).
Supports send_invite=true (magic link via Supabase) or false (returns
temp password for manual sharing). Validates all 6 known roles, writes
profile + user_roles atomically, captures granted_by for audit."
```

---

## Task 6: Frontend post-signin role routing

**Files:**
- Modify: `frontend/src/hooks/useAuth.jsx`
- Modify: `frontend/src/lib/auth.js`
- Modify: `frontend/src/pages/SignInPage.jsx`
- Create: `frontend/src/lib/rbac.js`

- [ ] **Step 6.1: Mirror the backend ROLE_CAPABILITIES in the frontend**

Create `frontend/src/lib/rbac.js`:

```javascript
// MUST be kept in sync with backend/app/rbac.py ROLE_CAPABILITIES.
// If you edit either, edit both. There's a Phase 2 CI lint that
// compares the two; for Phase 1 just be careful.

export const ROLE_CAPABILITIES = Object.freeze({
  applicant: new Set([
    "manage_own_draft",
    "submit_app",
    "view_own_status",
  ]),
  founder: new Set([
    "view_own_milestones",
    "upload_milestone_evidence",
  ]),
  reviewer: new Set([
    "view_assigned_apps",
    "score_app",
    "comment_app",
    "decline_assignment",
  ]),
  mentor: new Set([
    "view_assigned_founders",
    "comment_founder",
  ]),
  leadership: new Set([
    "view_all_apps",
    "view_app_detail",
    "assign_reviewers",
    "change_app_status",
    "view_stats",
    "export_data",
    "view_audit_log",
  ]),
  admin: new Set([
    "manage_users",
    "grant_role",
    "revoke_role",
    "reset_password",
    "view_all_apps",
    "view_app_detail",
    "change_app_status",
    "view_audit_log",
    "manage_support",
  ]),
});

export function capabilitiesFor(roles) {
  const out = new Set();
  for (const r of roles || []) {
    const set = ROLE_CAPABILITIES[r];
    if (set) for (const c of set) out.add(c);
  }
  return out;
}

export function hasCapability(roles, cap) {
  return capabilitiesFor(roles).has(cap);
}

// Roles that should land on the admin shell post-signin.
export const ADMIN_SHELL_ROLES = new Set([
  "leadership", "admin", "reviewer", "mentor",
]);

export function shouldRouteToAdminShell(roles) {
  return (roles || []).some((r) => ADMIN_SHELL_ROLES.has(r));
}
```

- [ ] **Step 6.2: Extend useAuth to expose roles + activeRole**

Find the current `useAuth.jsx` shape. Most likely it sets a `user` object after reading `/auth/me`. Modify it so the user object includes `roles` and `activeRole`:

```bash
grep -n "auth/me\|setUser\|user_id" frontend/src/hooks/useAuth.jsx | head -10
```

Edit `useAuth.jsx` — wherever `/auth/me` response is parsed, ensure the user object stored in state includes:

```javascript
setUser({
  user_id: data.user_id,
  email: data.email,
  track: data.track,
  roles: data.roles || [],
  active_role: data.active_role || null,
  full_name: data.profile?.full_name || null,
  // ... other existing fields
});
```

(Replace the existing `setUser(...)` call wherever it lives.)

- [ ] **Step 6.3: Update SignInPage to redirect by role**

Find the post-signin redirect logic:

```bash
grep -n "navigate\|redirect\|location" frontend/src/pages/SignInPage.jsx
```

Add at the top of `SignInPage.jsx`:

```javascript
import { shouldRouteToAdminShell } from "../lib/rbac.js";
```

Modify the success handler — after `await login(...)` resolves:

```javascript
// Fetch latest /auth/me to get roles, then route accordingly.
const me = await apiCall("/auth/me");
const next = params.get("next");
if (next && next.startsWith("/")) {
  navigate(next, { replace: true });
} else if (shouldRouteToAdminShell(me.roles)) {
  navigate("/admin/dashboard", { replace: true });
} else {
  // Applicant-only path
  navigate("/apply", { replace: true });
}
```

- [ ] **Step 6.4: Add `/admin/dashboard` route stub**

Edit `frontend/src/router.jsx` to add a temporary route:

```javascript
<Route
  path="/admin/dashboard"
  element={
    <ProtectedRoute>
      <div style={{ padding: 40 }}>
        <h1>Admin shell — Task 17 will replace this</h1>
        <p>Signed in successfully. Roles loaded.</p>
      </div>
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 6.5: Build to verify no syntax errors**

```bash
cd frontend && npm run build
```

Expected: clean build, dist/ produced.

- [ ] **Step 6.6: Commit**

```bash
git add frontend/src/lib/rbac.js frontend/src/hooks/useAuth.jsx \
  frontend/src/pages/SignInPage.jsx frontend/src/router.jsx
git commit -m "feat(auth): frontend rbac mirror + role-aware post-signin redirect

ROLE_CAPABILITIES mirrors backend/app/rbac.py (must hand-keep in sync).
useAuth now exposes roles + active_role. SignInPage routes non-applicant
roles to /admin/dashboard (placeholder until Task 17 lands the real
leadership shell)."
```

---

## Task 7: Admin Add User form (minimal end of vertical slice)

**Files:**
- Create: `frontend/src/pages/admin/AdminAddUser.jsx`
- Create: `frontend/src/lib/adminApi.js`
- Modify: `frontend/src/router.jsx`

- [ ] **Step 7.1: Create the admin API helper**

Create `frontend/src/lib/adminApi.js`:

```javascript
import { apiCall } from "./api.js";

export const adminApi = {
  createUser: (payload) =>
    apiCall("/admin/users", { method: "POST", body: payload }),
  listUsers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiCall(`/admin/users${qs ? "?" + qs : ""}`);
  },
  getUser: (userId) => apiCall(`/admin/users/${userId}`),
  patchUser: (userId, patch) =>
    apiCall(`/admin/users/${userId}`, { method: "PATCH", body: patch }),
  grantRole: (userId, role) =>
    apiCall(`/admin/users/${userId}/roles`, {
      method: "POST",
      body: { role },
    }),
  revokeRole: (userId, role) =>
    apiCall(`/admin/users/${userId}/roles/${role}`, { method: "DELETE" }),
  resetPassword: (userId) =>
    apiCall(`/admin/users/${userId}/password-reset`, { method: "POST" }),
};
```

- [ ] **Step 7.2: Create the AdminAddUser page**

Create `frontend/src/pages/admin/AdminAddUser.jsx`:

```jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/adminApi.js";

const ROLES = [
  { id: "leadership", label: "Leadership" },
  { id: "admin",      label: "Admin" },
  { id: "reviewer",   label: "Reviewer" },
  { id: "mentor",     label: "Mentor" },
  { id: "founder",    label: "Founder" },
  { id: "applicant",  label: "Applicant (rare for invites)" },
];

export default function AdminAddUser() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [org, setOrg] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [selectedRoles, setSelectedRoles] = useState(new Set(["reviewer"]));
  const [sendInvite, setSendInvite] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const toggleRole = (r) => {
    const next = new Set(selectedRoles);
    if (next.has(r)) next.delete(r); else next.add(r);
    setSelectedRoles(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setResult(null); setSubmitting(true);
    try {
      const r = await adminApi.createUser({
        email: email.trim(),
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        organization: org.trim() || null,
        role_title: roleTitle.trim() || null,
        roles: Array.from(selectedRoles),
        send_invite: sendInvite,
      });
      setResult(r);
    } catch (e) {
      setError(e?.details?.code || e?.message || "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div style={{ padding: 40, maxWidth: 720 }}>
        <h1>User created ✓</h1>
        <p><strong>Email:</strong> {result.email}</p>
        <p><strong>Roles:</strong> {result.roles.join(", ")}</p>
        {result.invite_sent
          ? <p>Magic-link invite email sent.</p>
          : <p><strong>Temp password (share manually):</strong> <code>{result.temp_password}</code></p>}
        <button onClick={() => { setResult(null); setEmail(""); setFullName(""); }}>
          Add another
        </button>
        <button onClick={() => navigate("/admin/dashboard")} style={{ marginLeft: 12 }}>
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40, maxWidth: 720 }}>
      <h1>Add user</h1>
      <form onSubmit={submit}>
        <label>Email
          <input value={email} onChange={(e) => setEmail(e.target.value)}
            type="email" required />
        </label><br/>
        <label>Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)}
            required />
        </label><br/>
        <label>Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label><br/>
        <label>Organisation
          <input value={org} onChange={(e) => setOrg(e.target.value)} />
        </label><br/>
        <label>Role / Title
          <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
        </label>
        <fieldset>
          <legend>Roles (one or more)</legend>
          {ROLES.map((r) => (
            <label key={r.id} style={{ display: "block" }}>
              <input type="checkbox" checked={selectedRoles.has(r.id)}
                onChange={() => toggleRole(r.id)} />
              {r.label}
            </label>
          ))}
        </fieldset>
        <label>
          <input type="checkbox" checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)} />
          Send magic-link invite email (uncheck to get a temp password instead)
        </label><br/>
        <button type="submit" disabled={submitting || selectedRoles.size === 0}>
          {submitting ? "Creating…" : "Create user"}
        </button>
        {error && <p style={{ color: "red" }}>Error: {error}</p>}
      </form>
    </div>
  );
}
```

(Visual polish later — Task 29 Udita.)

- [ ] **Step 7.3: Register the route**

Edit `frontend/src/router.jsx` — add inside the routes block:

```jsx
import AdminAddUser from "./pages/admin/AdminAddUser.jsx";
// ...
<Route
  path="/admin/users/new"
  element={<ProtectedRoute><AdminAddUser /></ProtectedRoute>}
/>
```

- [ ] **Step 7.4: Build + commit**

```bash
cd frontend && npm run build
git add frontend/src/lib/adminApi.js frontend/src/pages/admin/AdminAddUser.jsx \
  frontend/src/router.jsx
git commit -m "feat(admin): minimal AddUser form + adminApi helper

Functional form (no styling) so the vertical slice end-to-end test in
Task 9 works. Udita polishes the UI in Task 29 against the screenshots."
```

---

## Task 8: Reviewer inbox stub

**Files:**
- Create: `frontend/src/pages/reviewer/ReviewerInboxStub.jsx`
- Modify: `frontend/src/router.jsx`
- Modify: `frontend/src/pages/SignInPage.jsx` (reviewer routes to /reviewer/inbox not /admin/dashboard)

- [ ] **Step 8.1: Create the inbox stub**

Create `frontend/src/pages/reviewer/ReviewerInboxStub.jsx`:

```jsx
import { useAuth } from "../../hooks/useAuth.jsx";

export default function ReviewerInboxStub() {
  const { user } = useAuth();
  return (
    <div style={{ padding: 40, maxWidth: 720 }}>
      <h1>Reviewer inbox</h1>
      <p>Signed in as <strong>{user?.email}</strong></p>
      <p>You'll see applications assigned to you here.</p>
      <p style={{ color: "#888" }}>
        <em>The scoring interface arrives in Phase 1.5 — shortly after Phase 1 ships.</em>
      </p>
    </div>
  );
}
```

- [ ] **Step 8.2: Register the route**

Edit `frontend/src/router.jsx`:

```jsx
import ReviewerInboxStub from "./pages/reviewer/ReviewerInboxStub.jsx";
// ...
<Route
  path="/reviewer/inbox"
  element={<ProtectedRoute><ReviewerInboxStub /></ProtectedRoute>}
/>
```

- [ ] **Step 8.3: Update SignInPage to route reviewers separately**

Open `frontend/src/pages/SignInPage.jsx` and modify the post-signin redirect logic:

```javascript
const me = await apiCall("/auth/me");
const next = params.get("next");
if (next && next.startsWith("/")) {
  navigate(next, { replace: true });
} else if (me.roles?.includes("leadership") || me.roles?.includes("admin")) {
  navigate("/admin/dashboard", { replace: true });
} else if (me.roles?.includes("reviewer")) {
  navigate("/reviewer/inbox", { replace: true });
} else if (me.roles?.includes("mentor")) {
  navigate("/mentor/founders", { replace: true });
} else {
  // Applicant-only path
  navigate("/apply", { replace: true });
}
```

- [ ] **Step 8.4: Build + commit**

```bash
cd frontend && npm run build
git add frontend/src/pages/reviewer/ReviewerInboxStub.jsx \
  frontend/src/router.jsx frontend/src/pages/SignInPage.jsx
git commit -m "feat(reviewer): inbox stub + role-aware post-signin redirect

Reviewer-only accounts land on /reviewer/inbox; leadership/admin go to
/admin/dashboard. Mentor route reserved as a stub for Phase 2.
The actual scoring UI is Phase 1.5."
```

---

## Task 9: ✅ CHECKPOINT — Vertical slice smoke test

**Files:** none modified — manual verification only.

This is the first ship-readiness gate. If it doesn't pass, fix before moving on.

- [ ] **Step 9.1: Deploy backend to staging**

```bash
cd /Users/apple/Desktop/Final_AP_os/infra/sam && ./deploy-staging.sh
```

Expected: stack update succeeds.

- [ ] **Step 9.2: Push frontend**

```bash
cd /Users/apple/Desktop/Final_AP_os
git push origin staging-role_based_dashboard
```

Wait ~2 min for Vercel preview build to complete. Check status:
```bash
# Visit https://vercel.com/dashboard and find the staging-role_based_dashboard preview deployment
```

- [ ] **Step 9.3: Manually grant admin role to your test account**

```bash
python3 << 'EOF'
import pathlib
from supabase import create_client
env = {}
for line in pathlib.Path("backend/.env.staging").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
c = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

# Find dev@artpark.in
users = c.auth.admin.list_users(page=1, per_page=200)
dev = next((u for u in users if u.email == "dev@artpark.in"), None)
assert dev, "dev@artpark.in not found"

# Grant admin role
c.table("user_roles").upsert({
    "user_id": dev.id, "role": "admin", "granted_by": dev.id
}).execute()
print(f"✓ Granted admin to dev@artpark.in ({dev.id})")
EOF
```

Expected: `✓ Granted admin to dev@artpark.in (<uuid>)`.

- [ ] **Step 9.4: Smoke test in browser**

Open the Vercel preview URL for the branch (e.g. `ap-os-git-staging-role-based-dashboard-artpark.vercel.app`).

1. Sign in as `dev@artpark.in` / `staging-pass-2026`
2. **Expected:** redirect to `/admin/dashboard` (placeholder page)
3. Manually navigate to `/admin/users/new`
4. Fill the form: email `test-rv-{your-name}@artpark.in`, full name `Test Reviewer`, roles → check Reviewer, uncheck "Send invite", click **Create user**
5. **Expected:** see "User created ✓" with the temp password shown
6. Open an incognito window
7. Sign in as the new email with the temp password
8. **Expected:** redirect to `/reviewer/inbox` showing the stub

- [ ] **Step 9.5: Verify the DB state**

```bash
python3 << 'EOF'
import pathlib
from supabase import create_client
env = {}
for line in pathlib.Path("backend/.env.staging").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
c = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

# Find the new reviewer
users = c.auth.admin.list_users(page=1, per_page=200)
rv = next((u for u in users if u.email and "test-rv-" in u.email), None)
if rv:
    print(f"Auth user: {rv.email}  {rv.id}")
    roles = c.table("user_roles").select("role").eq("user_id", rv.id).execute()
    print(f"Roles: {[r['role'] for r in roles.data]}")
    prof = c.table("profiles").select("*").eq("id", rv.id).execute()
    print(f"Profile: {prof.data[0] if prof.data else '(missing)'}")
EOF
```

Expected: auth user exists, `user_roles` has `reviewer`, `profile` row has full_name set.

- [ ] **Step 9.6: Mark checkpoint passed**

If steps 9.4 and 9.5 both succeeded, the **vertical slice is proven end-to-end**. Auth, roles, post-signin routing, admin user creation, and reviewer signin all work.

If anything failed, fix before continuing. Common issues:
- 403 on POST /admin/users — dev@artpark.in doesn't have admin role yet (run 9.3)
- 401 on POST — token expired; sign in again
- Magic-link invite failing — Supabase email rate limit; flip `send_invite=false` and use temp password path
- Reviewer redirected to /apply instead of /reviewer/inbox — check `me.roles` payload in network tab

- [ ] **Step 9.7: Commit (or skip if no changes)**

```bash
git status
# expected: clean. If you tweaked anything to make the smoke pass, commit it now.
```

---

## Task 10: `GET /admin/users` + Admin User List page

**Files:**
- Modify: `backend/app/routers/admin_users.py`
- Create: `frontend/src/pages/admin/AdminUserList.jsx`
- Modify: `frontend/src/router.jsx`

- [ ] **Step 10.1: Add the list endpoint to the router**

Append to `backend/app/routers/admin_users.py`:

```python
@router.get(
    "",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def list_users(
    role: str | None = None,
    search: str | None = None,
    limit: int = 200,
):
    """List users with optional filters. Joins profiles + user_roles."""
    client = get_admin_client()

    # Pull profiles (single query); user_roles joined client-side.
    q = client.table("profiles").select(
        "id, email, full_name, phone, location_city, active_role, created_at"
    )
    if search:
        # Simple ILIKE on email and full_name
        q = q.or_(
            f"email.ilike.%{search}%,full_name.ilike.%{search}%"
        )
    q = q.order("created_at", desc=True).limit(limit)
    profs = (q.execute()).data or []

    # Pull all user_roles in one go (acceptable at our scale)
    rls = (
        client.table("user_roles")
        .select("user_id, role, granted_at")
        .execute()
    ).data or []
    roles_by_user: dict[str, list[str]] = {}
    for r in rls:
        roles_by_user.setdefault(r["user_id"], []).append(r["role"])

    rows = []
    for p in profs:
        user_roles = roles_by_user.get(p["id"], [])
        if role and role not in user_roles:
            continue
        rows.append({**p, "roles": user_roles})
    return {"users": rows, "total": len(rows)}
```

- [ ] **Step 10.2: Create the AdminUserList page**

Create `frontend/src/pages/admin/AdminUserList.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/adminApi.js";

export default function AdminUserList() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi.listUsers({ ...(search && { search }), ...(roleFilter && { role: roleFilter }) })
      .then((r) => { if (!cancelled) setUsers(r.users); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [search, roleFilter]);

  return (
    <div style={{ padding: 40, maxWidth: 1200 }}>
      <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <h1>Users</h1>
        <button onClick={() => navigate("/admin/users/new")}>+ Add user</button>
      </header>
      <div style={{ marginBottom: 16 }}>
        <input placeholder="search email / name…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginRight: 12, padding: 6, width: 240 }} />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          {["applicant", "founder", "reviewer", "mentor", "leadership", "admin"]
            .map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {loading
        ? <p>Loading…</p>
        : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ccc" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Name</th>
                <th style={{ textAlign: "left", padding: 8 }}>Email</th>
                <th style={{ textAlign: "left", padding: 8 }}>Roles</th>
                <th style={{ textAlign: "left", padding: 8 }}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}
                  onClick={() => navigate(`/admin/users/${u.id}`)}>
                  <td style={{ padding: 8 }}>{u.full_name || "(no name)"}</td>
                  <td style={{ padding: 8 }}>{u.email}</td>
                  <td style={{ padding: 8 }}>{u.roles.join(", ") || "(no roles)"}</td>
                  <td style={{ padding: 8 }}>{u.created_at?.slice(0, 10) || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
```

- [ ] **Step 10.3: Register route**

In `frontend/src/router.jsx`:

```jsx
import AdminUserList from "./pages/admin/AdminUserList.jsx";
// ...
<Route path="/admin/users" element={<ProtectedRoute><AdminUserList /></ProtectedRoute>} />
```

- [ ] **Step 10.4: Deploy + smoke test + commit**

```bash
cd infra/sam && ./deploy-staging.sh
cd ../.. && npm --prefix frontend run build
git add backend/app/routers/admin_users.py \
  frontend/src/pages/admin/AdminUserList.jsx frontend/src/router.jsx
git commit -m "feat(admin): GET /admin/users list endpoint + AdminUserList page

Spec §5.1. Search by name/email + role filter; clicking a row navigates
to /admin/users/:id (Task 11)."
```

Push and verify in browser.

---

## Task 11: `GET /admin/users/{id}` + `PATCH /admin/users/{id}` + Personal Info section

**Files:**
- Modify: `backend/app/routers/admin_users.py`
- Create: `frontend/src/pages/admin/AdminUserDetail.jsx`
- Create: `frontend/src/components/ProfileShell.jsx`

- [ ] **Step 11.1: Backend: GET single + PATCH endpoints**

Append to `backend/app/routers/admin_users.py`:

```python
class PatchUserRequest(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    organization: str | None = Field(default=None, max_length=200)
    role_title: str | None = Field(default=None, max_length=200)


@router.get(
    "/{user_id}",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def get_user(user_id: str):
    client = get_admin_client()
    prof = (
        client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
    ).data
    if not prof:
        raise HTTPException(404, detail={"code": "user_not_found"})
    p = prof[0]
    rls = (
        client.table("user_roles").select("role, granted_at, granted_by")
        .eq("user_id", user_id).execute()
    ).data or []
    return {**p, "roles": rls}


@router.patch(
    "/{user_id}",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def patch_user(user_id: str, body: PatchUserRequest):
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(400, detail={"code": "empty_patch"})
    client = get_admin_client()
    # Map "organization" → "location_city" (existing column reuse)
    if "organization" in patch:
        patch["location_city"] = patch.pop("organization")
    # role_title not yet a column — drop silently (forward-compat)
    patch.pop("role_title", None)
    client.table("profiles").update(patch).eq("id", user_id).execute()
    return {"ok": True, "patched": list(patch.keys())}
```

- [ ] **Step 11.2: Create ProfileShell component (section 01 only for now)**

Create `frontend/src/components/ProfileShell.jsx`:

```jsx
import { useState } from "react";

export default function ProfileShell({ user, mode = "self", onSave }) {
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [org, setOrg] = useState(user?.location_city || "");
  const [roleTitle, setRoleTitle] = useState(user?.role_title || "");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        full_name: fullName,
        phone,
        organization: org,
        role_title: roleTitle,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-shell">
      <section>
        <h2><span className="num">01</span> Personal information</h2>
        <form onSubmit={submit}>
          <label>FULL NAME
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label>EMAIL ADDRESS
            <input value={user?.email || ""} disabled />
            <span className="hint">↳ THIS IS YOUR LOGIN ID AND CAN'T BE CHANGED · CONTACT SUPPORT TO MIGRATE</span>
          </label>
          <label>PHONE NUMBER
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
          </label>
          <label>ORGANIZATION
            <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="IISc Bangalore" />
          </label>
          <label>ROLE / TITLE
            <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="PhD candidate" />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes ⏎"}
          </button>
        </form>
      </section>
      {/* Section 02 (RoleSwitcher) added in Task 13 */}
      {/* Section 03 (Change password) added in Task 14 */}
      {/* Section 04 (Account / Sign out) added in Task 14 */}
    </div>
  );
}
```

- [ ] **Step 11.3: Create AdminUserDetail page**

Create `frontend/src/pages/admin/AdminUserDetail.jsx`:

```jsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { adminApi } from "../../lib/adminApi.js";
import ProfileShell from "../../components/ProfileShell.jsx";

export default function AdminUserDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getUser(userId)
      .then(setUser)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  const onSave = async (patch) => {
    await adminApi.patchUser(userId, patch);
    const fresh = await adminApi.getUser(userId);
    setUser(fresh);
  };

  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (!user) return <div style={{ padding: 40 }}>Not found</div>;

  return (
    <div style={{ padding: 40, maxWidth: 1080 }}>
      <button onClick={() => navigate("/admin/users")}>← back to users</button>
      <ProfileShell user={user} mode="admin" onSave={onSave} />
    </div>
  );
}
```

- [ ] **Step 11.4: Register route**

```jsx
// router.jsx
import AdminUserDetail from "./pages/admin/AdminUserDetail.jsx";
<Route path="/admin/users/:userId" element={<ProtectedRoute><AdminUserDetail /></ProtectedRoute>} />
```

- [ ] **Step 11.5: Deploy + smoke**

Deploy backend, push frontend. Click any row in `/admin/users` — should land on the detail page with editable name/phone/org/title. Save → see updates persist.

- [ ] **Step 11.6: Commit**

```bash
git add backend/app/routers/admin_users.py \
  frontend/src/components/ProfileShell.jsx \
  frontend/src/pages/admin/AdminUserDetail.jsx \
  frontend/src/router.jsx
git commit -m "feat(admin): user detail page + ProfileShell section 01

Spec §5.1. GET /admin/users/:id + PATCH for personal info. ProfileShell
is the reusable component shared by self-service profile (later) and
admin user-mgmt — sections 02/03/04 added in Tasks 13–14."
```

---

## Task 12: Role grant/revoke + last-admin protection

**Files:**
- Modify: `backend/app/routers/admin_users.py`
- Create: `backend/tests/test_admin_users_roles.py` (manual / smoke)

- [ ] **Step 12.1: Backend endpoints**

Append to `admin_users.py`:

```python
class GrantRoleRequest(BaseModel):
    role: str


@router.post(
    "/{user_id}/roles",
    dependencies=[Depends(require_capability("grant_role"))],
    status_code=status.HTTP_201_CREATED,
)
async def grant_role(
    user_id: str,
    body: GrantRoleRequest,
    current_user: dict = Depends(get_current_user),
):
    if body.role not in ROLE_CAPABILITIES:
        raise HTTPException(400, detail={"code": "invalid_role", "role": body.role})
    client = get_admin_client()
    try:
        client.table("user_roles").insert({
            "user_id": user_id, "role": body.role,
            "granted_by": current_user["user_id"],
        }).execute()
    except Exception as exc:
        # Likely PK violation = already granted
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise HTTPException(409, detail={"code": "already_granted", "role": body.role})
        raise
    return {"ok": True, "role": body.role}


@router.delete(
    "/{user_id}/roles/{role}",
    dependencies=[Depends(require_capability("revoke_role"))],
)
async def revoke_role(user_id: str, role: str):
    if role not in ROLE_CAPABILITIES:
        raise HTTPException(400, detail={"code": "invalid_role", "role": role})

    client = get_admin_client()

    # Last-admin protection: if we're about to revoke 'admin' from the
    # only remaining admin user, refuse. Counts admin role assignments
    # across all users; if removing this one leaves zero, block.
    if role == "admin":
        total_admins = (
            client.table("user_roles").select("user_id", count="exact")
            .eq("role", "admin").execute()
        ).count or 0
        if total_admins <= 1:
            raise HTTPException(
                409,
                detail={
                    "code": "last_admin_protection",
                    "message": "Cannot revoke the last admin role.",
                },
            )

    client.table("user_roles").delete().eq("user_id", user_id).eq("role", role).execute()
    return {"ok": True, "role": role}
```

- [ ] **Step 12.2: Deploy + manual test**

```bash
cd infra/sam && ./deploy-staging.sh
```

In an SQL query window on Supabase, count admins:
```sql
select count(*) from user_roles where role='admin';
```

If count = 1 and you try to delete it via the API, you should get 409.

Manually grant a reviewer role to your existing test user:
```bash
TOKEN=...
curl -X POST "https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com/admin/users/<user_id>/roles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"reviewer"}'
```

Expected: 201 + `{ok: true, role: reviewer}`.

- [ ] **Step 12.3: Commit**

```bash
git add backend/app/routers/admin_users.py
git commit -m "feat(admin): grant/revoke role endpoints + last-admin protection

Spec §5.1, §9 edge cases. Granting an already-granted role 409s; revoking
the last admin 409s with last_admin_protection. UI for these endpoints
arrives with RoleSwitcher in Task 13."
```

---

## Task 13: RoleSwitcher component + active_role switching

**Files:**
- Create: `frontend/src/components/RoleSwitcher.jsx`
- Modify: `frontend/src/components/ProfileShell.jsx`
- Modify: `backend/app/routers/auth.py` (add /auth/me/active-role PATCH)

- [ ] **Step 13.1: Backend — set active_role**

Append to `backend/app/routers/auth.py`:

```python
from pydantic import BaseModel as _BM

class SetActiveRoleRequest(_BM):
    active_role: str | None  # nullable means "clear"


@router.patch("/me/active-role")
async def set_active_role(
    body: SetActiveRoleRequest,
    current_user: dict = Depends(get_current_user),
):
    """UI navigation device: pick which dashboard renders. NOT a permission
    gate — backend gates on the union of granted roles regardless.
    """
    if body.active_role is not None and body.active_role not in ROLE_CAPABILITIES:
        raise HTTPException(400, detail={"code": "invalid_role"})
    # Optional sanity: require the user actually has that role granted
    if body.active_role:
        granted = current_user.get("roles", [])
        if body.active_role not in granted:
            raise HTTPException(
                403,
                detail={"code": "role_not_granted", "role": body.active_role},
            )
    client = get_admin_client()
    client.table("profiles").update(
        {"active_role": body.active_role}
    ).eq("id", current_user["user_id"]).execute()
    return {"ok": True, "active_role": body.active_role}
```

(Add `from ..rbac import ROLE_CAPABILITIES` at the top of auth.py.)

- [ ] **Step 13.2: Create RoleSwitcher component**

Create `frontend/src/components/RoleSwitcher.jsx`:

```jsx
const ROLE_META = {
  applicant:  { label: "Applicant",  icon: "✏",  sub: "submit & track applications" },
  founder:    { label: "Founder",    icon: "★",  sub: "stay connected · open doors" },
  reviewer:   { label: "Reviewer",   icon: "▣",  sub: "evaluate submissions" },
  mentor:     { label: "Mentor",     icon: "◇",  sub: "guide cohort founders" },
  leadership: { label: "Leadership", icon: "✦",  sub: "strategy · oversight · approvals" },
  admin:      { label: "Admin",      icon: "⚙",  sub: "manage program & cohorts" },
};

const ALL_ROLES = ["applicant", "mentor", "reviewer", "founder", "admin", "leadership"];

export default function RoleSwitcher({
  grantedRoles,
  activeRole,
  mode = "self",          // "self" | "admin"
  onSwitch,                // (role) => Promise<void>
  onGrant,                 // (role) => Promise<void>   (admin mode only)
  onRevoke,                // (role) => Promise<void>   (admin mode only)
}) {
  const showAllRoles = mode === "admin";
  const roles = showAllRoles ? ALL_ROLES : grantedRoles;

  return (
    <section>
      <h2><span className="num">02</span> Active role</h2>
      <p>
        {mode === "self"
          ? "Your account has access to multiple roles in the ARTPARK ecosystem. Switch between them anytime — each role surfaces a different workspace and set of permissions."
          : "Grant or revoke roles on this user. Email is immutable."}
      </p>
      <div className="role-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {roles.map((r) => {
          const meta = ROLE_META[r];
          const granted = (grantedRoles || []).includes(r);
          const isActive = activeRole === r;
          return (
            <div key={r} className={`role-card ${isActive ? "is-active" : ""}`}
              style={{ border: isActive ? "2px solid blueviolet" : "1px solid #ccc", padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div><strong>{meta.icon} {meta.label}</strong></div>
                  <div style={{ color: "#888", fontSize: 13 }}>{meta.sub}</div>
                </div>
                <div>
                  {mode === "self" && (
                    isActive
                      ? <span style={{ color: "blueviolet", fontWeight: 600 }}>ACTIVE</span>
                      : granted
                        ? <button onClick={() => onSwitch(r)}>SWITCH →</button>
                        : null
                  )}
                  {mode === "admin" && (
                    granted
                      ? <button onClick={() => onRevoke(r)} style={{ color: "crimson" }}>REVOKE</button>
                      : <button onClick={() => onGrant(r)}>GRANT</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {mode === "self" && (
        <p style={{ fontSize: 12, color: "#888", marginTop: 12 }}>
          ↳ NEED A ROLE YOU DON'T SEE? REQUEST ACCESS FROM YOUR PROGRAM LEAD.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 13.3: Add Section 02 to ProfileShell**

Edit `frontend/src/components/ProfileShell.jsx` — pass through props and render RoleSwitcher:

```jsx
import RoleSwitcher from "./RoleSwitcher.jsx";

export default function ProfileShell({
  user, mode, onSave,
  // section 02 props:
  grantedRoles, activeRole, onSwitch, onGrant, onRevoke,
}) {
  // ... existing section 01 code ...
  
  // After </section> for section 01, add:
  return (
    <div className="profile-shell">
      {/* section 01 — keep existing JSX */}
      <RoleSwitcher
        grantedRoles={grantedRoles || []}
        activeRole={activeRole}
        mode={mode}
        onSwitch={onSwitch}
        onGrant={onGrant}
        onRevoke={onRevoke}
      />
    </div>
  );
}
```

- [ ] **Step 13.4: Wire in AdminUserDetail**

Edit `frontend/src/pages/admin/AdminUserDetail.jsx`:

```jsx
import { adminApi } from "../../lib/adminApi.js";

// inside component:
const grantedRoles = (user.roles || []).map((r) => r.role);
const onGrant = async (r) => {
  await adminApi.grantRole(userId, r);
  setUser(await adminApi.getUser(userId));
};
const onRevoke = async (r) => {
  await adminApi.revokeRole(userId, r);
  setUser(await adminApi.getUser(userId));
};

// pass to ProfileShell:
<ProfileShell
  user={user} mode="admin" onSave={onSave}
  grantedRoles={grantedRoles}
  activeRole={user.active_role}
  onGrant={onGrant} onRevoke={onRevoke}
/>
```

- [ ] **Step 13.5: Deploy + smoke + commit**

```bash
cd infra/sam && ./deploy-staging.sh
cd ../.. && npm --prefix frontend run build
git add backend/app/routers/auth.py \
  frontend/src/components/RoleSwitcher.jsx \
  frontend/src/components/ProfileShell.jsx \
  frontend/src/pages/admin/AdminUserDetail.jsx
git commit -m "feat(admin): role switcher (section 02) with grant/revoke

Spec §3.2, §5.1. Self-mode shows SWITCH on granted roles; admin-mode
shows GRANT/REVOKE on every role. PATCH /auth/me/active-role writes
profiles.active_role (UI navigation only, NOT a permission gate)."
```

---

## Task 14: Password reset + Sign out (sections 03 + 04 of ProfileShell)

**Files:**
- Modify: `backend/app/routers/admin_users.py`
- Modify: `frontend/src/components/ProfileShell.jsx`

- [ ] **Step 14.1: Backend password reset**

Append to `admin_users.py`:

```python
@router.post(
    "/{user_id}/password-reset",
    dependencies=[Depends(require_capability("reset_password"))],
)
async def reset_password(user_id: str):
    """Sends a Supabase-managed password reset email."""
    client = get_admin_client()
    # Look up the email
    prof = (
        client.table("profiles").select("email").eq("id", user_id).limit(1).execute()
    ).data
    if not prof:
        raise HTTPException(404, detail={"code": "user_not_found"})
    email = prof[0]["email"]
    try:
        client.auth.reset_password_for_email(email)
    except Exception as exc:
        raise HTTPException(
            502,
            detail={"code": "reset_send_failed", "message": str(exc)[:200]},
        )
    return {"ok": True, "email_sent_to": email}
```

- [ ] **Step 14.2: Add sections 03 + 04 to ProfileShell**

Append to ProfileShell.jsx (inside the same outer div):

```jsx
{/* Section 03 — change password (self-mode only) OR send reset link (admin-mode) */}
{mode === "self" && (
  <section>
    <h2><span className="num">03</span> Change password</h2>
    <p style={{ color: "#888" }}>
      Phase 1: handled by signing out and using "forgot password" on the sign-in page.
      A direct change-password flow lands in Phase 1.5.
    </p>
  </section>
)}
{mode === "admin" && onResetPassword && (
  <section>
    <h2><span className="num">03</span> Reset password</h2>
    <button onClick={() => onResetPassword()}>
      Send password-reset email to {user?.email}
    </button>
  </section>
)}

{/* Section 04 — Account / Sign out (self only) */}
{mode === "self" && onSignOut && (
  <section>
    <h2><span className="num">04</span> Account</h2>
    <button onClick={onSignOut}>Sign out</button>
    <p style={{ fontSize: 12, color: "#888" }}>
      ↳ YOUR DRAFT IS AUTO-SAVED · YOU CAN RETURN ANYTIME
    </p>
  </section>
)}
```

Add the `onResetPassword` and `onSignOut` props to the component signature.

- [ ] **Step 14.3: Wire reset-password in AdminUserDetail**

```jsx
// AdminUserDetail.jsx
const onResetPassword = async () => {
  const r = await adminApi.resetPassword(userId);
  alert(`Password reset email sent to ${r.email_sent_to}`);
};

<ProfileShell ... onResetPassword={onResetPassword} />
```

- [ ] **Step 14.4: Deploy + commit**

```bash
cd infra/sam && ./deploy-staging.sh
git add backend/app/routers/admin_users.py frontend/src/components/ProfileShell.jsx \
  frontend/src/pages/admin/AdminUserDetail.jsx
git commit -m "feat(admin): password reset trigger + ProfileShell sections 03/04

Self-mode section 03 is intentionally a Phase 1.5 stub (the screenshot
shows fields but a real change-password flow needs the current
password — defer). Admin-mode section 03 triggers a Supabase reset
email instead. Section 04 (Sign out) only in self-mode."
```

---

## Task 15: Audit log writer service + wire to user-mgmt endpoints

**Files:**
- Create: `backend/app/services/audit.py`
- Modify: `backend/app/routers/admin_users.py`

- [ ] **Step 15.1: Create the audit writer**

Create `backend/app/services/audit.py`:

```python
"""Helper for writing audit_log_v2 rows. Phase 1 has no UI surface for
the audit log (deferred to Phase 2), but every meaningful state change
must be captured so we have history when the UI lands."""
from __future__ import annotations

from typing import Any

from ..supabase_client import get_admin_client


def log_event(
    *,
    actor_user_id: str | None,
    actor_role: str | None,
    action_type: str,
    target_table: str | None = None,
    target_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
) -> None:
    """Append-only insert into audit_log_v2. Never raises — audit failure
    must not block the primary action."""
    try:
        get_admin_client().table("audit_log_v2").insert({
            "actor_user_id": actor_user_id,
            "actor_role": actor_role,
            "action_type": action_type,
            "target_table": target_table,
            "target_id": target_id,
            "before_state": before,
            "after_state": after,
            "reason": reason,
        }).execute()
    except Exception:
        # swallowed deliberately; do not let audit failure cascade
        pass
```

- [ ] **Step 15.2: Instrument all admin_users mutations**

In `admin_users.py`, add audit calls after each mutating operation. Example for `create_user`:

```python
from ..services.audit import log_event

# at the end of create_user, just before `return ...`:
log_event(
    actor_user_id=current_user["user_id"],
    actor_role="admin",
    action_type="user.created",
    target_table="profiles",
    target_id=new_user_id,
    after={"email": body.email, "roles": body.roles},
)
```

Add similar `log_event` calls in:
- `patch_user` — action_type=`user.profile_updated`, before/after diff
- `grant_role` — action_type=`role.granted`, after={role}
- `revoke_role` — action_type=`role.revoked`, before={role}
- `reset_password` — action_type=`user.password_reset_triggered`

- [ ] **Step 15.3: Deploy + verify**

```bash
cd infra/sam && ./deploy-staging.sh
```

Smoke test: create a user, check the audit log in Supabase:
```sql
select action_type, target_id, after_state, occurred_at 
from audit_log_v2 order by occurred_at desc limit 10;
```

Expected: see `user.created` rows.

- [ ] **Step 15.4: Commit**

```bash
git add backend/app/services/audit.py backend/app/routers/admin_users.py
git commit -m "feat(audit): log_event helper + instrument admin_users mutations

Every user create / profile edit / role grant / role revoke / password
reset writes a row to audit_log_v2. log_event() swallows its own
failures so audit infra issues never break the primary action.
UI for audit log feed is Phase 2."
```

---

## Task 16: `GET /leadership/stats/*` endpoints

**Files:**
- Create: `backend/app/routers/leadership.py`
- Modify: `backend/app/main.py` (register the router)

- [ ] **Step 16.1: Create the leadership router with all 6 stats endpoints**

Create `backend/app/routers/leadership.py`:

```python
"""Cross-track read-only endpoints for the Leadership dashboard.

Implements spec §5.2 (applications) and §5.3 (stats). Splits stats into
small composable endpoints so the leadership dashboard can cache each
chart independently.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..deps import get_current_user
from ..rbac import require_capability
from ..supabase_client import get_admin_client

router = APIRouter(prefix="/leadership", tags=["leadership"])


# ─── Helpers ────────────────────────────────────────────────────────

def _all_applications() -> list[dict]:
    """Return both tir + sip rows with a `track` field added.
    Single source of cohort data for stats. Capped at 5000 to be safe."""
    client = get_admin_client()
    tir = (
        client.table("tir_applications")
        .select("id, user_id, status, basic_full_name, basic_email, basic_org, submitted_at, created_at")
        .neq("status", "draft")
        .limit(5000).execute()
    ).data or []
    sip = (
        client.table("sip_applications")
        .select("id, user_id, status, basic_full_name, basic_email, basic_org, submitted_at, created_at")
        .neq("status", "draft")
        .limit(5000).execute()
    ).data or []
    for r in tir: r["track"] = "tir"
    for r in sip: r["track"] = "sip"
    return tir + sip


def _ai_scores() -> dict[str, dict]:
    """Map of `f'{track}/{app_id}'` → ai_screening row."""
    client = get_admin_client()
    rows = (
        client.table("ai_screening").select("*").limit(10000).execute()
    ).data or []
    return {f"{r['application_track']}/{r['application_id']}": r for r in rows}


# ─── Stats endpoints (spec §5.3) ────────────────────────────────────

@router.get(
    "/stats/overview",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def stats_overview():
    apps = _all_applications()
    client = get_admin_client()
    profiles_count = (
        client.table("profiles").select("id", count="exact").execute()
    ).count or 0

    tir_count = sum(1 for a in apps if a["track"] == "tir")
    sip_count = sum(1 for a in apps if a["track"] == "sip")
    advanced = sum(1 for a in apps
                   if a["status"] in ("shortlisted", "interview", "offered", "onboarded"))
    onboarded = sum(1 for a in apps if a["status"] == "onboarded")

    ai_map = _ai_scores()
    scored = [
        ai_map[f"{a['track']}/{a['id']}"]["score_overall"]
        for a in apps
        if ai_map.get(f"{a['track']}/{a['id']}", {}).get("score_overall") is not None
    ]
    avg_ai = round(sum(scored) / len(scored), 1) if scored else None

    return {
        "profiles_signed_up": profiles_count,
        "apps_submitted": len(apps),
        "tir_count": tir_count, "sip_count": sip_count,
        "advanced_past_review": advanced,
        "onboarded": onboarded,
        "avg_ai_score": avg_ai,
    }


@router.get(
    "/stats/funnel",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def stats_funnel():
    apps = _all_applications()
    client = get_admin_client()
    profiles_count = (
        client.table("profiles").select("id", count="exact").execute()
    ).count or 0

    def count_in(statuses): return sum(1 for a in apps if a["status"] in statuses)
    return {
        "profiles": profiles_count,
        "drafted": profiles_count,                   # placeholder — refine later
        "submitted": len(apps),
        "in_review": count_in({"ai_screening", "under_review"}),
        "advanced": count_in({"shortlisted", "interview"}),
        "decided": count_in({"offered", "onboarded"}),
    }


@router.get(
    "/stats/ai-distribution",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def stats_ai_distribution():
    apps = _all_applications()
    ai_map = _ai_scores()
    scores = []
    for a in apps:
        ai = ai_map.get(f"{a['track']}/{a['id']}")
        if ai and ai.get("score_overall") is not None:
            scores.append(float(ai["score_overall"]))
    # 10 buckets, 0-10
    buckets = [0] * 10
    for s in scores:
        idx = min(9, int(s))
        buckets[idx] += 1
    return {
        "buckets": [{"lo": i, "hi": i + 1, "n": buckets[i]} for i in range(10)],
        "n": len(scores),
        "mean": round(sum(scores) / len(scores), 1) if scores else None,
        "median": round(sorted(scores)[len(scores) // 2], 1) if scores else None,
    }


@router.get(
    "/stats/components",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def stats_components():
    apps = _all_applications()
    ai_map = _ai_scores()
    keys = ["score_problem", "score_solution", "score_tech",
            "score_founders", "score_commitment"]
    sums = {k: 0.0 for k in keys}
    n = {k: 0 for k in keys}
    for a in apps:
        ai = ai_map.get(f"{a['track']}/{a['id']}")
        if not ai: continue
        for k in keys:
            v = ai.get(k)
            if v is not None:
                sums[k] += float(v); n[k] += 1
    return {
        "components": [
            {
                "key": k,
                "avg": round(sums[k] / n[k], 1) if n[k] else None,
                "n": n[k],
            }
            for k in keys
        ]
    }


# Industry classifier: derive from basic_org or another column.
# For Phase 1 we'll just bucket by simple keywords; later phase moves
# this to a stored industry column on applications.
_INDUSTRIES = [
    ("robotics", "Robotics & Automation",
        ["robot", "drone", "uav", "rover", "automat"]),
    ("health",   "Healthcare / MedTech",
        ["health", "medic", "medtech", "clinic", "patient", "diagnos"]),
    ("industry", "Advanced Manufacturing / Industry 5.0",
        ["manufactur", "factory", "industrial", "assembly"]),
    ("defense",  "Defense & Aerospace",
        ["defence", "defense", "aerospace", "military", "missile"]),
    ("ai",       "Artificial Intelligence / Foundational Models",
        ["ai ", "llm", "language model", "neural", "ml ", "machine learning"]),
    ("semi",     "Semiconductor / Hardware",
        ["semiconduct", "chip", "fpga", "asic", "soc", "wafer"]),
]


def _classify_industry(app: dict) -> tuple[str, str]:
    text = " ".join(filter(None, [
        (app.get("basic_org") or "").lower(),
        # could include problem_describe, solution_describe — keep simple for now
    ]))
    for iid, label, kws in _INDUSTRIES:
        if any(k in text for k in kws):
            return iid, label
    return "other", "Other / Frontier"


@router.get(
    "/stats/industry",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def stats_industry():
    apps = _all_applications()
    counts: dict[str, dict] = {}
    for iid, label, _ in _INDUSTRIES + [("other", "Other / Frontier", [])]:
        counts[iid] = {"id": iid, "label": label, "n": 0}
    for a in apps:
        iid, _ = _classify_industry(a)
        counts[iid]["n"] += 1
    total = sum(c["n"] for c in counts.values())
    out = sorted(counts.values(), key=lambda x: -x["n"])
    return {"industries": out, "total": total}


@router.get(
    "/stats/status",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def stats_status():
    apps = _all_applications()
    statuses = [
        ("draft", "Draft"),
        ("submitted", "Submitted"),
        ("ai_screening", "AI screening"),
        ("under_review", "Under review"),
        ("evaluated", "Evaluated"),
        ("shortlisted", "Shortlisted"),
        ("interview", "Interview"),
        ("offered", "Offered"),
        ("onboarded", "Onboarded"),
        ("rejected", "Not selected"),
        ("waitlisted", "Waitlisted"),
        ("withdrawn", "Withdrawn"),
    ]
    counts = []
    for sid, label in statuses:
        n = sum(1 for a in apps if a["status"] == sid)
        counts.append({"id": sid, "label": label, "n": n})
    return {"statuses": counts}
```

- [ ] **Step 16.2: Register the router**

```python
# backend/app/main.py
from .routers import leadership
app.include_router(leadership.router)
```

- [ ] **Step 16.3: Deploy + manual test**

```bash
cd infra/sam && ./deploy-staging.sh
TOKEN=...  # leadership-role JWT
for ep in overview funnel ai-distribution components industry status; do
  echo "=== /leadership/stats/$ep ==="
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com/leadership/stats/$ep" \
    | python3 -m json.tool | head -20
done
```

Expected: 6 JSON responses, all 200. Numbers may be small/zero until the seed script in Task 27.

- [ ] **Step 16.4: Commit**

```bash
git add backend/app/routers/leadership.py backend/app/main.py
git commit -m "feat(leadership): 6 stats endpoints powering the dashboard charts

Spec §5.3. Each endpoint corresponds to one widget in the leadership
prototype: overview metrics, funnel, AI score distribution,
component bars, industry breakdown, status grid. Industry is derived
from basic_org keyword matching — refine to a stored column post-seed."
```

---

## Tasks 17–28: condensed roadmap

> **Note on remaining tasks:** Tasks 17–28 follow the same shape as Tasks 1–16 — file paths, code, deploy, commit. They're outlined here at chunk-level to keep the plan readable. The implementing agent should expand each into 5–10 step-by-step substeps using the patterns established above.

### Task 17: Lift the leadership prototype into LeadershipDashboard

- Copy `/Users/apple/Downloads/Application Form - 12 May/src/leadership.jsx` → `frontend/src/pages/admin/LeadershipDashboard.jsx`
- Extract the 8 internal components (MetricCard, FunnelStrip, ScoreHistogram, ComponentBars, IndustryBars, StatusGrid, ApplicationsTable, AppDrawer) into `frontend/src/components/leadership/*.jsx`
- Replace `getCohort()` with `useLeadershipStats()` hook that fans out to all 6 `/leadership/stats/*` endpoints in parallel
- Wire the Dashboard tab to render real values
- Add `/admin/dashboard` route pointing at this component (replacing the placeholder from Task 6)
- Lift `lp-*` CSS classes from prototype's `styles.css` into `frontend/src/styles-admin.css`
- Commit: `feat(leadership): Dashboard tab wired to real stats endpoints`

### Task 18: `GET /leadership/applications` endpoint

- Backend: `GET /leadership/applications` returning `{applications: [...], total}` with cross-track results
  - Query params: `track`, `industry`, `status`, `search`, `min_score`, `max_score`, `limit`, `offset`
  - Joins `ai_screening` for score columns
  - Implements spec §5.2 first row
- Add `getApplications(filters)` to `frontend/src/lib/leadershipApi.js`
- Commit: `feat(leadership): GET /leadership/applications cross-track list`

### Task 19: Leadership dashboard Applications tab

- Wire the existing `ApplicationsTable` from Task 17 to `getApplications`
- Wire filter pills (industry, status, TIR/SIP) + search input to the same fetch
- Wire row click → opens `AppDrawer` with full row data
- Drawer's three buttons get placeholder handlers (real handlers in Tasks 20, 21, 22)
- Commit: `feat(leadership): Applications tab wired + filters + drawer`

### Task 20: Status transition endpoint + Move to shortlist

- Backend: `POST /leadership/applications/{track}/{id}/status` with `{to_status, reason}`
  - Validate transitions against the state-machine map (spec §4.8)
  - Write `application_status_log` row
  - Write `audit_log_v2` row
  - Trigger email via `services/notifications.py` (Task 26 will fully wire emails)
- Frontend: drawer's "Move to shortlist" button hits this with `to_status=shortlisted`
- Commit: `feat(leadership): status transitions + audit log + state machine guard`

### Task 21: Assign reviewer endpoint + modal + 3-cap

- Backend: `POST /leadership/applications/{track}/{id}/reviewers` with `{reviewer_user_ids: [...]}` (1–3)
  - Reject if any user_id is the applicant themselves (self-assignment block)
  - Reject if total active assignments would exceed 3
  - Insert `reviewer_assignments` rows with `assigned_by = current_user`
  - Trigger email to each reviewer
- Frontend: `AssignReviewerModal.jsx` — fetches users with `reviewer` role, multi-select 1–3
- Wired to drawer's "Assign reviewer" button
- Commit: `feat(leadership): reviewer assignment modal + 3-cap + self-assign block`

### Task 22: Application detail stub

- Create `frontend/src/pages/admin/ApplicationDetailStub.jsx` — renders the same content the drawer shows but full-screen
- Route: `/admin/applications/:track/:id`
- Drawer's "Open full review" button navigates here
- Phase 2 will replace with the rich detail page from spec §A-2
- Commit: `feat(leadership): application detail stub for Open full review`

### Task 23: SQS queue + DLQ + IAM in SAM template

- Edit `infra/sam/template.yaml`:
  - Add `AiScreeningQueue` (FIFO, visibility 300s, max receive 3, content-based dedup)
  - Add `AiScreeningDLQ` (FIFO, retention 14 days)
  - Add IAM policy on existing `ApiFunction` for `sqs:SendMessage`
  - Add `AiWorkerFunction` with SQS event source mapping, reserved concurrency 10
  - Add CloudWatch alarm on DLQ depth > 0
- Deploy + verify with `aws sqs list-queues --region ap-south-1`
- Commit: `infra: SQS queue + DLQ + AiWorkerFunction + IAM policies + alarm`

### Task 24: AI worker Lambda + stub-mode + idempotency

- Create `backend/app/ai_worker.py`:
  - `lambda_handler(event, context)` parses SQS records
  - For each `{application_id, track}` message:
    - Set status → `ai_screening`
    - If `AI_STUB=true`: deterministic random scores via `hash(app_id)` seed
    - Else: call OpenRouter with `google/gemini-flash-latest` + rubric prompt from `ai_rubric.py`
    - Upsert `ai_screening` (unique on app_id+track)
    - Set status → `under_review`
    - Write `application_status_log` + `audit_log_v2` rows
- Create `backend/app/ai_rubric.py` with the placeholder prompt
- Add unit test `backend/tests/test_ai_worker.py` confirming stub mode produces deterministic output
- Commit: `feat(ai): worker Lambda + stub mode + idempotent upsert`

### Task 25: Enqueue on submit (TIR + SIP) + real Gemini call gated

- Create `backend/app/services/queue.py` with `enqueue_ai_screening(app_id, track)`
- In `backend/app/routers/applications.py` and `sip_applications.py` — find the submit endpoint, add the enqueue call right after marking `status=submitted`
- Wire real OpenRouter call in `ai_worker.py` behind `if not stub:` branch — fully written, gated by env var
- Smoke test: submit a fresh application → check SQS queue has a message → worker picks it up → `ai_screening` row appears → status → `under_review`
- Commit: `feat(ai): enqueue on submit + real Gemini wired behind AI_STUB flag`

### Task 26: Email notifications service + 9 Resend triggers

- Create `backend/app/services/notifications.py` with 9 functions per spec §8
- Wire each into the relevant endpoint:
  - Submit → existing "application received" stays as-is
  - Reviewer assigned → in reviewer_assignments insert (Task 21)
  - Reviewer declined → on reviewer decline (Phase 1.5)
  - All reviewers complete (status → evaluated) → in worker that detects all-3-done (cron job? or trigger from review submit in Phase 1.5)
  - Status → shortlisted / rejected / waitlisted → in status transition endpoint (Task 20)
  - Role granted → in grant_role (Task 12)
  - Password reset → already handled by Supabase
- For Phase 1, only wire the emails that fire from Phase 1 actions; the "all reviewers complete" trigger waits for Phase 1.5
- Commit: `feat(email): notification triggers wired to Phase 1 status transitions`

### Task 27: Synthetic seed script + run

- Create `backend/scripts/seed_synthetic_cohort.py`:
  - Generate 40 fake applications across TIR + SIP (mirror of the prototype's `generateCohort()` logic)
  - For each, insert into the right `_applications` table + a corresponding `ai_screening` row with stub scores
  - Vary status, industry (via realistic basic_org names), submitted_at
  - Idempotent — checks for a marker row before running
- Run once against staging Supabase
- Commit: `feat(seed): 40-app synthetic cohort for dashboard testing`

### Task 28: ✅ CHECKPOINT — Phase 1 acceptance test pass

Run through spec §14's 10-item checklist against the live staging deployment:

1. ✅ Migration 014 (already done)
2. Admin signs in → adds reviewer → reviewer receives invite + signs in
3. Reviewer sees populated inbox stub (until Phase 1.5)
4. Leadership signs in → dashboard with ≥40 apps + filter + drawer + assign 2 reviewers + status → shortlisted
5. Audit log has every state change within 2s
6. Email sent at every transition (check Resend dashboard)
7. AI pipeline: submit returns <500ms, worker writes ai_screening, DLQ empty
8. RBAC: reviewer hitting /leadership/applications → 403
9. Last-admin protection: revoke last admin → 409
10. Lighthouse mobile score on /apply/signin + /admin/dashboard ≥ 85

Document any failures, fix, re-run. Only when 10/10 pass:

- Commit: `chore: Phase 1 acceptance criteria all green`
- Push branch + tag: `git tag phase-1-functional && git push --tags`

---

## Task 29: Udita UI polish phase

> This task starts only after Task 28 ships. Udita owns it. Primary dev hands over a fully-functional Phase 1 build; Udita refines the visual layer to match the screenshots pixel-for-pixel without changing functional behaviour.

**Scope:**
- Lift `lp-*`, `eir-*`, role-card styles from prototype's `styles.css` into the live frontend
- Match the screenshots exactly for:
  - Leadership dashboard header (track badge styling, switch role button)
  - Metric cards (the cyan "AVERAGE AI SCORE" treatment)
  - Funnel bars (gradient blue)
  - Industry rows (right-aligned counts + percentage chips)
  - Status grid (10-cell layout, coloured dots)
  - Applications table (sortable header arrows, score-pill widths)
  - Drawer (slide-in animation, action button row)
  - Profile sections (numbered 01/02/03/04 with the specific typography)
  - Role cards (purple ACTIVE border, grant/revoke button states)
- Add empty states for: no applications, no users, no filters matched
- Add loading skeletons for the leadership dashboard's slower endpoints
- Mobile responsive pass: leadership dashboard collapses gracefully; profile shell stacks
- Add a "stub mode" indicator chip on AI-scored widgets when `AI_STUB=true` (per spec §7.3 — "every dashboard widget that shows AI data has a small stub-mode indicator chip")

**Non-goals for Udita:**
- No backend changes
- No status logic changes
- No new screens (Phase 1.5 reviewer scoring is its own follow-up)
- No prompt engineering (Phase 1.5+)

**Acceptance:**
- Side-by-side comparison of every screenshot vs live preview: pixel-equivalent in spirit (exact px tolerances allowed for fonts)
- Pass Lighthouse mobile ≥ 90 (was 85 in Task 28)
- Commit pattern: `polish(ui): <screen> <thing>` per atomic improvement

---

## Risk callouts

These are points where chunks can interact badly. Watch for them.

1. **Task 3 → all backend work**: extending `get_current_user` to fetch roles adds a DB query to every authed request. If you observe Lambda latency creep, add a 60-second in-memory cache keyed by `user_id` (acceptable since roles change rarely). Don't pre-optimise — measure first.

2. **Task 5 (admin user create) ↔ Task 12 (grant role)**: both write to `user_roles`. If Supabase's email-confirm setting blocks the new user from logging in, the create flow looks broken but really it's just the magic-link path. Test both `send_invite=true` and `send_invite=false` paths.

3. **Task 17 (leadership dashboard) ↔ Task 27 (seed)**: until the seed runs, dashboards show very few rows and look "empty". Don't second-guess the wiring — finish Task 17, then run Task 27, then revisit.

4. **Task 23 (SAM template) ↔ existing Lambda**: editing the SAM template touches the same stack as the existing API. A bad change can break TIR/SIP submission. Before deploying Task 23, run `sam validate` and review the changeset before confirming. Roll back via `aws cloudformation rollback-stack` if anything regresses.

5. **Task 24 (AI worker) ↔ Task 25 (enqueue)**: deploy them in this order — worker first (it can sit idle), then submit endpoint that enqueues. If you reverse the order, submissions enqueue messages with nothing to consume them; they pile up and eventually DLQ.

6. **Task 28 (acceptance) ↔ Task 29 (Udita)**: don't start Udita's polish until Task 28 is fully green. Otherwise visual changes can mask functional regressions.

7. **Frontend lib/rbac.js ↔ backend rbac.py**: these two files MUST stay in sync. If you add a capability in one, you must add it in the other. Phase 2 should add a CI lint that diffs the two JSON-serialised constants.

8. **Migration 014 already applied — DO NOT re-run**: the schema is in place. If you find yourself writing new SQL, that's a migration 015 (separate file, follow the existing pattern in `backend/migrations/`).

---

## Self-review

**Spec coverage check** — every requirement in `2026-05-13-admin-platform-design.md` mapped to a task:

| Spec section | Task(s) |
|---|---|
| §3.1 (6 roles) | Task 2 (ROLE_CAPABILITIES) + Task 5 (create with role list) |
| §3.2 (capabilities) | Task 2 + Task 6 (frontend mirror) |
| §3.3 (leadership vs admin) | Task 2 (distinct capability sets) + Task 12 (last-admin protection on admin only) |
| §3.4 (login flow) | Tasks 4 + 6 + 8 (role-aware redirect) |
| §4 (data model) | Migration 014 (already done — verified in Task 1.3) |
| §4.8 (status state machine) | Task 20 (transition guard) |
| §5.1 (admin/users endpoints) | Tasks 5, 10, 11, 12, 14 |
| §5.2 (leadership applications) | Tasks 18, 20, 21 |
| §5.3 (leadership stats) | Task 16 |
| §5.4 (reviewer endpoints) | Task 8 (stub for Phase 1) — full scoring in Phase 1.5 |
| §5.5 (audit endpoints) | Internal-only Phase 1 (Task 15) — public surface in Phase 2 |
| §5.6 (AI pipeline) | Tasks 23, 24, 25 |
| §6 (frontend structure) | Tasks 7, 10, 11, 13, 17 |
| §7 (AI pipeline detail) | Tasks 23, 24, 25 |
| §8 (email notifications) | Task 26 |
| §9 (edge cases) | Tasks 12, 21 (3-cap + self-assign), 20 (state machine), 24 (idempotency) |
| §10 (testing) | Tests live alongside each task; manual smoke at Tasks 9 + 28 |
| §11 (migration plan) | This document is the migration plan |
| §12 (risks) | Risk callouts above |
| §14 (acceptance) | Task 28 |

**No spec section uncovered.** ✓

**Placeholder scan** — searched for `TBD`, `TODO`, `placeholder`, `coming soon` — only legitimate uses (Phase 1.5 deferrals + intentional stubs) remain. ✓

**Type consistency** — endpoint paths, role names, status values used consistently across tasks. ✓

**Scope** — single coherent Phase 1 build, with explicit Phase 1.5 + Phase 2 deferrals. ✓
