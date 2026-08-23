# Demo environment — masked staging cohort for product-manager onboarding

**Date:** 2026-08-23
**Branch:** `feat/demo-environment`
**Worktree:** `.claude/worktrees/demo-environment`
**Base:** `release/sip-launch-v1` @ `a8c00f2`
**Target environment:** existing **staging** (Supabase `exqmxvdtcsvpgtftwjml`, Lambda `artpark-eir-api-staging`, Vercel `ap-os-git-staging-artpark.vercel.app`)

---

## 1. Why

New product managers need to understand what the platform does without being
given production access. Today there is no environment that serves this:

- **Production** is off-limits by definition — that is the whole premise.
- **Staging holds 283 real applications** copied from production: real founder
  names, real Gmail and university addresses, real pitch content. Handing out
  staging credentials would disclose exactly the data being withheld.
- **Staging is also not demonstrable.** Of its 283 TIR applications, 214 are
  drafts the admin portal never renders. It has **1 review, 0 batches,
  0 admin decisions, 0 jury selections**. Gate 1, Final Gate, the Accepted tab
  and most leadership charts would render empty.
- **The `dev` Supabase project no longer resolves** (DNS failure), so it is not
  a fallback.
- **The live staging site is 181 commits behind** `release/sip-launch-v1`, so it
  serves a build from before the single-mode admin navigation, the Accepted-tab
  decision states and the sequence-aware detail view.

So the work is not "copy some applications". It is: remove the personal data,
manufacture the downstream state that makes each screen show something, and
bring the deployment current.

## 2. Decisions taken

Confirmed with the user before design:

1. **Home:** the existing staging environment. No new Supabase, Lambda or Vercel
   project.
2. **Identities:** masked. Founder name, email, phone and organisation are
   replaced with synthetic values. All application *content* — long-form
   answers, AI scores, industry, dates, file references — is preserved, so the
   demo reads like the real product.
3. **Surplus records:** mask **every** applicant record, not only the twelve in
   the demo. Masking a subset leaves a gap to miss. The other ~271 rows stay in
   place as harmless background volume; nothing is deleted.
4. **Access:** **one** account holding `admin` + `leadership` + `reviewer`,
   switching portals via the built-in portal switcher.

## 3. Non-goals

- **Production is never touched.** Every operation in this spec runs against the
  staging Supabase project. No prod credential is read.
- **No new schema.** Staging already carries migrations through 045.
- **The applicant wizard is out of scope.** The audience is PMs learning the
  staff-facing portals; `/apply` is reachable but not part of the tour.
- **The jury portal is out of scope.** Its admin surfaces were unwired in
  `feat/admin-ui-consistency`; jury data is seeded only where leadership or the
  Accepted tab reads it.

---

## 4. Environment and deployment

Three things must line up before the demo is usable.

**4.1 Frontend.** `origin/staging` is 181 commits behind and **0 commits ahead**
of `release/sip-launch-v1`, so it fast-forwards cleanly. Pushing the release tip
to `staging` makes Vercel rebuild `ap-os-git-staging-artpark.vercel.app`
automatically.

**4.2 Backend.** The staging Lambda must be redeployed from the same commit.
A current frontend against a 181-commit-old API is the failure mode this step
exists to prevent. Deploy via `infra/sam/deploy-staging.sh`.

**4.3 Intake flags.** `deploy-staging.sh` reads `backend/.env.staging`.
`TIR_SUBMISSIONS_CLOSED` / `SIP_SUBMISSIONS_CLOSED` must be checked before the
deploy — the deploy scripts default them to `false`, and staging should mirror
production's closed intake so the demo does not misrepresent the current state.

**Both 4.1 and 4.2 are outward-facing actions and are confirmed with the user
before running.** They are also the two steps that can break the environment for
the in-progress VIP work, which uses the same staging stack.

**4.4 The staging migration gap — RESOLVED 2026-08-23.**

