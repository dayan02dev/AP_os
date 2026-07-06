# TIR Evidence Re-collection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Email affected `under_review` TIR applicants a no-login link to re-upload their evidence files, stored back into `tir_applications.evidence_files` so they reappear in all three portals.

**Architecture:** Extend the shipped profile-completion token flow with an evidence mode — a `needs_evidence` token, a multi-file public submit that uploads to `tir-evidence-files` and rebuilds `evidence_files` (prune dead + append new), a dedicated admin send (sample + explicit app-id list), and an evidence email. Reuses the same token table, form page, and email infra.

**Tech Stack:** FastAPI + supabase-py (service-role), React/Vite, pytest + Vitest. Worktree: `.claude/worktrees/feat-evidence-recollection`. Backend tests via `/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest … --no-cov`. Spec: `docs/superpowers/specs/2026-07-06-evidence-recollection-design.md`.

---

### Task 1: Migration 032 — `needs_evidence` column

**Files:** Create `backend/migrations/032_profile_completion_needs_evidence.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 032: evidence re-collection tokens
ALTER TABLE profile_completion_tokens
  ADD COLUMN IF NOT EXISTS needs_evidence boolean NOT NULL DEFAULT false;
```
- [ ] **Step 2: Commit** (applied in Supabase SQL editor at rollout, like migs 030/031)
```bash
git add backend/migrations/032_profile_completion_needs_evidence.sql
git commit -m "feat(evidence): migration 032 — needs_evidence on profile_completion_tokens"
```

---

### Task 2: Service — `needs_evidence` token flag + `store_evidence_submission`

**Files:** Modify `backend/app/services/profile_completion_service.py` · Test `backend/tests/test_profile_completion_service.py`

- [ ] **Step 1: Failing tests** (append to `test_profile_completion_service.py`; mirror its existing fake-client style)
```python
def test_create_token_persists_needs_evidence():
    fake = _FakeClient({"profile_completion_tokens": []})
    svc.create_token(fake, application_id="app-1", needs_resume=False,
                     needs_linkedin=False, needs_evidence=True, sent_to="x@x.com")
    row = fake.tables["profile_completion_tokens"][0]
    assert row["needs_evidence"] is True

def test_store_evidence_prunes_dead_keeps_live_appends_new():
    # existing evidence_files: one live (keepA), one dead (deadB). exists_fn marks deadB missing.
    fake = _FakeClient({"tir_applications": [{
        "id": "app-1", "user_id": "u-1",
        "evidence_files": [
            {"file_uuid": "A", "path": "u-1/evidence/A.pdf", "name": "a.pdf", "size": 1, "mime": "application/pdf", "uploaded_at": "t"},
            {"file_uuid": "B", "path": "u-1/evidence/B.pdf", "name": "b.pdf", "size": 1, "mime": "application/pdf", "uploaded_at": "t"},
        ]}]})
    exists = lambda bucket, path: path != "u-1/evidence/B.pdf"   # B is dead
    out = svc.store_evidence_submission(
        fake, application_id="app-1", owner_user_id="u-1",
        files=[{"bytes": b"x", "filename": "new.jpg", "mime": "image/jpeg"}],
        exists_fn=exists)
    saved = fake.tables["tir_applications"][0]["evidence_files"]
    uuids = {e["file_uuid"] for e in saved}
    assert "A" in uuids and "B" not in uuids           # live kept, dead pruned
    assert any(e["path"].endswith(".jpg") for e in saved)  # new appended
    assert out == {"added": 1, "pruned": 1, "kept": 1}

def test_store_evidence_rejects_bad_mime():
    import pytest
    fake = _FakeClient({"tir_applications": [{"id": "app-1", "user_id": "u-1", "evidence_files": []}]})
    with pytest.raises(ValueError):
        svc.store_evidence_submission(fake, application_id="app-1", owner_user_id="u-1",
            files=[{"bytes": b"x", "filename": "x.exe", "mime": "application/x-msdownload"}],
            exists_fn=lambda *_: True)
```
- [ ] **Step 2: Run → FAIL** `… -m pytest tests/test_profile_completion_service.py -x -q --no-cov` (missing `needs_evidence` / `store_evidence_submission`).
- [ ] **Step 3: Add `needs_evidence` to `create_token`** — signature `def create_token(client, *, application_id, needs_resume, needs_linkedin, needs_evidence: bool = False, sent_to, is_preview=False)`; add `"needs_evidence": needs_evidence,` to the inserted dict.
- [ ] **Step 4: Add evidence constants + existence check + `store_evidence_submission`** (near the résumé consts):
```python
import uuid, httpx
_EVIDENCE_BUCKET = "tir-evidence-files"
_EVIDENCE_MIME_TO_EXT = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024

def _bytes_exist(client, bucket: str, path: str) -> bool:
    """True if the object's bytes serve. Conservative: unknown/error -> True
    (never prune a file we can't confirm is missing)."""
    try:
        s = client.storage.from_(bucket).create_signed_url(path, 120)
        url = s.get("signedURL") or s.get("signedUrl") or s.get("url")
        if not url:
            return True
        if url.startswith("/"):
            import os as _os
            url = _os.environ["SUPABASE_URL"] + url
        return httpx.get(url, headers={"Range": "bytes=0-0"}, timeout=20).status_code in (200, 206)
    except Exception:
        return True

def store_evidence_submission(client, *, application_id, owner_user_id, files, exists_fn=_bytes_exist) -> dict:
    """Upload each evidence file, then rebuild evidence_files = (existing whose
    bytes still resolve) + (new). Prunes dead entries. Raises ValueError on a bad file."""
    new_entries = []
    for f in files:
        m = (f.get("mime") or "").lower()
        if m not in _EVIDENCE_MIME_TO_EXT:
            raise ValueError(f"unsupported_mime:{m}")
        data = f["bytes"]
        if len(data) > _EVIDENCE_MAX_BYTES:
            raise ValueError("file_too_large")
        ext = _EVIDENCE_MIME_TO_EXT[m]
        fid = str(uuid.uuid4())
        path = f"{owner_user_id}/evidence/{fid}.{ext}"
        client.storage.from_(_EVIDENCE_BUCKET).upload(
            path=path, file=data, file_options={"content-type": m})
        new_entries.append({"file_uuid": fid, "path": path,
            "name": f.get("filename") or f"evidence-{fid[:8]}.{ext}",
            "size": len(data), "mime": m, "uploaded_at": _now().isoformat()})

    rows = (client.table("tir_applications").select("id,evidence_files")
            .eq("id", application_id).limit(1).execute().data) or []
    existing = list((rows[0].get("evidence_files") if rows else None) or [])
    kept = [e for e in existing if isinstance(e, dict) and e.get("path")
            and exists_fn(_EVIDENCE_BUCKET, e["path"])]
    pruned = len(existing) - len(kept)
    client.table("tir_applications").update(
        {"evidence_files": [*kept, *new_entries]}).eq("id", application_id).execute()
    return {"added": len(new_entries), "pruned": pruned, "kept": len(kept)}
```
- [ ] **Step 5: Run → PASS** the three tests, then the whole file.
- [ ] **Step 6: Commit** `feat(evidence): needs_evidence token + store_evidence_submission (prune dead + append)`

