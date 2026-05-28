# Leadership Dashboard — Production Cutover Design

**Date:** 2026-05-28
**Status:** Design (approved by user; pending spec review)
**Author:** brainstorming session

## 1. Goal

Ship the **leadership dashboard** to production by merging the
`staging-role_based_dashboard` line onto the current prod line
(`release/sip-launch-v1`), **without breaking the live SIP/VIP + TIR
applicant flows**. Activate the **leadership role only**. Enable **real
AI scoring for TIR** (worker path) and backfill scores for all current
TIR applicants. Seed `dev@artpark.in` as a leadership account.

### Non-goals (this cutover)
- Admin user-management UI on prod (no admin role seeded).
- Reviewer inbox/scoring on prod (no reviewer role seeded).
- SIP AI scoring (deferred fast-follow — worker skips SIP cleanly).
- Real scoring via the LangGraph admin endpoint (kept disabled).

## 2. Current state (verified)

| Branch | Owns | Prod? |
|---|---|---|
| `release/sip-launch-v1` | SIP/VIP track, track isolation, VIP rebrand, both-track submit, resume rules | **Yes** — Vercel prod (apply.artpark.info) + SAM stack `artpark-eir-api-production`, both deploy from this branch |
| `staging-role_based_dashboard` | leadership dashboard, admin platform, AI screener Lambda, reviewer screens, role-based routing | No |

- Divergence: dashboard branch is 154 commits ahead of release; release is
  107 ahead of dashboard. Disjoint feature sets.
- Prod Supabase has migrations `001–013` + `019–021` applied. It does **not**
  have `014–018` (the role/admin/leadership/AI tables).
- Prod is a single Supabase project holding both `tir_applications` and
  `sip_applications`. *(Open item: confirm prod project ref before applying
  migrations.)*

## 3. Invariants (hard requirements)

- **I1 — TIR + SIP/VIP keep working.** Applicant signup, both wizards, and
  submit behavior unchanged. Guaranteed by: best-effort + env-gated SQS
  publisher (`sqs_publisher.py:53` — empty `AI_SCREENING_QUEUE_URL`
  short-circuits, failures caught); additive migrations; merge preserves
  release's submit logic.
- **I2 — Only backend-seeded users reach `/leadership`.** `user_roles` is the
  sole role source; no self-serve grant. Server-side `require_capability`
  gates every `/leadership/*` endpoint.
- **I3 — Leadership never sees the applicant wizard.** `ApplyRoleGate` bounces
  leadership/admin off `/apply*` to `landingPathFor(roles)` → `/leadership`;
  no wizard HTML flashes.
- **I4 — Dormant code stays dormant.** Admin/reviewer routers + LangGraph
  scoring ship in the merge but are RBAC-gated and unseeded → unreachable.
- **I5 — AI scores are real for TIR.** Worker path canonical (`AI_STUB=false`,
  OpenRouter). SIP shows blank AI score (no error) until fast-follow.
- **I6 — Leadership login is via the returning-user sign-in page only.**
  Email+password "Sign in to continue" page (the "RETURNING USER → Sign in"
  entry). Role-first routing then lands them on `/leadership`. No separate
  leadership portal; leadership never uses "Create an account."

## 4. Merge strategy & conflict resolution

Create `release/leadership-v1` off `release/sip-launch-v1` in a **fresh
worktree**. Merge `staging-role_based_dashboard` in. Resolution rule:
**release wins for SIP/track + submit; dashboard wins for roles/leadership;
auth + router UNION both.**

~26 conflict files; the load-bearing ones:

| File(s) | Resolution |
|---|---|
| `backend/app/routers/applications.py` | Keep release submit (optional resume, both-track, VIP email) **+** add `sqs_publisher.publish(submitted["id"], "tir")` after successful submit. |
| `auth.py`, `deps.py`, `models/auth.py` | `/auth/me` returns **both** release's `track`/`active_role` **and** dashboard's `roles[]`. Keep dashboard's `user_roles` fetch in `deps.py`. |
| `frontend/src/router.jsx` | Union: SIP routes (`/apply-sip`, sip-template) **and** role gates (`ApplyRoleGate`, `LeadershipRoute`). |
| `useAuth.jsx`, `SignInPage`, `VerifyPage`, `SetPasswordPage` | Use dashboard's `landingPathFor(roles)` (role-first); applicants fall through to release's track-aware `/apply`. |
| `infra/sam/template.yaml`, `samconfig.toml` | **Union**: SIP + CORS multi-origin (release) **and** AI-screener Lambda/SQS/DLQ (dashboard). |
| `vercel.json`, `index.html`, `marketing.html`, `programs.html` | Take release's (SIP/VIP rewrites + content); re-apply any dashboard-only asset refs. |
| `migrations/010–013` | Take **release's** version (matches what prod ran). Never re-run on prod. |
| `email_service.py` | Keep release's track-aware emails; add dashboard's role-granted email (dormant — only fires from admin endpoints). |

After merge: local build + full test suite green before any deploy.

## 5. Database / migrations on prod

Apply the **disjoint new set** to prod Supabase, in order, **after** staging
rehearsal passes:

`014_admin_platform_phase1` · `015_expand_application_status_check` ·
`016_rename_score_solution_to_completeness` · `016_reviewer_pages_columns` ·
`017_leadership_table_redesign` · `018_ai_screening_project_name`

