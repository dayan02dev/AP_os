# Edit-After-Submit: File Re-uploads + SIP Verify + Prod Cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let applicants replace/add/remove their application file fields on a *submitted* application during the edit window (both TIR + VIP, persisted to the DB), verify the already-built VIP text edit live, and roll the whole feature to production.

**Architecture:** A shared `submitted_edit` helper centralizes the owner+status+window guard and the "stamp edited + re-screen" side effect. The four file routers gain an optional `application_id` query param: when present they operate on that submitted row through the guard (reusing all existing storage logic); when absent they keep today's draft behavior. The frontend unlocks file fields (declarations stay locked) and threads the submitted app id into the file inputs so they hit the by-id path.

**Tech Stack:** FastAPI + Supabase (service-role) on Lambda; React 18 + Vite; pytest + vitest; SQS AI screener.

---

## File Structure

**Backend:**
- Create: `backend/app/services/submitted_edit.py` — `EditWindowError`, `load_editable_app()`, `mark_edited()`.
- Modify: `backend/app/routers/evidence_files.py`, `milestone_files.py`, `sip_evidence_files.py`, `sip_milestone_files.py` — add `application_id` path to upload + delete.
- Tests: `backend/tests/test_submitted_edit.py`, `backend/tests/test_evidence_files_edit.py` (+ mirror tests for the other 3 routers).

**Frontend:**
- Modify: `frontend/src/inputs.jsx` (EvidenceFilesInput, MilestoneFilesInput), `frontend/src/inputs_sip.jsx` (SingleEvidenceInput, MultiEvidenceInput, SipMilestoneFilesInput) — accept `applicationId` prop, append `application_id` query param.
- Modify: `frontend/src/screens.jsx` — `EditableAnswer` file mode + unlock file kinds; thread submitted app id.

**Env note (for implementers):** Work in `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/new_submission_edit`. Backend: `source /Users/apple/Desktop/Final_AP_os/backend/.venv/bin/activate`, run pytest from `backend/` with `--no-cov`. Frontend: `node_modules` is symlinked — do NOT `npm install`; use `npm run build` + `npm test`. The full backend suite has **19 known baseline failures** — only care about your new tests + no NEW regressions.

---

## Phase A — Backend

### Task 1: Shared `submitted_edit` helper

**Files:** Create `backend/app/services/submitted_edit.py`; Test `backend/tests/test_submitted_edit.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_submitted_edit.py
import pytest
from app.services import submitted_edit as se


class _FakeTable:
    def __init__(self, row): self._row = row
    def select(self, *_): return self
    def eq(self, *_): return self
    def limit(self, *_): return self
    def update(self, patch): self._row.update(patch); return self
    def execute(self):
        class R: data = [self._row] if self._row else []
        return R()


class _FakeClient:
    def __init__(self, row): self._t = _FakeTable(row)
    def table(self, *_): return self._t


def _patch_client(monkeypatch, row):
    monkeypatch.setattr(se, "get_admin_client", lambda: _FakeClient(row))


def test_load_editable_app_ok(monkeypatch):
    row = {"id": "a1", "user_id": "u1", "status": "submitted"}
    _patch_client(monkeypatch, row)
    monkeypatch.setattr(se, "is_edit_open", lambda track: True)
    got = se.load_editable_app("tir_applications", "a1", "u1", "id, user_id, status")
    assert got["id"] == "a1"


def test_load_editable_app_wrong_owner_404(monkeypatch):
    _patch_client(monkeypatch, {"id": "a1", "user_id": "other", "status": "submitted"})
    monkeypatch.setattr(se, "is_edit_open", lambda track: True)
    with pytest.raises(se.EditWindowError) as e:
        se.load_editable_app("tir_applications", "a1", "u1", "id, user_id, status")
    assert e.value.status_code == 404


def test_load_editable_app_bad_status_409(monkeypatch):
    _patch_client(monkeypatch, {"id": "a1", "user_id": "u1", "status": "draft"})
    monkeypatch.setattr(se, "is_edit_open", lambda track: True)
    with pytest.raises(se.EditWindowError) as e:
        se.load_editable_app("tir_applications", "a1", "u1", "id, user_id, status")
    assert e.value.status_code == 409


def test_load_editable_app_window_closed_403(monkeypatch):
    _patch_client(monkeypatch, {"id": "a1", "user_id": "u1", "status": "submitted"})
    monkeypatch.setattr(se, "is_edit_open", lambda track: False)
    with pytest.raises(se.EditWindowError) as e:
        se.load_editable_app("sip_applications", "a1", "u1", "id, user_id, status")
    assert e.value.status_code == 403


def test_mark_edited_stamps_and_publishes(monkeypatch):
    row = {"id": "a1"}
    _patch_client(monkeypatch, row)
    published = []
    monkeypatch.setattr(se.sqs_publisher, "publish", lambda i, t: published.append((i, t)))
    se.mark_edited("tir_applications", "a1", "tir")
    assert row["edited_after_submit"] is True
    assert row["last_edited_at"] is not None
    assert published == [("a1", "tir")]
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_submitted_edit.py -v --no-cov`
Expected: FAIL — `app.services.submitted_edit` missing.