---

### Task 3: Router — token state, multi-file submit, admin evidence send

**Files:** Modify `backend/app/routers/profile_completion.py` · Test `backend/tests/test_profile_completion_router.py`

- [ ] **Step 1: Failing tests** (append):
```python
def test_public_submit_evidence_stores_files(monkeypatch, client_fixture):
    # token with needs_evidence -> POST multiple files -> store_evidence_submission called
    # (mirror the file-upload test already in this module; assert 200 + saved counts)
    ...
def test_admin_evidence_send_sample(monkeypatch, client_fixture):
    # POST /admin/evidence-recollection/send {mode:"sample", sample_email:"udayanpawar03@gmail.com"}
    # -> mints needs_evidence preview token + calls send_evidence_recollection once
    ...
def test_admin_evidence_send_list_dry_run(monkeypatch, client_fixture):
    # {mode:"list", application_ids:["app-1","app-2"], dry_run:true} -> matched:2, sent:0
    ...
```
*(Fill each body by mirroring the existing `submit_form` / `send_requests` tests in this file — same fixtures, monkeypatched `svc`/`get_email_service`.)*
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: `get_token_state`** — add `"needs_evidence": bool(row.get("needs_evidence")),` to the returned dict.
- [ ] **Step 4: Multi-file public submit** — change the public POST to also accept evidence files and route on the token:
```python
@router.post("/profile-completion/{token}")
@limiter.limit("10/hour", key_func=_pc_key)
async def submit_form_route(
    token: str, request: Request,
    file: UploadFile | None = File(None),
    files: list[UploadFile] | None = File(None),
    linkedin_url: str | None = Form(None),
) -> dict:
    return await submit_form(token, file=file, files=files, linkedin_url=linkedin_url)
```
In `submit_form`, after validating the token/app: if `row.get("needs_evidence")` and `files`:
```python
    if row.get("needs_evidence"):
        ups = files or ([file] if file else [])
        if not ups:
            raise HTTPException(status_code=422, detail={"code": "nothing_provided"})
        payload = [{"bytes": await u.read(), "filename": u.filename, "mime": u.content_type} for u in ups]
        try:
            saved = svc.store_evidence_submission(
                client, application_id=row["application_id"], owner_user_id=owner, files=payload)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail={"code": str(exc)}) from exc
        svc.mark_used(client, token)
        return {"ok": True, "saved": saved}
```
(Keep the existing résumé/linkedin branch for non-evidence tokens.)
- [ ] **Step 5: Admin evidence send endpoint** — add:
```python
class EvidenceSendBody(BaseModel):
    mode: Literal["sample", "list"]
    sample_email: str | None = None
    application_ids: list[str] | None = None
    dry_run: bool = False
    confirm: bool = False
    force: bool = False

@router.post("/admin/evidence-recollection/send",
             dependencies=[Depends(require_capability("manage_users"))])
async def send_evidence_requests(body: EvidenceSendBody, user: dict = Depends(get_current_user)) -> dict:
    client = get_admin_client(); es = get_email_service()
    if body.mode == "sample":
        if not body.sample_email:
            raise HTTPException(status_code=400, detail={"code": "sample_email_required"})
        token = svc.create_token(client, application_id=None, needs_resume=False,
            needs_linkedin=False, needs_evidence=True, sent_to=body.sample_email, is_preview=True)
        es.send_evidence_recollection(to=body.sample_email, applicant_name="Applicant",
            display_id="TIR — sample", link_url=frontend_url(_FORM_PATH + token))
        return {"mode": "sample", "sent": 1}
    if not body.application_ids:
        raise HTTPException(status_code=400, detail={"code": "application_ids_required"})
    if body.dry_run:
        return {"mode": "list", "matched": len(body.application_ids), "dry_run": True, "sent": 0}
    if not body.confirm:
        raise HTTPException(status_code=400, detail={"code": "confirm_required"})
    apps = (client.table("tir_applications").select("id,user_id,basic_full_name,display_seq")
            .in_("id", body.application_ids).execute().data) or []
    emails = _resolve_emails(client, [a["user_id"] for a in apps])
    sent = skipped = failed = 0
    for a in apps:
        addr = emails.get(a["user_id"])
        if not addr:
            skipped += 1; continue
        if not body.force and svc.has_live_token(client, a["id"]):
            skipped += 1; continue
        try:
            token = svc.create_token(client, application_id=a["id"], needs_resume=False,
                needs_linkedin=False, needs_evidence=True, sent_to=addr, is_preview=False)
            seq = a.get("display_seq")
            es.send_evidence_recollection(to=addr, applicant_name=a.get("basic_full_name") or "Applicant",
                display_id=f"TIR-{seq}" if seq else "", link_url=frontend_url(_FORM_PATH + token))
            sent += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1; log.warning("evidence send failed", extra={"app": a["id"], "err": str(exc)})
    return {"mode": "list", "matched": len(apps), "sent": sent, "skipped": skipped, "failed": failed}
```
Update `submit_form(token, file=None, files=None, linkedin_url=None)` signature accordingly.
- [ ] **Step 6: Run → PASS** + whole file. **Commit** `feat(evidence): multi-file submit + admin evidence-recollection send`

