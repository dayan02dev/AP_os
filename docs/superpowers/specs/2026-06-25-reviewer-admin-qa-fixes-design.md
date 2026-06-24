# Reviewer + Admin QA Fixes — Design Spec

**Date:** 2026-06-25
**Branch:** `fix/reviewer-admin-qa-fixes` (worktree off `origin/release/sip-launch-v1` @ `43ef82e`)
**Target:** production (`apply.artpark.info` / `api.artpark.info`), deploy **held for explicit go-ahead**
**Surfaces:** Admin portal, Reviewer portal

A batch of 6 QA fixes reported against the live admin "Manage Applications" drawer, the
admin batch tooling, the reviewer history, and the reviewer queue. Each item below is
grounded in the actual prod code read during investigation.

---

## Item 1 — Manage drawer layout is distorted (admin)

**Symptom:** In the admin Reviewer-Roster → "Manage" drawer, the purple **"Assign Application"**
button is pushed off the right edge of the 760 px drawer panel (clipped / overlapping the page).

**Root cause:** `ManageApplicationsDrawer.jsx` renders the assign row as a flexbox
`[<select style={{flex:1}}> <button>]`. The `<select>` has `flex:1` but no `min-width:0`, so its
default `min-width:auto` resolves to the intrinsic width of its **widest `<option>`** (long project
names like *"Building AI-powered multimodal biometric…"*). The select refuses to shrink below that,
the flex row overflows the panel, and the sibling button is shoved past the drawer edge. Classic
flexbox min-content overflow.

**Fix:** Add `minWidth: 0` to the select and `flexShrink: 0` (+ `whiteSpace: nowrap`) to the button.
No backend change. This row is rebuilt in Item 2 anyway; the fix lands as part of that rebuild.

**Files:** `frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx`

---

## Item 2 / 3 — Bulk actions in the Manage drawer (admin)

**Symptom:** Apps can only be removed one-by-one; no select-all, no bulk remove, no bulk assign,
no batch-level grouping.

**Decision (confirmed):** Implement **all three** capabilities.

### Frontend (`ManageApplicationsDrawer.jsx` rebuild)
- **Per-row checkboxes** + a **header "select all"** checkbox (selects all currently-listed apps).
- **"Remove selected (N)"** button that bulk-unassigns every checked app.
- **Group the assigned list by batch**, each group with a **"select all in this batch"** toggle, so a
  whole batch's apps can be removed at once. Apps with no batch group under **"Random allotment."**
- **Bulk assign:** the "Assign New Application" picker becomes a **multi-select checklist** (search +
  checkboxes) so several apps can be assigned together. (Replaces the single `<select>`, which also
  removes the Item 1 overflow surface entirely.)
- Per-item result feedback: a short summary banner (e.g. *"Removed 30, skipped 2 (already
  reviewed)"*). Disable controls while a bulk op is in flight; reload the list on completion.

### Backend — two new **admin-only** bulk endpoints
Rather than firing N individual HTTP requests from the browser (34–84 round-trips), add bulk
endpoints that reuse the existing assign/unassign logic server-side and return a per-item summary.
Capability `manage_reviewers_roster` (same as the drawer's read endpoint), admin-only (the existing
test `test_reviewer_applications_is_admin_only` pattern applies — reviewer/leadership → 403).

| METHOD | PATH | Body | Per-item status |
|---|---|---|---|
| POST | `/admin/platform/reviewers/{user_id}/applications` | `{items:[{application_id, track}]}` | `created \| already_assigned \| not_a_reviewer \| not_found` |
| POST | `/admin/platform/reviewers/{user_id}/applications/remove` | `{items:[{application_id, track}]}` | `removed \| skipped_submitted \| not_found` |

- **Assign** reuses the logic in `leadership_actions.assign_reviewers` (reviewer-role check, dedupe
  against existing rows, insert `reviewer_assignments`, audit per row).
- **Remove** reuses the `unassign_reviewer` logic **including the 409 "submitted review" guard** — but
  in bulk it does **not** abort the whole request: an app whose review is already submitted is reported
  as `skipped_submitted` (never silently orphaned), and the rest proceed.
