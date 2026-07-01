# Prod Fixes Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Ship VIP/TIR admin-decision fix, a prod data reset, and 7 portal fixes on `release/sip-launch-v1` (@ `35a342c`). (Workstream A — summary 150–200 — already shipped.)

**Architecture:** Tasks grouped file-disjoint so they can run in parallel without conflicts: T1 backend state-machine; T2 backend list/roster/invite (admin_query + leadership + admin_users); T3 frontend admin; T4 frontend reviewer+leadership; T5 data-op (controller-run). Backend deploys via SAM; frontend needs a Vercel promote by the user.

**Tech Stack:** FastAPI + Supabase (backend), React/Vite (frontend), pytest/vitest. Run backend single files with `--no-cov`. venv: `source /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/activate`; backend dir: the release worktree's `backend/`.

---

### Task 1 — Admin decision works for VIP+TIR (item 4) [BACKEND]
**Files:** Modify `backend/app/services/state_machine.py` (LEGAL_TRANSITIONS ~:40-42); Test `backend/tests/test_state_machine.py`.
- **Fix:** add `"jury_review"` to the allowed frozenset for `submitted`, `ai_screening`, `screening_failed` (keep existing `rejected`,`withdrawn`). Leave all other statuses as-is.
- **Test:** assert `assert_legal_transition("submitted","jury_review")` no longer raises; `("submitted","rejected")` still ok; an illegal one (e.g. `("onboarded","jury_review")`) still raises.
- **Verify email path unchanged:** `decisions.record_decision` already emails on `jury_review`/`rejected` (both tracks). No change needed there.
- Commit: `fix(admin): allow jury_review decision from submitted/ai_screening/screening_failed (VIP+TIR approve/reject)`

### Task 2 — Backend list/roster/invite fixes (items 5,6,7-BE,9-BE,10) [BACKEND]
**Files:** `backend/app/services/admin_query.py`, `backend/app/routers/leadership.py`, `backend/app/routers/admin_users.py`, `backend/app/models/*`; tests under `backend/tests/`.
- **D2 VIP project=company (item 5):** in the list name derivation (`admin_query.fetch_pipeline` ~:354-359, `leadership.list_applications` ~:263, reviewer apps `admin_query` ~:719-724) branch: if `track=='sip'` → `name = basic_org or basic_full_name` (company name); else keep current (`project_names.get(key) or derive_project_name(r) or basic_org …`). Test: a sip row with `basic_org="Acme Pvt Ltd"` → name is `"Acme Pvt Ltd"`, a tir row unchanged.
- **D3 unassign backend (item 6):** `admin_query.bulk_remove_reviewer_apps` (:1003-1032) must (a) hard-delete the `reviewer_assignments` row for each (application_id, track, reviewer) and (b) return per-item status `removed` / `not_found` / `skipped_submitted` (report `skipped_submitted` when a submitted review existed, but STILL delete the assignment). Confirm the endpoint `/admin/platform/reviewers/{id}/applications/remove` is what the roster column control calls; if the column control only clears batch membership, that's a frontend fix (T3). Test: removing an assigned app deletes the row and returns `removed`; an app with a submitted review returns `skipped_submitted` and the assignment is gone.
- **D4-BE leadership reviewer_score (item 7):** add `reviewer_score` to each row in `leadership.list_applications` (reuse the same weighted-reviewer-score helper admin uses, e.g. `_fetch_reviewer_scores`/`applications_query`). Test: leadership list row includes `reviewer_score` (float or null).
- **D6-BE invite domains/batch (item 9):** `admin_users.CreateUserRequest` (:40-51) accepts `expertise_domains: list[str] | None = None` and `batch_id: str | None = None`; `create_user` (:74-251), when roles include `reviewer`, upserts a `reviewer_profiles` row with `expertise_domains` + `batch_id`. Test: create_user with domains+batch writes reviewer_profiles (mock supabase, assert upsert called with those fields).
- **D7 last activity (item 10):** `admin_query.fetch_roster` (~:648) — when a reviewer has no submitted-review `submitted_at`, fall back to `MAX(reviewer_assignments.assigned_at)` for that reviewer, else `reviewer_profiles.updated_at`. Test: a reviewer with assignments but no submitted reviews gets a non-null `lastActivity`.
- Commit each sub-fix separately with a `fix(admin|leadership): …` message. Run `pytest tests/test_admin*.py tests/test_leadership*.py --no-cov -q` green.

