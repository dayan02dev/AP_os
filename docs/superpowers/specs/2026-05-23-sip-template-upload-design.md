# SIP Offline Template Upload + Auto-Fill — Design

**Date:** 2026-05-23
**Branch:** `staging`
**Status:** Design approved, pending spec sign-off before plan
**Author:** dev@artpark.in

## 1. Goal

Replicate the TIR "auto template fill" feature for the SIP track. Founders download a Word `.docx` template, fill it offline at their own pace, upload it on the SIP application page, and the parsing pipeline pre-populates their draft `sip_applications` row. The UI must match TIR's `TemplateScreen` exactly. The parser must extract all 17 SIP questions (Q5–Q24, skipping Q7, Q22, and Q23) reliably.

## 2. Non-goals

- Admin-side analytics on SIP template usage.
- Automated migration of currently-typed SIP applications.
- Anything beyond the 17 parse-target questions (pitch deck, cap table, file uploads remain wizard-only).
- Refactoring the existing TIR template feature beyond a tiny generic-extraction reorg.
- Multi-language template support — English only.

## 3. Background

The TIR template feature shipped in migration 008 (`backend/migrations/008_application_templates.sql`). It comprises:

- A frontend `TemplateScreen` component inlined at `frontend/src/auth_upload.jsx:716–846`, rendered between Section 01 and Section 02 of the TIR wizard.
- A `useTemplate` hook at `frontend/src/hooks/useTemplate.js` that orchestrates upload → poll → auto-apply.
- A FastAPI router at `backend/app/routers/application_templates.py` exposing `POST /application-templates/upload`, `GET /application-templates/me`, and `POST /application-templates/me/apply-to-application`.
- A parsing service at `backend/app/services/template_parser.py` that extracts text from `.docx`/`.pdf`, slices answers by `>>> ANSWER Q# START >>>` / `<<< ANSWER Q# END <<<` anchor markers embedded in the TIR template, parses MCQ checkbox state, then normalizes the result via Gemini Flash (`backend/app/services/llm_service.py`).
- A `public.application_templates` Postgres table + `application-templates` Storage bucket created by migration 008.

SIP is the second track on this monorepo (multi-track schema introduced in migrations 010–013). The SIP wizard lives at `frontend/src/AppSip.jsx`; the SIP applications table is `public.sip_applications`. The SIP `.docx` template already exists at `frontend/public/templates/ARTPARK_SIP_Application_Template.docx` (byte-identical to the file the user staged in `~/Downloads/`) but **lacks the anchor markers** that the TIR parser relies on — this is the primary technical risk the design must address.