- Shared helper extracted so single + bulk paths stay in lockstep (one assign impl, one remove impl).
- `POST` (not `DELETE`) for remove so a request body is unambiguous across clients/proxies.

**Files:**
`backend/app/routers/admin_platform.py` (2 routes),
`backend/app/services/admin_query.py` or a small shared helper in `leadership_actions`/a service
(bulk assign/remove reusing existing logic),
`frontend/src/lib/adminPlatformApi.js` (`bulkAssignReviewerApps`, `bulkRemoveReviewerApps`),
`frontend/src/hooks/useAdminData.js` (no new loader needed; drawer calls the api directly + reloads),
`frontend/src/pages/admin/platform/screens/ManageApplicationsDrawer.jsx`.

---

## Item 4 — Reviewer history errors + reviewed apps not showing (reviewer + admin)

**Symptom:** Reviewer **History** tab shows a **red error box with Retry** (confirmed). Separately,
reviewed apps don't appear in history / on the admin side.

**Root cause analysis:**
- A red `ErrorState` means `/reviewer/history` returned a **non-2xx**. Every DB call inside
  `reviewer_query.fetch_history` is already wrapped in try/except that degrades to *empty* (which would
  render "no reviews," not an error). So a red error implies the request **never returns 2xx** — i.e. a
  **Lambda/API-Gateway timeout (502/504)** or an unguarded raise.
- `fetch_history` does **2 sequential DB queries per submitted review** (one app row + one ai_screening
  row). This N+1 was already optimized away in `fetch_queue` (bulk `.in_` fetch) but **never in
  history**. A reviewer with many reviews → cumulative latency near/over the **29 s** ceiling → 502/504
  → red box.
- **Admin "not showing":** `admin_query.fetch_roster` computes `completed` as
  `len([a for a in active_assignments if a.completed_at])`. `completed_at` is a **best-effort** write on
  review submit that can diverge (try/except), so a submitted review whose `completed_at` never stamped
  shows as 0 completed. (Note: the Manage-drawer per-app `reviewStatus` is already reviews-based and
  correct; this only affects the roster progress count.)

**Fix:**
1. **Rewrite `fetch_history` to bulk-fetch** like `fetch_queue`: collect all submitted reviews, then
   fetch app rows once per track via `.in_("id", ids)` and ai_screening once via
   `.in_("application_id", ids)`, assembling by `(application_id, track)` in Python. Eliminates the N+1
   and the timeout. Wrap the whole body so any failure degrades to a flagged-empty response, never 5xx.
2. **Apply the same bulk-fetch to `fetch_completed_reviews`** (same N+1, same risk).
3. **Make the roster `completed` count reviews-based:** count active assignments for which a
   **submitted review exists** (join the reviews already fetched in `fetch_roster`), so submitted work
   surfaces even when `completed_at` didn't stamp. Keep `assigned` as-is.
4. **Verification:** offer to confirm the exact prod trigger via a reviewer login or read access to the
   prod Supabase (`xtmszlpwgbyoumalgbhs`); the bulk-fetch + guard fix covers every plausible 500 path
   regardless.

**Files:**
`backend/app/services/reviewer_query.py` (`fetch_history`, `fetch_completed_reviews`),
`backend/app/services/admin_query.py` (`fetch_roster` completed count).
No frontend change required (the existing History table + ErrorState are correct once the endpoint
returns 2xx with rows).

---

## Item 5 — Delete batches (admin)

**Symptom:** No way to delete a batch from the Applications page.

**Root cause:** There is **no `DELETE /admin/platform/batches/{id}`** endpoint (only GET/POST/PATCH +
assign-apps / assign-reviewers) and no delete affordance in the UI.

**Decision (confirmed):** **Unlink only** — deleting a batch reverts its apps to "Random allotment"
and leaves reviewer assignments + reviews intact.

### Backend — new endpoint
`DELETE /admin/platform/batches/{id}` (capability `manage_batches`):
1. 404 if the batch doesn't exist.
2. Delete `application_batches` rows where `batch_id = id` (apps revert to no batch → "Random allotment").
3. Null out `reviewer_profiles.batch_id` where it equals `id` (avoid a dangling reference in the roster
   `batch` field).
