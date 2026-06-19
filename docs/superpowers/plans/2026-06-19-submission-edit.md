# Post-login UI + Edit-After-Submit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Reiteration post-login applicant UI onto current prod and add an edit-after-submit capability where candidates can correct individual answers inline within a track-specific window.

**Architecture:** Branch `new_submission_edit` is cut from prod (`origin/release/sip-launch-v1`). The Reiteration applicant UI is cherry-picked in. New by-id `PATCH` endpoints let an owner edit a *submitted* row while `status ∈ {submitted, under_review}` and `now < track edit deadline`; saving re-queues AI screening and stamps an "edited" flag. The frontend "Your submission" view gains per-field inline editing gated on a server-computed `editable` flag.

**Tech Stack:** FastAPI + Supabase (service-role) on AWS Lambda; React 18 + Vite; SQS FIFO AI screener; pytest + vitest.

---

## File Structure

**Backend (new/modified):**
- Create: `backend/app/services/edit_window.py` — edit-deadline config helper (`edit_deadline_for`, `is_edit_open`).
- Modify: `backend/app/config.py` — add `edit_deadline_tir` / `edit_deadline_sip` settings.
- Modify: `backend/app/models/application.py` + `backend/app/models/sip_application.py` — add `editable` / `edit_deadline` to the Read models.
- Modify: `backend/app/routers/applications.py` — add `_fetch_application_by_id`, `_is_editable`, and `PATCH /applications/{application_id}`; attach `editable`/`edit_deadline` on reads.
- Modify: `backend/app/routers/sip_applications.py` — SIP mirror.
- Create: `backend/migrations/026_edit_after_submit.sql` — `edited_after_submit`, `last_edited_at` on both app tables.
- Tests: `backend/tests/test_edit_window.py`, `backend/tests/test_applications_edit.py`, `backend/tests/test_sip_applications_edit.py`.

**Frontend (new/modified):**
- Cherry-picked from Reiteration: `frontend/src/auth_upload.jsx`, `screens.jsx`, `styles.css`, `components/icons.jsx`, `lib/refId.js`, `App.jsx`, `AppSip.jsx`.
- Modify: `frontend/src/lib/api.js` — `editSubmitted(track, id, patch)`.
- Modify: `frontend/src/hooks/useApplication.jsx` + `useSipApplication.jsx` — `saveSubmittedField`, expose `editable`/`editDeadline`.
- Modify: the submission-view component (in `auth_upload.jsx` post-cherry-pick) — inline per-field edit.

---

## Phase A — Branch & UI port

### Task 1: Cherry-pick the Reiteration applicant UI onto the prod base

**Files:** frontend only (auth_upload.jsx, screens.jsx, styles.css, components/icons.jsx, lib/refId.js, App.jsx, AppSip.jsx, validators.jsx)

- [ ] **Step 1: Confirm branch + base**

Run:
```bash
cd .claude/worktrees/new_submission_edit
git branch --show-current   # expect: new_submission_edit
git log --oneline -1         # expect: a2c0d82 (prod base) or later spec commit
```

- [ ] **Step 2: Cherry-pick the three applicant-UI commits (skip the leadership-rename commit)**

Run:
```bash
git cherry-pick 7271f82 650ec2e a17eec2
```
Expected: applies, or stops on conflicts in `frontend/src/*`.

- [ ] **Step 3: Resolve conflicts with this rule**

Resolution principle: **take the Reiteration version for applicant-facing files** (`auth_upload.jsx`, `screens.jsx`, `styles.css`, `components/icons.jsx`, `lib/refId.js`, applicant parts of `App.jsx`/`AppSip.jsx`), and **keep prod's version** for anything leadership/reviewer/admin/backend. For each conflicted file:
```bash
git checkout --theirs frontend/src/<conflicted-applicant-file>   # 'theirs' = the commit being picked
git add frontend/src/<conflicted-applicant-file>
```
For `App.jsx`/`AppSip.jsx` (which both branches changed), hand-merge: keep prod's routing/role-gate wiring, add Reiteration's dashboard phase/screens. Then `git add` and `git cherry-pick --continue`.

