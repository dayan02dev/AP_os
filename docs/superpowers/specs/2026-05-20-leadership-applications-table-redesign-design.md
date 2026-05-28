# Leadership Applications Table — Redesign

**Date:** 2026-05-20
**Branch:** `staging-role_based_dashboard`
**Migration number:** `017_leadership_table_redesign.sql`
**Status:** Design approved, ready for implementation planning.

---

## Problem

The `/leadership` Applications tab currently shows columns `Applicant · Track · Industry · AI Score · Status · Submitted` for every submitted application across TIR and SIP tracks. Two things are broken:

1. **Industry is wrong almost every time.** The current classifier in `backend/app/services/stats.py` (`classify_industry()`) does case-insensitive keyword matching against `basic_org` — which is the applicant's *current employer or university* (e.g. "IIT Delhi", "Independent", "Hardstone Electric (OPC) Pvt Ltd"). None of these strings contain words like "robotics" or "healthcare", so nearly every row classifies to "Other". The real signal of what the startup does lives in `problem_describe` + `solution_describe` + `solution_core_tech` — text the classifier never sees.

2. **The column shape doesn't help leadership scan.** No project/venture name. No startup stage. The "Applicant" column doubles as both the founder name and the org. The ID column shows the first 8 chars of a UUID, which is unmemorable and uncopyable.

The redesign rebuilds the table to be useful for leadership scanning a cohort, and replaces the keyword classifier with a dynamic LLM-based one bounded to 12 categories.

## Goals

- Table renders 8 columns in this order: **Project · Founder · Industry · Stage · AI Score · Status · Submitted · ID**.
- Industry is accurately classified from the venture's actual problem/solution text, dynamic up to a global cap of 12 categories (7 seeded + 5 slots for LLM-proposed new ones).
- Stage shows the applicant's own answer, mapped to a short label per track.
- IDs are human-readable per-track sequences like `TIR-26001`, `SIP-26001`.
- One consolidated SQL migration; runs once per environment (staging first, then prod).
- AI Score column is left as-is — separate workstream the user is handling.

## Non-goals

- No changes to AI Score logic or column.
- No new sortable column headers (UI sort is out of scope; default sort stays `submitted_at DESC`).
- No applicant-side form changes (the project name and industry are derived, not asked).
- No admin UI for merging/renaming/deleting industry categories (manual SQL via Supabase for now).
- No changes to the dashboard tab's funnel/metric strip/status grid.

---

## Section 1 — Column layout

Row height grows from one line to two lines (sub-line for ID/track in column 1, affiliation in column 2). Row stays clickable to open `AppDrawer`.

| # | Column | Top line source | Sub-line source |
|---|---|---|---|
| 1 | **Project** | derived tagline from `solution_describe` | `{display_id} · {TRACK}` |
| 2 | **Founder** | `basic_full_name` | `basic_org` (or `—` if blank) |
| 3 | **Industry** | LLM-classified, joined from `ai_screening.industry_category_id` → `industry_categories.label` | — |
| 4 | **Stage** | TIR → short label of `solution_stage`; SIP → short label of `sip_traction` | — |
| 5 | **AI Score** | `ai_score_overall` (unchanged) | — |
| 6 | **Status** | colored dot + label (unchanged) | — |
| 7 | **Submitted** | relative time ("27d ago", with absolute date fallback past 30 days) | — |
| 8 | **ID** | `{TRACK}-{display_seq}` e.g. `SIP-26008` | — |

---

## Section 2 — Project name derivation

Server-side helper `derive_project_name(solution_describe, basic_org) -> str` in `backend/app/services/applications_query.py`, called inside the list endpoint row shaping. Returned as `project_name` on each row.

Algorithm:

1. If `solution_describe` is null/empty, fall back to `basic_org`. If that's also empty, return `—`.
2. Take the first sentence — split on `. `, `? `, `! `, or newline; take segment 0.
3. If first sentence > 60 chars, truncate at last word boundary before char 60, append `…`.
4. If first sentence < 20 chars, take first 80 chars of full `solution_describe`, truncate at word boundary, append `…`.
5. Strip leading filler (case-insensitive): `"We are building "`, `"We're building "`, `"Our solution is "`, `"This is "`.
6. Capitalize first character.

Reference behavior:

| Raw `solution_describe` | Derived `project_name` |
|---|---|
| "We're building a human-cobot assembly cell that lets factory workers train robots by demonstration..." | "A human-cobot assembly cell that lets factory workers train robots..." |
| "ESD-safe wearable for shop-floor technicians. Solves static damage in semicon fabs." | "ESD-safe wearable for shop-floor technicians." |
| "On-device speech-to-text for 22 Indian languages with sub-200ms latency." | "On-device speech-to-text for 22 Indian languages with sub-200ms latency." |
| "We do AI." | "We do AI." |

---

## Section 3 — Dynamic industry classifier (capped at 12)

### 3a. New table `industry_categories`

Source of truth. Starts with 7 seeded buckets; grows up to 12 as the LLM proposes new ones.

```sql
CREATE TABLE IF NOT EXISTS industry_categories (
  id text PRIMARY KEY,                 -- slug, e.g. "robotics", "edge_ai_agri"
  label text NOT NULL UNIQUE,          -- display name, e.g. "Edge AI for Agriculture"
  created_at timestamptz DEFAULT now(),
  created_by_app_id uuid,              -- which app first triggered creation; null for seeds
  is_seed boolean DEFAULT false
);
```

Seed rows (all `is_seed=true`):

| id | label |
|---|---|
| robotics | Robotics & Automation |
| health | Healthcare / MedTech |
| industry | Advanced Manufacturing / Industry 5.0 |
| defense | Defense & Aerospace |
| ai | Artificial Intelligence / Foundational Models |
| semi | Semiconductor / Hardware |
| other | Other / Frontier |

**Hard cap = 12.** Seeds count toward the cap, so up to 5 new categories can be auto-created over the lifetime of the system before manual consolidation is needed.

### 3b. Classification flow (per application)

Runs inside the existing AI screening pipeline (the same LLM call that produces `score_overall`) — one call per app for new submissions, no separate worker.

For **backfill** of existing apps that already have an `ai_screening` row with `score_overall` but no `industry_category_id`, use a leaner **industry-only** variant of the same prompt (just the classification rules + current category list). This avoids re-running the full screening pipeline (which would replace `score_overall` and other fields). Cost is ~$0.001 per app for backfill.

**LLM provider and model:** all LLM calls in this feature go through **OpenRouter** using the model **`google/gemini-2.5-flash`**. This applies to both:

- the bundled industry classification inside the AI screening prompt (new submissions), and
- the industry-only backfill prompt (`backend/scripts/backfill_industry.py`).

Implementation notes:

- The OpenRouter client lives at `backend/workers/ai_screener/openrouter_client.py`. The model constant `_MODEL` is bumped to `"google/gemini-2.5-flash"`. The backfill script (`backend/scripts/backfill_industry.py`) uses the same model string.
- Use structured output (JSON mode) for the classification response so the backend can parse `category_id` / `new_category` / `industry_confidence` cleanly.
- Set a low temperature (≤ 0.2) for classification — we want deterministic bucket assignment, not creative labels.
- The same model is used for new-app classification AND backfill so behavior matches between the two paths.

1. Query `SELECT id, label FROM industry_categories ORDER BY is_seed DESC, created_at ASC` → current list.
2. Send LLM:
   - `problem_describe`, `solution_describe`, `solution_core_tech`
   - Current category list with labels
   - `current_count` and `slots_remaining = 12 - current_count`
3. LLM returns one of:
   - **Existing match:** `{ "category_id": "<existing id>", "industry_confidence": 0.0–1.0 }`
   - **New proposal (only if `slots_remaining > 0`):** `{ "new_category": { "id": "<slug>", "label": "<display>" }, "industry_confidence": 0.0–1.0, "justification": "<one sentence>" }`
4. Backend validates:
   - If existing id → must be in list; write to `ai_screening.industry_category_id`.
   - If new and slots remain and confidence ≥ 0.7 → `INSERT INTO industry_categories ... ON CONFLICT (id) DO NOTHING` (race-safe), then write `industry_category_id`.
   - If new but cap reached OR confidence < 0.7 → re-prompt once forcing pick from existing; fall back to `other` if it still hedges.

### 3c. Prompt rules

The new prompt section explicitly states:

> Read the problem and solution carefully. Pick the *best existing match* from the current category list. Only propose a new category if:
> - None of the existing categories describes the venture's primary domain, AND
> - `slots_remaining > 0`, AND
> - The new category would clearly fit ≥3 plausible future ventures (no hyper-specific labels).
>
> Prefer reusing existing categories. New categories are expensive — only create one when the venture is genuinely outside what's there.

For multi-domain ventures (e.g. a medical robot), prefer the bucket matching the *primary differentiator* described in `solution_core_tech`. Fall back to `other` only when no bucket dominates.

### 3d. Storage on `ai_screening`

```sql
ALTER TABLE ai_screening
  ADD COLUMN IF NOT EXISTS industry_category_id text
    REFERENCES industry_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS industry_confidence numeric(3,2);
```

The list endpoint joins `ai_screening` (already joined for `score_overall`) plus `industry_categories`, returns:

```json
{ "industry": { "id": "edge_ai_agri", "label": "Edge AI for Agriculture" } }
```

If `ai_screening` row exists but `industry_category_id` is null (screening done before this feature shipped, or backfill pending), industry returns `null` → frontend shows `—`.

### 3e. Old keyword classifier

`classify_industry()` in `backend/app/services/stats.py` stops being called by the list endpoint. Keep the function for one release with a `# DEPRECATED` comment so future cleanup can delete it once 100% of apps have `industry_category_id` populated.

### 3f. Backfill for the existing 65 apps

`backend/scripts/backfill_industry.py`:

1. Query every app with `status != 'draft'` from both tracks, ordered by `submitted_at ASC NULLS LAST, created_at ASC` (oldest first — gives newer apps the benefit of categories created from earlier ones).
2. For each app, run the classification flow above. Skip apps whose `ai_screening.industry_category_id` is already populated (idempotent re-run).
3. Categories created during backfill are real and stick.
4. Uses the industry-only prompt variant from section 3b (not the full screening pipeline). ~65 calls, ~$0.05 total. Run once after migration deploys.

### 3g. Future admin needs (out of scope)

- Merge two near-duplicate categories ("Surgical Robotics" + "Robotic Surgery")
- Rename a category label
- Delete an unused category

For now, manual SQL via Supabase console.

---

## Section 4 — Stage column logic

Per-track short labels, mapped server-side.

### 4a. TIR map (`solution_stage` → short)

| Raw value | Short label |
|---|---|
| `Still exploring` | Exploring |
| `Literature / research stage` | Research |
| `Simulations completed` | Simulation |
| `Lab demos / proof of concept` | Lab demo |
| `Prototype built` | Prototype |
| `Pilot-ready product` | Pilot-ready |
| `Deployed in real setting with real users` | Deployed |
| null / unknown | — |

### 4b. SIP map (`sip_traction` → short)

| Raw value | Short label |
|---|---|
| `Pre-revenue — building toward our first pilot` | Pre-revenue |
| `Active pilots (paid or unpaid) with design partners` | Active pilots |
| `Paying pilots — customers have paid for early access` | Paying pilots |
| `Live paying customers — repeat revenue` | Live revenue |
| null / unknown | — |

### 4c. Server helper

New helper `derive_stage_label(track: str, application: dict) -> dict` in `backend/app/services/applications_query.py`. Returns:

```json
{ "raw": "Lab demos / proof of concept", "label": "Lab demo" }
```

Raw is kept so the AppDrawer can show the original phrasing.

### 4d. Backend query columns

`LIST_COLUMNS` in `applications_query.py` adds: `solution_describe`, `solution_stage` (TIR), `sip_traction` (SIP). Track-aware selects in `fetch_apps_for_track()`.

### 4e. Tooltip

Table cell hovering the short label shows the raw value via the `title` HTML attribute — leadership sees the exact answer without opening the drawer.

---

## Section 5 — ID column + `display_seq`

### 5a. New columns + sequences

```sql
ALTER TABLE tir_applications ADD COLUMN IF NOT EXISTS display_seq integer UNIQUE;
ALTER TABLE sip_applications ADD COLUMN IF NOT EXISTS display_seq integer UNIQUE;

CREATE SEQUENCE IF NOT EXISTS tir_display_seq START 26001;
CREATE SEQUENCE IF NOT EXISTS sip_display_seq START 26001;
```

UUID stays primary key. `display_seq` is purely for human-readable display + search.

### 5b. Backfill (in same migration)

