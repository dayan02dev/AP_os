# Design — Assignment-driven status workflow (TIR + VIP)

Date: 2026-07-06
Branch base: `release/sip-launch-v1` (prod)
Status: approved design, pending implementation plan

## The new workflow (strict, both tracks)

```
submit ─────────────▶ submitted
assign reviewer ────▶ submitted → under_review        (NEW trigger)
any single review ──▶ under_review → evaluated        (NEW: first review, not all)
admin approve ──────▶ under_review | evaluated | submitted → jury_review
admin reject ───────▶ under_review | evaluated | submitted → rejected
```

Identical for TIR and VIP — the logic is track-agnostic; only the table
(`tir_applications` / `sip_applications`) differs.

## What changes vs. what is live today

| Trigger | Today | New |
|---|---|---|
| AI screening completes | `submitted → under_review` (auto) | **no status change** — stays `submitted`; scores still written |
| Admin assigns a reviewer | no status change | **`submitted → under_review`** (guarded, idempotent) |
| Reviewer submits a review | flips to `evaluated` only when **all** active reviewers done | **flips to `evaluated` on the FIRST** submitted review |
| Admin approve / reject | legal from submitted/under_review/evaluated/shortlisted | unchanged (kept, incl. from `submitted`) |

## Decisions (confirmed with the user)

1. **AI screening no longer advances status.** Scores/sections still computed and
   persisted; the app remains `submitted` until a reviewer is assigned.
2. **Production backfill: YES**, with a reversible backup, re-mapping all live apps
   to the new logic (see §Backfill).
3. **Approve/reject remain legal from `submitted`** (safety valve for spam/obvious
   rejects before assignment). The new rules are a superset, not a restriction.
4. **Testing = hermetic pytest (rewritten to the new rules) + a live end-to-end
   smoke on STAGING**, driving `udayanpawar03@gmail.com` as BOTH admin (assign +
   decide) and reviewer (score). Account provisioning on staging is an
   implementation detail (create/grant admin+reviewer on the staging Supabase).

## Component design

