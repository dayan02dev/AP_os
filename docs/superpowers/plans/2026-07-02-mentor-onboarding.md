# Mentor Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Branded mentor invite email → per-mentor tokenized branded form page → responses stored in DB → notification to nirav@/professors. (Scrape + auto-match deferred.)

**Architecture:** Two implementer tasks (file-disjoint) + a controller-run ship task. T1 = all backend (migration 029, models, email templates + methods, `mentors.py` router, main.py registration, tests). T2 = frontend (public form page + route + hook + tests). T3 = apply migration, deploy, push, send sample to udayanpawar03@gmail.com, verify. Reuse patterns: `routers/waitlist.py` + `routers/support.py` (public form → DB → staff email), `services/email_service.py` `send_raw`/`_render_pair` + `templates/email/base.html`, `migrations/007_sip_waitlist.sql` (RLS deny-all), `pages/SupportPage.jsx` + `hooks/useSupport.js` + `styles/colors_and_type.css` (`--artblue #3213b7`), `frontend/public/assets/artpark-logo.png`.

**Env:** backend venv `source /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/activate`; backend dir + frontend dir under the release worktree; backend single-file tests `--no-cov`; frontend `npm run build` + `npx vitest run`. Commits: solely the user — NO AI attribution.

---

### Task 1 — Backend [one agent]

**1a. Migration** — Create `backend/migrations/029_mentor_onboarding.sql`:
```sql
-- 029_mentor_onboarding.sql — mentor invites + responses
create table if not exists public.mentor_invites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  token       text not null,
  invited_by  text,
  status      text not null default 'invited',   -- invited | responded | declined
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists mentor_invites_token_uidx on public.mentor_invites (token);
create unique index if not exists mentor_invites_email_uidx on public.mentor_invites (lower(email));
alter table public.mentor_invites enable row level security;
drop policy if exists "mentor_invites: deny all" on public.mentor_invites;
create policy "mentor_invites: deny all" on public.mentor_invites for all to authenticated, anon using (false) with check (false);

create table if not exists public.mentor_responses (
  id                  uuid primary key default gen_random_uuid(),
  invite_id           uuid not null references public.mentor_invites(id) on delete cascade,
  willing             boolean not null,
  days_available      text,
  honorarium_opt_in   boolean,
  bank_details        jsonb,
  future_comms_opt_in boolean,
  contact_email       text,
  ip_addr             inet,
  user_agent          text,
  submitted_at        timestamptz not null default now()
);
create unique index if not exists mentor_responses_invite_uidx on public.mentor_responses (invite_id);
alter table public.mentor_responses enable row level security;
drop policy if exists "mentor_responses: deny all" on public.mentor_responses;
create policy "mentor_responses: deny all" on public.mentor_responses for all to authenticated, anon using (false) with check (false);
```

**1b. Pydantic models** — `backend/app/models/mentor.py`: `MentorInviteCreate` (`invites: list[{name,email}]`, `invited_by: str|None`), `MentorFormView` (`mentor_name, email, already_responded`), `MentorResponseSubmit` (`willing: bool`, `days_available: str|None`, `honorarium_opt_in: bool|None`, `bank_details: {account_name,account_number,ifsc}|None`, `future_comms_opt_in: bool|None`, `contact_email: EmailStr|None`) with a validator: if `willing` then require `days_available`; if `honorarium_opt_in` then require `bank_details`.

**1c. Email templates** (extend `base.html`; pair `.html`+`.txt`):
- `backend/app/templates/email/mentor_invite.html/.txt` — `header_sublabel`="MENTORSHIP"; body = the approved TIR invite copy (greeting uses `mentor_name`); a CTA button linking to `{{ form_url }}` ("Respond to the invitation"). Verbatim copy from the spec/user content.
- `backend/app/templates/email/mentor_response_notify.html/.txt` — staff notification: mentor name/email, willing?, days, honorarium opt-in, future-comms + contact email; when bank details present, show "Bank details captured — view in admin/DB" (NOT the raw numbers).

**1d. email_service methods** (`backend/app/services/email_service.py`): `send_mentor_invite(*, to, mentor_name, form_url, reply_to)` and `send_mentor_response_notification(*, to: list[str], mentor: dict, response: dict, reply_to)` — both via `_render_pair` + `send_raw`.

