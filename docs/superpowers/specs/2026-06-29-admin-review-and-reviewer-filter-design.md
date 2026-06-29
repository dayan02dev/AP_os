# Admin Review + reviewer-filter changes — design spec

**Date:** 2026-06-29
**Surfaces:** Reviewer portal (My Queue), Admin portal (Admin Review / `AdminGate1`, Admin detail / `AdminDetail`, Manage-Applications drawer).
**Scope:** Frontend + backend (2 backend changes → SAM deploy) + 1 prod data fix. No DB migration.

## Goal

Eight changes (1 reviewer + 7 admin), all confirmed with the user:

1. **Reviewer filters → "Filters" toggle button.** The filters already render + work; collapse Status/Stage/Industry behind a "Filters" button like leadership.
2. **Remove "Waitlist" from the Admin-Review Live-Decisions counter**, and **revert the EV Battery Circularity waitlist** (done by mistake) back to `evaluated`.
3. **Delete the "Cutoff slider" variant** + its tab; re-letter to A·Status, B·Batch decision, C·My history.
4. **Batch decision:** remove the **HOLD** button (keep Approve/Reject); fix Approve so it actually **emails** the applicant (today the batch path maps Approve→`shortlisted` = no email); verify with a test.
5. **Show reviewer flags** in Batch-decision + My-history lists + the detail "Flags Raised" panel (today hardcoded empty).
6. **Remove the "Reviewer Assignment" panel** from the admin detail view; verify the detail Approve/Reject buttons + email.
7. **Batch-decision rows clickable** → open the application detail (as My-history already does).
8. **Fix Manage→Remove / Remove-selected** so already-reviewed apps can actually be unassigned (backend silently skips them today).

## Current state (grounding — from code map)

- **`AdminGate1.jsx`** — `variant` state (`"stack"|"cutoff"|"batch"|"history"`, line 828); tab bar lines 861-864; render switch 872-878; `goDetail` is a prop of `AdminGate1` (line 827).
  - **Variant A `GateReviewStack`** (172-361): LIVE DECISIONS counter (262-281) tallies `{approve, waitlist, reject}` from local `decisions` state; Approve/Reject buttons call `decide()` (no Waitlist button exists).
  - **Variant B `GateReviewCutoff`** (367-493): histogram + cutoff slider → `bulkDecide` shortlist/reject. **To delete.**
  - **Variant C `GateReviewBatchDecision`** (498-648): table STARTUP/BATCH/SCORE/FLAGS/DRAFT DECISION (APPROVE/HOLD/REJECT, line 500 `draftDecisions`); "Push Decisions" → `handlePushDecisions` → `bulkDecide({items})` (539) using `UPPER_TO_WIRE` (43-48: `APPROVED→"shortlisted"`, HOLD→on_hold, REJECTED→rejected). FLAGS col (626-631) reads `s.flags` (always `[]`). Rows NOT clickable.
  - **Variant D `GateReviewHistory`** (656-822): history table; FLAGS col (789-795) reads `s.flags` (always `[]`); Edit (806) → inline Approve/Hold/Reject → `decide()`; **row click → `goDetail(s.id, s.track, "gate1")`** (776-782).
  - Exported test helpers: `canSubmitDecision`, `decisionNeedsRationale`, `buildBulkItems`, `partitionByCutoff`, `summarizeBulkResults`.
- **Decision → email:** `BUTTON_TO_DECISION` (`adminDataAdapter.js` 10-12): `{approve:"jury_review", hold:"on_hold", reject:"rejected", waitlist:"waitlisted"}`. Backend `decisions.record_decision` emails only when `decision in ("rejected","jury_review")` (`decision_email._OUTCOME = {"rejected":"rejected","jury_review":"advanced"}`). So Variant A/AdminDetail Approve→`jury_review`→**email**; Variant C batch Approve→`shortlisted`→**no email** (the bug).
- **Flags:** `adaptPipelineRow` hardcodes `flags: []` (line 31); `fetch_pipeline` (`admin_query.py` 275-291) does NOT fetch reviews. `adaptDetail` hardcodes `flags: []` (but `adaptOneReview` preserves `rv.flags`, and `fetch_detail` returns full `reviews`). `reviews.flags` is jsonb (mig 022, cap 8).
- **AdminDetail.jsx** — `ReviewerAssignmentCard` (128-253) rendered at 703-713 (assign input + Unassign). FLAGS RAISED panel (691-700) reads `s.flags`. DECIDE card (716-766): Approve→`jury_review`, Reject→`rejected`.
- **ManageApplicationsDrawer.jsx** — Remove (per-row, 293-299) + Remove-selected (237-244) call `adminPlatformApi.bulkRemoveReviewerApps(reviewer.id, [{application_id, track}])`. Backend `bulk_remove_reviewer_apps` (`admin_query.py` 914-952) **skips apps with a submitted review** (`r.get("submitted_at")` → `skipped_submitted`). All the user's test apps are EVALUATED/IN-REVIEW = review-submitted → silently skipped = "doesn't work".
- **ReviewerQueue.jsx** — `.lp-filter-area` with always-expanded `.lp-filter-section` blocks (Status/Stage/Industry) + search + track + Clear (when `hasFilters`). Styled under `.rv-portal` in reviewer-portal.css.

