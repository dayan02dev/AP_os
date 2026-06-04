# Push & Deploy — Reviewer V2 Pilot

## What you are about to ship

The REVIEWER-UI prototype (Udita's pixel-complete standalone React app) has
been ported into the production Vite codebase as a new route subtree at
`/reviewer-v2/*`. The three pilot reviewer emails (`udayan.pawar@artpark.in`,
`sanjay.haritwal@artpark.in`, `dev@artpark.in`) are allowlisted in
`frontend/src/lib/landing.js` so they land on `/reviewer-v2/inbox` after
sign-in; all other reviewer accounts continue to land on the existing
`/reviewer/inbox`. The new UI talks to the same `backend/app/routers/reviewer.py`
endpoints that the existing reviewer surface uses — no backend changes were
made. A `VITE_REVIEWER_V2_READONLY=true` build flag blocks all save/submit
writes and shows a "Demo mode" toast, providing a safe guard for the initial
manager demo before writes are authorised for production.

---

## What stays untouched in production

- `frontend/src/pages/reviewer/` — existing reviewer UI (non-pilot users
  continue to use this surface unchanged)
- `backend/app/` — zero code changes; the new UI calls existing endpoints
- `main` and `release/sip-launch-v1` branches — neither is modified
- `REVIEWER-UI` branch — read-only reference throughout; never checked out

---

## Branch and commit summary

**Branch:** `work/reviewer-integration`  
**Base:** `release/sip-launch-v1` tip (`e2c1724`)  
**Commits on this branch (10):**

```
bc219d7  docs: manual smoke-test checklist for reviewer-v2
0b89b04  chore(reviewer-v2): housekeeping for three flagged items
87a7137  feat(reviewer-v2): allowlist routing for 3 pilot reviewers
635bb4f  chore: refresh CLAUDE.md to reflect post-Phase-3 state
ef8c148  chore: track CLAUDE.md baseline (will refresh post Phase 4)
a267fe5  feat(reviewer-v2): wire reviewerApiV2 to real backend endpoints
a96e6b8  feat(reviewer-v2): port prototype into Vite app under /reviewer-v2/*
791f606  docs: add reviewer rewire design plan
dfcc006  chore: import REVIEWER-UI prototype assets missed by Phase 0
9bdbc58  chore: import REVIEWER-UI prototype files into integration branch
```

---

## Pre-push checklist

- [ ] `git status` shows a clean working tree (no uncommitted changes)
- [ ] `git branch --show-current` prints `work/reviewer-integration`
- [ ] Local smoke test passed: `/reviewer-v2/inbox` rendered the queue,
      eval screen loaded, submit showed the "Demo mode" toast
- [ ] Migration 022 has been run against the target Supabase project
      (`backend/migrations/022_seed_reviewer_accounts.sql`) — see
      `docs/REVIEWER_V2_MANUAL_STEPS.md §2`
- [ ] The three pilot reviewer accounts exist in Supabase Auth and can sign in
- [ ] You have confirmed which Vercel project / git branch triggers the
      preview or production deploy (see Deployment section below)

---

## Push commands (run these yourself — NOT Claude Code)

```bash
# 1. Final sanity check before pushing
git status
git branch --show-current      # must print: work/reviewer-integration
git log --oneline -5           # confirm last commit is bc219d7

# 2. Push to the remote — this triggers a Vercel build
git push origin work/reviewer-integration

# 3. If Vercel is configured to auto-deploy this branch, open the
#    Vercel dashboard and watch the build. Otherwise trigger manually
#    via: Vercel Dashboard → Deployments → Redeploy.
```

The pre-push hook blocks pushes to `main`, `release/sip-launch-v1`, and
`REVIEWER-UI`. This branch (`work/reviewer-integration`) is not blocked.

---

## Vercel environment variables to set

Set these in the Vercel project for the **preview** environment
(Settings → Environment Variables → Preview) before the first deploy.
Do not put real secrets here — copy them from your local `.env.production`.

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.artpark.info` | Production FastAPI endpoint |
| `VITE_SUPABASE_URL` | *(from your Supabase dashboard)* | Use the **same** project as your production backend |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Anon / public key — safe to expose in browser |
| `VITE_REVIEWER_V2_MOCK` | `false` | Must be false to call the real backend |
| `VITE_REVIEWER_V2_READONLY` | `true` | **Keep true** until manager confirms writes can land in production |

> **`VITE_REVIEWER_V2_READONLY` is a build-time variable.** Changing it in
> Vercel dashboard triggers a redeploy (30–60 s for a preview). There is no
> runtime toggle. Schedule the flip to `false` during a quiet window.

### CORS note

`api.artpark.info` (the production Lambda) only allows `https://apply.artpark.info`
in its `FRONTEND_ORIGIN` list. If your Vercel preview URL is a different
domain (e.g. `https://ap-os-git-reviewer-v2-artpark.vercel.app`), the
browser's preflight will be rejected by the backend.

**Resolution — one of:**
1. Add the Vercel preview URL to `FRONTEND_ORIGIN` in the production backend
   env and redeploy the Lambda. (Recommended — permanent fix for preview
   deployments.)
2. Point the preview at the staging API instead of production, and use staging
   Supabase credentials. (Used during local smoke testing — see
   `docs/REVIEWER_V2_MANUAL_STEPS.md §4`.)

---

## Post-deploy verification

After Vercel finishes the build:

1. Open `<preview-url>/apply/signin`
2. Sign in as one of the three pilot emails
3. Expected redirect: `<preview-url>/reviewer-v2/inbox`
4. Confirm the queue table loads (real assignments from the backend if
   migration 022 has been run, empty otherwise)
5. Click a row → eval screen loads
6. Move a slider and click "Submit" → toast: "Demo mode — submission blocked."
   (confirms `VITE_REVIEWER_V2_READONLY=true` is baked in)

If you land on `/reviewer/inbox` instead of `/reviewer-v2/inbox`, the email
is not in the allowlist (check `frontend/src/lib/landing.js`) or the Vercel
deployment doesn't have this branch's code.

If you land on `/apply`, the reviewer role has not been granted — re-run
migration 022 against the target Supabase project.

---

## Rollback procedure

**Fastest — Vercel:** In the Vercel dashboard, redeploy the previous
successful deployment from `release/sip-launch-v1`. The new routes
(`/reviewer-v2/*`) disappear; pilot users land on `/reviewer/inbox` as before.

**Git revert:**
```bash
# Revert the landing.js change so pilot users land on the old UI
git revert 87a7137    # feat(reviewer-v2): allowlist routing for 3 pilot reviewers
git push origin work/reviewer-integration
# Vercel redeploys automatically
```

**Per-user rollback:** Remove the user's email from `REVIEWER_V2_ALLOWLIST`
in `frontend/src/lib/landing.js` and redeploy. They land on `/reviewer/inbox`.

**Remove reviewer role:**
```sql
delete from public.user_roles
 where user_id = (select id from auth.users where email = 'email@artpark.in')
   and role = 'reviewer';
```

---

## Key files changed in this branch

```
frontend/src/lib/
  landing.js                    Allowlist routing (3 emails → /reviewer-v2/inbox)
  reviewerApiV2.js              API client (dispatches on VITE_REVIEWER_V2_MOCK)
  reviewerApiV2.adapters.js     Backend → prototype shape adapters
  reviewerApiV2.mock.js         Phase 2 mock (active when MOCK=true)

frontend/src/pages/reviewer-v2/
  ReviewerV2AppShell.jsx        Shell: topbar + <Outlet/>
  ReviewerV2InboxPage.jsx       Dashboard + Queue tabs
  ReviewerV2EvaluationPage.jsx  Eval form with FullApplicationView
  ReviewerV2HistoryPage.jsx     Locked-review history table
  components/                   atoms, Slider, ScoreBar, QueueTable, etc.
  data/                         mockData.js, rubric.js
  styles/reviewer-v2.css        Scoped under .reviewer-v2-shell

frontend/src/pages/
  SignInPage.jsx                 +email arg to landingPathFor (1 line)
  VerifyPage.jsx                 +email arg to landingPathFor (1 line)

frontend/src/router.jsx          /reviewer-v2/* routes added (additive only)
frontend/.env.example            VITE_REVIEWER_V2_MOCK and READONLY documented

backend/migrations/
  022_seed_reviewer_accounts.sql  Grants reviewer role to 3 pilot emails
                                  (run manually — NOT auto-applied)

assets/
  artpark-iisc-combined.webp    }
  artpark-logo.png              } Logo assets for the reviewer portal topbar
  iisc-logo.png                 }

docs/
  REVIEWER_REWIRE_PLAN.md       Full design doc (API map, adapters, phase plan)
  REVIEWER_V2_MANUAL_STEPS.md   Ops checklist (Supabase setup, Vercel env vars)
  REVIEWER_V2_SMOKE_CHECKLIST.md  Manual browser test checklist
  PUSH_AND_DEPLOY.md            This file
```

---

## References

- API mapping and adapter logic: `docs/REVIEWER_REWIRE_PLAN.md §3–4`
- Supabase setup and SQL migration: `docs/REVIEWER_V2_MANUAL_STEPS.md`
- Browser walkthrough checklist: `docs/REVIEWER_V2_SMOKE_CHECKLIST.md`
- Known data gaps (—cells): `docs/REVIEWER_V2_MANUAL_STEPS.md §Known visible placeholders`
- CLAUDE.md: full codebase reference for this branch
