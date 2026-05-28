# SIP track launch to production — cutover design

**Date:** 2026-05-26
**Owner:** dev@artpark.in
**Source branch:** `staging`
**Release branch (to be created):** `release/sip-launch-v1`
**Target stack:** `artpark-eir-api-production` (AWS SAM, ap-south-1)
**Target Supabase:** `xtmszlpwgbyoumalgbhs` (prod)
**Target frontend:** `apply.artpark.info` (Vercel)

---

## 1. Goal

Launch the SIP (Startup Incubation Programme) track on production alongside the existing TIR track. After cutover, an applicant visiting `apply.artpark.info` sees a TIR / SIP chooser and can fill out either wizard. Existing TIR applicants are unaffected — their drafts migrate transparently from `applications` to `tir_applications`. A single user can hold one draft (and any number of submitted apps) per track.

What lands on prod:

- Dual-track DB schema (`tir_applications` + `sip_applications`, each with its own resume_uploads + storage buckets).
- SIP-specific backend routers (`sip_applications`, `sip_resume`, `sip_milestone_files`, `sip_evidence_files`, `sip_application_templates`).
- SIP applicant wizard frontend (chooser at `/apply`, SIP question set, SIP-specific UX polish ~15 commits' worth).
- `profiles.track` column populated to `'tir'` for all existing applicants (explicit, not implicit).
- General prod hardening: CORS allow-list locked to single origin, API health alarms wired to SNS, stack termination protection enabled.

Not in this push (deferred to the next push):

- Leadership / admin / reviewer dashboard (Phase 1 admin platform).
- AI screener pipeline (SQS, worker Lambda, DLQ).
- `user_roles`, `audit_log_v2`, `ai_screening`, `application_status_log`.
- DB-level role lockdown trigger.
- `grant_leadership.py` and `dev@artpark.in` user creation.
- Auto-assign of `applicant` role on signup (the known gap from `[[project_phase1_gaps_to_brainstorm]]`) — the `user_roles` table does not exist on prod yet, so the gap is moot until the leadership push.

## 2. Non-goals (explicit)

- Anything from the `staging-role_based_dashboard` branch. That's the next push.
- New Lambda functions on prod. Only the existing `artpark-eir-api-production` Lambda gets a code update.
- AI infrastructure (SQS, DLQ, worker, alarms specific to AI). General API alarms only.
- Backfill of AI scores (no AI screening table exists).
- Migrating Lambda secrets from env-vars to Secrets Manager.
- Cutover timing — left open (TBD, picked just before launch).

## 3. Hard constraints

- **No automatic role grants.** Every user signing up via the public OTP/password flow is treated as an applicant. The `user_roles` table doesn't exist on prod yet; absence of a row continues to mean "applicant". Carries through unchanged from current prod behavior.
- **No proactive email comms about the maintenance window.** The maintenance-mode Vercel page promoted during the window is the only notification. No 24h-prior email to draft holders.
- **Auth flow unchanged end-to-end for both tracks.** Sign-up (`/apply/signup` → email → OTP at `/apply/verify` → set password at `/apply/set-password`) and sign-in (`/apply/signin` with password OR "email me a code" → OTP at `/apply/verify`) are the same single flow for TIR and SIP applicants. The chooser appears AFTER successful sign-in, on `/apply`. There is no track-specific signup URL, no track-specific OTP flow, no track-specific password reset. Token storage, idle logout, single-flight 401 refresh, and `/auth/me` rehydration all stay as-is.
- **Submission confirmation email for both tracks.** When an applicant submits a TIR application or a SIP application, the backend sends a submission confirmation email via Resend (using the `submission_confirmation` Jinja template, which is track-agnostic — both `applications.py` and `sip_applications.py` on the staging branch call `get_email_service().send_submission_confirmation(...)` via a shared `_send_submission_email` helper). Confirmed present on staging. Verified end-to-end in Stage A.8 dry-run and Stage C smoke test.
- **Existing applicant data is preserved end-to-end.** Migration 010 uses `ALTER TABLE ... RENAME TO`, which preserves every row and every constraint. After cutover:
  - All rows in `applications` → live in `tir_applications` (zero data loss).
  - All rows in `resume_uploads` → live in `tir_resume_uploads`.
  - All storage objects in buckets `resumes` / `milestone-files` / `evidence-files` → live in `tir-resumes` / `tir-milestone-files` / `tir-evidence-files` (objects preserved, only bucket name changes; paths within buckets are unchanged).
  - All JSONB columns (`evidence_files`, `evidence_deck`, `execution_milestone_files`) keep their contents byte-for-byte.
  - All `submitted_at`, `created_at`, `updated_at`, `status` values preserved.
  - Existing applicants' `/apply/submitted` page must continue to show their submitted history exactly as before. This is verified in Stage C smoke test and again in Stage D.
- **Both tracks viewable and draftable; submission locked to the first-submitted track.** Every signed-in applicant can see the TIR/SIP chooser at `/apply` and can hold one draft in TIR plus one draft in SIP simultaneously. The act of submitting an application LOCKS the user to that track for all future submissions:
  - Before any submission: applicant can draft, save, and edit in both tracks freely.
  - On first submission (say TIR): submit succeeds, and the user is now "TIR-locked" — they can continue submitting more TIR applications (unlimited), but the SIP submit endpoint will return `409 cross_track_submission_blocked` if they try to submit their SIP draft.
  - The lock is derived from existing rows, not stored as a new column: `EXISTS(SELECT 1 FROM <other_track>_applications WHERE user_id=:uid AND status != 'draft')`. No schema change required.
  - The SIP draft is NOT auto-deleted after the lock — it stays viewable so the applicant understands why submit is blocked.
  - Recovery (e.g., applicant chose wrong track) is admin-only: delete the wrong-track submitted rows via SQL, the lock auto-clears.
- **`profiles.track` is a UX convenience, not a lock.** It tracks the wizard the user is currently in (set when they click TIR or SIP at the chooser, updated as they switch). It does NOT enforce track exclusivity — the submit-time check does. SIP RLS in migration 011 needs to be confirmed in the implementation plan: it currently gates SIP table access on `profiles.track='sip'`, which conflicts with "draft both" — we may need to either keep `profiles.track` in sync as the user switches wizards, or drop the RLS gate in favor of ownership-only checks. See open items.
- **SIP visible at cutover for everyone.** Both existing applicants and new signups see the chooser. Existing TIR applicants who never visited the chooser keep their TIR drafts intact; if they later visit the chooser and pick SIP, they can draft SIP too (but cannot submit SIP because their existing TIR submissions lock them).
- **Complete field + file coverage for SIP.** Every question in the SIP wizard maps to a column on `sip_applications` (or to a SIP storage bucket). Migrations 011, 012, 020, 021 collectively cover all fields. End-to-end coverage is verified in Stage A.8 dry-run by submitting a fully-filled SIP application on a restored snapshot and confirming every column / file lands.

## 4. Sequencing overview

Six stages, target cutover window ~20 minutes, hard ceiling 40 minutes.

```
STAGE A — Prep work (days, no prod changes)
  A.1 Confirm AWS / Vercel / Supabase access
  A.2 Snapshot prod Supabase (manual table backups + verify PITR)
  A.3 Verify migration 019 drift on prod
  A.4 Create SNS topic + email subscription for API alarms
  A.5 Build release branch release/sip-launch-v1
        - cherry-pick 4 main-only commits if not already on staging
        - revert CORS hack to single-origin literal (prod has one origin)
        - update SAM template: add API health alarms
        - update backend/.env.prod (APP_VERSION bump)
        - write backend/scripts/audit_test_data.sql
  A.6 Build maintenance-mode Vercel branch
  A.7 Local test pass (backend pytest + frontend vitest + build)
  A.8 Full dry-run on PITR-restored prod snapshot
        - apply migrations 010, 011, 012, 013, 019 (if needed), 020, 021
        - run UPDATE profiles SET track='tir' backfill
        - point local backend at restored project
        - **TIR preservation check (REAL prod data):**
            - confirm every row from snapshot `applications` shows up in `tir_applications`
            - sign in as a known prod TIR applicant (or impersonate via service-role)
            - verify their /apply/submitted history is intact
            - verify evidence_files JSONB still resolves to real storage objects
            - verify resume_uploads → tir_resume_uploads, file downloadable
        - **SIP field-coverage check (END-TO-END):**
            - sign up as a new test user, pick SIP at chooser
            - fill EVERY question in the SIP wizard (basic, problem, solution, execution, evidence, declaration, plus all SIP-specific: founders/cap-table, traction files, pitch deck, demo video, patents, DPIIT details, team, etc.)
            - upload at least one file in every SIP file-upload slot (sip-resumes, sip-milestone-files, sip-evidence-files, cap-table file, pitch deck, traction files, patents files, demo video URL)
            - submit
            - run SELECT * FROM sip_applications WHERE user_id='<test>' — every column should have a value where the wizard provided one (NULL only for genuinely optional unfilled fields)
            - confirm each uploaded file's storage_path actually points at an existing object in the right bucket
        - **Auth flow check (must work for both tracks):**
            - `/apply/signup` → OTP → `/apply/verify` → `/apply/set-password` → `/apply` → chooser visible
            - sign out, sign back in via `/apply/signin` (password) → reach `/apply`
            - sign out, sign back in via `/apply/signin` ("email me a code") → reach `/apply`
            - verify `/auth/me` returns the user; `useAuth` rehydration works
        - **Submission email check (CRITICAL — both tracks):**
            - submit a test TIR application → confirmation email arrives at the test inbox
            - submit a test SIP application → confirmation email arrives at the test inbox
            - both emails should reference the right application (template is shared but body includes applicant name + app id)
            - verify Resend dashboard shows two successful deliveries (no bounces)
        - **Cross-track submit-lock check (the key new rule):**
            - as a known TIR user with submitted history (backfilled `track='tir'`), navigate to `/apply` — chooser SHOULD appear
            - pick SIP — SIP wizard should be accessible, draft creation should work
            - fill the SIP draft, try to SUBMIT — submit MUST return 409 `cross_track_submission_blocked` because they have submitted TIR rows
            - confirm the SIP draft itself stays editable / viewable (lock is on submit only, not on draft)
            - then: as a new test user with NO prior submissions, draft BOTH tracks, submit TIR first, verify SIP submit is now blocked
            - reverse case: another new test user drafts both, submits SIP first, verify TIR submit is now blocked
        - **`profiles.track` consistency check:**
            - verify whatever staging does with `profiles.track` (set at signup, updated on chooser pick) doesn't break access to the user's drafts in either track
            - if SIP RLS currently gates on `profiles.track='sip'` AND the user is currently `'tir'`, SIP draft writes will fail — this is the open question; resolve before cutover
        - only then proceed to Stage B

STAGE B — Pre-cutover infrastructure (live, additive only)
  B.1 Enable termination protection on prod stack
  B.2 SAM deploy: adds API health alarms (Lambda code unchanged)
  B.3 Verify alarms wired to SNS topic
  --- safe to pause here for hours/days before cutover ---

STAGE C — Cutover window (~20 min target, ~40 min ceiling)
  C.1 T-10m  Team in cutover channel, deploys frozen
  C.2 T=0    Promote maintenance frontend on Vercel
  C.3 T+2m   Test data purge (audit query + DELETE)
  C.4 T+5m   Apply migrations 010, 011, 012, 013, [019 if missing],
             020, 021 in order
  C.5 T+12m  Backfill: UPDATE profiles SET track='tir' WHERE track IS NULL
  C.6 T+13m  Deploy new Lambda code via SAM
  C.7 T+17m  Promote new frontend on Vercel
  C.8 T+19m  Smoke test
  C.9 T+22m  CloudWatch sanity
  C.10 T+25m Cutover declared done

STAGE D — Post-cutover verification (within 24h, non-urgent)
  D.1 Spot-check: existing applicants can sign in and resume drafts
  D.2 Spot-check: new signups can choose either track
  D.3 Spot-check: SIP template upload + parse works end-to-end
  D.4 No backfill scripts to run (no AI scoring yet)

STAGE F — 48h monitoring + handover
  F.1 Tail CloudWatch logs for the API Lambda
  F.2 Watch alarm states, Sentry error counts
  F.3 Update docs/ARCHITECTURE.md to reflect dual-track schema on prod
  F.4 Move Stage A.2 backup tables to an archive schema; drop after 30 days
```

Stages A, B, F are reversible / additive. Stage C is the only destructive window. Stage E (first leadership user) from the previous spec does not exist here — leadership infrastructure is not part of this push.

## 5. Artifacts to build in Stage A

### 5.1 Release branch commits

Sequence on `release/sip-launch-v1`, branched from `staging` tip:

```
<base>           # branched from origin/staging
cherry-pick 28842fc   # fix(autosave): flush debounced PATCH before sign-out
cherry-pick a118078   # fix(apply): guard /apply/submitted against draft fallback
cherry-pick 2d9cc68   # content(/): bump SIP opening countdown to 24 May 2026
cherry-pick 888a2b0   # content(marketing): bump TIR deadline 22 → 24 May
fix(sam): hardcode single-origin CORS for prod (apply.artpark.info only)
feat(sam): add API health alarms + wire to SNS
feat(scripts): add audit_test_data.sql
chore(version): bump backend version to 0.9.0-sip
```

If any of the four main-only commits cleanly applies but is already conceptually present on `staging`, skip it. A pre-flight `git log --grep <subject>` confirms.

### 5.2 SAM template updates (`infra/sam/template.yaml`)

Starting point is the `staging` branch's template (which has the SAM CORS workaround as a deliberate hardcoded list for staging).

| Element | Action |
|---|---|
| `AllowOrigins` | Replace the hardcoded 5-URL staging list with a single literal: `["https://apply.artpark.info"]`. Keep `FrontendOrigin` env var set to the same value so the FastAPI middleware aligns. The SAM-transform workaround note in the comment stays — it explains WHY we can't use `!Split` |
| `ApiErrorsAlarm` (new) | Lambda Errors > 0 in any 5-min window → AlarmsTopic |
| `ApiThrottlesAlarm` (new) | Lambda Throttles > 0 → AlarmsTopic |
| `ApiP99DurationAlarm` (new) | Lambda Duration p99 > 25 000 ms → AlarmsTopic |
| `AlarmsTopic` parameter (new) | Type String, default `arn:aws:sns:ap-south-1:348287123004:artpark-prod-alarms` |
| AI screener resources | **Skip.** No `AiScreenerQueue`, no `AiScreenerDLQ`, no `AiScreenerFunction`, no related IAM. Those land with the leadership push |

No new outputs needed.

### 5.3 `backend/scripts/audit_test_data.sql` (new)

Read-only audit query. Identifies rows that look like test data so the operator can decide what to DELETE in Stage C.3. Patterns covered: `%@artpark.test`, `%@example.%`, `%+test%`, `test%@%`.

```sql
SELECT id, user_id, basic_email, status, submitted_at, created_at
FROM applications
WHERE basic_email ILIKE '%@artpark.test'
   OR basic_email ILIKE '%@example.%'
   OR basic_email ILIKE '%+test%'
   OR basic_email ILIKE 'test%@%'
ORDER BY created_at DESC;
```

Note: runs against `applications` (pre-rename). After migration 010 the operator runs the same query against `tir_applications` for any leftover audit.

### 5.4 Maintenance-mode Vercel branch

Same as the prior leadership-cutover design: a new branch `maintenance-mode` off `main` in the GitHub repo, containing `frontend/public/maintenance.html` (static back-at-HH:MM page) and a `vercel.json` catch-all rewrite. Built once, promoted during Stage C.2, rolled back by promoting the previous deployment.

### 5.5 `backend/.env.prod` updates

(Gitignored.)

```
APP_VERSION=0.9.0-sip                                # bumped from 0.1.0
ALARMS_TOPIC_ARN=arn:aws:sns:ap-south-1:348287123004:artpark-prod-alarms

# Existing values unchanged:
#  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
#  OPENROUTER_API_KEY, OPENROUTER_MODEL
#  RESEND_API_KEY, SES_FROM_EMAIL
#  ADMIN_API_KEY, SENTRY_DSN, LOG_LEVEL, FRONTEND_ORIGIN

# Explicitly NOT adding (those belong to the leadership push):
#  AI_STUB, AI_SCORING_ENABLED, AI_SCREENING_QUEUE_URL,
#  AI_SCORING_MODEL, AI_SCORING_BASE_URL
```

## 6. Cutover execution playbook (Stage C, detailed)

### T-10m

- Cutover lead joins the cutover channel.
- Observer has Sentry + CloudWatch tail open in browser.
- All other deploys frozen.

### T=0 — Promote maintenance frontend

- Vercel dashboard → Deployments → `maintenance-mode` branch → "Promote to Production".
- Verify in incognito: `https://apply.artpark.info` shows the maintenance page.
- Backend keeps serving API calls but no users hit it.

### T+2m — Test data purge

- Open prod Supabase SQL editor.
- Run `backend/scripts/audit_test_data.sql`.
- Eyeball the list — confirm only test rows, no real applicants.
- Compose and run a DELETE inside a transaction:

```sql
BEGIN;
DELETE FROM applications WHERE id IN (<audit_ids>);
DELETE FROM resume_uploads WHERE user_id IN (<audit_user_ids>);
DELETE FROM profiles WHERE id IN (<audit_user_ids>);
SELECT count(*) FROM applications;
COMMIT;
```

`auth.users` entries are left alone — they can only be removed via the Supabase Admin API and have no impact on the wizard.

### T+5m — Apply migrations in order

In Supabase SQL editor, paste each file, wait for green, then move to the next.

```
010_track_rename_and_split.sql      ← DESTRUCTIVE: renames applications → tir_applications, renames 3 buckets, adds profiles.track
011_sip_track.sql                   ← creates sip_applications + sip_resume_uploads + 3 SIP buckets
012_sip_add_will_break.sql          ← adds execution_will_break to sip_applications
013_relax_other_constraints.sql     ← relaxes basic_degree + basic_hear_about CHECK
[019_mandatory_profile_links_prod.sql ← apply ONLY if Stage A.3 confirmed not yet applied]
020_sip_application_templates.sql   ← SIP offline template upload (table + bucket)
021_sip_team_and_dpiit.sql          ← SIP team + DPIIT registration columns
```

**Do NOT run** `019_mandatory_profile_links_staging.sql` against prod — that variant is staging-only.

Verifications between migrations:

After 010:

```sql
SELECT count(*) FROM tir_applications;       -- pre-cutover applications count minus purged rows
SELECT count(*) FROM applications;            -- expect: relation does not exist
SELECT id FROM storage.buckets WHERE id LIKE 'tir-%';   -- expect 3 buckets
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='track';
-- expect 1 row
```

After 011:

```sql
SELECT count(*) FROM sip_applications;          -- expect 0
SELECT id FROM storage.buckets WHERE id LIKE 'sip-%';   -- expect 3 buckets
```

After 021:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='sip_applications'
  AND column_name IN ('basic_has_team','basic_teammates',
                      'basic_dpiit_registered',
                      'basic_dpiit_recognition_number',
                      'basic_dpiit_recognition_date');
-- expect 5 rows

-- Check the two CHECK constraints exist
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.sip_applications'::regclass
  AND conname IN ('sip_basic_has_team_check','sip_basic_dpiit_registered_check');
-- expect 2 rows
```

If any verification fails → STOP. Trigger rollback per Section 8.

### T+12m — Backfill `profiles.track`

```sql
BEGIN;
UPDATE profiles SET track='tir' WHERE track IS NULL;
SELECT count(*) FROM profiles WHERE track IS NULL;   -- expect 0
SELECT track, count(*) FROM profiles GROUP BY track; -- expect all 'tir', plus possibly some 'sip' if migration 010's trigger set any
COMMIT;
```

This ensures every existing applicant has an explicit track. The frontend will not need to fall back to `track ?? 'tir'` anywhere.

### T+13m — Deploy new Lambda code

From the worktree on `release/sip-launch-v1`:

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/<worktree>
git status                              # must show release/sip-launch-v1
cd infra/sam
./deploy-prod.sh
```

SAM build runs from `backend/` on disk — verify the working directory is on the right branch (see auto-memory `[[feedback_sam_deploy_requires_worktree]]`).

Verify:

```bash
curl -s https://api.artpark.info/health | jq
# expect: {status: "ok", version: "0.9.0-sip", ...}

curl -s https://api.artpark.info/health/ready | jq
# expect: db ok, auth ok, openrouter ok
```

### T+17m — Promote real frontend on Vercel

- Vercel auto-builds on `release/sip-launch-v1` push. Find the build, "Promote to Production".
- Verify in fresh incognito: `https://apply.artpark.info` shows the public landing.
- Click "Apply" → see the TIR/SIP chooser (NEW).

### T+19m — Smoke test

| # | Check | Method | Expected |
|---|---|---|---|
| 1 | Public landing loads | Browse `https://apply.artpark.info` | renders |
| 2 | Sign-in page loads | Click "Sign in" | OTP/password form |
| 3 | App version + health | `curl /health` | `0.9.0-sip`, status ok |
| 4 | **Existing TIR applicant: history intact** | Sign in as a known prod TIR applicant (use a real test account, NOT a new one) | `/apply/submitted` shows all their prior submissions; data identical to pre-cutover |
| 5 | **Existing TIR applicant: draft resumable** | Same user, if they have a draft | resume screen renders, all saved answers visible, can edit + save |
| 6 | **Existing TIR applicant: chooser visible** | Same user navigates to `/apply` | chooser shows BOTH TIR and SIP buttons |
| 7 | **Existing TIR applicant: SIP draft creation works** | Pick SIP from chooser | SIP wizard opens, can fill answers, save draft |
| 8 | **Existing TIR applicant: SIP submit blocked** | Try to submit the SIP draft | `409 cross_track_submission_blocked` (or equivalent error message in UI) |
| 9 | **Existing TIR applicant: SIP draft still viewable** | Navigate back to SIP wizard after submit attempt | draft still saved, editable, visible |
| 10 | New signup → chooser appears | Brand-new test email, complete OTP, reach `/apply` | chooser shows TIR and SIP buttons |
| 11 | New signup → drafts both simultaneously | Pick TIR, fill, save draft → back to chooser → pick SIP, fill, save draft | both drafts coexist; `tir_applications` AND `sip_applications` each have one row for this user |
| 12 | New signup → submits TIR → SIP lock activates | Submit TIR draft → return to SIP draft → try submit | TIR submit succeeds; SIP submit returns 409 |
| 13 | New signup (reverse) → submits SIP first | Different test user, submit SIP first, then try TIR submit | SIP succeeds; TIR submit returns 409 |
| 14 | `applications` table is gone | `SELECT 1 FROM applications LIMIT 1;` in Supabase SQL editor | error: relation does not exist |
| 15 | `tir_applications` row count | `SELECT count(*) FROM tir_applications;` | matches pre-cutover `applications` count minus purged test rows |
| 16 | SIP buckets accessible | Upload a file via SIP wizard | object lands in `sip-evidence-files` / `sip-milestone-files` etc. |
| 17 | SIP template upload + parse | Upload .docx through SIP wizard template step | `parse_status='completed'`, fields populate `sip_applications` |
| 18 | TIR buckets renamed | `SELECT id FROM storage.buckets WHERE id IN ('tir-resumes','tir-milestone-files','tir-evidence-files');` | 3 rows |
| 19 | **Auth — sign-up flow** | Fresh email → OTP code → set password → land on `/apply` | full flow completes, chooser visible |
| 20 | **Auth — sign-in via password** | Sign out, sign back in with password | succeeds, lands on `/apply` |
| 21 | **Auth — sign-in via OTP fallback** | Sign out, "email me a code" → enter OTP | succeeds, lands on `/apply` |
| 22 | **TIR submission email** | Submit a test TIR application | confirmation email arrives at applicant inbox within 30 s |
| 23 | **SIP submission email** | Submit a test SIP application | confirmation email arrives at applicant inbox within 30 s; references applicant + app id |
| 24 | Resend dashboard health | Open Resend dashboard | recent deliveries 200/202, no bounces, no spam-folder issues |

If smoke test passes → T+22m.
If smoke test fails → rollback (Section 8).

### T+22m — CloudWatch sanity

```bash
aws logs tail /aws/lambda/artpark-eir-api-production --since 30m --region ap-south-1 \
  | grep -iE 'error|exception|traceback' | head -20

aws cloudwatch describe-alarms --region ap-south-1 \
  --alarm-name-prefix artpark-eir-api-production \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
# expect: ApiErrors / ApiThrottles / ApiP99Duration all OK (or INSUFFICIENT_DATA for brand-new)
```

### T+25m — Cutover declared done

Announce in cutover channel: "Maintenance window complete. `apply.artpark.info` live with SIP chooser. Existing TIR applicants unaffected; new signups can pick either track."

## 7. Post-cutover (Stages D, F)

### Stage D — Verification spot-checks (within 24h)

D.1 **Existing TIR applicant — full continuity + cross-track behavior.** Sign in as a known prod applicant test account. Verify:
- `/apply/submitted` shows their submitted TIR history exactly as before cutover.
- Click any submitted app → all answers + uploaded files still visible.
- If they have an active TIR draft → resume, edit, save → verify changes persist.
- `/apply` chooser now shows BOTH TIR and SIP options.
- Pick SIP from chooser → SIP wizard renders, user can fill and save a SIP draft.
- Try to submit the SIP draft → `409 cross_track_submission_blocked` (because they have submitted TIR apps).
- SIP draft stays saved and viewable after the blocked submit.

D.2 **New signup — draft both, submit one.** Fresh test email → signup → OTP → `/apply` shows chooser → pick TIR → fill some answers → save → return to chooser → pick SIP → fill some answers → save → log out → log back in → BOTH drafts persist and are accessible. Then submit TIR → verify SIP submit is blocked.

D.3 **New signup → SIP-first path with full field coverage.** Another fresh test email → pick SIP → fill EVERY field across all 6 sections of SIP wizard → upload files in every file slot → submit. Verify:
- `sip_applications` row has all wizard fields populated (NULL only for genuinely optional, unfilled fields).
- Files exist in correct buckets (`sip-resumes`, `sip-milestone-files`, `sip-evidence-files`).
- `/apply/submitted` shows the submission.
- The user can still see the TIR wizard from chooser and draft in TIR, but TIR submit is blocked.

D.4 **SIP template upload + parse end-to-end.** Different fresh test email → pick SIP → use the offline template upload feature → upload a filled .docx → verify `sip_application_templates.parse_status='completed'` and parsed answers populate `sip_applications`.

D.5 **Production applicant sample check.** Pull 5 random rows from `tir_applications` that have non-NULL `submitted_at`. Spot-check each one's `evidence_files` JSONB resolves to actual storage objects (signed-URL the path, confirm 200). This catches storage bucket rename issues.

D.6 **Email deliverability check.** In the Resend dashboard, confirm post-cutover submissions (both tracks) hit `200/202` status. Check the artpark.info domain auth state (DKIM/SPF/DMARC) is still green. If any bounces or deferrals appear, investigate before declaring the cutover stable.

D.7 No AI / scoring work in this push. Skip Stage D from the leadership-cutover spec.

### Stage F — 48h monitoring + handover

Hour-1 watch:

```bash
aws logs tail /aws/lambda/artpark-eir-api-production --follow --region ap-south-1
```

Daily for 48h:

| Check | Threshold |
|---|---|
| Lambda Errors | 0 |
| Lambda Throttles | 0 |
| Lambda Duration p99 | < 5 s (alarm fires at 25 s) |
| Sentry error count | flat or declining |

Handover at end of 48h:

1. Update `docs/ARCHITECTURE.md` — dual-track schema is now on prod; leadership push is the next major work.
2. Move Stage A.2 backup tables to an `archive` schema; drop after 30 days. PITR remains as last-resort backup.
3. Open a follow-up plan for the leadership push: it now starts from a clean post-SIP prod state. Migrations 014, 015, 016a, 016b, 017, 018, 018b are next.

## 8. Time budget + rollback

### Time budget

| Step | Optimistic | Realistic worst |
|---|---|---|
| Promote maintenance frontend | 1 min | 2 min |
| Test data purge | 3 min | 5 min |
| Apply 6-7 migrations in sequence | 5 min | 10 min |
| `profiles.track` backfill | 1 min | 2 min |
| Deploy Lambda (SAM build + deploy) | 3 min | 6 min |
| Promote real frontend on Vercel | 1 min | 3 min |
| Smoke test | 4 min | 8 min |
| CloudWatch sanity | 2 min | 3 min |
| **Total** | **20 min** | **39 min** |

Hard rule: if we're not clean by **T+30m**, abort and trigger rollback. Worst-case total downtime including PITR restore is ~90 min.

### Rollback decision tree

```
T=0 ─── T+5m ─── T+13m ─── T+25m ─── T+30m ─── T+45m
  │       │         │         │         │
  │   ZONE A     ZONE B    ZONE C   ABORT      ZONE D
  │   cheap      PITR      PITR+   DEADLINE    post-live
  │   undo                 redeploy            fix-forward
```

**Zone A — before T+5m:** migrations not applied. Promote previous Vercel build. ~5 min.

**Zone B — T+5m to T+13m:** migrations applied, new Lambda not yet deployed. PITR restore to T-1m (~30-60 min), then re-promote previous Vercel build.

**Zone C — T+13m to T+25m:** new Lambda deployed, all migrations applied. PITR restore + redeploy OLD Lambda from `origin/main` worktree + promote previous Vercel build. ~35-65 min.

**Zone D — post T+25m:** site live for users.

| Problem | Action | Downtime |
|---|---|---|
| Frontend bug only | Promote previous Vercel build | < 5 min |
| Backend bug only (no data corruption) | Fix-forward via SAM redeploy | 10 min |
| Data corruption | PITR restore to T+25m; lose post-cutover data | 30-60 min + data loss |
| Subtle / minority bug | Fix-forward (patch + redeploy) | 10 min |

Fix-forward is the default in Zone D; PITR is reserved for genuine corruption.

### Authority

- Cutover lead has authority to declare Zone A/B/C abort.
- No deliberation past T+30m. If stuck at T+30m, lead announces abort, observer starts PITR restore in parallel.
- In Zone D, only the cutover lead decides fix-forward vs PITR.

### What stays safe regardless of rollback

- PITR snapshot from Stage A.2 is the ultimate floor.
- Manual backup tables from Stage A.2 hold pre-cutover state.
- Release branch on GitHub is preserved.
- SAM alarm additions from Stage B survive any DB rollback.

## 9. Open items

- **Cutover timing.** TBD, picked just before launch. Driven by traffic patterns + team availability. Spec is unblocked without this.
- **Cross-track submit-lock implementation in code.** The submit handlers (`POST /applications/me/submit` and the SIP equivalent) must do a cross-track existence check before allowing submission:
  ```sql
  SELECT EXISTS(SELECT 1 FROM <other_track>_applications WHERE user_id=:uid AND status != 'draft')
  ```
  If true → return HTTP 409 with code `cross_track_submission_blocked`. Verify in Stage A.8: this check may or may not exist on the `staging` branch already — read the submit handlers (`applications.py`, `sip_applications.py`) and confirm. If missing, add it to `release/sip-launch-v1` as a small targeted change.
- **SIP RLS vs. multi-track draft tension.** Migration 011 documents that SIP RLS policies gate access on `profiles.track='sip'`. This conflicts with "draft both tracks" — a user with `profiles.track='tir'` who tries to write to `sip_applications` would be blocked by RLS. Resolution options (decide in implementation plan):
  - (a) Frontend updates `profiles.track` whenever the user switches wizards (chooser pick → PATCH /me track=...). Simple but fragile if a request fires before the PATCH lands.
  - (b) Drop the `profiles.track='sip'` gate in SIP RLS, leave only the ownership check. Simpler runtime, removes a defense-in-depth layer.
  - (c) Inspect what staging actually does — if staging's SIP wizard works for users whose track was set to TIR, then (a) is already implemented somewhere. Confirm before deciding.
- **Verify migration 010's `handle_new_user()` trigger updates `profiles.track`.** Migration 010 says it updates the trigger to populate `track` from auth signup metadata. Confirm this doesn't accidentally LOCK a new user to a track (it shouldn't — `track` is UX state, not a submit lock).
- **Real-time cutover risk.** Site is currently in production with applicants submitting. Risk mitigation:
  - Pre-cutover: identify any drafts being edited in the last 10 min; expect some lost work in that window.
  - During cutover: maintenance frontend serves a clear "Back at HH:MM" page; no API calls reach the backend from applicants.
  - Post-cutover: applicants with sessions that survived the window may see a transient 401 on their next API call (token still valid, but the backend is new); the frontend's existing single-flight refresh-on-401 logic handles this. No user-visible failure expected.
- **Migration 019 drift verification.** Stage A.3 requires confirming whether `019_mandatory_profile_links_prod.sql` has actually been applied to prod (commit `1d3a642` claims it has). The SQL check:
  ```sql
  SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles'
    AND column_name IN ('linkedin_url','github_url','resume_url');
  ```
  If the columns exist with the expected NOT NULL constraints, skip 019 in Stage C.4. Otherwise apply.
- **Auto-assign applicant role on signup.** The commit `6ca3be5` on staging suggests this was attempted but the migration file isn't present in the current tree. The gap stays unfixed in this push; it's moot anyway because the `user_roles` table doesn't exist on prod until the leadership push.
- **Cherry-pick verification.** Four main-only commits (`28842fc` autosave-on-signout, `a118078` draft-fallback guard, `2d9cc68` SIP countdown bump, `888a2b0` TIR deadline bump) are confirmed not present on `origin/staging` as of design time. Cherry-pick is expected to apply cleanly unless the underlying files have diverged. If conflicts arise, resolve in favor of the cherry-picked change (these are small surgical fixes).

## 10. References

- Source code: branch `staging` (verify HEAD before Stage A.5).
- Related specs in this repo:
  - `2026-05-13-admin-platform-design.md` — original Phase 1 admin platform spec (informs the *next* push, not this one).
  - `2026-05-18-prod-to-staging-data-import-design.md` — pattern for service-role-keyed scripts (referenced in Stage A.5 if any new scripts are needed).
- Production stack inventory: AWS account `348287123004`, region `ap-south-1`, stack `artpark-eir-api-production`, Supabase project `xtmszlpwgbyoumalgbhs`, frontend `apply.artpark.info`, API `api.artpark.info`.
- Auto-memory references that inform this design:
  - `[[feedback_sam_deploy_requires_worktree]]` — deploy from the worktree on the intended branch.
  - `[[feedback_sam_cors_frontendorigin_bug]]` — SAM CORS multi-origin workaround; this push reverts to single-origin literal for prod.
  - `[[project_sip_template_upload_shipped]]` — context for migration 020 (SIP application templates).
  - `[[project_long_text_cap_5000]]` — existing Pydantic cap, not changed by this push.

---

## Decision log (this design)

| Decision | Choice |
|---|---|
| Order of pushes | SIP first, leadership next |
| Cutover style | Maintenance window (~20-40 min) |
| Source branch | `staging` |
| Existing applicants' `profiles.track` | Backfill to `'tir'` explicitly |
| Multi-track per user | View + draft BOTH tracks allowed; submit locked to FIRST-submitted track only (cross-track submit returns 409). Multiple submissions allowed within the locked track. |
| Auth flow | Same OTP + password flow for both tracks. No track-specific signin/signup. Chooser appears post-signin on `/apply`. |
| Submission confirmation email | Sent for both TIR and SIP submissions (shared `submission_confirmation` template via shared `_send_submission_email` helper, present on staging). |
| SIP visibility at cutover | Live immediately (no feature flag) |
| AI scoring | Not in this push |
| Leadership user creation | Not in this push |
| DB-level role lockdown | Not in this push (no `user_roles` table yet) |
| Migration 019 | Verify drift in Stage A.3; apply only if missing |
| Migration 021 | Include in this push |
| Test data purge | Yes, in Stage C.3 |
| Pre-cutover dry-run | Yes, full, on PITR-restored snapshot |
| Comms to draft applicants | None — maintenance page is the comms |
| Termination protection on prod stack | Enable in Stage B.1 |
| API health alarms | Add in Stage B.2 (Errors / Throttles / p99 Duration) |