## Change 1 — reviewer "Filters" toggle (frontend-only)

`ReviewerQueue.jsx`: add a `showFilters` state (default false). Keep the search + track row always visible. Add a **"Filters" button** in that row (with a badge showing the count of active non-search filters: status/stage/industry/track ≠ "all"). The three `.lp-filter-section` blocks render only when `showFilters` is true. Keep "Clear filters" (when `hasFilters`). Add minimal CSS for the toggle button (reuse `.lp-filter-btn`/leadership-style classes already in reviewer-portal.css). Mirrors the leadership dashboard's collapsible filter affordance.

## Change 2 — remove Waitlist tally + revert mistaken waitlist

- **`AdminGate1.jsx` Variant A:** remove the `"Waitlist"` entry from the LIVE DECISIONS counter array (262-281) so it shows only Approve + Reject. (Drop `waitlist` from the local `counts` too.)
- **Data fix (prod):** EV Battery Circularity is `waitlisted` by mistake. Clear its `admin_decisions` (gate1) row + set application status back to `evaluated`. Done via prod DB (PostgREST) — revert decision + status; leave reviewer assignment + reviews intact.

## Change 3 — delete Cutoff variant + re-letter tabs

`AdminGate1.jsx`: remove the `GateReviewCutoff` component (367-493), its `"cutoff"` tab entry (861-864), and its branch in the render switch (872-878). Re-letter the remaining tab labels: **A · Status, B · Batch decision, C · My history** (`variant` values can stay `"stack"|"batch"|"history"`; only the displayed "A/B/C ·" labels change). Remove any now-dead `partitionByCutoff` usage (keep/remove the exported helper + its test as a pair).

## Change 4 — batch decision: remove HOLD + fix approve-emails

- **`AdminGate1.jsx` Variant C:** remove the **HOLD** button from the DRAFT DECISION cell (keep Approve/Reject); drop `HOLD` handling from `draftDecisions`/`buildBulkItems` paths.
- **Fix the email bug:** change `UPPER_TO_WIRE.APPROVED` from `"shortlisted"` → **`"jury_review"`** (consistent with Variant A + AdminDetail; this is the value that triggers the applicant email). Remove the now-unused `HOLD`/`WAITLISTED` entries from `UPPER_TO_WIRE`. After this, batch **Approve → jury_review → "advanced to jury" email**; **Reject → rejected → decline email**. (Admin "Approve" = *advance to jury* — the established semantics; that is the email the applicant receives.)
- **Email test:** seed a throwaway test application whose applicant resolves to **udayanpawar03@gmail.com** (status `evaluated`), then from Admin Review Approve it (one) + Reject it (another, or re-seed) and confirm the emails fire (check Resend / logs). Remove the test app(s) afterward. Verify the decision-email recipient resolution (auth email vs `basic_email`) during the test.

## Change 5 — reviewer flags in lists + detail

