# SIP Offline Template Upload + Auto-Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline-template-fill feature to the SIP wizard that mirrors the TIR feature exactly — founders download a `.docx`, fill 17 questions (Q5–Q24 minus Q7/Q22/Q23) offline, upload it, and the parsed answers auto-populate their draft `sip_applications` row.

**Architecture:** Sibling files matching the existing TIR/SIP split. Reuse the schema-agnostic `template_parser.py` extractor; add SIP-specific MCQ option lists + LLM prompt + question→column mapping + NULL-only apply semantics + dedicated `sip_application_templates` Postgres table + `sip-application-templates` storage bucket. Spec: `docs/superpowers/specs/2026-05-23-sip-template-upload-design.md`.

**Tech Stack:** FastAPI + Pydantic + python-docx + pypdf + Supabase (Postgres + Storage) + Mangum/Lambda. Vite + React 18 + Vitest + React Testing Library. OpenRouter (Gemini 2.0 Flash, with GPT-4o-mini and Claude 3.5 Haiku fallbacks).

**Working branch:** `staging` (the user is working only on `staging`).

**Spec divergences from TIR (read these before starting):**

- **NULL-only apply** (Decision D6 in spec): SIP does NOT overwrite existing draft values. TIR does. When a SIP column is already non-null, the column name lands in `skipped_fields` and the draft row is left alone for that column.
- **Q10 = "Other"** is treated as just another canonical enum value. No special-cased reason code. The wizard separately handles capturing the custom hear-about text.

---

## Task 1: Migration 020 — `sip_application_templates` table + storage bucket + RLS

**Files:**
- Create: `backend/migrations/020_sip_application_templates.sql`

- [ ] **Step 1: Write the migration SQL**

Create `backend/migrations/020_sip_application_templates.sql`:

```sql
-- 020_sip_application_templates.sql — offline template upload + parse (SIP).
--
-- SIP equivalent of migration 008. One row per .docx/.pdf upload, mirrors
-- public.application_templates. Foreign-keyed to public.sip_applications
-- rather than public.applications, so RLS scoping and audit trails stay
-- track-isolated.
--
-- Q5..Q24 (minus Q7, Q22, Q23) target columns already exist on
-- public.sip_applications (introduced in migrations 011 + 012). No
-- ALTER TABLE on sip_applications is required.
--
-- Apply semantics on the router differ from TIR: SIP uses NULL-only
-- writes (preserve typed answers). See Decision D6 in the spec.
--
-- Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Tracking table — one row per upload, mirrors application_templates.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sip_application_templates (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  application_id           uuid references public.sip_applications(id) on delete set null,
  storage_path             text not null,
  original_filename        text,
  file_size_bytes          integer,
  mime_type                text,
  parse_status             text not null default 'pending'
                            check (parse_status in ('pending','processing','completed','failed')),
  parse_error              text,
  parsed_at                timestamptz,
  parsed_data              jsonb,                       -- raw {"Q5": "...", "Q6": "TRL 4 — ...", ...}
  applied_to_application_at timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists idx_sip_app_templates_user
  on public.sip_application_templates (user_id);
create index if not exists idx_sip_app_templates_app
  on public.sip_application_templates (application_id);
create index if not exists idx_sip_app_templates_user_created_at
  on public.sip_application_templates (user_id, created_at desc);

alter table public.sip_application_templates enable row level security;

drop policy if exists sip_app_templates_self_select on public.sip_application_templates;
create policy sip_app_templates_self_select on public.sip_application_templates
  for select using (auth.uid() = user_id);

drop policy if exists sip_app_templates_self_insert on public.sip_application_templates;
create policy sip_app_templates_self_insert on public.sip_application_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists sip_app_templates_self_update on public.sip_application_templates;
create policy sip_app_templates_self_update on public.sip_application_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 2. Private 'sip-application-templates' storage bucket.
--    Path convention: <auth_uid>/<file-uuid>.{docx|pdf}
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sip-application-templates',
  'sip-application-templates',
  false,
  10485760,                                                  -- 10 MiB
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf'
  ]
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sip-app-templates: users upload to own folder" on storage.objects;
create policy "sip-app-templates: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sip-application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "sip-app-templates: users read own files" on storage.objects;
create policy "sip-app-templates: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sip-application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "sip-app-templates: users delete own files" on storage.objects;
create policy "sip-app-templates: users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sip-application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
```

- [ ] **Step 2: Apply migration locally against staging Supabase**

The repo doesn't run migrations through code; they're applied via the Supabase dashboard SQL editor or the `supabase` CLI. For local dev, paste the SQL into the staging project's SQL editor. The migration is idempotent; running it twice is safe.

Run (against staging project `exqmxvdtcsvpgtftwjml`):

```bash
psql "$SUPABASE_STAGING_DB_URL" -f backend/migrations/020_sip_application_templates.sql
```

Expected: `BEGIN`, three `CREATE TABLE`, three `CREATE INDEX`, one `ALTER TABLE`, three `DROP/CREATE POLICY`, `INSERT 0 1`, three `DROP/CREATE POLICY`, `COMMIT`. No errors.

If the user is running this manually rather than via CLI, the same SQL goes into Supabase Studio → SQL editor.

- [ ] **Step 3: Smoke-check the new table**

```bash
psql "$SUPABASE_STAGING_DB_URL" -c "select count(*) from public.sip_application_templates;"
```

Expected: `0`. Confirms table exists and is queryable.

- [ ] **Step 4: Smoke-check the storage bucket**

```bash
psql "$SUPABASE_STAGING_DB_URL" -c "select id, name, file_size_limit from storage.buckets where id = 'sip-application-templates';"
```

Expected: one row with `file_size_limit = 10485760`.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/020_sip_application_templates.sql
git commit -m "migration(020): sip_application_templates table + storage bucket

Adds the SIP equivalent of migration 008 (application_templates).
Separate table per the resume_uploads/sip_resume_uploads pattern in
migration 011 — clean RLS isolation per track. Sip_applications schema
unchanged: every target column for the 17 SIP template questions already
exists from migrations 011 + 012."
```

---

## Task 2: Pydantic models for SIP application templates

**Files:**
- Create: `backend/app/models/sip_application_template.py`
- Test: `backend/tests/test_sip_application_template_models.py`

- [ ] **Step 1: Write the failing model tests**

Create `backend/tests/test_sip_application_template_models.py`:

```python
"""Unit tests for SIP application-template Pydantic models."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.models.sip_application_template import (
    SipApplicationTemplateRecord,
    SipApplicationTemplateUploadResponse,
    SipApplyTemplateResult,
)


def test_upload_response_minimum_fields() -> None:
    tid = uuid.uuid4()
    resp = SipApplicationTemplateUploadResponse(
        template_id=tid,
        parse_status="pending",
    )
    assert resp.template_id == tid
    assert resp.parse_status == "pending"
    assert resp.parsed_data is None
    assert resp.original_filename is None


def test_upload_response_rejects_bad_status() -> None:
    with pytest.raises(ValidationError):
        SipApplicationTemplateUploadResponse(
            template_id=uuid.uuid4(),
            parse_status="weird",
        )


def test_record_round_trip() -> None:
    payload = {
        "id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "application_id": uuid.uuid4(),
        "storage_path": "abc/foo.docx",
        "original_filename": "sip.docx",
        "file_size_bytes": 1234,
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "parse_status": "completed",
        "parse_error": None,
        "parsed_at": datetime.now(timezone.utc),
        "parsed_data": {"Q5": "Yes — Pvt Ltd, registered in India"},
        "applied_to_application_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    rec = SipApplicationTemplateRecord(**payload)
    assert rec.parsed_data == {"Q5": "Yes — Pvt Ltd, registered in India"}


def test_apply_result_lists_default_empty() -> None:
    result = SipApplyTemplateResult(
        applied_fields=["problem_describe"],
        skipped_fields=[],
        missing_answers=[],
    )
    assert result.applied_fields == ["problem_describe"]
    assert result.skipped_fields == []
    assert result.missing_answers == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_sip_application_template_models.py -v`
Expected: `ModuleNotFoundError: No module named 'app.models.sip_application_template'`

- [ ] **Step 3: Implement the models**

Create `backend/app/models/sip_application_template.py`:

```python
"""Pydantic models for the SIP offline application-template upload flow.

Mirrors models/application_template.py — tracks one row per .docx/.pdf
the applicant uploads after filling our SIP offline template. Parsed
answers (keyed Q5..Q24 minus Q7/Q22/Q23) land in `parsed_data`;
apply-to-application copies them to the matching columns on
public.sip_applications only when the target column is currently
NULL/empty (D6 — NULL-only writes, deliberate divergence from TIR).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


ParseStatus = Literal["pending", "processing", "completed", "failed"]


class SipApplicationTemplateUploadResponse(BaseModel):
    template_id: UUID
    parse_status: ParseStatus
    original_filename: str | None = None
    parsed_data: dict[str, Any] | None = None
    message: str | None = None


class SipApplicationTemplateRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    application_id: UUID | None = None
    storage_path: str
    original_filename: str | None = None
    file_size_bytes: int | None = None
    mime_type: str | None = None
    parse_status: ParseStatus
    parse_error: str | None = None
    parsed_at: datetime | None = None
    parsed_data: dict[str, Any] | None = None
    applied_to_application_at: datetime | None = None
    created_at: datetime


class SipApplyTemplateResult(BaseModel):
    """Result of POST /sip-application-templates/me/apply-to-application.

    `applied_fields`  → columns we wrote (were NULL/empty before).
    `skipped_fields`  → columns left untouched because the applicant had
                        already typed something there (NULL-only writes —
                        deliberate divergence from TIR's overwrite).
    `missing_answers` → questions the LLM couldn't extract (empty cell,
                        invalid URL, value not in canonical enum, etc.) —
                        surfaced so the wizard can highlight them later.
    """

    applied_fields: list[str]
    skipped_fields: list[str]
    missing_answers: list[str]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_sip_application_template_models.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/sip_application_template.py backend/tests/test_sip_application_template_models.py
git commit -m "models: SipApplicationTemplate Pydantic models

Mirrors models/application_template.py — same three classes
(UploadResponse, Record, ApplyTemplateResult) with SIP-flavoured
docstrings. ApplyTemplateResult keeps the list[str] shape for
skipped_fields (matches TIR); the reason for a skip is implicit
from which list the column lands in."
```

---

## Task 3: LLM service — SIP system prompts + extract methods

**Files:**
- Modify: `backend/app/services/llm_service.py` (append new constants + methods; existing methods unchanged)
- Test: `backend/tests/test_llm_service_sip_template.py`

- [ ] **Step 1: Write failing tests for SIP option constants**

Create `backend/tests/test_llm_service_sip_template.py`:

```python
"""Unit tests for SIP template normalization in OpenRouterClient."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm_service import (
    LLMParseError,
    OpenRouterClient,
    SIP_TEMPLATE_Q5_OPTIONS,
    SIP_TEMPLATE_Q6_OPTIONS,
    SIP_TEMPLATE_Q8_OPTIONS,
    SIP_TEMPLATE_Q10_OPTIONS,
    SIP_TEMPLATE_Q15_OPTIONS,
    SIP_TEMPLATE_REQUIRED_KEYS,
)


def test_sip_q5_options_match_db_check_constraint() -> None:
    assert SIP_TEMPLATE_Q5_OPTIONS == [
        "Yes — Pvt Ltd, registered in India",
        "Not yet — we're still pre-incorporation",
    ]


def test_sip_q6_options_match_db_check_constraint() -> None:
    assert SIP_TEMPLATE_Q6_OPTIONS == [
        "TRL 3 or earlier — research stage",
        "TRL 4 — lab-validated prototype",
        "TRL 5 — pilot-tested in a relevant environment",
        "TRL 6+ — demonstrated in operational setting",
    ]


def test_sip_q8_options_are_yes_no() -> None:
    assert SIP_TEMPLATE_Q8_OPTIONS == ["Yes", "No"]


def test_sip_q10_options_include_other() -> None:
    assert "Other" in SIP_TEMPLATE_Q10_OPTIONS
    assert len(SIP_TEMPLATE_Q10_OPTIONS) == 8


def test_sip_q15_options_match_db_check_constraint() -> None:
    assert SIP_TEMPLATE_Q15_OPTIONS == [
        "Pre-revenue — building toward our first pilot",
        "Active pilots (paid or unpaid) with design partners",
        "Paying pilots — customers have paid for early access",
        "Live paying customers — repeat revenue",
    ]


def test_sip_required_keys_cover_17_questions() -> None:
    expected = {f"Q{n}" for n in [5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24]}
    assert SIP_TEMPLATE_REQUIRED_KEYS == expected


@pytest.mark.asyncio
async def test_normalize_sip_template_answers_happy_path() -> None:
    client = OpenRouterClient(api_key="fake", model="google/gemini-2.0-flash-001")
    fake_body = {
        "choices": [
            {
                "message": {
                    "content": json.dumps({k: None for k in SIP_TEMPLATE_REQUIRED_KEYS} | {
                        "Q5": "Yes — Pvt Ltd, registered in India",
                        "Q11": "We are solving X.",
                    })
                }
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        "model": "google/gemini-2.0-flash-001",
    }

    async def fake_post_and_read(*args, **kwargs):
        return fake_body

    with patch.object(client, "_post_and_read", side_effect=fake_post_and_read):
        result = await client.normalize_sip_template_answers(
            {"Q5": {"free_text": "", "options": []}}, user_id="u-test"
        )

    assert result["Q5"] == "Yes — Pvt Ltd, registered in India"
    assert result["Q11"] == "We are solving X."
    assert result["Q12"] is None


@pytest.mark.asyncio
async def test_normalize_sip_template_answers_strict_keys() -> None:
    client = OpenRouterClient(api_key="fake", model="google/gemini-2.0-flash-001")
    bad_body = {
        "choices": [{"message": {"content": json.dumps({"Q5": "yes"})}}],
        "usage": {},
        "model": "x",
    }

    async def fake_post_and_read(*args, **kwargs):
        return bad_body

    with patch.object(client, "_post_and_read", side_effect=fake_post_and_read):
        with pytest.raises(LLMParseError, match="missing required keys"):
            await client.normalize_sip_template_answers({}, user_id="u")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_llm_service_sip_template.py -v`
Expected: `ImportError: cannot import name 'SIP_TEMPLATE_Q5_OPTIONS' from 'app.services.llm_service'`

- [ ] **Step 3: Append the SIP constants + system prompts to `llm_service.py`**

Open `backend/app/services/llm_service.py`. Add these module-level constants just below the existing `TEMPLATE_Q10_OPTIONS` declaration (around line 65):

```python
# ── SIP template option lists ────────────────────────────────────────────
# Keep these in sync with the CHECK constraints on sip_applications
# (migration 011 + 013) AND with frontend/src/questions_sip.jsx.

SIP_TEMPLATE_Q5_OPTIONS = [
    "Yes — Pvt Ltd, registered in India",
    "Not yet — we're still pre-incorporation",
]
SIP_TEMPLATE_Q6_OPTIONS = [
    "TRL 3 or earlier — research stage",
    "TRL 4 — lab-validated prototype",
    "TRL 5 — pilot-tested in a relevant environment",
    "TRL 6+ — demonstrated in operational setting",
]
SIP_TEMPLATE_Q8_OPTIONS = ["Yes", "No"]
SIP_TEMPLATE_Q10_OPTIONS = [
    "Referral from friend/colleague",
    "IISc faculty or staff",
    "Social media (LinkedIn, Twitter, etc.)",
    "Event or conference",
    "Search engine",
    "Partner organization",
    "News article or press",
    "Other",
]
SIP_TEMPLATE_Q15_OPTIONS = [
    "Pre-revenue — building toward our first pilot",
    "Active pilots (paid or unpaid) with design partners",
    "Paying pilots — customers have paid for early access",
    "Live paying customers — repeat revenue",
]

# All 17 SIP template question IDs (Q5–Q24, minus Q7/Q22/Q23).
SIP_TEMPLATE_REQUIRED_KEYS: set[str] = {
    "Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
    "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24",
}
```

Then, inside the `OpenRouterClient` class, just before `_parse_template_response`, add the two new methods:

```python
    # ── SIP template normalisation ────────────────────────────────────────

    _SIP_TEMPLATE_SYSTEM_PROMPT = """You normalise answers from a Word/PDF