**A. State machine (`backend/app/services/state_machine.py`)**
- `LEGAL_TRANSITIONS["submitted"]` gains `under_review` (so assignment can move it
  through the guarded writer `apply_status_change`). Keep `jury_review`, `rejected`,
  `withdrawn` there too (decision #3).
- Keep `under_review → {evaluated, jury_review, rejected, withdrawn}` and
  `evaluated → {jury_review, rejected, ...}` as today.
- Rename `auto_transition_to_evaluated_if_complete` →
  `auto_transition_to_evaluated_on_first_review` and change its rule: fire
  `under_review → evaluated` when **≥1 submitted review exists** for the app
  (equivalently, the first completed assignment), instead of requiring all active
  assignments complete. Idempotent; only fires when current status is
  `under_review`.
- New helper `advance_to_under_review_on_assignment(application_id, track)`:
  guardedly moves `submitted → under_review` (only if current status is
  `submitted`; no-op otherwise), logging to `application_status_log`.

**B. AI worker (`backend/workers/ai_screener/handler.py`, `backend/app/services/ai_pipeline/pipeline.py`)**
- Worker calls `pipeline.persist(..., advance_status=False)` — AI no longer writes
  `under_review`. (Keep the `advance_status` param for compatibility; grep for any
  other `advance_status=True` caller and confirm the live worker is the only one
  advancing.)
- Change the worker's idempotency guard from "screen only `status == 'submitted'`"
  to **"screen only if no `ai_screening` row exists yet for this app+track."** This
  decouples AI from status, so an app that was assigned a reviewer (now
  `under_review`) BEFORE screening still gets scored, instead of being skipped by
  the old status guard.

**C. Assignment routes** — after inserting `reviewer_assignments`, call
`advance_to_under_review_on_assignment(...)` so `submitted → under_review`. Applied
to **all** assignment paths so behavior is identical everywhere:
- `backend/app/routers/leadership_actions.py::assign_reviewers` (per-app)
- `backend/app/routers/admin_platform.py::assign_applications` and
  `assign_batch_reviewers` (batch fan-out)
- The shared `backend/app/services/admin_query.py::assign_reviewers_to_batch` if it
  is the common insertion point — advance there once rather than in each caller if
  that avoids duplication.

**D. Review submit (`backend/app/routers/reviewer.py`)** — the two call sites
(`submit_review`, `patch_review`) now call the renamed
`auto_transition_to_evaluated_on_first_review(...)`. No behavior change needed at
the call site beyond the new name; the "first review" logic lives in the helper.

**E. Data backfill (`backend/scripts/backfill_status_workflow.py`)** — reversible,
idempotent, `--dry-run` and `--apply` modes, both tracks:
1. Snapshot every app's `(id, track, status)` to a timestamped backup
   (table `status_backfill_backup_<ts>` or a JSON file) BEFORE any write.
2. Re-map each non-terminal app:
   - status in `{draft, withdrawn, rejected, jury_review, on_hold, waitlisted,
     shortlisted, offered, onboarded, interview}` → **keep** (decided/terminal).
   - otherwise (`submitted`, `under_review`, `evaluated`, `ai_screening`,
     `screening_failed`):
     - has ≥1 submitted review → `evaluated`
     - else has ≥1 active (non-declined, non-reassigned) assignment → `under_review`
     - else → `submitted`
3. Write each change through `apply_status_change` (logged) or a direct update with
   an explicit `application_status_log` row; print a per-app before→after report and
   totals. Provide a restore path from the backup.

**F. Display / blast-radius check (no code change expected)** — status *values* are
unchanged (`submitted`/`under_review`/`evaluated`/`jury_review`/`rejected`), so
`CHIP_META`, applicant dashboard (`applicantProgress.js`), admin/leadership/reviewer
portals, and the stats funnel keep working. Expected visible effects: the funnel's
`submitted` bucket grows and `in_review` shrinks (apps now wait in `submitted` until
assigned). Verify these surfaces still render sensibly; no logic change planned.

## Testing

**Hermetic (rewrite `backend/tests/test_status_lifecycle_e2e.py` to the new contract):**
- AI screening leaves status `submitted` (was: → under_review).
- Assign reviewer → `under_review` (INVERTS the old A3 "no change").
- First/any single review → `evaluated`; second review is a no-op (INVERTS old B "all reviewers").
- 2 reviewers assigned, 1 submits → `evaluated` (proves "first review").
- Approve/reject from `under_review`, `evaluated`, and `submitted` → `jury_review`/`rejected`.
- AI worker screens an already-`under_review` (assigned-first) app because no
  `ai_screening` row exists (guard change).
- TIR ≡ VIP parity + correct-table isolation.
- New unit tests for the backfill mapping (`backfill_status_workflow`): each branch
  (decided kept / ≥1 review→evaluated / assignment→under_review / else→submitted),
  both tracks, and dry-run makes no writes.
- Reuse the existing `tests/fixtures/fake_supabase.py`.

**Live smoke on STAGING** (`backend/scripts/smoke_status_workflow.py` or a marked
test): using `udayanpawar03@gmail.com` provisioned as admin+reviewer on the staging
Supabase, drive a throwaway application end-to-end via the deployed staging API —
submit → (assign as admin) under_review → (score as reviewer) evaluated → (approve
as admin) jury_review — asserting the observed status at each hop for BOTH tracks,
then clean up the throwaway app. Report observed transitions.

## Rollout order

1. Backend behavior A–D (+ hermetic tests green) → commit.
2. Deploy backend (SAM) to staging → live smoke on staging with `udayanpawar03@`.
3. Dry-run the backfill on staging → verify report → apply on staging.
4. On sign-off: deploy to prod → dry-run backfill on prod → **explicit go** → apply
   backfill on prod (backup first) → verify.
   (The prod deploy + prod backfill run are gated behind explicit user approval at
   execution time — not performed automatically.)

## Risks & mitigations

- **Prod data backfill** — reversible backup + `--dry-run` + per-app report; prod
  run gated behind explicit approval.
- **AI-before-assignment race** — resolved by the §B guard change (screen if not yet
  screened, regardless of status).
- **Semantic shift** — "evaluated" now means "≥1 review" (partial panel), and apps
  linger in `submitted` until assigned; dashboards/funnel reflect this by design.
- **Emails** — jury/reject applicant emails fire from the decision chokepoint,
  unaffected by these trigger changes.

## Out of scope

- Changing status *values* or adding new statuses.
- Jury Gate-2 / post-`jury_review` flow.
- Reworking the reviewer-score aggregation (it already handles partial panels).
- Any frontend logic change (display is value-driven and unchanged).