- **Backend** `admin_query.fetch_pipeline`: bulk-fetch `reviews` (flags) for the listed `(application_id, application_track)` pairs (one query per track, like the other bulk fetches) and attach an aggregated `flags` array (union of each app's `reviews[].flags`, de-duplicated) to each pipeline row.
- **`adaptPipelineRow`:** set `flags` from the backend value (`Array.isArray(row.flags) ? row.flags : []`) instead of hardcoded `[]`.
- **`adaptDetail`:** aggregate `flags: reviews.flatMap(rv => rv.flags || [])` (de-duplicated) so the detail "Flags Raised" panel populates.
- Result: FLAGS column in Variant C + Variant D shows a count/list; the detail panel lists them. **Backend change → SAM deploy.**

## Change 6 — remove Reviewer-Assignment panel (frontend-only)

`AdminDetail.jsx`: delete the `ReviewerAssignmentCard` component (128-253) and its render (703-713). Leave the DECIDE (Approve/Reject) card + FLAGS RAISED panel. Approve/Reject already call `decide` → jury_review/rejected → email (verified in the Change-4 email test).

## Change 7 — batch-decision rows open detail (frontend-only)

`AdminGate1.jsx`: pass `goDetail` into `GateReviewBatchDecision` (add to props + the parent's `<GateReviewBatchDecision … goDetail={goDetail} />` at ~876). Add the same `handleRowClick` guard pattern Variant D uses (ignore clicks on `button`/`a`) to each batch `<tr>` (line 619) → `goDetail(s.id, s.track, "gate1")`, with `cursor: pointer`.

## Change 8 — Manage→Remove works for reviewed apps

**Backend** `admin_query.bulk_remove_reviewer_apps` (914-952): remove the `submitted_at` skip-guard so a removal **deletes the active `reviewer_assignment`** even when the reviewer already submitted a review (the review row itself is kept for audit). Each item returns `removed` (not `skipped_submitted`). **Backend change → SAM deploy.**
- **Frontend** `ManageApplicationsDrawer.jsx`: ensure the drawer's assigned list reflects the removal after reload (it already reloads via `apps.reload()`); confirm removed apps disappear from the reviewer's grouping. No call-shape change needed (the frontend already sends `{application_id, track}` correctly).

## Testing

- **Frontend unit tests:** reviewer `Filters` toggle (sections hidden until clicked); `AdminGate1` tab set is A·Status/B·Batch/C·My history (no Cutoff); batch DRAFT DECISION has no HOLD button; `UPPER_TO_WIRE.APPROVED === "jury_review"`; `adaptPipelineRow`/`adaptDetail` surface `flags`; batch row has an onClick → goDetail. Use `@testing-library/react` (`fireEvent`), never `user-event`.
- **Backend tests** (`test_admin*.py` / `test_admin_query`): `fetch_pipeline` rows carry aggregated reviewer `flags`; `bulk_remove_reviewer_apps` removes an assignment even when a review was submitted.
- **Manual email test** (Change 4/6): seed + decide on the udayanpawar03 test app; confirm email + cleanup.
- Full suites: `cd frontend && npx vitest run` green; `cd backend && python -m pytest` (ignore ~19 unrelated pre-existing failures); `npm run build` clean.

## Deploy

- **Backend (SAM)** for Changes 5 + 8 (flags aggregation + remove-guard): SAM-build + `infra/sam/deploy-prod.sh` from this worktree (it sources `backend/.env.prod`; **confirm `TIR_/SIP_SUBMISSIONS_CLOSED=true`** — already true). Smoke `/health/ready`.
- **Prod data fix** (Change 2): revert EV Battery Circularity waitlist via PostgREST.
- **Frontend:** push `release/sip-launch-v1`; user Vercel-promotes.
- **Email test** after backend deploy.

## Out of scope / non-goals

- No DB migration.
- The reviewer queue filters already function — only the collapse-behind-a-button affordance is added.
- The parallel "six admin-portal fixes" spec (`07f3ca9`) is separate; if its (unshipped) code later touches `AdminGate1.jsx` it must be reconciled.
- Admin "Approve" semantics stay `jury_review` ("advance to jury"); no new "accepted" status/email is introduced.

## Files touched (summary)

**Frontend:** `pages/reviewer/v2/ReviewerQueue.jsx` (+ reviewer-portal.css), `pages/admin/platform/screens/AdminGate1.jsx`, `pages/admin/platform/screens/AdminDetail.jsx`, `lib/adminDataAdapter.js` (UPPER_TO_WIRE, adaptPipelineRow flags, adaptDetail flags) + tests.
**Backend:** `app/services/admin_query.py` (fetch_pipeline flags aggregation + bulk_remove_reviewer_apps guard) + tests.
**Data:** prod revert of EV Battery Circularity waitlist.
