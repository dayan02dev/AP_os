# Jury Portal Fixes + Suggest-then-Confirm Flow — Design Spec

**Date:** 2026-07-27
**Branch:** `release/sip-launch-v1` (real prod) — work in worktree `.claude/worktrees/release-sip-launch-v1`
**Ships as:** backend SAM deploy + frontend Vercel promote (frontend promote by user)

**Goal:** Fix three jury "Failed to load / Failed to fetch" errors, convert AI auto-assign into a suggest-then-admin-confirm flow, recolor the jury surfaces to the design-system purple, and restyle/add the HOME buttons.

**Architecture:** Frontend = Vite/React at apply.artpark.info; backend = FastAPI on Lambda at api.artpark.info (ap-south-1); Supabase Postgres. Jury v2 tables (`jury_assignments`, `jury_selections`, `jury_recommendations`, `jury_profiles`, `jury_invites`) from migration `033_jury_v2.sql`. **No new migration is required.**

**Tech stack:** React + a plain `fetch` wrapper (`frontend/src/lib/api.js`), FastAPI + supabase-py (PostgREST), CSS custom properties for theming.

---

## Root cause shared by Issues 1, 5, 6 — CORS-less 500s

The admin portal and the jury portal both call `api.artpark.info` **cross-origin**. In `backend/app/main.py:129-148` the middleware order is (inner→outer) `RequestContext → SlowAPI → CORS → SecurityHeaders`. Starlette's built-in `ServerErrorMiddleware` wraps everything **outside** this stack. Consequently, when a route raises an **unhandled exception**, the resulting `500` is produced by `ServerErrorMiddleware` and **never passes back through `CORSMiddleware`**, so it carries no `Access-Control-Allow-Origin` header. The browser then rejects the response at the network layer and the frontend's `api.js` (`apiCall` catch, `api.js:158-171`) reports it as `ApiError{status:0, code:"network_error", message:"Failed to fetch"}` — the opaque "Failed to fetch"/"Failed to load" the user sees, instead of a real message.

Therefore the durable fix for all three is: **do not let these jury endpoints raise unhandled exceptions**, and add a safety net so any future app-level 500 still carries CORS headers.

---

## Issue 1 — Admin "Manage Applications" drawer: "Failed to load"

**Where:** Drawer `frontend/src/pages/admin/platform/screens/ManageJurorsDrawer.jsx:28` loads `useAdminData("jurorApplications", {userId})` → `GET /admin/platform/jurors/{userId}/applications` (`backend/app/routers/admin_platform.py:976-982`) → `admin_query.fetch_juror_applications` (`backend/app/services/admin_query.py:1036-1113`). Error branch renders "Failed to load. Retry." at `ManageJurorsDrawer.jsx:192-195`.

**Current behavior:** The assignment fetch is guarded (returns `{"applications": []}` on failure, `admin_query.py:1046-1052`). But the per-row builder that follows is **not** fully guarded: `fetch_project_names_for` / `fetch_industry_for_pairs` / `_fetch_batches` (`admin_query.py:1059-1061`) and `stats.derive_project_name(r)` (`admin_query.py:1098`, TIR rows). Any throw here → unhandled 500 → CORS-less → "Failed to load".

**Fix:**
1. Wrap the whole enrichment/row-builder body of `fetch_juror_applications` (everything after the assignment fetch, `admin_query.py:1059-1113`) so that:
   - each enrichment lookup (`project_names`, `industries`, `batches`) is individually defensive (default to `{}` on failure), and
   - the per-row `for a in active` loop wraps each row in try/except; a failing row still emits a minimal record (`id`, `track`, `status`, best-effort `project`, `picked=False`) rather than aborting the list.
2. Keep the endpoint returning `{"applications": [...]}` always (never 500 for a data-shape problem).
3. **Confirm the live throw** from CloudWatch (`/aws/lambda/artpark-eir-api-production`, ap-south-1) so hardening targets the real trigger; note it in the plan.

**Success:** Opening Manage for any juror shows the assigned list (or "No applications assigned."), never "Failed to load", even with a malformed application row.

---

## Issue 2 — Auto-assign becomes suggest-then-admin-confirm

**Decision (confirmed):** per-juror **checklist of AI suggestions**; bulk button becomes **recompute-only**; **no DB migration** (reuse the existing `jury_recommendations` vs `jury_assignments` split).

**Data model (unchanged):**
- `jury_recommendations` = AI suggestions (`score`, `reason`, `model`), written by the matcher (`backend/app/services/jury_matching/run.py:44-81`).
- `jury_assignments` = confirmed assignments; the **only** table the juror's queue reads (`jury_query.fetch_jury_queue`). Every row = active/visible to the juror.