> **Status: closed.** All nine missing migrations were applied to staging via
> `backend/migrations/DEMO_STAGING_APPLY_V2.sql` and verified: `ic_documents`,
> `academic_profiles`, `jury_responses`, `mentor_invites`, `mentor_responses`,
> `profile_completion_tokens` and `batch_reviewers` all exist; the six missing
> columns and the `comms` category row are present. The record below is kept
> because the *method* was wrong the first time and that is worth not
> repeating.

The gap as originally found:

Staging's migration history is patchy. Six tables the current code references do
not exist there, verified by querying every table in the schema:

| Missing table | Migration | Consequence for this demo |
|---|---|---|
| `ic_documents` | 037 | **Blocking.** The Accepted tab calls `/admin/platform/ic-documents` on mount. Without the table that endpoint 500s and the whole tab fails to load — and this is the tab whose green/red decision states are the newest work. |
| `batch_reviewers` | 034 | **Blocking.** `batch_membership.py` backs the admin batch endpoints; batch assignment is on the demo list (§6.2). |
| `profile_completion_tokens` | 030 | Non-blocking. `/admin/profile-completion/send` 500s if a PM clicks it. |
| `mentor_invites` | 029 | Non-blocking. Mentor invite flow 500s if reached. |
| `academic_profiles` | 038 | Not needed — the Academic Jury Roster was unwired from navigation. |
| `jury_responses` | 039 | Not needed — jury invite responses are out of scope. |

Staging *does* have 040–042 (founder portal) and the VIP tables from 043–045, so
this is a gap in the middle of the sequence, not a stale environment overall.

**Staging DDL is Studio-only, exactly like production.** Verified: no DB
password or DSN in `backend/.env.staging`, no `exec_sql` RPC (404), no Supabase
CLI and no `psql` on this machine. So these migrations must be pasted into the
staging project's SQL editor by a human.

The implementation produces `backend/migrations/DEMO_STAGING_APPLY.sql` — a
single concatenation of migrations 029, 030, 034, 037, 038 and 039, each guarded
with `if not exists` so a partially-applied state heals rather than errors. All
six are applied, not just the two blocking ones: a demo where a PM clicks
something and receives a 500 teaches them the product is broken.

**This step gates everything downstream.** Redeploying the staging API (§4.2)
before the migrations are applied makes the situation worse, not better — the
current code references these tables, so more endpoints fail, not fewer. Order
is: migrations → API deploy → frontend fast-forward → seed.

## 5. Masking

A new script, `backend/scripts/mask_staging_identities.py`.

**5.1 Surface.** Verified by reading the live staging schema, not assumed:

| Table | Columns overwritten |
|---|---|
| `tir_applications` | `basic_full_name`, `basic_email`, `basic_phone`, `basic_org`, `basic_teammates`, `linkedin_url`, `github_url`, `evidence_video_url` |
| `sip_applications` | `basic_full_name`, `basic_email`, `basic_phone`, `basic_org`, `basic_teammates`, `sip_demo_video_url` |
| `profiles` | `full_name`, `email`, `phone`, `linkedin_url` |

`profiles` is included because `/admin/users` and the reviewer roster read
their displayed names and emails from it — masking only the application tables
would leave real identities visible on the Roles and Reviewers screens.

**5.2 Determinism.** Masking is a pure function of the original value:
`fake_name = NAMES[sha256(original) % len(NAMES)]`. The same real person maps to
the same synthetic person in every table and on every run. This makes the script
idempotent and keeps an applicant's name consistent between their application
row and their profile row.

**5.3 Preserved.** Every other column: all long-form answers, `status`,
`ai_screening` scores and section text, industry, `submitted_at`, file
references, `moved_to_track`. The demo must read like real applications.

**5.4 Staff accounts are exempt.** Any profile whose email ends in
`@artpark.in`, `@artpark.info` or `@artpark.test` is skipped — masking
`dev@artpark.in` or the VIP QA founder would break the logins staging depends
on. The exemption list is explicit in the script, not inferred.