### Task 3 — Frontend admin (items 2,6,7,8) [FRONTEND]
**Files:** `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`, `AdminReviewers.jsx`, `frontend/src/lib/adminDataAdapter.js`, `frontend/src/lib/adminPlatformApi.js`.
- **D1 admin search (item 2):** ensure the search input filters the rendered rows on name+founder+industry (case-insensitive substring) — the predicate currently misses/renders wrong; make it filter the displayed array like leadership. Verify typing narrows the list.
- **D4 admin AI-score column (item 7):** add an **AI score** column next to Reviewer score, rendering `s.ai.overall` (already in the adapter). Add it to `renderHeader`/`sortedFiltered` so it sorts too.
- **D5 admin sort (item 8):** admin already sorts; ensure ALL columns (incl. the new AI col) are click-sortable asc/desc.
- **D3 unassign UI (item 6):** make the roster "APPLICATIONS ASSIGNED" column's remove control call the real unassign endpoint (`adminPlatformApi.bulkRemoveReviewerApps`) and refresh the roster so the applicant is actually unassigned; surface `skipped_submitted` if returned.
- **D6 invite fields (item 9):** `AdminReviewers.handleInvite` must include `expertise_domains: invDomain.split(',').map(s=>s.trim()).filter(Boolean)` and `batch_id: invBatch || null` in the `createUser` payload.
- Test: existing admin vitest suites stay green; add a search-filter + sort test if a harness exists. Commit per fix.

### Task 4 — Frontend reviewer + leadership (items 2,7,8) [FRONTEND]
**Files:** `frontend/src/pages/reviewer/v2/ReviewerQueue.jsx`, `frontend/src/pages/leadership/LeadershipDashboard.jsx`.
- **D1 reviewer search (item 2):** fix the queue search to filter rendered rows on name+founder+industry (case-insensitive) — matches leadership UX.
- **D5 reviewer sort + leadership sort (item 8):** add click asc/desc sortable headers to the reviewer queue table and the leadership applications table (mirror admin's `handleSort`/`renderHeader` pattern), all columns.
- **D4 leadership reviewer-score column (item 7):** render a **Reviewer score** column next to AI score using the new `reviewer_score` field from T2.
- Test: existing reviewer/leadership vitest suites stay green. Commit per fix.

### Task 5 — Data operation (item 3) [CONTROLLER-RUN, read-first]
**Files:** a one-off script (scratch) — NOT committed to the repo.
- **Enumerate (read-only):** print (a) all apps with an `admin_decisions` row EXCEPT the 3 named (`Jaipur Artisans Elegance`, `Dfjo project`, `AI-powered defense robotics`, matched by project/company name — resolve IDs), and (b) all apps with `reviewer_assignments`/`reviews` by himanshi or ramanpreet with activity before `2026-06-28`. Show the list to the user for a final go.
- **Backup:** dump affected `reviewer_assignments`, `reviews`, `admin_decisions`, and status rows to a JSON file first.
- **Mutate:** for set (a) minus the 3: delete their reviewer_assignments + reviews + admin_decisions, set status `under_review`, set `application_admin_meta.is_hidden=false`. The 3 named stay `rejected`. For set (b): delete those reviewer_assignments + reviews, set status `under_review`, un-hide. Idempotent.
- Verify: re-query to confirm the 3 remain rejected, the rest are `under_review` + unassigned + visible.

---

## Rollout
1. T1 + T2 land → SAM redeploy backend.
2. T3 + T4 land → push; user Vercel-promotes.
3. T5 → enumerate → user confirms exact list → mutate.

## Self-review
- Spec coverage: item1=A(done); item2=T3/T4 D1; item3=T5; item4=T1; item5=T2 D2; item6=T2 D3 + T3 D3; item7=T2 D4-BE + T3/T4 D4; item8=T3/T4 D5; item9=T2 D6-BE + T3 D6; item10=T2 D7. ✔ all covered.
- File-disjoint: T1(state_machine) ∥ T2(admin_query/leadership/admin_users) ∥ T3(admin FE) ∥ T4(reviewer+leadership FE). T4 leadership reviewer-score column depends on T2 D4-BE field → run T2 before T4's D4 piece (or T4 renders null-safe until deployed).