- [ ] **Step 3: Implement the helper**

```python
# backend/app/services/submitted_edit.py
"""Shared guard + side-effects for editing a *submitted* application in-window.

Used by the text-edit endpoints and the file routers so the owner/status/
window rule and the 'edited_after_submit' stamp live in exactly one place.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import sqs_publisher
from .edit_window import is_edit_open
from ..supabase_client import get_admin_client

_EDITABLE_STATUSES = {"submitted", "under_review"}
_TRACK_FOR_TABLE = {"tir_applications": "tir", "sip_applications": "sip"}


class EditWindowError(Exception):
    """Raised when a submitted-app edit is not permitted. Carries an HTTP shape."""
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def load_editable_app(table: str, application_id: str, user_id: str, select: str) -> dict[str, Any]:
    """Fetch a submitted row by id and enforce owner + status + window.

    Raises EditWindowError(404 / 409 / 403). `select` must include
    id, user_id, status and whatever columns the caller needs.
    """
    track = _TRACK_FOR_TABLE[table]
    res = (
        get_admin_client()
        .table(table)
        .select(select)
        .eq("id", application_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    row = rows[0] if rows else None
    if row is None or row.get("user_id") != user_id:
        raise EditWindowError(404, "not_found", "Application not found.")
    if row.get("status") not in _EDITABLE_STATUSES:
        raise EditWindowError(409, "not_editable", f"Application is {row.get('status')} and cannot be edited.")
    if not is_edit_open(track):
        raise EditWindowError(403, "edit_window_closed", "The edit window for this track has closed.")
    return row


def mark_edited(table: str, application_id: str, track: str) -> None:
    """Stamp edited_after_submit + last_edited_at and re-queue AI screening."""
    (
        get_admin_client()
        .table(table)
        .update({
            "edited_after_submit": True,
            "last_edited_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", application_id)
        .execute()
    )
    sqs_publisher.publish(application_id, track)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_submitted_edit.py -v --no-cov`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/submitted_edit.py backend/tests/test_submitted_edit.py
git commit -m "feat(submitted-edit): shared window guard + mark_edited helper"
```

---

### Task 2: TIR evidence-files — `application_id` path

**Files:** Modify `backend/app/routers/evidence_files.py`; Test `backend/tests/test_evidence_files_edit.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_evidence_files_edit.py
import io
import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import evidence_files as ef

