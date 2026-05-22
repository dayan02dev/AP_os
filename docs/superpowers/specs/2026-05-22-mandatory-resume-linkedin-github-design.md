# Mandatory resume + LinkedIn + GitHub on TIR applications

**Status:** design approved 2026-05-22, ready to implement
**Scope:** TIR track only (prod `applications` table + staging `tir_applications`)
**Out of scope:** SIP wizard, admin/reviewer/leadership flows, the legacy `profiles.linkedin_url`

## 1. Goal & motivation

Today the TIR wizard accepts a submit without a resume upload, without a LinkedIn URL, and without a GitHub URL at all (GitHub is not a field anywhere in the schema). Leadership has asked for these three signals to be required on every new submission.

**Coverage today (prod, 87 unique submitters):**

| Signal | Submitters with it | Without |
|---|---:|---:|
| Resume in `resumes` storage bucket | 29 | 58 |
| `profiles.linkedin_url` populated | 11 | 76 |
| GitHub URL (any location) | 0 | 87 |

The wizard treats LinkedIn as profile-level (a separate screen most applicants never visit) and never asks for GitHub, which explains the gaps. Pulling all three into the wizard itself and enforcing them at submit time is the smallest change that closes the gap.

## 2. Decisions (already approved)

| # | Decision | Choice |
|---|---|---|
| D1 | Existing 87 submitted rows | **Grandfather** — new rule applies to submissions made after the change ships; DB columns stay NULL-allowed |
| D2 | Where the fields live | **All three in the application wizard** — new columns on the applications row |
| D3 | Validation strictness | **Light** — URL pattern + PDF extension + ≤5MB; no third-party reachability checks |
| D4 | Testing strategy | **Staging E2E first**, then prod-specific migration + deploy |

## 3. Schema changes

Three new nullable columns, four lightweight check constraints. Two parallel migration files because staging is on the post-rename schema and prod is still on the legacy one.

**Files:**
- `backend/migrations/019_mandatory_profile_links_staging.sql` — operates on `tir_applications`
- `backend/migrations/019_mandatory_profile_links_prod.sql` — operates on `applications` (legacy)

Both files added these columns and constraints:

```sql
ALTER TABLE <target_table>
  ADD COLUMN IF NOT EXISTS resume_file_id uuid,
  ADD COLUMN IF NOT EXISTS linkedin_url   text,
  ADD COLUMN IF NOT EXISTS github_url     text;

-- Check constraints (NULL-allowed so grandfathered rows stay valid)
linkedin_url_format : linkedin_url IS NULL OR linkedin_url ~* 'linkedin\.com/'
github_url_format   : github_url   IS NULL OR github_url   ~* 'github\.com/'
linkedin_url_len    : linkedin_url IS NULL OR length(linkedin_url) <= 500
github_url_len      : github_url   IS NULL OR length(github_url)   <= 500
```

**Both migrations have already been applied** (staging `exqmxvdtcsvpgtftwjml` and prod `xtmszlpwgbyoumalgbhs`) on 2026-05-22.

`resume_file_id` carries no FK — it's just a UUID whose value names the file at `resumes/<user_id>/<resume_file_id>.pdf` in the Supabase storage bucket. Matches today's storage convention. One resume per application; re-upload replaces.

## 4. Backend changes

### 4.1 Model + persistence

Add the three fields to:
- `backend/app/models/application.py` — `ApplicationRead`, `ApplicationUpdate` schemas
- `backend/app/services/applications_query.py` — projection lists where applicable

Nothing else changes in the persistence layer. `PATCH /applications/me` already accepts arbitrary application fields and rides the new columns through.

### 4.2 Submit-time validator

Extend the existing `validate_for_submit()` (the same function that today gates `declaration_truthful`, etc.) with three new checks. All three only fire on `POST /applications/me/submit`, never on `PATCH` (drafts are partial-save).

| Field | Appended to `missing_fields` when… | Logic |
|---|---|---|
| `resume_file_id` | value is NULL **or** the named file is not in storage | non-null AND `storage.from_('resumes').list(user_id)` contains an object matching `<resume_file_id>.pdf` |
| `linkedin_url` | value is empty, too long, or wrong domain | non-empty, ≤500 chars, case-insensitive substring `linkedin.com/` |
| `github_url` | value is empty, too long, or wrong domain | non-empty, ≤500 chars, case-insensitive substring `github.com/` |

The storage-existence check prevents a malicious client from setting `resume_file_id` to a random UUID to bypass the upload step.

**Response shape (unchanged contract — top-level code stays `incomplete_application`, new field names are appended to the existing `missing_fields` array):**

```json
{
  "code": "incomplete_application",
  "missing_fields": ["resume_file_id", "linkedin_url", "github_url"]
}
```

The existing wizard already groups `missing_fields` into a single "Please complete: X, Y, Z" toast — no frontend handling change needed.

### 4.3 Resume upload endpoint

`POST /resume/upload` already exists and returns `{ file_id, filename, size }`. No change needed. The frontend now stores the returned `file_id` on the application via the next `PATCH /applications/me`.

## 5. Frontend changes

### 5.1 Where the fields appear

Folded into the existing Basic step (`/apply/basic`), at the bottom under a subheading **"Identity & links"**. No new wizard step.

### 5.2 Field widgets

| Field | Widget | Required marker | Placeholder / hint |
|---|---|---|---|
| LinkedIn URL | text input | red `*` + "Required" hint | `https://linkedin.com/in/yourname` |
| GitHub URL | text input | red `*` + "Required" hint | `https://github.com/yourname` |
| Resume | file picker + uploaded-state card | red `*` + "Required, PDF only" | "Drop a PDF or click to choose" |

