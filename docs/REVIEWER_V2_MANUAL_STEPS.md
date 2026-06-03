# Reviewer V2 — Manual Deploy Steps

Steps a human must complete outside the codebase to make the pilot live.
Do these in order.

---

## 1. Ensure the 3 pilot accounts exist in Supabase Auth

The migration (Step 2) will silently skip any email that doesn't have an
`auth.users` row yet, so the accounts must exist first.

**Option A — Each person signs up normally:**
Direct each person to `<your-domain>/apply/signup` and have them complete
the email-OTP flow. They will land on the applicant wizard — that's fine;
the role grant in Step 2 re-routes them.

**Option B — Create accounts via Supabase Dashboard:**
1. Open Supabase Dashboard → Authentication → Users.
2. Click **Invite user** (or **Add user** depending on your plan).
3. Enter the email and a temporary password.
4. The user will receive an invite email with a password-reset link.

Accounts to create:
- `udayan.pawar@artpark.in`
- `sanjay.haritwal@artpark.in`
- `dev@artpark.in`

---

## 2. Run migration 022 in the Supabase SQL editor

1. Open Supabase Dashboard → SQL Editor → New query.
2. Paste the full contents of:
   `backend/migrations/022_seed_reviewer_accounts.sql`
3. Click **Run**.
4. Check the output messages — you should see one `NOTICE` per email:
   ```
   NOTICE:  Granted reviewer role to udayan.pawar@artpark.in (<uuid>)
   NOTICE:  Granted reviewer role to sanjay.haritwal@artpark.in (<uuid>)
   NOTICE:  Granted reviewer role to dev@artpark.in (<uuid>)
   ```
   If you see `User not found in auth.users: <email> — skipping`, that
   account doesn't exist yet. Complete Step 1 for that email, then re-run.

The migration is idempotent — re-running it is safe.

---

## 3. Verify the role grant

Run this query in the Supabase SQL editor to confirm all three accounts
have the `reviewer` role:

```sql
select
  u.email,
  ur.role,
  ur.granted_at
from auth.users u
join public.user_roles ur on ur.user_id = u.id
where u.email in (
  'udayan.pawar@artpark.in',
  'sanjay.haritwal@artpark.in',
  'dev@artpark.in'
)
order by u.email;
```

Expected: 3 rows, each with `role = 'reviewer'`.

---

## 4. Vercel preview environment variables

Set these in the Vercel project settings for the preview deployment
(Settings → Environment Variables → Preview):

| Variable | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.artpark.info` | Production FastAPI backend |
| `VITE_SUPABASE_URL` | `https://<your-project>.supabase.co` | From Supabase Dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | From Supabase Dashboard → Settings → API |
| `VITE_REVIEWER_V2_MOCK` | `false` | Must be false to use the real backend |
| `VITE_REVIEWER_V2_READONLY` | `true` | **Start here.** Blocks save/submit and shows "Demo mode" toast. Flip to `false` after the manager confirms writes can land in production. |

> **Why start with `VITE_REVIEWER_V2_READONLY=true`?**
> The reviewer V2 scoring form writes to `public.reviews` via
> `POST /reviewer/reviews` and `PATCH /reviewer/reviews/{id}`. Starting
> read-only means the demo cannot accidentally create real review records
> in production. Once the manager signs off, flip this to `false` and
> redeploy.

---

## 5. Login walkthrough for the demo

1. Each reviewer opens: `<preview-url>/apply/signin`
2. Signs in with their email + password (or uses the 6-digit code link).
3. **Expected redirect:** `/reviewer-v2/inbox`
   - If they land on `/reviewer/inbox` instead, their email is not in the
     allowlist or the landing.js change wasn't deployed. Check the Vercel
     deployment logs.
   - If they land on `/apply`, the reviewer role was not granted. Re-run
     Step 2.
4. Walk through the portal:
   - **Dashboard tab** — stat tiles, AI score histogram, industry breakdown.
   - **My Queue tab** — 8-column filterable table of assigned applications.
   - Click a row → **Evaluation form** — read the application, set scores,
     write notes, add flags.
   - **Save draft** → should show "Demo mode — evaluation not saved." toast
     (because `VITE_REVIEWER_V2_READONLY=true`).
   - **My History** tab — past submitted reviews.

---

## 6. Rollback procedure

If the demo goes badly and you need to revert immediately:

**Option A — Fastest: Vercel env var flip**
Set `VITE_REVIEWER_V2_MOCK=true` in Vercel preview environment variables
and redeploy. This forces mock data for all users and makes no backend
calls. The allowlist routing still fires, but the UI runs entirely on
local mock state.

**Option B — Revert the landing.js change**
```bash
# On your local machine, on work/reviewer-integration:
git revert <commit-sha-of-phase4-commit>
# Then push the revert to the Vercel-tracked branch
```
Do NOT push to `release/sip-launch-v1` or `main`.

**Option C — Per-user rollback**
To move a single user back to the old UI without redeploying:
1. Remove their email from `REVIEWER_V2_ALLOWLIST` in
   `frontend/src/lib/landing.js`.
2. Redeploy the preview branch.
They will land on `/reviewer/inbox` (the existing production UI) on next
login.

**Option D — Remove the role entirely**
If a pilot account should not have reviewer access at all:
```sql
delete from public.user_roles
 where user_id = (select id from auth.users where email = 'email@artpark.in')
   and role = 'reviewer';
```
