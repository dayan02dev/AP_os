# Reviewer Portal Rewire — Design Plan

**Branch:** `work/reviewer-integration`  
**Authors:** Discovery phase (Claude Sonnet 4.6 + Dayan)  
**Status:** Approved for Phase 2 implementation

---

## 1. Executive Summary

The production app (`release/sip-launch-v1 → work/reviewer-integration`) already has a
fully-wired reviewer backend (`backend/app/routers/reviewer.py`) and a working but
minimal frontend (`frontend/src/pages/reviewer/`). The REVIEWER-UI prototype
(`os/reviewer.jsx`) is pixel-complete but runs against mock data.

The rewire strategy is **additive, not replacement**: we add a new Vite-compiled route
subtree at `/reviewer-v2/*` that ports the prototype's superior UX (rich Dashboard,
filterable Queue table, full FullApplicationView, History, Rubric page) and wires each
screen to the real `reviewerApi.js` client — **without touching** the existing
`/reviewer/inbox`, `/reviewer/completed`, or `ReviewerScoringPage` (they stay as-is
as a fallback). Once the new subtree is signed off, Phase 5 flips the default route.
The post-login redirect in `frontend/src/lib/landing.js` needs a one-line change to
point the `reviewer` role at the new entry point.

---

## 2. Screen-by-Screen Comparison

| Prototype screen | Existing page (path) | Status | Notes |
|---|---|---|---|
| `ReviewerDashboard` (tab: Dashboard) | _(none)_ | **New** | Stat tiles, queue pipeline bars, AI histogram, industry breakdown — all derived from `getQueue()`. No backend changes needed; data is a projection of the assignment list. |
| `ReviewerQueue` (tab: My Queue) | `ReviewerInboxPage` (`/reviewer/inbox`) | **Redesigned** | Prototype has a rich filterable table (search, track, status, stage, industry); production has simple `AssignmentCard` list. The prototype's approach is strictly better. |
| `ReviewerEval` / `ReviewerEvalForm` (tab: Active Evaluation) | `ReviewerScoringPage` (`/reviewer/:track/:id/score`) | **Redesigned** | Prototype has 2-column layout with AI summary + FullApplicationView toggle + Slider inputs + rubric modal. Production has a sidebar panel + `ApplicationTab`. Core logic (load/draft/submit) is the same; UX diverges significantly. |
| `FullApplicationView` (sub-screen within Eval) | `ApplicationTab` + `review/` subdirectory | **Redesigned** | Prototype shows a recreation of the applicant wizard sections. Production renders question blocks from `applicationSchemas.js`. Both are valid; prototype's version reads better for reviewers. |
| `ReviewerHistory` (tab: My History) | `ReviewerCompletedPage` (`/reviewer/completed`) | **Redesigned** | Prototype has score columns, reco chips, admin decision column, and allows re-opening a past evaluation. Production is a locked read-only table. |
| `ReviewerRubric` + `RubricInline` (tab: R-4 Rubric) | _(none)_ | **New** | Dedicated rubric page with Download button. Production has no equivalent. |
| `RubricModal` (overlay within Eval) | _(none)_ | **New** | Modal overlay accessible from the scoring form. |
| `ReviewerTopbar` | `ReviewerAppShell` header | **Redesigned** | Prototype has role-switcher dropdown, home button, live pill breadcrumb. Production has separate header + rail nav. Prototype layout is more compact. |
| `ReviewerTabBar` | Left rail in `ReviewerAppShell` | **Redesigned** | Prototype uses horizontal tab bar; production uses left rail. Prototype is closer to the LP design language. |
| `ReviewerCohortHeader` | _(none)_ | **New** | Cohort name + "applications closed" dateline + Export CSV button. |

---

## 3. API Mapping Table