**5.5 Residual risk, stated plainly.** `auth.users.email` still holds real
addresses. Nothing in the three portals renders it — every user-facing screen
reads `profiles` — so it is not exposed to a PM through the UI. Changing it
would break those accounts' ability to sign in, which is a worse trade for no
UI-visible gain. This is a deliberate limit of the masking, recorded here so
nobody later mistakes it for an oversight.

**5.6 Safety.** `--dry-run` is the default posture: the script prints a
per-table count of what it *would* change and a sample of before/after pairs,
and writes nothing unless `--apply` is passed. It refuses to run if
`SUPABASE_URL` does not match the known staging project id, so a mis-sourced
env file cannot point it at production.

**5.7 Irreversibility.** Masking cannot be undone without re-importing from
production. Production is unaffected. This is accepted.

## 6. The demo cohort

A new script, `backend/scripts/seed_demo_cohort.py`, idempotent, `--dry-run`
by default, with the same staging-project guard as §5.6.

**6.1 Twelve applications.** Existing non-draft staging rows are selected and
driven into these states. Each row is tagged in `application_admin_meta` with a
`demo_seq` marker so re-runs pick the same twelve.

| # | Track | Status | What it makes visible |
|---|---|---|---|
| 1 | TIR | `submitted` | fresh intake, no reviewers yet |
| 2 | TIR | `under_review` | assigned, 0 of 3 reviews submitted |
| 3 | TIR | `under_review` | 2 of 3 submitted, split recommendation → RECO "maybe" |
| 4 | TIR | `evaluated` | 3 of 3, ≥2 yes → RECO "yes", Gate-1 queue |
| 5 | TIR | `evaluated` | 3 of 3, ≥2 no → RECO "no" |
| 6 | TIR | `on_hold` | a Gate-1 hold decision with rationale |
| 7 | TIR | `jury_review` | Accepted tab, no memo → PENDING chip |
| 8 | TIR | `jury_review` | memo uploaded **and signed** → green ACCEPTED row |
| 9 | TIR | `rejected` | gate-2 rejection → red REJECTED row on the Accepted tab |
| 10 | TIR | `offered` | Final Gate issued an offer |
| 11 | VIP | `jury_review` | VIP track chip on the shared Accepted tab |
| 12 | TIR→VIP | `jury_review` | `moved_to_track` set → effective-track badge |

Row 9 is the one that proves the work shipped in `feat/admin-ui-consistency`:
before that change a gate-2 rejection vanished from the tab.

**6.2 Supporting state.** Without these the twelve rows render but the screens
around them stay empty:

- **Reviewer roster:** three reviewer accounts plus the demo account, with
  `reviewer_profiles` rows so the Reviewers screen shows names and load.
- **`reviewer_assignments`:** spread across rows 2–5, including assignments to
  the demo account itself so the Reviewer portal is not empty (§7.2).
- **`reviews`:** submitted rows carrying scores and a `recommendation` of
  `yes` / `maybe` / `no`, chosen so the aggregate verdict rule
  (≥2 submitted; ≥2 yes and <2 no → yes) produces one of each verdict.
- **Two `batches`** with `batch_reviewers`, so batch assignment and the batch
  column are demonstrable.
- **`admin_decisions`:** gate-1 rows for #4/#5/#6, gate-2 rows for #9/#10.
- **`ai_screening`:** rows for all twelve with an overall score, component
  scores and the four section blocks, so the AI panels are populated.
- **`ic_documents`:** an uploaded row for #8 marked signed; #7 left absent.
  Depends on migration 037 landing first (§4.4); if it has not, rows #7 and #8
  still render but without memo state, and the seed says so rather than
  failing silently.
- **`jury_assignments` + `jury_selections`** for #7–#12, so the leadership
  jury-derived columns are not blank.

**6.3 What is not fabricated.** AMENDED 2026-08-24: this section originally
said no files are uploaded to storage, on the reasoning that a missing object
shows an honest "file unavailable" state. That was wrong for this audience — a
product manager who clicks the one document in the tour and gets a 404 learns
the product is broken. The seed now uploads a minimal, genuinely valid PDF
whose visible text reads "ARTPARK demo environment / Placeholder IC memo — NOT
a real document", built in pure stdlib with no new dependency, uploaded only
under `--apply` and idempotent on re-run.

