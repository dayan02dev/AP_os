# Edit-after-submit blank screen fix + TIR window extension — Design Spec

**Date:** 2026-06-26
**Branch:** `fix/edit-after-submit-blank-tir-window` (worktree off `origin/release/sip-launch-v1` @ `c3bac0a`)
**Severity:** production — applicants cannot edit submitted applications (blank/closed screen)
**Target:** production. **No DB migration.**

## Problem

A VIP (SIP) applicant with a *submitted* application sees a blank/closed screen when trying to
edit it. Confirmed with live data: `kumarimc@gmail.com` (track sip) has one SIP app in
`under_review` (submitted 15 Jun, editable) and **no draft row**.

## Root cause (confirmed in code + data)

Closing intake (`sip_submissions_closed` / `tir_submissions_closed = true`) made the draft fetch
`GET /sip-applications/me` (and TIR `GET /applications/me`) return **403 `*_submissions_closed`** for
any applicant who has a submitted app but no draft (`_fetch_application` is `status='draft'`-only).
The frontend loads the draft and the submitted list together in one `Promise.all`, so that 403
**aborts the whole load** → `submittedApps` never populates and `sipClosed`/`tirClosed` flips true →
`AppSip.jsx:719` (`App.jsx:767`) short-circuits to the terminal `SipClosedScreen`/`TirClosedScreen`
instead of the returning dashboard. The applicant can never reach their submission to edit.

The edit-after-submit **save** endpoints (`PATCH /sip-applications/{id}`, `PATCH /applications/{id}`)
and the submitted-list endpoints are **not** close-gated — they are window-gated + status-gated. So
once the view loads, editing + DB persistence work normally.

## Fix

### A. Frontend — restore the submitted/edit flow when intake is closed (both tracks)

The intake-close flag should mean "can't start a *new* application," not "can't view/edit an
existing one." Two changes per track:

1. **`hooks/useSipApplication.jsx` + `hooks/useApplication.jsx`** — decouple the two fetches so the
   submitted list **always loads**, even when the draft fetch 403s. Fetch submitted apps
   independently; in the load, set `submittedApps` regardless of the draft-fetch outcome. On a
   `*_submissions_closed` 403 set `sipClosed`/`tirClosed` (still meaningful: blocks starting new),
   but keep `submittedApps` populated and `row = null`.
2. **`AppSip.jsx:719` + `App.jsx:767`** — only render the terminal `SipClosedScreen`/`TirClosedScreen`
   when the user has **no submitted apps** (`closed && (submittedApps?.length ?? 0) === 0`).
   Otherwise fall through to the returning dashboard so the applicant can open and edit their
   submission. (A brand-new applicant with nothing submitted still correctly gets the closed screen.)

### B. Backend — extend the TIR edit window to match VIP

`config.py:124` `edit_deadline_tir` is `2026-06-25T23:59:59+05:30` (already past). Change it to match
VIP: **`2026-07-05T23:59:59+05:30`** (= `edit_deadline_sip`). No `.env.prod` override exists, so the
config default applies after a backend deploy. This re-opens the TIR edit window through 5 Jul.

### C. DB persistence (already works — verify, no change)

Both edit endpoints stamp `edited_after_submit=True` + `last_edited_at` and persist the patched
fields via `_update_application` / `services/submitted_edit.mark_edited`, then re-queue AI screening.
The applicant's edits show in `SubmissionView` (optimistic update + reload) and land in the DB. This
is restored automatically once the FE blank-screen fix lets the edit view render. We verify it; no
code change.

## Scope / non-goals
- No change to the intake-close gate on the draft/submit/completion endpoints (still blocks new apps).
- No change to the edit endpoints' window/status guards (beyond the TIR deadline value).
- No DB migration.

## Testing
- **Frontend (vitest):** `useSipApplication`/`useApplication` — when `GET /me` rejects with a
  `*_submissions_closed` 403, `submittedApps` is still populated from the independent submitted fetch
  and the closed flag is set; `AppSip`/`App` — `closed && submittedApps.length > 0` renders the
  dashboard (not the closed screen), `closed && submittedApps.length === 0` renders the closed screen.
- **Backend (pytest):** `services/edit_window.is_edit_open("tir")` is True for a "now" before
  2026-07-05 with the new config; edit endpoints persist `edited_after_submit`/`last_edited_at`
  (existing `test_submitted_edit` coverage — extend/assert if needed).

## Deploy (held for go-ahead)
- **Backend SAM deploy** required (for the `edit_deadline_tir` change) — done by me from the release
  worktree (grep `.env.prod` for `*_SUBMISSIONS_CLOSED=true` first; they stay closed — only the edit
  *window* changes).
- **Frontend Vercel promote** (for the blank-screen fix) — done by the user.
- No migration.

## Acceptance criteria
1. A submitted SIP applicant (no draft, intake closed) lands on the returning dashboard and can open
   + edit their submission — no blank/closed screen.
2. Same for TIR; additionally the TIR edit window is open through 5 Jul.
3. Edits made by the applicant appear in the submission view and are persisted to the DB
   (`edited_after_submit=true`, `last_edited_at` set, fields updated).
4. A brand-new applicant with nothing submitted still sees the closed screen (new applications remain
   blocked).
