# Leadership Dashboard Production Cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the leadership dashboard to production by merging `staging-role_based_dashboard` onto the prod line (`release/sip-launch-v1`) without breaking TIR/SIP applicant flows — leadership role only, real TIR AI scoring + full backfill, `dev@artpark.in` seeded, staging rehearsal before prod.

**Architecture:** Integration branch `release/leadership-v1` off the prod line; merge the dashboard branch in (release wins SIP/submit, dashboard wins roles, auth/router union both). Additive migrations 014–018. Worker-path AI scoring flipped to real via a new `AiStub` SAM parameter. Two prod-safe ops scripts (seed leadership user, enqueue-backfill). Rehearse on staging, then promote to prod; frontend via Vercel on merge to `release/sip-launch-v1`, backend via SAM from the worktree.

**Tech Stack:** React/Vite (Vercel), FastAPI on AWS Lambda (SAM, ap-south-1), Supabase (Postgres + auth), SQS FIFO + worker Lambda, OpenRouter (gemini-2.5-flash).

**Source spec:** `docs/superpowers/specs/2026-05-28-leadership-prod-cutover-design.md`

**Conventions used below:**
- 🔒 **HUMAN-GATED** = requires the user's explicit go-ahead and/or user-provided secrets (prod DB, prod deploy). Do not run autonomously.
- All `sam` / git-branch-deploy steps run **from the `release-leadership-v1` worktree** (SAM reads `backend/` from disk; a HEAD-flip mid-build ships the wrong code).
- Never add `Co-Authored-By` to commits (user's global rule).

---

## Phase 0 — Integration branch & worktree

### Task 0.1: Create the integration branch in an isolated worktree

**Files:** none (git/worktree setup)

- [ ] **Step 1: Create branch + worktree off the prod line**

Run from the main repo or any worktree:
```bash
cd /Users/apple/Desktop/Final_AP_os
git fetch origin
git worktree add -b release/leadership-v1 \
  .claude/worktrees/release-leadership-v1 release/sip-launch-v1
```
Expected: `Preparing worktree (new branch 'release/leadership-v1')` and a checkout at the new path.

- [ ] **Step 2: Confirm clean base**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-leadership-v1
git status && git log -1 --oneline
```
Expected: clean tree; HEAD = the latest `release/sip-launch-v1` commit (the spec commit `c5fa985` or later).

All subsequent file paths are relative to this worktree unless stated otherwise.

---

## Phase 1 — Merge & conflict resolution

> Resolution rule: **release wins SIP/track + submit; dashboard wins roles/leadership; auth + router UNION both.** After each resolution task, the verification greps must pass. Do NOT commit until Task 1.8 builds + tests green.

### Task 1.1: Start the merge

**Files:** whole tree

- [ ] **Step 1: Begin the merge (expect conflicts)**

Run:
```bash
git merge --no-commit --no-ff staging-role_based_dashboard
```
Expected: `Automatic merge failed; fix conflicts and then commit the result.`

- [ ] **Step 2: Snapshot the conflict set**

Run:
```bash
git diff --name-only --diff-filter=U | sort
```
Expected: ~26 files including `backend/app/routers/applications.py`, `backend/app/routers/auth.py`, `backend/app/deps.py`, `backend/app/models/auth.py`, `frontend/src/router.jsx`, `frontend/src/hooks/useAuth.jsx`, `frontend/src/pages/SignInPage.jsx`, `frontend/src/pages/VerifyPage.jsx`, `frontend/src/pages/SetPasswordPage.jsx`, `infra/sam/template.yaml`, `infra/sam/samconfig.toml`, `frontend/vercel.json`, `frontend/public/marketing.html`, `frontend/public/programs.html`, `frontend/index.html`, `frontend/package.json`, `frontend/src/styles.css`, `backend/app/services/email_service.py`, `backend/migrations/010_*`–`013_*`.

### Task 1.2: Resolve `/auth/me` union (roles + track)

**Files:**
- Modify: `backend/app/routers/auth.py`
- Modify: `backend/app/deps.py`
- Modify: `backend/app/models/auth.py`

- [ ] **Step 1: Resolve the three files** so that the `/auth/me` response (the `UserMe`/current-user model) contains **both** sets of fields:
  - From dashboard branch: `roles: list[str]` (fetched in `deps.py` via `client.table("user_roles").select("role").eq("user_id", ...)`) and `active_role`.
  - From release branch: `track` and the `PATCH /auth/me/track` endpoint.
  Keep BOTH. Where the two branches edited the same function, combine: fetch roles AND preserve track logic.

- [ ] **Step 2: Verify both features survive**

Run:
```bash
grep -n "user_roles" backend/app/deps.py
grep -nE "track|roles|active_role" backend/app/models/auth.py
grep -n "/me/track" backend/app/routers/auth.py
```
Expected: `user_roles` fetch present in `deps.py`; `models/auth.py` declares `roles`, `active_role`, AND `track`; the track PATCH route present.

- [ ] **Step 3: Mark resolved**

Run:
```bash
git add backend/app/routers/auth.py backend/app/deps.py backend/app/models/auth.py
```

### Task 1.3: Resolve submit handler (keep release submit + add TIR enqueue)

**Files:**
- Modify: `backend/app/routers/applications.py`

- [ ] **Step 1: Resolve so release's submit logic is kept** (optional resume, both-track submission, VIP/track-aware confirmation email) **and** the dashboard's enqueue call is present right after a successful submit:

```python
from ..services import sqs_publisher
# ... inside the submit handler, after the application is marked submitted:
sqs_publisher.publish(submitted["id"], "tir")
```
Keep the `from ..services import sqs_publisher` import (top of file) and the single `sqs_publisher.publish(...)` call. Do NOT remove any release-side submit behavior.

- [ ] **Step 2: Verify**

Run:
```bash
grep -n "sqs_publisher" backend/app/routers/applications.py
```
Expected: one import line + one `sqs_publisher.publish(submitted["id"], "tir")` call.

- [ ] **Step 3: Mark resolved**

Run: `git add backend/app/routers/applications.py`

### Task 1.4: Resolve frontend router (union SIP routes + role gates)

**Files:**
- Modify: `frontend/src/router.jsx`

- [ ] **Step 1: Resolve so the router contains BOTH:**
  - Release's SIP routes: `/apply-sip`, the SIP template route, etc.
  - Dashboard's role gates: `ApplyRoleGate` wrapping `/apply*`, `LeadershipRoute` for `/leadership`, `LeadershipReviewRoute` for the review page.

- [ ] **Step 2: Verify**

Run:
```bash
grep -nE "ApplyRoleGate|LeadershipRoute|apply-sip|sip-template" frontend/src/router.jsx
```
Expected: all four tokens present.

- [ ] **Step 3: Mark resolved**

Run: `git add frontend/src/router.jsx`

### Task 1.5: Resolve sign-in / landing (role-first, track fallback)

**Files:**
- Modify: `frontend/src/hooks/useAuth.jsx`
- Modify: `frontend/src/pages/SignInPage.jsx`
- Modify: `frontend/src/pages/VerifyPage.jsx`
- Modify: `frontend/src/pages/SetPasswordPage.jsx`

- [ ] **Step 1: Resolve so every post-auth redirect uses dashboard's `landingPathFor(roles)`** (role-first: leadership→`/leadership`, admin→`/admin`, reviewer→`/reviewer/inbox`, else→`/apply`). Applicants still reach release's track-aware `/apply`. Keep the `landingPathFor` import from `frontend/src/lib/landing.js`.

- [ ] **Step 2: Verify**

Run:
```bash
grep -rn "landingPathFor" frontend/src/pages/SignInPage.jsx frontend/src/pages/VerifyPage.jsx frontend/src/pages/SetPasswordPage.jsx
```
Expected: `landingPathFor` referenced in all three sign-in entry points.

- [ ] **Step 3: Mark resolved**

Run:
```bash
git add frontend/src/hooks/useAuth.jsx frontend/src/pages/SignInPage.jsx frontend/src/pages/VerifyPage.jsx frontend/src/pages/SetPasswordPage.jsx
```

### Task 1.6: Resolve SAM template + samconfig (union infra)

**Files:**
- Modify: `infra/sam/template.yaml`
- Modify: `infra/sam/samconfig.toml`

- [ ] **Step 1: Resolve `template.yaml`** so it contains BOTH:
  - Release infra: SIP-related resources + the CORS multi-origin handling (`FrontendOrigins`).
  - Dashboard infra: `AiScreenerQueue`, `AiScreenerDLQ`, `AiScreenerFunction`, `AiScreenerLogGroup`, `AiScreenerDLQAlarm`, the API `sqs:SendMessage` policy, and the `AI_SCREENING_QUEUE_URL` Globals env + `AiScreenerQueueUrl` output.
  - `samconfig.toml`: keep both `[production]` and `[staging]` stanzas with their stack names.

- [ ] **Step 2: Verify**

Run:
```bash
grep -nE "AiScreenerFunction|AiScreenerQueue|AI_SCREENING_QUEUE_URL|FRONTEND_ORIGINS" infra/sam/template.yaml
grep -nE "artpark-eir-api-production|artpark-eir-api-staging" infra/sam/samconfig.toml
```
Expected: all AI-screener resources + `FRONTEND_ORIGINS` present; both stack names present.

- [ ] **Step 3: Mark resolved**

Run: `git add infra/sam/template.yaml infra/sam/samconfig.toml`

### Task 1.7: Resolve remaining files (take release for SIP-facing assets)

**Files:**
- Modify: `frontend/vercel.json`, `frontend/index.html`, `frontend/public/marketing.html`, `frontend/public/programs.html`, `frontend/src/styles.css`, `frontend/package.json`
- Modify: `backend/app/services/email_service.py`
- Modify: `backend/migrations/010_*.sql`–`013_*.sql`
- Modify: `infra/sam/deploy-staging.sh` (if conflicted)

- [ ] **Step 1: Resolve assets — take release's version** for `vercel.json` (must keep SIP/VIP rewrites + redirects), `marketing.html`, `programs.html`, `index.html`, `styles.css`. For `package.json` take the union of dependencies (if dashboard added any leadership-only deps, keep them). For `email_service.py` keep release's track-aware emails and add dashboard's role-granted email function (dormant). For `migrations/010–013` **take release's version** — since the merge is run *on* `release/leadership-v1`, release is **"ours"**, so: `git checkout --ours backend/migrations/010_track_rename_and_split.sql backend/migrations/011_sip_track.sql backend/migrations/012_sip_add_will_break.sql backend/migrations/013_relax_other_constraints.sql`.

- [ ] **Step 2: Verify SIP rewrites + migrations intact**

Run:
```bash
grep -nE "sip|vip|apply-sip" frontend/vercel.json
ls backend/migrations/ | grep -E "019|020|021"
git diff --name-only --diff-filter=U
```
Expected: SIP/VIP rewrites present in `vercel.json`; 019–021 still present; **no remaining unmerged files** (last command prints nothing).

- [ ] **Step 3: Mark resolved**

Run:
```bash
git add frontend/vercel.json frontend/index.html frontend/public/marketing.html frontend/public/programs.html frontend/src/styles.css frontend/package.json backend/app/services/email_service.py backend/migrations/ infra/sam/deploy-staging.sh
```

### Task 1.8: Build + test the merged tree, then commit the merge

**Files:** none (verification + merge commit)

- [ ] **Step 1: Backend tests**

Run:
```bash
cd backend && source .venv/bin/activate 2>/dev/null; pip install -q -r requirements.txt 2>/dev/null; pytest -q
```
Expected: all tests pass (includes `tests/test_ai_screener.py`, `tests/ai_scoring/`, `tests/test_applications.py`). Fix any merge-induced failures before proceeding.

- [ ] **Step 2: Frontend build**

Run:
```bash
cd ../frontend && npm install && npm run build
```
Expected: Vite build succeeds, no unresolved-import errors.

- [ ] **Step 3: Frontend tests (if present)**

Run: `npm test 2>/dev/null || echo "no frontend test script"`
Expected: pass, or "no frontend test script".

- [ ] **Step 4: Commit the merge**

Run from worktree root:
```bash
cd .. && git commit -m "merge: bring leadership dashboard onto SIP prod line

Union of release/sip-launch-v1 (SIP/VIP + submit) and
staging-role_based_dashboard (leadership/admin/AI-screener/reviewer).
Auth /me returns roles + track; router unions SIP routes + role gates;
submit enqueues TIR AI screening; SAM unions SIP + AI screener infra."
```
Expected: merge commit created on `release/leadership-v1`.

---

## Phase 2 — Enable real TIR AI scoring (infra)

### Task 2.1: Parameterize `AI_STUB` so prod runs real scoring

**Files:**
- Modify: `infra/sam/template.yaml`
- Modify: `infra/sam/deploy-prod.sh`
- Modify: `infra/sam/deploy-staging.sh`

- [ ] **Step 1: Add the `AiStub` parameter** under `Parameters:` in `template.yaml`:

```yaml
  AiStub:
    Type: String
    Default: "true"
    AllowedValues: ["true", "false"]
    Description: >-
      "true" = deterministic stub scores (no OpenRouter spend).
      "false" = real Gemini Flash scoring via the worker Lambda.
```

- [ ] **Step 2: Reference it in the worker** — replace the hardcoded line in `AiScreenerFunction.Environment.Variables`:

```yaml
          AI_STUB: !Ref AiStub
```
(was `AI_STUB: "true"`)

- [ ] **Step 3: Thread it through both deploy scripts.** In `deploy-prod.sh` and `deploy-staging.sh`, add to the `--parameter-overrides` list:

```bash
    "AiStub=${AI_STUB:-true}" \
```
Place it alongside the other overrides (e.g. after `"OpenRouterModel=..."`). The value comes from the env file (`backend/.env.prod` / `.env.staging`); default stays `true` so unrelated deploys are unaffected.

- [ ] **Step 4: Validate the template**

Run:
```bash
cd infra/sam && sam validate --lint 2>/dev/null || sam validate
```
Expected: `template.yaml is a valid SAM Template`.

- [ ] **Step 5: Commit**

Run:
```bash
cd ../.. && git add infra/sam/template.yaml infra/sam/deploy-prod.sh infra/sam/deploy-staging.sh
git commit -m "feat(sam): AiStub parameter to enable real worker scoring per env"
```

---

## Phase 3 — Ops scripts

### Task 3.1: Lean prod-safe leadership seed script

**Files:**
- Create: `backend/scripts/seed_leadership_user.py`
- Test: `backend/tests/test_seed_leadership_user.py`

- [ ] **Step 1: Write the failing test** for the pure role-reconciliation helper:

```python
# backend/tests/test_seed_leadership_user.py
from scripts.seed_leadership_user import reconcile_roles

def test_reconcile_adds_leadership_and_drops_applicant():
    existing = ["applicant"]
    to_insert, to_delete = reconcile_roles(existing)
    assert to_insert == ["leadership"]
    assert to_delete == ["applicant"]

def test_reconcile_idempotent_when_already_leadership_only():
    to_insert, to_delete = reconcile_roles(["leadership"])
    assert to_insert == []
    assert to_delete == []

def test_reconcile_keeps_leadership_drops_applicant_when_both():
    to_insert, to_delete = reconcile_roles(["applicant", "leadership"])
    assert to_insert == []
    assert to_delete == ["applicant"]
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && pytest tests/test_seed_leadership_user.py -q`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the script**

```python
#!/usr/bin/env python3
"""Seed (or promote) a single LEADERSHIP user. Prod-safe + idempotent.

Makes the given email a leadership-only account:
  * creates the auth user (email-confirmed) if missing, else updates password
  * upserts profiles
  * ensures user_roles has 'leadership'; removes 'applicant' if present
Prints the email + password at the end so it can be handed over.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/seed_leadership_user.py dev@artpark.in --yes
    python scripts/seed_leadership_user.py dev@artpark.in --password 'Xyz!1Aa' --yes
    python scripts/seed_leadership_user.py dev@artpark.in --dry-run

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment
(populate via backend/.env.prod for production). Uses the service-role
key and bypasses RLS — it prints the target SUPABASE_URL and requires
--yes (or --dry-run) so you can confirm you are pointed at the right DB.
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def reconcile_roles(existing: list[str]) -> tuple[list[str], list[str]]:
    """Return (roles_to_insert, roles_to_delete) for a leadership-only acct."""
    to_insert = [] if "leadership" in existing else ["leadership"]
    to_delete = ["applicant"] if "applicant" in existing else []
    return to_insert, to_delete


def _gen_password() -> str:
    # Supabase policy: upper+lower+digit+symbol. token_urlsafe lacks a symbol.
    return secrets.token_urlsafe(16) + "!1Aa"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("email")
    ap.add_argument("--password", default=None)
    ap.add_argument("--yes", action="store_true", help="confirm DB target")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env.prod")
        load_dotenv(_BACKEND_ROOT / ".env", override=False)

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    print(f"→ Target SUPABASE_URL = {url}")
    if not args.dry_run and not args.yes:
        print("✗ Refusing to mutate without --yes (or use --dry-run).")
        return 2

    from supabase import create_client
    client = create_client(url, key)

    # 1. Find or create the auth user.
    password = args.password or _gen_password()
    users = client.auth.admin.list_users()
    user = next((u for u in users if (u.email or "").lower() == args.email.lower()), None)

    if args.dry_run:
        existing_roles = []
        if user:
            rr = client.table("user_roles").select("role").eq("user_id", user.id).execute()
            existing_roles = [r["role"] for r in (rr.data or [])]
        ins, dele = reconcile_roles(existing_roles)
        print(f"[dry-run] user_exists={bool(user)} insert={ins} delete={dele}")
        return 0

    if user is None:
        created = client.auth.admin.create_user({
            "email": args.email,
            "password": password,
            "email_confirm": True,
        })
        user = created.user
        print(f"✓ created auth user {args.email}")
    else:
        client.auth.admin.update_user_by_id(user.id, {"password": password})
        print(f"✓ updated password for existing user {args.email}")

    # 2. Upsert profile.
    client.table("profiles").upsert({"id": user.id, "email": args.email}).execute()

    # 3. Reconcile roles → leadership-only.
    rr = client.table("user_roles").select("role").eq("user_id", user.id).execute()
    existing_roles = [r["role"] for r in (rr.data or [])]
    to_insert, to_delete = reconcile_roles(existing_roles)
    for role in to_insert:
        client.table("user_roles").insert({"user_id": user.id, "role": role}).execute()
    for role in to_delete:
        client.table("user_roles").delete().eq("user_id", user.id).eq("role", role).execute()

    print("✓ leadership role ensured; applicant removed if present")
    print("\n──────── HAND OVER ────────")
    print(f"email:    {args.email}")
    print(f"password: {password}")
    print("───────────────────────────")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the test**

Run: `cd backend && pytest tests/test_seed_leadership_user.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

Run:
```bash
cd .. && git add backend/scripts/seed_leadership_user.py backend/tests/test_seed_leadership_user.py
git commit -m "feat(scripts): prod-safe leadership-only user seed"
```

### Task 3.2: TIR score backfill (enqueue to worker)

**Files:**
- Create: `backend/scripts/backfill_tir_scores.py`
- Test: `backend/tests/test_backfill_tir_scores.py`

- [ ] **Step 1: Write the failing test** for the app-id selection helper:

```python
# backend/tests/test_backfill_tir_scores.py
from scripts.backfill_tir_scores import select_app_ids

def test_select_skips_drafts():
    rows = [
        {"id": "a", "status": "submitted"},
        {"id": "b", "status": "draft"},
        {"id": "c", "status": "under_review"},
    ]
    assert select_app_ids(rows) == ["a", "c"]

def test_select_empty():
    assert select_app_ids([]) == []
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd backend && pytest tests/test_backfill_tir_scores.py -q`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the script**

```python
#!/usr/bin/env python3
"""Backfill AI scores for existing TIR applications by enqueuing them to
the same SQS worker path used on submit. The deployed worker (AI_STUB=false)
does the real scoring; this script only enqueues. Idempotent — the worker
upserts ai_screening ON CONFLICT, so re-enqueuing is harmless.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/backfill_tir_scores.py --dry-run
    python scripts/backfill_tir_scores.py --yes
    python scripts/backfill_tir_scores.py --yes --limit 10

Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and AI_SCREENING_QUEUE_URL
from the environment (backend/.env.prod for production). Needs AWS creds
on PATH for ap-south-1 (boto3 SQS send). Prints the target queue + DB and
requires --yes (or --dry-run).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def select_app_ids(rows: list[dict]) -> list[str]:
    """IDs of non-draft applications, preserving input order."""
    return [r["id"] for r in rows if r.get("status") != "draft"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env.prod")
        load_dotenv(_BACKEND_ROOT / ".env", override=False)

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    queue = os.environ["AI_SCREENING_QUEUE_URL"]
    print(f"→ DB    = {url}")
    print(f"→ QUEUE = {queue}")
    if not args.dry_run and not args.yes:
        print("✗ Refusing to enqueue without --yes (or use --dry-run).")
        return 2

    from supabase import create_client
    client = create_client(url, key)

    q = client.table("tir_applications").select("id, status").neq("status", "draft")
    if args.limit:
        q = q.limit(args.limit)
    rows = q.execute().data or []
    app_ids = select_app_ids(rows)
    print(f"→ {len(app_ids)} TIR applications to enqueue")

    if args.dry_run:
        print(f"[dry-run] first 10 ids: {app_ids[:10]}")
        return 0

    # Reuse the tested publisher; it reads AI_SCREENING_QUEUE_URL from env.
    from app.services import sqs_publisher
    for i, app_id in enumerate(app_ids, 1):
        sqs_publisher.publish(app_id, "tir")
        if i % 25 == 0:
            print(f"  enqueued {i}/{len(app_ids)}")
    print(f"✓ enqueued {len(app_ids)} applications")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the test**

Run: `cd backend && pytest tests/test_backfill_tir_scores.py -q`
Expected: 2 passed.

- [ ] **Step 5: Commit**

Run:
```bash
cd .. && git add backend/scripts/backfill_tir_scores.py backend/tests/test_backfill_tir_scores.py
git commit -m "feat(scripts): enqueue-based TIR score backfill"
```

---

## Phase 4 — Staging rehearsal 🔒 HUMAN-GATED

> Goal: prove the merged build end-to-end on staging before prod. Staging Supabase already has 014–018 (applied 2026-05-14) — verify, don't re-apply blindly.

### Task 4.1: Verify staging migrations

- [ ] **Step 1:** In the staging Supabase SQL editor, confirm the role tables exist:
```sql
select to_regclass('public.user_roles'), to_regclass('public.ai_screening'),
       to_regclass('public.industry_categories');
```
Expected: all three non-null. If any are null, apply the corresponding migration(s) from `backend/migrations/014–018` in order.

### Task 4.2: Deploy backend to staging (real scoring on)

- [ ] **Step 1:** Ensure `backend/.env.staging` has `AI_STUB=false`, `OPENROUTER_API_KEY=…`, `OPENROUTER_MODEL=google/gemini-2.5-flash`.
- [ ] **Step 2:** Deploy from the worktree:
```bash
cd infra/sam && ./deploy-staging.sh
```
Expected: stack `artpark-eir-api-staging` updates; `AiScreenerFunction` present; `AiScreenerQueueUrl` in outputs.
- [ ] **Step 3:** Capture the staging queue URL from the stack outputs for Task 4.4.

### Task 4.3: Deploy frontend to staging (Vercel preview)

- [ ] **Step 1:** Push the branch so Vercel builds a preview:
```bash
cd ../.. && git push -u origin release/leadership-v1
```
- [ ] **Step 2:** Open the Vercel preview URL for `release/leadership-v1`; confirm it builds and the marketing pages load.

### Task 4.4: Backfill staging + verify real scores

- [ ] **Step 1:** Dry-run, then run:
```bash
cd backend && source .venv/bin/activate
AI_SCREENING_QUEUE_URL='<staging-queue-url>' python scripts/backfill_tir_scores.py --dry-run
AI_SCREENING_QUEUE_URL='<staging-queue-url>' python scripts/backfill_tir_scores.py --yes --limit 5
```
- [ ] **Step 2:** Wait ~1 min, then in the staging dashboard confirm those 5 TIR apps show non-stub `score_overall` + an industry. Check CloudWatch logs `/aws/lambda/artpark-eir-ai-screener-staging` for real OpenRouter calls (no "AI_STUB" stub path).

### Task 4.5: Full smoke matrix on staging

- [ ] **Step 1:** Run every row of spec §9 against the staging preview + staging API:
  - [ ] TIR signup → wizard → submit OK
  - [ ] SIP/VIP signup → wizard → submit OK
  - [ ] existing applicant → returning-user sign-in → lands `/apply`
  - [ ] leadership account (seed a staging test leadership user) → sign-in → lands `/leadership`; visiting `/apply` bounces; no wizard HTML
  - [ ] applicant session → `/leadership` route denied AND `GET /leadership/stats` returns 403
  - [ ] `/tir`, `/`, sip-marketing serve
  - [ ] new TIR submit auto-scored within ~1 min
  - [ ] a SIP app shows blank AI score, worker logs "skipping" with no error
- [ ] **Step 2:** Record results. **Do not proceed to Phase 5 unless every row passes.**

---

## Phase 5 — Production cutover 🔒 HUMAN-GATED

> Run only after Phase 4 is fully green and the user gives the go-ahead. Each step needs user-provided prod secrets.

### Task 5.1: Pre-flight confirmations

- [ ] Confirm prod Supabase **project ref** (the DB that holds `tir_applications`).
- [ ] Confirm approximate count of non-draft TIR apps (backfill time/cost): `select count(*) from tir_applications where status <> 'draft';`
- [ ] Confirm `backend/.env.prod` has `AI_STUB=false`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL=google/gemini-2.5-flash`, and all the existing required vars.
- [ ] Note current Vercel prod deployment id + current prod stack version (for rollback).

### Task 5.2: Apply migrations 014–018 to PROD Supabase

- [ ] **Step 1:** In the **prod** Supabase SQL editor, run in order: `014`, `015`, `016_rename_score_solution_to_completeness`, `016_reviewer_pages_columns`, `017`, `018` (contents from `backend/migrations/`).
- [ ] **Step 2:** Verify:
```sql
select to_regclass('public.user_roles'), to_regclass('public.ai_screening'),
       to_regclass('public.industry_categories');
```
Expected: all non-null. No error on the status-constraint rewrite (015 is idempotent + SIP-aware).

### Task 5.3: Deploy backend to prod (from worktree)

- [ ] **Step 1:** From the `release-leadership-v1` worktree:
```bash
cd infra/sam && ./deploy-prod.sh
```
Expected: stack `artpark-eir-api-production` updates; new `AiScreenerFunction`/`AiScreenerQueue`/`AiScreenerDLQ` **created**; `AI_STUB=false` (verify: `aws lambda get-function-configuration --function-name artpark-eir-ai-screener-production --query 'Environment.Variables.AI_STUB'`).
- [ ] **Step 2:** Capture the prod `AiScreenerQueueUrl` output for Task 5.6.

### Task 5.4: Promote frontend (merge to prod branch → Vercel)

- [ ] **Step 1:**
```bash
cd ../.. && git checkout release/sip-launch-v1 && git merge --no-ff release/leadership-v1
git push origin release/sip-launch-v1
```
(Run from the prod-line worktree, or use the existing `release-sip-launch-v1` worktree to avoid disturbing others.)
Expected: Vercel builds + promotes prod from `release/sip-launch-v1`.
- [ ] **Step 2:** Confirm apply.artpark.info serves the new build (marketing pages + `/apply` still load).

### Task 5.5: Prod smoke matrix (nothing-breaks gate)

- [ ] Re-run every row of spec §9 against **production** (use throwaway/test applicant accounts for the submit flows; verify the access-control rows especially). If any applicant flow breaks → **rollback (Phase 6)** immediately.

### Task 5.6: Backfill ALL current TIR apps (full run)

- [ ] **Step 1:** Dry-run:
```bash
cd backend && source .venv/bin/activate
AI_SCREENING_QUEUE_URL='<prod-queue-url>' python scripts/backfill_tir_scores.py --dry-run
```
Expected count matches Task 5.1.
- [ ] **Step 2:** Full run:
```bash
AI_SCREENING_QUEUE_URL='<prod-queue-url>' python scripts/backfill_tir_scores.py --yes
```
- [ ] **Step 3:** Wait a few minutes (worker concurrency 10). Verify the leadership dashboard score histogram + industry filter populate for current TIR apps. Check the DLQ is empty: `aws sqs get-queue-attributes --queue-url <dlq-url> --attribute-names ApproximateNumberOfMessages`.

### Task 5.7: Seed `dev@artpark.in` + hand over password

- [ ] **Step 1:** Dry-run against prod:
```bash
python scripts/seed_leadership_user.py dev@artpark.in --dry-run
```
Confirm target = prod SUPABASE_URL and the planned insert/delete.
- [ ] **Step 2:** Seed:
```bash
python scripts/seed_leadership_user.py dev@artpark.in --yes
```
- [ ] **Step 3:** Verify: sign in at the returning-user page with the printed password → lands on `/leadership`; visiting `/apply` bounces. Hand the password to the user (do not commit it).

---

## Phase 6 — Post-cutover & rollback

### Task 6.1: Wrap-up

- [ ] **Step 1:** Update memory: mark leadership dashboard LIVE on prod; note SIP-AI-scoring fast-follow (execute the `handler.py:178` integration note); record the prod queue/DLQ names.
- [ ] **Step 2:** Confirm rollback levers documented + ready:
  - Frontend: Vercel → Instant Rollback to the deployment id from Task 5.1.
  - Backend: redeploy the pre-merge `release/sip-launch-v1` commit from a worktree (accepts removal of the new screener resources).
  - DB: additive — no rollback needed; revoke seeded roles via `delete from user_roles where role='leadership'` if required.

### Rollback triggers (decide fast)
- Any applicant cannot submit (TIR or SIP) → rollback frontend + backend.
- Leadership page reachable by a non-leadership session → rollback frontend immediately, investigate the router union.

---

## Self-review notes
- Spec §3 invariants I1–I6 → Tasks 1.3 (I1 submit), 1.4/1.5 (I3/I6 routing), 4.5/5.5 (I2/I3 tested), 2.1+5.3 (I5), 1.x dormant code (I4). Covered.
- Spec §5 migrations → Tasks 4.1 / 5.2. §6 AI scoring → 2.1, 3.2, 4.4, 5.6. §7 access/bootstrap → 3.1, 5.7. §8 deploy order → Phases 4–5. §9 smoke → 4.5/5.5. §10 rollback → 6.1. §11 open items → 5.1.
- Identifiers consistent: `reconcile_roles`, `select_app_ids`, `sqs_publisher.publish(id, "tir")`, `AiStub` param, `landingPathFor`.
