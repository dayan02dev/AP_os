# Prod Fixes Batch (2026-07-01) — Design Spec

> Base: prod `release/sip-launch-v1` @ `93e8ee4`. All changes ship to prod (backend SAM deploy + Vercel promote for FE). Root causes below were pinned by reading the code (file:line inline).

## Workstream A — Summary recompress to 150–200 words ✅ (in flight)
- **Prompt** `ai_pipeline/prompts/summary.txt` → new 150–200-word prompt (user-supplied). **Validator** `summary_agent.py` `WORD_MIN=150`, `WORD_MAX=200`, mock→175.
- **Live path:** update `tests/test_ai_pipeline.py` summary tests (300–400 → 150–200); commit + push + SAM redeploy so the worker uses the new prompt for future submits/edits.
- **Backfill:** focused recompress (summary-only, reuse existing scores/project_name) over all 594 non-draft apps; resumable (skip ≤210-word summaries); concurrency 8. Regenerates only `ai_screening.summary`; does not touch scores/sections/status.

## Workstream B — VIP (and TIR) admin decision + emails (item 4)
- **Root cause:** `state_machine.LEGAL_TRANSITIONS` (`state_machine.py:39-54`) allows only `{rejected, withdrawn}` from `submitted`, `ai_screening`, `screening_failed`. VIP apps sit in those → Approve→`jury_review` raises 422 (`decisions.record_decision` pre-validates), so status never moves and `decision_email.notify_applicant_decided` never fires. Email path itself is correct and already labels VIP.
- **Fix:** add `jury_review` (keep `rejected`,`withdrawn`) to the allowed sets for `submitted`, `ai_screening`, `screening_failed`. Now, for BOTH tracks: Approve→`jury_review` + "advanced" email; Reject→`rejected` + rejection email, from the app's current pre-decision status. Update `test_state_machine` + a decision test.

## Workstream C — Prod data operation (item 3) — CONFIRMED PARAMETERS
Execute as a **read-first** script: enumerate exact affected apps, print them for a final go, then mutate. Target status for "unassigned" = **`under_review`**.
1. **Admin-decided apps** (rows in `admin_decisions`) **EXCEPT** the 3 named — `Jaipur Artisans Elegance`, `Dfjo project`, `AI-powered defense robotics` (match by project/company name; confirm IDs in the enumerate step): remove their `reviewer_assignments`, delete their `reviews`, delete their `admin_decisions`, set status → `under_review`, un-hide (`application_admin_meta.is_hidden=false`). The 3 named stay `status=rejected`.
2. **Deleted-reviewer apps:** any app reviewed/assigned by **himanshi** or **ramanpreet** (removed 2026-06-25) with activity **before 2026-06-28**: remove those `reviewer_assignments` + their `reviews`, set status → `under_review`, un-hide so they show in the pipeline.
- Idempotent, reversible-by-backup (dump affected rows first). No schema change.

## Workstream D — Portal fixes
- **D1 Search (item 2)** *(FE)*: `AdminPipeline.jsx` + `ReviewerQueue.jsx` filter only loaded rows / miss fields. Make the client-side predicate match name + founder + industry (case-insensitive substring) over the loaded set and render the filtered array — matching leadership's UX. (Reviewer/admin already load their full set, so no server round-trip needed.)
- **D2 VIP project = company (item 5)** *(BE)*: name derives from `ai_screening.project_name`/`stats.derive_project_name`. Branch: `track=='sip'` → `basic_org` (company) first. Apply in `admin_query.fetch_pipeline` (~:354), `leadership.list_applications` (~:263), reviewer apps (`admin_query` ~:719). TIR unchanged.
- **D3 Unassign (item 6)** *(BE+FE)*: the roster column control must actually delete the `reviewer_assignment` (not just clear batch membership) and report correctly; fix `bulk_remove_reviewer_apps` status codes (`admin_query.py:1003-1032`) and the column handler in `AdminReviewers.jsx` so the applicant is truly unassigned + UI refreshes.
- **D4 Score columns (item 7)**: Admin *(FE)* — render `ai_score_overall` (already in payload) as an **AI score** column next to Reviewer score. Leadership *(BE+FE)* — add `reviewer_score` to `/leadership/applications` list payload + a **Reviewer score** column next to AI score.
- **D5 Sortable headers (item 8)** *(FE)*: admin already sorts; add click asc/desc (mirroring admin's `handleSort`/`renderHeader`) to leadership applications table + reviewer queue table, across all columns.
- **D6 Invite domains/batch (item 9)** *(BE+FE)*: `AdminReviewers.handleInvite` doesn't send `invDomain`/`invBatch`; `create_user` (`admin_users.py:40-51`) doesn't accept them or write `reviewer_profiles`. FE sends `expertise_domains` + `batch_id`; BE accepts + upserts `reviewer_profiles` on reviewer invite.
- **D7 Last activity (item 10)** *(BE)*: `fetch_roster` (`admin_query.py:~648`) sets `lastActivity` only from submitted reviews → empty for all (0 completed). Fall back to `MAX(reviewer_assignments.assigned_at)`, else `reviewer_profiles.updated_at`.

## Sequencing / rollout
1. A (running) → live-path commit + redeploy.
2. B + D-backend (state machine, VIP name, leadership reviewer_score, invite, last-activity, unassign) → deploy.
3. D-frontend (search, sort, columns, unassign UI, invite fields) → Vercel promote (user).
4. C data-op → enumerate, confirm, mutate (read-first, backup).

## Testing
Backend: pytest per touched module (`--no-cov`), full-suite regression vs base (no new failures). Frontend: existing vitest suites for admin/leadership/reviewer stay green + new sort/search tests. C: dry-run enumeration + row backup before mutation.