- [ ] **Step 4: Install + build the frontend**

Run:
```bash
cd frontend && npm install && npm run build
```
Expected: build succeeds, no unresolved import errors.

- [ ] **Step 5: Run frontend tests**

Run: `npm test`
Expected: PASS (existing suite green; no new failures from the port).

- [ ] **Step 6: Smoke-render the dashboard**

Start `npm run dev` and confirm `/apply/submitted` shows the new dashboard + "Your submission" view (use a minted staging applicant session as in prior sessions). Expected: sidebar shell + stage tracker render.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(applicant-ui): port Reiteration post-login dashboard + submission view onto prod base"
```

---

## Phase B — Backend edit-after-submit

### Task 2: Edit-window config + helper

**Files:**
- Modify: `backend/app/config.py` (Settings class)
- Create: `backend/app/services/edit_window.py`
- Test: `backend/tests/test_edit_window.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_edit_window.py
from app.services import edit_window


def test_edit_open_before_deadline(monkeypatch):
    monkeypatch.setattr(edit_window.settings, "edit_deadline_tir", "2099-01-01T00:00:00+05:30")
    assert edit_window.is_edit_open("tir") is True


def test_edit_closed_after_deadline(monkeypatch):
    monkeypatch.setattr(edit_window.settings, "edit_deadline_tir", "2000-01-01T00:00:00+05:30")
    assert edit_window.is_edit_open("tir") is False


def test_deadline_per_track(monkeypatch):
    monkeypatch.setattr(edit_window.settings, "edit_deadline_sip", "2030-07-05T23:59:59+05:30")
    assert edit_window.edit_deadline_for("sip").year == 2030
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_edit_window.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.edit_window`.

- [ ] **Step 3: Add settings fields**

In `backend/app/config.py`, inside `class Settings(BaseSettings)` (near the other string fields, e.g. after `frontend_origin`):
```python
    # Edit-after-submit window deadlines (ISO 8601, IST). After these, a
    # submitted application locks. Configurable so dates change without a deploy.
    edit_deadline_tir: str = "2026-06-25T23:59:59+05:30"
    edit_deadline_sip: str = "2026-07-05T23:59:59+05:30"
```

- [ ] **Step 4: Create the helper module**

```python
# backend/app/services/edit_window.py
"""Edit-after-submit window: is a submitted application still editable?"""
from __future__ import annotations

from datetime import datetime, timezone

from ..config import settings

_DEADLINE_ATTR = {"tir": "edit_deadline_tir", "sip": "edit_deadline_sip"}


def edit_deadline_for(track: str) -> datetime:
    raw = getattr(settings, _DEADLINE_ATTR[track])
    return datetime.fromisoformat(raw)


def is_edit_open(track: str, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return now < edit_deadline_for(track)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_edit_window.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/services/edit_window.py backend/tests/test_edit_window.py
git commit -m "feat(edit-window): per-track edit-deadline config + is_edit_open helper"
```

---

### Task 3: Migration 026 — edited flags on both app tables

**Files:** Create `backend/migrations/026_edit_after_submit.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 026_edit_after_submit.sql
-- Track post-submit edits so reviewers can see an application changed after submission.
alter table public.tir_applications
  add column if not exists edited_after_submit boolean not null default false,
  add column if not exists last_edited_at timestamptz;

alter table public.sip_applications
  add column if not exists edited_after_submit boolean not null default false,
  add column if not exists last_edited_at timestamptz;
```

- [ ] **Step 2: Verify SQL is well-formed (dry parse)**

Run: `cd backend && python -c "open('migrations/026_edit_after_submit.sql').read(); print('ok')"`
Expected: `ok` (file exists, readable). Applied to a live DB in Task 11.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/026_edit_after_submit.sql
git commit -m "feat(migrations): 026 add edited_after_submit + last_edited_at"
```

---

### Task 4: Add `editable` / `edit_deadline` to the Read models

**Files:**
- Modify: `backend/app/models/application.py` (`ApplicationRead`)
- Modify: `backend/app/models/sip_application.py` (`SipApplicationRead`)
- Test: `backend/tests/test_applications_edit.py` (model portion)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_applications_edit.py
from datetime import datetime
from app.models.application import ApplicationRead


def _row():
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_id": "00000000-0000-0000-0000-0000000000aa",
        "status": "submitted",
        "completion_pct": 100,
        "submitted_at": "2026-06-04T00:00:00+00:00",
        "created_at": "2026-06-04T00:00:00+00:00",
        "updated_at": "2026-06-04T00:00:00+00:00",
    }


