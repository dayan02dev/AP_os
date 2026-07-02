# Admin batch "Unassign" fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin pipeline Batch column's "Unassigned" option actually remove an application from its batch (per-row and bulk).

**Architecture:** Add a batch-agnostic `POST /admin/platform/batches/unassign` endpoint that deletes the app's `application_batches` row (unlink only — reviewer assignments/reviews untouched, matching `delete_batch` and cross-batch-move behavior). Wire both pipeline dropdowns' "Unassigned" branch to a new `adminPlatformApi.unassignBatch(items)` client wrapper.

**Tech Stack:** FastAPI + Pydantic (backend), pytest with a fake-Supabase harness; React + Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-07-02-admin-batch-unassign-fix-design.md`

**Worktree:** all work happens in `.claude/worktrees/fix-admin-unassign` (branch `fix/admin-unassign`, off `origin/release/sip-launch-v1` @ `d66da91`). Do not push or deploy without explicit go. Commits carry **no** AI trailer.

**Test commands (note the coverage gate):**
- Backend single file: `cd backend && python -m pytest tests/test_admin_platform.py --no-cov -q` (the repo's `addopts` sets `--cov-fail-under=70`, so a single-file run needs `--no-cov`).
- Frontend single file: `cd frontend && npx vitest run <path>`

## File Structure

- Modify: `backend/app/routers/admin_platform.py` — add `unassign_applications` route (reuses the existing `BatchAssign` model, `get_admin_client`, `write_audit`, `actor_role_of` — all already imported).
- Modify: `backend/tests/test_admin_platform.py` — add unassign tests (fake harness already supports real deletes with eq filters, lines 78-92).
- Modify: `frontend/src/lib/adminPlatformApi.js` — add `unassignBatch(items)`.
- Modify: `frontend/src/lib/__tests__/adminPlatformApi.test.js` — add wrapper test.
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` — add `val === 'Unassigned'` branch to `changeIndividualBatch` (per-row) and `applyBatchToSelected` (bulk).
- Create: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx` — per-row + bulk wiring tests (mirrors `AdminPipeline.batchDelete.test.jsx`).

No migration (no schema change).

---

### Task 1: Backend — `POST /batches/unassign` endpoint

**Files:**
- Modify: `backend/app/routers/admin_platform.py` (add route after `assign_applications`, which ends ~line 451)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_admin_platform.py` (after `test_batch_assign_unknown_batch_404`, ~line 492). These reuse the file's existing helpers `_install_db`, `_override_user`, `get_current_user`, `app`, and the `client` / `_clear_overrides` fixtures.

```python
def test_batch_unassign_removes_link_only(client, monkeypatch, _clear_overrides):
    """POST /batches/unassign deletes the app's application_batches row but
    leaves reviewer_assignments untouched (unlink-only semantics)."""
    fake = _install_db(monkeypatch, {
        "application_batches": [
            {"application_id": "app-1", "application_track": "tir", "batch_id": "b1"},
            {"application_id": "app-2", "application_track": "sip", "batch_id": "b1"},
        ],
        "reviewer_assignments": [
            {"application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
        ],
    })
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.post("/admin/platform/batches/unassign",
                    json={"items": [{"track": "tir", "application_id": "app-1"}]})
    assert r.status_code == 200
    assert r.json()["removed"] == 1
    # app-1 link gone, app-2 link kept
    links = fake.tables["application_batches"]
    assert not any(l["application_id"] == "app-1" for l in links)
    assert any(l["application_id"] == "app-2" for l in links)
    # reviewer assignment untouched
    assert len(fake.tables["reviewer_assignments"]) == 1


def test_batch_unassign_is_idempotent(client, monkeypatch, _clear_overrides):
    """Unassigning an app that is not in any batch removes 0 rows (no error)."""
    _install_db(monkeypatch, {"application_batches": []})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/batches/unassign",
                    json={"items": [{"track": "tir", "application_id": "ghost"}]})
    assert r.status_code == 200
    assert r.json()["removed"] == 0


def test_batch_unassign_requires_capability(client, monkeypatch, _clear_overrides):
    """A reviewer (no manage_batches) is refused."""
    _install_db(monkeypatch, {"application_batches": []})
    app.dependency_overrides[get_current_user] = _override_user("rev-1", roles=["reviewer"])
    r = client.post("/admin/platform/batches/unassign",
                    json={"items": [{"track": "tir", "application_id": "app-1"}]})
    assert r.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_admin_platform.py -k unassign --no-cov -q`
Expected: FAIL — the two behavior tests 404/405 (route not defined); capability test may 404. All three fail because `/batches/unassign` does not exist yet.

- [ ] **Step 3: Implement the endpoint**

In `backend/app/routers/admin_platform.py`, immediately after the `assign_applications` function (ends ~line 451, before `@router.post("/batches/{batch_id}/reviewers"`), add:

```python
@router.post(
    "/batches/unassign",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def unassign_applications(
    body: BatchAssign,
    user: dict = Depends(get_current_user),
) -> dict:
    """Remove applications from whatever batch they are in (unlink only).

    Deletes each app's `application_batches` row. Reviewer assignments and
    reviews are left untouched — consistent with `delete_batch` and cross-batch
    moves (batch membership and scored work are decoupled). Idempotent: an app
    that is already unbatched contributes 0 to `removed`.
    """
    sb = get_admin_client()
    removed = 0
    for item in body.items:
        res = (
            sb.table("application_batches")
            .delete()
            .eq("application_id", item.application_id)
            .eq("application_track", item.track)
            .execute()
        )
        removed += len(res.data or [])
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_applications_unassigned",
        target_table="application_batches",
        target_id=None,
        after={"removed": removed, "count": len(body.items)},
    )
    return {"removed": removed}
```

> ⚠️ Route ordering: this MUST be declared before any `"/batches/{batch_id}/..."` route would match `unassign` as a `batch_id`. It is a POST to `/batches/unassign`; the existing `/batches/{batch_id}/applications` and `/batches/{batch_id}/reviewers` are also POSTs but with a longer path, so no collision — but placing `unassign` adjacent to `assign_applications` (both before the `{batch_id}` reviewer routes) keeps it clear. Verify with the test run in Step 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_admin_platform.py -k unassign --no-cov -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Run the full admin_platform suite (no regressions)**

