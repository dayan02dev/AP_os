# Mandatory Resume + LinkedIn + GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make three new fields (`resume_file_id`, `linkedin_url`, `github_url`) mandatory at submit time on the TIR wizard, with light format validation, while grandfathering existing submitted rows.

**Architecture:** DB migration 019 already added the three nullable columns (staging `tir_applications` + prod legacy `applications`). This plan only covers backend validator + frontend UI + tests + staged deploy. Backend introduces a hard-block branch in the submit handler specifically for the three new fields, leaving all other validation soft (matches existing policy). Frontend folds the fields into the existing Basic section, reusing the `useResume` hook for upload.

**Tech Stack:** Python 3.11 / FastAPI / Supabase / pytest (backend); React 18 / Vite / React Router 6 / vitest (frontend).

**Source-of-truth design:** `docs/superpowers/specs/2026-05-22-mandatory-resume-linkedin-github-design.md`.

**Critical context (already verified on disk):**
- Backend submit endpoint: `backend/app/routers/applications.py:579` — currently calls `_validate_submission()` (defined at line 204) but proceeds to flip status even with missing fields ("soft validation" by existing policy). This plan adds a hard-block branch for the three new fields only.
- Resume upload endpoint already exists: `POST /resume/upload` → returns `{file_id, filename, size}` (see `backend/app/routers/resume.py`).
- Frontend resume hook already exists: `frontend/src/hooks/useResume.js` posts to `/resume/upload`.
- TIR wizard renders sections via `frontend/src/App.jsx` driven by `frontend/src/lib/fieldMap.js`; the Basic section is the first wizard step.
- Pydantic models: `backend/app/models/application.py`.
- Migration files: `backend/migrations/019_mandatory_profile_links_staging.sql` (already applied to staging Supabase), `backend/migrations/019_mandatory_profile_links_prod.sql` (already applied to prod Supabase).

---

## Task 0: Pre-flight — verify the schema is live and baseline tests pass

**Files:** none (verification only)

- [ ] **Step 1: Confirm the three columns exist in staging**

Run from `backend/`:
```bash
python -c "
from dotenv import load_dotenv
load_dotenv('.env.staging', override=True)
import os
from supabase import create_client
sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
res = sb.table('tir_applications').select('id, resume_file_id, linkedin_url, github_url').limit(1).execute()
print('OK — columns exist on staging tir_applications' if res.data is not None else 'FAIL')
"
```
Expected: `OK — columns exist on staging tir_applications`. If FAIL, re-apply `backend/migrations/019_mandatory_profile_links_staging.sql` via Supabase SQL editor.

- [ ] **Step 2: Confirm the three columns exist in prod**

Run from `backend/`:
```bash
python -c "
from dotenv import load_dotenv
load_dotenv('.env.prod', override=True)
import os
from supabase import create_client
sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
res = sb.table('applications').select('id, resume_file_id, linkedin_url, github_url').limit(1).execute()
print('OK — columns exist on prod applications' if res.data is not None else 'FAIL')
"
```
Expected: `OK — columns exist on prod applications`.

- [ ] **Step 3: Baseline test runs — backend**

Run from `backend/`:
```bash
python -m pytest tests/test_applications.py -q --no-cov 2>&1 | tail -5
```
Expected: all green (e.g. `42 passed, 3 skipped`). Record the number of passing tests as the baseline — every later task must keep this count ≥.

- [ ] **Step 4: Baseline test runs — frontend**

Run from `frontend/`:
```bash
npm test -- --run --reporter=verbose 2>&1 | tail -20
```
Expected: all green. Record the count.

---

## Task 1: Backend — add three fields to Pydantic models

**Files:**
- Modify: `backend/app/models/application.py`

The existing `ApplicationRead` and `ApplicationUpdate` schemas declare every wizard column. We add `resume_file_id`, `linkedin_url`, `github_url` so PATCH accepts them and GET returns them.

- [ ] **Step 1: Inspect the existing model to find the exact insertion point**

Run from `backend/`:
```bash
grep -n "basic_org\|basic_phone\|class ApplicationRead\|class ApplicationUpdate" app/models/application.py | head -20
```
Note the line numbers for `basic_org` and `basic_phone` in both classes — the new fields go right after `basic_phone` to match the wizard's "Identity & links" subheading position.

- [ ] **Step 2: Add the three fields to `ApplicationUpdate`**

In `backend/app/models/application.py`, locate `class ApplicationUpdate` and add immediately after the line declaring `basic_phone`:

```python
    resume_file_id: uuid.UUID | None = None
    linkedin_url: str | None = Field(default=None, max_length=500)
    github_url: str | None = Field(default=None, max_length=500)
```

If `uuid` isn't already imported at the top of the file, add `import uuid` near the other stdlib imports.
If `Field` isn't already imported from pydantic, add it: `from pydantic import BaseModel, Field`.

- [ ] **Step 3: Add the same three fields to `ApplicationRead`**

Same placement (after `basic_phone`):

```python
    resume_file_id: uuid.UUID | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
```