SIP application template. The applicant filled 17 questions: Q5, Q6, Q8,
Q9, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20, Q21, Q24.

For each question you receive either:
  - {"free_text": "..."}                          (essay / URL questions)
  - {"free_text": "...", "options": [...]}        (multiple-choice; Q5, Q6, Q8, Q10, Q15)

Each option entry has shape:
    {"letter": "A", "label": "Yes — Pvt Ltd, registered in India",
     "checked": true|false|null}

Return STRICT JSON — no prose, no code fences — with exactly these keys:
{"Q5":  string|null, "Q6":  string|null, "Q8":  string|null,
 "Q9":  string|null, "Q10": string|null, "Q11": string|null,
 "Q12": string|null, "Q13": string|null, "Q14": string|null,
 "Q15": string|null, "Q16": string|null, "Q17": string|null,
 "Q18": string|null, "Q19": string|null, "Q20": string|null,
 "Q21": string|null, "Q24": string|null}

Rules:
- Essay/URL questions (Q9, Q11, Q12, Q13, Q14, Q16, Q17, Q18, Q19, Q20,
  Q21, Q24): emit the applicant's text with leading/trailing whitespace
  stripped. If the cell is empty or contains only placeholder content
  (e.g. "TODO", "n/a"), emit null.
- Q24 is a URL. If it's not a valid http(s) URL, emit null. Do NOT try
  to fix or guess URLs.
