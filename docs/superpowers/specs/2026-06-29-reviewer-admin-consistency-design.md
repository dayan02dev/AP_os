# Reviewer + Admin consistency changes — design spec

**Date:** 2026-06-29
**Surfaces:** Reviewer portal, Admin portal, Leadership (shared renderer)
**Scope:** Frontend + backend. Backend SAM deploy required (changes 4 & 5). No DB migration.

## Goal

Five user-requested changes to the reviewer and admin surfaces:

1. **`SIP-` → `VIP-` in the reviewer** — display IDs still show the raw `SIP-…` code in the CSV export and the queue table; relabel to `VIP-…` everywhere on the reviewer surface.
2. **Reviewer queue filters** — the My-Queue filter+clear bar already exists in code; it isn't visible on prod because the live build is stale. No code change; it surfaces on deploy. (AI-score filter parity with leadership is explicitly deferred / out of scope.)
3. **Remove the "Due" column** from the reviewer My-Queue table and the CSV export.
4. **Reviewer "edit anytime"** — remove the 60-minute review edit lock (frontend gate + backend 423) so a reviewer can re-open and edit a submitted review at any time.
5. **Consistent full-application view** — make the reviewer and admin "view full application" render exactly like leadership (all fields, files/PPT as click-time signed links, video/Google-Drive as hyperlinks, declarations as the four checkboxes), by reusing leadership's renderer.

## Current state (grounding)

