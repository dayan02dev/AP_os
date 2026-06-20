# Edit-after-submit: file re-uploads + SIP verification + prod cutover — Design

**Date:** 2026-06-20
**Branch:** `new_submission_edit` (continues the post-login + edit-after-submit work)
**Status:** Approved design — pending implementation plan

## Context

The edit-after-submit feature (post-login dashboard + inline per-field editing of **text/choice** answers) is already built and deployed to staging for **both** TIR and VIP:
- Backend `PATCH /applications/{id}` and `PATCH /sip-applications/{id}` (owner/status/window guards, `edited_after_submit`/`last_edited_at` stamping, AI re-screen) — live on staging.
- Frontend inline edit on the "Your submission" view for both tracks.
- File-upload fields and legal declarations are currently **read-only** (suppressed via `NON_EDITABLE_KINDS` in `frontend/src/screens.jsx`) because the file-upload routers reject submitted applications.

This spec adds the remaining piece the user wants before production rollout: **file re-uploads on submitted applications**, for both tracks, persisted to the database — plus live VIP verification and the prod cutover.

## Goal

1. Let applicants replace/add/remove their **application file fields** on a submitted application during the edit window, for both TIR and VIP, with changes persisted to storage + the application row.
2. Live-verify the (already-built) VIP text/choice edit with a SIP test account.
3. Roll the whole feature out to production.

## The file fields in scope (6 across 2 tracks)

| Track | Question kind | Input component | Router |
|------|---------------|-----------------|--------|
| TIR | `files` | EvidenceFilesInput (multi) | `evidence_files.py` |
| TIR | `milestoneFiles` | MilestoneFilesInput (multi) | `milestone_files.py` |
| VIP | `milestoneFiles` | SipMilestoneFilesInput (multi) | `sip_milestone_files.py` |
| VIP | `sipPitchDeck` | SingleEvidenceInput (replace) | `sip_evidence_files.py` (`kind=pitch-deck`) |
| VIP | `sipCapTableFile` | SingleEvidenceInput (replace) | `sip_evidence_files.py` (`kind=cap-table`) |
| VIP | `sipPatents`, `sipTractionFiles` | MultiEvidenceInput (multi) | `sip_evidence_files.py` (`kind=patents`/`traction`) |

**Not in scope:** resume re-upload (profile-level file, separate from application fields); declarations (legal — stay locked); any edit after a reviewer decision (the status guard already blocks anything outside {submitted, under_review}).

## Backend — window-guarded file operations

The four file routers (`evidence_files`, `milestone_files`, `sip_evidence_files`, `sip_milestone_files`) today fetch the caller's **draft** app via `_fetch_draft_application(user_id)` and reject `status != 'draft'` with `409 application_locked`.

**Change:** each router's upload + delete endpoints accept an optional **`application_id`** (the submitted app being edited):
- **When `application_id` is provided:** fetch that row by id and apply the **edit-window guard** identical to the text-edit endpoint —
  - owner mismatch / not found → `404`,
  - status not in {submitted, under_review} → `409 not_editable`,
  - `not is_edit_open(track)` → `403 edit_window_closed`.
  On success, perform the existing storage upload/delete + file-column update, then stamp `edited_after_submit = true` + `last_edited_at = now()` and re-queue AI screening via `sqs_publisher.publish(application_id, track)` (same as text edits — keeps reviewer visibility and score consistency).
- **When `application_id` is absent:** unchanged draft behavior.

Reuse `app.services.edit_window.is_edit_open` / `edit_deadline_for` and the same `_EDITABLE_STATUSES` set already used by the text-edit endpoints. The storage logic (bucket upload, signed paths, JSONB column update) is reused verbatim — only the app-selection + guard changes.

**No new migration:** the file columns (`evidence_files`, `milestone_files`, `sip_pitch_deck`, `sip_cap_table_file`, `sip_patents_files`, `sip_traction_files`) and the `edited_after_submit` / `last_edited_at` columns (migration 026) already exist.

*(Approach chosen over separate new endpoints per file kind: threading `application_id` into the existing routers reuses all storage code and keeps a single guard definition — smaller surface, no duplication.)*

## Frontend — unlock file fields

- In `frontend/src/screens.jsx`, remove the file kinds from `NON_EDITABLE_KINDS` so file fields render an Edit affordance again. **`declarations` stays in the set** (legal affirmations remain locked).
- The file input components (EvidenceFilesInput, MilestoneFilesInput, SingleEvidenceInput, MultiEvidenceInput, and SIP equivalents) upload to the API internally. Thread the submitted **`applicationId`** into them (a prop) so, when editing a submitted app, they call the new by-id path (`?application_id=<id>` or equivalent) instead of the draft endpoint. Single-file fields replace; multi-file fields add/remove — existing behavior, re-pointed.
- After a successful file change, the submission view reflects the update (optimistic local commit, same pattern as text fields).

## Data flow

```
Applicant on "Your submission" (submitted app, in window)
  → clicks Edit on a file field
  → file input uploads to the file router WITH application_id
     → guard: owner + status∈{submitted,under_review} + is_edit_open(track)
     → storage upload/delete + file-column update on the submitted row
     → stamp edited_after_submit + last_edited_at; re-queue AI screening
  → UI reflects the new file
```

## Verification (staging, both tracks)

1. Create a **VIP test applicant** with a submitted SIP application + password (mirroring the TIR `claude-test-applicant`). Verify text/choice edit persists to `sip_applications`.
2. **File re-upload end-to-end:** on staging, replace a VIP pitch deck and add/remove a TIR evidence file; confirm the object lands in storage, the app's file column updates, and `edited_after_submit` flips true. Confirm a past-deadline app rejects file edits (403).
3. Regression: existing draft file uploads still work (no `application_id` path unchanged).

## Production cutover

1. Apply **migration 026** to the prod Supabase (`xtmszlpwgbyoumalgbhs`) — idempotent.
2. Deploy the `new_submission_edit` backend to the **prod** Lambda stack (`artpark-eir-api-production`), from the worktree, with the changeset previewed for zero resource deletions.
3. Promote the frontend to production (Vercel).
4. Set prod edit-window deadlines: TIR `2026-06-25`, VIP `2026-07-05` (same as staging; config-driven).
5. Smoke-test on prod: a submitted applicant sees Edit affordances, a text edit + a file re-upload both persist, declarations + post-deadline stay locked.
6. PR #10 remains the merge artifact (`new_submission_edit` → `release/sip-launch-v1`).

## Out of scope

- Resume re-upload on submitted apps.
- Re-screen dedup hardening (pass a unique `MessageDeduplicationId`) — noted as a known caveat; the worker upserts idempotently so it's not blocking.
- Editing after a reviewer decision (blocked by the status guard by design).