---

### Task 4: Email — `send_evidence_recollection` + templates

**Files:** Modify `backend/app/services/email_service.py` · Create `backend/app/templates/email/evidence_recollection.{html,txt}` · Test `backend/tests/test_profile_completion_email.py`

- [ ] **Step 1: Failing test** — assert `send_evidence_recollection(to, applicant_name, display_id, link_url)` renders both templates and calls `send_raw` with subject `Action needed — re-upload your ARTPARK TIR evidence files`; body contains "due to some technical issues" and NOT "does not affect".
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Email fn** (mirror `send_profile_completion_request`):
```python
def send_evidence_recollection(self, to, applicant_name, display_id, link_url) -> dict[str, str]:
    html, text = self._render_pair("evidence_recollection", {
        "applicant_name": applicant_name or "Applicant", "display_id": display_id, "link_url": link_url})
    return self.send_raw(to=[to],
        subject="Action needed — re-upload your ARTPARK TIR evidence files", html=html, text=text)
```
- [ ] **Step 4: Templates** — `evidence_recollection.txt`:
```
Dear {{ applicant_name }},

While reviewing your ARTPARK TIR application ({{ display_id }}), we found that some of the evidence files you uploaded need to be re-uploaded due to some technical issues.

Please re-upload your evidence using your secure link below. It is unique to your application, needs no login, and stays valid for 72 hours:

{{ link_url }}

What to upload: the supporting documents/images from the Evidence section of your application (PDF, JPG, PNG). Please re-upload all the evidence you originally submitted.

Thank you.
— The ARTPARK team
```
`evidence_recollection.html`: same copy inside the shared ARTPARK shell — **copy `profile_completion_request.html` and swap the body paragraphs + the CTA button label to "Re-upload my evidence files" → `{{ link_url }}`** (keep the shell/header/footer identical).
- [ ] **Step 5: Run → PASS. Commit** `feat(evidence): send_evidence_recollection email + templates`