def test_read_model_has_edit_fields_defaulting_off():
    read = ApplicationRead.model_validate(_row())
    assert read.editable is False
    assert read.edit_deadline is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_applications_edit.py::test_read_model_has_edit_fields_defaulting_off -v`
Expected: FAIL — `AttributeError: editable`.

- [ ] **Step 3: Add fields to `ApplicationRead`**

In `backend/app/models/application.py`, inside `class ApplicationRead(ApplicationUpdate)` (after `updated_at: datetime`):
```python
    # Edit-after-submit (computed by the route, not DB columns).
    editable: bool = False
    edit_deadline: datetime | None = None
    edited_after_submit: bool = False
    last_edited_at: datetime | None = None
```

- [ ] **Step 4: Mirror in `SipApplicationRead`**

In `backend/app/models/sip_application.py`, add the same four fields to the SIP Read model class (match its existing field style).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_applications_edit.py::test_read_model_has_edit_fields_defaulting_off -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/application.py backend/app/models/sip_application.py backend/tests/test_applications_edit.py
git commit -m "feat(models): expose editable/edit_deadline/edited flags on Read models"
```

---

### Task 5: TIR edit endpoint `PATCH /applications/{application_id}`

**Files:**
- Modify: `backend/app/routers/applications.py`
- Test: `backend/tests/test_applications_edit.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_applications_edit.py`:
```python
import copy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import applications as apps_mod
from app.services import edit_window

USER = "00000000-0000-0000-0000-0000000000aa"
APP_ID = "22222222-2222-2222-2222-222222222222"


@pytest.fixture(autouse=True)
def _auth():
    fastapi_app.dependency_overrides[get_current_user] = lambda: {"user_id": USER, "email": "a@b.com"}
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def submitted_db(monkeypatch):
    state = {"row": {
        "id": APP_ID, "user_id": USER, "status": "submitted", "completion_pct": 100,
        "submitted_at": "2026-06-04T00:00:00+00:00", "created_at": "2026-06-04T00:00:00+00:00",
        "updated_at": "2026-06-04T00:00:00+00:00", "basic_full_name": "Old Name",
    }, "published": [], "audited": []}

    def fake_by_id(app_id):
        return copy.deepcopy(state["row"]) if app_id == state["row"]["id"] else None

    def fake_update(app_id, patch):
        state["row"].update(patch)
        return copy.deepcopy(state["row"])

    monkeypatch.setattr(apps_mod, "_fetch_application_by_id", fake_by_id)
    monkeypatch.setattr(apps_mod, "_update_application", fake_update)
    monkeypatch.setattr(apps_mod, "_audit", lambda **k: state["audited"].append(k))
    monkeypatch.setattr(apps_mod.sqs_publisher, "publish", lambda i, t: state["published"].append((i, t)))
    monkeypatch.setattr(edit_window.settings, "edit_deadline_tir", "2099-01-01T00:00:00+05:30")
    return state


def test_edit_in_window_saves_flags_and_rescreens(client, submitted_db):
    res = client.patch(f"/applications/{APP_ID}", json={"basic_full_name": "New Name"})
    assert res.status_code == 200
    assert submitted_db["row"]["basic_full_name"] == "New Name"
    assert submitted_db["row"]["edited_after_submit"] is True
    assert submitted_db["row"]["last_edited_at"] is not None
    assert submitted_db["published"] == [(APP_ID, "tir")]


def test_edit_after_deadline_is_403(client, submitted_db, monkeypatch):
    monkeypatch.setattr(edit_window.settings, "edit_deadline_tir", "2000-01-01T00:00:00+05:30")
    res = client.patch(f"/applications/{APP_ID}", json={"basic_full_name": "X"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "edit_window_closed"


def test_edit_wrong_owner_is_404(client, submitted_db, monkeypatch):
    submitted_db["row"]["user_id"] = "99999999-9999-9999-9999-999999999999"
    res = client.patch(f"/applications/{APP_ID}", json={"basic_full_name": "X"})
    assert res.status_code == 404


def test_edit_draft_status_is_409(client, submitted_db):
    submitted_db["row"]["status"] = "draft"
    res = client.patch(f"/applications/{APP_ID}", json={"basic_full_name": "X"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "not_editable"


def test_edit_invalid_value_is_422(client, submitted_db):
    res = client.patch(f"/applications/{APP_ID}", json={"basic_has_team": "Maybe?"})
    assert res.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_applications_edit.py -v`