**Frontend — `ManageJurorsDrawer.jsx`:**
- Remove `handleAutoAssignJuror` (`lines 65-75`) and the "Auto-assign matches" button (`lines 172-175`) that call `adminPlatformApi.autoAssignJury(juror.id)`.
- Add a **"Suggested matches (AI)"** section (fed by the already-loaded `pipeline` recommendations for this juror, `ManageJurorsDrawer.jsx:31`): list each recommended, not-yet-assigned JURY REVIEW app as a checkbox row `☑ {name} ({industry}) · ★{score}`, sorted best-fit first, **pre-checked**. A **"Assign selected (n)"** button assigns each checked app via the existing `leadershipApi.assignJurors(app.id, app.track, {juror_user_ids:[juror.id]})` path (`ManageJurorsDrawer.jsx:83-85`), then `reload()`.
- Keep the existing single-select "Assign New Application" dropdown as a manual fallback.

**Frontend — `AdminJury.jsx`:**
- Header button "Auto-assign from AI matches" (`lines 532-536`) → relabel **"Refresh AI suggestions"**; `handleAutoAssign` (`lines 504-516`) calls the recompute-for-all path (recomputes `jury_recommendations` for every juror), assigns nothing, and messages "Suggestions refreshed — open a juror to review & assign." Keep the `disabled` gate on "some juror has matches" but reword the tooltip.

**Backend:**
- Repurpose/retire the direct-assign path. `POST /admin/platform/jury/auto-assign` (`admin_platform.py:1086-1100`) → `jury_matching.run.auto_assign_from_recommendations` (`run.py:118-165`) currently upserts straight into `jury_assignments`. Change the admin-facing behavior so **no UI action writes assignments via the matcher**. Concretely: the "Refresh AI suggestions" button calls the existing recompute endpoint (`admin_platform.py:1059-1078`, enqueues `jury_match`) for all jurors, not `auto-assign`. Leave `auto_assign_from_recommendations` in the codebase but unreferenced by the UI (or delete if no other caller — verify).
- No change to `leadership_actions` assign endpoint (already the single confirm path).

**Success:** Clicking a suggestion checklist + "Assign selected" is the *only* way apps reach a juror's queue; "Refresh AI suggestions" recomputes and assigns nothing.

---

## Issue 3 — Recolor jury surfaces to design-system purple (no green)

**Decision (confirmed):** purple accent `#3213b7` everywhere; **zero green**; error red unchanged.

**`frontend/src/pages/jury/jury.css`:**
- Replace `--jry-green: #1a6b3a` → `#3213b7`; `--jry-green-soft: #eaf4ee` → a soft purple tint (e.g. `#eeeafc`); `--jry-green-line: #b9dcc6` → a purple line (e.g. `#d9d2f7`). (Rename the vars to `--jry-accent*` for clarity; update all usages at `jury.css:15-18, 26, 30, 39, 41-42, 49, 59, 66-73, 86`.)
- `.jry-pickbar-msg.error` stays red `#d23b40`.

**Inline greens:**
- `JuryPortal.jsx:71` topbar avatar `background:"#1a6b3a"` → `#3213b7`.
- `JuryQueue.jsx:165` AI-score bar fill `#2f6f62` → `var(--accent)`/`#3213b7`.
- `JuryAppView.jsx:130-131` AI-overall number `#2f6f62` → `#3213b7`.

**"Picked" chips (no green):**
- Admin `picked_by` chip `os-chip green` (`AdminJury.jsx:436`) and drawer "★ picked" `os-chip green` (`ManageJurorsDrawer.jsx:211`) → a purple/neutral variant (use `os-chip purple` where it exists, else an accent-tinted chip). Jury portal pick button/chip already recolor via the `--jry-accent*` vars.

**Success:** No green pixels remain on the jury portal, the admin Jury section, or the drawer; primary actions/active states are ARTPARK purple.

---

## Issue 4 — HOME buttons

**Jury portal:** `JuryPortal.jsx:50` `<button className="lp-home-btn">← HOME</button>` — the class `.lp-home-btn` has **no CSS anywhere**, so it renders as a raw browser button. Add a rule (in `frontend/src/styles/reviewer-portal.css`, since the jury topbar renders under `.rv-portal .lp-topbar`) styling it as a compact pill consistent with the top bar (bordered, `--ink` text, hover state, focus ring).

**Admin jury section:** `AdminJury.jsx` has no back button. Add a design-system **"← Dashboard"** button (`os-btn ghost` / `secondary`) in the `PageHead` actions or just above it, navigating to the admin dashboard route. It must match `os-btn` styling (no bespoke inline color).

**Success:** Both buttons look intentional and match the portal chrome; keyboard-focusable with a visible focus state.

---

## Issue 5 — Picks: "picked 3, only 1 on return" (atomic write)