**1e. Config** (`backend/app/config.py`): `mentor_recipient_emails` (parses `MENTOR_RECIPIENT_EMAILS`, default `["nirav@artpark.in"]`), `mentor_invite_reply_to` (default `"nirav@artpark.in"`). Reuse existing public-app-URL setting to build `form_url = f"{public_app_url}/mentors/respond/{token}"` (find the existing frontend-origin/base-url setting).

**1f. Router** `backend/app/routers/mentors.py` (`prefix="/mentors"`):
- `POST /mentors/invites` — `Depends(require_capability("manage_users"))`. For each invite: upsert `mentor_invites` (mint `secrets.token_urlsafe(24)` if new), send invite email (reply_to=`mentor_invite_reply_to`), stamp `sent_at`, `status='invited'`. Return per-invite `{email, status, form_url}`.
- `GET /mentors/respond/{token}` — public. Resolve token → `MentorFormView`; 404 if unknown.
- `POST /mentors/respond/{token}` — public, `@limiter.limit("5/hour", key_func=<ip>)`. Validate; insert `mentor_responses` (capture ip/user_agent); set invite `status` = `responded` (willing) / `declined` (not); best-effort notify (`mentor_recipient_emails`, reply_to=mentor email); best-effort mentor ack. If a response already exists → return idempotent success. Follow support.py best-effort semantics.
- Register in `backend/app/main.py` (import + `app.include_router(mentors.router)`).

**1g. Tests** `backend/tests/test_mentors.py` (mock Supabase + email like test_support/test_waitlist): token resolve 200/404; decline path (willing=false → status declined, no bank, notify called); full-yes path (stores bank_details, notify called, notification text does NOT contain raw account number); invalid payload (willing but no days) 422; idempotent re-submit. Run `python -m pytest tests/test_mentors.py --no-cov -q` green.

Commit in logical chunks (migration+models; templates+email; router+tests). Backend suite: no new failures vs base.

---

### Task 2 — Frontend [one agent, after T1 merged or in parallel-safe FE files]

**Files:** Create `frontend/src/pages/MentorRespondForm.jsx`, `frontend/src/hooks/useMentorForm.js`; modify `frontend/src/router.jsx` (add public route).
- Route (public, NOT under ProtectedRoute, beside `/apply/support`): `<Route path="/mentors/respond/:token" element={<MentorRespondForm/>} />`.
- `useMentorForm.js`: `load(token)` → `api.get('/mentors/respond/'+token)`; `submit(token, payload)` → `api.post('/mentors/respond/'+token, payload)` (mirror `useSupport.js`).
- `MentorRespondForm.jsx`: branded (design tokens `--artblue`, logo `/assets/artpark-logo.png`, spacing/type vars). On mount load token → prefill mentor name; if `already_responded` show "already responded" state; invalid token → friendly error.
  - Conditional flow: **Q1** Willing? Yes/No. No → submit `{willing:false}` → show *"Thank you for your time and attention, we truly appreciate and respect your decision."* Yes → reveal **Q2** days (text/number), **Q3** honorarium Yes/No → if Yes reveal bank fields (account_name, account_number, ifsc), **Q4** future-comms Yes/No + contact email. Submit → success screen.
  - Client validation matching backend (days required if willing; bank required if honorarium yes; valid email).
- Verify: `npm run build` (must pass) + a vitest (`src/pages/MentorRespondForm` if a harness fits): No→thank-you; Yes reveals Q2-Q4; honorarium Yes reveals bank fields.

Commit per logical piece. Existing suites stay green.

---

### Task 3 — Ship + sample [controller-run]
- Apply `029_mentor_onboarding.sql` to prod Supabase (and staging if used) via service-role.
- Deploy backend (SAM, from the release worktree). Push frontend; user Vercel-promotes.
- Send a **sample invite to udayanpawar03@gmail.com** (call `POST /mentors/invites` or a one-off using `send_mentor_invite`). Open the emailed link, submit the form (a "yes" with dummy bank details), confirm: row in `mentor_responses`, invite `status=responded`, notification email arrived at nirav@ (Reply-To = mentor), no raw bank number in that email.

## Self-review
Spec coverage: invite email=T1(1c,1d)+T3 sample; branded form=T2; tokenized per-mentor=T1(1a token, 1f); DB store=T1(1a); notify nirav@ reply-to mentor=T1(1d,1f); bank details DB-only=T1(1c notify omits, 1b/1a store); decline copy=T2; deferred scrape/match=out of scope. ✔
Names consistent: `mentor_invites`/`mentor_responses`, `token`, `/mentors/respond/{token}`, `send_mentor_invite`/`send_mentor_response_notification` used identically across tasks. ✔