4. Delete the `batches` row.
5. `write_audit("batch_deleted", …)`.
6. **Leave `reviewer_assignments` and `reviews` untouched.**

### Frontend
A compact **batch manager** on the Applications (Pipeline) page near the existing batch filter: lists
batches with a delete (×) per batch and a confirm dialog. Wire `adminPlatformApi.deleteBatch(id)` →
reload batches + pipeline. (If you prefer it on the Reviewers tab instead, easy to move — confirmed
Applications page for now.)

**Files:**
`backend/app/routers/admin_platform.py` (delete route),
`frontend/src/lib/adminPlatformApi.js` (`deleteBatch`),
`frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` (batch-manager UI).

---

## Item 6 — Reviewer sees their own score (reviewer)

**Symptom:** On the reviewer **Queue** (Image #7), there's an AI Score column but no column for the
reviewer's *own* submitted score.

**Decision (confirmed):** Queue column **+** fix History (History already has a "My score" column,
unblocked by Item 4).

**Root cause:** `fetch_queue` already loads the reviewer's own review (`rv_by_key`) but only uses it for
the status chip — it never returns the weighted overall.

**Fix:**
1. Add `myScore: _weighted_overall(my_review)` (None when no review / incomplete) to each `fetch_queue`
   row.
2. Add a **"My Score"** column to `ReviewerQueue.jsx`: shows the value for submitted (and draft, if
   computable) reviews, "—" otherwise. Style the cell with **inline styles only** (mirror the AI-score
   cell) to avoid the global `.lp-score-bar` leak from `leadership.css`.

**Files:**
`backend/app/services/reviewer_query.py` (`fetch_queue` payload),
`frontend/src/pages/reviewer/v2/ReviewerQueue.jsx` (column).

---

## Cross-cutting

### Testing
- **Backend (pytest, fake Supabase client):**
  - bulk assign/remove endpoints: admin-only (reviewer/leadership → 403), per-item statuses,
    `skipped_submitted` guard, `not_found`.
  - `DELETE /batches/{id}`: 404 unknown; unlinks `application_batches`; nulls `reviewer_profiles.batch_id`;
    leaves `reviewer_assignments`/`reviews`; audit written.
  - `fetch_history` / `fetch_completed_reviews`: returns rows with bulk-fetch; never raises on a bad row.
  - `fetch_roster`: `completed` counts submitted reviews even when `completed_at` is NULL.
  - `fetch_queue`: row carries `myScore`.
- **Frontend (vitest):**
  - drawer: select-all toggles all rows; bulk remove calls the bulk endpoint with the right items;
    batch group select; multi-assign.
  - queue: "My Score" column renders the value / "—".
  - adapter: `deleteBatch` wired; batch-manager delete calls it.

### Deploy (held for explicit go-ahead)
- All work on `fix/reviewer-admin-qa-fixes` in the isolated worktree (never the shared HEAD).
- **No DB migration** required — all six items use existing tables/columns.
- On go-ahead: `sam build` **from this worktree**, grep `.env.prod` to confirm
  `TIR_/SIP_SUBMISSIONS_CLOSED` stay `true` before deploy, deploy backend to
  `artpark-eir-api-production`, then **promote** the Vercel build to `apply.artpark.info`.

### Out of scope / non-goals
- No change to the `reviews.score_solution` ↔ `ai_screening.score_completeness` split (load-bearing).
- No change to anti-anchoring (AI shown pre-submit stays as-is).
- No new migration; no change to the state machine or Gate-1 decisions.

### Acceptance criteria
1. Manage drawer: assign control + button fully inside the panel at all widths.
2. Manage drawer: can select-all (and select-all-in-batch), bulk-remove, and bulk-assign multiple apps;
   already-reviewed apps are reported skipped, not orphaned.
3. Reviewer History loads (2xx) with all submitted reviews and their "My score"; no red error box.
4. Admin roster progress reflects submitted reviews.
5. A batch can be deleted from the Applications page; its apps show "Random allotment"; assignments and
   reviews are preserved.
6. Reviewer Queue shows a "My Score" column populated for submitted reviews.