| Prototype method | Real endpoint | Response shape diff | Action |
|---|---|---|---|
| `getMe()` | `GET /auth/me` | Real returns `{ id, email, full_name, roles[], active_role }`. Prototype expects `{ id, name, email, initials, cohort, domains[] }`. | **Client adapter**: derive `initials` from `full_name || email`, `cohort` from a constant or a future field, `domains` from a future profile field. 3-line shim. |
| `getQueue()` | `GET /reviewer/assignments` | Real returns `{ assignments: [{ assignment_id, application_id, application_track, app_identifier, industry, problem_one_liner, assigned_at, assigned_by_display, my_review }] }`. Prototype expects `{ id, applicationId, name, founders[], domain, industry, stage, track, due, ai:{}, reviewStatus }`. | **Client adapter**: map `app_identifier → applicationId`, `industry → domain`, derive `reviewStatus` from `my_review`. Fields `name`, `founders`, `stage`, `ai` are **not returned** by the inbox endpoint. See §4 for the two options. |
| `getEvalScreen(idx, source)` | `GET /reviewer/applications/{track}/{id}` + `GET /reviewer/reviews/mine?application_id={id}` | Real bundles `{ application, assignment, my_review, ai_screening }`. Prototype bundles `{ application, evaluation }`. Prototype's `evaluation` is a superset of the real `review` row. | **Client adapter**: parallel-fetch both endpoints, merge. The real `application` row is the raw DB row (Pydantic passthrough) — it won't have `detail` / `fields` / `aiSummary` pre-shaped. See §4 for the shaping adapter. |
| `getEvaluation(appId, source)` | `GET /reviewer/reviews/mine?application_id={id}` | Same shape difference as above. | **Client adapter**: trivial — reshape one `review` row to `Evaluation`. |
| `saveEvaluation(appId, draft, source)` | `PATCH /reviewer/reviews/{review_id}` (if review exists) OR `POST /reviewer/reviews` with `draft:true` | Real needs `assignment_id` + `application_track` on POST. Real field names differ (`score_commitment` not `commit`, `strengths`/`concerns` not `notes`/`disagreements`). | **Client adapter**: map fields, add required context fields from loaded state. |
| `submitEvaluation(appId, body, source)` | `POST /reviewer/reviews` with `draft:false`, or `PATCH` with `draft:false` | Same as above. Validation is server-enforced (all 5 scores + recommendation required). | **Client adapter**: same as saveEvaluation but `draft: false`. |
| `getHistory()` | `GET /reviewer/reviews?mine=true&locked=true` | Real returns `{ reviews: [{ review_id, application_id, application_track, app_identifier, problem_one_liner, score_overall_mine, recommendation, submitted_at }] }`. Prototype expects `{ stats, rows:[{appId, name, date, aiScore, myScore, variance, reco, adminDec}] }`. | **Client adapter**: reshape rows; `aiScore` and `adminDec` are **not** in the real response yet (see missing endpoints below). `stats` (34/92%/0.4/18m) will need a new endpoint or be dropped from the UI in Phase 2. |
| `signOut()` | `POST /auth/logout` (via `useAuth().logout`) | Stub → real logout already wired in `ReviewerAppShell`. | **Direct**: call `logout()` from `useAuth`. |
| _(no equivalent)_ | `POST /reviewer/assignments/{id}/decline` | New in production, not in prototype. | **New UI affordance** (already in `ReviewerInboxPage`; carry to the new queue screen). |

**Verdict: ZERO new backend endpoints needed for the core screens.** Two real response fields (`aiScore` on history rows, `stats` aggregate) are not returned by existing endpoints and will be stubbed with `—` / hidden in the Phase 2 UI. A future Phase can add `GET /reviewer/history/stats` if the product needs it.

---

## 4. Data Shape Diffs

### Diff 1: Queue items missing `name`, `founders`, `stage`, `ai`

The real inbox endpoint (`fetch_inbox` in `reviewer_query.py`) returns only
`app_identifier`, `industry`, and `problem_one_liner` from the application row — it
does not hydrate `project_name`, `founders`, `stage`, or AI scores. The prototype
queue table shows all of these.

**Option A — Back-end add (preferred for long-term):** The inbox query already does
a per-assignment `SELECT *` from `tir_applications` / `sip_applications`; adding
`answers->>'project_name'` and joining `ai_screening` on the same query costs one
extra column and one LEFT JOIN. This is the cleanest fix.

**Option B — Front-end fetch (Phase 2 workaround):** For each assignment, lazy-fetch
`GET /reviewer/applications/{track}/{id}` on hover/expand. Expensive for 8+ items.

**Pseudo-code for the adapter (Option B fallback):**
```
for each assignment in listAssignments().assignments:
  detail = await getApplication(assignment.application_track, assignment.application_id)
  assignment.name    = detail.application.answers?.project_name || assignment.app_identifier
  assignment.founders = detail.application.answers?.team_members || []
  assignment.ai      = detail.ai_screening || null
```

### Diff 2: Evaluation field names don't match

Prototype payload keys: `{ scores: {problem, solution, tech, founders, commit}, recommendation, notes, flags, disagreements }`  
Real DB columns: `score_problem, score_solution, score_tech, score_founders, score_commitment, recommendation, strengths, concerns, quick_notes`