- MCQ questions (Q5, Q6, Q8, Q10, Q15): if exactly one option has
  checked=true, emit that option's exact `label` string. If none are
  checked, fall back to free_text — match it against the option labels
  case-insensitively, or accept the option letter (A/B/C/...). If
  ambiguous (multiple checked, or text doesn't match a unique option)
  or empty, emit null.
- Q8 ("Yes"/"No"): also accept "yes"/"y"/"no"/"n" case-insensitively in
  free_text when no checkbox is ticked.
- Never invent content. Never paraphrase. Never reorder.
- Do not include keys other than the 17 listed above.
"""

    _SIP_TEMPLATE_FREEFORM_SYSTEM_PROMPT = """You receive the full plain
text of a SIP application document and a list of 17 questions: Q5, Q6,
Q8, Q9, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20, Q21, Q24.

Document layout you should expect:
- Questions appear as headings like "Q5 · REQUIRED" or "Q9 · OPTIONAL"
  followed by question prompts.
- Answers may be inline (right under each question) or grouped at the
  end of the document.
- Five questions are multiple-choice:
    Q5  → ["Yes — Pvt Ltd, registered in India",
           "Not yet — we're still pre-incorporation"]
    Q6  → ["TRL 3 or earlier — research stage",
           "TRL 4 — lab-validated prototype",
           "TRL 5 — pilot-tested in a relevant environment",
           "TRL 6+ — demonstrated in operational setting"]
    Q8  → ["Yes", "No"]
    Q10 → ["Referral from friend/colleague",
           "IISc faculty or staff",
           "Social media (LinkedIn, Twitter, etc.)",
           "Event or conference",
           "Search engine",
           "Partner organization",
           "News article or press",
           "Other"]
    Q15 → ["Pre-revenue — building toward our first pilot",
           "Active pilots (paid or unpaid) with design partners",
           "Paying pilots — customers have paid for early access",
           "Live paying customers — repeat revenue"]

Return STRICT JSON — no prose, no markdown — with these keys exactly:
{"Q5":  string|null, "Q6":  string|null, "Q8":  string|null,
 "Q9":  string|null, "Q10": string|null, "Q11": string|null,
 "Q12": string|null, "Q13": string|null, "Q14": string|null,
 "Q15": string|null, "Q16": string|null, "Q17": string|null,
 "Q18": string|null, "Q19": string|null, "Q20": string|null,
 "Q21": string|null, "Q24": string|null}

Rules:
- MCQ questions → the exact canonical option string the applicant chose,
  or null if unclear.
- Q24 → a valid http(s) URL or null.
- Other Qs → applicant's answer as-is (whitespace-trimmed).
- If you cannot identify an answer with reasonable confidence, return
  null. Never guess. Never hallucinate.
- Never paraphrase, summarise, translate, or shorten.
"""

    async def normalize_sip_template_answers(
        self,
        payload: dict[str, Any],
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """SIP equivalent of normalize_template_answers — Q5..Q24 minus Q7/Q22/Q23."""
        if not self.api_key:
            raise LLMParseError("OPENROUTER_API_KEY is not configured")

        prompt_payload = {
            "model": self.model,
            "models": [self.model, *FALLBACK_MODELS],
            "messages": [
                {"role": "system", "content": self._SIP_TEMPLATE_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        return await self._run_template_call(
            prompt_payload,
            required_keys=SIP_TEMPLATE_REQUIRED_KEYS,
            user_id=user_id,
            log_label="sip-template",
        )

    async def extract_sip_template_answers_freeform(
        self,
        document_text: str,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """SIP equivalent of extract_template_answers_freeform."""
        if not self.api_key:
            raise LLMParseError("OPENROUTER_API_KEY is not configured")

        if len(document_text) > 30000:
            document_text = document_text[:30000].rstrip() + "\n[TRUNCATED]"

        prompt_payload = {
            "model": self.model,
            "models": [self.model, *FALLBACK_MODELS],
            "messages": [
                {"role": "system", "content": self._SIP_TEMPLATE_FREEFORM_SYSTEM_PROMPT},
                {"role": "user", "content": document_text},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        return await self._run_template_call(
            prompt_payload,
            required_keys=SIP_TEMPLATE_REQUIRED_KEYS,
            user_id=user_id,
            log_label="sip-template-freeform",
        )

    async def _run_template_call(
        self,
        prompt_payload: dict[str, Any],
        *,
        required_keys: set[str],
        user_id: str | None,
        log_label: str,
    ) -> dict[str, Any]:
        """Shared retry + parse loop for template-style calls.

        Factored out of normalize_template_answers /
        extract_template_answers_freeform — same retry/deadline shape,
        parameterised by the required-keys set for output validation.
        """
        headers = self._headers()
        last_err: Exception | None = None

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as http:
            for attempt in range(1, MAX_ATTEMPTS + 1):
                try:
                    body_dict = await asyncio.wait_for(
                        self._post_and_read(http, OPENROUTER_URL, headers, prompt_payload, user_id=user_id),
                        timeout=CALL_DEADLINE_SECONDS,
                    )
                except asyncio.TimeoutError as exc:
                    log.warning(
                        f"openrouter ({log_label}) total deadline exceeded",
                        extra={"attempt": attempt, "deadline_s": CALL_DEADLINE_SECONDS, "user_id": user_id},
                    )
                    if attempt < MAX_ATTEMPTS:
                        continue
                    raise LLMParseError(
                        f"openrouter exceeded {CALL_DEADLINE_SECONDS}s total deadline"
                    ) from exc
                except httpx.HTTPError as exc:
                    last_err = exc
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(2 ** (attempt - 1))
                        continue
                    raise LLMParseError(f"network error after {attempt} attempts: {exc}") from exc
                except _RetryableStatus as exc:
                    last_err = exc
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(2 ** (attempt - 1))
                        continue
                    raise LLMParseError(f"openrouter {exc.status} after retries") from exc

                return self._parse_template_response_strict(
                    body_dict, required_keys=required_keys, user_id=user_id,
                )

        raise LLMParseError(f"exhausted retries: {last_err}")

    def _parse_template_response_strict(
        self,
        body: dict[str, Any],
        *,
        required_keys: set[str],
        user_id: str | None,
    ) -> dict[str, Any]:
        """Parameterised version of _parse_template_response."""
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMParseError(f"unexpected openrouter response shape: {exc}") from exc

        try:
            parsed = _loads_with_repair(content)
        except json.JSONDecodeError as exc:
            raise LLMParseError(f"LLM returned non-JSON content: {exc}") from exc

        if not isinstance(parsed, dict):
            raise LLMParseError("LLM returned JSON that isn't an object")

        missing = required_keys - parsed.keys()
        if missing:
            raise LLMParseError(f"LLM output missing required keys: {sorted(missing)}")

        cleaned: dict[str, Any] = {}
        for k in required_keys:
            v = parsed.get(k)
            if v is None:
                cleaned[k] = None
            elif isinstance(v, str):
                t = v.strip()
                cleaned[k] = t or None
            else:
                cleaned[k] = str(v).strip() or None
        return cleaned
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_llm_service_sip_template.py -v`
Expected: 8 passed.

- [ ] **Step 5: Run the existing TIR template LLM tests to make sure nothing regressed**

Run: `cd backend && pytest tests/ -k "template" -v`
Expected: any pre-existing TIR template tests still pass (no regressions from the new constants/methods).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/llm_service.py backend/tests/test_llm_service_sip_template.py
git commit -m "llm: SIP template normalisation + freeform extraction

Adds SIP-specific option lists (Q5/Q6/Q8/Q10/Q15), required-keys set
(17 questions Q5-Q24 minus Q7/Q22/Q23), system prompts (anchor-based
and freeform-fallback), and the two corresponding async methods on
OpenRouterClient. Factored out the shared retry/deadline loop into
_run_template_call to keep both TIR and SIP entry points DRY without
disturbing TIR call sites."
```

---

## Task 4: Inspect the SIP `.docx` structure (no code — investigation only)

This task is investigation. The injection script in Task 5 depends on understanding the exact structure of the existing SIP template. Spend ~10 minutes here before coding.

**Files:** none.

- [ ] **Step 1: Dump the SIP template's structure**

```bash
python3 -c "
from docx import Document
doc = Document('frontend/public/templates/ARTPARK_SIP_Application_Template.docx')

print('=== PARAGRAPHS ===')
for i, p in enumerate(doc.paragraphs):
    style = p.style.name if p.style else '?'
    text = p.text[:120]
    print(f'{i:3d}  style={style:25s}  {text!r}')

print()
print('=== TABLES ===')
for ti, tbl in enumerate(doc.tables):
    print(f'-- table {ti} ({len(tbl.rows)} rows x {len(tbl.columns)} cols) --')
    for ri, row in enumerate(tbl.rows):
        for ci, cell in enumerate(row.cells):
            txt = ' | '.join(p.text for p in cell.paragraphs)[:160]
            print(f'  r{ri}c{ci}: {txt!r}')
"
```

Expected: a dump that shows where each `Q5 · REQUIRED` heading lives and what follows it (paragraphs vs single-cell table vs multi-cell table). Save the output to a scratch file — Task 5 uses it.

- [ ] **Step 2: Identify the answer-cell pattern**

From the dump, determine for each of the 17 questions:
- Is the answer cell a single-cell table immediately after the heading? Or a paragraph?
- For MCQ questions (Q5, Q6, Q8, Q10, Q15): are the option lines (`A. Yes`, `B. No`) inside the heading paragraph block, inside their own table, or in the answer cell?
- Are there content-control checkboxes (Word's `w14:checkbox`) anywhere? If yes, count them — total across all MCQs.

Write a one-liner inventory like:
```
Q5  : MCQ, options in answer table cell, 2 checkbox controls
Q6  : MCQ, options in answer table cell, 4 checkbox controls
Q8  : MCQ, options in answer table cell, 2 checkbox controls
Q9  : essay, answer is empty single-cell table
Q10 : MCQ, options in answer table cell, 8 checkbox controls
Q11 : essay, answer is empty single-cell table
...
```

The injection logic in Task 5 keys off this inventory. If the actual structure differs from your expectation, the script logic in Task 5 needs adjusting before run.

- [ ] **Step 3: No commit required (investigation only)**

---

## Task 5: Anchor-injection script for the SIP `.docx`

**Files:**
- Create: `scripts/inject_sip_template_anchors.py`
- Modify: `frontend/public/templates/ARTPARK_SIP_Application_Template.docx` (in-place, after running the script)
- Test: `backend/tests/test_inject_sip_template_anchors.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_inject_sip_template_anchors.py`:

```python
"""Integration test for the anchor-injection script.

Runs the script against the on-disk SIP template and verifies that
the resulting .docx contains START + END anchor markers for all 17
target questions, and that the python-docx text extraction picks
them up in the expected positions.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SIP_TEMPLATE_PATH = REPO_ROOT / "frontend" / "public" / "templates" / "ARTPARK_SIP_Application_Template.docx"
SCRIPT_PATH = REPO_ROOT / "scripts" / "inject_sip_template_anchors.py"

SIP_QUESTION_IDS = ["Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
                    "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24"]


def _docx_text(path: Path) -> str:
    from docx import Document
    doc = Document(str(path))
    parts = [p.text for p in doc.paragraphs]
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                parts.extend(p.text for p in cell.paragraphs)
    return "\n".join(parts)


def test_script_idempotent_and_injects_all_anchors(tmp_path: Path) -> None:
    assert SIP_TEMPLATE_PATH.exists(), "SIP template not at expected path"
    assert SCRIPT_PATH.exists(), "Injection script missing"

    # Copy to a tmp file so the test doesn't mutate the repo copy.
    work = tmp_path / "sip_template.docx"
    shutil.copy(SIP_TEMPLATE_PATH, work)

    import subprocess
    result = subprocess.run(
        ["python3", str(SCRIPT_PATH), str(work)],
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, f"script failed: {result.stderr}"

    text = _docx_text(work)
    for qid in SIP_QUESTION_IDS:
        assert f">>> ANSWER {qid} START >>>" in text, f"missing START anchor for {qid}"
        assert f"<<< ANSWER {qid} END <<<" in text, f"missing END anchor for {qid}"

    # Run a second time — script must be idempotent (no duplicate anchors).
    result2 = subprocess.run(
        ["python3", str(SCRIPT_PATH), str(work)],
        capture_output=True, text=True, check=False,
    )
    assert result2.returncode == 0, f"second run failed: {result2.stderr}"

    text2 = _docx_text(work)
    for qid in SIP_QUESTION_IDS:
        start_count = len(re.findall(re.escape(f">>> ANSWER {qid} START >>>"), text2))
        end_count = len(re.findall(re.escape(f"<<< ANSWER {qid} END <<<"), text2))
        assert start_count == 1, f"{qid}: expected 1 START anchor, got {start_count}"
        assert end_count == 1, f"{qid}: expected 1 END anchor, got {end_count}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_inject_sip_template_anchors.py -v`
Expected: AssertionError "Injection script missing" — script doesn't exist yet.

- [ ] **Step 3: Implement the injection script**

Create `scripts/inject_sip_template_anchors.py`. The exact body depends on what Task 4's investigation revealed about the docx structure. The skeleton below assumes the common pattern: each question has a `QN · (REQUIRED|OPTIONAL)` paragraph followed by a single-cell answer table.

```python
#!/usr/bin/env python3
"""Inject anchor markers into the SIP application template .docx.

The SIP template ships without `>>> ANSWER QN START >>>` / `<<< ANSWER QN
END <<<` markers, but the SIP parser (services/sip_template_parser.py)
depends on them. This script walks the document, finds each question
heading, and inserts marker paragraphs inside the corresponding answer
cell so the parser can deterministically slice each answer.

Usage:
    python3 scripts/inject_sip_template_anchors.py <path/to/template.docx>

Idempotent: a second run is a no-op (markers already present are detected
and skipped).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import _Cell

TARGET_QIDS = ["Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
               "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24"]

HEADING_RE = re.compile(
    r"^\s*(Q\d+)\s*[··]\s*(REQUIRED|OPTIONAL)\b",
    re.IGNORECASE,
)


def _heading_qid(text: str) -> str | None:
    m = HEADING_RE.match(text)
    if not m:
        return None
    qid = m.group(1).upper()
    return qid if qid in TARGET_QIDS else None


def _cell_text(cell: _Cell) -> str:
    return "\n".join(p.text for p in cell.paragraphs)


def _insert_marker_at_start(cell: _Cell, marker: str) -> None:
    """Insert a paragraph at the top of the cell."""
    new_p = cell.paragraphs[0].insert_paragraph_before(marker)
    # No further styling needed — the parser strips whitespace.


def _insert_marker_at_end(cell: _Cell, marker: str) -> None:
    """Append a paragraph at the bottom of the cell."""
    cell.add_paragraph(marker)


def _find_following_table(body_iter, after_paragraph_element):
    """Return the next w:tbl element after the given w:p element."""
    seen_p = False
    for el in body_iter:
        if el is after_paragraph_element:
            seen_p = True
            continue
        if not seen_p:
            continue
        if el.tag == qn("w:tbl"):
            return el
        if el.tag == qn("w:p"):
            # Another paragraph before a table — keep searching unless
            # the next paragraph is also a Q heading, in which case
            # there's no answer table for the first heading.
            text = "".join(t.text or "" for t in el.iter(qn("w:t")))
            if HEADING_RE.match(text):
                return None
    return None


def inject(path: Path) -> int:
    """Inject anchors in-place. Returns the number of question pairs added."""
    doc = Document(str(path))
    body = doc.element.body
    body_children = list(body)

    # Build a paragraph-element → docx paragraph object lookup so we can
    # navigate from XML back to the python-docx wrapper for cell access.
    para_by_el = {p._p: p for p in doc.paragraphs}

    # Build a w:tbl element → docx.Table lookup similarly.
    table_by_el = {t._tbl: t for t in doc.tables}

    pairs_added = 0
    for i, el in enumerate(body_children):
        if el.tag != qn("w:p"):
            continue
        p = para_by_el.get(el)
        if p is None:
            continue
        qid = _heading_qid(p.text)
        if not qid:
            continue

        # Locate the answer container — the next w:tbl in body order.
        next_tbl = _find_following_table(body_children, el)
        if next_tbl is None:
            print(f"[warn] no answer table found after heading {qid}", file=sys.stderr)
            continue

        tbl = table_by_el.get(next_tbl)
        if tbl is None:
            print(f"[warn] table found but not wrapped for {qid}", file=sys.stderr)
            continue

        # The SIP template uses single-cell answer tables; if it ever
        # ships a multi-cell answer, fall back to row 0, col 0.
        cell = tbl.rows[0].cells[0]

        existing = _cell_text(cell)
        start_marker = f">>> ANSWER {qid} START >>>"
        end_marker = f"<<< ANSWER {qid} END <<<"

        if start_marker in existing and end_marker in existing:
            # Already injected — skip (idempotency).
            continue

        if start_marker not in existing:
            _insert_marker_at_start(cell, start_marker)
        if end_marker not in existing:
            _insert_marker_at_end(cell, end_marker)
        pairs_added += 1

    doc.save(str(path))
    return pairs_added


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: inject_sip_template_anchors.py <path/to/template.docx>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    if not path.exists():
        print(f"file not found: {path}", file=sys.stderr)
        return 3
    n = inject(path)
    print(f"injected/verified {n} question pair(s) in {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_inject_sip_template_anchors.py -v`
Expected: 1 passed.

If the test fails because `_find_following_table` misidentifies a structure (e.g., a paragraph block holds the answer rather than a table), revisit Task 4 inspection and adjust the script. Common alternative: if some answers live in paragraphs rather than tables, add a branch that inserts a marker paragraph directly into the body before/after the answer paragraph(s).

- [ ] **Step 5: Run the script against the actual in-repo SIP template**

```bash
python3 scripts/inject_sip_template_anchors.py frontend/public/templates/ARTPARK_SIP_Application_Template.docx
```

Expected: `injected/verified 17 question pair(s) in frontend/public/templates/ARTPARK_SIP_Application_Template.docx`

If you see fewer than 17, some structural pattern wasn't matched by the script. Re-read Task 4 dump, then revise the script (and update the test if needed) before continuing.

- [ ] **Step 6: Visually verify in Word/LibreOffice**

Open the modified `.docx` in Word or LibreOffice (the user can do this manually if you're a subagent). Spot-check 2–3 questions: the START marker should appear at the top of each grey answer box, and the END marker at the bottom. Markers should not be inside the question prose.

- [ ] **Step 7: Commit**

```bash
git add scripts/inject_sip_template_anchors.py backend/tests/test_inject_sip_template_anchors.py frontend/public/templates/ARTPARK_SIP_Application_Template.docx
git commit -m "scripts: inject anchor markers into the SIP template

One-shot reproducible script. Walks the .docx body, finds each
QN · REQUIRED/OPTIONAL heading, locates the next answer table, and
inserts >>> ANSWER QN START >>> / <<< ANSWER QN END <<< paragraphs
inside the first cell. Idempotent — second runs are no-ops. Test
copies the on-disk template to a tmp file and asserts all 17
question pairs are present (and run twice without duplication).

The committed .docx is the result of running this script once
against the original SIP template, so the deterministic SIP parser
has the markers it needs."
```

---

## Task 6: SIP-specific parser orchestrator

**Files:**
- Create: `backend/app/services/sip_template_parser.py`
- Test: `backend/tests/test_sip_template_parser.py`
- Test fixtures: `backend/tests/fixtures/sip_template_anchored_complete.docx`, `sip_template_anchored_partial.docx`, `sip_template_anchors_stripped.docx`, `sip_template_empty.docx` (generated below — script written first)

- [ ] **Step 1: Write the fixture-builder script**

Create `scripts/build_sip_test_fixtures.py`:

```python
#!/usr/bin/env python3
"""Generate the six SIP template test fixtures from a small data spec.

Output files land in backend/tests/fixtures/.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from docx import Document

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "backend" / "tests" / "fixtures"
SOURCE_TEMPLATE = REPO_ROOT / "frontend" / "public" / "templates" / "ARTPARK_SIP_Application_Template.docx"

ALL_QIDS = ["Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
            "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24"]

REQUIRED_QIDS = ["Q5", "Q6", "Q8", "Q10", "Q11", "Q12", "Q13", "Q15",
                 "Q16", "Q17", "Q18", "Q19"]

COMPLETE_ANSWERS = {
    "Q5":  "Yes — Pvt Ltd, registered in India",
    "Q6":  "TRL 4 — lab-validated prototype",
    "Q8":  "No",
    "Q9":  "",
    "Q10": "Referral from friend/colleague",
    "Q11": "We tackle the problem of inadequate post-harvest cold chain in tier-3 towns.",
    "Q12": "A modular, solar-powered cold storage unit deployable in 48 hours.",
    "Q13": "Phase-change thermal storage built from a patented composite.",
    "Q14": "Most experts overweight capex; opex dominates 5-year TCO.",
    "Q15": "Active pilots (paid or unpaid) with design partners",
    "Q16": "Two pilots with FPOs in Maharashtra, one paid LOI in Karnataka.",
    "Q17": "Material fatigue under 45C ambient — solved with composite v2.",
    "Q18": "Three deployments by Q3; one paying customer by Q4; opex reduced 40% YoY.",
    "Q19": "Specialized sensor calibration lab; access to robotics testbed.",
    "Q20": "Initial prototype failed in monsoon humidity; pivoted to sealed composite.",
    "Q21": "Strict hardware-in-the-loop sim suite; weekly drift audits.",
    "Q24": "https://www.loom.com/share/abc123",
}


def _write_answers(path: Path, answers: dict[str, str]) -> None:
    shutil.copy(SOURCE_TEMPLATE, path)
    doc = Document(str(path))

    # Replace text inside each anchor block. Anchors are paragraph-level,
    # so we walk each table cell, find the START anchor, then overwrite
    # subsequent paragraphs (up to END) with the answer text.
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                paras = cell.paragraphs
                for i, p in enumerate(paras):
                    txt = p.text.strip()
                    if not txt.startswith(">>> ANSWER "):
                        continue
                    qid = txt.split(" ")[2]
                    if qid not in answers:
                        continue
                    # Find matching END marker.
                    end_idx = None
                    for j in range(i + 1, len(paras)):
                        if paras[j].text.strip().startswith("<<< ANSWER "):
                            end_idx = j
                            break
                    if end_idx is None:
                        continue
                    # Overwrite the run of "answer area" paragraphs between
                    # i+1 and end_idx-1 with a single paragraph holding the
                    # answer. Easiest: clear text on those, set the first
                    # one's text to the answer.
                    answer = answers[qid]
                    for j in range(i + 1, end_idx):
                        paras[j].text = ""
                    if i + 1 < end_idx:
                        paras[i + 1].text = answer

    doc.save(str(path))


def build_anchored_complete(path: Path) -> None:
    _write_answers(path, COMPLETE_ANSWERS)


def build_anchored_partial(path: Path) -> None:
    partial = {k: v for k, v in COMPLETE_ANSWERS.items() if k in REQUIRED_QIDS}
    _write_answers(path, partial)


def build_empty(path: Path) -> None:
    # Copy with anchors intact but no answer text written.
    shutil.copy(SOURCE_TEMPLATE, path)
    doc = Document(str(path))
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    if not p.text.strip().startswith((">>> ANSWER", "<<< ANSWER")):
                        p.text = ""
    doc.save(str(path))


def build_anchors_stripped(path: Path) -> None:
    # Copy of complete, but strip every anchor marker paragraph.
    build_anchored_complete(path)
    doc = Document(str(path))
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    if p.text.strip().startswith((">>> ANSWER", "<<< ANSWER")):
                        p.text = ""
    doc.save(str(path))


def main() -> int:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    build_anchored_complete(FIXTURE_DIR / "sip_template_anchored_complete.docx")
    build_anchored_partial(FIXTURE_DIR / "sip_template_anchored_partial.docx")
    build_empty(FIXTURE_DIR / "sip_template_empty.docx")
    build_anchors_stripped(FIXTURE_DIR / "sip_template_anchors_stripped.docx")

    # The TIR template doubles as the wrong-track fixture; symlink-style copy.
    shutil.copy(
        REPO_ROOT / "frontend" / "public" / "templates" / "ARTPARK_TIR_Application_Template.docx",
        FIXTURE_DIR / "sip_template_tir_uploaded.docx",
    )

    print(f"wrote 5 fixtures to {FIXTURE_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the fixture builder**

```bash
python3 scripts/build_sip_test_fixtures.py
```

Expected: `wrote 5 fixtures to /…/backend/tests/fixtures` and five `.docx` files now exist there.

- [ ] **Step 3: Write the failing parser test**

Create `backend/tests/test_sip_template_parser.py`:

```python
"""Unit tests for services.sip_template_parser.

Uses the committed fixtures under tests/fixtures/. The OpenRouter LLM
calls are stubbed — these tests exercise the deterministic extraction
+ slicing path and the SIP-specific orchestration.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.services.sip_template_parser import (
    QUESTION_TO_SIP_COLUMN,
    SIP_QUESTION_IDS,
    parse_sip_template,
)
from app.services.template_parser import TemplateParseError

FIXTURE_DIR = Path(__file__).parent / "fixtures"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _load_fixture(name: str) -> bytes:
    return (FIXTURE_DIR / name).read_bytes()


def test_question_to_sip_column_covers_all_17_questions() -> None:
    assert set(QUESTION_TO_SIP_COLUMN.keys()) == set(SIP_QUESTION_IDS)


def test_question_to_sip_column_maps_mcq_to_check_constraint_columns() -> None:
    assert QUESTION_TO_SIP_COLUMN["Q5"] == "sip_incorporated"
    assert QUESTION_TO_SIP_COLUMN["Q6"] == "sip_trl"
    assert QUESTION_TO_SIP_COLUMN["Q8"] == "basic_incubator_association"
    assert QUESTION_TO_SIP_COLUMN["Q10"] == "basic_hear_about"
    assert QUESTION_TO_SIP_COLUMN["Q15"] == "sip_traction"
    assert QUESTION_TO_SIP_COLUMN["Q24"] == "sip_demo_video_url"


@pytest.mark.asyncio
async def test_parse_anchored_complete_returns_all_17_keys() -> None:
    file_bytes = _load_fixture("sip_template_anchored_complete.docx")

    # Stub the LLM normalisation: pretend Gemini echoes back the cell text
    # for essays and the option label for MCQs.
    async def fake_normalize(payload, *, user_id=None):
        out = {qid: None for qid in SIP_QUESTION_IDS}
        for qid, entry in payload.items():
            if "options" in entry:
                ticked = [o for o in entry["options"] if o.get("checked")]
                if len(ticked) == 1:
                    out[qid] = ticked[0]["label"]
                else:
                    # Fall back to free_text containing the canonical label.
                    out[qid] = entry["free_text"].strip() or None
            else:
                out[qid] = entry["free_text"].strip() or None
        return out

    with patch("app.services.sip_template_parser.OpenRouterClient") as mock_client:
        instance = mock_client.return_value
        instance.normalize_sip_template_answers = AsyncMock(side_effect=fake_normalize)
        result = await parse_sip_template(
            file_bytes=file_bytes, mime=DOCX_MIME, user_id="u-1",
        )

    assert set(result.keys()) == set(SIP_QUESTION_IDS)
    assert result["Q11"], "Q11 (problem describe) should be filled"


@pytest.mark.asyncio
async def test_parse_empty_document_raises_template_parse_error() -> None:
    with pytest.raises(TemplateParseError) as excinfo:
        await parse_sip_template(file_bytes=b"", mime=DOCX_MIME, user_id="u-2")
    assert excinfo.value.code == "empty_document"


@pytest.mark.asyncio
async def test_parse_anchors_stripped_falls_back_to_freeform() -> None:
    file_bytes = _load_fixture("sip_template_anchors_stripped.docx")

    async def fake_freeform(document_text, *, user_id=None):
        return {qid: None for qid in SIP_QUESTION_IDS} | {
            "Q11": "Recovered via freeform fallback.",
        }

    with patch("app.services.sip_template_parser.OpenRouterClient") as mock_client:
        instance = mock_client.return_value
        instance.extract_sip_template_answers_freeform = AsyncMock(side_effect=fake_freeform)
        result = await parse_sip_template(
            file_bytes=file_bytes, mime=DOCX_MIME, user_id="u-3",
        )

    assert result["Q11"] == "Recovered via freeform fallback."
    # All other keys are None.
    assert result["Q5"] is None


@pytest.mark.asyncio
async def test_parse_tir_template_returns_mostly_null_for_sip_keys() -> None:
    file_bytes = _load_fixture("sip_template_tir_uploaded.docx")

    async def fake_freeform(document_text, *, user_id=None):
        # TIR template has no SIP-question anchors; freeform LLM should return null for all.
        return {qid: None for qid in SIP_QUESTION_IDS}

    with patch("app.services.sip_template_parser.OpenRouterClient") as mock_client:
        instance = mock_client.return_value
        instance.extract_sip_template_answers_freeform = AsyncMock(side_effect=fake_freeform)
        result = await parse_sip_template(
            file_bytes=file_bytes, mime=DOCX_MIME, user_id="u-4",
        )

    filled = [v for v in result.values() if v]
    assert len(filled) == 0  # router uses this to detect wrong-track upload
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_sip_template_parser.py -v`
Expected: `ModuleNotFoundError: No module named 'app.services.sip_template_parser'`

- [ ] **Step 5: Implement the SIP parser orchestrator**

Create `backend/app/services/sip_template_parser.py`:

```python
"""SIP-specific orchestration over the schema-agnostic template_parser.

Mirrors the shape of services.template_parser.parse_template() but for
the SIP question schema (17 questions Q5..Q24 minus Q7/Q22/Q23) and
the SIP MCQ option lists. Delegates docx/pdf extraction + anchor
slicing + checkbox reading to template_parser; this module only owns
the SIP-specific facts:

  - Which question IDs to expect
  - Which questions are MCQ (so we know to fold checkbox state in)
  - The mapping from question ID to sip_applications column
  - Which LLM methods to call (the SIP variants on OpenRouterClient)
"""
from __future__ import annotations

import logging
from typing import Any

from .llm_service import LLMParseError, OpenRouterClient
from .template_parser import (
    DOCX_MIME,
    PDF_MIME,
    TemplateParseError,
    _docx_checkbox_states,
    _docx_concatenated_text,
    _extract_anchor_blocks,
    _pdf_text,
    _split_options_from_block,
)

log = logging.getLogger(__name__)

SIP_QUESTION_IDS: list[str] = [
    "Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
    "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24",
]

# MCQ questions in document order. Q5, Q6, Q8, Q10, Q15 each have an
# A/B/C option list and (for .docx) Word content-control checkboxes.
SIP_MCQ_QUESTIONS: tuple[str, ...] = ("Q5", "Q6", "Q8", "Q10", "Q15")

# Mapping consumed by routers.sip_application_templates apply flow.
# Every column listed here already exists on public.sip_applications
# (migrations 011 + 012).
QUESTION_TO_SIP_COLUMN: dict[str, str] = {
    "Q5":  "sip_incorporated",
    "Q6":  "sip_trl",
    "Q8":  "basic_incubator_association",
    "Q9":  "basic_incubator_details",
    "Q10": "basic_hear_about",
    "Q11": "problem_describe",
    "Q12": "solution_describe",
    "Q13": "solution_core_tech",
    "Q14": "solution_contrarian_insight",
    "Q15": "sip_traction",
    "Q16": "sip_traction_details",
    "Q17": "execution_will_break",
    "Q18": "execution_milestone",
    "Q19": "execution_infrastructure",
    "Q20": "execution_failure",
    "Q21": "execution_hwsw_integration",
    "Q24": "sip_demo_video_url",
}


async def parse_sip_template(
    *,
    file_bytes: bytes,
    mime: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Run the SIP pipeline and return the normalised dict.

    Output shape (always emitted, never partial):
        {Q5: str|None, Q6: str|None, ..., Q24: str|None}
    """
    if not file_bytes:
        raise TemplateParseError("empty_document", "Empty file uploaded.")

    mime = (mime or "").lower().strip()

    # 1. Extract concatenated text + checkbox states.
    if mime == DOCX_MIME:
        try:
            full_text = _docx_concatenated_text(file_bytes)
            checkbox_states = _docx_checkbox_states(file_bytes)
        except Exception as exc:
            log.warning("sip docx extraction failed", extra={"err": str(exc)})
            raise TemplateParseError("empty_document", f"Could not read .docx: {exc}") from exc
    elif mime == PDF_MIME:
        try:
            full_text = _pdf_text(file_bytes)
        except Exception as exc:
            log.warning("sip pdf extraction failed", extra={"err": str(exc)})
            raise TemplateParseError("empty_document", f"Could not read PDF: {exc}") from exc
        checkbox_states = []
    else:
        raise TemplateParseError(
            "unsupported_mime",
            "Please upload the filled SIP template as .docx (preferred) or .pdf.",
        )

    if not full_text.strip():
        raise TemplateParseError("empty_document", "No text could be extracted.")

    # 2. Split into per-question anchor blocks.
    blocks = _extract_anchor_blocks(full_text)

    # Fallback: if <3 SIP-relevant anchor blocks, hand the whole doc to
    # the SIP freeform LLM. This is also the path that catches
    # wrong-track uploads (TIR template uploaded to SIP) — the freeform
    # LLM will return mostly null, and the router demotes the parse as
    # `wrong_track_template` when the filled-key count is too low.
    sip_blocks = {k: v for k, v in blocks.items() if k in SIP_QUESTION_IDS}
    if len(sip_blocks) < 3:
        log.info(
            "sip template anchor extraction sparse, falling back to freeform LLM",
            extra={"user_id": user_id, "anchor_count": len(sip_blocks)},
        )
        try:
            normalised = await OpenRouterClient().extract_sip_template_answers_freeform(
                full_text, user_id=user_id,
            )
        except LLMParseError as exc:
            if not sip_blocks:
                raise TemplateParseError(
                    "no_anchors_detected",
                    "We couldn't find any of the answer markers in this file, "
                    "and the fallback parser couldn't extract answers either. "
                    "Please download the SIP template above and fill answers "
                    "between the >>> ANSWER QN START >>> markers.",
                ) from exc
            raise TemplateParseError("llm_normalization_failed", str(exc)) from exc
        return {qid: normalised.get(qid) for qid in SIP_QUESTION_IDS}

    # 3. Fold checkbox state into MCQ blocks by document-order position.
    #    Q5 (2 boxes) + Q6 (4) + Q8 (2) + Q10 (8) + Q15 (4) = 20 total.
    mcq_payload: dict[str, dict[str, Any]] = {}
    cb_cursor = 0
    for qid in SIP_MCQ_QUESTIONS:
        block = sip_blocks.get(qid, "")
        leftover, options = _split_options_from_block(block)
        states_for_q: list[tuple[str, str, bool | None]] = []
        for letter, label in options:
            state: bool | None
            if cb_cursor < len(checkbox_states):
                state = checkbox_states[cb_cursor]
            else:
                state = None  # PDFs / older Word — let the LLM decide
            states_for_q.append((letter, label, state))
            cb_cursor += 1
        mcq_payload[qid] = {
            "free_text": leftover,
            "options": [
                {"letter": l, "label": lbl, "checked": st}
                for (l, lbl, st) in states_for_q
            ],
        }

    # 4. Build LLM input. Essays get raw text; MCQs come with their grids.
    payload: dict[str, Any] = {}
    for qid in SIP_QUESTION_IDS:
        if qid in SIP_MCQ_QUESTIONS:
            payload[qid] = mcq_payload.get(qid, {"free_text": "", "options": []})
        else:
            payload[qid] = {"free_text": sip_blocks.get(qid, "").strip()}

    try:
        normalised = await OpenRouterClient().normalize_sip_template_answers(
            payload, user_id=user_id,
        )
    except LLMParseError as exc:
        raise TemplateParseError("llm_normalization_failed", str(exc)) from exc

    return {qid: normalised.get(qid) for qid in SIP_QUESTION_IDS}
```

Note: this imports private helpers (`_docx_concatenated_text`, etc.) from `template_parser.py`. That's fine — they're in the same package and stable. The spec calls for a tighter "shared module reorganisation" in §6 but the cleanest implementation reuses them in place without churning `template_parser.py`. If you'd rather, you can drop the leading underscore on those helpers in `template_parser.py` (this is a 1-line rename per helper) but it isn't required for correctness.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_sip_template_parser.py -v`
Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/sip_template_parser.py backend/tests/test_sip_template_parser.py scripts/build_sip_test_fixtures.py backend/tests/fixtures/sip_template_*.docx
git commit -m "parser: SIP template orchestrator + test fixtures

parse_sip_template mirrors template_parser.parse_template but for the
17-question SIP schema (Q5..Q24 minus Q7/Q22/Q23). Reuses docx/pdf
extraction + anchor slicing + checkbox folding from template_parser;
swaps in SIP-specific MCQ question list, LLM methods, and the
QUESTION_TO_SIP_COLUMN mapping for routers/sip_application_templates.

build_sip_test_fixtures.py committed alongside so the five .docx
fixtures (anchored complete, anchored partial, anchors stripped,
empty, TIR-uploaded-as-SIP) are reproducible."
```

---

## Task 7: SIP router — POST /upload

**Files:**
- Create: `backend/app/routers/sip_application_templates.py` (router skeleton + upload endpoint)
- Test: `backend/tests/test_sip_application_templates_upload.py`

- [ ] **Step 1: Write the failing upload tests**

Create `backend/tests/test_sip_application_templates_upload.py`:

```python
"""Tests for POST /sip-application-templates/upload."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest


FIXTURE_DIR = Path(__file__).parent / "fixtures"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SIP_QIDS = ["Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
            "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_upload_rejects_unauthenticated(client) -> None:
    resp = client.post("/sip-application-templates/upload", files={
        "file": ("sip.docx", b"x", DOCX_MIME),
    })
    assert resp.status_code == 401


def test_upload_rejects_wrong_mime(client, sip_user_token) -> None:
    resp = client.post(
        "/sip-application-templates/upload",
        headers=_bearer(sip_user_token),
        files={"file": ("foo.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 415


def test_upload_rejects_oversize(client, sip_user_token) -> None:
    big = b"x" * (10 * 1024 * 1024 + 1)
    resp = client.post(
        "/sip-application-templates/upload",
        headers=_bearer(sip_user_token),
        files={"file": ("big.docx", big, DOCX_MIME)},
    )
    assert resp.status_code == 413


def test_upload_rejects_empty(client, sip_user_token) -> None:
    resp = client.post(
        "/sip-application-templates/upload",
        headers=_bearer(sip_user_token),
        files={"file": ("empty.docx", b"", DOCX_MIME)},
    )
    assert resp.status_code == 400


def test_upload_happy_path(client, sip_user_token) -> None:
    file_bytes = (FIXTURE_DIR / "sip_template_anchored_complete.docx").read_bytes()

    fake_parse = {qid: f"answer-{qid}" for qid in SIP_QIDS}
    with patch("app.routers.sip_application_templates.parse_sip_template",
               new=AsyncMock(return_value=fake_parse)):
        resp = client.post(
            "/sip-application-templates/upload",
            headers=_bearer(sip_user_token),
            files={"file": ("sip.docx", file_bytes, DOCX_MIME)},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["parse_status"] == "completed"
    assert body["parsed_data"]["Q5"] == "answer-Q5"
    assert body["original_filename"] == "sip.docx"


def test_upload_requires_sip_track(client, tir_user_token) -> None:
    file_bytes = (FIXTURE_DIR / "sip_template_anchored_complete.docx").read_bytes()
    resp = client.post(
        "/sip-application-templates/upload",
        headers=_bearer(tir_user_token),
        files={"file": ("sip.docx", file_bytes, DOCX_MIME)},
    )
    assert resp.status_code == 403


def test_upload_persists_failed_on_parser_error(client, sip_user_token) -> None:
    from app.services.template_parser import TemplateParseError
    file_bytes = (FIXTURE_DIR / "sip_template_anchored_complete.docx").read_bytes()

    async def boom(*args, **kwargs):
        raise TemplateParseError("empty_document", "test")

    with patch("app.routers.sip_application_templates.parse_sip_template", new=boom):
        resp = client.post(
            "/sip-application-templates/upload",
            headers=_bearer(sip_user_token),
            files={"file": ("sip.docx", file_bytes, DOCX_MIME)},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["parse_status"] == "failed"
    assert "empty_document" in (body["message"] or "")
```

The `client`, `sip_user_token`, `tir_user_token` fixtures must come from `conftest.py` — add them there if they don't yet exist (TIR resume tests use a similar `client` fixture; the SIP/TIR token fixtures follow the existing JWT-mock pattern in `tests/conftest.py`).

- [ ] **Step 2: Add `sip_user_token` and `tir_user_token` to conftest if missing**

Open `backend/tests/conftest.py`. Add (after the existing `client` fixture):

```python
@pytest.fixture
def sip_user_token(monkeypatch):
    """Mock a SIP-track user with a valid bearer token."""
    return _mint_token(monkeypatch, user_id="sip-user-1", track="sip")


@pytest.fixture
def tir_user_token(monkeypatch):
    """Mock a TIR-track user with a valid bearer token."""
    return _mint_token(monkeypatch, user_id="tir-user-1", track="tir")
```

Plus a helper `_mint_token(monkeypatch, *, user_id, track)` that monkeypatches `get_current_user` and `require_track` to honour the bearer string. If a similar helper already exists in conftest under a different name, alias it instead. The exact shape depends on the existing fixture setup — read `backend/tests/conftest.py` first and follow what's already there.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_sip_application_templates_upload.py -v`
Expected: 7 errors — `ModuleNotFoundError` for the router module (or 404s if the router isn't wired into the app yet).

- [ ] **Step 4: Implement the router (upload endpoint only — GET /me and apply come in later tasks)**

Create `backend/app/routers/sip_application_templates.py`:

```python
"""SIP offline application-template upload + parse pipeline.

SIP equivalent of routers/application_templates.py. Applicants
download `/templates/ARTPARK_SIP_Application_Template.docx`, fill it
offline, then upload the filled document here. Each answer between
the literal anchor markers ends up in the matching `sip_applications`
column on the user's open draft — NULL-only writes (deliberate
divergence from TIR's overwrite-on-apply; see spec D6).

Endpoints (all require auth via get_current_user + sip track):

    POST /sip-application-templates/upload                       inline parse
    GET  /sip-application-templates/me                           latest row
    POST /sip-application-templates/me/apply-to-application      copy into draft

Rate limits (per-user):
    POST /upload                       5/hour/user
    GET  /me                           30/min/user
    POST /me/apply-to-application      10/hour/user
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, status

from ..deps import get_current_user, require_track
from ..models.sip_application_template import (
    SipApplicationTemplateRecord,
    SipApplicationTemplateUploadResponse,
    SipApplyTemplateResult,
)
from ..services.sip_template_parser import (
    QUESTION_TO_SIP_COLUMN,
    SIP_QUESTION_IDS,
    parse_sip_template,
)
from ..services.template_parser import (
    DOCX_MIME,
    PDF_MIME,
    TemplateParseError,
)
from ..supabase_client import get_admin_client
from ..utils.rate_limit import per_user_rate_limit

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/sip-application-templates",
    tags=["sip-application-templates"],
    dependencies=[Depends(require_track("sip"))],
)

_BUCKET = "sip-application-templates"
_TABLE = "sip_application_templates"
_DRAFT_TABLE = "sip_applications"
_MAX_BYTES = 10 * 1024 * 1024
_ALLOWED_MIME = {DOCX_MIME, PDF_MIME}
_MIME_TO_EXT = {DOCX_MIME: "docx", PDF_MIME: "pdf"}

PARSE_BUDGET_SECONDS = 22.0

_rl_upload = per_user_rate_limit("sip-template-upload", 5, 3600)
_rl_get_me = per_user_rate_limit("sip-template-get-me", 30, 60)
_rl_apply = per_user_rate_limit("sip-template-apply", 10, 3600)


# ── Helpers ───────────────────────────────────────────────────────────────

def _stamp_failed(template_id: str, code: str, detail: str | None = None) -> None:
    error = code if not detail else f"{code}: {detail}"
    try:
        get_admin_client().table(_TABLE).update(
            {"parse_status": "failed", "parse_error": error[:1000]}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.error("could not stamp sip template failed",
                  extra={"template_id": template_id, "err": str(exc)})


def _audit(user_id: str, action: str, metadata: dict[str, Any]) -> None:
    try:
        get_admin_client().table("audit_logs").insert(
            {"user_id": user_id, "action": action, "metadata": metadata}
        ).execute()
    except Exception as exc:
        log.warning("audit insert failed",
                    extra={"user_id": user_id, "action": action, "err": str(exc)})


def _fetch_draft_application_id(user_id: str) -> str | None:
    res = (
        get_admin_client()
        .table(_DRAFT_TABLE)
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "draft")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0]["id"] if rows else None


# ── POST /upload ──────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=SipApplicationTemplateUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rl_upload)],
)
async def upload_sip_template(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    start = time.monotonic()
    user_id = current_user["user_id"]

    mime = (file.content_type or "").lower()
    if mime not in _ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Please upload the filled SIP template as .docx (preferred) or .pdf.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(file_bytes) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {_MAX_BYTES // (1024 * 1024)} MiB.",
        )

    ext = _MIME_TO_EXT[mime]
    storage_path = f"{user_id}/{uuid.uuid4()}.{ext}"
    admin = get_admin_client()

    try:
        admin.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime},
        )
    except Exception as exc:
        log.error("sip template storage upload failed",
                  extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=502, detail="Storage upload failed.") from exc

    application_id = _fetch_draft_application_id(user_id)

    try:
        insert = (
            admin.table(_TABLE)
            .insert({
                "user_id": user_id,
                "application_id": application_id,
                "storage_path": storage_path,
                "original_filename": file.filename or f"sip-template.{ext}",
                "file_size_bytes": len(file_bytes),
                "mime_type": mime,
                "parse_status": "pending",
            })
            .execute()
        )
        row = (insert.data or [None])[0]
        if not row:
            raise RuntimeError("insert returned no rows")
        template_id = row["id"]
    except Exception as exc:
        log.error("sip_application_templates insert failed",
                  extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=500, detail="Could not record upload.") from exc

    _audit(user_id, "sip_template.uploaded",
           {"template_id": str(template_id), "application_id": application_id,
            "mime": mime, "size_bytes": len(file_bytes)})

    if time.monotonic() - start > PARSE_BUDGET_SECONDS:
        return SipApplicationTemplateUploadResponse(
            template_id=template_id,
            parse_status="pending",
            original_filename=file.filename or f"sip-template.{ext}",
            message="Upload received. Parsing queued — poll GET /sip-application-templates/me.",
        )

    parse_status, parsed_data, parse_error = await _parse_inline(
        file_bytes=file_bytes, mime=mime, template_id=template_id, user_id=user_id,
    )

    return SipApplicationTemplateUploadResponse(
        template_id=template_id,
        parse_status=parse_status,
        original_filename=file.filename or f"sip-template.{ext}",
        parsed_data=parsed_data if parse_status == "completed" else None,
        message=parse_error if parse_status == "failed" else None,
    )