The distinction this section was actually protecting still holds: nothing
fabricates content that could be mistaken for a real Investment Committee
memo. A clearly-labelled placeholder is not fabrication. The existing
evidence-file references on the source rows are still left exactly as they
are.

## 7. The demo account

**7.1 Identity.** One account, roles `admin` + `leadership` + `reviewer`.
`landingPathFor` sends it to `/leadership`; `PortalSwitcher` — which renders in
all four portals and filters by roles held — offers Leadership, Reviewer and
Admin. Verified against `frontend/src/lib/landing.js` and
`frontend/src/components/PortalSwitcher.jsx` before this design was written.

**7.2 The reviewer trap.** `reviewer_query.fetch_inbox` scopes the queue to
`reviewer_user_id == caller`. An account with the `reviewer` role but no
assignments sees an empty portal and reads as broken. The seed therefore gives
the demo account its own assignments: some with a submitted review (so History
is populated) and some pending (so the Queue and the eval screen are
reachable).

**7.3 Credentials are never committed.** `dayan02dev/AP_os` is a **public**
repository. No password, service key or token appears in any committed file.
The seed script prints the email and password to stdout at the end of a
successful `--apply` run; the handout in §8 names the account and tells the
reader where to get the password, without containing it.

## 8. The handout

`docs/DEMO_ENVIRONMENT.md`, committed:

- what the environment is, and an explicit statement that the data is masked and
  the environment is disposable
- the URL and the account email (no password — see §7.3)
- a ten-minute tour: what to open in each of the three portals, and what the
  reader is looking at on each screen
- a short "what this does not show" section — the applicant wizard, the jury
  portal, and the VIP onboarding surfaces still in progress — so a PM does not
  conclude the product lacks them

## 9. Verification

1. `--dry-run` output of both scripts reviewed before any write.
2. After masking: re-query a sample across all three tables and confirm zero
   real-looking domains remain outside the staff exemption list.
3. After seeding: confirm each of the twelve rows reports its intended status
   and that `reco_verdict` returns one `yes`, one `no` and one `maybe`.
4. Sign in as the demo account and reach all three portals through the switcher.
5. Confirm the VIP QA founder `claude-test-applicant-sip@artpark.in` still
   signs in and still shows `onboarded` — the in-progress VIP branch depends on
   it.
6. Confirm production is untouched: no prod credential was sourced in any step.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Masking is irreversible | Accepted; staging is a copy, production is untouched |
| A mis-sourced env file points a script at production | Both scripts hard-refuse unless `SUPABASE_URL` matches the staging project id |
| Redeploying staging breaks in-progress VIP QA | Deploy steps confirmed with the user first; VIP founder verified afterwards (§9.5) |
| Intake flags default to `false` on deploy | Checked explicitly before deploying (§4.3) |
| A future prod→staging import re-contaminates | The masking script is idempotent and re-runnable; noted in the handout |


## 11. Post-hoc note — how the gap analysis was wrong (2026-08-23)

The first apply file failed in Studio with `42703: column "moved_to_track" does
not exist`. Two errors, both mine:

1. **The probe only looked for missing TABLES.** Four of the missing migrations
   add COLUMNS to existing tables — 025, 028, 031 and 036 — so a
   table-existence check could not see them. `moved_to_track` (036) is the one
   that surfaced, because migration 037's verification block reads it.
2. **The file used the `_PROD_APPLY` variants of 037 and 038.** Those carry
   diagnostic `SELECT`s intended for verifying a production run. They are
   scaffolding, not schema, and they reference columns from *other* migrations.
   The plain migrations carry the identical DDL — table, indexes, RLS policy,
   storage bucket — with none of that coupling.

The corrected file used the plain migrations in dependency order. The general
lesson: when checking whether a migration is applied, check what it *adds* —
tables, columns, constraints and seed rows — not just whether a table exists.