- All create new tables or are idempotent. `015` is SIP-aware (rewrites both
  `tir_applications` + `sip_applications` status CHECK with DROP IF EXISTS).
- Numeric order vs already-applied `019–021` is irrelevant — different objects.
- Run via Supabase SQL editor against the **prod** project.

## 6. AI scoring sub-plan (TIR)

- **Canonical path = Worker** (`backend/workers/ai_screener/handler.py`). Runs
  on TIR submit via SQS; writes `score_overall` + `industry_category_id` that
  the dashboard reads.
- **LangGraph admin endpoint stays disabled** (`AI_SCORING_ENABLED=false`,
  admin-gated, unseeded) to avoid column drift.
- **Prod Lambda config:** `AI_STUB=false`, `OPENROUTER_API_KEY` (already
  present), `OPENROUTER_MODEL=google/gemini-2.5-flash`, `AI_SCREENING_QUEUE_URL`
  (from SAM output). Deploy screener Lambda + FIFO queue + DLQ as part of the
  unioned SAM stack.
- **New TIR submits** → auto-enqueued (`applications.py:611`) → real score.
- **Backfill (full run):** an ops script (service-role; no admin account
  needed) enqueues **every** already-submitted TIR application to the same
  queue → worker scores them with consistent columns. Expect a few minutes of
  OpenRouter calls; cost scales with applicant count.
- **SIP:** worker logs + skips (`handler.py:178`) → blank AI score, no error.
  Fast-follow = execute the in-file integration note (wire SIP submit publish,
  map SIP columns, SIP scoring prompt).

## 7. Access model & leadership account bootstrap

Three independent enforcement layers (defense in depth):

| Layer | Applicant → `/leadership` | Leadership → wizard |
|---|---|---|
| Post-login routing | `landingPathFor` → `/apply` | → `/leadership` |
| Route guard (frontend) | `LeadershipRoute` requires `view_stats` → denied | `ApplyRoleGate` bounces off `/apply*` |
| API capability gate (backend) | every `/leadership/*` = `require_capability` → 403 | — |

**Bootstrap (no admin on prod) — reusable idempotent ops script** run with the
**prod service-role key**, `seed_leadership_user.py <email> [password]`:
1. Look up auth user by email; create it (email-confirmed) if missing.
2. Set the password (so we can hand it over).
3. Upsert `profiles`; insert `user_roles(user_id, 'leadership')`; remove any
   `applicant` row so the account is **leadership-only**.

**For this cutover:** run it for **`dev@artpark.in`** as the final step, then
hand the user the password. Script is reused for every future leadership user.

## 8. Deploy sequence

Strict order; staging rehearsal first.

1. **Merge** → `release/leadership-v1` (fresh worktree); resolve conflicts;
   local build + tests green.
2. **Staging rehearsal:** apply `014–018` to staging Supabase (already present)
   → `infra/sam/deploy-staging.sh` (from the worktree) → Vercel preview → run
   full smoke matrix (§9) including real AI scoring + access checks.
3. **Prod (only after staging green):**
   a. Apply `014–018` to **prod** Supabase.
   b. `infra/sam/deploy-prod.sh` **from the worktree** (SAM reads `backend/`
      from disk — never flip HEAD mid-build) with `AI_STUB=false` +
      `AI_SCREENING_QUEUE_URL` wired.
   c. Merge `release/leadership-v1` → `release/sip-launch-v1` → triggers Vercel
      prod deploy.
4. **Post-deploy:** run TIR backfill (full). Seed `dev@artpark.in` leadership.
   Hand over password.

## 9. Smoke matrix (the "nothing breaks" gate)

Run on staging, then again on prod:

- [ ] TIR signup → wizard → submit succeeds.
- [ ] SIP/VIP signup → wizard → submit succeeds.
- [ ] Existing applicant signs in (returning-user page) → lands on `/apply`.
- [ ] Leadership account signs in via returning-user page → lands on
      `/leadership`; **cannot** reach `/apply` (route bounce) nor wizard HTML.
- [ ] Applicant session → `/leadership` denied (route guard) **and** API 403.
- [ ] Marketing `/tir`, `/`, sip-marketing serve.
- [ ] New TIR submit gets a real AI score; backfilled TIR apps show scores in
      the dashboard histogram + industry filter.
- [ ] SIP app shows blank AI score with no error in the dashboard.

## 10. Rollback

- **Frontend:** Vercel instant rollback to the prior production deployment.
- **Backend:** redeploy the prior `release/sip-launch-v1` commit from a
  worktree. (Note: this removes the new screener resources — acceptable, they
  are additive/new. Avoid deploying a SIP-only branch to prod afterward, which
  is why the merged branch becomes the single prod source going forward.)
- **Migrations:** additive (new tables + superset status constraint) → **no DB
  rollback needed**. Seeded roles can be revoked by deleting `user_roles` rows.

## 11. Open items to confirm before execution

1. Prod Supabase project ref (to apply `014–018`).
2. Approximate count of current TIR applicants (backfill time/cost estimate).
3. Whether `dev@artpark.in` already exists in prod (script handles both, but
   good to know if it currently holds an in-progress application).