**Adapter pseudo-code:**
```
function protoToReal(ev):
  return {
    score_problem:    ev.scores.problem,
    score_solution:   ev.scores.solution,
    score_tech:       ev.scores.tech,
    score_founders:   ev.scores.founders,
    score_commitment: ev.scores.commit,
    recommendation:   ev.recommendation,
    strengths:        ev.notes || '',        // closest semantic match
    concerns:         ev.flags.join('; '),   // flags → concerns
    quick_notes:      '',
    draft:            ev.status !== 'submitted',
  }

function realToProto(review):
  return {
    appId:  review.application_id,
    status: review.submitted_at ? 'submitted' : (review.score_problem != null ? 'draft' : 'not-started'),
    scores: { problem: review.score_problem, solution: review.score_solution,
              tech: review.score_tech, founders: review.score_founders,
              commit: review.score_commitment },
    recommendation: review.recommendation,
    notes: review.strengths || '',
    flags: review.concerns ? review.concerns.split('; ') : [],
    disagreements: {},
    updatedAt:   review.updated_at,
    submittedAt: review.submitted_at,
    editWindowExpiresAt: review.locked_at,
  }
```

### Diff 3: Application content shape — raw DB vs shaped `APP_DETAIL`

The real `GET /reviewer/applications/{track}/{id}` returns the raw `tir_applications`
row, which has a flat `answers: {}` JSONB column. The prototype's `FullApplicationView`
expects `{ aiSummary, fields: [{label, value, bullets}], sections: [{num, title, questions}] }`.

**Adapter pseudo-code:**
```
function rawAppToProtoDetail(app, aiScreening):
  answers = app.answers || {}
  return {
    aiSummary: aiScreening?.summary || 'AI summary not yet available.',
    fields: [
      { label: 'Problem defined',      value: answers.problem_defined || '—', short: true },
      { label: 'Problem description',  value: answers.problem || '',  bullets: null },
      { label: 'Solution stage',       value: answers.solution_stage || '—', short: true },
      { label: 'Solution description', value: answers.solution || '', bullets: null },
      { label: 'Core technology',      value: answers.core_tech || '',bullets: null },
    ],
    sections: [/* reconstruct from answers keys — see applicationSchemas.js for the mapping */]
  }
```
The `applicationSchemas.js` file in `frontend/src/pages/reviewer/review/` already maps
DB `answers` keys to question prompts for `ApplicationTab` — reuse that mapping rather
than duplicating it.

---

## 5. Post-Login Routing — Current State and Proposed Change

**Current state:**  
File: `frontend/src/lib/landing.js`, lines 12–20.

```js
export function landingPathFor(roles) {
  const r = Array.isArray(roles) ? roles : [];
  if (r.includes("leadership")) return "/leadership";
  if (r.includes("admin")) return "/admin";
  if (r.includes("reviewer")) return "/reviewer/inbox";   // ← line 16
  return "/apply";
}
```

Also referenced at:
- `frontend/src/pages/SignInPage.jsx` line 62 — calls `landingPathFor(roles)` on password sign-in
- `frontend/src/router.jsx` line 120 — `ApplyRoleGate` calls `landingPathFor(roles)` to bounce non-applicants  
- `frontend/src/pages/VerifyPage.jsx` (OTP verify) — also calls `landingPathFor` (same import)

**Proposed change (pseudo-code, no actual edit yet):**

```diff
- if (r.includes("reviewer")) return "/reviewer/inbox";
+ if (r.includes("reviewer")) return "/reviewer-v2/inbox";
```

One line change in one file. All three call-sites pick it up automatically.
Additionally, the router needs a new `<Route path="/reviewer-v2/*">` subtree pointing
at the new shell + pages. The old `/reviewer/*` routes stay registered so any
bookmarked links still work.

---

## 6. Migration Draft — Grant Reviewer Role to 3 Emails

The `user_roles` table (migration 014) uses `user_id` (UUID from `auth.users`).
The lookup sub-select joins through `auth.users` by email.

```sql
-- Grant 'reviewer' role to three ARTPARK users.
-- Idempotent: INSERT … ON CONFLICT DO NOTHING.
-- Run against the target Supabase project with the service-role key.

do $$
declare
  v_uid uuid;
  v_emails text[] := array[
    'udayan.pawar@artpark.in',
    'sanjay.haritwal@artpark.in',
    'dev@artpark.in'
  ];
  v_email text;
begin
  foreach v_email in array v_emails loop
    -- Resolve auth.users id for this email.
    select id into v_uid
      from auth.users
     where email = v_email
     limit 1;

    if v_uid is null then
      raise notice 'User not found: %, skipping', v_email;
      continue;
    end if;

    insert into public.user_roles (user_id, role, granted_by, granted_at)
    values (v_uid, 'reviewer', null, now())
    on conflict (user_id, role) do nothing;

    raise notice 'Granted reviewer to % (%)', v_email, v_uid;
  end loop;
end $$;
```