Expected: FAIL — endpoint/`_fetch_application_by_id` not defined (404 / AttributeError).

- [ ] **Step 3: Add the by-id fetch helper**

In `backend/app/routers/applications.py`, after `_fetch_submitted_applications`:
```python
def _fetch_application_by_id(application_id: str) -> dict[str, Any] | None:
    """Fetch a single application row by its id (any status)."""
    res = (
        get_admin_client()
        .table("tir_applications")
        .select("*")
        .eq("id", application_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None
```

- [ ] **Step 4: Add an `_is_editable` helper + import**

At the top imports of `applications.py` add:
```python
from ..services.edit_window import edit_deadline_for, is_edit_open
```
Then near the other helpers:
```python
_EDITABLE_STATUSES = {"submitted", "under_review"}


def _is_editable(row: dict[str, Any]) -> bool:
    return row.get("status") in _EDITABLE_STATUSES and is_edit_open("tir")
```

- [ ] **Step 5: Add the edit endpoint**

After `patch_application` in `applications.py`:
```python
@router.patch(
    "/{application_id}",
    response_model=ApplicationRead,
    dependencies=[Depends(_rl_patch)],
)
async def edit_submitted_application(
    application_id: str,
    request: Request,
    body: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    """Edit a *submitted* application in-place during the edit window.

    Guards: owner-only (404 otherwise), status in {submitted, under_review}
    (409 not_editable), and now < TIR edit deadline (403 edit_window_closed).
    Saving stamps edited_after_submit + last_edited_at and re-queues AI screening.
    """
    req_id = _new_request_id()
    user_id = current_user["user_id"]

    if not isinstance(body, dict):
        return _error(status.HTTP_400_BAD_REQUEST, "invalid_body", "Request body must be a JSON object.")

    body = {k: v for k, v in body.items() if k in WRITABLE_FIELDS}
    if not body:
        return _error(status.HTTP_400_BAD_REQUEST, "empty_patch", "No writable fields in request body.")

    try:
        patch_model = ApplicationUpdate(**body)
    except ValidationError as exc:
        return _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error",
                      "One or more fields failed validation.", errors=exc.errors())
    patch_dict = patch_model.model_dump(exclude_unset=True)
    if not patch_dict:
        return _error(status.HTTP_400_BAD_REQUEST, "empty_patch", "At least one writable field is required.")

    try:
        row = _fetch_application_by_id(application_id)
    except Exception:
        log.exception("applications.edit fetch failed", extra={"request_id": req_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "fetch_failed",
                      f"Could not load application (ref {req_id}).")

    if row is None or row.get("user_id") != user_id:
        return _error(status.HTTP_404_NOT_FOUND, "not_found", "Application not found.")
    if row.get("status") not in _EDITABLE_STATUSES:
        return _error(status.HTTP_409_CONFLICT, "not_editable",
                      f"Application is {row.get('status')} and cannot be edited.")
    if not is_edit_open("tir"):
        return _error(status.HTTP_403_FORBIDDEN, "edit_window_closed",
                      "The edit window for this track has closed.")

    patch_dict["edited_after_submit"] = True
    patch_dict["last_edited_at"] = datetime.now(tz=None).astimezone().isoformat()

    try:
        updated = _update_application(application_id, patch_dict)
    except Exception:
        log.exception("applications.edit update failed", extra={"request_id": req_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "update_failed",
                      f"Could not save changes (ref {req_id}).")

    sqs_publisher.publish(application_id, "tir")
    _audit(user_id=user_id, action="application.edited_after_submit",
           metadata={"fields": sorted(patch_dict.keys())}, request=request)

    read = ApplicationRead.model_validate(updated)
    read.editable = _is_editable(updated)
    read.edit_deadline = edit_deadline_for("tir")
    return read
```

