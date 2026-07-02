# Admin pipeline "Unassign" (batch) fix — design spec

**Date:** 2026-07-02
**Branch:** `fix/admin-unassign` (off `origin/release/sip-launch-v1` @ `d66da91`)
**Surface:** Admin platform portal — pipeline Batch column

## Problem

In the admin pipeline (`/admin`), selecting **"Unassigned"** in the Batch column does nothing:

- **Per-row dropdown** — `changeIndividualBatch(startup, 'Unassigned')` (`frontend/src/pages/admin/platform/screens/AdminPipeline.jsx:453-455`) takes the else-branch, runs `batches.find(b => b.name === 'Unassigned')` which returns `undefined` (there is no real batch named "Unassigned"; it's a synthetic dropdown option), hits `if (!found) return;`, and **silently no-ops**.
- **Bulk "Assign batch…" dropdown** — `applyBatchToSelected('Unassigned')` (`AdminPipeline.jsx:411-421`) fails the same lookup, so `targetBatchId` is null and it shows the toast **"Batch not found: Unassigned"** and returns.

Root cause: there is **no code path to remove an application from its batch**. The backend only exposes assign/move (`POST /batches/{id}/applications`) and delete-whole-batch (`DELETE /batches/{id}`). "Unassigned" is an option with no behavior behind it.

> Note: this is a **batch**-membership bug, not a **reviewer**-assignment bug. The `409 review_already_submitted` guard (which lives in the reviewer-unassign paths) is not involved.

## Data model

`application_batches` is a join table with a unique constraint on `(application_id, application_track)` (`backend/app/services/admin_query.py:156`), so each app is in **at most one** batch. Assigning to a batch is an upsert that moves the app (`admin_platform.py:361`). Unassigning = delete the app's `application_batches` row.

## Semantics decision: unlink batch only

Deleting an app's `application_batches` row **only**. Reviewer assignments and reviews are left untouched. No status change.

Rationale — this matches the codebase's existing, deliberate decoupling of batch membership from reviewer work:
- `delete_batch` unlinks apps + clears `reviewer_profiles.batch_id` but leaves `reviewer_assignments`/`reviews` intact — "no scored work is orphaned" (`admin_platform.py:303-308`).
- Moving an app between batches "does NOT strip the previous batch's assignments" (`admin_platform.py:345-350`).

(Alternative — also cascade-remove the app's reviewer assignments, skipping submitted reviews — was considered and rejected as inconsistent with the above. Revisit only if the product owner wants "Unassigned" to mean "pull the app out of review entirely.")

## Changes

### Backend — `backend/app/routers/admin_platform.py`
New route `POST /batches/unassign`, dependency `require_capability("manage_batches")`.

- Body: reuse/extend the assign body shape — `{ items: [{ track, application_id }] }`.
- For each item: `sb.table("application_batches").delete().eq("application_id", aid).eq("application_track", track).execute()`.
- Return `{ "removed": <count> }`.
- `write_audit(action_type="batch_applications_unassigned", target_table="application_batches", ...)`.
- Idempotent: unassigning an app that is already unassigned is a no-op (`removed` counts actual deletions).

**Implementation caution:** the in-repo test fake no-ops `.eq()` on non-PK selects/deletes (the codebase re-filters in Python for bulk reads — see `admin_platform.py:376-377`). The delete call and its test must follow the existing `delete_batch` idiom so the fake doesn't over-delete. Verify in the test that only the targeted rows are removed and unrelated batch links survive.

### Frontend — `frontend/src/lib/adminPlatformApi.js`
Add: `unassignBatch: (items) => api.post('/admin/platform/batches/unassign', { items })`.

### Frontend — `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`
- `changeIndividualBatch` (per-row): before the `batches.find` else-branch, add
  `if (val === 'Unassigned') { await adminPlatformApi.unassignBatch([{ track: startup.track, application_id: startup.id }]); await reload(); setNote({kind:'ok', text:'Removed from batch.'}); return; }`
- `applyBatchToSelected` (bulk): before the find/`targetBatchId` logic, add an `if (batchNameOrNew === 'Unassigned')` branch that calls `unassignBatch(selectedRows.map(r => ({track:r.track, application_id:r.id})))`, then `finishBulk({kind:'ok', text:'Removed N from their batch.'})`.

### Migration
None — no schema change.

## Testing

- **Backend:** new test — assign apps to a batch, unassign a subset, assert the `application_batches` rows for the targeted apps are gone, the others remain, `reviewer_assignments` are untouched, response `removed` count is correct, and a second unassign of the same app returns `removed: 0`.
- **Frontend:** if an `AdminPipeline` vitest exists, add a case asserting selecting "Unassigned" (per-row and bulk) calls `unassignBatch` with the right items; otherwise skip (no new harness).

## Isolation / parallel-session rules

- All work in `.claude/worktrees/fix-admin-unassign` (branch `fix/admin-unassign`).
- Files touched: `admin_platform.py`, `adminPlatformApi.js`, `AdminPipeline.jsx`, backend test file. **No** edits to `email_service.py`, `router.jsx`, `main.py`, or any profile-completion file.
- No push / SAM / Vercel deploy without explicit go; `git fetch` + reconcile onto the latest `release/sip-launch-v1` tip before any push.
- Commits authored solely by the user (no AI trailer).

## Out of scope

- Reviewer-unassign paths (Manage Applications drawer, `bulk_remove_reviewer_apps`, leadership `DELETE /reviewers/{uid}`) — not the reported bug.
- Any status-machine or email behavior.