**Where:** `PUT /jury/selections` (`backend/app/routers/jury.py:114-154`). The write is a **per-row loop**: delete removed keys (`jury.py:145-147`) then `upsert` each of the 3 picks one-by-one (`jury.py:148-153`). If an exception is raised after pick #1's upsert, pick #1 is already committed → the juror returns to see **1 of 3**.

**Fix:**
1. Replace the per-row upsert loop with a **single bulk `upsert`** of all 3 rows in one PostgREST call (`sb.table("jury_selections").upsert([row1,row2,row3], on_conflict="application_id,application_track,juror_user_id")`), so the 3 picks commit together (removes the partial-write window).
2. Do the "delete removed keys" as a single `.delete().in_(...)`-style call where possible, ordered before the upsert.
3. Wrap the whole write block in try/except → on failure raise `HTTPException(500, detail={"code":"selection_write_failed","message":...})` (JSON, travels inside CORS) instead of letting it bubble to a CORS-less 500 (ties into Issue 6).

**Latent landmine (documented, not changed):** `unassign_juror` (`backend/app/routers/leadership_actions.py:424-495`) cascade-deletes a juror's `jury_selections` for any assignment it removes. This is defensible (a pick on an unassigned app is invalid) and the user did not ask to change unassign; leave as-is but note it in the plan so it isn't mistaken for a regression.

**Success:** Submitting 3 picks always persists all 3 or none; reloading shows exactly what was submitted.

---

## Issue 6 — "Failed to fetch" on Submit picks (CORS-safe errors)

**Where:** `JuryPortal.jsx:214-235 submitPicks` → `juryApi.putSelections` → `api.put("/jury/selections", {selections})` → `PUT /jury/selections`. A backend throw → CORS-less 500 → `api.js` surfaces `network_error` "Failed to fetch" (JuryPortal error branch shows `err.message` verbatim).

**Fix:**
1. (From Issue 5) wrap `put_selections` writes so DB failures return a **JSON `HTTPException`** (which is emitted by `ExceptionMiddleware` *inside* CORS → carries `Access-Control-Allow-Origin`), giving the juror a real message ("Couldn't save your picks — please retry.") instead of "Failed to fetch".
2. **CORS-on-500 safety net:** add a global handler so unexpected 500s still carry CORS headers. Preferred implementation: a `@app.exception_handler(Exception)` that returns a JSON 500 (runs inside the middleware stack, so CORS applies) — or a tiny CORS-echo in `SecurityHeadersMiddleware`. Choose the least-invasive option that is covered by a test and does not change existing 4xx behavior.
3. Confirm the *actual* throw from CloudWatch to ensure it's a data/logic error we've now guarded (not, e.g., a genuine Supabase outage).

**Success:** Submitting picks either succeeds ("Picks submitted ✓") or shows a specific error message; "Failed to fetch" no longer appears for a server-side data error.

---

## Error handling summary

- Jury read/write endpoints never emit a CORS-less 500 for a data-shape or write error: they return either a partial payload (reads) or a JSON error code (writes).
- A global exception handler guarantees CORS headers on any residual 500.
- Frontend error branches already render `err.message`; with JSON errors they now show real text.

## Testing

**Backend (pytest, hermetic `FakeSupabase`):**
- `put_selections`: 3 distinct picks → single bulk upsert persists all 3; simulated write failure → JSON `selection_write_failed` (not an unhandled raise) and no partial rows.
- `fetch_juror_applications`: a malformed application row → row degrades to a minimal record, endpoint returns 200 with the rest of the list.
- CORS-on-500 safety net: a route that raises → response includes `Access-Control-Allow-Origin`.

**Frontend (vitest/RTL):**
- `ManageJurorsDrawer.test.jsx`: suggestion checklist renders pre-checked, unchecking + "Assign selected" calls `assignJurors` per checked app; no "Auto-assign matches" button remains.
- `AdminJury.test.jsx`: header button labeled "Refresh AI suggestions", triggers recompute-for-all (not auto-assign).
- Recolor/regression: `JuryQueue`/`JuryAppView` render without green; submit-error path shows a message (no crash).
- Note: ~existing pre-existing suite failures are unrelated (per project history) — run targeted files with `--no-cov` where needed.

## Deployment

- Backend: `infra/sam/deploy-prod.sh` — **verify `TIR_SUBMISSIONS_CLOSED=true` / `SIP_SUBMISSIONS_CLOSED=true` in `backend/.env.prod` before deploy** (deploy script defaults could reopen intake).
- Frontend: user promotes on Vercel.
- Commit spec + plan + code on `release/sip-launch-v1`; push `HEAD:release` and verify origin tip.

## Out of scope

- No changes to the juror queue/content endpoints beyond recolor.
- No change to unassign cascade behavior (documented only).
- No new migration; `jury_assignments` gains no status column (the recommendations/assignments split already models suggest-vs-confirmed).
- Bulk cross-juror confirmation screen (considered, rejected for scope).