- [ ] **Step 6: Attach `editable`/`edit_deadline` on the submitted-list read**

In `list_submitted_applications`, replace the return with:
```python
    out = []
    for r in rows:
        read = ApplicationRead.model_validate(r)
        read.editable = _is_editable(r)
        read.edit_deadline = edit_deadline_for("tir")
        out.append(read)
    return out
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_applications_edit.py -v`
Expected: PASS (all edit tests green).

- [ ] **Step 8: Run the full applications suite (no regressions)**

Run: `cd backend && python -m pytest tests/test_applications.py -v`
Expected: PASS (existing tests, incl. `test_patch_after_submit_returns_409`, still green — the draft PATCH is unchanged).

- [ ] **Step 9: Commit**

```bash
git add backend/app/routers/applications.py backend/tests/test_applications_edit.py
git commit -m "feat(applications): edit-after-submit endpoint with window guard + re-screen"
```

---

### Task 6: SIP edit endpoint `PATCH /sip-applications/{application_id}`

**Files:**
- Modify: `backend/app/routers/sip_applications.py`
- Test: `backend/tests/test_sip_applications_edit.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_sip_applications_edit.py` mirroring `test_applications_edit.py` but: import `from app.routers import sip_applications as sip_mod`; patch `sip_mod._fetch_application_by_id`, `sip_mod._update_application`, `sip_mod._audit`, `sip_mod.sqs_publisher.publish`; set `edit_window.settings.edit_deadline_sip`; call `client.patch(f"/sip-applications/{APP_ID}", json={"basic_full_name": "New"})`; assert `published == [(APP_ID, "sip")]`. Include the same five cases (in-window success, after-deadline 403, wrong-owner 404, draft 409, invalid 422) using a SIP-valid invalid field (e.g. `{"sip_incorporated": 123}`).

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && python -m pytest tests/test_sip_applications_edit.py -v`
Expected: FAIL — endpoint/helper missing.

- [ ] **Step 3: Implement the SIP mirror**

In `backend/app/routers/sip_applications.py`: add `from ..services.edit_window import edit_deadline_for, is_edit_open`; add `_fetch_application_by_id` (querying `sip_applications`), `_EDITABLE_STATUSES`, `_is_editable` (calls `is_edit_open("sip")`), and `PATCH /{application_id}` (identical logic to Task 5 Step 5 but using `SipApplicationUpdate`, `SipApplicationRead`, `sqs_publisher.publish(application_id, "sip")`, and `is_edit_open("sip")` / `edit_deadline_for("sip")`). Attach `editable`/`edit_deadline` on the SIP submitted-list read.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python -m pytest tests/test_sip_applications_edit.py -v`
Expected: PASS.

- [ ] **Step 5: Full SIP suite (no regressions)**

Run: `cd backend && python -m pytest tests/test_sip_applications_submit.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/sip_applications.py backend/tests/test_sip_applications_edit.py
git commit -m "feat(sip-applications): edit-after-submit endpoint (SIP mirror)"
```

---

## Phase C — Frontend inline edit

