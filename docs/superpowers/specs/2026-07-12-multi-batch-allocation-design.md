# Multi-batch allocation — design spec

**Date:** 2026-07-12
**Branch:** `feat/multi-batch-allocation` (off `origin/release/sip-launch-v1` @ 5d9a032)
**Status:** approved approach (A); migration 034 ALREADY APPLIED to prod (see Deploy note)

## Problem

Today an application belongs to **exactly one** batch (`application_batches` has
`unique(application_id, application_track)`), and a reviewer's batch membership is
only a single "home batch" hint (`reviewer_profiles.batch_id`) plus fragile
inference from existing assignments. The user needs:

- The **same application** allocatable to **many batches** (A and B and C…), each
  batch carrying its own (same or different) set of reviewers.
- A reviewer allocatable to **many batches** — a single-domain specialist sits in
  one batch; a generalist covering 2–3 domains sits in 2–3 batches.
- Net effect: an app is reviewed by the **union** of reviewers across all batches
  it belongs to.

## Approach (A — approved)

Introduce `batch_reviewers(batch_id, reviewer_user_id)` as the single source of
truth for reviewer↔batch membership (many-to-many). Relax `application_batches` to
many-to-many. `reviewer_assignments(application_id, application_track,
reviewer_user_id)` is **unchanged in shape** and remains the reviewer-queue truth;
it becomes a *derived* set = (union of `batch_reviewers` over the app's batches) ∪
(manual per-app assignments from the Manage-Applications drawer / leadership).

### Why not the alternatives
- A `batch_id` column on `reviewer_assignments` can't record two origins for one
  reviewer shared across two of an app's batches (unique key is `(app,track,rev)`),
  which is exactly the shared-reviewer case here. Rejected.

## Data model (Section 1 — migration 034, applied)

```sql
create table public.batch_reviewers (
  batch_id         uuid not null references public.batches(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  added_by         uuid,
  added_at         timestamptz not null default now(),
  primary key (batch_id, reviewer_user_id)
);
-- application_batches: drop unique(application_id, application_track),
--   add unique(application_id, application_track, batch_id)
-- backfill batch_reviewers from reviewer_profiles.batch_id (non-destructive)
```
RLS enabled, no policies → service-role only (matches every other table; backend
uses `get_admin_client()`). `reviewer_profiles.batch_id` kept as an optional
"primary/home" hint; `batch_reviewers` is authoritative for membership + fan-out.

**DEPLOY-ORDER (critical):** dropping `unique(application_id, application_track)`
breaks the *current* `assign_applications` upsert (`admin_platform.py:373`,
`ON CONFLICT (application_id, application_track)`). Migration 034 was applied to
prod on 2026-07-12 ahead of code → **`POST /batches/{id}/applications` is 500ing in
prod until the backend below is deployed.** No data corruption possible in the
window (the only writer to `application_batches` is that broken upsert). Backend
deploy closes the window. Frontend can follow.

## Section 2 — Backend flows (the reconcile engine)

New module `backend/app/services/batch_membership.py` owns membership + reconcile.
Reuses `admin_query.iter_assignment_rows` (paged, 1000-row-cap-safe) and
`state_machine.advance_to_under_review_on_assignment`.

### Primitives
- `batch_reviewer_ids(sb, batch_id) -> set[str]` — from `batch_reviewers`.
- `app_batch_ids(sb, app_id, track) -> set[str]` — from `application_batches`.
- `reviewers_via_batches(sb, app_id, track, batch_ids) -> set[str]` — union of
  `batch_reviewer_ids` over `batch_ids`.
- `has_submitted_review(sb, app_id, track, reviewer_id) -> bool` — `reviews` with
  `submitted_at is not null`.

### Operations
1. **add_apps_to_batch(sb, batch_id, items, actor)** — replaces the inference-based
   fan-out in `assign_applications`.
   - upsert `application_batches` on the NEW 3-col key (append, not move).
   - `reviewers = batch_reviewer_ids(batch_id)`.
   - for each newly-added app: idempotent-upsert `reviewer_assignments` for those
     reviewers (dedup via `iter_assignment_rows`, `on_conflict=... ignore`).
   - `advance_to_under_review_on_assignment` per app.
   - `notify_reviewers_assigned` on newly-created rows; audit.
   - returns `{assigned, assignments_created, reviewers_notified}`.

2. **remove_app_from_batch(sb, batch_id, app_id, track, actor)** — smart remove.
   - delete `application_batches (app, track, batch)`.
   - `remaining = reviewers_via_batches(app_batch_ids(app,track))` (post-delete).
   - `candidates = batch_reviewer_ids(batch_id)`.
   - for `r in candidates - remaining`: if `has_submitted_review` → skip
     (skipped_submitted++); else delete `reviewer_assignments (app,track,r)`.
   - audit. returns `{removed, assignments_removed, skipped_submitted}`.

3. **assign_reviewers_to_batch(sb, batch_id, reviewer_ids, actor)** — rewrite of the
   existing `admin_query.assign_reviewers_to_batch`.
   - upsert `batch_reviewers (batch, reviewer)` rows (membership).
   - `apps = apps in batch` (`application_batches` where batch_id).
   - for each app × new reviewer: idempotent-upsert `reviewer_assignments`.
   - advance status; return `created_rows` for the caller to email/audit.

4. **remove_reviewer_from_batch(sb, batch_id, reviewer_id, actor)** — rewrite of
   `DELETE /batches/{id}/reviewers/{uid}`.
   - delete `batch_reviewers (batch, reviewer)`.
   - for each app in batch: `others = app_batch_ids(app) - {batch}`; if reviewer in
     `reviewers_via_batches(others)` → keep; elif `has_submitted_review` → keep
     (skipped_submitted++); else delete `reviewer_assignments (app,track,rev)`.
   - returns `{removed, skipped_submitted}`.

5. **_fetch_batches (admin_query)** — return a **list** of batches per (app,track),
   not one. Pipeline row gains `batches: [{id,name}]` (keep scalar `batch` =
   first/joined for back-compat).

6. **Gate-1 reject** — `detach_application_from_review(remove_batch_link=True)`
   already deletes ALL `reviewer_assignments` + ALL `application_batches` rows for
   `(app,track)` (no batch filter), so it handles a multi-batch app unchanged. It
   does NOT touch `batch_reviewers` (batch membership is not app-specific). Verify
   only — no code change expected.

## Section 3 — Admin UI

- **Pipeline BATCH column** (`AdminPipeline.jsx`): render one **chip per batch** the
  app is in (from `s.batches`), each chip with `×` → `removeAppFromBatch(batchId)`
  (smart remove); plus a `+ ▾` control to **add** the app to another batch
  (`assignBatch`, now append). Bulk "Assign batch" action **appends** to selection.
  Read-only (Rejected tab): chips as plain text, no ×/+.
- **adminDataAdapter.adaptPipelineRow**: `batches = row.batches ?? (row.batch ?
  [{name: row.batch}] : [])`.
- **adminPlatformApi**: `assignBatch` → POST `/batches/{id}/applications` (append);
  new `removeAppFromBatch(batchId, item)` → POST `/batches/{id}/applications/remove`;
  keep `unassignBatch` (detach-from-all) for the rare full clear.
- **Roster** (`AdminReviewers.jsx` + `admin_query.fetch_roster`): a reviewer's batch
  memberships now come from `batch_reviewers` (explicit), shown as chips; the
  assign/remove-reviewer-to-batch controls write `batch_reviewers` via
  `assignBatchReviewers` / `unassignBatchReviewer` (backend ops 3 & 4). Keep the
  computed "Unbatched" bucket for apps assigned with no batch.

## Section 4 — Edge cases & tests

### Edge cases
- App in **0 batches** (all removed): allowed; batch-derived reviewers gone, manual
  assignments persist.
- Reviewer both a batch member AND manually pinned: a batch removal may drop the
  manual assignment if no other batch covers it — **documented limitation**;
  submitted reviews are never auto-removed.
- Duplicate add (app already in batch): idempotent (3-col unique).
- Backfill + all upserts idempotent / re-runnable.

### Tests (`tests/`, using the mutating WHERE-aware `tests/fixtures/fake_supabase.py`)
Unit (`test_batch_membership.py`):
- add: app in 2 batches → reviewers from each assigned (union); status→under_review.
- smart remove: reviewer shared with another still-attached batch → KEPT; reviewer
  unique to removed batch → REMOVED; reviewer with submitted review → KEPT
  (skipped_submitted).
- assign_reviewers_to_batch writes `batch_reviewers` + fans out to all apps in batch.
- remove_reviewer_from_batch: membership removed; per-app assignment removed unless
  covered by another batch or submitted.
- Gate-1 reject clears all `application_batches` rows for a multi-batch app.
Endpoint (`test_admin_platform_batches.py` additions): append vs move, remove-one,
reviewer add/remove, read-side `batches` list.
Regression: existing batch/roster/status-lifecycle suites stay green.

### Eval / verify (prod schema is already live)
1. `pytest` new + regression suites (single-file runs use `--no-cov`).
2. Deploy backend to prod (SAM, from this worktree) → closes the 500 window.
3. Smoke on prod: create Batch A + Batch B; add the SAME app to both; assign
   reviewer R1 to A and R2 to B → R1 and R2 both see the app; remove app from B →
   R2 loses it, R1 keeps it; a reviewer shared by A+B kept when removed from B.
4. Frontend: promote after backend verified.

## Out of scope (YAGNI)
- Auto-assign-by-domain-overlap (a different feature; not requested).
- SIP-specific batch behavior beyond track-tagging already present.
- Migrating `reviewer_profiles.batch_id` away (kept as a hint).
