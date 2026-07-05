# Test Cases — Admin: Assign Batch to a Reviewer

**Feature:** Admin Portal → Reviewers roster → assign/unassign a batch to a reviewer.
**Endpoint:** `POST /admin/platform/batches/{batch_id}/reviewers` → `admin_query.assign_reviewers_to_batch`
(plus the `POST /admin/platform/batches/{batch_id}/applications` fan-out).
**Fix under test:** `4f4a82f` — paginated dedup read + idempotent upsert.

## Background (what broke and why)

Assigning a batch to a reviewer returned **"Request failed"** (HTTP 500). Root cause: the
dedup read used `reviewer_assignments.select("*")`, which PostgREST caps at ~1000 rows. Prod had
**2,903** assignment rows, so the "already assigned" snapshot missed rows beyond the first 1,000.
The code then re-inserted an existing `(application_id, application_track, reviewer_user_id)`
triple → unique-violation **`23505`** → unhandled `APIError` → 500.

The fix (a) reads existing assignments with a **paginated** query so it sees the whole table, and
(b) inserts with **`upsert(... ignore_duplicates=True)`** (ON CONFLICT DO NOTHING) so a duplicate
can never 500 — even under a race.

## Environment

- Frontend: `https://apply.artpark.info` — sign in at `/apply/signin`, land on `/admin`.
- Admin test login: `udayanpawar03@gmail.com` (admin role).
- API: `api.artpark.info` (stack `artpark-eir-api-production`, ap-south-1).
- Logs: CloudWatch group `/aws/lambda/artpark-eir-api-production`.

## Preconditions

- Signed in as an admin.
- At least one batch exists with applications mapped to it (Admin → Applications → assign to a batch).
- At least one reviewer in the roster. For the regression case (TC3), pick a reviewer who **already
  holds many assignments** (e.g. Abhijit / Nirav with 300+), since the bug only appears once the
  table is past the 1,000-row cap.

## Test Cases

| # | Title | Steps | Expected result |
|---|-------|-------|-----------------|
| **TC1** | Assign a batch to a reviewer (happy path — the reported bug) | Reviewers roster → on a reviewer row open the `+ ▾` batch dropdown → pick a batch (e.g. Batch A) | **No "Request failed."** Row updates to "N of Batch A" with a Batch A chip; Progress shows `0 / N`. API `200` with `{created: N, reviewers: 1, applications: N}`. |
| **TC2** | Idempotent re-assign | Assign the **same** batch to the **same** reviewer again | No error. `created: 0`, roster unchanged, **no duplicate rows** in `reviewer_assignments`. |
| **TC3** | Regression: reviewer already assigned beyond the row cap | Pick a reviewer with 300+ existing assignments; assign a batch whose apps partly overlap what they already have | `200`, **no 500 / no 23505**. Only genuinely-new triples created; overlapping ones skipped. (This is exactly what failed pre-fix.) |
| **TC4** | Fan-out: add apps to a batch that already has reviewers | Admin → Applications → select apps → assign to a batch that already has reviewers | `200`. New `reviewer_assignments` created for (new apps × batch reviewers), existing skipped; **no 500**. |
| **TC5** | Unassign reviewer from a batch | In the roster, click `×` on a reviewer's batch chip | `200`; assignments removed for that batch's apps **except** any with a submitted review. |
| **TC6a** | Unknown batch | `POST /admin/platform/batches/<bad-uuid>/reviewers` | `404 {"code":"batch_not_found"}`. |
| **TC6b** | Capability guard | Same call as a **reviewer**-role user | `403`. |
| **TC7** | Log verification | After TC1–TC4, check CloudWatch for the last few minutes | **No** `23505` / `duplicate key` / `mangum "An error occurred"` on `/batches/*/reviewers` or `/applications`; `request.end` `status_code: 200`. |

## Automated coverage (backend, pytest)

- `backend/tests/test_reviewer_assign_dedup.py` — a fake that models both the **1000-row cap** and
  the **unique constraint**; asserts the assign does not raise, creates only the new triple, and
  never duplicates (covers TC1–TC3). Fails on pre-fix code, passes after.
- `backend/tests/test_admin_platform.py::test_batch_reviewers_assign_*` — N×M creation, dedup of an
  existing triple, `404` unknown batch, `403` capability (TC1, TC2, TC6).

Run: `cd backend && .venv/bin/python -m pytest tests/test_reviewer_assign_dedup.py tests/test_admin_platform.py -q --no-cov`