USER = "00000000-0000-0000-0000-0000000000aa"
APP_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture(autouse=True)
def _auth():
    fastapi_app.dependency_overrides[get_current_user] = lambda: {"user_id": USER, "email": "a@b.com"}
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def fakes(monkeypatch):
    state = {"row": {"id": APP_ID, "user_id": USER, "status": "submitted", "evidence_files": []},
             "marked": [], "uploaded": [], "updated": []}

    class _Store:
        def from_(self, *_): return self
        def upload(self, **k): state["uploaded"].append(k); return None
        def remove(self, paths): return None

    class _Tbl:
        def update(self, patch): state["row"].update(patch); state["updated"].append(patch); return self
        def eq(self, *_): return self
        def execute(self):
            class R: data = [state["row"]]
            return R()

    class _Client:
        storage = _Store()
        def table(self, *_): return _Tbl()

    monkeypatch.setattr(ef, "get_admin_client", lambda: _Client())
    # submitted-edit helper: return our row, record mark_edited
    monkeypatch.setattr(ef.submitted_edit, "load_editable_app", lambda *a, **k: dict(state["row"]))
    monkeypatch.setattr(ef.submitted_edit, "mark_edited", lambda t, i, tr: state["marked"].append((i, tr)))
    return state


def test_upload_to_submitted_app_marks_edited(client, fakes):
    res = client.post(
        f"/applications/me/evidence-files?application_id={APP_ID}",
        files={"file": ("e.pdf", io.BytesIO(b"%PDF-1.4 data"), "application/pdf")},
    )
    assert res.status_code == 201
    assert fakes["marked"] == [(APP_ID, "tir")]