- **`lib/trackLabel.js`** exports `relabelDisplayId(id)` → replaces a leading `SIP-` with `VIP-` (display-only; never for API/routes). Leadership + admin pipeline already use it; the reviewer does not.
- **Reviewer CSV** (`ReviewerPortal.jsx:78-112`): builds rows from `reviewerApi.getQueue()`; ID column uses raw `s.applicationId`; Track column already maps `tir→TIR else VIP`; has a `Due` column (`s.due`).
- **Reviewer queue** (`ReviewerQueue.jsx`): renders `.lp-filter-area` (search · TIR/VIP track · STATUS/STAGE/INDUSTRY · `Clear filters` when `hasFilters`) — present since the original v2 build (`96d338e`), styled under `.rv-portal` in `reviewer-portal.css` (the shell root is `.rv-portal os-shell`). Table has a `Due` column (header `:184`, cell `:242`) and shows raw `s.applicationId` at `:194` (project sub-label) and `:243` (ID column).
- **Reviewer history** (`ReviewerHistory.jsx:65-66`): `editable = editWindowExpiresAt > now` — the 60-min gate.
- **Backend review lock** (`reviewer.py`): submit stamps `locked_at = now + 60min` (`:363`); `PATCH /reviews/{id}` returns **423** when `datetime.now(UTC) > locked_at` (`:513-519`).
- **Full-application views (change 5):**
  - **Leadership (target):** `review/ApplicationTab.jsx` → `SectionBlock` → `QuestionBlock` → `answers/*` renderers, driven by `applicationSchemas.js` (`schemaFor(track)`) reading `application[q.key]`. `FileGridAnswer.jsx:18,71` imports `leadershipApi` directly and calls `GET /leadership/applications/{id}/files/signed-url` (click-time signing, allow-listed via `applications_query.collect_application_file_paths`). `VideoAnswer` embeds Loom/YouTube/Vimeo, else a link card (covers Google Drive). `DeclarationAnswer` reads the 4 `declaration_*` booleans.
  - **Reviewer:** `ReviewerEval.jsx` local `FullApplicationView` (lines 103-188) renders `content.sections[]` (server-pre-rendered strings via `review_presenter.build_sections()`) + `content.attachments[]` (URLs pre-signed at fetch, 120s TTL). **Lossy**: drops file arrays, captable/team, several long-text fields, and `declaration_newsletter`; videos shown as bare text. The content payload has **no raw `application` object**.
  - **Admin:** `admin/platform/screens/FullApplicationView.jsx` is **entirely placeholder** (static `APP_DETAIL` fake data, `<PreviewBadge>`); opened from `AdminDetail.jsx`. `adaptDetail()` in `adminDataAdapter.js` receives `application: app_row` from the backend but does **not** pass it through to the adapted `s`.
  - **RBAC:** `view_app_detail` = leadership + admin (so admin can use leadership's signed-URL endpoint); reviewers hold only `view_assigned_apps` (so they need their own endpoint with an assignment check).

## Change 1 + Change 3 (IDs): relabel `SIP-` → `VIP-` on the reviewer

Apply `relabelDisplayId()` (import from `lib/trackLabel.js`) to every reviewer ID display:
- `ReviewerPortal.jsx` CSV: `relabelDisplayId(s.applicationId)` for the ID column.
- `ReviewerQueue.jsx`: the project sub-label (`:194`) and the ID column (`:243`).
- `ReviewerEval.jsx` / `ReviewerHistory.jsx`: any raw `applicationId`/`appId` display → relabel.

Track column / labels already say VIP; no change there. Frontend-only.

## Change 3 (Due): remove the column

- `ReviewerQueue.jsx`: remove the `Due` `<th>` (`:184`) and the `Due` `<td>` (`:242`); drop the now-unused `fmtDue` helper; adjust the table's `colSpan` (currently 9 → 8) on the loading/error/empty rows.
- `ReviewerPortal.jsx` CSV: remove `"Due"` from `headers` and `s.due` from each row.

Frontend-only.

## Change 2 (filters): no code change

The filter+clear bar already exists and is correct. It surfaces once this batch deploys (prod reviewer build is stale). No file changes. The AI-score filter (leadership parity) is deferred — not in scope for this spec.

## Change 4 (edit anytime): remove the 60-min lock

- **Backend** `reviewer.py` `PATCH /reviews/{id}`: remove the lock-expiry rejection (the `if datetime.now(UTC) > locked_at: return 423` block, ~`:513-519`). A submitted review may be PATCHed at any time. Leave `locked_at` stamping on submit as-is (harmless; still returned as `editWindowExpiresAt`) — removing the *enforcement* is sufficient. Keep all other PATCH validation (score ranges, declaration guard, etc.).
- **Frontend** `ReviewerHistory.jsx`: `editable` is always `true`; the "✎ Edit" button is always enabled (title "Edit this evaluation").
- **Frontend** `ReviewerEval.jsx`: remove the lock countdown + "edit window closed / Re-open to edit (expired)" UI so the form is always editable for the reviewer's own submitted review. (The `editWindowExpiresAt`/countdown state and the `expired` gating are removed; "Re-open to edit" simply re-enables the form.)

Requires a backend SAM deploy.

## Change 5 (consistent full-application view)

Reuse leadership's schema-driven renderer on all three surfaces via a shared component and a per-surface signed-URL function.

**a. Make `FileGridAnswer` signing pluggable (prop-thread):**
- `answers/FileGridAnswer.jsx`: accept a `signedUrl` prop `(applicationId, storagePath) => Promise<{url}>`; remove the direct `leadershipApi` import; call `signedUrl(...)`.
- `QuestionBlock.jsx`, `SectionBlock.jsx`, `ApplicationTab.jsx`: accept and thread `signedUrl` down to `FileGridAnswer`.

**b. New shared component** `frontend/src/components/FullApplication.jsx`:
```jsx
import { schemaFor } from "../pages/leadership/applicationSchemas.js";
import ApplicationTab from "../pages/leadership/review/ApplicationTab.jsx";
export default function FullApplication({ track, application, applicationId, signedUrl }) {
  return (
    <ApplicationTab
      schema={schemaFor(track)}
      application={application}
      applicationId={applicationId}
      signedUrl={signedUrl}
    />
  );
}
```

**c. Leadership:** `ReviewApplicationPage.jsx` passes `signedUrl={(id, path) => leadershipApi.fileSignedUrl(id, path)}` into `ApplicationTab` — preserves today's behavior.

**d. Admin (no backend change):**
- `adminDataAdapter.js` `adaptDetail()`: include `application: d.application` in the returned object.
- `AdminDetail.jsx`: render `<FullApplication track={track} application={s.application} applicationId={s.id} signedUrl={(id,path)=>leadershipApi.fileSignedUrl(id,path)} />` in place of the placeholder `FullApplicationView`. (Admin holds `view_app_detail`, so the leadership signed-URL endpoint authorizes.)
- `admin/platform/screens/FullApplicationView.jsx`: removed (or emptied) — no longer used.

**e. Reviewer (backend changes required):**
- **Backend** `reviewer.py`: add `application: app_row` to the `GET /reviewer/applications/{track}/{id}/content` response (the row is already in scope).
- **Backend** `reviewer.py`: add `GET /reviewer/applications/{track}/{id}/files/signed-url?storage_path=…`, guarded by `view_assigned_apps` **and** an assignment-ownership check (reviewer must be assigned to this application+track — reuse the same guard the content endpoint uses); allow-list via `applications_query.collect_application_file_paths(track, app_row)`; sign with a 120s TTL; return `{url, expires_in}`. (~30 lines, mirrors the leadership endpoint.)
- **Frontend** `lib/reviewerApi.js`: add `fileSignedUrl(track, id, storagePath)` calling the new endpoint.
- **Frontend** `ReviewerEval.jsx`: replace the local `FullApplicationView` (lines 103-188) with `<FullApplication track={track} application={content.application} applicationId={appId} signedUrl={(id,path)=>reviewerApi.fileSignedUrl(track, id, path)} />`. (The lossy server-rendered `sections`/`attachments` are no longer used for the full-app view; the eval scoring form is unchanged.)

This also fixes the reviewer's 120s-TTL stale-link problem (now signed at click time).

Requires a backend SAM deploy + frontend deploy.

## Testing

- New/updated frontend unit tests:
  - `relabelDisplayId` applied in the reviewer CSV + queue (assert a `SIP-…` row renders `VIP-…`).
  - `ReviewerQueue` no longer renders a "Due" header.
  - `ReviewerHistory` "Edit" button enabled even when `editWindowExpiresAt` is in the past.
  - `FullApplication` renders schema sections + calls the injected `signedUrl` for file fields (mock).
- Backend tests: `PATCH /reviews/{id}` succeeds after `locked_at` is in the past (no 423); the new reviewer signed-url endpoint authorizes an assigned reviewer and 404/403s an unassigned one.
- Full suites: `cd frontend && npx vitest run` green; `cd backend && pytest` (note 19 pre-existing unrelated failures per repo memory).
- Build: `cd frontend && npm run build` clean.
- Manual visual: reviewer + admin "view full application" matches leadership (fields, file links open, video/Drive hyperlinks, 4 declaration checkboxes); reviewer queue shows VIP IDs, no Due column; reviewer can edit a >60-min-old submitted review.

## Deploy

- **Frontend-only** (changes 1, 3; change 2 surfaces): Vercel promote.
- **Backend (SAM) + frontend** (changes 4, 5): SAM-build + `deploy-prod.sh` from this worktree (**grep `.env.prod` for `TIR_/SIP_SUBMISSIONS_CLOSED=true` first** — must stay closed), then push `release/sip-launch-v1`, then user Vercel-promotes. Backend must deploy before/with the frontend (reviewer full-app view depends on the new `application` key + signed-url endpoint).

## Out of scope / non-goals

- No DB migration.
- AI-score filter on the reviewer queue (deferred).
- Leadership's full-app view behavior is unchanged (only made reusable).
- The reviewer eval scoring form, queue data, and admin pipeline logic are unchanged.
- Backend `leadershipApi.unassignReviewer` and other endpoints untouched.

## Files touched (summary)

**Frontend:** `pages/reviewer/v2/ReviewerPortal.jsx`, `ReviewerQueue.jsx`, `ReviewerHistory.jsx`, `ReviewerEval.jsx`; `lib/reviewerApi.js`; `components/FullApplication.jsx` (new); `pages/leadership/review/ApplicationTab.jsx`, `SectionBlock.jsx`, `QuestionBlock.jsx`, `answers/FileGridAnswer.jsx`; `pages/leadership/ReviewApplicationPage.jsx`; `pages/admin/platform/screens/AdminDetail.jsx`, `FullApplicationView.jsx` (removed); `lib/adminDataAdapter.js`; new tests.

**Backend:** `app/routers/reviewer.py` (remove 423 lock; add `application` to content; new signed-url endpoint); tests.