(`ApplicationRead` doesn't need `max_length` — the DB constraint enforces it on the way in.)

- [ ] **Step 4: Run the models module to confirm import-clean**

Run from `backend/`:
```bash
python -c "from app.models.application import ApplicationRead, ApplicationUpdate; print('OK')"
```
Expected: `OK`. If you get `ImportError` or `NameError`, you missed `uuid` or `Field` import.

- [ ] **Step 5: Run the existing applications tests — must still pass**

Run from `backend/`:
```bash
python -m pytest tests/test_applications.py -q --no-cov 2>&1 | tail -3
```
Expected: same green count as Task 0 Step 3.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/application.py
git commit -m "feat(applications): add resume_file_id + linkedin_url + github_url to Pydantic schemas"
```

---

## Task 2: Backend — extend the validator with the three new presence/format checks

**Files:**
- Modify: `backend/app/routers/applications.py` (`_validate_submission` at line ~204)

The validator already returns `(missing, invalid)`. We append the three new fields to `missing` when absent, and to `invalid` when the URL format is wrong. We do NOT add them to `ALWAYS_REQUIRED` (line ~76) — the hard-block in Task 3 lives only at the submit endpoint, not in the completion-percentage path.

- [ ] **Step 1: Write the failing tests first**

Create `backend/tests/test_validate_submission_mandatory_fields.py`:

```python
"""Unit tests for the three new mandatory wizard fields.

Targets the pure validator function (no router, no DB) — fast and exact.
"""
from app.routers.applications import _validate_submission


def _draft_with(**overrides):
    """Build a fully-valid draft row, then apply overrides."""
    base = {
        "id": "00000000-0000-0000-0000-000000000001",
        "user_id": "00000000-0000-0000-0000-000000000002",
        "status": "draft",
        # Minimum set the validator looks at for non-Identity fields
        "basic_full_name": "Test Person",
        "basic_email": "test@example.com",
        "basic_phone": "+91 9876543210",
        "basic_org": "Test Org",
        "basic_degree": "Bachelor's Degree",
        "basic_has_team": "No — going solo for now",
        "basic_hear_about": "Referral from friend/colleague",
        "basic_incubator_association": "No",
        "problem_defined": "Yes",
        "problem_describe": "x",
        "problem_importance": "x",
        "solution_describe": "x",
        "solution_core_tech": "x",
        "solution_customers": "x",
        "solution_stage": "Still exploring",
        "solution_moat": "x",
        "solution_ten_x": "x",
        "solution_national_scale": "x",
        "solution_hurdles": "x",
        "solution_contrarian_insight": "x",
        "execution_milestone": "x",
        "execution_infrastructure": "x",
        "execution_failure": "x",
        "execution_hwsw_integration": "x",
        "execution_budget": "x",
        "declaration_truthful": True,
        "declaration_ref_checks": True,
        "declaration_terms": True,
        # The new fields — defaults vary per test
        "resume_file_id": "00000000-0000-0000-0000-000000000003",
        "linkedin_url": "https://linkedin.com/in/testperson",
        "github_url": "https://github.com/testperson",
    }
    base.update(overrides)
    return base


def test_validate_all_three_present_and_valid():
    missing, invalid = _validate_submission(_draft_with())
    assert "resume_file_id" not in missing
    assert "linkedin_url" not in missing
    assert "github_url" not in missing
    assert not any(i["field"] in ("linkedin_url", "github_url") for i in invalid)


def test_validate_resume_missing():
    missing, _ = _validate_submission(_draft_with(resume_file_id=None))
    assert "resume_file_id" in missing


def test_validate_linkedin_blank():
    missing, _ = _validate_submission(_draft_with(linkedin_url=""))
    assert "linkedin_url" in missing


def test_validate_linkedin_wrong_domain():
    missing, invalid = _validate_submission(
        _draft_with(linkedin_url="https://example.com/profile")
    )
    assert "linkedin_url" not in missing  # presence OK
    assert any(
        i["field"] == "linkedin_url" and "linkedin.com" in i["reason"]
        for i in invalid
    )


def test_validate_github_blank():
    missing, _ = _validate_submission(_draft_with(github_url=None))
    assert "github_url" in missing


def test_validate_github_wrong_domain():
    missing, invalid = _validate_submission(
        _draft_with(github_url="https://gitlab.com/user")
    )
    assert "github_url" not in missing
    assert any(
        i["field"] == "github_url" and "github.com" in i["reason"]
        for i in invalid
    )


def test_validate_linkedin_too_long():
    long_url = "https://linkedin.com/in/" + ("x" * 500)
    _, invalid = _validate_submission(_draft_with(linkedin_url=long_url))
    assert any(
        i["field"] == "linkedin_url" and "500" in i["reason"]
        for i in invalid
    )
```

- [ ] **Step 2: Run the failing tests**

Run from `backend/`:
```bash
python -m pytest tests/test_validate_submission_mandatory_fields.py -q --no-cov
```
Expected: 7 failures — every test fails because the validator doesn't yet check the new fields. Specifically:
- `test_validate_resume_missing` will fail (no assert on resume_file_id miss)
- domain-mismatch tests will fail (no domain check)
- length test will fail (no length check beyond DB)

Capture the exact failure messages so Step 3's implementation targets them precisely.

- [ ] **Step 3: Extend `_validate_submission` in `backend/app/routers/applications.py`**

Locate `_validate_submission` at ~line 204. Inside, after the existing teammate-shape block (around line 281, just before `return missing, invalid`), insert:

```python
    # ── Identity & links (mandatory per spec 2026-05-22) ────────────
    # Presence-only via _is_filled keeps the existing missing[] semantics.
    for field in ("resume_file_id", "linkedin_url", "github_url"):
        if not _is_filled(row.get(field)):
            missing.append(field)

    # URL format & length — DB has the same regex in a CHECK constraint,
    # but we run it here so the wizard surfaces a clear error before the
    # submit hits the DB.
    li = row.get("linkedin_url")
    if li and isinstance(li, str):
        if len(li) > 500:
            invalid.append({"field": "linkedin_url",
                            "reason": "must be 500 characters or fewer"})
        elif "linkedin.com/" not in li.lower():
            invalid.append({"field": "linkedin_url",
                            "reason": "must be a linkedin.com URL"})

    gh = row.get("github_url")
    if gh and isinstance(gh, str):
        if len(gh) > 500:
            invalid.append({"field": "github_url",
                            "reason": "must be 500 characters or fewer"})
        elif "github.com/" not in gh.lower():
            invalid.append({"field": "github_url",
                            "reason": "must be a github.com URL"})
```

- [ ] **Step 4: Run the new tests — all 7 should pass**

Run from `backend/`:
```bash
python -m pytest tests/test_validate_submission_mandatory_fields.py -q --no-cov
```
Expected: `7 passed`.

- [ ] **Step 5: Run the whole applications test suite — no regressions**

Run from `backend/`:
```bash
python -m pytest tests/test_applications.py tests/test_validate_submission_mandatory_fields.py -q --no-cov 2>&1 | tail -3
```
Expected: previous green count + 7 new = total passes ≥ baseline + 7. If an existing test breaks because its fixture row no longer matches the new required fields, that fixture needs the three new fields added — but it must NOT be a soft change: re-confirm the fix matches the validator's intent.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/test_validate_submission_mandatory_fields.py backend/app/routers/applications.py
git commit -m "feat(applications): validator flags missing resume/linkedin/github + wrong-domain URLs"
```

---

## Task 3: Backend — hard-block submit when ANY of the three new fields is missing/invalid

**Files:**
- Modify: `backend/app/routers/applications.py` — the `submit_application` handler (~line 540)

Current behavior (line 579–590): logs `missing_fields` but proceeds to flip status. We add a guard BEFORE the status flip that returns 422 if any of the three new fields is in `missing` OR `invalid`. All other missing fields stay soft (don't widen the contract).

- [ ] **Step 1: Add a focused submit integration test**

Append to `backend/tests/test_validate_submission_mandatory_fields.py`:

```python
# ──────────────────────────────────────────────────────────────────
# Integration tests at the router boundary — monkey-patch the DB
# helpers so we can assert HTTP-level behaviour without Supabase.
# ──────────────────────────────────────────────────────────────────
import pytest
from fastapi.testclient import TestClient

from app.routers import applications as apps_router


@pytest.fixture
def client(monkeypatch):
    # Patch the DB helpers used inside submit_application
    fake_row = _draft_with()  # fully-valid by default; tests below override
    state = {"row": fake_row, "updated": None}

    def fake_fetch(user_id):
        return state["row"]

    def fake_update(app_id, patch):
        merged = {**state["row"], **patch}
        state["updated"] = merged
        return merged

    def fake_audit(**kwargs):
        return None

    def fake_email(*a, **kw):
        return True

    monkeypatch.setattr(apps_router, "_fetch_application", fake_fetch)
    monkeypatch.setattr(apps_router, "_update_application", fake_update)
    monkeypatch.setattr(apps_router, "_audit", fake_audit)
    # Bypass email side-effect if the handler calls one
    monkeypatch.setattr(apps_router, "_send_submission_email", fake_email, raising=False)
    # Bypass auth — use whatever the existing test harness uses; if there
    # is no shared override, the implementer should mirror what
    # tests/test_applications.py uses (search for "get_current_user"
    # overrides in that file).
    from app.main import app as fastapi_app
    from app.deps import get_current_user
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": fake_row["user_id"], "email": "test@example.com", "roles": ["applicant"],
    }
    # Bypass rate-limit deps the same way the existing app tests do
    apps_router._reset_patch_rate_limits()

    with TestClient(fastapi_app) as tc:
        yield tc, state


def test_submit_succeeds_when_all_three_fields_present(client):
    tc, state = client
    r = tc.post("/applications/me/submit")
    assert r.status_code == 200, r.text
    assert state["updated"]["status"] == "submitted"


def test_submit_blocks_when_resume_missing(client):
    tc, state = client
    state["row"]["resume_file_id"] = None
    r = tc.post("/applications/me/submit")
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "incomplete_application"
    assert "resume_file_id" in body["error"]["missing_fields"]
    assert state["updated"] is None  # status was NOT flipped


def test_submit_blocks_when_linkedin_blank(client):
    tc, state = client
    state["row"]["linkedin_url"] = ""
    r = tc.post("/applications/me/submit")
    assert r.status_code == 422
    assert "linkedin_url" in r.json()["error"]["missing_fields"]


def test_submit_blocks_when_github_wrong_domain(client):
    tc, state = client
    state["row"]["github_url"] = "https://gitlab.com/me"
    r = tc.post("/applications/me/submit")
    assert r.status_code == 422
    body = r.json()
    assert "github_url" in [i["field"] for i in body["error"]["invalid_fields"]]


def test_submit_still_lets_OTHER_missing_fields_through(client):
    """Existing soft-validation policy must remain: ONLY the 3 new fields hard-block."""
    tc, state = client
    state["row"]["problem_describe"] = ""  # an OLD field, intentionally blank
    r = tc.post("/applications/me/submit")
    assert r.status_code == 200, r.text
    assert state["updated"]["status"] == "submitted"
```

- [ ] **Step 2: Run them — all 5 should fail (since submit is still always-200)**

Run from `backend/`:
```bash
python -m pytest tests/test_validate_submission_mandatory_fields.py::test_submit_blocks_when_resume_missing tests/test_validate_submission_mandatory_fields.py::test_submit_blocks_when_linkedin_blank tests/test_validate_submission_mandatory_fields.py::test_submit_blocks_when_github_wrong_domain -q --no-cov
```
Expected: 3 failures (the "block" tests). `test_submit_succeeds_when_all_three_fields_present` and `test_submit_still_lets_OTHER_missing_fields_through` may already pass since current behavior is "always allow".

- [ ] **Step 3: Add the hard-block branch in `submit_application`**

In `backend/app/routers/applications.py`, find the soft-validation block around line 579–590:

```python
    # Soft validation — log what's missing for analytics, but do NOT
    # block the submit. Per product call, applicants can ship at any
    # completion %; the reviewer sees "not provided" for empty fields.
    missing, invalid = _validate_submission(row)
    if missing or invalid:
        log.info(
            "applications.submit accepted with gaps",
            ...
        )
```

Replace the block with:

```python
    # Validation pass — most fields stay soft per product policy
    # (applicants can ship with shallow answers; reviewers see "not
    # provided"), but the three Identity & Links fields added on
    # 2026-05-22 are hard-required.
    missing, invalid = _validate_submission(row)

    _MANDATORY_NEW = {"resume_file_id", "linkedin_url", "github_url"}
    blocking_missing = [f for f in missing if f in _MANDATORY_NEW]
    blocking_invalid = [i for i in invalid if i["field"] in _MANDATORY_NEW]
    if blocking_missing or blocking_invalid:
        log.info(
            "applications.submit blocked — mandatory fields missing/invalid",
            extra={
                "request_id": req_id,
                "user_id": user_id,
                "missing_fields": blocking_missing,
                "invalid_fields": blocking_invalid,
            },
        )
        return _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "incomplete_application",
            "Please complete required fields before submitting.",
            missing_fields=blocking_missing,
            invalid_fields=blocking_invalid,
        )

    if missing or invalid:
        log.info(
            "applications.submit accepted with gaps",
            extra={
                "request_id": req_id,
                "user_id": user_id,
                "missing_fields": sorted(set(missing)),
                "invalid_fields": invalid,
                "completion_pct": row.get("completion_pct"),
            },
        )
```

- [ ] **Step 4: Run the new tests — all 5 should pass**

Run from `backend/`:
```bash
python -m pytest tests/test_validate_submission_mandatory_fields.py -q --no-cov
```
Expected: `12 passed` (7 from Task 2 + 5 from this task).

- [ ] **Step 5: Run the full applications suite — no regressions**

Run from `backend/`:
```bash
python -m pytest tests/test_applications.py tests/test_validate_submission_mandatory_fields.py -q --no-cov 2>&1 | tail -3
```
Expected: previous green count + 12 new. If any existing `test_submit_*` now 422s where it previously 200ed, that fixture is missing the three new fields — add them per Task 2 Step 1's `_draft_with()` defaults.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/test_validate_submission_mandatory_fields.py backend/app/routers/applications.py
git commit -m "feat(applications): hard-block submit when resume/linkedin/github missing or invalid"
```

---

## Task 4: Backend — verify the grandfather-readback case

**Files:**
- Modify: `backend/tests/test_validate_submission_mandatory_fields.py` (one new test only)

Confirm that an existing submitted row with NULL values for the three new fields can still be READ via `GET /applications/me` — no validation should re-fire on read.

- [ ] **Step 1: Add the grandfather-readback test**

Append to `backend/tests/test_validate_submission_mandatory_fields.py`:

```python
def test_grandfathered_submitted_row_is_readable(monkeypatch):
    """A row submitted before the rule shipped — NULLs for all 3 fields.
    GET /applications/me must return it without re-validating."""
    from app.routers import applications as apps_router
    from app.main import app as fastapi_app
    from app.deps import get_current_user

    old_row = _draft_with(
        status="submitted",
        resume_file_id=None,
        linkedin_url=None,
        github_url=None,
        submitted_at="2026-05-01T00:00:00+00:00",
    )

    def fake_fetch(user_id):
        return old_row

    monkeypatch.setattr(apps_router, "_fetch_application", fake_fetch)
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": old_row["user_id"], "email": "old@example.com", "roles": ["applicant"],
    }
    apps_router._reset_patch_rate_limits()

    with TestClient(fastapi_app) as tc:
        r = tc.get("/applications/me")
    assert r.status_code == 200
    body = r.json()
    assert body["resume_file_id"] is None
    assert body["linkedin_url"] is None
    assert body["github_url"] is None
```

- [ ] **Step 2: Run it**

Run from `backend/`:
```bash
python -m pytest tests/test_validate_submission_mandatory_fields.py::test_grandfathered_submitted_row_is_readable -q --no-cov
```
Expected: PASS — GET never re-runs the validator.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_validate_submission_mandatory_fields.py
git commit -m "test(applications): grandfathered rows with NULL identity fields remain readable"
```

---

## Task 5: Frontend — declare the three fields in the field-map

**Files:**
- Modify: `frontend/src/lib/fieldMap.js`

The wizard renders sections by walking a field-map. Adding entries here makes the Review page auto-include the fields and gives any generic section renderer the metadata it needs.

- [ ] **Step 1: Locate the Basic-section block in `fieldMap.js`**

Run from `frontend/`:
```bash
grep -n "basic_full_name\|basic_phone\|basic_org" src/lib/fieldMap.js | head -10
```
Note the line numbers. The new entries go after the `basic_phone` entry (matching backend model order).

- [ ] **Step 2: Add the three new entries**

In `frontend/src/lib/fieldMap.js`, after the `basic_phone` field declaration in the Basic section, insert (adjust object-literal syntax to match what's already there — likely keyed by column name):

```js
  linkedin_url: {
    label: "LinkedIn URL",
    placeholder: "https://linkedin.com/in/yourname",
    type: "url",
    required: true,
    section: "basic",
    helpText: "Required. Must be a linkedin.com URL.",
  },
  github_url: {
    label: "GitHub URL",
    placeholder: "https://github.com/yourname",
    type: "url",
    required: true,
    section: "basic",
    helpText: "Required. Must be a github.com URL.",
  },
  resume_file_id: {
    label: "Resume",
    type: "file",
    required: true,
    section: "basic",
    helpText: "Required. PDF only, 5 MB max.",
  },
```

If the existing fieldMap structure differs (e.g. an array of `{name, label, …}` objects), translate the entries to match the local style. **Do not change the structure** — only add entries.

- [ ] **Step 3: Run frontend tests — no regressions**

Run from `frontend/`:
```bash
npm test -- --run 2>&1 | tail -10
```
Expected: same green count as Task 0 Step 4.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/fieldMap.js
git commit -m "feat(wizard): declare linkedin_url, github_url, resume_file_id in fieldMap"
```

---

## Task 6: Frontend — build the ResumeUploadCard component

**Files:**
- Create: `frontend/src/components/ResumeUploadCard.jsx`
- Create: `frontend/src/components/__tests__/ResumeUploadCard.test.jsx`

A self-contained component that:
- When `resumeFileId` is unset → renders an upload prompt (file picker, accepts `.pdf` only, ≤5MB)
- When set → renders a "Resume uploaded · filename · size" card with **Replace** and **Remove** buttons
- Calls `onUpload(file)` (provided by parent — wraps `useResume.upload`) on file pick after client-side validation
- Calls `onRemove()` (provided by parent — sends `PATCH /applications/me` with `resume_file_id: null`)

- [ ] **Step 1: Write the failing tests first**

Create `frontend/src/components/__tests__/ResumeUploadCard.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResumeUploadCard from "../ResumeUploadCard.jsx";

function pdfFile(name = "cv.pdf", sizeBytes = 1024) {
  const f = new File(["x".repeat(sizeBytes)], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: sizeBytes });
  return f;
}

describe("ResumeUploadCard", () => {
  it("shows the upload prompt when no resume is uploaded", () => {
    render(<ResumeUploadCard onUpload={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/Drop a PDF or click to choose/i)).toBeInTheDocument();
  });

  it("shows the uploaded card with filename + size + Replace + Remove", () => {
    render(<ResumeUploadCard
      resumeFileId="00000000-0000-0000-0000-000000000001"
      resumeFilename="alice.pdf"
      resumeSize={245678}
      onUpload={vi.fn()}
      onRemove={vi.fn()}
    />);
    expect(screen.getByText("alice.pdf")).toBeInTheDocument();
    expect(screen.getByText(/240\s*KB|245\.7\s*KB/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /replace/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("rejects non-PDF files with a toast/error", () => {
    const onUpload = vi.fn();
    render(<ResumeUploadCard onUpload={onUpload} onRemove={vi.fn()} />);
    const input = screen.getByLabelText(/upload resume/i, { selector: "input" });
    const txt = new File(["hi"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [txt] } });
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText(/PDF only/i)).toBeInTheDocument();
  });

  it("rejects files larger than 5MB", () => {
    const onUpload = vi.fn();
    render(<ResumeUploadCard onUpload={onUpload} onRemove={vi.fn()} />);
    const input = screen.getByLabelText(/upload resume/i, { selector: "input" });
    const big = pdfFile("big.pdf", 6 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [big] } });
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText(/5\s*MB/i)).toBeInTheDocument();
  });

  it("calls onUpload with the picked PDF", () => {
    const onUpload = vi.fn();
    render(<ResumeUploadCard onUpload={onUpload} onRemove={vi.fn()} />);
    const input = screen.getByLabelText(/upload resume/i, { selector: "input" });
    const pdf = pdfFile("ok.pdf", 1024);
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0].name).toBe("ok.pdf");
  });

  it("Remove triggers onRemove", () => {
    const onRemove = vi.fn();
    render(<ResumeUploadCard
      resumeFileId="00000000-0000-0000-0000-000000000001"
      resumeFilename="alice.pdf"
      resumeSize={1024}
      onUpload={vi.fn()}
      onRemove={onRemove}
    />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them — all 6 fail (no component yet)**

Run from `frontend/`:
```bash
npm test -- --run ResumeUploadCard
```
Expected: 6 failures, all from missing module.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/ResumeUploadCard.jsx`:

```jsx
import { useRef, useState } from "react";

const MAX_BYTES = 5 * 1024 * 1024;

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function ResumeUploadCard({
  resumeFileId,
  resumeFilename,
  resumeSize,
  onUpload,
  onRemove,
}) {
  const inputRef = useRef(null);
  const [error, setError] = useState("");

  const pick = () => inputRef.current?.click();

  const handleFile = (file) => {
    setError("");
    if (!file) return;
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (!isPdf) {
      setError("PDF only — please choose a .pdf file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Max 5 MB — please shrink the PDF or split into pages.");
      return;
    }
    onUpload(file);
  };

  if (resumeFileId) {
    return (
      <div className="resume-card resume-card-filled">
        <div className="resume-card-row">
          <span className="resume-card-name">{resumeFilename || "Resume on file"}</span>
          {typeof resumeSize === "number" && (
            <span className="resume-card-size">{formatSize(resumeSize)}</span>
          )}
        </div>
        <div className="resume-card-actions">
          <button type="button" className="btn-secondary" onClick={pick}>Replace</button>
          <button type="button" className="btn-ghost" onClick={onRemove}>Remove</button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Upload resume"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {error && <div className="resume-card-error" role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <div className="resume-card resume-card-empty">
      <button type="button" className="resume-card-dropzone" onClick={pick}>
        Drop a PDF or click to choose
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Upload resume"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error && <div className="resume-card-error" role="alert">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests — all 6 pass**

Run from `frontend/`:
```bash
npm test -- --run ResumeUploadCard
```
Expected: 6 pass.

- [ ] **Step 5: Add minimal CSS for the new classes**

In `frontend/src/styles/wizard.css` (or wherever wizard-section styles live — check `grep -rn "wizard\|section-page" frontend/src/styles` to find the right file), append:

```css
.resume-card { display: flex; flex-direction: column; gap: 8px; padding: 14px;
  border: 1px dashed var(--line); border-radius: 6px; background: var(--surface-soft); }
.resume-card-empty .resume-card-dropzone { background: transparent; border: none;
  color: var(--ink-dim); font: inherit; cursor: pointer; padding: 10px; text-align: center; }
.resume-card-empty .resume-card-dropzone:hover { color: var(--ink); }
.resume-card-row { display: flex; gap: 12px; align-items: baseline; }
.resume-card-name { font-weight: 500; color: var(--ink); }
.resume-card-size { font-size: 12px; color: var(--ink-dim); }
.resume-card-actions { display: flex; gap: 8px; }
.resume-card-error { color: var(--coral); font-size: 12px; }
```

If the project's CSS variables differ (`--surface-soft`, `--ink-dim`, `--coral`), use the closest equivalents already used by other wizard cards in the codebase.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ResumeUploadCard.jsx \
        frontend/src/components/__tests__/ResumeUploadCard.test.jsx \
        frontend/src/styles/wizard.css
git commit -m "feat(wizard): ResumeUploadCard component with PDF + 5MB client-side checks"
```

---

## Task 7: Frontend — wire LinkedIn + GitHub inputs and ResumeUploadCard into the Basic section

**Files:**
- Modify: the file rendering the Basic section. Locate it with the search below.

- [ ] **Step 1: Find the Basic-section renderer**

Run from `frontend/`:
```bash
grep -rn "basic_phone\|basic_org" src --include="*.jsx" --include="*.js" -l 2>&1 | grep -v __tests__ | head -5
```
Expected files to investigate (verify before editing): `src/App.jsx`, `src/auth_upload.jsx`, possibly a `BasicSection.jsx` if one exists. Look for where the field labelled `basic_phone` renders an `<input>` with a `name` attribute — that's the row the new fields anchor to.

- [ ] **Step 2: Inspect the patch-trigger pattern (for the URL inputs)**

In the chosen file, look for how an existing text field like `basic_org` saves to the draft. Typical pattern in this codebase: `onChange` updates local state, `onBlur` calls `patchApplication({basic_org: value})`. Use the same pattern for the two new URL inputs.

- [ ] **Step 3: Add the LinkedIn + GitHub inputs**

In the Basic-section render, right after the `basic_phone` field, add a subheading and the two new inputs:

```jsx
<div className="wizard-subheading">Identity &amp; links</div>

<label className="field">
  <span className="field-label">LinkedIn URL <span className="required-mark">*</span></span>
  <input
    type="url"
    name="linkedin_url"
    placeholder="https://linkedin.com/in/yourname"
    value={application?.linkedin_url || ""}
    onChange={(e) => setLocal({ ...local, linkedin_url: e.target.value })}
    onBlur={(e) => patchApplication({ linkedin_url: e.target.value })}
    aria-describedby="linkedin-help"
    className={
      application?.linkedin_url &&
      !application.linkedin_url.toLowerCase().includes("linkedin.com/")
        ? "field-input field-input-invalid"
        : "field-input"
    }
  />
  <span id="linkedin-help" className="field-help">
    Required. Must be a linkedin.com URL.
  </span>
  {application?.linkedin_url &&
    !application.linkedin_url.toLowerCase().includes("linkedin.com/") && (
      <span className="field-error">Enter a linkedin.com URL.</span>
    )}
</label>

<label className="field">
  <span className="field-label">GitHub URL <span className="required-mark">*</span></span>
  <input
    type="url"
    name="github_url"
    placeholder="https://github.com/yourname"
    value={application?.github_url || ""}
    onChange={(e) => setLocal({ ...local, github_url: e.target.value })}
    onBlur={(e) => patchApplication({ github_url: e.target.value })}
    aria-describedby="github-help"
    className={
      application?.github_url &&
      !application.github_url.toLowerCase().includes("github.com/")
        ? "field-input field-input-invalid"
        : "field-input"
    }
  />
  <span id="github-help" className="field-help">
    Required. Must be a github.com URL.
  </span>
  {application?.github_url &&
    !application.github_url.toLowerCase().includes("github.com/") && (
      <span className="field-error">Enter a github.com URL.</span>
    )}
</label>
```

(Class names like `field`, `field-label`, `field-input` should match the codebase's existing form-input pattern. If different names are in use, swap to those — do not introduce a new naming convention.)

- [ ] **Step 4: Add the ResumeUploadCard**

After the two URL inputs, render the resume card. Wire it to the existing `useResume` hook:

```jsx
import ResumeUploadCard from "../components/ResumeUploadCard.jsx";
import { useResume } from "../hooks/useResume.js";
// ... inside the Basic-section component ...
const resume = useResume();  // existing hook — exposes upload(file) and returns file_id

<label className="field">
  <span className="field-label">Resume <span className="required-mark">*</span></span>
  <ResumeUploadCard
    resumeFileId={application?.resume_file_id}
    resumeFilename={resume.filename || application?.resume_filename}
    resumeSize={resume.size || application?.resume_size}
    onUpload={async (file) => {
      const result = await resume.upload(file);   // returns { file_id, filename, size }
      if (result?.file_id) {
        await patchApplication({ resume_file_id: result.file_id });
      }
    }}
    onRemove={() => patchApplication({ resume_file_id: null })}
  />
  <span className="field-help">Required. PDF only, 5 MB max.</span>
</label>
```

Verify by reading `frontend/src/hooks/useResume.js` that `upload()` returns `{file_id, filename, size}` — if the shape differs, adjust the call accordingly.

- [ ] **Step 5: Run frontend tests — no regressions**

Run from `frontend/`:
```bash
npm test -- --run 2>&1 | tail -10
```
Expected: previous green count + the 6 from Task 6 = total ≥ baseline + 6.

- [ ] **Step 6: Manual smoke in dev (very quick)**

Run from `frontend/`:
```bash
npm run dev
```
Open `http://localhost:5173/apply/basic` (after signing in as any user) and confirm:
- The two URL inputs are visible with the asterisk
- The Resume card renders
- Typing an invalid URL into LinkedIn and tabbing out shows the red error

Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.jsx frontend/src/auth_upload.jsx  # or whichever file you edited
git commit -m "feat(wizard): Identity & links — LinkedIn + GitHub inputs + ResumeUploadCard in Basic"
```

---

## Task 8: Backend + frontend — confirm baseline + green tests pass together

**Files:** none (verification only)

- [ ] **Step 1: Backend full suite**

Run from `backend/`:
```bash
python -m pytest tests/test_applications.py tests/test_validate_submission_mandatory_fields.py -q --no-cov 2>&1 | tail -3
```
Expected: green; ≥ baseline + 13 (12 from Task 2/3, 1 from Task 4).

- [ ] **Step 2: Frontend full suite**

Run from `frontend/`:
```bash
npm test -- --run 2>&1 | tail -5
```
Expected: green; ≥ baseline + 6.

- [ ] **Step 3: Frontend build (catches syntax/TS issues that runtime tests miss)**

Run from `frontend/`:
```bash
npm run build 2>&1 | tail -10
```
Expected: clean build, `built in <Xms>`. If errors, fix and re-run before deploying.

---

## Task 9: Deploy to STAGING

**Files:** none (deployment only)

- [ ] **Step 1: Push current commits to origin/staging**

Run from repo root:
```bash
git push origin staging
```
Expected: fast-forward push lands. If rejected (someone else pushed), `git pull --rebase origin staging` and re-push.

- [ ] **Step 2: Deploy the backend Lambda**

Run from repo root:
```bash
cd infra/sam && ./deploy-staging.sh
```
Wait for `Successfully created/updated stack`. Verify the Lambda's `LastModified` is current:
```bash
aws lambda get-function --function-name artpark-eir-api-staging --region ap-south-1 --query "Configuration.LastModified"
```

- [ ] **Step 3: Confirm Vercel staging frontend has the new commit**

Open the Vercel dashboard, find the staging-branch deployment, confirm the commit hash matches the head of `staging`. Vercel auto-deploys on git push. If it didn't, manually trigger via the dashboard.

---

## Task 10: Staging E2E walkthrough (14 manual steps)

**Files:** none (manual QA)

Run through the spec's §6.3 walkthrough verbatim on the staging Vercel URL:

- [ ] **Step 1: Sign in to staging as a fresh test user**
- [ ] **Step 2: Start a new TIR application → go to Basic step**
- [ ] **Step 3: Confirm the three new fields appear with `*` markers**
- [ ] **Step 4: Try to submit with all three blank → expect missing-fields toast listing all three**
- [ ] **Step 5: Type `https://example.com` into LinkedIn, blur → expect red border + error text**
- [ ] **Step 6: Type `https://linkedin.com/in/test` → error clears**
- [ ] **Step 7: Upload a `.txt` file → expect "PDF only" toast, no upload happens**
- [ ] **Step 8: Upload a real PDF → expect Resume card with filename + size**
- [ ] **Step 9: Click Replace → upload different PDF → card updates**
- [ ] **Step 10: Click Remove → card returns to upload prompt; re-uploading works**
- [ ] **Step 11: Fill GitHub with valid URL**
- [ ] **Step 12: Click Submit → expect success**
- [ ] **Step 13: Reload leadership dashboard → confirm new app appears with the three fields visible on detail**
- [ ] **Step 14: Open an OLD submitted app (NULL fields) → confirm it still loads, fields shown as `—`, no errors**

If any step fails, fix the issue in source, re-deploy steps 2-3 of Task 9, and re-run from the failing step.

---

## Task 11: Deploy to PRODUCTION

**Files:** none (deployment only)

**Gate:** Task 10 must be 100% green before doing any step here.

**⚠ CRITICAL CONSTRAINTS (per user 2026-05-22):**

1. Do NOT merge the staging branch into main. The staging branch contains many other in-flight changes (SIP work, role-based dashboard, etc.) that are not ready for production. Only this single feature ships.
2. Do NOT cherry-pick the staging commits onto main verbatim either. Staging and production have **divergent schemas** — different table names, different routers, different code paths. Cherry-picking would break prod immediately because every DB call would reference a table that doesn't exist.
3. Re-implement the same logical change against the prod schema, run the tests, deploy, then test rigorously.

| | Staging | Production |
|---|---|---|
| TIR applications table | `tir_applications` (post migration 010) | `applications` (pre migration 010 — legacy) |
| Resume uploads table | `tir_resume_uploads` | `resume_uploads` (verify on disk before editing) |
| Storage bucket name | `tir-resumes` (probable) | `resumes` (verify) |
| Backend code | references `tir_*` everywhere | references bare names |
| Frontend code | identical (DB-agnostic) | identical (DB-agnostic) |

So the prod path **reimplements** the same logical changes against the prod code paths. Migration 019 already shipped to prod with the correct schema (the `_prod.sql` variant — confirmed applied). Frontend changes will likely apply cleanly because they don't touch DB names — but each frontend cherry-pick must be verified.

- [ ] **Step 1: Identify the prod-deploy branch + verify prod-code shape**

```bash
git checkout main
git pull --ff-only origin main
# What does prod actually call its tables?
grep -rn '"applications"\|"resume_uploads"\|"tir_applications"\|"tir_resume_uploads"' \
  backend/app/routers/applications.py backend/app/routers/resume.py | head -20
```
Record the exact table names prod uses. The reimplementation must match these.

- [ ] **Step 2: Re-implement the backend Pydantic schema additions on main**

Cherry-pick the Pydantic-only commits — these are DB-agnostic and should apply cleanly:
```bash
git cherry-pick f90e1ee 496f6ee   # Task 1 + Task 1 polish
```
If conflict, resolve in favor of adding the three fields + the `_MAX_PROFILE_URL` constant.

Verify with `python -c "from app.models.application import ApplicationRead, ApplicationUpdate; print('OK')"` from `backend/`.

- [ ] **Step 3: Re-implement the backend validator on main**

The validator block from `_validate_submission` is DB-agnostic — it operates on plain dicts. Cherry-pick:
```bash
git cherry-pick 40f5e5a   # Task 2: validator block + 7 unit tests
```
The 7 unit tests are pure-function tests so they don't care about prod table names. Run:
```bash
cd backend && python -m pytest tests/test_validate_submission_mandatory_fields.py -v --no-cov
```
Expect 7 passes.

- [ ] **Step 4: Re-implement the hard-block + analytics polish + _MANDATORY_FIELDS constant**

```bash
git cherry-pick d26a176 b73d050   # Task 3 + Task 3 polish
```
The handler change references `_validate_submission` (already in) and uses `_error()`. No DB names involved. Submit-integration tests use monkey-patched `_fetch_application` so they don't hit prod DB either.

Run `python -m pytest tests/test_validate_submission_mandatory_fields.py` — expect 12 passes.

- [ ] **Step 5: Grandfather readback test**

```bash
git cherry-pick f43c995   # Task 4
```
This test monkeypatches `_fetch_application` — DB-agnostic. Should apply cleanly. Run — expect 13 passes.

- [ ] **Step 6: REIMPLEMENT the resume-link logic against prod table names**

DO NOT cherry-pick commit `28b97fb` (or `836cba6` on the older staging history) verbatim — it hard-codes `tir_resume_uploads` and `tir_applications`. Instead:

a) Open the prod version of `backend/app/routers/resume.py` and find the `apply_parsed_to_application` handler.
b) Apply the SAME logical change as the staging commit, but with prod's table names:
   - Add `id` to the `.select(...)` from the resume uploads table (whatever prod calls it)
   - Extract `resume_file_id = rows[0]["id"]`
   - After the existing `for src, dest in APPLICATION_MAP:` loop, inside the `else: app_row = app_rows[0]` branch, add:
     ```python
     if app_row.get("resume_file_id") != resume_file_id:
         app_patch["resume_file_id"] = resume_file_id
         applied.append("applications.resume_file_id")
     ```
   - Update the second-stage `.table(...)` call so it targets the prod applications table.
c) Re-implement the storage-existence check from `78a2bc0` (Task 7 polish) — same logic, but the `.table("tir_resume_uploads")` becomes whatever prod calls it.
d) Write fresh tests against prod table names. Don't reuse the staging test file verbatim — copy + rename the table strings.

- [ ] **Step 7: Re-cherry-pick frontend changes (DB-agnostic)**

Frontend doesn't reference DB names:
```bash
git cherry-pick 7c90b5a   # Task 5: fieldMap entries
git cherry-pick f022ccf   # Task 6: ResumeUploadCard component (on shelf)
# Skip 28b97fb (Task 7 backend bits already covered in Step 6 with prod names)
# But take its FRONTEND bits — the questions in questions.jsx
git show 28b97fb -- frontend/src/questions.jsx | git apply
git cherry-pick 78a2bc0   # Polish — frontend inputs.jsx blur-time validation is DB-agnostic
```
If `git apply` doesn't work cleanly, manually port the two `linkedinUrl` + `githubUrl` question objects into `frontend/src/questions.jsx`.

- [ ] **Step 8: Run full prod test suite**

```bash
cd backend && python -m pytest tests/ -q --no-cov -m "not integration" 2>&1 | tail -10
cd ../frontend && npm test -- --run 2>&1 | tail -5
cd frontend && npm run build 2>&1 | tail -5
```
All NEW tests must pass. Pre-existing failures (if any) must match the prod-baseline pre-existing-failure count — record before/after.

- [ ] **Step 9: Push main**

```bash
git push origin main
```
This triggers Vercel's production deploy automatically.

- [ ] **Step 10: Backend Lambda — prod stack**

Run from `infra/sam/`:
```bash
./deploy-prod.sh
```
(If the script doesn't exist, mirror `deploy-staging.sh` against the prod stack name — confirm with the user before creating it.) Wait for `Successfully created/updated stack`.

- [ ] **Step 11: Confirm prod Lambda last-modified is current**

```bash
aws lambda get-function --function-name artpark-eir-api --region ap-south-1 --query "Configuration.LastModified"
```
(Adjust function name to match the prod stack outputs.)

---

## Task 12: Prod smoke test — full regression, not just our feature

**Files:** none (manual QA)

Per user 2026-05-22: **rigorously test the entire wizard and all existing features**, not just what we changed. The schema-aware reimplementation against the prod codebase could regress unrelated paths because the reimplementation touched code that lots of features depend on (the submit handler, the resume-apply handler). An applicant must not face any issue due to our work.

This task has two halves:

- **Part A — Feature smoke (our changes work)** — Steps 1–12 below
- **Part B — Whole-wizard regression (nothing else broke)** — Steps 13–28 below

Use a throwaway account on the prod URL. Each step should be ticked only after a real-browser verification.

### Happy paths

- [ ] **Step 1: Sign in fresh** — create a new account or sign in with a throwaway. Confirm the wizard loads.
- [ ] **Step 2: Resume upload phase still works** — the existing pre-wizard CV upload screen must accept a PDF and parse it as before. (Sanity check: my changes to `apply-to-application` could break the existing path if I touched the wrong line.)
- [ ] **Step 3: Click "apply to application"** — verify the parsed data still lands in the application row (basic_full_name, phone, email), AND verify `resume_file_id` is now populated on the row. Confirm via Supabase prod SQL:
  ```sql
  SELECT resume_file_id, basic_full_name, basic_email
    FROM applications
   WHERE user_id = '<your-throwaway-user-id>' AND status='draft';
  ```
- [ ] **Step 4: Confirm Basic step shows the three new fields** with the required asterisk.
- [ ] **Step 5: Fill LinkedIn and GitHub with valid URLs** → tab away → no red border, no error text.

### Negative paths (must hard-block)

- [ ] **Step 6: Try to submit with all three blank** — the wizard's Next button on Basic shouldn't allow advancing without the URLs (per polish commit). Force a direct POST if possible — expect 422 with all three field names in `missing_fields`.
- [ ] **Step 7: Set LinkedIn to `https://example.com` and tab away** — expect red border + inline "Enter a valid linkedin.com URL" hint AND wizard Next button disabled. Same for GitHub with `https://gitlab.com/foo`.
- [ ] **Step 8: Submit with a real but malicious `resume_file_id`** — open browser DevTools, PATCH `/applications/me` with `resume_file_id = "12345678-1234-1234-1234-123456789abc"` (a random UUID). Then try to submit. Expect 422 with `invalid_fields` mentioning `resume_file_id` and "no matching upload on file" — proves the storage-existence check works in prod.

### Grandfathered row sanity

- [ ] **Step 9: Open an EXISTING submitted application** (one of the 87 grandfathered ones) via the leadership dashboard or admin route. Confirm:
  - The detail page loads with no errors
  - `resume_file_id`, `linkedin_url`, `github_url` all render as `—` or empty
  - No re-validation fires (no 422)

### AI flow sanity

- [ ] **Step 10: Submit a fresh complete application** with all three fields filled. Verify:
  - Submit returns 200
  - Application row's status flips to `submitted`
  - If AI screening runs automatically: confirm it doesn't choke on the new columns
  - Submission confirmation email goes out (existing behavior unchanged)

### Audit trail

- [ ] **Step 11: Check `audit_logs` table** for the new applicant's row:
  ```sql
  SELECT action, metadata->'applied_fields' AS applied
    FROM audit_logs
   WHERE user_id = '<throwaway-user-id>'
   ORDER BY created_at DESC LIMIT 5;
  ```
  Confirm `resume.applied_to_application` audit entry includes `applications.resume_file_id` in the applied list.

### Part B — Whole-wizard regression (nothing else broke)

This part exercises every other applicant-facing path that our changes could have inadvertently touched. Use a SECOND throwaway account so Part A's state doesn't bleed into these tests.

**Auth + sign-up**
- [ ] **Step 13: Email + password sign-up** — new account creation works; verification email arrives; password set succeeds.
- [ ] **Step 14: OTP sign-in** — request OTP; receive email; enter code; land in wizard. (Common login path; could regress if the auth router shares any helpers we touched.)
- [ ] **Step 15: Password sign-in** — old account with password signs in fine.
- [ ] **Step 16: Forgot password** — reset email sends; new password works.

**CV upload + parse (pre-wizard)**
- [ ] **Step 17: First-time CV upload** — clean account uploads a PDF; backend parses successfully; PARSE_REVIEW screen shows extracted name + email + phone.
- [ ] **Step 18: CV apply-to-application** — clicking "use this CV" populates the draft AND the new `resume_file_id` column without error. Already covered as Step 3 in Part A but verify the unhappy path: an unparseable PDF (just blanks).

**Wizard navigation**
- [ ] **Step 19: Basic section — every existing field** — fullName, email, phone, org, degree, hasTeam, incubatorAssociation, incubatorDetails (conditional), hearAbout. Type / pick / save each one. Confirm no field breaks because the form's onChange/onBlur pattern got touched.
- [ ] **Step 20: TeamInvite question (when `hasTeam = Yes`)** — add a teammate; backend saves the JSONB array; reload preserves it.
- [ ] **Step 21: Problem section** — problemDescribe (long-text with 80 minWords), problemDefined (single). Both save and validate as before.
- [ ] **Step 22: Solution section** — solutionDescribe, coreTech, stage, contrarianInsight (optional). All render and save.
- [ ] **Step 23: Execution section** — milestone, infrastructure, failure, hwswIntegration, will-break (conditional on stage), budget. All five long-text fields accept input and save.
- [ ] **Step 24: Evidence section** — videoUrl (optional), deck, evidenceFiles, milestoneFiles. Upload one file to each multi-file question. Confirm uploads still hit Supabase storage and the file IDs land on the application row.
- [ ] **Step 25: Declarations** — tick truthful + refChecks + terms. Newsletter optional. Submit becomes enabled only when the three required boxes are ticked.

**Submission + post-submit**
- [ ] **Step 26: Successful submit** — already done as Step 10. Verify the confirmation email arrives (existing flow — could regress if the submit handler change broke email side effect).
- [ ] **Step 27: Submitted page** — `/apply/submitted` loads with the application number, status badge, and a "view your application" link. No crash on the new fields.
- [ ] **Step 28: Returning user — past application** — sign out, sign back in, confirm the wizard correctly detects the previously-submitted application and routes to the post-submit chooser (TIR + SIP if applicable). The chooser must not crash on the new fields.

### Existing leadership / admin / reviewer paths (only if you have access)

- [ ] **Step 29: Leadership dashboard `/leadership`** — loads; the applications list shows the new submission; row click opens the detail view with `resume_file_id`, `linkedin_url`, `github_url` populated.
- [ ] **Step 30: Admin user management `/admin/users`** — list still loads; existing users editable.
- [ ] **Step 31: Reviewer inbox** — if assigned, the application appears; opening it shows all fields including the new three.

### Cross-cutting health checks

- [ ] **Step 32: API health** — `GET https://api.artpark.info/health` returns `{"status":"ok"}`.
- [ ] **Step 33: Lambda CloudWatch logs** — no 5xx spikes since deploy time. Search for `ERROR` and `applications.submit blocked` for the last 10 minutes.
- [ ] **Step 34: Supabase prod DB integrity** — quick spot check:
  ```sql
  -- No NULLs sneaking into submitted rows after the rule shipped:
  SELECT count(*) AS new_submits_missing_fields
    FROM applications
   WHERE status != 'draft'
     AND submitted_at >= '2026-05-22 12:00:00+00'
     AND (resume_file_id IS NULL OR linkedin_url IS NULL OR github_url IS NULL);
  -- Expected: 0 (rule enforces this for fresh submits).
  ```

### If ANY step fails

1. Revert the Vercel prod deployment (Vercel dashboard → "Promote previous deployment") — instant.
2. Redeploy previous Lambda version from CloudFormation rollback or `aws lambda update-function-code` against the previous S3 artifact.
3. The DB columns stay in place — they're NULL-allowed and harmless. NOT a rollback target.
4. File a bug with: failing step number, observed vs expected, screenshot, the SQL row that caused it, and Lambda log excerpt.

- [ ] **Step 35: Tag the rollout**

Once ALL 34 prior steps pass (12 feature + 16 wizard regression + 3 leadership/admin + 3 health):
```bash
git tag mandatory-identity-fields-prod-2026-05-22
git push origin mandatory-identity-fields-prod-2026-05-22
```

---

## Self-review checklist (already run by the planner)

- **Spec §3 schema:** ✅ Tasks 0 verify columns; migrations were already applied before this plan.
- **Spec §4 backend validator:** ✅ Tasks 1–4 cover model fields, validator extension, hard-block branch at submit, grandfather readback.
- **Spec §5 frontend wizard:** ✅ Tasks 5–7 cover fieldMap, ResumeUploadCard component, Basic-section integration.
- **Spec §6.1 backend tests:** ✅ Task 2 (validator unit) + Task 3 (submit integration) + Task 4 (grandfather GET) cover all 7 cases listed in spec §6.1.
- **Spec §6.2 frontend tests:** ✅ Task 6 covers all 6 cases listed in spec §6.2.
- **Spec §6.3 staging E2E:** ✅ Task 10 is the 14-step list verbatim.
- **Spec §6.4 prod smoke:** ✅ Task 12 is the 5-step list verbatim.
- **Spec §7 rollout order:** ✅ Tasks 1–8 (code) → 9 (staging deploy) → 10 (staging E2E) → 11 (prod deploy) → 12 (prod smoke), matches §7's table.
- **Spec §8 out-of-scope:** ✅ No SIP work, no admin/reviewer/leadership work, no profile.linkedin_url removal, no GitHub-API verification — only the additions listed.