```sql
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY submitted_at ASC NULLS LAST, created_at ASC) + 26000 AS seq
    FROM tir_applications
)
UPDATE tir_applications t SET display_seq = o.seq FROM ordered o
 WHERE t.id = o.id AND t.display_seq IS NULL;

-- same block for sip_applications

SELECT setval('tir_display_seq', COALESCE((SELECT MAX(display_seq) FROM tir_applications), 26000));
SELECT setval('sip_display_seq', COALESCE((SELECT MAX(display_seq) FROM sip_applications), 26000));
```

Oldest submission gets `26001`, next `26002`, etc. Drafts get seq assigned by `created_at`.

### 5c. Defaults

```sql
ALTER TABLE tir_applications ALTER COLUMN display_seq SET DEFAULT nextval('tir_display_seq');
ALTER TABLE tir_applications ALTER COLUMN display_seq SET NOT NULL;

ALTER TABLE sip_applications ALTER COLUMN display_seq SET DEFAULT nextval('sip_display_seq');
ALTER TABLE sip_applications ALTER COLUMN display_seq SET NOT NULL;
```

### 5d. List endpoint

`display_id` is computed server-side as `f"{track.upper()}-{display_seq}"` and returned on each row.

### 5e. Search behavior

Frontend strips any `TIR-`/`SIP-` prefix from search input before sending. Backend `.or_()` clause adds `display_seq.eq.{n}` when the search input is purely numeric, alongside the existing name/email/org ilike filters.

---

## Section 6 — Endpoint contract

### 6a. `GET /leadership/applications` — per-row shape

```json
{
  "id": "a5b3c1d2-e4f5-6g7h-8i9j-0k1l2m3n4o5p",
  "display_id": "TIR-26013",
  "display_seq": 26013,
  "track": "tir",

  "project_name": "ESD-safe wearable for shop-floor technicians.",

  "founder": {
    "name": "Devika Shetty",
    "affiliation": "Anna University"
  },

  "industry": {
    "id": "industry",
    "label": "Advanced Manufacturing / Industry 5.0"
  },

  "stage": {
    "raw": "Lab demos / proof of concept",
    "label": "Lab demo"
  },

  "ai_score_overall": 7.8,
  "status": "submitted",
  "submitted_at": "2026-05-12T08:14:00Z",
  "created_at": "2026-05-10T11:00:00Z",

  "basic_full_name": "Devika Shetty",
  "basic_email": "devika@example.com",
  "basic_org": "Anna University"
}
```

`basic_*` fields stay in the payload (used by AppDrawer); they're just no longer the source for table columns 1–2.

### 6b. New `GET /leadership/industry-categories`

Lightweight pill data source.

```json
{
  "categories": [
    { "id": "robotics", "label": "Robotics & Automation", "count": 12 },
    { "id": "ai",       "label": "Artificial Intelligence / Foundational Models", "count": 8 },
    { "id": "other",    "label": "Other / Frontier", "count": 3 }
  ],
  "total": 65,
  "cap": 12,
  "remaining_slots": 4
}
```

Sorted by `count` desc, then `is_seed` desc as tiebreak. Empty categories (count = 0) hidden.

### 6c. Filter parameters

```
GET /leadership/applications
  ?track=tir|sip
  &status=<status_id>
  &industry=<category_id>        # now matches industry_category_id, not keyword bucket
  &search=<string>               # now also matches display_seq when numeric
  &limit=50
  &offset=0
```

### 6d. `GET /leadership/applications/{id}` (detail)

Same `project_name`, `founder`, `industry`, `stage` keys added so the AppDrawer can use them. All existing fields unchanged.

---

## Section 7 — Frontend changes

### 7a. Files touched

| File | Change |
|---|---|
| `frontend/src/pages/leadership/LeadershipDashboard.jsx` | Table markup: new 8 columns, two-line cells for Project/Founder, relative-time formatter. Filter pills now read from `industry-categories` endpoint instead of `stats.industry.industries`. |
| `frontend/src/lib/leadershipApi.js` | Add `getIndustryCategories()` wrapping `GET /leadership/industry-categories`. |
| `frontend/src/styles/leadership.css` | New rules: `.lp-row` two-line cell, `.lp-cell-sub` (smaller dim text), `.lp-id-col` (right-aligned monospace). |
| `frontend/src/pages/leadership/components/AppDrawer.jsx` | Header shows `display_id` + `project_name` instead of UUID slice + founder name. Founder/affiliation moves into meta line. |

