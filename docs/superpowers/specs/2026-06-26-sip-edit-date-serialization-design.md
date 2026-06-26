# SIP edit-save date serialization fix — Design Spec

**Date:** 2026-06-26
**Branch:** `fix/sip-edit-date-serialization` (worktree off `origin/release/sip-launch-v1` @ `e894dcf`)
**Severity:** production — SIP applicants cannot save the DPIIT "Yes" answer (recognition date) in either the wizard or edit-after-submit.
**Target:** production, backend-only. **No DB migration. No frontend change.**

## Problem
`kumarimc@gmail.com` (VIP) gets "SAVE FAILED / Couldn't save — check the value" when saving the DPIIT
section. Prod CloudWatch shows the real error on `PATCH /sip-applications/{id}`:

```
sip_applications.edit update failed
TypeError: Object of type date is not JSON serializable   (status 500)
  _update_application → postgrest .execute() → httpx encode_json
```

## Root cause (confirmed in logs + reproduced)
The patch is built with `patch_model.model_dump(exclude_unset=True)`. The field
`basic_dpiit_recognition_date: date` dumps to a native `datetime.date` object. When the patch is sent
to Supabase, httpx `json.dumps` fails on the `date` → **500**. The frontend's bare `catch` shows the
generic "Couldn't save — check the value."

This is why **0 SIP applicants have ever stored `'Yes — we're DPIIT recognised'`** while 66 stored
`'No — not yet'`: "Yes" is the only path that submits a date, so it has always 500'd — in BOTH the
wizard **draft autosave** (`PATCH /sip-applications/me`) and the **edit-after-submit** path
(`PATCH /sip-applications/{id}`). "No" sends no date and saves fine.

Reproduced:
- `model_dump(exclude_unset=True)` → `{'basic_dpiit_recognition_date': datetime.date(2026,5,16)}` → `json.dumps` raises.
- `model_dump(mode="json", exclude_unset=True)` → `{'basic_dpiit_recognition_date': '2026-05-16'}` → serializes fine.

## Fix (backend-only)
Serialize the patch to JSON-safe types before the DB write: change `model_dump(exclude_unset=True)`
→ **`model_dump(mode="json", exclude_unset=True)`** at all four application save points:
- `backend/app/routers/sip_applications.py:376` (SIP draft `PATCH /me`) — the bug.
- `backend/app/routers/sip_applications.py:447` (SIP edit-after-submit) — the bug.
- `backend/app/routers/applications.py:562` (TIR draft `PATCH /me`) — consistency/future-proof (TIR has no `date` field today; harmless no-op).
- `backend/app/routers/applications.py:651` (TIR edit-after-submit) — consistency/future-proof.

`mode="json"` converts `date`/`datetime`/enums to JSON-safe values and is a no-op for str/int/bool/
list/dict, so it is strictly safer for a DB write and changes nothing for existing fields. This is the
general fix — covers every applicant, both wizard and edit. ("Ensure this doesn't happen with anyone.")

## DB persistence
After the fix, the DPIIT recognition date is written as an ISO string to the `date` column; the
applicant's edits persist (`edited_after_submit=true`, `last_edited_at` stamped, screening re-queued).
No backfill needed — `kumarimc` (and anyone) re-enters and saves successfully.

## Testing
- **Backend (pytest, SIP edit fixture):** new regression test — `PATCH /sip-applications/{id}` with
  `basic_dpiit_registered="Yes — we're DPIIT recognised"`, a number, and `basic_dpiit_recognition_date`
  returns 200 **and** the patch persisted to the DB has the date as a `str` (and the row is
  `json.dumps`-able). Fails before the fix (date object), passes after.
- Existing `test_sip_applications_edit.py` / `test_applications_edit.py` confirm no regression.

## Deploy (approved)
Backend-only → SAM deploy to prod from the release worktree (grep `.env.prod` for
`TIR_/SIP_SUBMISSIONS_CLOSED=true` first — intake stays closed). No Vercel promote needed (no frontend
change). No migration.

## Acceptance criteria
1. A SIP applicant can save DPIIT = "Yes" with a recognition number + date (wizard draft and
   edit-after-submit) — no 500, no "Couldn't save."
2. The value persists to the DB (date stored as ISO; `edited_after_submit`/`last_edited_at` set).
3. No regression to other SIP/TIR edit or draft saves.