> Note: `granted_by` is set to `null` because this is an admin bootstrap operation
> with no grantor user in the DB. If you want an audit trail, replace `null` with the
> UUID of the admin user running the migration.

---

## 7. Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Inbox data missing `name`/`founders`/`ai`** — `fetch_inbox` doesn't return them; the Queue table will show `—` for project name and no AI scores column. | High | High | Implement Option A (backend add) in Phase 3 as a targeted change to `reviewer_query.py:fetch_inbox`. Phase 2 shows `app_identifier` as the project name (acceptable for internal use). |
| **History `aiScore` / `adminDec` not in API** — `fetch_completed_reviews` returns `score_overall_mine` and `recommendation` but not AI score or leadership decision. `ReviewerHistory` will show `—` in those columns. | High | Med | In Phase 2, drop the AI score and admin decision columns from the History table. Add a `GET /reviewer/history/stats` endpoint in Phase 4 if the stats tiles are needed. |
| **`FullApplicationView` shows raw `answers` JSONB as-is** — the adapter in §4/Diff 3 must correctly map answer keys. If `answers` schema differs between TIR and SIP the view will have gaps. | Med | Med | Reuse `applicationSchemas.js` which already defines the canonical question maps for both tracks. Run against a real staging application before shipping. |
| **CSS token collision** — `os/styles.css` (1260 lines) uses some of the same token names as `frontend/src/styles/reviewer.css` (106 lines) and `leadership.css`. Importing both will produce conflicts. | Med | High | Scope all `os/styles.css` tokens under a `.rv2-` prefix before importing. Alternatively, rename the new shell's root element to `.rv2-shell` and scope with CSS nesting. Do not import `os/styles.css` globally. |
| **3 emails not in `auth.users`** — if `udayan.pawar@artpark.in`, `sanjay.haritwal@artpark.in`, or `dev@artpark.in` don't have Supabase Auth accounts yet, the migration silently skips them. | Low | Med | The migration raises a `NOTICE` for each skipped email. Confirm all three have accounts in the target Supabase project before running. If not, create accounts first via the Admin API or the admin platform. |

---

## 8. Phasing for Phases 2–5

### Phase 2 — New route subtree + wired Queue and Dashboard

**Goal:** The three reviewer emails can log in and land on `/reviewer-v2/inbox`,
see their assigned applications, and navigate to an evaluation form.

**Files to CREATE:**
- `frontend/src/pages/reviewer-v2/ReviewerV2Shell.jsx` (~60 lines) — adopts `os/reviewer.jsx`'s `ReviewerTopbar` + tab bar layout, imports from `useAuth`.
- `frontend/src/pages/reviewer-v2/DashboardPage.jsx` (~200 lines) — ports `ReviewerDashboard` from `os/reviewer.jsx`.
- `frontend/src/pages/reviewer-v2/QueuePage.jsx` (~220 lines) — ports `ReviewerQueue`; replaces `API.getQueue()` with `reviewerApi.listAssignments()` + the Diff-1 adapter.
- `frontend/src/pages/reviewer-v2/EvalPage.jsx` (~280 lines) — ports `ReviewerEval` / `ReviewerEvalForm`; wires `reviewerApi.getApplication`, `.getMyReview`, `.submitReview`, `.patchReview`.
- `frontend/src/pages/reviewer-v2/HistoryPage.jsx` (~120 lines) — ports `ReviewerHistory`; wires `reviewerApi.listCompletedReviews`.
- `frontend/src/pages/reviewer-v2/RubricPage.jsx` (~80 lines) — ports `ReviewerRubric` + `RubricInline`.
- `frontend/src/lib/reviewerV2Adapter.js` (~80 lines) — all three adapters from §4.
- `frontend/src/styles/reviewer-v2.css` (~400 lines) — scoped copy of the relevant parts of `os/styles.css` under `.rv2-shell`.

**Files to TOUCH:**
- `frontend/src/router.jsx` — add `<Route path="/reviewer-v2/*">` subtree (~15 lines added).
- `frontend/src/lib/landing.js` — change `"/reviewer/inbox"` → `"/reviewer-v2/inbox"` (1 line).