### 7b. Row markup (sketch)

```jsx
<tr onClick={() => setOpenRow(a)}>
  <td className="lp-cell-project">
    <div className="lp-cell-primary">{a.project_name}</div>
    <div className="lp-cell-sub">{a.display_id} · {a.track.toUpperCase()}</div>
  </td>
  <td className="lp-cell-founder">
    <div className="lp-cell-primary">{a.founder.name}</div>
    <div className="lp-cell-sub">{a.founder.affiliation || "—"}</div>
  </td>
  <td>{a.industry?.label || "—"}</td>
  <td title={a.stage?.raw}>{a.stage?.label || "—"}</td>
  <td className="num">{fmtScore(a.ai_score_overall)}</td>
  <td><StatusCell status={a.status} label={statusLabelById[a.status]} /></td>
  <td>{fmtRelative(a.submitted_at)}</td>
  <td className="lp-id-col">{a.display_id}</td>
</tr>
```

### 7c. Relative time helper

New `fmtRelative(iso)` next to existing `fmtDate`:

- `< 60s` → "just now"
- `< 60m` → "{n}m ago"
- `< 24h` → "{n}h ago"
- `< 30d` → "{n}d ago"
- `≥ 30d` → "DD MMM YYYY" (en-IN) — old apps don't say "247d ago"

### 7d. Industry filter pills

Replace hardcoded list. "All" pill stays as a clear button. Count badge per pill.

```jsx
{industryCategories.map(c => (
  <button
    key={c.id}
    className={`pill ${industry === c.id ? "is-active" : ""}`}
    onClick={() => setIndustry(industry === c.id ? "" : c.id)}
  >
    {c.label} <span className="pill-count">{c.count}</span>
  </button>
))}
```

### 7e. Dashboard tab — industry bar chart

The dashboard tab's industry bar chart (LeadershipDashboard.jsx lines 590–660) currently reads `stats.industry.industries`. It now reads from `getIndustryCategories()` too. Backend's `/leadership/stats` industry block can either keep returning the same shape for one release (for compatibility) or be deleted in this cycle — open question for implementation.

### 7f. AppDrawer header

Changes from:
```
TIR · a5b3c1d2
Devika Shetty
```
to:
```
TIR-26013 · TIR
ESD-safe wearable for shop-floor technicians.
Devika Shetty · Anna University · submitted 12 May 2026
```

---

## Section 8 — Deployment sequence

### 8a. Single consolidated migration

File: `backend/migrations/017_leadership_table_redesign.sql` (full SQL in Appendix A). Run once per environment, wrapped in a single transaction. Uses `IF NOT EXISTS` everywhere so re-running is non-destructive.

Status note: **staging Supabase (`exqmxvdtcsvpgtftwjml`) has already had this SQL applied out-of-band on 2026-05-20.** The committed `017_*.sql` file is the same content, kept in the repo so the production deploy follows the standard migration path.

### 8b. Python backfill script

`backend/scripts/backfill_industry.py`. Runs after the SQL migration lands. Idempotent — skips rows where `industry_category_id` is already populated.

| Script | What it does | When to run |
|---|---|---|
| `backfill_industry.py` | LLM-classifies every non-draft app's industry, writes to `ai_screening`, may create up to 5 new industry_categories rows before hitting the 12 cap | Once per environment, after migration |

No script needed for `display_seq` — backfilled inside the SQL.

### 8c. Per-environment ship sequence (staging then prod)

1. **Deploy backend** to that environment (new endpoints + list endpoint changes + tolerant of `display_seq=null` / `industry_category_id=null`).
2. **Run migration 017** in Supabase SQL editor (staging: already done; prod: pending).
3. **Run `backfill_industry.py`** pointed at that environment's Supabase + LLM credentials.
4. **Deploy frontend** to that environment.
5. **Smoke test** `/leadership`: 65 rows show on staging, project names derived, industries populated, stages mapped, display_ids show as TIR-26001+, drawer header reads new format.