## 4. Design decisions (confirmed during brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Inject anchor markers into the SIP `.docx`** rather than parse by Q-heading regex or LLM-only. | Matches TIR exactly. Deterministic parsing. Fewest LLM calls. Founder UX matches TIR template today. |
| D2 | **Separate `sip_application_templates` table** rather than adding a `track` column to the shared `application_templates` table. | Follows existing precedent (`sip_resume_uploads` is a separate table from `resume_uploads` in mig 011). Cleanest RLS isolation. No cross-track row-leak risk. |
| D3 | **Hybrid packaging:** share the generic `.docx` text-extract + anchor-slice in `template_parser.py`; sibling files for SIP-specific router, hook, component, model, LLM prompt. | Matches how `applications.py` and `sip_applications.py` are split today — sibling files, not subclasses. Same blast radius as existing TIR/SIP split. |
| D4 | **Q10 = "Other"** → auto-fill `basic_hear_about = "Other"` (no special skip reason). | Matches TIR's `problem_defined` enum-check pattern — if the canonical enum includes the value, write it. The wizard separately prompts for the custom hear-about text (that field is a sibling `basic_hear_about_other` write that the wizard handles, not the template). Keeps SIP apply code path identical in shape to TIR. |
| D5 | 17 questions in scope: Q5–Q24 minus the gaps Q7, Q22, Q23 (which the template document does not include). | Driven by what the template `.docx` actually asks. |
| D6 | **NULL-only apply semantics for SIP** (deliberate divergence from TIR's overwrite). When a SIP column already has a non-null value on the draft, the column name lands in `skipped_fields` (no DB write). The response model `SipApplyTemplateResult.skipped_fields` is `list[str]` — same shape as TIR's model. | TIR uses overwrite (`routers/application_templates.py:349-357`); SIP intentionally preserves typed answers to reduce surprise when founders edit + then upload. Plan documents the divergence so future maintainers know it's not an oversight. |

## 5. Question-to-column mapping

The 17 parsed questions map onto `public.sip_applications` columns. All columns already exist (introduced in migrations 011 + 012). No schema change is required on `sip_applications` itself.

```
Q5  REQUIRED MCQ-2  → sip_incorporated              (Yes Pvt Ltd / Not yet)
Q6  REQUIRED MCQ-4  → sip_trl                       (TRL 3 / 4 / 5 / 6+)
Q8  REQUIRED MCQ-2  → basic_incubator_association   (Yes / No)
Q9  OPTIONAL text   → basic_incubator_details
Q10 REQUIRED MCQ-8  → basic_hear_about              (Other → skip + missing)
Q11 REQUIRED text   → problem_describe
Q12 REQUIRED text   → solution_describe
Q13 REQUIRED text   → solution_core_tech
Q14 OPTIONAL text   → solution_contrarian_insight
Q15 REQUIRED MCQ-4  → sip_traction                  (Pre-revenue / Pilots / Paying pilots / Live)
Q16 REQUIRED text   → sip_traction_details
Q17 REQUIRED text   → execution_will_break          (added in mig 012)
Q18 REQUIRED text   → execution_milestone
Q19 REQUIRED text   → execution_infrastructure
Q20 OPTIONAL text   → execution_failure
Q21 OPTIONAL text   → execution_hwsw_integration
Q24 OPTIONAL text   → sip_demo_video_url            (URL, http/https, ≤2000 chars)
```

MCQ enum values mirror the existing `CHECK` constraints on `sip_applications` (see migration 011). Parser-emitted enum strings must match exactly; mismatches are demoted to `missing_answers` (no DB write) — matches TIR's `problem_defined` enum-check pattern at `routers/application_templates.py:367-376`.

## 6. Architecture

```
┌─────────────────────────── FRONTEND (Vite/React) ──────────────────────────┐
│  AppSip.jsx                                                                │
│    └─ <SipTemplateScreen/>  (new — clone of TemplateScreen for TIR)        │
│         ├─ download:  GET /templates/ARTPARK_SIP_Application_Template.docx │
│         └─ upload:    useSipTemplate() hook                                │
│                        │                                                   │
└────────────────────────┼───────────────────────────────────────────────────┘
                         │ HTTPS, Bearer JWT
                         ▼
┌────────────────────────────── BACKEND (FastAPI / Lambda) ──────────────────┐
│  routers/sip_application_templates.py   (new, mirrors TIR router)          │
│    ├─ POST /sip-application-templates/upload                               │
│    ├─ GET  /sip-application-templates/me                                   │
│    └─ POST /sip-application-templates/me/apply-to-application              │
│         │ require_track("sip") + get_current_user                          │
│         ▼                                                                  │
│  services/sip_template_parser.py        (new — SIP MCQ rules + LLM prompt) │
│    │ delegates docx text-extract + anchor slicing to:                      │
│    ▼                                                                       │
│  services/template_parser.py            (existing, schema-agnostic — reuse)│
│  services/llm_service.py                (existing, add SIP system prompt)  │
└────────────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────── SUPABASE (Postgres + Storage) ─────────────────────┐
│  Migration 020_sip_application_templates.sql                               │
│    ├─ table  public.sip_application_templates  (mirrors application_templates,│
│    │                                            FK → sip_applications)     │
│    └─ bucket sip-application-templates  (10 MiB, .docx/.pdf, RLS by uid)   │
└────────────────────────────────────────────────────────────────────────────┘
```

**Shared with TIR (no changes to runtime semantics):** `services/template_parser.py` text extraction, anchor regex, MCQ option-line regex, OpenRouter client, Gemini Flash fallback. The shared module will be lightly reorganized so its core helpers are callable with track-specific arguments (`question_ids`, `mcq_specs`, `llm_extractor`); the TIR call site collapses to a thin wrapper around the same helpers.

**SIP-specific (new):** the router, the LLM prompt schema (`{Q5..Q24}`), the MCQ option lists (Q5/Q6/Q8/Q10/Q15), the `QUESTION_TO_SIP_COLUMN` mapping, the apply-to-application enum guards (sip_incorporated, sip_trl, basic_hear_about, sip_traction, basic_incubator_association), the URL validator for Q24, the frontend component, the hook, and the `.docx` file with anchors injected.

## 7. Component and file list

### New backend files

| File | Purpose |
|------|---------|
| `backend/migrations/020_sip_application_templates.sql` | New table + storage bucket + RLS (mirrors mig 008) |
| `backend/app/models/sip_application_template.py` | Pydantic: `SipApplicationTemplateUploadResponse`, `SipApplicationTemplateRecord`, `SipApplyTemplateResult` |
| `backend/app/routers/sip_application_templates.py` | 3 endpoints, `require_track("sip")`, draft lookup on `sip_applications` |
| `backend/app/services/sip_template_parser.py` | SIP MCQ option lists + `QUESTION_TO_SIP_COLUMN` + post-LLM normalization |

### Existing backend files modified

| File | Change |
|------|--------|
| `backend/app/main.py` | Register the new router |
| `backend/app/services/llm_service.py` | Add `_SIP_TEMPLATE_SYSTEM_PROMPT` + `extract_sip_template_answers(...)`; existing `_TEMPLATE_SYSTEM_PROMPT` and `extract_template_answers(...)` unchanged |
| `backend/app/services/template_parser.py` | Extract a `parse_template_generic(file_bytes, mime, question_ids, mcq_specs, llm_extractor)` so the SIP parser can reuse the slicer; existing TIR `parse_template(...)` becomes a thin wrapper |

### New frontend files

| File | Purpose |
|------|---------|
| `frontend/src/components/SipTemplateScreen.jsx` | UI clone of `TemplateScreen` (currently inlined in `auth_upload.jsx:716–846`) — extract during the port so both tracks render an isolated component |
| `frontend/src/hooks/useSipTemplate.js` | Clone of `useTemplate.js` pointing at `/sip-application-templates/*` |

### Existing frontend files modified

| File | Change |
|------|--------|
| `frontend/src/AppSip.jsx` | Render `<SipTemplateScreen/>` between Section 01 (Basic Details) and Section 02 (Quick gates) — same position as TIR |
| `frontend/src/lib/api.js` | Three new wrappers: `uploadSipTemplate`, `getMySipTemplate`, `applySipTemplate` |
| `frontend/public/templates/ARTPARK_SIP_Application_Template.docx` | Inject `>>> ANSWER Q# START >>>` / `<<< ANSWER Q# END <<<` markers around all 17 answer cells via a one-shot committed script |

### New scripts

| File | Purpose |
|------|---------|
| `scripts/inject_sip_template_anchors.py` | Idempotent: opens the `.docx`, walks tables, finds the empty "grey answer box" cell after each `Q# · REQUIRED/OPTIONAL` heading, inserts START/END marker paragraphs around it, saves in place. Run once during this PR; committed so the operation is auditable |
| `scripts/build_sip_test_fixtures.py` | Generates the six test fixture `.docx` files from a small data spec, also committed |

### New tests

| File | Purpose |
|------|---------|
| `backend/tests/test_sip_application_templates.py` | Backend test suite (see §11) |
| `frontend/src/hooks/__tests__/useSipTemplate.test.jsx` | Hook state-machine tests |
| `frontend/src/components/__tests__/SipTemplateScreen.test.jsx` | Component RTL tests |
| `backend/tests/fixtures/sip_template_*.docx` | Six committed `.docx` fixtures (see §11) |

## 8. Data flow

### Upload + parse (inline-async, mirrors TIR exactly)

```
[Founder]
   │ 1. drops .docx on <SipTemplateScreen/>
   ▼
[useSipTemplate.upload]
   │ 2. FormData → POST /sip-application-templates/upload
   ▼
[router.upload]
   │ 3. validate: size ≤ 10 MiB, mime ∈ {docx, pdf}, rate-limit 5/hr/user
   │ 4. upload to Storage: sip-application-templates/<uid>/<file-uuid>.docx
   │ 5. INSERT sip_application_templates (parse_status='processing')
   │ 6. call sip_template_parser.parse(file_bytes, mime) — inline, 22s timeout
   │      ├─ template_parser.extract_text(...)           ← shared
   │      ├─ template_parser.slice_by_anchors(Q5..Q24)   ← shared, anchors present
   │      ├─ sip_template_parser.collect_mcq_state(...)  ← SIP-specific options
   │      └─ llm_service.extract_sip_template_answers(.) ← Gemini Flash, SIP prompt
   │ 7a. on success: UPDATE row → parse_status='completed', parsed_data={Q5..Q24}
   │ 7b. on 22s timeout: leave row as 'processing'; frontend polls /me
   │ 7c. on parser raise: UPDATE row → parse_status='failed', parse_error=...
   │ 8. return SipApplicationTemplateUploadResponse(parse_status, ...)
   ▼
[useSipTemplate]
   │ 9. if status=='completed' → call apply (step 10)
   │    else                   → poll GET /me every 3s, up to 10×
   ▼
[router.apply]                    (POST /me/apply-to-application)
   │ 10. fetch latest sip_application_templates row for user, status='completed'
   │ 11. find user's draft sip_applications row (status='draft')
   │     ├─ none? → 404 SIP_DRAFT_NOT_FOUND
   │     └─ found → continue
   │ 12. for each Q in parsed_data:
   │     ├─ column = QUESTION_TO_SIP_COLUMN[Q]
   │     ├─ value  = parsed_data[Q]
   │     ├─ skip if value is null/empty                       → missing_answers
   │     ├─ enum-validate (sip_incorporated, sip_trl,
   │     │     basic_hear_about, sip_traction, etc.) — "Other"
   │     │     is a valid canonical enum value, no special case
   │     │     fail → missing_answers (matches TIR's problem_defined pattern)
   │     ├─ Q24 URL validator (http/https, ≤2000 chars)
   │     │     fail → missing_answers
   │     ├─ skip if draft already has non-null in column      → skipped_fields
   │     │                                                      (column name only,
   │     │                                                       no reason code)
   │     └─ else: stage in update dict                        → applied_fields
   │ 13. UPDATE sip_applications SET <staged columns> WHERE id = draft_id
   │ 14. UPDATE sip_application_templates SET applied_to_application_at = now()
   │ 15. return SipApplyTemplateResult(applied_fields, skipped_fields, missing_answers)
   ▼
[useSipTemplate]
   │ 16. toast: "Filled N answers · M skipped · K missing"
   │ 17. invalidate sip_applications query → wizard re-renders with values
```

### Row state machine

`pending → processing → (completed | failed)`. `applied_to_application_at` is a separate `timestamptz` column, set on successful apply. A row that has been parsed but never applied is distinguishable from one that has been applied (matters for the wizard's "you already uploaded a template" hint).

### Idempotency

A second upload from the same user creates a new row; `/me` returns the most recent row by `created_at desc` (same as TIR). The `applied_to_application_at` on prior rows stays intact (audit trail).

## 9. Error handling

### Errors surfaced to the user

| Code | When | UX |
|---|---|---|
| `FILE_TOO_LARGE` | upload > 10 MiB | inline red on dropzone: "File too large — max 10 MB" |
| `INVALID_MIME` | not .docx or .pdf | inline: "Only .docx or .pdf files are supported" |
| `RATE_LIMITED_UPLOAD` | >5 uploads/hour | toast: "Too many uploads — try again in an hour" |
| `RATE_LIMITED_APPLY` | >10 applies/hour | toast: "Too many applies — try again later" |
| `PARSE_FAILED` | parser raised | inline: "We couldn't read this file. Re-download the template and try again." + link to download |
| `PARSE_TIMEOUT` | inline parse exceeded 22 s, row still 'processing' after 10 polls | toast: "Still working on it — refresh in a minute" |
| `SIP_DRAFT_NOT_FOUND` | apply called but no draft sip_applications row | toast: "Start a SIP application first, then upload your template" + CTA to `/apply-sip` |
| `EMPTY_DOCUMENT` | docx had zero extractable text | inline: "This file appears empty" |
| `WRONG_TRACK_TEMPLATE` | parsed_data has fewer than 3 SIP question keys (likely a TIR template) | toast: "This looks like the TIR template — download the SIP template and try again" |

### Edge cases explicitly handled

1. **Founder uploads TIR template by mistake** — parsed_data comes back with `{Q9..Q19}` (TIR keys), not `{Q5..Q24}`. Detect at parse-time: if intersection of parsed keys with `SIP_QUESTION_IDS` is < 3, set `parse_status='failed'`, `parse_error='wrong_track_template'`, surface as `WRONG_TRACK_TEMPLATE`.
2. **Founder edited the docx anchors** (deleted `>>> ANSWER Q5 START >>>` or renamed Q5 to Q05) — slicer finds < 3 anchors, falls through to LLM freeform. Logged with `parse_warning='anchors_missing_used_llm_fallback'`. Founder gets a result (possibly less accurate); no error shown.
3. **Founder filled some answers, left others blank** — blank answers come through as empty strings; parser maps to `null`; apply skips them; UX summary shows "Filled 11 · 0 skipped · 6 missing" (same pattern as TIR).
4. **Q10 = "Other"** — `parse_status='completed'`, `parsed_data["Q10"]="Other"`. Apply step treats it like any other canonical enum value: writes `basic_hear_about="Other"` (assuming the column is still NULL on the draft, per D6). The wizard later prompts the founder for the custom hear-about text via its own field — that's a separate concern from the template apply path.
5. **Multiple MCQ options ticked on a single-select** (e.g., applicant ticked both A and B on Q5) — `collect_mcq_state` returns multiple `checked: true`. LLM prompt rule: "if multiple options are checked on a single-select MCQ, return null." Apply step skips with `reason: 'ambiguous_mcq'`.
6. **PDF upload instead of docx** — `python-docx` rejects it; pipeline routes through `pypdf` extraction; anchor regex still works on the extracted text (PDFs export the markers as plain text). Founders who print-to-PDF after filling parse correctly.
7. **Existing draft has typed answers already** — NULL-only write semantics protect them (D6, deliberate divergence from TIR's overwrite). The pre-filled column name lands in `skipped_fields` (just the column name string — reason is implicit; same shape as TIR's `ApplyTemplateResult.skipped_fields: list[str]`).
8. **Concurrent uploads from two tabs** — most-recent-row wins on `/me`. Older rows stay in DB for audit; never applied automatically.
9. **Founder uploads, deletes their draft sip_applications row, then applies** — apply returns `SIP_DRAFT_NOT_FOUND`. Template row stays parsed; can be applied to a fresh draft later (looked up by user_id, not by template's frozen application_id).
10. **`sip_demo_video_url` validation** — same regex as the wizard field uses today (http/https, ≤2000 chars). On fail, skip with `reason: 'invalid_url'`.

### Not handled

- Translating non-English answers — out of scope; LLM prompt is English-only.
- Founders who delete the Q-headers themselves — LLM fallback will probably still extract, but not guaranteed.
- Re-uploading to overwrite previously-applied data — applicants who want to redo must clear their draft fields manually (matches TIR semantics).

## 10. Security & privacy

- Storage path: `sip-application-templates/<auth_uid>/<file-uuid>.docx`. RLS policies on the bucket restrict read/write/delete to rows whose first path segment equals `auth.uid()::text` (mirrors mig 008 pattern verbatim).
- Table-level RLS: `auth.uid() = user_id` for SELECT/INSERT/UPDATE.
- All three endpoints require `get_current_user` + `require_track("sip")`.
- Rate limits: 5 uploads/hr/user, 10 applies/hr/user, 30 `/me` reads/min/user (matches TIR).
- Uploads stream to Supabase Storage; raw file content never goes to the LLM — only extracted text. LLM call uses the existing OpenRouter integration (Gemini Flash with GPT-4o-mini + Claude 3.5 Haiku fallback).
- Parse errors stored in `parse_error` are short codes, not user-supplied content — no log injection surface.

## 11. Testing

### Backend — `backend/tests/test_sip_application_templates.py` (pytest + FastAPI TestClient)

| Test | What it asserts |
|------|------|
| `test_upload_happy_path_docx` | Upload anchored SIP fixture → 200, `parse_status='completed'`, `parsed_data` has all 17 Q keys |
| `test_upload_happy_path_pdf` | Same .docx exported as PDF → parses, anchors still slice |
| `test_upload_rejects_oversize` | 11 MiB body → 413 `FILE_TOO_LARGE` |
| `test_upload_rejects_wrong_mime` | .txt upload → 415 `INVALID_MIME` |
| `test_upload_rate_limit` | 6th upload in same hour → 429 `RATE_LIMITED_UPLOAD` |
| `test_upload_unauthenticated` | No bearer → 401 |
| `test_upload_requires_sip_track` | User on tir track → 403 |
| `test_upload_empty_document` | Empty .docx → `parse_status='failed'`, error `empty_document` |
| `test_upload_wrong_track_template` | TIR template uploaded → `parse_status='failed'`, error `wrong_track_template` |
| `test_upload_no_anchors_falls_back_to_llm` | Stripped-anchor .docx → still parses via freeform fallback, warning logged |
| `test_get_me_returns_latest` | Two uploads → `GET /me` returns most-recent by created_at |
| `test_get_me_returns_none_for_new_user` | No uploads yet → 200 with `template: null` |
| `test_apply_happy_path` | All 17 fields → applied_fields has 17, skipped/missing empty, sip_applications updated |
| `test_apply_null_only_semantics` | Pre-fill `problem_describe` → column appears in skipped_fields (as a bare column-name string) and the draft value is preserved |
| `test_apply_enum_validation_sip_incorporated` | Parsed value not in enum → missing_answers |
| `test_apply_enum_validation_sip_trl` | Same, for TRL column |
| `test_apply_enum_validation_sip_traction` | Same, for traction column |
| `test_apply_enum_validation_basic_hear_about` | Same, for hear-about column |
| `test_apply_q10_other_auto_filled` | Parsed Q10='Other' → applied_fields contains `basic_hear_about`, draft column = `"Other"` |
| `test_apply_q24_invalid_url` | Q24='not-a-url' → missing_answers; valid http(s) URL → applied |
| `test_apply_no_draft_returns_404` | User has no draft sip_applications → 404 `SIP_DRAFT_NOT_FOUND` |
| `test_apply_idempotent` | Call apply twice in a row → second call applied_fields empty, no DB mutations |
| `test_apply_rate_limit` | 11th apply in same hour → 429 |
| `test_apply_unauthenticated` | No bearer → 401 |
| `test_apply_requires_sip_track` | Wrong track → 403 |
| `test_apply_ambiguous_mcq_to_missing` | parsed_data with two ticks on Q5 → LLM returned null, apply records Q5 in missing_answers |
| `test_apply_does_not_touch_tir_applications` | User has both TIR + SIP drafts → only sip_applications row mutated |
| `test_applied_to_application_at_set_on_success` | After apply → DB column populated |
| `test_applied_to_application_at_unset_on_failure` | Apply returns 404 → column stays NULL |

### Test fixtures (committed under `backend/tests/fixtures/`)

| Fixture | Purpose |
|---|---|
| `sip_template_anchored_complete.docx` | All 17 answers filled, all anchors present |
| `sip_template_anchored_partial.docx` | Only required Qs filled; optional Qs empty |
| `sip_template_anchors_stripped.docx` | Anchors removed — exercises LLM fallback |
| `sip_template_tir_uploaded.docx` | The actual TIR template — exercises wrong-track detection |
| `sip_template_ambiguous_mcq.docx` | Q5 has both options ticked |
| `sip_template_empty.docx` | Zero answers |

Fixtures are generated by `scripts/build_sip_test_fixtures.py`, also committed.

### Frontend — `frontend/src/hooks/__tests__/useSipTemplate.test.jsx` (Vitest)

| Test | What it asserts |
|---|---|
| `upload sets uploading → parsing → completed sequence` | State machine transitions correctly |
| `upload error sets error state with code` | API failure surfaces via state |
| `polls /me every 3s when status=processing, up to 10 attempts` | Timer + fetch count |
| `auto-applies when parse completes` | Apply mutation fires without user click |
| `apply success toast lists applied/skipped/missing counts` | Toast called with correct args |
| `apply 404 triggers SIP_DRAFT_NOT_FOUND toast with CTA` | "Start a SIP application first" path |
| `does not re-poll after status=completed` | Stop polling once done |
| `does not re-poll after status=failed` | Same for failures |

### Frontend — `frontend/src/components/__tests__/SipTemplateScreen.test.jsx` (Vitest + RTL)

| Test | What it asserts |
|---|---|
| `renders download link with correct href` | `/templates/ARTPARK_SIP_Application_Template.docx?v=1` |
| `dropzone accepts .docx and .pdf only` | rejects .txt with inline error |
| `shows uploading / parsing / applying / done states visibly` | Each visible to user |
| `shows error state with retry CTA` | After parse_status=failed |
| `success state shows summary counts` | "Filled 11 · 0 skipped · 6 missing" |

### Coverage

70% per `pyproject.toml:49-65` (repo standard). Each new module ≥ 80% lines.

### Manual QA

Deferred to a separate `/qa` pass after merge — walk the end-to-end flow on `staging` with a real Supabase user, including TIR/SIP cross-track tests.

## 12. Rollout

1. Land migration 020 on the staging Supabase project (`exqmxvdtcsvpgtftwjml`).
2. Deploy the SAM stack from the worktree corresponding to this branch (per the SAM-deploy-requires-worktree rule). Stack: `artpark-eir-api-staging`.
3. Deploy the frontend to the `staging` Vercel branch.
4. Manually verify the end-to-end happy path on `apply.artpark.info` staging URL with one of the three pre-created test users.
5. Production: land migration 020 on prod Supabase + deploy via `samconfig.toml [production]`. Same flow, separate PR.

## 13. Open questions / risks

- **Anchor injection script correctness:** the one-shot `inject_sip_template_anchors.py` must locate the right "grey answer box" cell for each Q. Risk: misalignment between heading and the empty-cell that follows. Mitigation: visual diff before/after in PR; manual open of resulting `.docx` in Word; the 17 fixtures double as regression tests.
- **LLM cost:** SIP has 17 questions vs TIR's 11 — the prompt is ~50% larger. Still inside Gemini Flash free-tier limits at expected volumes. No mitigation needed.
- **Pre-launch SIP applicants who already typed answers:** NULL-only write protects them, but they will see most fields in `skipped_fields` if they upload a template after typing. UX surfaces this clearly; no further mitigation needed.

## 14. References

- TIR template feature: `frontend/src/auth_upload.jsx:716–846`, `frontend/src/hooks/useTemplate.js`, `backend/app/routers/application_templates.py`, `backend/app/services/template_parser.py`, `backend/app/services/llm_service.py:325–356`, `backend/migrations/008_application_templates.sql`.
- SIP wizard: `frontend/src/AppSip.jsx`, `frontend/src/questions_sip.jsx`, `frontend/src/inputs_sip.jsx`.
- SIP schema: `backend/migrations/011_sip_track.sql`, `012_sip_add_will_break.sql`, `013_relax_other_constraints.sql`.
- Multi-track auth/routing: `require_track()` backend dep + `TrackMismatchPage` frontend.