**Estimated lines added/changed:** ~1,500 lines added, ~3 lines changed.

---

### Phase 3 — Backend inbox hydration + CSS polish

**Goal:** Queue table shows real project names, founder names, and AI scores.

**Files to CREATE:**
- `backend/migrations/022_reviewer_inbox_hydration.sql` (~20 lines) — no schema changes needed; this phase just updates query logic.

**Files to TOUCH:**
- `backend/app/services/reviewer_query.py:fetch_inbox` (~30 lines changed) — add `project_name` from `answers`, join `ai_screening` table, return `ai_scores` object.
- `frontend/src/lib/reviewerV2Adapter.js` — remove the "Option B fallback" per-item fetches if Option A is implemented (~20 lines changed).

**Estimated lines added/changed:** ~50 lines added, ~50 lines changed.

---

### Phase 4 — History stats + weighted overall score + edit-window real timer

**Goal:** History stats tiles show real numbers; overall score uses weighting (22/30/22/14/12); edit window counts from `locked_at` (already in DB).

**Files to CREATE:**
- _(none)_ — stats could be added to an existing endpoint.

**Files to TOUCH:**
- `backend/app/routers/reviewer.py` — extend `GET /reviewer/reviews` response to include aggregate stats (~30 lines).
- `frontend/src/pages/reviewer-v2/EvalPage.jsx` — replace the fake 3240s countdown with `editWindowExpiresAt` from `realToProto` adapter (~10 lines).
- `frontend/src/pages/reviewer-v2/EvalPage.jsx` — replace plain-mean overall with weighted calculation matching `_SCORE_WEIGHTS` in `reviewer_query.py` (~10 lines).
- `frontend/src/pages/reviewer-v2/HistoryPage.jsx` — wire stats tiles (~20 lines changed).

**Estimated lines added/changed:** ~70 lines added, ~40 lines changed.

---

### Phase 5 — Accessibility, validation, cleanup, cutover

**Goal:** Production-ready. Old `/reviewer/*` routes removed or redirected.

**Files to TOUCH:**
- `frontend/src/pages/reviewer-v2/EvalPage.jsx` — add keyboard support to Slider (ARIA `role="slider"`, arrow keys), focus trap in RubricModal, required-field inline errors (~60 lines changed).
- `frontend/src/pages/reviewer-v2/QueuePage.jsx` — keyboard-reachable table rows (either `role="button"` + `onKeyDown`, or make project name a real link) (~20 lines changed).
- `frontend/src/router.jsx` — replace old `/reviewer/*` routes with `<Navigate to="/reviewer-v2/..." replace />` (~10 lines changed).
- `frontend/src/lib/landing.js` — already updated in Phase 2; verify no stale references.
- `os/` directory — mark as archived (do not delete; it's the design reference).

**Estimated lines added/changed:** ~90 lines changed.

---

## 9. Open Questions for the User

1. **Queue table vs. card list:** The prototype uses a table with 8 columns (project,
   founder, industry, stage, AI score, status, due, ID). The existing production inbox
   uses cards. For Phase 2, should I implement the table exactly as prototyped, or do
   you want to keep the card layout for the new portal too?

2. **`FullApplicationView` vs `ApplicationTab`:** The prototype recreates the wizard
   UI inside the eval screen (big section numbers, answer boxes). The production
   `ApplicationTab` is more compact. Should I port the prototype's version (more
   visual fidelity to the applicant's experience) or adapt the production component?

3. **Email addresses for the migration:** Confirm the three email addresses to grant
   the `reviewer` role — currently drafted as `udayan.pawar@artpark.in`,
   `sanjay.haritwal@artpark.in`, `dev@artpark.in`. Are these the correct Supabase
   Auth emails, or are they different from the login emails?

4. **History re-open behaviour:** The prototype allows "Re-open to edit" on a
   submitted history item. The production backend enforces a strict 60-minute
   `locked_at` window with a `423 Locked` response after expiry. Should the new
   portal expose "Re-open" only for items within the edit window (matching the API),
   or omit the button entirely for locked reviews?

5. **Rubric source of truth:** The rubric is currently hardcoded in `os/reviewer.jsx`
   (two copies: `RubricModal` and `downloadRubricMd`). The handoff doc recommends
   a `GET /api/rubric` endpoint. For Phase 2, should I keep it hardcoded (quick) or
   stub a `GET /reviewer/rubric` endpoint that returns the same static JSON (proper)?