### Task 7: API client method for by-id edit

**Files:** Modify `frontend/src/lib/api.js`

- [ ] **Step 1: Add the method**

In `frontend/src/lib/api.js`, add to the exported `api` object:
```js
  // Edit a SUBMITTED application by id (edit-after-submit window).
  editSubmitted(track, id, patch) {
    const base = track === "sip" ? "/sip-applications" : "/applications";
    return apiCall(`${base}/${id}`, { method: "PATCH", body: patch });
  },
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "feat(api): editSubmitted(track, id, patch) client method"
```

---

### Task 8: Hook support for editing a submitted application

**Files:** Modify `frontend/src/hooks/useApplication.jsx` and `frontend/src/hooks/useSipApplication.jsx`

- [ ] **Step 1: Add `saveSubmittedField` + expose edit flags (TIR)**

In `useApplication.jsx`, add a callback that PATCHes a submitted row by id and updates local state. Concrete shape:
```js
const saveSubmittedField = useCallback(async (appId, questionId, value) => {
  const patch = expandForPatch({ [questionId]: value });   // reuse existing fieldMap helper
  const updated = await api.editSubmitted("tir", appId, patch);
  setSubmittedApps((prev) => prev.map((a) => (a.id === appId ? updated : a)));
  return updated;
}, []);
```
Expose `saveSubmittedField` in the hook's return value. Read `editable` / `edit_deadline` straight off each submitted-app object (now present from the API).

- [ ] **Step 2: Mirror in `useSipApplication.jsx`**