Order rationale: backend before migration is fine (it's tolerant). Migration before backend means the list endpoint won't know how to use the new columns yet, so doing backend → migration → backfill → frontend gives the cleanest staging period.

### 8d. Rollback

- Migration is hard to reverse. If something breaks post-deploy, prefer **rolling forward** with a fix migration.
- Frontend is fully reversible — redeploy previous build.
- Industry classifications are stored, so if the LLM is broken the old data stays intact.

---

## Appendix A — Consolidated migration `017_leadership_table_redesign.sql`

```sql
-- 017_leadership_table_redesign.sql
-- Adds industry_categories taxonomy + ai_screening industry columns + per-track display_seq.
-- Idempotent where possible (IF NOT EXISTS, WHERE display_seq IS NULL).
-- Run once per environment via Supabase SQL editor.

BEGIN;

-- 1. industry_categories table + 7 seeds
CREATE TABLE IF NOT EXISTS industry_categories (
  id text PRIMARY KEY,
  label text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  created_by_app_id uuid,
  is_seed boolean DEFAULT false
);

INSERT INTO industry_categories (id, label, is_seed) VALUES
  ('robotics', 'Robotics & Automation',                    true),
  ('health',   'Healthcare / MedTech',                     true),
  ('industry', 'Advanced Manufacturing / Industry 5.0',    true),
  ('defense',  'Defense & Aerospace',                      true),
  ('ai',       'Artificial Intelligence / Foundational Models', true),
  ('semi',     'Semiconductor / Hardware',                 true),
  ('other',    'Other / Frontier',                         true)
ON CONFLICT (id) DO NOTHING;

-- 2. ai_screening new columns
ALTER TABLE ai_screening
  ADD COLUMN IF NOT EXISTS industry_category_id text
    REFERENCES industry_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS industry_confidence numeric(3,2);

-- 3. display_seq columns + sequences
ALTER TABLE tir_applications ADD COLUMN IF NOT EXISTS display_seq integer UNIQUE;
ALTER TABLE sip_applications ADD COLUMN IF NOT EXISTS display_seq integer UNIQUE;

CREATE SEQUENCE IF NOT EXISTS tir_display_seq START 26001;
CREATE SEQUENCE IF NOT EXISTS sip_display_seq START 26001;

-- 4. Backfill display_seq for existing rows (oldest first)
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY submitted_at ASC NULLS LAST, created_at ASC) + 26000 AS seq
    FROM tir_applications
)
UPDATE tir_applications t
   SET display_seq = o.seq
  FROM ordered o
 WHERE t.id = o.id
   AND t.display_seq IS NULL;

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY submitted_at ASC NULLS LAST, created_at ASC) + 26000 AS seq
    FROM sip_applications
)
UPDATE sip_applications s
   SET display_seq = o.seq
  FROM ordered o
 WHERE s.id = o.id
   AND s.display_seq IS NULL;

-- 5. Bump sequences past the backfilled max so future inserts don't collide
SELECT setval('tir_display_seq', COALESCE((SELECT MAX(display_seq) FROM tir_applications), 26000));
SELECT setval('sip_display_seq', COALESCE((SELECT MAX(display_seq) FROM sip_applications), 26000));

-- 6. Defaults + NOT NULL on display_seq for future inserts
ALTER TABLE tir_applications ALTER COLUMN display_seq SET DEFAULT nextval('tir_display_seq');
ALTER TABLE tir_applications ALTER COLUMN display_seq SET NOT NULL;

ALTER TABLE sip_applications ALTER COLUMN display_seq SET DEFAULT nextval('sip_display_seq');
ALTER TABLE sip_applications ALTER COLUMN display_seq SET NOT NULL;

COMMIT;
```

---

## Appendix B — Open implementation questions (to resolve in planning)

These don't block design approval but are flagged for the implementation plan:

1. **Where exactly in the AI screening pipeline does the new industry prompt slot in?** Need to read the existing LLM service code path before deciding whether to extend the existing prompt or add a structured-output field.
2. **What happens when `ai_screening` row exists but `industry_category_id` is null?** Backfill script is the official path, but the list endpoint should also be tolerant (show `—`).
3. **Should `/leadership/stats` industry block be deleted in this cycle or kept for one release?** Mild compatibility consideration. Recommend deleting now since the dashboard tab is in the same redesign.
4. **Test coverage:** unit tests for `derive_project_name()` (truncation + filler-strip cases) and `derive_stage_label()` (each enum). Integration test for the dynamic category creation flow (mock LLM, assert cap enforcement).
