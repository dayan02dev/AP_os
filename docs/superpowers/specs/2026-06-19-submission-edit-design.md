# Post-login UI recreation + edit-after-submit — Design

**Date:** 2026-06-19
**Branch:** `new_submission_edit` (cut from `origin/release/sip-launch-v1` @ `a2c0d82`)
**Status:** Approved design — pending implementation plan

## Goal

Two coupled deliverables, shipped together on one testing branch and validated on staging before prod:

1. **Recreate the post-login applicant UI** from the `Reiteration_HomePageandSubmit_TIRandVIPModules` branch — the sidebar dashboard, Past applications, and the "Your submission" view — for both TIR and VIP tracks.
2. **New capability: edit-after-submit.** Within a track-specific window, a candidate can see every answer in their submitted application and correct individual fields inline. Today a submitted application is hard-locked.

## Context: today's behavior (the constraint being changed)

- `PATCH /applications/me` and `/sip-applications/me` only mutate the caller's **draft** (one-draft-per-user partial unique index). Submitted rows are invisible to the wizard and read-only.
- Submit (`POST /…/me/submit`) strict-validates, flips `status` → `submitted`, and calls `sqs_publisher.publish(id, track)` to queue AI screening; the worker upserts `ai_screening` and advances status to `under_review`.
- The Reiteration "Your submission" view is explicitly read-only ("Locked for review").

## Branch & base strategy

- The Reiteration branch is **frontend-only and stale** (4 commits off the old `e2c1724` ancestor). It must **not** be the base — it lacks all of prod's later backend work (migration 025 SIP profile-links, admin/reviewer fixes, landing content).
- `new_submission_edit` is cut from **current prod** (`origin/release/sip-launch-v1`).
- Port the Reiteration applicant-facing UI by cherry-picking `7271f82` (dashboard), `650ec2e` (submission redesign), `a17eec2` (ref-ids). **Skip** `db0b4f2` (leadership label rename) — not needed here and it overlaps prod's reviewer/leadership work.
- Deploy to the **staging** Lambda stack + a Vercel preview for testing; merge to prod only after sign-off.

## Backend design (the new functionality)

### Endpoints
- New owner-scoped, by-id edit endpoints: `PATCH /applications/{id}` and `PATCH /sip-applications/{id}`. These edit a **submitted** row identified by id. The existing `PATCH /…/me` (draft-only) is unchanged.
- Request body is a partial patch of one or more answer fields (same field shape the wizard PATCH uses), so the frontend can save a single field at a time.

### Guard (all must hold, else `403 edit_window_closed` / `404` / `403 not_owner`)
- Caller owns the row.
- `status ∈ {submitted, under_review}`.
- `now < edit deadline for the row's track`.

### Edit-window config
- Deadlines are **configuration**, not hardcoded: settings/env `EDIT_DEADLINE_TIR=2026-06-25` and `EDIT_DEADLINE_SIP=2026-07-05` (ISO; interpreted in IST). Changeable without a redeploy.

### Validation
- Each edited field is validated with the **existing submit validators** for that field, so an edit can't make the application invalid. Invalid edit → `422` with the same field-error shape the submit flow uses.

### Re-screen + reviewer flag
- On a successful save: stamp `edited_after_submit = true` and `last_edited_at = now()`, then re-queue the application via `sqs_publisher.publish(id, track)`. The worker already upserts `ai_screening` idempotently, so the score is recomputed against the corrected content.
- Re-queue is **debounced server-side** (e.g. skip if a re-queue happened in the last N minutes) so rapid single-field saves don't flood the worker.

### Migration 026
- Add to `tir_applications` and `sip_applications`: `edited_after_submit boolean not null default false`, `last_edited_at timestamptz null`.

### Read model
- `ApplicationRead` / SIP equivalent gain computed `editable: bool` and `edit_deadline: timestamptz`, so the UI knows whether to render edit affordances. `edited_after_submit` / `last_edited_at` are also exposed.

## Frontend design

### UI port (both TIR + VIP)
- Sidebar **dashboard** shell ("Welcome back", current-application card, 6-stage progress tracker), **Past applications** list, and the **"Your submission"** section view.
- Sidebar links Programs / TIR overview / VIP overview → existing landing pages (no build).

### Inline edit on "Your submission"
- When `editable` is true, each answer row shows an inline **Edit** control. Activating it swaps in the matching wizard input component for that question's type (text, single-select, multi-select, file, etc.), with **Save / Cancel**.
- Save → calls the new by-id `PATCH`, shows an optimistic saved state, and reflects the "edited" stamp. Validation errors render inline on the field.
- When past the deadline (`editable` false), the view stays the current read-only "Locked for review."
- Header shows the window state: e.g. "Editable until 25 Jun" → flips to "Locked for review" after the deadline.

## Lifecycle / data flow

```
Applicant opens /apply (or /apply-sip) after submitting
  → dashboard shows current application + stage tracker (GET submitted)
  → "View full application" → "Your submission" (per-section answers)
      if editable: per-field Edit → PATCH /{track}/{id}
        → validate field → save → stamp edited_after_submit + last_edited_at
        → debounced sqs_publisher.publish(id, track) → worker re-scores ai_screening
      if not editable: read-only "Locked for review"
```

## Decisions / edge cases

- **Editable fields:** all answer fields, including file re-uploads (pitch deck, resume, evidence).
- **Eligibility-gate edits** (e.g. SIP "incorporated?" → "Not yet", or TRL): re-validated like the wizard, but the candidate is **not** auto-disqualified — surfaced to reviewers via the edited flag instead.
- **Reviewer concurrency:** if a reviewer is mid-review when an edit lands, the `edited_after_submit` flag + re-score is the signal; no hard locking of reviewer work.
- **Status unchanged by edits:** editing keeps the row `submitted`/`under_review` (it does not return to draft).

## Testing plan (staging, before prod)

Using the staging test applicant:
1. Edit a field within the window → saved to the correct track table; `edited_after_submit`/`last_edited_at` set; app re-queued and re-scored.
2. Edit an invalid value → `422`, field error shown, no save.
3. Simulate past-deadline (config) → field locks, `editable=false`, "Locked for review."
4. Both TIR and VIP paths.
5. Reviewer / leadership / admin app-detail still load and show the "edited after submit" flag.

## Out of scope

- Building the Programs / TIR overview / VIP overview pages (they link to existing landing pages).
- Reviewer/leadership/admin UI work beyond surfacing the `edited_after_submit` flag on the application detail.
- The leadership AI-label rename from the Reiteration branch (`db0b4f2`).