Run: `cd backend && python -m pytest tests/test_admin_platform.py --no-cov -q`
Expected: PASS (all existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/admin_platform.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): add POST /batches/unassign to remove apps from their batch"
```

---

### Task 2: Frontend — `adminPlatformApi.unassignBatch`

**Files:**
- Modify: `frontend/src/lib/adminPlatformApi.js` (add near `assignBatch`, ~line 47-48)
- Test: `frontend/src/lib/__tests__/adminPlatformApi.test.js`

- [ ] **Step 1: Write the failing test**

Add inside the `describe("adminPlatformApi seam", ...)` block in `frontend/src/lib/__tests__/adminPlatformApi.test.js`:

```javascript
  it("unassignBatch → POST /admin/platform/batches/unassign with items", () => {
    const items = [{ track: "tir", application_id: "app-1" }];
    adminPlatformApi.unassignBatch(items);
    expect(api.post).toHaveBeenCalledWith("/admin/platform/batches/unassign", { items });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminPlatformApi.test.js`
Expected: FAIL — `adminPlatformApi.unassignBatch is not a function`.

- [ ] **Step 3: Implement the wrapper**

In `frontend/src/lib/adminPlatformApi.js`, add directly after the `assignBatch` entry (currently lines 47-48):

```javascript
  unassignBatch: (items) =>
    api.post(`/admin/platform/batches/unassign`, { items }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/__tests__/adminPlatformApi.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/adminPlatformApi.js frontend/src/lib/__tests__/adminPlatformApi.test.js
git commit -m "feat(admin): add unassignBatch API wrapper"
```

---

### Task 3: Frontend — wire "Unassigned" in both pipeline dropdowns

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` (`applyBatchToSelected` ~line 392, `changeIndividualBatch` ~line 438)
- Test: `frontend/src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx` (mirrors `AdminPipeline.batchDelete.test.jsx`; adds `unassignBatch` to the mocked client):

```jsx
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    createBatch: vi.fn().mockResolvedValue({ id: "b-new" }),
    renameBatch: vi.fn().mockResolvedValue({}),
    deleteBatch: vi.fn().mockResolvedValue({ ok: true }),
    assignBatch: vi.fn().mockResolvedValue({ assigned: 1 }),
    unassignBatch: vi.fn().mockResolvedValue({ removed: 1 }),
  },
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div data-testid="preview-badge">Preview</div>,
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { AdminPipeline } from "../screens/AdminPipeline";

const PIPELINE = {
  startups: [
    { id: "app-1", name: "Acme", founders: ["A"], domain: "Robotics",
      chip: "NEW", batch: "Batch A", ai: { overall: 7 }, status: "submitted",
      track: "tir", hidden: false, archived: false, sub: "TIR-1" },
  ],
  total: 1,
};
const BATCHES = { batches: [{ id: "b-1", name: "Batch A" }] };

beforeEach(() => {
  vi.clearAllMocks();
  useAdminData.mockImplementation((kind) => {
    if (kind === "batches")
      return { data: BATCHES, loading: false, error: null, reload: vi.fn() };
    return { data: PIPELINE, loading: false, error: null, reload: vi.fn() };
  });
});

describe("AdminPipeline unassign (batch → Unassigned)", () => {
  it("per-row: selecting Unassigned calls unassignBatch for that app", async () => {
    render(<AdminPipeline decisionMode="default" />);
    // The per-row Batch dropdown is the only <select> when no rows are selected.
    const select = screen.getByDisplayValue("Batch A");
    fireEvent.change(select, { target: { value: "Unassigned" } });
    await waitFor(() => {
      expect(adminPlatformApi.unassignBatch).toHaveBeenCalledWith([
        { track: "tir", application_id: "app-1" },
      ]);
    });
  });

  it("bulk: selecting Unassigned in the bulk bar calls unassignBatch for selected rows", async () => {
    render(<AdminPipeline decisionMode="default" />);
    // Select the row (its checkbox) to reveal the bulk action bar.
    const rowCheckbox = screen.getByLabelText("Select Acme");
    fireEvent.click(rowCheckbox);
    // The bulk "Assign batch..." select appears; switch it to Unassigned.
    const bulkSelect = screen.getByDisplayValue("Assign batch...");
    fireEvent.change(bulkSelect, { target: { value: "Unassigned" } });
    await waitFor(() => {
      expect(adminPlatformApi.unassignBatch).toHaveBeenCalledWith([
        { track: "tir", application_id: "app-1" },
      ]);
    });
  });
});
```

> Note on selectors: the per-row checkbox needs an accessible name. If `getByLabelText("Select Acme")` fails, inspect the checkbox in `AdminPipeline.jsx` (~line 1024) — it currently has `onChange={() => toggleSelect(s.id)}` with no label. In that case, in the same task add `aria-label={`Select ${s.name}`}` to that `<input type="checkbox">` so the test (and screen-reader users) can target it. This is the only DOM addition permitted here; do not restyle.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx`
Expected: FAIL — `unassignBatch` not called (per-row silently returns; bulk shows "Batch not found").

- [ ] **Step 3: Implement the two handler branches**

In `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`:

(a) In `applyBatchToSelected` (starts line 392), add this block immediately after `if (busy || selectedRows.length === 0) return;` (line 393), BEFORE the `let targetBatchId = null;` line:

```javascript
    if (batchNameOrNew === 'Unassigned') {
      setBusy(true);
      setNote(null);
      try {
        const resp = await adminPlatformApi.unassignBatch(
          selectedRows.map((r) => ({ track: r.track, application_id: r.id })),
        );
        await finishBulk({ kind: 'ok', text: `Removed ${resp?.removed ?? selectedRows.length} from their batch.` });
      } catch (e) {
        setNote({ kind: 'error', text: `Batch unassign failed: ${e?.message || e}` });
      } finally {
        setBusy(false);
      }
      return;
    }
```

(b) In `changeIndividualBatch` (starts line 438), add this branch at the very top of the function, BEFORE `if (val === 'new') {` (line 439):

```javascript
    if (val === 'Unassigned') {
      try {
        await adminPlatformApi.unassignBatch([
          { track: startup.track, application_id: startup.id },
        ]);
        await reload();
        setNote({ kind: 'ok', text: 'Removed from batch.' });
      } catch (e) {
        setNote({ kind: 'error', text: `Batch unassign failed: ${e?.message || e}` });
      }
      return;
    }
```

(c) If Step 1's `getByLabelText("Select Acme")` required it, add `aria-label={`Select ${s.name}`}` to the per-row select checkbox `<input type="checkbox">` (~line 1024).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the sibling batch test (no regression)**

Run: `cd frontend && npx vitest run src/pages/admin/platform/__tests__/AdminPipeline.batchDelete.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminPipeline.jsx frontend/src/pages/admin/platform/__tests__/AdminPipeline.unassign.test.jsx
git commit -m "fix(admin): wire batch 'Unassigned' option to unassignBatch (per-row + bulk)"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && python -m pytest -q` (full run keeps coverage gate; must stay ≥70%)
Expected: PASS, coverage gate satisfied.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 3: Manual reasoning check against the bug**

Confirm by re-reading the two handlers that:
- Per-row: choosing "Unassigned" on a batched app now calls `unassignBatch` and reloads (no more silent return at the old `if (!found) return;`).
- Bulk: choosing "Unassigned" now calls `unassignBatch` (no more "Batch not found: Unassigned").

- [ ] **Step 4: Report ready-for-review**

Do NOT push or deploy. Summarize the diff and await explicit go. Before any eventual push: `git fetch origin release/sip-launch-v1` and reconcile onto the latest tip (the branch moves under us), then push per the user's instruction.

---

## Self-Review

**Spec coverage:**
- New backend unlink endpoint → Task 1. ✓
- Unlink-only semantics (reviewer_assignments untouched) → asserted in Task 1 Step 1 (`test_batch_unassign_removes_link_only`). ✓
- Idempotent → Task 1 (`test_batch_unassign_is_idempotent`). ✓
- Capability guard → Task 1 (`test_batch_unassign_requires_capability`). ✓
- `unassignBatch` client wrapper → Task 2. ✓
- Per-row + bulk wiring → Task 3. ✓
- No migration → stated; no task needed. ✓
- Isolation rules → header + Task 4 Step 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type/name consistency:** `unassignBatch(items)` posts `{ items }` (Task 2) and is called with `[{ track, application_id }]` in Task 3 and asserted identically in tests. Endpoint consumes `BatchAssign` = `{ items: [{ track, application_id }] }`, matching the client payload. Response `{ removed }` read as `resp?.removed` in Task 3. Consistent. ✓
