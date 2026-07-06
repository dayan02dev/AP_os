# Evidence Re-collection (TIR) — Design

**Date:** 2026-07-06
**Status:** Design (approved; pending spec review)
**Context:** ~758 TIR evidence/résumé file objects lost their storage bytes (metadata orphaned; confirmed data loss, not a code bug). This feature lets affected TIR applicants **re-upload their evidence files** via a secure no-login link, storing them back into the Evidence section — reusing the shipped **profile-completion** flow.

## Goal
Email the affected `under_review` TIR applicants a single-use, no-login link to **re-upload their evidence files**, which are stored into `tir_applications.evidence_files` (bucket `tir-evidence-files`) so they reappear in the Evidence section of the admin/reviewer/leadership portals.

## Scope (locked)
- **Evidence files only** (not résumé / LinkedIn).
- **Cohort: the 165** applications that are `status == under_review` **and** missing ≥1 evidence file (from the damage report; all 165 have an email). Targeted by an **explicit application-id list**, not a live query. Excludes jury_review, rejected, drafts, and the 16 résumé-only losses.
- **Re-upload all → prune dead:** applicant re-uploads all their evidence; on submit we rebuild `evidence_files` = *(existing entries whose bytes still resolve)* + *(new uploads)*, dropping the dead entries.
- **Hard rollout gate:** a **sample email to `udayanpawar03@gmail.com`** must be sent and verified end-to-end **before** any mass send.

## Non-goals
- No résumé / LinkedIn re-collection here (the existing profile-completion flow already covers those; a separate résumé re-collection can follow).
- No live "which apps are missing evidence" query — the cohort is a fixed, reviewed list.
- No change to the applicant's own logged-in evidence upload (`evidence_files.py`).

## Approach
**Extend the profile-completion token flow** (`profile_completion.py` / `profile_completion_service.py` / `ProfileCompletionPage`) rather than building a parallel system. It already provides single-use no-login 72h tokens, a service-role submission path, a public form page, and branded email.

## Design

### Backend
1. **Migration 032** — `ALTER TABLE profile_completion_tokens ADD COLUMN needs_evidence boolean NOT NULL DEFAULT false;` (manual apply in Supabase SQL editor).
2. **`create_token(...)`** gains `needs_evidence: bool = False`. An evidence token has `needs_evidence=true, needs_resume=false, needs_linkedin=false`.
3. **`store_evidence_submission(client, *, application_id, owner_user_id, files: list[{bytes, filename, mime}]) -> dict`** (new service fn):
   - For each file: validate mime + size against the **same map/limit as `evidence_files.py`** (`application/pdf`, `image/jpeg`, `image/png`; ≤ the evidence size cap). Bad file → `ValueError`.
   - Upload to `tir-evidence-files/<owner_user_id>/evidence/<uuid>.<ext>` (mirrors `evidence_files.py`).
   - Build entry `{path, name, size, mime, file_uuid, uploaded_at}` (exact shape the portals read).
   - **Rebuild** `tir_applications.evidence_files`: for each *existing* entry, byte-check it (signed Range GET); keep entries whose bytes resolve, **drop the dead ones**, then **append the new entries**. Update the row.
   - Returns `{added: n, pruned: m, kept: k}`.
4. **Public submit** — `POST /profile-completion/{token}` accepts **multiple** files (`files: list[UploadFile] = File(None)`) and, when `token.needs_evidence`, routes to `store_evidence_submission`. Existing résumé/linkedin path unchanged. Rate-limited as today.
5. **Admin send** — extend `POST /admin/profile-completion/send` (or a sibling endpoint) with an evidence path:
   - `mode:"sample"` + evidence → mint a **preview** `needs_evidence` token, send the evidence email to `sample_email` (**udayanpawar03@gmail.com**).
   - `mode:"list"` + `application_ids:[…165…]` + `confirm:true` → for each: mint a `needs_evidence` token (dedupe via `has_live_token`) + send the evidence email. `dry_run` returns the matched count.

### Frontend
6. **`ProfileCompletionPage`** — when the token state reports `needs_evidence`, render a **multi-file** evidence uploader (accept PDF/JPG/PNG, multiple) and submit all files. Résumé mode stays single-file.

### Email
7. **`send_evidence_recollection(to, applicant_name, display_id, link_url)`** + template `evidence_recollection.html/.txt` in the ARTPARK shell.
   - **Subject:** `Action needed — re-upload your ARTPARK TIR evidence files`
   - **Body:** greets by name + TIR-id; *"some of the evidence files you uploaded need to be re-uploaded **due to some technical issues**"*; secure no-login link, 72h; "re-upload all the evidence you originally submitted (PDF/JPG/PNG)". **No "our end / doesn't affect standing" lines.**

### Data flow
```
Admin send (list of 165 app_ids) → per app: create_token(needs_evidence) → send_evidence_recollection(link=/apply/profile-completion/{token})
Applicant opens link → GET state (needs_evidence=true) → multi-file upload → POST /profile-completion/{token}
  → store_evidence_submission: upload each to tir-evidence-files; evidence_files = [live existing] + [new]; prune dead
  → mark token used → files show in Evidence section (all 3 portals)
```

## Rollout (sample-first is a hard gate)
1. Build + BE/FE tests green.
2. Merge to `release/sip-launch-v1`; **apply migration 032** (Supabase SQL editor); **SAM deploy**; **Vercel promote**.
3. **Send SAMPLE to `udayanpawar03@gmail.com`** → open the link, upload test files, confirm they appear in the Evidence section + the dead-prune worked. **Verify end-to-end.**
4. **Only after the sample is verified:** mass send to the **165** (`mode:"list"`, `confirm:true`); report sent/skipped/failed.

## Testing
- **BE:** `store_evidence_submission` uploads + builds correct entries + **prunes dead, keeps live, appends new**; multi-file public submit routes on `needs_evidence`; `create_token` persists `needs_evidence`; admin `list` send mints tokens + sends per app; bad mime/oversize → 422.
- **FE:** `ProfileCompletionPage` shows the multi-file uploader in evidence mode and posts all files; résumé mode unchanged.

## Files touched
- `backend/migrations/032_*.sql` (new)
- `backend/app/services/profile_completion_service.py` (create_token flag, `store_evidence_submission`)
- `backend/app/routers/profile_completion.py` (multi-file submit, evidence send path)
- `backend/app/services/email_service.py` (`send_evidence_recollection`) + `backend/app/templates/email/evidence_recollection.{html,txt}` (new)
- `frontend/src/pages/.../ProfileCompletionPage.*` (multi-file evidence mode)
- Tests (BE + FE)
- The **165-app-id list** is supplied to the send from the damage report (`damage_tir_full.csv`, status=under_review + missing evidence).