### 5.3 Inline validation

Matches the existing wizard pattern:

- Field shows red border + error text **on blur**, only if non-empty AND invalid (so just-tabbed-into doesn't shout)
- LinkedIn / GitHub: error if value doesn't contain `linkedin.com/` / `github.com/` (case-insensitive)
- Resume: client-side check for `.pdf` extension + size ≤ 5MB before calling the upload endpoint

### 5.4 Resume upload flow

1. User selects a file → frontend POSTs to `/resume/upload` → backend returns `{ file_id, filename, size }`
2. Frontend immediately PATCHes `/applications/me` with `resume_file_id: <file_id>`
3. Basic step renders a "Resume uploaded" card: `<filename.pdf> · 245 KB` + **Replace** and **Remove** buttons
4. **Replace** = pick another file, repeats steps 1–2
5. **Remove** = PATCH with `resume_file_id: null` (rare but supported)

### 5.5 Drafts

Drafts save freely with any of these blank. Only the SUBMIT button gate enforces non-empty.

### 5.6 Files touched

- `frontend/src/sections/Basic.jsx` — add three new fields + the Resume card
- `frontend/src/components/ResumeUploadCard.jsx` — new ~60 LoC component
- `frontend/src/lib/api.js` — small `uploadResume(file)` helper if not already there
- `frontend/src/lib/applicationSchema.js` (or wherever section schemas live) — declare the three fields so the Review page auto-includes them

### 5.7 Review + Submitted pages

The existing `/apply/review` auto-renders all wizard answers from the schema — three new fields appear there without further code changes. The Submit toast already handles `missing_fields` lists.

## 6. Tests

### 6.1 Backend (pytest)

`tests/test_applications_submit.py` — add:

- Submit with all three fields populated and valid → 200
- Submit with `resume_file_id = null` → 422, `missing_fields` includes `"resume_file_id"`
- Submit with `linkedin_url = "https://example.com"` → 422, `missing_fields` includes `"linkedin_url"`
- Submit with `github_url = ""` → 422, `missing_fields` includes `"github_url"`
- Submit with `resume_file_id = <random UUID not in storage>` → 422, `missing_fields` includes `"resume_file_id"`
- Submit with all three blank → 422, `missing_fields` includes all three field names
- PATCH with the fields blank → 200 (drafts save unrestricted)
- Existing "grandfathered" submitted row with NULL fields → still readable via GET, no validation re-fire

### 6.2 Frontend (vitest)

`frontend/src/sections/__tests__/Basic.test.jsx`:

- Invalid LinkedIn shows error on blur (`https://example.com/`)
- Invalid LinkedIn does NOT show error when field is empty (just-tabbed-in case)
- Resume `.txt` rejected client-side with "PDF only" toast
- Resume >5MB rejected client-side with "Max 5MB" toast
- Successful upload renders ResumeUploadCard with filename + Replace + Remove

`frontend/src/components/__tests__/ResumeUploadCard.test.jsx`:

- Replace calls upload + patch in correct order
- Remove calls patch with `resume_file_id: null`

### 6.3 Staging E2E walkthrough (manual, ~5 min)

Run after backend + frontend land on staging, before touching prod:

1. Sign in to staging as a fresh test user
2. Start a new TIR application → go to Basic step
3. Confirm the three new fields appear with `*` markers
4. Try to submit with all three blank → expect missing-fields toast listing all three
5. Type `https://example.com` into LinkedIn, blur → expect red border + error text
6. Type `https://linkedin.com/in/test` → error clears
7. Upload a `.txt` file → expect "PDF only" toast, no upload
8. Upload a real PDF → expect Resume card with filename + size
9. Click Replace → upload different PDF → card updates
10. Click Remove → card returns to upload prompt; re-uploading works
11. Fill GitHub with valid URL
12. Click Submit → expect success
13. Reload leadership dashboard → confirm new app appears with the three fields visible on detail
14. Open an OLD submitted app (NULL fields) → confirm it still loads, fields shown as `—`

### 6.4 Prod smoke test (post-deploy, ~2 min)

Repeat steps 1, 3, 4, 12, 14 on the prod URL with a throwaway account.

## 7. Rollout order

| # | Step | Where | Reversible? |
|---|---|---|---|
| 1 | ✅ DB migrations 019 (done) | Staging + prod Supabase | Yes, DROP COLUMN |
| 2 | Backend (model + validator + helpers) | Staging Lambda | Yes, redeploy previous |
| 3 | Frontend (Basic + ResumeCard) | Staging Vercel | Yes, redeploy previous |
| 4 | Staging E2E walkthrough (§6.3) | Manual | n/a |
| 5 | Backend → prod Lambda | Prod | Yes, redeploy previous |
| 6 | Frontend → prod Vercel | Prod | Yes, redeploy previous |
| 7 | Prod smoke test (§6.4) | Manual | n/a |

**No feature flag.** Small change, fast rollbacks per step, no half-state worth supporting.

**Rollback if §7 fails:**

1. Vercel: revert previous deployment (instant)
2. Lambda: redeploy previous CloudFormation stack version (~1 min)
3. DB: leave columns in place — they're NULL-allowed and harmless

## 8. Explicitly out of scope

- SIP wizard and `sip_applications` table — only TIR is changed in this round
- Admin / reviewer / leadership flows — untouched
- Backfilling the 87 existing submitted rows — grandfathered, never re-validated
- Removing or migrating `profiles.linkedin_url` — left alone (now redundant with the new application-level column but removing it would orphan existing profile data)
- Any GitHub API verification, LinkedIn reachability check, or PDF content parsing — light validation only
