# ARTPARK mailing-system revamp — design spec

**Date:** 2026-06-29
**Surface:** Backend email subsystem (`backend/app/services/email_service.py`, `backend/app/templates/email/`, `backend/workers/`, `backend/app/routers/admin_users.py`) + SAM (`infra/sam/template.yaml`). One tiny frontend touch (invite modal). Backend **SAM deploy required**. **No DB migration.**

## Goal

Bring all transactional email onto a single, strictly on-brand ARTPARK shell and complete five mail flows — two of which don't exist yet. Every email must be visually coherent (logo, colour, type) with the ARTPARK brand and with each other.

The five mails:
1. **Applicant decision** — advanced (admin approve) / rejected. *(restyle existing)*
2. **Reviewer invite** — admin invites a reviewer from the roster → reviewer gets login email + temp password. *(new behaviour)*
3. **Reviewer assigned** — admin assigns apps/batch → reviewer notified. *(restyle + content cut)*
4. **Reviewer daily reminder** — pending-applications nudge at 09:00 IST. *(new)*
5. **Admin daily update** — all-reviewers progress snapshot at 08:00 IST. *(restyle + content change)*

## Decisions (locked with the user)

- **Brand direction:** purple header band (`#3213b7`) with a white **ARTPARK** wordmark, white body card, sharp 2px corners, flat, Trebuchet headings, Open Sans body, solid-purple CTA with one `→`. This shared shell is used by every email. Logo on the band = white **type-set wordmark** (no white logo PNG exists; the brand is type-first).
- **Mail 2:** email the **temp password** (server-created), replacing the Supabase magic-link for reviewer invites. Plaintext one-time temp password, change-on-login.
- **Mail 4:** **09:00 IST**, **skip reviewers with 0 pending**.
- **Mail 5:** **all active reviewers' progress** (assigned / completed / pending), full roster snapshot daily.
- **Inbox buttons** link to the reviewer sign-in at `apply.artpark.info/reviewer`.
- **Lock:** after the test sends to `udayanpawar03@gmail.com` pass and the user approves, deploy these five as canonical and freeze them (don't alter in unrelated future work). Recorded in memory.

## Current state (grounding)

- **Sender layer** `services/email_service.py` (Resend HTTP API; `from = settings.ses_from_email` on the DKIM-verified `artpark.info`; `send_raw` with one 429 retry; `_render_pair` renders `<base>.html`+`<base>.txt` via Jinja2 from `app/templates/email/`; `frontend_url(path)` builds `apply.artpark.info{path}`). Existing senders: `send_submission_confirmation`, `send_support_ticket`, `send_ticket_acknowledgement`, `send_role_granted`, **`send_applicant_decision`** (advanced/rejected), **`send_reviewer_assigned`** (apps, inbox_url), **`send_daily_digest`** (date_label, total_reviews, reviewers).
- **Shared layout** `templates/email/base.html` is a generic beige shell (`#f4f1ea`, monospace eyebrow, black button) — NOT ARTPARK. Defines `{% block title %}` + `{% block content %}`. Every other template `{% extends "base.html" %}`.
- **Mail 1** `applicant_decision_advanced.{html,txt}` + `applicant_decision_rejected.{html,txt}` exist; plain copy on the beige base; `send_applicant_decision` takes `{applicant_name, application_ref}` — **no track/program label**.
- **Mail 2** `admin_users.create_user` (`POST /admin/users`): generates `temp_password = secrets.token_urlsafe(16) + "!1Aa"`. With `send_invite=True` (the roster default) it calls Supabase `invite_user_by_email` (magic-link, **no password mailed**) and returns `temp_password: None`; with `send_invite=False` it creates the account with the temp password and returns it. The roster `InviteModal` (`AdminReviewers.jsx`) calls `createUser({roles:['reviewer'], send_invite:true})` and shows a **client-generated decorative** password; the displayed-result branch already renders `result.temp_password` when present.
- **Mail 3** `reviewer_assigned.html` loops each app (applicant_name + short ID) and contains "If you can't take these on (conflict of interest, capacity), reply and we'll reassign." — **both to be removed**. `services/assignment_email.py:notify_reviewers_assigned` builds `apps` and calls `send_reviewer_assigned(apps=…, inbox_url=frontend_url("/reviewer"))`.
- **Mail 5** worker `workers/daily_digest/handler.py` (EventBridge `cron(30 2 * * ? *)` = 08:00 IST; `DailyDigestFunction` in `infra/sam/template.yaml`) summarises the **previous IST day's submitted reviews only** (`digest_window` + `digest_summary`), recipients via `user_lookup.get_admin_emails`.
- **Roster data** `admin_query.fetch_roster()` returns, per active reviewer: `name`, `email`, `assigned`, `completed`, `progress` ("c / a"). `pending = assigned − completed`. Importable by workers (the digest worker already imports `app.services.*`).
- **Brand tokens** (`docs/design-system.md`, `frontend/src/styles/colors_and_type.css`): `--artblue #3213b7`, `--artblue-deep #1f0a8a`, mint `--artlight` (~`#d8d0f3`/`#aafcf0`), `--accent-green #2F6F62`, `--ink #242424`, `--paper #fff`, `--paper-soft #f6f6f8`. Display = Trebuchet MS (web-safe); body = Open Sans → system fallback. Rules: sharp 2px corners, flat (no shadow/gradient), headlines end with a period, **no exclamation marks**, second person, UPPERCASE eyebrows (0.14em), one `→`.
- **Logo assets** `frontend/public/assets/artpark-logo.png` (+ black/iisc/webp), servable at `https://apply.artpark.info/assets/…` — used only where a logo renders on white; the purple band uses the white wordmark.

---

## Change 1 — Shared branded shell (`base.html` rewrite)

Rewrite `templates/email/base.html` to Direction A, **backward-compatible**:
- Keep `{% block title %}` and `{% block content %}`. Add optional `{% block eyebrow %}` and `{% block header_sublabel %}` (default empty) so existing templates that define only title+content still render in the new shell.
- Structure (all inline styles, table-based for email clients): outer bg `#f6f6f8`; centered 560px card, white, `1px solid #e4e2ee`, no radius; **purple header band** `#3213b7` padding 18–22px with white wordmark `ARTPARK` (Trebuchet 700, 20px, `-0.01em`) + optional white-on-purple uppercase sub-label (`#c9bdf5`, 10px, 0.14em); body cell padding 28px, Open Sans 14–15px / 1.6, ink `#242424`; footer cell `1px solid #ececf2`, `#9a96a8`, 11px: "ARTPARK at IISc · Bengaluru · artpark.in".
- Shared content primitives templates can use: eyebrow line (uppercase 10px 0.14em `#8a86a0`), `h1` (Trebuchet 700 22px ends with period), CTA anchor (bg `#3213b7`, white, Trebuchet 600, padding 11×20, `Label &nbsp;→`), and a "code block" style for credentials (mono-ish, `#f6f6f8` bg, `1px solid #e4e2ee`, padding).
- `base.txt`: plain-text wrapper unchanged in spirit (header line + content + footer line).

This restyle also (cleanly, no downside) upgrades `submission_confirmation`, `support_ticket`, `ticket_ack`, `role_granted`, `status_change` to the brand — they keep rendering via the preserved blocks.

## Change 2 — Mail 1: applicant decision (restyle + program label)

- `applicant_decision_advanced.html` content: eyebrow "Application update"; headline "Congratulations, {{ applicant_name }} — you've advanced to the next round."; body thanks them for applying to the {{ program_label }} program, states they've advanced, and notes **further updates will be sent by email**; warm + formal; no CTA. `.txt` mirror.
- `applicant_decision_rejected.html` content: eyebrow "Application update"; headline "An update on your ARTPARK application, {{ applicant_name }}."; gracious, reassuring, encouraging copy thanking them for applying to {{ program_label }}; no rationale; warm sign-off. `.txt` mirror.
- `send_applicant_decision(..., program_label="")`: add `program_label` to the context (e.g. "VIP"/"TIR" via `_track_label`). Thread `track` from the decision chokepoint (`services/decisions.py` / `notify_applicant_decided`) into the sender; default to a neutral "ARTPARK" when track is unknown so the copy never shows a blank.

## Change 3 — Mail 2: reviewer invite credentials (new sender + wiring)

- **New template** `reviewer_invite.{html,txt}`: eyebrow "Reviewer invitation"; headline "You've been invited to review for ARTPARK."; body — invited by the ARTPARK admin to review TIR + VIP applications; sign in with these credentials; **credentials code block** showing `Email: {{ login_email }}` and `Temporary password: {{ temp_password }}`; "Open reviewer inbox →" CTA → `{{ inbox_url }}`; a line to change the password after first sign-in; warm + formal.
- **New sender** `send_reviewer_invite(*, to, reviewer_name, login_email, temp_password, inbox_url)` → subject "You've been invited to review for ARTPARK".
- **Wiring** `admin_users.create_user`: when the created user's `roles` include `"reviewer"`, take the **create-with-temp-password** path (Supabase `admin.create_user` with `password=temp_password`, `email_confirm=True`) instead of the magic-link `invite_user_by_email`, then best-effort `send_reviewer_invite(to=email, reviewer_name=full_name, login_email=email, temp_password=temp_password, inbox_url=frontend_url("/reviewer"))`, and **return `temp_password`** in the response. Non-reviewer invites keep their current behaviour. (The roster modal already displays `result.temp_password` when present, so it now shows the real one — no FE logic change needed; verify it renders.)
- Security note: a one-time plaintext temp password in email is acceptable here (must be changed on first login; the admin modal already exposes it). Documented, intentional.

## Change 4 — Mail 3: reviewer assigned (content cut)

- `reviewer_assigned.html`: remove the `{% for app in apps %}` list block and the "If you can't take these on … reply and we'll reassign" line. New content: eyebrow "New applications assigned"; headline "Hello {{ reviewer_name }} — {{ count }} application{{ 's' if count != 1 else '' }} {{ 'are' if count != 1 else 'is' }} waiting for your review."; one warm paragraph (thank-you for their time + that the apps are in their inbox); "Open reviewer inbox →" CTA → `{{ inbox_url }}`; sign-off. `.txt` mirror.
- `send_reviewer_assigned` keeps its signature; the template just uses `count` (= `len(apps)`) and ignores per-app fields. `notify_reviewers_assigned` is unchanged.

## Change 5 — Mail 4: reviewer daily reminder (new worker + sender + schedule)

- **New sender** `send_reviewer_reminder(*, to, reviewer_name, pending_count, completed_count, inbox_url)` + template `reviewer_reminder.{html,txt}`: eyebrow "Daily review reminder"; headline "You have {{ pending_count }} application{{ 's' if pending_count != 1 else '' }} left to review."; warm body ("You've completed {{ completed_count }} — {{ pending_count }} still pending. Thank you for keeping the panel moving."); "Open reviewer inbox →" CTA. Subject "{{ pending_count }} application(s) awaiting your review — ARTPARK".
- **New worker** `workers/reviewer_reminder/handler.py`: `lambda_handler` calls `admin_query.fetch_roster()`, for each reviewer computes `pending = assigned − completed`, **skips `pending <= 0` and rows without an email**, and best-effort sends one reminder each. Returns a small summary dict `{sent, skipped}`.
- **SAM**: add `ReviewerReminderFunction` (handler `workers.reviewer_reminder.handler.lambda_handler`, same role/env/layers as `DailyDigestFunction`) with EventBridge `Schedule: "cron(30 3 * * ? *)"` (09:00 IST) + a `ReviewerReminderLogGroup`. Mirror the `DailyDigestFunction` block exactly.

## Change 6 — Mail 5: admin daily update (all-reviewers snapshot)

- `daily_digest.html` revamp to the brand: eyebrow "Reviewer activity"; headline "Reviewer progress — {{ date_label }}."; a table of **every active reviewer** with columns Reviewer · Completed / Assigned · Pending; a small total line. `.txt` mirror.
- `send_daily_digest(*, to, date_label, reviewers, total_pending, total_assigned)` — context is `reviewers = [{name, assigned, completed, pending}]` plus `total_pending` and `total_assigned` for the summary line. Drop the old `total_reviews` arg.
- `workers/daily_digest/handler.py`: replace the previous-day window query with `admin_query.fetch_roster()` → build `reviewers` (all active, sorted by pending desc), `date_label` = today (IST), recipients via `get_admin_emails`. `digest_window`/`digest_summary` become unused by this worker (leave the modules in place; do not delete — out of scope).

---

## Testing

**Real sends (visual QA)** — `backend/scripts/send_test_emails.py`: a standalone script that calls each sender with representative sample data, all `to=udayanpawar03@gmail.com`, so every one of the 5 (1a, 1b, 2, 3, 4, 5) lands in the inbox for eyeballing. Mail 2 calls `send_reviewer_invite` **directly with a sample temp password** (no real account created). Run locally with the prod `RESEND_API_KEY` + `SES_FROM_EMAIL` exported (sourced from `backend/.env.prod`). The user confirms all five look coherent and on-brand.

**Unit tests** (pytest, `--no-cov` for single-file runs):
- Each new sender renders both html+txt without error and includes its key fields (invite → temp password + inbox URL; reminder → pending/completed; digest → each reviewer row).
- `create_user` with `roles=['reviewer']` creates a password account (not a magic-link invite) and invokes `send_reviewer_invite` (monkeypatched); response carries `temp_password`.
- `reviewer_reminder` handler skips zero-pending reviewers and those without email.
- `daily_digest` handler includes all active reviewers from a stubbed `fetch_roster`.
- `reviewer_assigned` template renders count-only (no per-app ID, no "reassign" line) — assert the removed strings are absent.
- Existing email/digest tests stay green.

**Build/health**: backend pytest for the email + worker + admin_users suites green; `sam build` succeeds; post-deploy `/health` ok.

## Deploy

From the `feat/mailing-revamp` worktree: **grep `backend/.env.prod` for `TIR_/SIP_SUBMISSIONS_CLOSED=true`** (must stay closed; copy the file in as it's per-worktree + gitignored), then `infra/sam/deploy-prod.sh` (ships the new senders, templates, the `ReviewerReminderFunction` + its schedule, and the `create_user` change). Push `feat/mailing-revamp` → `release/sip-launch-v1` (rebase onto latest origin first). Frontend: no logic change expected (modal already renders `result.temp_password`); if a tweak is needed, Vercel promote. Two EventBridge schedules will then be live: admin digest 08:00 IST, reviewer reminder 09:00 IST.

## Lock (after sign-off)

Once the inbox test passes and the user approves: deploy, then record in memory that these five emails (templates + senders + triggers + the two schedules) are the **canonical, frozen** ARTPARK mailing set for these roles/tasks — not to be restyled or rewired in unrelated future work.

## Out of scope / non-goals

- No DB migration. No change to OTP/auth emails (Supabase-sent). No change to support/submission/role-granted **content** (they inherit the new shell only). No deletion of `digest_window`/`digest_summary`. No jury/mentor emails. No reviewer **decline** email.

## Files touched (summary)

**Backend:** `app/services/email_service.py` (rewrite senders' context; add `send_reviewer_invite`, `send_reviewer_reminder`; `send_daily_digest`/`send_applicant_decision` context); `app/templates/email/` (`base.{html,txt}` rewrite; `applicant_decision_advanced/rejected`, `reviewer_assigned`, `daily_digest` revamp; new `reviewer_invite.{html,txt}`, `reviewer_reminder.{html,txt}`); `app/routers/admin_users.py` (reviewer-invite credentials path); `app/services/decisions.py` (thread track→program_label); `workers/reviewer_reminder/handler.py` (new); `workers/daily_digest/handler.py` (roster snapshot); `scripts/send_test_emails.py` (new); tests under `backend/tests/`.

**Infra:** `infra/sam/template.yaml` (`ReviewerReminderFunction` + schedule + log group).

**Frontend:** none expected (verify `AdminReviewers.jsx` invite modal shows `result.temp_password`).