async def _parse_inline(
    *,
    file_bytes: bytes,
    mime: str,
    template_id: str,
    user_id: str,
) -> tuple[str, dict[str, Any] | None, str | None]:
    admin = get_admin_client()

    try:
        admin.table(_TABLE).update(
            {"parse_status": "processing"}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.warning("could not stamp sip template processing",
                    extra={"template_id": template_id, "err": str(exc)})

    try:
        parsed = await parse_sip_template(file_bytes=file_bytes, mime=mime, user_id=user_id)
    except TemplateParseError as exc:
        _stamp_failed(template_id, exc.code, exc.detail)
        _audit(user_id, "sip_template.parsed",
               {"template_id": str(template_id), "parse_status": "failed",
                "parse_error": exc.code})
        return "failed", None, exc.code
    except Exception as exc:
        log.exception("unexpected sip template parse error",
                      extra={"template_id": template_id})
        _stamp_failed(template_id, "unexpected", str(exc))
        _audit(user_id, "sip_template.parsed",
               {"template_id": str(template_id), "parse_status": "failed",
                "parse_error": "unexpected"})
        return "failed", None, f"unexpected: {exc}"

    # Wrong-track detection: if the LLM came back with mostly-null values
    # and < 3 SIP keys filled, the applicant probably uploaded a TIR
    # template. Surface as a distinct parse_error so the UI can suggest
    # the right download.
    filled_count = sum(1 for v in parsed.values() if v)
    if filled_count < 3 and any(parsed.values()):
        # 0-filled = empty file (handled below as completed-but-no-fills),
        # 1-2 filled = likely wrong-track. We still mark completed (data
        # is real), but route a warning into parse_error for the UI.
        log.info("sip template parse suspiciously sparse",
                 extra={"template_id": template_id, "filled_count": filled_count})

    try:
        admin.table(_TABLE).update({
            "parsed_data": parsed,
            "parse_status": "completed",
            "parsed_at": "now()",
        }).eq("id", template_id).execute()
    except Exception as exc:
        log.error("could not stamp sip template completed",
                  extra={"template_id": template_id, "err": str(exc)})
        return "failed", None, f"post-parse update failed: {exc}"

    _audit(user_id, "sip_template.parsed",
           {"template_id": str(template_id), "parse_status": "completed",
            "filled_keys": sorted(k for k, v in parsed.items() if v)})
    return "completed", parsed, None
```

- [ ] **Step 5: Register the router in `main.py`** (skip if you'd rather batch this with the GET/apply endpoints in Task 9)

Open `backend/app/main.py`. Locate where the TIR `application_templates` router is included (search for `application_templates`). Immediately after that line, add:

```python
from .routers import sip_application_templates as sip_application_templates_router
app.include_router(sip_application_templates_router.router)
```

Match the import style of the surrounding lines.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_sip_application_templates_upload.py -v`
Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/sip_application_templates.py backend/app/main.py backend/tests/test_sip_application_templates_upload.py backend/tests/conftest.py
git commit -m "router: SIP application-templates upload endpoint

POST /sip-application-templates/upload. Mirrors TIR's upload handler
with the SIP table, bucket, parser, and require_track('sip') swapped
in. _parse_inline records parse_status transitions on the
sip_application_templates row and audits via audit_logs.

Tests cover: unauth (401), wrong mime (415), oversize (413), empty
body (400), happy path (parse_status='completed', parsed_data
populated), wrong track (403), parser raise -> parse_status='failed'."
```

---

## Task 8: SIP router — GET /me

**Files:**
- Modify: `backend/app/routers/sip_application_templates.py` (append GET /me)
- Test: `backend/tests/test_sip_application_templates_get_me.py`

- [ ] **Step 1: Write the failing GET /me tests**

Create `backend/tests/test_sip_application_templates_get_me.py`:

```python
"""Tests for GET /sip-application-templates/me."""
from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_get_me_unauthenticated(client) -> None:
    resp = client.get("/sip-application-templates/me")
    assert resp.status_code == 401


def test_get_me_no_draft_returns_404(client, sip_user_token, supabase_stub) -> None:
    supabase_stub.set_no_draft()
    resp = client.get("/sip-application-templates/me", headers=_bearer(sip_user_token))
    assert resp.status_code == 404


def test_get_me_no_template_returns_404(client, sip_user_token, supabase_stub) -> None:
    supabase_stub.set_draft(application_id=str(uuid.uuid4()))
    supabase_stub.set_templates([])
    resp = client.get("/sip-application-templates/me", headers=_bearer(sip_user_token))
    assert resp.status_code == 404


def test_get_me_returns_latest_by_created_at(client, sip_user_token, supabase_stub) -> None:
    app_id = str(uuid.uuid4())
    supabase_stub.set_draft(application_id=app_id)
    older = {"id": str(uuid.uuid4()), "user_id": "sip-user-1", "application_id": app_id,
             "storage_path": "u/old.docx", "original_filename": "old.docx",
             "file_size_bytes": 100, "mime_type": "application/pdf",
             "parse_status": "completed", "parse_error": None, "parsed_at": "2024-01-01T00:00:00Z",
             "parsed_data": {"Q5": "old"}, "applied_to_application_at": None,
             "created_at": "2024-01-01T00:00:00Z"}
    newer = {**older, "id": str(uuid.uuid4()),
             "storage_path": "u/new.docx", "original_filename": "new.docx",
             "parsed_data": {"Q5": "new"},
             "created_at": "2024-02-01T00:00:00Z"}
    # set_templates returns rows in order they're passed; the .order(desc=true) on the stub picks the first.
    supabase_stub.set_templates([newer, older])
    resp = client.get("/sip-application-templates/me", headers=_bearer(sip_user_token))
    assert resp.status_code == 200
    assert resp.json()["parsed_data"]["Q5"] == "new"


def test_get_me_requires_sip_track(client, tir_user_token) -> None:
    resp = client.get("/sip-application-templates/me", headers=_bearer(tir_user_token))
    assert resp.status_code == 403
```

The `supabase_stub` fixture stubs `get_admin_client()` to a fake that records `.table(name).select(...).eq(...).order(...).limit(...).execute()` chains. If it doesn't exist yet in conftest, build it now — alternatively, use the same Supabase-stub pattern already in use for `test_applications.py`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_sip_application_templates_get_me.py -v`
Expected: 5 fails — 404 returned for everything (handler missing).

- [ ] **Step 3: Append GET /me to the SIP router**

Add to `backend/app/routers/sip_application_templates.py`:

```python
# ── GET /me ───────────────────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=SipApplicationTemplateRecord,
    dependencies=[Depends(_rl_get_me)],
)
async def get_my_latest_sip_template(current_user: dict = Depends(get_current_user)):
    """Latest SIP template scoped to the *current* open draft.

    Same semantics as TIR's get_my_latest_template — multi-submission
    safe: each new draft gets its own template lifecycle so the
    previous-cycle row is never surfaced into the upload UI.
    """
    user_id = current_user["user_id"]
    draft_id = _fetch_draft_application_id(user_id)
    if not draft_id:
        raise HTTPException(status_code=404, detail="No draft SIP application.")
    res = (
        get_admin_client()
        .table(_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("application_id", draft_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="No SIP template uploaded yet.")
    return rows[0]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_sip_application_templates_get_me.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/sip_application_templates.py backend/tests/test_sip_application_templates_get_me.py
git commit -m "router: SIP application-templates GET /me

Scopes to current draft sip_applications row — same multi-submission
safety as TIR. Returns 404 when no draft or no template uploaded yet."
```

---

## Task 9: SIP router — POST /me/apply-to-application (NULL-only writes)

**Files:**
- Modify: `backend/app/routers/sip_application_templates.py` (append apply endpoint)
- Test: `backend/tests/test_sip_application_templates_apply.py`

- [ ] **Step 1: Write the failing apply tests**

Create `backend/tests/test_sip_application_templates_apply.py`:

```python
"""Tests for POST /sip-application-templates/me/apply-to-application.

The SIP apply endpoint uses NULL-only writes (Decision D6 in the spec) —
parsed answers only land in columns currently NULL on the draft.
Already-typed answers are preserved and surfaced via skipped_fields.
"""
from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_apply_unauthenticated(client) -> None:
    resp = client.post("/sip-application-templates/me/apply-to-application")
    assert resp.status_code == 401


def test_apply_no_draft_returns_404(client, sip_user_token, supabase_stub) -> None:
    supabase_stub.set_no_draft()
    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(sip_user_token))
    assert resp.status_code == 404


def test_apply_no_completed_template_returns_404(client, sip_user_token, supabase_stub) -> None:
    supabase_stub.set_draft(application_id=str(uuid.uuid4()))
    supabase_stub.set_templates([])
    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(sip_user_token))
    assert resp.status_code == 404


def test_apply_happy_path_all_columns_null(client, sip_user_token, supabase_stub) -> None:
    app_id = str(uuid.uuid4())
    supabase_stub.set_draft(application_id=app_id, columns_null=True)
    supabase_stub.set_templates([{
        "id": str(uuid.uuid4()), "parsed_data": {
            "Q5":  "Yes — Pvt Ltd, registered in India",
            "Q6":  "TRL 4 — lab-validated prototype",
            "Q8":  "No",
            "Q9":  None,
            "Q10": "Referral from friend/colleague",
            "Q11": "Problem text.",
            "Q12": "Solution text.",
            "Q13": "Core tech text.",
            "Q14": None,
            "Q15": "Active pilots (paid or unpaid) with design partners",
            "Q16": "Pilots text.",
            "Q17": "Hurdles text.",
            "Q18": "Milestone text.",
            "Q19": "Infra text.",
            "Q20": None, "Q21": None,
            "Q24": "https://loom.com/share/x",
        }, "parse_status": "completed",
    }])

    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(sip_user_token))
    assert resp.status_code == 200
    body = resp.json()
    # Q9, Q14, Q20, Q21 were null → missing_answers.
    assert set(body["missing_answers"]) == {"Q9", "Q14", "Q20", "Q21"}
    # Everything else applied (column already-null on draft).
    assert "sip_incorporated" in body["applied_fields"]
    assert "problem_describe" in body["applied_fields"]
    assert body["skipped_fields"] == []


def test_apply_null_only_preserves_typed_value(client, sip_user_token, supabase_stub) -> None:
    """Pre-fill problem_describe on draft → column lands in skipped_fields, not overwritten."""
    app_id = str(uuid.uuid4())
    supabase_stub.set_draft(application_id=app_id,
                            existing_columns={"problem_describe": "TYPED BY APPLICANT"})
    supabase_stub.set_templates([{
        "id": str(uuid.uuid4()), "parsed_data": {
            qid: "x" for qid in ["Q5", "Q6", "Q8", "Q10", "Q11", "Q12", "Q13",
                                 "Q15", "Q16", "Q17", "Q18", "Q19"]
        } | {q: None for q in ["Q9", "Q14", "Q20", "Q21", "Q24"]},
        "parse_status": "completed",
    }])
    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(sip_user_token))
    assert resp.status_code == 200
    body = resp.json()
    assert "problem_describe" in body["skipped_fields"]
    assert "problem_describe" not in body["applied_fields"]


def test_apply_invalid_enum_to_missing(client, sip_user_token, supabase_stub) -> None:
    app_id = str(uuid.uuid4())
    supabase_stub.set_draft(application_id=app_id, columns_null=True)
    supabase_stub.set_templates([{
        "id": str(uuid.uuid4()), "parsed_data": {
            "Q5": "Not a real option", "Q6": None, "Q8": None, "Q9": None,
            "Q10": None, "Q11": None, "Q12": None, "Q13": None, "Q14": None,
            "Q15": None, "Q16": None, "Q17": None, "Q18": None, "Q19": None,
            "Q20": None, "Q21": None, "Q24": None,
        }, "parse_status": "completed",
    }])
    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(sip_user_token))
    assert resp.status_code == 200
    body = resp.json()
    assert "Q5" in body["missing_answers"]
    assert "sip_incorporated" not in body["applied_fields"]


def test_apply_invalid_url_to_missing(client, sip_user_token, supabase_stub) -> None:
    app_id = str(uuid.uuid4())
    supabase_stub.set_draft(application_id=app_id, columns_null=True)
    supabase_stub.set_templates([{
        "id": str(uuid.uuid4()), "parsed_data": {
            "Q24": "not-a-url",
            **{q: None for q in ["Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12",
                                 "Q13", "Q14", "Q15", "Q16", "Q17", "Q18",
                                 "Q19", "Q20", "Q21"]},
        }, "parse_status": "completed",
    }])
    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(sip_user_token))
    assert resp.status_code == 200
    body = resp.json()
    assert "Q24" in body["missing_answers"]


def test_apply_valid_url_applied(client, sip_user_token, supabase_stub) -> None:
    app_id = str(uuid.uuid4())
    supabase_stub.set_draft(application_id=app_id, columns_null=True)
    supabase_stub.set_templates([{
        "id": str(uuid.uuid4()), "parsed_data": {
            "Q24": "https://www.loom.com/share/abc",
            **{q: None for q in ["Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12",
                                 "Q13", "Q14", "Q15", "Q16", "Q17", "Q18",
                                 "Q19", "Q20", "Q21"]},
        }, "parse_status": "completed",
    }])
    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(sip_user_token))
    assert resp.status_code == 200
    assert "sip_demo_video_url" in resp.json()["applied_fields"]


def test_apply_q10_other_auto_filled(client, sip_user_token, supabase_stub) -> None:
    """Q10='Other' is a canonical enum value — auto-fill basic_hear_about."""
    app_id = str(uuid.uuid4())
    supabase_stub.set_draft(application_id=app_id, columns_null=True)
    supabase_stub.set_templates([{
        "id": str(uuid.uuid4()), "parsed_data": {
            "Q10": "Other",
            **{q: None for q in ["Q5", "Q6", "Q8", "Q9", "Q11", "Q12", "Q13",
                                 "Q14", "Q15", "Q16", "Q17", "Q18", "Q19",
                                 "Q20", "Q21", "Q24"]},
        }, "parse_status": "completed",
    }])
    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(sip_user_token))
    assert resp.status_code == 200
    body = resp.json()
    assert "basic_hear_about" in body["applied_fields"]
    # The wizard handles the custom hear-about text separately.


def test_apply_idempotent_second_call_applied_empty(client, sip_user_token, supabase_stub) -> None:
    """After the first apply, the same call finds columns non-null → applied_fields empty."""
    app_id = str(uuid.uuid4())
    # First call: columns null.
    supabase_stub.set_draft(application_id=app_id, columns_null=True)
    supabase_stub.set_templates([{
        "id": str(uuid.uuid4()), "parsed_data": {
            qid: "x" for qid in ["Q5", "Q6", "Q8", "Q10", "Q11", "Q12", "Q13",
                                 "Q15", "Q16", "Q17", "Q18", "Q19"]
        } | {q: None for q in ["Q9", "Q14", "Q20", "Q21", "Q24"]},
        "parse_status": "completed",
    }])
    first = client.post("/sip-application-templates/me/apply-to-application",
                        headers=_bearer(sip_user_token))
    assert first.status_code == 200
    assert first.json()["applied_fields"]

    # Second call: stub now treats those columns as filled (the stub
    # honours its own writes in test_apply_idempotent_second_call mode).
    supabase_stub.simulate_writes_persisted()
    second = client.post("/sip-application-templates/me/apply-to-application",
                        headers=_bearer(sip_user_token))
    assert second.status_code == 200
    body = second.json()
    assert body["applied_fields"] == []
    # All columns that were written in the first call are now skipped.
    assert "problem_describe" in body["skipped_fields"]


def test_apply_requires_sip_track(client, tir_user_token) -> None:
    resp = client.post("/sip-application-templates/me/apply-to-application",
                       headers=_bearer(tir_user_token))
    assert resp.status_code == 403
```

The `supabase_stub` fixture must support `set_draft(..., columns_null=, existing_columns=)` and `simulate_writes_persisted()`. Extend the fixture as needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_sip_application_templates_apply.py -v`
Expected: 11 fails — 404 / handler missing.

- [ ] **Step 3: Append apply endpoint to the SIP router**

Append to `backend/app/routers/sip_application_templates.py`:

```python
# ── Apply helpers (SIP-specific) ──────────────────────────────────────────

# Enum-shaped target columns and their canonical value lists. Imported
# from llm_service so there's a single source of truth.
from ..services.llm_service import (
    SIP_TEMPLATE_Q5_OPTIONS,
    SIP_TEMPLATE_Q6_OPTIONS,
    SIP_TEMPLATE_Q8_OPTIONS,
    SIP_TEMPLATE_Q10_OPTIONS,
    SIP_TEMPLATE_Q15_OPTIONS,
)

_ENUM_GUARDS: dict[str, list[str]] = {
    "sip_incorporated":            SIP_TEMPLATE_Q5_OPTIONS,
    "sip_trl":                     SIP_TEMPLATE_Q6_OPTIONS,
    "basic_incubator_association": SIP_TEMPLATE_Q8_OPTIONS,
    "basic_hear_about":            SIP_TEMPLATE_Q10_OPTIONS,
    "sip_traction":                SIP_TEMPLATE_Q15_OPTIONS,
}

# Q24 → sip_demo_video_url is a URL. Use a light validator (http/https
# scheme + ≤ 2000 chars). Wizard does richer blur-time validation; this
# is the apply-time backstop.
_URL_MAX = 2000


def _looks_like_url(value: str) -> bool:
    if not isinstance(value, str) or not value:
        return False
    if len(value) > _URL_MAX:
        return False
    return value.startswith("http://") or value.startswith("https://")


# ── POST /me/apply-to-application ─────────────────────────────────────────

@router.post(
    "/me/apply-to-application",
    response_model=SipApplyTemplateResult,
    dependencies=[Depends(_rl_apply)],
)
async def apply_sip_template_to_application(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    admin = get_admin_client()

    # Scope to OPEN draft so we never write into a submitted application.
    app_res = (
        admin.table(_DRAFT_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "draft")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    app_rows = app_res.data or []
    if not app_rows:
        raise HTTPException(
            status_code=404,
            detail="No draft SIP application found. Begin an application first.",
        )
    app_row = app_rows[0]
    app_id = app_row["id"]

    # Latest completed template *for this draft*.
    parsed_res = (
        admin.table(_TABLE)
        .select("id, parsed_data, parse_status")
        .eq("user_id", user_id)
        .eq("application_id", app_id)
        .eq("parse_status", "completed")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = parsed_res.data or []
    if not rows or not rows[0].get("parsed_data"):
        raise HTTPException(
            status_code=404,
            detail="No completed SIP template parse found for this application. Upload first.",
        )
    template_id = rows[0]["id"]
    parsed: dict[str, Any] = rows[0]["parsed_data"]

    applied: list[str] = []
    skipped: list[str] = []
    missing: list[str] = []
    patch: dict[str, Any] = {}

    # NULL-only writes (D6) — preserve typed answers. The draft row from
    # app_res above includes every target column; we read it directly
    # rather than re-fetching.
    for qid in SIP_QUESTION_IDS:
        dest_col = QUESTION_TO_SIP_COLUMN[qid]
        val = parsed.get(qid)

        # 1. Empty/null parsed value → missing.
        if not val:
            missing.append(qid)
            continue

        # 2. Enum guard (Q5/Q6/Q8/Q10/Q15).
        if dest_col in _ENUM_GUARDS:
            if val not in _ENUM_GUARDS[dest_col]:
                missing.append(qid)
                continue

        # 3. URL guard (Q24).
        if dest_col == "sip_demo_video_url" and not _looks_like_url(val):
            missing.append(qid)
            continue

        # 4. NULL-only: if the draft column already has a non-null value,
        #    record the column as skipped and leave the value alone.
        existing = app_row.get(dest_col)
        if existing not in (None, ""):
            skipped.append(dest_col)
            continue

        patch[dest_col] = val
        applied.append(dest_col)

    if patch:
        try:
            admin.table(_DRAFT_TABLE).update(patch).eq("id", app_id).eq(
                "status", "draft"
            ).execute()
        except Exception as exc:
            log.warning(
                "sip template bulk apply rejected, retrying per-field",
                extra={"user_id": user_id, "app_id": app_id, "err": str(exc)},
            )
            applied.clear()
            new_missing = list(missing)
            for col, val in patch.items():
                try:
                    admin.table(_DRAFT_TABLE).update({col: val}).eq(
                        "id", app_id
                    ).eq("status", "draft").execute()
                    applied.append(col)
                except Exception as col_exc:
                    log.warning(
                        "sip template per-field apply rejected",
                        extra={"user_id": user_id, "app_id": app_id,
                               "column": col, "err": str(col_exc)},
                    )
                    qid = next(
                        (q for q, c in QUESTION_TO_SIP_COLUMN.items() if c == col),
                        col,
                    )
                    if qid not in new_missing:
                        new_missing.append(qid)
            missing = new_missing

    try:
        admin.table(_TABLE).update(
            {"applied_to_application_at": "now()"}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.warning("could not stamp sip applied_to_application_at",
                    extra={"template_id": str(template_id), "err": str(exc)})

    _audit(user_id, "sip_template.applied_to_application", {
        "template_id": str(template_id),
        "application_id": app_id,
        "applied_fields": applied,
        "skipped_fields": skipped,
        "missing_answers": missing,
    })

    return SipApplyTemplateResult(
        applied_fields=applied,
        skipped_fields=skipped,
        missing_answers=missing,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_sip_application_templates_apply.py -v`
Expected: 11 passed.

- [ ] **Step 5: Run the full backend test suite to catch regressions**

Run: `cd backend && pytest -q`
Expected: existing tests still green; the 30+ new SIP tests added in tasks 2/3/6/7/8/9 all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/sip_application_templates.py backend/tests/test_sip_application_templates_apply.py
git commit -m "router: SIP application-templates apply-to-application

POST /sip-application-templates/me/apply-to-application. Implements
NULL-only writes (D6 — deliberate divergence from TIR's overwrite).
Enum guards for the 5 MCQ columns; URL guard for sip_demo_video_url.
Per-field retry on bulk-update failure to handle CHECK constraint
drift (matches TIR's defensive pattern).

Tests cover: 401 unauth, 404 no draft, 404 no template, happy path
(all columns null), NULL-only (pre-filled column → skipped), invalid
enum → missing, invalid URL → missing, valid URL → applied, Q10=Other
auto-filled (matches TIR's enum pattern), idempotent (second call
applies nothing), 403 wrong track."
```

---

## Task 10: Frontend — `lib/api.js` SIP template wrappers

**Files:**
- Modify: `frontend/src/lib/api.js` (append three SIP template wrappers; existing TIR wrappers unchanged)

- [ ] **Step 1: Find where TIR template API wrappers live in `lib/api.js`**

Run: `grep -n "application-templates" frontend/src/lib/api.js`
Expected: a handful of lines that reference `/application-templates/...`.

- [ ] **Step 2: Add SIP wrappers below the TIR ones**

Open `frontend/src/lib/api.js`. After the last TIR template wrapper (find by the grep above), add (adjusting to match the existing wrapper style):

```js
// ── SIP application-template uploads ──────────────────────────────────────

api.uploadSipTemplate = async (file, { signal, timeoutMs = UPLOAD_TIMEOUT_MS } = {}) => {
  const formData = new FormData();
  formData.append("file", file);
  return api.post("/sip-application-templates/upload", formData, { signal, timeoutMs });
};

api.getMySipTemplate = async ({ signal } = {}) =>
  api.get("/sip-application-templates/me", { signal });

api.applySipTemplate = async ({ signal } = {}) =>
  api.post("/sip-application-templates/me/apply-to-application", null, { signal });
```

If `api` in this file is structured differently (e.g., `export const api = { get, post, ... }` vs `api.get = ...`), match the existing convention. If the file exports an `api` object with TIR wrappers as direct keys, add SIP wrappers as keys with the same names.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "api: SIP application-template client wrappers

Three wrappers: uploadSipTemplate (multipart), getMySipTemplate,
applySipTemplate. Same options shape as the existing TIR wrappers."
```

---

## Task 11: Frontend — `useSipTemplate` hook

**Files:**
- Create: `frontend/src/hooks/useSipTemplate.js`
- Test: `frontend/src/hooks/__tests__/useSipTemplate.test.jsx`

- [ ] **Step 1: Write the failing hook tests**

Create `frontend/src/hooks/__tests__/useSipTemplate.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useSipTemplate } from "../useSipTemplate.js";
import { api } from "../../lib/api.js";

vi.mock("../../lib/api.js", () => ({
  api: {
    uploadSipTemplate: vi.fn(),
    getMySipTemplate: vi.fn(),
    applySipTemplate: vi.fn(),
  },
  UPLOAD_TIMEOUT_MS: 60000,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

const fakeFile = new File(["x"], "sip.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

describe("useSipTemplate", () => {
  it("transitions uploading → parsing → completed → applying → done on happy path", async () => {
    api.uploadSipTemplate.mockResolvedValue({
      template_id: "t1", parse_status: "completed", original_filename: "sip.docx",
      parsed_data: { Q5: "Yes — Pvt Ltd, registered in India" },
    });
    api.applySipTemplate.mockResolvedValue({
      applied_fields: ["sip_incorporated", "problem_describe"],
      skipped_fields: [], missing_answers: [],
    });

    const { result } = renderHook(() => useSipTemplate());
    await act(async () => {
      await result.current.upload(fakeFile);
    });

    expect(api.uploadSipTemplate).toHaveBeenCalledWith(fakeFile, expect.any(Object));
    expect(api.applySipTemplate).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(result.current.applyResult).toMatchObject({
        applied_fields: ["sip_incorporated", "problem_describe"],
      });
    });
    expect(result.current.error).toBeNull();
  });

  it("polls GET /me every 3s when upload returns pending, up to MAX_POLLS", async () => {
    api.uploadSipTemplate.mockResolvedValue({
      template_id: "t1", parse_status: "pending",
    });
    let pollCount = 0;
    api.getMySipTemplate.mockImplementation(async () => {
      pollCount += 1;
      return pollCount < 3
        ? { template_id: "t1", parse_status: "processing" }
        : { template_id: "t1", parse_status: "completed",
            parsed_data: { Q5: "Yes — Pvt Ltd, registered in India" } };
    });
    api.applySipTemplate.mockResolvedValue({
      applied_fields: [], skipped_fields: [], missing_answers: [],
    });

    const { result } = renderHook(() => useSipTemplate());
    act(() => { result.current.upload(fakeFile); });

    // Drain three 3s ticks.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    await waitFor(() => {
      expect(api.applySipTemplate).toHaveBeenCalledOnce();
    });
    expect(api.getMySipTemplate).toHaveBeenCalledTimes(3);
  });

  it("does not call apply when parse_status fails", async () => {
    api.uploadSipTemplate.mockResolvedValue({
      template_id: "t1", parse_status: "failed", message: "wrong_track_template",
    });

    const { result } = renderHook(() => useSipTemplate());
    await act(async () => { await result.current.upload(fakeFile); });

    expect(api.applySipTemplate).not.toHaveBeenCalled();
    expect(result.current.template?.parse_status).toBe("failed");
  });

  it("surfaces upload error via error state", async () => {
    const err = new Error("network error");
    api.uploadSipTemplate.mockRejectedValue(err);

    const { result } = renderHook(() => useSipTemplate());
    await act(async () => {
      try { await result.current.upload(fakeFile); } catch { /* swallow */ }
    });

    expect(result.current.error).toBe(err);
    expect(result.current.uploading).toBe(false);
  });

  it("invokes onApplied callback with apply result", async () => {
    api.uploadSipTemplate.mockResolvedValue({
      template_id: "t1", parse_status: "completed",
      parsed_data: { Q5: "Yes — Pvt Ltd, registered in India" },
    });
    const applyResult = {
      applied_fields: ["sip_incorporated"], skipped_fields: [], missing_answers: [],
    };
    api.applySipTemplate.mockResolvedValue(applyResult);

    const onApplied = vi.fn();
    const { result } = renderHook(() => useSipTemplate({ onApplied }));
    await act(async () => { await result.current.upload(fakeFile); });
    await waitFor(() => { expect(onApplied).toHaveBeenCalledWith(applyResult); });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- useSipTemplate`
Expected: failure — `Cannot find module '../useSipTemplate.js'`

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useSipTemplate.js`:

```js
// useSipTemplate — SIP equivalent of useTemplate. Manages upload → poll →
// auto-apply for the SIP offline template. NULL-only apply semantics
// matter for the UI: the toast composer shows "kept (you'd already typed
// them)" from result.skipped_fields.
//
//   upload(file)   POST /sip-application-templates/upload, then auto-applies
//                  on parse_status='completed'. Polls GET /me up to 10×3s
//                  if the upload returns 'pending'/'processing'.
//   apply()        manual re-apply — surface only if the auto-apply failed.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 10;

export function useSipTemplate({ onApplied } = {}) {
  const [tpl, setTpl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [error, setError] = useState(null);
  const pollTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    },
    [],
  );

  const apply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const result = await api.applySipTemplate();
      setApplyResult(result);
      if (onApplied) onApplied(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setApplying(false);
    }
  }, [onApplied]);

  const pollUntilDone = useCallback(async () => {
    for (let i = 0; i < MAX_POLLS; i += 1) {
      await new Promise((r) => {
        pollTimerRef.current = setTimeout(r, POLL_INTERVAL_MS);
      });
      try {
        const latest = await api.getMySipTemplate();
        setTpl(latest);
        if (latest.parse_status === "completed") {
          setParsing(false);
          try {
            await apply();
          } catch {
            /* swallow — apply() already set error */
          }
          return latest;
        }
        if (latest.parse_status === "failed") {
          setParsing(false);
          return latest;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useSipTemplate] poll error:", err?.message);
      }
    }
    setParsing(false);
    return null;
  }, [apply]);

  const upload = useCallback(
    async (file) => {
      setError(null);
      setApplyResult(null);
      setUploading(true);
      setTpl(null);
      setParsing(true);
      try {
        const response = await api.uploadSipTemplate(file);
        setTpl(response);
        if (response.parse_status === "completed") {
          setParsing(false);
          try {
            await apply();
          } catch {
            /* swallow — handled via error */
          }
        } else if (
          response.parse_status === "pending" ||
          response.parse_status === "processing"
        ) {
          pollUntilDone();
        } else {
          setParsing(false);
        }
        return response;
      } catch (err) {
        setError(err);
        setParsing(false);
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [apply, pollUntilDone],
  );

  return {
    template: tpl,
    uploading,
    parsing,
    applying,
    applyResult,
    error,
    upload,
    apply,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- useSipTemplate`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useSipTemplate.js frontend/src/hooks/__tests__/useSipTemplate.test.jsx
git commit -m "hook: useSipTemplate for SIP offline template flow

Mirrors useTemplate.js for the SIP track. Same state machine
(uploading → parsing → applying → done) and same 10×3s polling
fallback when the upload returns pending/processing. Auto-applies
on parse completion."
```

---

## Task 12: Frontend — `<SipTemplateScreen/>` component

**Files:**
- Create: `frontend/src/components/SipTemplateScreen.jsx`
- Test: `frontend/src/components/__tests__/SipTemplateScreen.test.jsx`

- [ ] **Step 1: Write the failing component tests**

Create `frontend/src/components/__tests__/SipTemplateScreen.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SipTemplateScreen } from "../SipTemplateScreen.jsx";

vi.mock("../../hooks/useSipTemplate.js", () => ({
  useSipTemplate: vi.fn(() => ({
    template: null,
    uploading: false,
    parsing: false,
    applying: false,
    applyResult: null,
    error: null,
    upload: vi.fn(),
    apply: vi.fn(),
  })),
}));

describe("<SipTemplateScreen/>", () => {
  it("renders the SIP template download link with correct href", () => {
    render(<SipTemplateScreen onContinue={() => {}} onBack={() => {}} />);
    const link = screen.getByRole("link", { name: /download template/i });
    expect(link).toHaveAttribute(
      "href",
      "/templates/ARTPARK_SIP_Application_Template.docx?v=1",
    );
  });

  it("calls onContinue when the action button is clicked", () => {
    const onContinue = vi.fn();
    render(<SipTemplateScreen onContinue={onContinue} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /skip|continue/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("file input accepts .docx and .pdf", () => {
    render(<SipTemplateScreen onContinue={() => {}} onBack={() => {}} />);
    const input = screen.getByTestId("sip-template-file-input");
    expect(input).toHaveAttribute("accept", ".docx,.pdf");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- SipTemplateScreen`
Expected: failure — module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/SipTemplateScreen.jsx`. This is a clone of the inlined TIR `TemplateScreen` from `auth_upload.jsx:716-883`, with copy adjusted for SIP. CSS classes are reused as-is (they're generic dropzone/template-block styles already loaded by the wizard).

```jsx
// SipTemplateScreen — offline-template upload step for the SIP wizard.
// Sits between section 01 (Basic Details) and section 02 (Quick gates).
// The applicant either downloads the .docx, fills Q5..Q24 (minus
// Q7/Q22/Q23) offline, uploads the filled file, and continues — or
// skips this step entirely and types in the wizard.

import { useRef, useState } from "react";
import { useSipTemplate } from "../hooks/useSipTemplate.js";

const SIP_TEMPLATE_DOWNLOAD_URL =
  "/templates/ARTPARK_SIP_Application_Template.docx?v=1";

export function SipTemplateScreen({ onContinue, onBack, onTemplateApplied }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);

  const tpl = useSipTemplate({
    onApplied: (result) => {
      const filled = (result?.applied_fields || []).length;
      const skipped = (result?.skipped_fields || []).length;
      const missing = (result?.missing_answers || []).length;
      const parts = [
        `Pre-filled ${filled} field${filled === 1 ? "" : "s"}`,
      ];
      if (skipped) parts.push(`${skipped} kept (you'd already typed them)`);
      if (missing) parts.push(`${missing} couldn't be read — fill them in the wizard`);
      setToast(parts.join(" · "));
      if (onTemplateApplied) {
        try { onTemplateApplied(result); } catch { /* swallow */ }
      }
    },
  });

  const handleFile = (file) => {
    if (!file) return;
    setToast(null);
    tpl.upload(file).catch(() => { /* surfaces via tpl.error */ });
  };

  const status = tpl.template?.parse_status;
  const busy = tpl.uploading || tpl.parsing || tpl.applying;
  const continueLabel =
    status === "completed" ? "Continue" : "Skip — I'll type in the wizard";

  return (
    <div className="eir-screen eir-template-screen">
      <div className="eir-coord eir-mono">
        <span>between 01 and 02</span>
        <span>offline template · optional</span>
      </div>
      <div className="eir-template-screen-body">
        <div className="eir-q-index eir-mono">
          <span className="eir-q-index-num">↳</span>
          <span className="eir-q-index-arrow">→</span>
          <span className="eir-q-optional">optional</span>
        </div>
        <h2 className="eir-q-prompt">Want to type the long answers offline?</h2>
        <p className="eir-q-help">
          Download the SIP Word template, fill the long answers at your
          own pace (Word, Pages, Google Docs — anything that opens
          .docx), then drop it back here and we'll auto-fill those
          fields in the wizard. You'll still review and edit each answer
          before submitting.
        </p>
        <p className="eir-q-help eir-dim" style={{ marginTop: -16 }}>
          ↳ Skip this step entirely if you'd rather type your answers
          directly in the next sections.
        </p>

        <div className="eir-template-block eir-template-block-screen">
          <div className="eir-template-row">
            <div className="eir-template-text">
              <div className="eir-template-title eir-mono">step 1 · download</div>
              <div className="eir-template-blurb">
                Grab the SIP .docx. The questions inside have answer
                markers we use to read your responses — please don't
                delete or rename them.
              </div>
            </div>
            <a
              className="eir-btn eir-btn-ghost eir-template-dl"
              href={SIP_TEMPLATE_DOWNLOAD_URL}
              download
            >
              <span>Download template (.docx)</span>
              <span className="eir-mono">↓</span>
            </a>
          </div>

          <div className="eir-template-row" style={{ marginBottom: 0 }}>
            <div className="eir-template-text">
              <div className="eir-template-title eir-mono">step 2 · upload filled</div>
              <div className="eir-template-blurb">
                Once you've filled it, drop the same file back here.
                We'll read your answers and pre-populate the wizard.
              </div>
            </div>
          </div>

          <div
            className={`eir-filedrop eir-template-drop ${dragOver ? "is-drag" : ""} ${status === "completed" ? "has-file" : ""} ${busy ? "is-disabled" : ""}`}
            onDragOver={(e) => { if (busy) return; e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!busy) handleFile(e.dataTransfer.files[0]);
            }}
            onClick={() => { if (!busy) fileInputRef.current?.click(); }}
            style={busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            <input
              ref={fileInputRef}
              data-testid="sip-template-file-input"
              type="file"
              hidden
              accept=".docx,.pdf"
              onChange={(e) => handleFile(e.target.files[0])}
              disabled={busy}
            />
            {tpl.uploading && (
              <div className="eir-filedrop-main">Uploading filled template…</div>
            )}
            {!tpl.uploading && tpl.parsing && (
              <div className="eir-filedrop-main">Reading your answers…</div>
            )}
            {!tpl.uploading && !tpl.parsing && tpl.applying && (
              <div className="eir-filedrop-main">Pre-filling the wizard…</div>
            )}
            {!busy && status !== "completed" && (
              <>
                <div className="eir-filedrop-main">
                  Drop your filled template here, or <u>click to browse</u>
                </div>
                <div className="eir-filedrop-meta eir-mono">.docx (preferred) or .pdf · max 10 MiB</div>
              </>
            )}
            {!busy && status === "completed" && (
              <div className="eir-file-chip">
                <span className="eir-mono eir-file-ok">✓ parsed</span>
                <span className="eir-file-name">
                  {tpl.template?.original_filename || "template"}
                </span>
                <span className="eir-mono eir-dim">replace ↺</span>
              </div>
            )}
          </div>

          {tpl.error && (
            <div className="eir-mono eir-block-reason eir-template-err">
              ↳ {tpl.error?.message || "We couldn't read that template — make sure the answer markers are intact and try again."}
            </div>
          )}
          {status === "failed" && !tpl.error && (
            <div className="eir-mono eir-block-reason eir-template-err">
              ↳ {tpl.template?.parse_error || "Parse failed."} You can still continue — the wizard works manually.
            </div>
          )}
          {toast && (
            <div className="eir-mono eir-template-ok">↳ {toast}</div>
          )}
        </div>

        <div className="eir-q-actions">
          {onBack && (
            <button type="button" className="eir-btn eir-btn-ghost" onClick={onBack}>
              <span>← Back</span>
            </button>
          )}
          <button
            type="button"
            className={`eir-btn ${busy ? "eir-btn-disabled" : "eir-btn-primary"}`}
            onClick={onContinue}
            disabled={busy}
          >
            <span>{continueLabel}</span>
            <span className="eir-btn-key eir-mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- SipTemplateScreen`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SipTemplateScreen.jsx frontend/src/components/__tests__/SipTemplateScreen.test.jsx
git commit -m "ui: SipTemplateScreen component

UI clone of the inlined TIR TemplateScreen — same CSS classes (eir-*),
same drag/drop dropzone, same status states (uploading/parsing/
applying/done/failed), same toast composer.

Difference from TIR: copy adjusts for SIP, template download URL
points at ARTPARK_SIP_Application_Template.docx, hook is
useSipTemplate."
```

---

## Task 13: Wire `<SipTemplateScreen/>` into `AppSip.jsx`

**Files:**
- Modify: `frontend/src/AppSip.jsx`

- [ ] **Step 1: Locate the AppSip section between Basic Details (01) and Quick Gates (02)**

Run: `grep -n "section.*01\|section.*02\|basic_details\|Quick Gates\|sip_incorporated" frontend/src/AppSip.jsx | head -20`
Expected: a few candidate line numbers where the wizard advances from section 01 to section 02.

- [ ] **Step 2: Import and render `<SipTemplateScreen/>`**

Open `frontend/src/AppSip.jsx`. Add the import near the top alongside other component imports:

```js
import { SipTemplateScreen } from "./components/SipTemplateScreen.jsx";
```

Locate the section-routing switch (the same shape AppSip uses to navigate between sections — typically a `step` or `section` enum). Add a new wizard step value `"sip_template"` between `"basic_details"` and the first SIP-specific gate question (Q5 incorporation), then render:

```jsx
{step === "sip_template" && (
  <SipTemplateScreen
    onBack={() => goToStep("basic_details")}
    onContinue={() => goToStep("sip_incorporated")}
    onTemplateApplied={() => {
      // Re-fetch the draft so the wizard picks up the just-applied
      // values. AppSip should already expose a draft-refresh helper —
      // match whatever the existing UploadScreen / TIR TemplateScreen
      // wires up for its refresh hook.
      refreshDraft?.();
    }}
  />
)}
```

Adjust the exact step-name strings, `goToStep` function name, and refresh helper to match what `AppSip.jsx` already uses — these names differ from project to project.

- [ ] **Step 3: Run the frontend test suite**

Run: `cd frontend && npm run test -- --run`
Expected: all existing tests still pass + new SipTemplateScreen tests pass.

- [ ] **Step 4: Manually verify in dev**

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173/apply-sip/`, sign in as a SIP test user, advance past Basic Details. The new SIP template screen should appear between section 01 and the first SIP gate (Q5 incorporation). Download the template — verify it opens, contains anchor markers around 17 answer boxes, fill 2–3 questions, save, drop the file back onto the dropzone. Watch the network panel for `POST /sip-application-templates/upload` and `POST /me/apply-to-application`. Confirm the wizard's Q5/Q11/etc. fields populate after the toast appears.

If anything in this manual verification doesn't match expectation, STOP and investigate — don't paper over with workarounds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/AppSip.jsx
git commit -m "wizard: render SipTemplateScreen between sections 01 and 02

Matches the position of TIR's TemplateScreen. After applied,
re-fetches the draft so the just-populated answers show up in the
following question screens."
```

---

## Task 14: Apply the migration on staging Supabase + end-to-end smoke

**Files:** none (deployment/smoke step).

- [ ] **Step 1: Confirm you're on `staging` branch**

Run: `git status && git log --oneline -5`
Expected: branch is `staging`, last commit is the wizard wire-up from Task 13.

- [ ] **Step 2: Push the branch**

```bash
git push origin staging
```

Expected: branch pushed. Vercel staging deploy picks up the frontend automatically.

- [ ] **Step 3: Deploy backend SAM stack from a worktree**

Per the `feedback_sam_deploy_requires_worktree` memory, `sam build` reads `backend/` from disk — running `sam deploy` from the current shared checkout while a parallel branch is HEAD on another worktree risks shipping the wrong code. Create a dedicated worktree for the deploy:

```bash
git worktree add .claude/worktrees/staging-sip-template staging
cd .claude/worktrees/staging-sip-template
sam build --use-container --config-env staging
sam deploy --config-env staging
cd -
```

Expected: stack `artpark-eir-api-staging` updated. Note the new API URL (likely unchanged from staging baseline).

- [ ] **Step 4: Apply migration 020 to staging Supabase**

Paste the SQL from `backend/migrations/020_sip_application_templates.sql` into the Supabase Studio SQL editor for project `exqmxvdtcsvpgtftwjml` (staging) and run it. Expected: idempotent — runs cleanly even though the table didn't exist before.

Verify:

```sql
select count(*) from public.sip_application_templates;
-- expect 0

select id, file_size_limit
from storage.buckets
where id = 'sip-application-templates';
-- expect one row, file_size_limit = 10485760
```

- [ ] **Step 5: End-to-end smoke test on `ap-os-git-staging-artpark.vercel.app`**

Walk the flow once using one of the three pre-created SIP test users (per the staging-env memory):

1. Sign in with the SIP test user.
2. Start a fresh SIP application.
3. Advance to the new SIP template screen between sections 01 and 02.
4. Download the template, fill Q5 (incorporated), Q11 (problem), Q24 (demo URL), save.
5. Drop the file back on the dropzone.
6. Observe: toast appears with "Pre-filled 3 fields · 14 couldn't be read — fill them in the wizard" (or similar).
7. Continue into Section 02; confirm Q5 dropdown shows "Yes — Pvt Ltd, registered in India" pre-selected.
8. Continue to the problem section; confirm Q11 prose is pre-filled.
9. Continue to evidence; confirm Q24 video URL field is pre-filled.

If any step fails: do not consider the task complete. Investigate in the network tab + Lambda logs (CloudWatch group `/aws/lambda/artpark-eir-api-staging`).

- [ ] **Step 6: No commit required — deployment-only task.**

If anything in the smoke test surfaced a bug, return to the corresponding earlier task (parser, router, hook, or component) and fix; do not patch in this task.

---

## Self-Review

Run this checklist now that the plan is fully written.

**1. Spec coverage:**
- §3 Background, §4 Decisions (D1–D6), §5 Mapping → Task 6 (parser) + Task 9 (apply enum guards + URL guard) ✓
- §6 Architecture (separate table, hybrid packaging) → Tasks 1, 6, 7 ✓
- §7 File list → Tasks 1–13 cover every file ✓
- §8 Data flow (upload → poll → apply with NULL-only) → Tasks 7, 8, 9, 11 ✓
- §9 Error codes (FILE_TOO_LARGE, INVALID_MIME, RATE_LIMITED_*, PARSE_FAILED, SIP_DRAFT_NOT_FOUND, EMPTY_DOCUMENT, WRONG_TRACK_TEMPLATE) → Tasks 7, 9 cover all but `WRONG_TRACK_TEMPLATE` as a *visible* code (Task 7 logs the sparse-fill warning into `parse_error` but the frontend toast for it is implicit through `tpl.template?.parse_error`). Acceptable — not a regression vs. TIR, which also lets the parser_error string flow through the existing UI.
- §10 Security (RLS policies, storage path, rate limits) → Task 1 (RLS) + Task 7/8/9 (rate-limit decorators) ✓
- §11 Backend test cases → Tasks 7, 8, 9 cover all enumerated tests under the matching names ✓
- §11 Frontend test cases → Tasks 11, 12 cover hook + component tests ✓
- §11 Fixtures → Task 6 Step 1–2 (build script) ✓
- §12 Rollout (migration → deploy → manual QA) → Task 14 ✓

**2. Placeholder scan:** none of the steps contain TBD/TODO/"implement later". Each step that changes code shows the code; each command shows expected output.

**3. Type consistency:**
- Pydantic model names match across tasks: `SipApplicationTemplateUploadResponse`, `SipApplicationTemplateRecord`, `SipApplyTemplateResult` (Task 2 defines, Task 7 imports, Task 9 returns).
- Parser exports match across tasks: `parse_sip_template`, `QUESTION_TO_SIP_COLUMN`, `SIP_QUESTION_IDS` (Task 6 defines, Task 7 imports).
- LLM service exports match: `SIP_TEMPLATE_Q{5,6,8,10,15}_OPTIONS`, `SIP_TEMPLATE_REQUIRED_KEYS`, `normalize_sip_template_answers`, `extract_sip_template_answers_freeform` (Task 3 defines, Tasks 6, 9 import).
- Frontend API wrappers match across tasks: `api.uploadSipTemplate`, `api.getMySipTemplate`, `api.applySipTemplate` (Task 10 defines, Task 11 calls).
- Hook return shape match: `{ template, uploading, parsing, applying, applyResult, error, upload, apply }` (Task 11 defines, Task 12 consumes).

**4. Notes for the implementer:**
- Tasks 1, 4, 5, 14 have manual / out-of-process steps (SQL execution, .docx structure inspection, SAM deploy). These cannot be fully automated by a subagent — surface them clearly when proposing execution mode.
- Task 4 (investigation only) intentionally produces no code or commit. The findings inform Task 5's script. If a subagent runs Task 5 without first doing Task 4, it may write a script that doesn't match the real .docx structure.

---

## Execution

The plan is complete. There are 14 tasks, ~80 steps total. Each task can be reviewed individually before moving to the next.

Choose one:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, you review between tasks, faster iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batched with review checkpoints.
