# Mentor Onboarding — Design Spec (2026-07-02)

> Base: prod `release/sip-launch-v1`. Scope = invite email + branded hosted form + DB storage + staff notification. Steps 3 (LinkedIn/Scholar auto-scrape → digital persona) and 4 (auto-match mentors to jury-round startups) are DEFERRED to separate specs.

## Goal
Invite prospective mentors to the TIR program via a branded ARTPARK email; each mentor opens a personal, branded form page; their answers are stored in our DB; each submission notifies a real staff inbox (nirav@artpark.in + professors), not no-reply.

## Decisions (locked)
- Build invite+form+DB+notify now; defer scrape + auto-match.
- The form is a **branded hosted page** in our SPA (emails can't submit to a DB); the email links to it. Uses the ARTPARK design system (`--artblue #3213b7`, logo, type/spacing tokens).
- Invite sends **from `noreply@artpark.info`** (verified) with **Reply-To `nirav@artpark.in`**; response notifications go **to** `nirav@artpark.in` + a configurable `MENTOR_RECIPIENT_EMAILS` list.
- **Unique tokenized link per mentor** (ties response to the invited mentor, prefills name).
- **Bank details:** stored in DB only (RLS deny-all; admin/service-role read). The staff notification email does NOT include raw bank numbers — it says "bank details captured — view in admin/DB".

## Data model — migration `029_mentor_onboarding.sql` (RLS deny-all, service-role writes; model on `007_sip_waitlist.sql`)
- `mentor_invites`: `id uuid pk`, `name text`, `email text`, `token text unique` (secure random, e.g. `secrets.token_urlsafe(24)`), `invited_by text`, `sent_at timestamptz`, `status text` (`invited`│`responded`│`declined`), `created_at`. Unique index on `lower(email)` (idempotent re-invite) + on `token`.
- `mentor_responses`: `id uuid pk`, `invite_id uuid → mentor_invites(id)`, `willing boolean` (Q1), `days_available text` (Q2), `honorarium_opt_in boolean` (Q3), `bank_details jsonb` (Q3-if-yes: {account_name, account_number, ifsc}), `future_comms_opt_in boolean` (Q4), `contact_email text` (Q4), `submitted_at timestamptz default now()`, `ip_addr inet`, `user_agent text`. Unique index on `invite_id` (one response per invite).

## Backend — `backend/app/routers/mentors.py`
- `POST /mentors/invites` — **admin-gated** (`require_capability("manage_users")`). Body `{invites:[{name,email}], invited_by?}`. For each: upsert `mentor_invites` (mint token if new), send branded invite email, stamp `sent_at`+`status=invited`. Returns per-invite `{email, status, form_url}`.
- `GET /mentors/respond/{token}` — **public**. Resolve token → `{mentor_name, email, already_responded}`; 404 on bad/unknown token.
- `POST /mentors/respond/{token}` — **public**, rate-limited `5/hour` per IP (slowapi, like waitlist). Validate payload; insert `mentor_responses`; set invite `status = responded` (willing) or `declined` (not willing); best-effort notify staff + best-effort mentor ack. Idempotent: if already responded, return 409/idempotent success.
- Email methods on `services/email_service.py` (reuse `send_raw` + `_render_pair`):
  - `send_mentor_invite(to, mentor_name, form_url, reply_to="nirav@artpark.in")` → `templates/email/mentor_invite.{html,txt}` (the TIR invite copy, extends `base.html`, `header_sublabel`="MENTORSHIP", CTA button → `form_url`).
  - `send_mentor_response_notification(to=[recipients], mentor, response)` → `templates/email/mentor_response_notify.{html,txt}`, `reply_to = mentor.email`. Includes answers EXCEPT raw bank details (shows "bank details captured" when present).
  - (best-effort) mentor ack reuses a simple confirmation template.
- Config: `MENTOR_RECIPIENT_EMAILS` (comma-sep, default `["nirav@artpark.in"]`); `mentor_invite_reply_to` default `nirav@artpark.in`. `PUBLIC_APP_URL` (already used) to build `form_url = {app}/mentors/respond/{token}`.

## Frontend — public route `/mentors/respond/:token` → `pages/MentorRespondForm.jsx`
- No auth gate (declared alongside `/apply/support` in `router.jsx`). Branded with design-system tokens + `/assets/artpark-logo.png`.
- On load: `GET /mentors/respond/{token}` → prefill name; if `already_responded`, show a "you've already responded" state.
- Google-Form-style, single page with conditional reveals:
  - **Q1** *Would you be willing to mentor a few Technology Innovators at ARTPARK?* (Yes/No).
    - **No** → submit `{willing:false}` → show *"Thank you for your time and attention, we truly appreciate and respect your decision."*
    - **Yes** → reveal:
      - **Q2** *How many days could you allocate to startups?* (short text / number).
      - **Q3** *Open to a small honorarium from ARTPARK?* (Yes/No) → if **Yes**, reveal bank fields (account name, account number, IFSC).
      - **Q4** *Open to future communications from ARTPARK?* (Yes/No) + *Email address to register/engage* (email).
  - Submit → `POST /mentors/respond/{token}` → success screen.
- API hook `hooks/useMentorForm.js` (`api.get`/`api.post`, like `useSupport.js`).

## Testing
- Backend: unit tests (mock Supabase + email) for token resolve (200/404), decline path (`willing=false` → status declined, no bank), full yes path (stores bank_details, notify called, notification omits raw bank numbers), rate limit, idempotent re-submit. Run `--no-cov`.
- Frontend: vitest for the conditional flow (No → thank-you; Yes → reveals Q2-Q4; honorarium Yes → bank fields) + submit success.

## Rollout
1. Apply migration 029 (staging → prod).
2. Deploy backend (SAM). 3. Push + Vercel promote frontend.
4. Send a **sample invite to udayanpawar03@gmail.com**; verify the email renders branded, the link opens the form, a submission stores + notifies nirav@ (Reply-To = mentor).

## Deferred (future specs)
- **Step 3:** enrich accepted mentors from LinkedIn / Google Scholar / web → digital persona. (Note: LinkedIn scraping violates ToS; prefer official APIs / manual enrichment / a compliant provider.)
- **Step 4:** auto-match mentors (≤3 startups each) to jury-round startups.