---

### Task 5: Frontend — multi-file evidence uploader

**Files:** Modify `frontend/src/lib/profileCompletionApi.js`, `frontend/src/pages/ProfileCompletionPage.jsx` · Test `frontend/src/pages/__tests__/ProfileCompletionPage.evidence.test.jsx` (create)

- [ ] **Step 1: API — add evidence multi-file submit** (`profileCompletionApi.js`):
```js
  submitEvidence: (token, filesList) => {
    const fd = new FormData();
    Array.from(filesList || []).forEach((f) => fd.append("files", f));
    return apiCall(`/profile-completion/${encodeURIComponent(token)}`, { method: "POST", body: fd });
  },
```
- [ ] **Step 2: Failing FE test** — mock `profileCompletionApi.getState` → `{valid:true, needs_evidence:true, applicant_name:"A", display_id:"TIR-1"}`; render `ProfileCompletionPage`; assert a multi-file input (`input[type=file][multiple]`) renders and Submit calls `submitEvidence`.
- [ ] **Step 3: Page — evidence branch** in `ProfileCompletionPage.jsx`:
  - add `const [evFiles, setEvFiles] = useState([]);`
  - in `submit()`: `if (state.needs_evidence) { r = await profileCompletionApi.submitEvidence(token, evFiles); } else { r = await profileCompletionApi.submit(token, { file, linkedinUrl: linkedin }); }`
  - render (when `state.needs_evidence`), before the résumé block:
```jsx
{state.needs_evidence && (
  <div style={{ margin: "16px 0" }}>
    <div style={{ fontWeight: 600, marginBottom: 8 }}>Re-upload your evidence files (PDF/JPG/PNG)</div>
    <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple
      onChange={(e) => setEvFiles(e.target.files)} />
    <div style={{ fontSize: 13, color: "#8a8a92", marginTop: 6 }}>
      {evFiles?.length ? `${evFiles.length} file(s) selected` : "Select all the evidence you originally submitted."}
    </div>
  </div>
)}
```
  - the intro paragraph + Submit-disabled logic: when `needs_evidence`, use "we found some evidence files need re-uploading" copy and disable Submit until `evFiles.length`.
- [ ] **Step 4: Run FE tests → PASS** (`npx vitest run src/pages/__tests__/ProfileCompletionPage.evidence.test.jsx`) + the existing ProfileCompletionPage test. **Commit** `feat(evidence): multi-file evidence uploader on ProfileCompletionPage`

---

## Rollout (sample-first is a HARD gate)
1. All BE+FE tests green; merge to `release/sip-launch-v1`.
2. **Apply migration 032** in the Supabase SQL editor.
3. **SAM deploy** + **Vercel promote.**
4. **Sample:** `POST /admin/evidence-recollection/send {mode:"sample", sample_email:"udayanpawar03@gmail.com"}` → open the emailed link, upload test files, confirm they appear in the Evidence section and dead entries were pruned. **Verify end-to-end.**
5. Build the **165 app-id list** from `damage_tir_full.csv` (status=under_review AND missing evidence).
6. **Only after sample verified:** `POST …/send {mode:"list", application_ids:[…165…], confirm:true}`; report sent/skipped/failed.

## Verification
- BE: `… -m pytest tests/test_profile_completion_service.py tests/test_profile_completion_router.py tests/test_profile_completion_email.py -q --no-cov` → green.
- FE: `npx vitest run src/pages/__tests__/ProfileCompletionPage.evidence.test.jsx src/pages/__tests__/ProfileCompletionPage*.test.jsx` → green.
- Manual: the sample flow (step 4) is the real end-to-end check.
