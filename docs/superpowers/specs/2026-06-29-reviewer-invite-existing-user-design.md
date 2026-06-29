# Reviewer invite — editable password + existing-user conversion — design spec

**Date:** 2026-06-29
**Surface:** Admin reviewer invite (`backend/app/routers/admin_users.py` `create_user`, `frontend/src/pages/admin/platform/screens/AdminReviewers.jsx` InviteModal). Backend SAM deploy + frontend Vercel promote required. **No DB migration.**

## Problem (root-caused 2026-06-29)

Inviting `udayanpawar03@gmail.com` as a reviewer returned "Request failed". Prod logs + DB confirmed: that email is **already a registered user** (an applicant since 2026-05-28). `create_user` only *creates* new users → Supabase 422 → mapped to 409 `email_exists` → modal's generic "Request failed". Separately, the modal's TEMPORARY PASSWORD field is read-only and shows a **client-side placeholder** that isn't the real (server-generated) password.

## Decisions (locked with the user)

1. **Editable temp password** — the modal field is editable; the admin's value is the real account password and is emailed. Validate client-side (≥10 chars, upper + lower + digit + symbol) so a weak value can't cause an opaque Supabase 422.
2. **Existing email → auto-convert to reviewer** (not an error). Grant `reviewer`, remove non-privileged roles so the user is reviewer-only, and reset their password to the admin's temp value so the emailed credentials work.
3. **Reviewer-only access** — after invite the user holds `reviewer` and **not** `applicant`/`founder`/`mentor`, so `landingPathFor` → `/reviewer` and applicant routes are gated out. **`admin`/`leadership` are preserved** if already held (safety: never strip staff via a reviewer invite).

## Behaviour

`POST /admin/users` (`create_user`), when **`"reviewer" in body.roles`** (the roster Invite-member path):

- Request body gains optional **`temp_password: str | None`**. If provided, it is used; else the server generates one (`secrets.token_urlsafe(16) + "!1Aa"`).
- Resolve whether the email exists: query `profiles` by `email` (service-role). 
  - **New** (no profile row): `client.auth.admin.create_user({email, password: temp_password, email_confirm: True})`; insert `user_roles` = the invited roles (`['reviewer']`).
  - **Existing** (profile row found → `uid`): `client.auth.admin.update_user_by_id(uid, {"password": temp_password})`; **reconcile roles** — desired = `{'reviewer'} ∪ (current_roles ∩ {'admin','leadership'})`; delete `user_roles` rows not in desired, insert `reviewer` if missing. Upsert profile `full_name`.
- Both paths: best-effort `send_reviewer_invite(to, reviewer_name, login_email, temp_password, inbox_url=/reviewer)`; return `{id, email, full_name, roles, temp_password, credentials_emailed, existing_user: bool}`.
- **Non-reviewer invites** (admin/leadership add-user, `send_invite` magic-link path) are **unchanged**.
- Password validation: if a provided `temp_password` is too weak, return **400 `weak_password`** with a clear message (so the modal shows "Password must be 10+ chars with upper, lower, digit, symbol" instead of an opaque 422). Server-generated passwords always pass.

Frontend `InviteModal` (`AdminReviewers.jsx`):
- TEMPORARY PASSWORD field: editable `<input type="text">`, pre-filled with a generated strong suggestion (keep `generateBasicPassword()` as the seed but make it editable + regenerate button optional), **sent as `temp_password`** in `adminApi.createUser({... , temp_password})`.
- Client-side validate before submit (same policy); show inline error if weak.
- On 409/400/other failure, show the backend's message (e.g. `email_exists` no longer happens for reviewers; weak_password → clear text), not the generic "Request failed".
- On success show `result.temp_password` (already wired) and, when `existing_user`, a note "Existing user converted to reviewer-only."

## Testing

- **Backend (pytest, `--no-cov`):** new email → create path uses provided `temp_password`, roles `['reviewer']`, email sent; existing email (profiles row seeded) → `update_user_by_id` password reset + roles reconciled to reviewer-only (applicant removed, admin preserved) + email sent + `existing_user: True`; weak provided password → 400 `weak_password`; non-reviewer invite unchanged (magic link, no email).
- **Frontend (vitest):** modal password field is editable and its value is passed to `createUser`; weak password blocks submit with inline error.
- **Real-send QA:** invite `udayanpawar03+rev1@gmail.com` (new → create) and `udayanpawar03@gmail.com` (existing applicant → convert) — both deliver branded credentials to the inbox; the converted account can sign in at `/reviewer` and no longer sees applicant pages.

## Deploy

From `feat/mailing-revamp` (rebase onto latest origin first): SAM deploy (intake flags stay `true/true`), push `release/sip-launch-v1`, then user Vercel-promotes (frontend modal change is user-visible). No migration.

## Out of scope / non-goals

- No change to the OTP/applicant signup. No bulk role tooling. The existing `/admin/users` role grant/revoke endpoints are untouched (this only changes the reviewer-invite create path). `admin`/`leadership` roles are never stripped by this flow.
