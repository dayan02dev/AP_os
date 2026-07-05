# Admin Portal — "Rejected Applications" tab

**Date:** 2026-07-06
**Status:** Design (approved approach; pending spec review)
**Surface:** Admin Portal only (`frontend/src/pages/admin/platform/`)

## Goal

Add a 5th admin-portal tab, **Rejected Applications**, that lists the applications an
admin has rejected. Those rejected applications must **no longer appear in the
Applications tab** — they live only in the new tab. This is an organisational
view-split so the active pipeline isn't cluttered with rejected apps.

## Scope (decided)

- **What is "rejected":** only applications with **`status = "rejected"`** (the Gate-1
  admin *reject* outcome). Withdrawn / waitlisted / on_hold are **not** affected — they
  stay in the Applications tab.
- **Tab behaviour:** **read-only browse** — same table, columns, search, track toggle,
  Filters, column sort, Export CSV, and click-into-detail as Applications, but **without
  the batch-assign dropdown and the bulk-decision controls** (they don't apply to an
  already-rejected app).
- **Admin portal only.** No change to the Leadership portal.

## Non-goals

- No "restore / un-reject" action (moving an app back into the pipeline). `rejected` is a
  terminal state; the state machine only allows `rejected → withdrawn`. Out of scope.
- No data migration. The split is purely a runtime filter on `status`; a Gate-1 reject
  moves the app from Applications to Rejected on the next load automatically.
- No change to the Dashboard, the detail view, or the decision flow.

## Current behaviour (baseline)

- Tabs are defined in a `tabs` array in `AdminPortal.jsx` (`dashboard`, `reviewers`,
  `pipeline`, `gate1`); each is rendered by a `page === '<id>'` switch. `AdminTabBar`
  maps over the array, so a new entry renders automatically.
- The **Applications** tab (`AdminPipeline`) loads via `useAdminData("pipeline", {})` →
  `GET /admin/platform/applications` → `admin_query.fetch_pipeline`, which returns **all
  non-draft apps** (rejected included) and excludes hidden/archived in a post-fetch pass.
  Search / track / Filters / sort run client-side over the loaded rows.
- Tab badges come from the already-loaded **stats** data: `appsBadge =
  statsData.totals.apps_submitted`; `statsData.statusCounts` carries a per-status
  breakdown that includes `rejected`.

## Design

### Backend (one additive filter)

1. `GET /admin/platform/applications` (`admin_platform.py::list_pipeline`): add an
   optional query param **`exclude_status: str | None = None`**, threaded into the
   `filters` dict passed to `fetch_pipeline`.
2. `admin_query.fetch_pipeline`: read `exclude_status`; in the **same post-fetch loop
   that already drops hidden/archived rows**, also drop any row whose `status ==
   exclude_status`. This keeps the returned `total` and pagination correct.
   - The existing include-only `status=` filter is untouched.
   - Implemented as a Python post-filter (consistent with hidden/archived), so no change
     to the per-track DB fetch. Fine at current scale (~595 rows, well under `FETCH_CAP`).
   - `exclude_status` is a single status value for now (only `rejected` is used). If a CSV
     is ever needed, split on comma — noted, not built (YAGNI).

The two tabs then request **disjoint** sets:
| Tab | Request | Server returns |
|---|---|---|
| Applications | `?exclude_status=rejected` | all non-draft **except** rejected |
| Rejected Applications | `?status=rejected` | only rejected |

No other caller changes (AdminGate1 uses `?status=evaluated`; Leadership uses its own list).

### Frontend

1. **Parametrise `AdminPipeline`** — `AdminPipeline({ goDetail, decisionMode, baseFilter = {}, readOnly = false, heading })`:
   - `useAdminData("pipeline", baseFilter)` (was `{}`).
   - `heading` overrides the "All applications" title (default keeps current copy).
   - When `readOnly === true`:
     - hide the **bulk-decision floating bar** and any batch/bulk action controls;
     - render the **Batch column as static text** (the batch name), not an assign dropdown;
     - keep search, track toggle, Filters, column sort, Export CSV, and row → detail.
2. **`AdminPortal.jsx`:**
   - Applications render: `<AdminPipeline … baseFilter={{ exclude_status: 'rejected' }} />`.
   - Add tab entry: `{ id: 'rejected', label: 'Rejected Applications', sub: 'REJECTED BY ADMIN', badge: rejectedBadge }`.
   - Render: `{page === 'rejected' && <AdminPipeline goDetail={goDetail} baseFilter={{ status: 'rejected' }} readOnly heading="Rejected applications" />}`.
   - **Badges** (from existing stats, no extra call):
     - `rejectedCount = (statsData?.statusCounts || []).find(s => s.id === 'rejected')?.count ?? 0`
     - `appsBadge = (statsData?.totals?.apps_submitted ?? 0) - rejectedCount`  *(Applications now excludes rejected)*
     - `rejectedBadge = rejectedCount`
3. `adminPlatformApi.getPipeline(params)` forwards params as query string — confirm it
   passes `exclude_status` through (extend if it whitelists keys).

### Data flow

```
Applications tab  → useAdminData('pipeline', {exclude_status:'rejected'}) → GET …/applications?exclude_status=rejected
Rejected tab      → useAdminData('pipeline', {status:'rejected'})         → GET …/applications?status=rejected
Both badges       ← useAdminData('stats').{totals.apps_submitted, statusCounts[rejected]}
```

## Edge cases

- An app that is both `rejected` **and** hidden/archived stays excluded from Applications
  (both filters apply) and appears in Rejected only if `include_hidden`/`include_archived`
  are set there (default: hidden ones are still hidden in the Rejected tab too — same rule).
- Rejecting an app in Gate-1 moves it across tabs on the next data load; the Applications
  badge decrements and the Rejected badge increments (both recomputed from stats).
- Empty Rejected tab → same empty-state the pipeline table already shows.
- The Applications Filters "Status" dropdown still lists `rejected`; since rejected rows
  are excluded server-side, selecting it yields an empty list. Hide the `rejected` option
  in the Applications tab (and, in the Rejected tab, the status filter is redundant since
  it's fixed to `rejected`) — small polish, include in the plan.

## Testing

**Backend** (`backend/tests/test_admin_platform.py`):
- `fetch_pipeline({exclude_status:'rejected'})` omits rejected rows and `total` reflects it.
- `fetch_pipeline({status:'rejected'})` returns only rejected rows.
- endpoint forwards `exclude_status` to the filter dict.

**Frontend** (Vitest, `pages/admin/platform/__tests__/`):
- `AdminPortal` renders 5 tabs; `appsBadge = apps_submitted − rejectedCount`; `rejectedBadge = rejectedCount`.
- `AdminPipeline readOnly` hides the batch-assign dropdown + bulk-decision bar and renders the batch name as text; still shows search / Export.
- Applications sends `exclude_status=rejected`; Rejected sends `status=rejected`.

## Files touched

- `backend/app/routers/admin_platform.py` — `exclude_status` query param.
- `backend/app/services/admin_query.py` — honor `exclude_status` in `fetch_pipeline`.
- `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` — `baseFilter` / `readOnly` / `heading` props.
- `frontend/src/pages/admin/platform/AdminPortal.jsx` — new tab, render branch, badge math, Applications `baseFilter`.
- Tests as above.