def test_upload_window_closed_403(client, fakes, monkeypatch):
    from app.services import submitted_edit as se
    def _raise(*a, **k): raise se.EditWindowError(403, "edit_window_closed", "closed")
    monkeypatch.setattr(ef.submitted_edit, "load_editable_app", _raise)
    res = client.post(
        f"/applications/me/evidence-files?application_id={APP_ID}",
        files={"file": ("e.pdf", io.BytesIO(b"%PDF-1.4 data"), "application/pdf")},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "edit_window_closed"
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_evidence_files_edit.py -v --no-cov`
Expected: FAIL — `ef.submitted_edit` not imported / `application_id` not accepted.

- [ ] **Step 3: Add the import + Query**

In `backend/app/routers/evidence_files.py`, update the fastapi import line and add the helper import:
```python
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
```
```python
from ..services import submitted_edit
```

- [ ] **Step 4: Add `application_id` to the upload handler**

Change the `upload_evidence_file` signature to accept the param:
```python
async def upload_evidence_file(
    request: Request,
    file: UploadFile = File(...),
    application_id: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
```
Replace the draft fetch+guard block (the `app_row = _fetch_draft_application(user_id)` / `if not app_row` / `if app_row["status"] != "draft"` section) with:
```python
    if application_id:
        try:
            app_row = submitted_edit.load_editable_app(
                "tir_applications", application_id, user_id,
                "id, user_id, status, evidence_files",
            )
        except submitted_edit.EditWindowError as e:
            return _error(e.status_code, e.code, e.message)
    else:
        app_row = _fetch_draft_application(user_id)
        if not app_row:
            return _error(status.HTTP_404_NOT_FOUND, "application_missing",
                          "No application found. Start the wizard first.")
        if app_row["status"] != "draft":
            return _error(status.HTTP_409_CONFLICT, "application_locked",
                          "Application is already submitted; attachments can't be changed.")
```
In the JSONB `update(...)` call, remove the `.eq("status", "draft")` filter (the guard already validated status — keep only `.eq("id", app_row["id"])`). After the successful update + `log.info(...)`, add:
```python
    if application_id:
        submitted_edit.mark_edited("tir_applications", application_id, "tir")
```

- [ ] **Step 5: Mirror the change in the delete handler**

Give `delete_evidence_file` an `application_id: str | None = Query(None)` param, replace its draft fetch+guard with the same `if application_id: load_editable_app(... "id, user_id, status, evidence_files") else: <draft path>` block, drop `.eq("status","draft")` from its update, and add the `if application_id: submitted_edit.mark_edited("tir_applications", application_id, "tir")` after success.

- [ ] **Step 6: Run tests to verify pass**

Run: `cd backend && python -m pytest tests/test_evidence_files_edit.py -v --no-cov`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/evidence_files.py backend/tests/test_evidence_files_edit.py
git commit -m "feat(evidence-files): window-guarded file edits on submitted TIR apps"
```

---

### Task 3: TIR milestone-files — `application_id` path

**Files:** Modify `backend/app/routers/milestone_files.py`; Test `backend/tests/test_milestone_files_edit.py`

- [ ] **Step 1: Write the test** — copy `backend/tests/test_evidence_files_edit.py` to `test_milestone_files_edit.py` and adapt: `from app.routers import milestone_files as mf`; patch `mf.get_admin_client`, `mf.submitted_edit.load_editable_app`, `mf.submitted_edit.mark_edited`; the fixture row uses `"milestone_files": []` instead of `evidence_files`; POST to `/applications/me/milestone-files?application_id={APP_ID}`; assert `marked == [(APP_ID, "tir")]` and the 403 case.

- [ ] **Step 2: Run to verify fail** — `cd backend && python -m pytest tests/test_milestone_files_edit.py -v --no-cov` → FAIL.

- [ ] **Step 3: Apply the same router changes as Task 2** to `milestone_files.py`: add `Query` to the fastapi import and `from ..services import submitted_edit`; add `application_id: str | None = Query(None)` to the upload + delete handlers; replace each draft fetch+guard with the `if application_id: submitted_edit.load_editable_app("tir_applications", application_id, user_id, "id, user_id, status, milestone_files") except EditWindowError -> _error else: <existing draft path>` block; drop `.eq("status","draft")` from the updates; add `if application_id: submitted_edit.mark_edited("tir_applications", application_id, "tir")` after each successful update. (Use the `milestone_files` column name in the select string.)

- [ ] **Step 4: Run to verify pass** — `cd backend && python -m pytest tests/test_milestone_files_edit.py -v --no-cov` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/milestone_files.py backend/tests/test_milestone_files_edit.py
git commit -m "feat(milestone-files): window-guarded file edits on submitted TIR apps"
```

---

### Task 4: SIP evidence-files (kind-aware) — `application_id` path

**Files:** Modify `backend/app/routers/sip_evidence_files.py`; Test `backend/tests/test_sip_evidence_files_edit.py`

`sip_evidence_files.py` already imports `Query` and reads a `kind` param; one router handles 4 columns (`sip_pitch_deck`, `sip_cap_table_file`, `sip_traction_files`, `sip_patents_files`) via `_KIND_CONFIG`. Its `_fetch_draft_application` selects `"id, status, sip_pitch_deck, sip_cap_table_file, sip_traction_files, sip_patents_files"`.

- [ ] **Step 1: Write the test** — copy the Task 2 test to `test_sip_evidence_files_edit.py`: `from app.routers import sip_evidence_files as sef`; patch `sef.get_admin_client`, `sef.submitted_edit.load_editable_app`, `sef.submitted_edit.mark_edited`; fixture row includes `"sip_pitch_deck": None`; POST to `/sip-applications/me/evidence-files?kind=pitch-deck&application_id={APP_ID}` with a PDF; assert `marked == [(APP_ID, "sip")]`; add the 403 window-closed case.

- [ ] **Step 2: Run to verify fail** — `cd backend && python -m pytest tests/test_sip_evidence_files_edit.py -v --no-cov` → FAIL.

- [ ] **Step 3: Apply the router changes** to `sip_evidence_files.py`: add `from ..services import submitted_edit`; add `application_id: str | None = Query(None)` to the upload + delete handlers; replace each draft fetch+guard with `if application_id: submitted_edit.load_editable_app("sip_applications", application_id, user_id, "id, user_id, status, sip_pitch_deck, sip_cap_table_file, sip_traction_files, sip_patents_files") except EditWindowError -> _error else: <existing draft path>`; drop `.eq("status","draft")` from the column updates; add `if application_id: submitted_edit.mark_edited("sip_applications", application_id, "sip")` after each successful update. (The per-kind column write logic is unchanged.)

- [ ] **Step 4: Run to verify pass** — `cd backend && python -m pytest tests/test_sip_evidence_files_edit.py -v --no-cov` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/sip_evidence_files.py backend/tests/test_sip_evidence_files_edit.py
git commit -m "feat(sip-evidence-files): window-guarded file edits on submitted VIP apps"
```

---

### Task 5: SIP milestone-files — `application_id` path

**Files:** Modify `backend/app/routers/sip_milestone_files.py`; Test `backend/tests/test_sip_milestone_files_edit.py`

- [ ] **Step 1: Write the test** — copy Task 3's test to `test_sip_milestone_files_edit.py`: `from app.routers import sip_milestone_files as smf`; patch its `get_admin_client` + `submitted_edit.load_editable_app` + `submitted_edit.mark_edited`; fixture row uses `"milestone_files": []`; POST to `/sip-applications/me/milestone-files?application_id={APP_ID}`; assert `marked == [(APP_ID, "sip")]`; 403 case.

- [ ] **Step 2: Run to verify fail** — `cd backend && python -m pytest tests/test_sip_milestone_files_edit.py -v --no-cov` → FAIL.

- [ ] **Step 3: Apply the same router changes** to `sip_milestone_files.py`: add `Query` to the fastapi import if missing and `from ..services import submitted_edit`; add `application_id: str | None = Query(None)` to upload + delete; replace draft fetch+guard with `if application_id: submitted_edit.load_editable_app("sip_applications", application_id, user_id, "id, user_id, status, milestone_files") except EditWindowError -> _error else: <existing draft path>`; drop `.eq("status","draft")`; add `if application_id: submitted_edit.mark_edited("sip_applications", application_id, "sip")` after success.

- [ ] **Step 4: Run to verify pass** — `cd backend && python -m pytest tests/test_sip_milestone_files_edit.py -v --no-cov` → PASS.

- [ ] **Step 5: Full backend regression check + commit**

```bash
cd backend && python -m pytest --no-cov -q
```
Expected: no NEW failures beyond the 19 baseline; the new edit tests pass.
```bash
git add backend/app/routers/sip_milestone_files.py backend/tests/test_sip_milestone_files_edit.py
git commit -m "feat(sip-milestone-files): window-guarded file edits on submitted VIP apps"
```

---

## Phase B — Frontend

### Task 6: Thread `applicationId` into the file inputs

**Files:** Modify `frontend/src/inputs.jsx` (EvidenceFilesInput, MilestoneFilesInput) and `frontend/src/inputs_sip.jsx` (SingleEvidenceInput, MultiEvidenceInput, SipMilestoneFilesInput)

Each file input calls `apiCall("<path>", { method, body })` with a hardcoded draft path. Add an optional `applicationId` prop and append it as a query param so submitted-app edits hit the by-id backend path.

- [ ] **Step 1: EvidenceFilesInput (inputs.jsx)** — accept `applicationId` in the component props. Build a query suffix and append to BOTH the upload and delete `apiCall` paths:
```js
const q = applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : "";
// upload:  apiCall(`/applications/me/evidence-files${q}`, { method: "POST", body: fd })
// delete:  apiCall(`/applications/me/evidence-files/${encodeURIComponent(file_uuid)}${q}`, { method: "DELETE" })
```

- [ ] **Step 2: MilestoneFilesInput (inputs.jsx)** — same: accept `applicationId`, append `?application_id=` to the `/applications/me/milestone-files` upload + delete paths.

- [ ] **Step 3: SIP inputs (inputs_sip.jsx)** — SingleEvidenceInput, MultiEvidenceInput, SipMilestoneFilesInput each accept `applicationId`. For the evidence ones the path already has `?kind=<k>`, so append `&application_id=...`:
```js
const extra = applicationId ? `&application_id=${encodeURIComponent(applicationId)}` : "";
// upload: `/sip-applications/me/evidence-files?kind=${encodeURIComponent(kind)}${extra}`
// delete: `/sip-applications/me/evidence-files/${encodeURIComponent(file_uuid)}?kind=${encodeURIComponent(kind)}${extra}`
```
For SipMilestoneFilesInput use `?application_id=...` (no existing query param).

- [ ] **Step 4: Build + test**

Run: `cd frontend && npm run build && npm test`
Expected: build clean, 169 tests pass (wizard/draft uploads pass `applicationId=undefined` → no query param → unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/inputs.jsx frontend/src/inputs_sip.jsx
git commit -m "feat(file-inputs): optional applicationId routes uploads to submitted-app path"
```

---

### Task 7: Unlock file fields + `EditableAnswer` file mode

**Files:** Modify `frontend/src/screens.jsx` (and confirm `AppSip.jsx`/`App.jsx` pass the submitted app id through)

File inputs persist on upload/delete (no separate Save/PATCH), so `EditableAnswer`'s text Save model doesn't fit them. For file kinds, render the input (with `applicationId`) and a **Done** button instead of Save; the input persists directly.

- [ ] **Step 1: Remove file kinds from the suppression set**

In `screens.jsx`, change `NON_EDITABLE_KINDS` so it contains ONLY `"declarations"` (remove `files`, `milestoneFiles`, `sipPitchDeck`, `sipCapTableFile`, `sipPatents`, `sipTractionFiles`). Add a `FILE_KINDS` set with those six for the file-mode branch:
```js
const NON_EDITABLE_KINDS = new Set(["declarations"]); // legal affirmations stay locked
const FILE_KINDS = new Set(["files", "milestoneFiles", "sipPitchDeck", "sipCapTableFile", "sipPatents", "sipTractionFiles"]);
```

- [ ] **Step 2: Thread the submitted app id into `EditableAnswer`**

`EditableAnswer` needs the submitted app's id for file inputs. Add an `applicationId` prop. Where the submission view renders each answer through `EditableAnswer`, pass `applicationId={submission.id}` (the submitted row's id is already available in the submission-view scope — it renders the reference from it).

- [ ] **Step 3: File-mode branch in `EditableAnswer`**

In the editing branch, when `FILE_KINDS.has(question.kind)`, render the input with `applicationId` and a **Done** button (no Save PATCH); the input's `onChange` updates `committed` so the new value shows immediately:
```jsx
if (FILE_KINDS.has(question.kind)) {
  return (
    <div className="eir-sub-field-value-wrap is-editing">
      <div className="eir-os-edit-input-wrap">
        <InputComponent
          q={question}
          value={committed}
          onChange={(v) => setCommitted(v)}
          applicationId={applicationId}
          autoFocus
        />
      </div>
      <div className="eir-os-edit-actions">
        <button type="button" className="eir-btn eir-os-edit-cancel"
          onClick={() => setEditing(false)}>Done</button>
      </div>
    </div>
  );
}
```
Keep the existing text/choice editing branch (draft → Save via `onSave`) unchanged for non-file kinds.

- [ ] **Step 4: Build + test + lint render**

Run: `cd frontend && npm run build && npm test`
Expected: build clean, 169 pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens.jsx
git commit -m "feat(submission-view): unlock file fields with in-place upload (declarations stay locked)"
```

---

## Phase C — Staging verification

### Task 8: VIP test applicant + end-to-end staging checks

**Files:** Create `backend/scripts/make_sip_test_applicant.py` (or do it via an ops snippet); no app-code change.

- [ ] **Step 1: Create a VIP test applicant with a submitted SIP app**

Using the staging Supabase service-role key (`backend/.env.staging`), create `claude-test-applicant-sip@artpark.in` with a password, `email_confirm=true`, profile `track='sip'`, and insert a cloned submitted `sip_applications` row (anonymized essay text, drop `id`/`display_seq`, set `status='submitted'`). Mirror the approach used for the TIR `claude-test-applicant` (admin create_user → profiles upsert → clone a submitted row).

- [ ] **Step 2: Verify VIP text edit on staging**

Sign in via the staging API, GET `/sip-applications/me/submitted` (confirm `editable: true`), PATCH `/sip-applications/{id}` with a text field, confirm 200 + persisted + `edited_after_submit: true`.

- [ ] **Step 3: Verify file re-upload on staging (both tracks)**

- VIP: POST a PDF to `/sip-applications/me/evidence-files?kind=pitch-deck&application_id=<sip_app_id>` → 201, `sip_pitch_deck` column updated, `edited_after_submit` true.
- TIR: POST to `/applications/me/evidence-files?application_id=<tir_app_id>` → 201, `evidence_files` updated.
- Negative: a past-deadline app (temporarily set `EDIT_DEADLINE_TIR` to the past on the stack, or test a status outside the window) → 403/409.

- [ ] **Step 4: Deploy the updated backend to staging + browser dogfood**

Deploy `new_submission_edit` to `artpark-eir-api-staging` (changeset-previewed, no deletions), then in the Vercel preview log in as both test applicants and confirm: file fields now show **Edit** → uploading/replacing a file works and shows in place; declarations + past-deadline stay locked. (No commit — verification.)

---

## Phase D — Production cutover

### Task 9: Roll out to production

- [ ] **Step 1: Apply migration 026 to the prod Supabase** (`xtmszlpwgbyoumalgbhs`) via the SQL editor (idempotent). Verify the 4 columns exist.

- [ ] **Step 2: Deploy backend to the prod stack** `artpark-eir-api-production`: build from the worktree, create the changeset with `--no-execute-changeset`, **confirm zero `Remove`/`Replace`**, then execute. Confirm the edit + file endpoints return 401 (live) on the prod API.

- [ ] **Step 3: Set prod edit-window deadlines** — `EDIT_DEADLINE_TIR=2026-06-25...`, `EDIT_DEADLINE_SIP=2026-07-05...` (config defaults already match; confirm they're in effect).

- [ ] **Step 4: Promote the frontend to production** (Vercel) once PR #10 is reviewed/merged to `release/sip-launch-v1`.

- [ ] **Step 5: Prod smoke test** — a real submitted applicant (or a prod test account) sees Edit affordances; a text edit + a file re-upload both persist; declarations + post-deadline stay locked. Report results.

---

## Self-Review

- **Spec coverage:** file re-uploads on submitted apps both tracks (Tasks 1–5 backend, 6–7 frontend) ✓; all 6 file fields (evidence/milestone TIR, evidence-kinds + milestone SIP) ✓; declarations stay locked (Task 7 Step 1) ✓; persisted to DB + edited flag + re-screen (Task 1 `mark_edited`, used by every router) ✓; VIP text-edit live verification (Task 8) ✓; file re-upload verification both tracks (Task 8) ✓; prod cutover (Task 9) ✓; resume re-upload NOT included (no task touches resume routers) ✓; no new migration (none added) ✓.
- **Placeholder scan:** every code step has real code; router Tasks 3–5 spell out the exact change (import, param, guard block, drop `.eq("status","draft")`, `mark_edited` call) with the specific table/column/kind — no "same as Task N" hand-waving.
- **Type/name consistency:** `submitted_edit.load_editable_app(table, application_id, user_id, select)`, `submitted_edit.mark_edited(table, application_id, track)`, `EditWindowError(status_code, code, message)`, `application_id` query param, `applicationId` frontend prop, `FILE_KINDS`/`NON_EDITABLE_KINDS` — used consistently across tasks. Track strings `"tir"`/`"sip"`.

**Note on file-edit UX:** file inputs persist immediately (upload/delete hit the backend directly), so `EditableAnswer`'s file branch uses **Done** (close) rather than a Save/PATCH — the text branch keeps Save. This is intentional and matches how the wizard's file inputs already work.