Same as Step 1 but `api.editSubmitted("sip", …)` and the SIP `expandForPatch` from `fieldMap-sip`.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useApplication.jsx frontend/src/hooks/useSipApplication.jsx
git commit -m "feat(hooks): saveSubmittedField for edit-after-submit"
```

---

### Task 9: Inline per-field edit on the "Your submission" view

**Files:** Modify the submission-view component in `frontend/src/auth_upload.jsx` (post-cherry-pick).

- [ ] **Step 1: Add an `EditableAnswer` component**

In `auth_upload.jsx`, add (reusing the existing question-input registry from `inputs.jsx` / `inputs_sip.jsx`):
```jsx
function EditableAnswer({ question, value, editable, onSave }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState(null);

  if (!editing) {
    return (
      <div className="eir-os-answer-row">
        <div className="eir-os-answer-value">{renderAnswerValue(value)}</div>
        {editable && (
          <button className="eir-os-edit-btn" onClick={() => { setDraft(value); setEditing(true); }}>
            Edit
          </button>
        )}
      </div>
    );
  }
  const InputForType = INPUT_REGISTRY[question.type];   // existing per-type input
  return (
    <div className="eir-os-answer-row is-editing">
      <InputForType question={question} value={draft} onChange={setDraft} />
      {err && <p className="eir-os-edit-err">{err}</p>}
      <div className="eir-os-edit-actions">
        <button disabled={saving} onClick={async () => {
          setSaving(true); setErr(null);
          try { await onSave(question.id, draft); setEditing(false); }
          catch (e) { setErr(e?.details?.errors ? "That value isn't valid." : "Couldn't save — try again."); }
          finally { setSaving(false); }
        }}>{saving ? "Saving…" : "Save"}</button>
        <button disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}
```
(`renderAnswerValue` and `INPUT_REGISTRY` already exist in the submission view / inputs module; wire to those names. If the registry isn't exported, export it from `inputs.jsx`.)

- [ ] **Step 2: Render answers through `EditableAnswer`**

In the submission view, replace the static answer render with `<EditableAnswer question={q} value={answers[q.id]} editable={app.editable} onSave={(qid, v) => saveSubmittedField(app.id, qid, v)} />`.

- [ ] **Step 3: Header window text**

Where the card shows "Locked for review", show instead, when `app.editable`: `Editable until {formatDate(app.edit_deadline)}`. When not editable, keep "Locked for review."

- [ ] **Step 4: Build + frontend tests**

Run: `cd frontend && npm run build && npm test`
Expected: build + tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auth_upload.jsx frontend/src/inputs.jsx
git commit -m "feat(submission-view): inline per-field edit within the edit window"
```

---

### Task 10: End-to-end render check (local, both tracks)

- [ ] **Step 1: Run the stack against staging**

Start backend (`uvicorn app.main:app --port 8000`, staging `.env`, edit-window deadlines in the future) and `npm run dev`. Log in as the staging test applicant (TIR) and a SIP applicant.

- [ ] **Step 2: Verify TIR**

On `/apply/submitted`: each field shows "Edit"; editing a field + Save persists (reload shows new value), header reads "Editable until 25 Jun".

- [ ] **Step 3: Verify VIP**

Same on `/apply-sip/submitted` with "Editable until 5 Jul".

- [ ] **Step 4: Verify lock**

Temporarily set `EDIT_DEADLINE_TIR` to a past date, restart backend, reload — "Edit" gone, header reads "Locked for review", and a direct PATCH returns 403. Revert the date.

No commit (verification only).

---

## Phase D — Staging validation (before prod)

### Task 11: Deploy to staging + run acceptance checklist

- [ ] **Step 1: Apply migration 026 to staging Supabase**

Run `026_edit_after_submit.sql` in the staging Supabase SQL editor (project `exqmxvdtcsvpgtftwjml`). Verify columns exist:
```sql
select column_name from information_schema.columns
where table_name='tir_applications' and column_name in ('edited_after_submit','last_edited_at');
```
Expected: two rows.

- [ ] **Step 2: Deploy backend to the staging Lambda stack**

Deploy `new_submission_edit` backend to `artpark-eir-api-staging` (per `infra/sam` staging deploy; deploy from this worktree to avoid HEAD-flip shipping wrong-branch code). Set `EDIT_DEADLINE_TIR` / `EDIT_DEADLINE_SIP` env on the stack.

- [ ] **Step 3: Deploy the frontend preview**

Point a Vercel preview at `new_submission_edit` (or push the branch so Vercel builds a preview). Confirm it targets the staging API.

- [ ] **Step 4: Run the acceptance checklist (from the spec) on staging**

Edit within window saves to the correct track table + sets `edited_after_submit`/`last_edited_at` + re-queues screening (DLQ stays 0); invalid edit → 422; past-deadline → locked + 403; both TIR and VIP; reviewer/leadership/admin app-detail still load and can surface the edited flag.

- [ ] **Step 5: Report results and hand off the prod-cutover decision to the user**

Summarize what passed; do not merge to prod until the user approves.

---

## Self-Review

- **Spec coverage:** branch strategy (Task 1) ✓; window config + deadlines (Task 2) ✓; migration 026 (Task 3) ✓; read-model `editable`/`edit_deadline` (Task 4) ✓; TIR edit endpoint with owner/status/window guards + validation + re-screen + flags (Task 5) ✓; SIP mirror (Task 6) ✓; UI port (Task 1) ✓; inline per-field edit + header window text (Tasks 7–9) ✓; all-fields-editable incl. files (reuses INPUT_REGISTRY which includes the file input) ✓; eligibility-gate edits re-validate, no auto-disqualify (validators run, no disqualify branch) ✓; staging-first testing (Task 11) ✓; out-of-scope items not built ✓.
- **Placeholder scan:** all code steps contain real code; deadlines, table names, endpoint paths, and SQS track strings are concrete.
- **Type/name consistency:** `_fetch_application_by_id`, `_is_editable`, `_EDITABLE_STATUSES`, `edit_window.is_edit_open`/`edit_deadline_for`, `editSubmitted`, `saveSubmittedField`, `EditableAnswer` used consistently across tasks; SQS track strings are `"tir"`/`"sip"`.

**Debounce note:** server-side throttling is intentionally omitted — edits save per-field on explicit "Save" (not per keystroke), so the natural re-queue rate is low and the FIFO worker upserts idempotently. Revisit only if observed re-screen volume warrants it.
