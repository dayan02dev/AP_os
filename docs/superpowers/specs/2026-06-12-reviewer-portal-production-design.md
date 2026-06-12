# Reviewer Portal → Production — Design Spec

**Date:** 2026-06-12
**Branch:** `reviewer_final` (cloned from `release/sip-launch-v1` @ e2c1724)
**Release branch (cut later, push-only):** `release/reviewer-portal-v1`
**Companion index:** `docs/REVIEWER_ADMIN_PRODUCTION_INTEGRATION.md` (full platform survey)
**Status:** Approved design — pending user review of this written spec

---

## 1. Goal & scope

Ship the REVIEWER-UI prototype (branch `REVIEWER-UI`, pixel-complete, zero backend
wiring) to production at `apply.artpark.info/reviewer/*`, backed by real APIs on the
existing FastAPI Lambda and the existing prod Supabase project.

**In scope (Spec 1):**
- Migration 022 (additive only).
- Extend the existing `/reviewer` router: rich queue, application-content presenter,
  history, rubric; extend review submit/patch payloads.
- One leadership endpoint: bulk reviewer-assignment creation (minimal Admin-portal
  slice so queues can be fed without SQL).
- SIP AI scoring: full working pipeline as a track adapter with PROVISIONAL_V0
  prompts/logic (to be rewritten when the SIP rubric is final).
- Fold the prototype UI into the prod Vite SPA, replacing the basic reviewer pages.

**Out of scope (Spec 2, branch `admin_final`):** Admin Portal — batches, Gate 1/Gate 2
decisions, jury, interviews, hide/archive, audit-log reads, roster metrics,
psychometry. Decomposition decided 2026-06-12.

**Decisions locked during brainstorming:**
1. Reviewer-first decomposition; Admin follows the same branch/cutover pattern.
2. **The prototype UIs are the functional source of truth.** Consequences:
   AI scores are visible to reviewers pre-submit (remove the anti-anchoring strip);
   re-open/edit allowed within the edit window only; reviewer notes are
   leadership-visible (Admin UI displays them).
3. SIP AI scoring ships end-to-end now, with prompts/caps marked provisional.
4. Architecture A: extend in place (no /v2 namespace, no separate deploy).
5. No work lands on `release/sip-launch-v1` directly; prod cutover window ≤ 15 min;
   nothing currently in production may be harmed (additive-only changes).

---

## 2. Architecture & data flow

Unchanged substrate: one FastAPI Lambda (`artpark-eir-api-production`), one prod
Supabase (`xtmszlpwgbyoumalgbhs`), one Vite SPA on Vercel, SQS FIFO → AI screener
Lambda.

```
leadership ──POST assign──▶ reviewer_assignments (due_at)
reviewer SPA ──GET /reviewer/queue──▶ assignments ⋈ app summary ⋈ ai_screening ⋈ my review
            ──GET /reviewer/applications/{track}/{id}/content──▶ presenter shape
            ──POST/PATCH /reviewer/reviews──▶ reviews (draft autosave → submit → 60-min lock)
                                   └─ last reviewer submits → status under_review → evaluated
            ──GET /reviewer/history──▶ submitted reviews ⋈ ai ⋈ current app status
applicant submit ──SQS──▶ screener (TIR adapter | NEW SIP adapter) ──▶ ai_screening
```

Status lifecycle, auto-transitions, RBAC capability map, audit writes: all existing
(migrations 014–019, `state_machine.py`, `rbac.py`) and untouched except where listed.

---

## 3. Schema — migration 022 (additive, idempotent)

`backend/migrations/022_reviewer_portal_v2.sql`:

```sql
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE reviews
  ADD CONSTRAINT reviews_flags_cap CHECK (jsonb_array_length(flags) <= 8) NOT VALID;
-- validate after backfill check; entries ≤80 chars enforced app-side

ALTER TABLE reviewer_assignments
  ADD COLUMN IF NOT EXISTS due_at timestamptz;
```

Explicit non-changes:
- `reviews.score_solution` is NOT renamed (asymmetry with
  `ai_screening.score_completeness` is known and intentional — renaming caused the
  2026-05-28 incident class).
- `disagree_with_ai jsonb` and `quick_notes` already exist (migration 016) — wired,
  not migrated.
- No rubric table; rubric v3.1 is a versioned backend constant (table can come with
  the Admin spec).
- RLS: both tables remain service-role-only. No policy changes.

Applied to staging Supabase first; applied to **prod Supabase ahead of the cutover
window** (columns are unused by running code → zero risk).

---

## 4. API contract

All endpoints Bearer-auth + capability-gated (existing `view_assigned_apps` /
`score_app` / `assign_reviewers`). Standard `ApiError` envelope. Rate limits follow
existing per-user patterns (60/min reads, 30/min writes).

### 4.1 `POST /leadership/applications/{track}/{id}/reviewers` — NEW
Capability `assign_reviewers`. Body `{reviewer_user_ids: uuid[], due_at?: iso}`.
Creates `reviewer_assignments` rows (state='pending', assigned_by=caller). Per-id
results: 201-created / 409-exists / 404-user-not-reviewer. Audited to `audit_log_v2`.

### 4.2 `GET /reviewer/queue` — NEW
One canonical record per active assignment (replaces the prototype's
`buildReviewerQueue()` and fixes handoff §4.2's two-data-models conflict):

```json
[{
  "id": "<application_id>", "applicationId": "TIR-26001", "track": "tir",
  "name": "<ai_screening.project_name | basic_org | basic_full_name>",
  "founders": ["<basic_full_name>", "...teammates/sip_founders names"],
  "industry": "<industry_categories.label via ai_screening>",
  "stage": "<solution_stage | sip_trl+sip_traction mapping (reuse leadership logic)>",
  "due": "<reviewer_assignments.due_at | null>",
  "ai": { "overall": 8.4, "conf": 92, "problem": 8.6, "solution": 8.2,
          "tech": 9.0, "founders": 7.8, "commit": 8.4 },
  "reviewStatus": "not-started | draft | submitted"
}]
```

- `ai` block served pre-submit (UI-is-truth decision). `ai.solution` maps from
  `ai_screening.score_completeness`; `conf` = `confidence*100`. Null if not yet scored.
- `reviewStatus` from the caller's review row; **submitted items remain in the queue**
  (unlike the existing inbox). `displayId` prefix derives from track (fixes §4.3).
- Existing `GET /reviewer/assignments` is left untouched until the old pages are
  deleted in the same release.

### 4.3 `GET /reviewer/applications/{track}/{id}/content` — NEW
Ownership: caller must hold an assignment for the app (404 otherwise — no
enumeration). Returns the presenter shape of handoff §2.3, built server-side:

```json
{
  "id": "...", "applicationId": "TIR-26001", "name": "...", "track": "tir",
  "aiSummary": "<ai_screening.summary>",
  "fields": [
    {"label": "Problem defined", "value": "Yes", "short": true},
    {"label": "Problem description", "bullets": ["one sentence.", "..."]}
  ],
  "sections": [
    {"num": "01", "title": "Basic details", "questions": [
      {"prompt": "...", "answer": "...", "type": "text|choice|file", "required": true}
    ]}
  ],
  "attachments": [{"kind": "deck", "name": "pitch.pdf", "url": "<120s signed>", "sizeMB": 4.1}]
}
```

- Field/section maps are per-track serializer tables in
  `backend/app/services/review_presenter.py` mirroring the wizard question sets
  (TIR sections 01–06, SIP 01–06 incl. traction/DPIIT).
- Long answers emitted as `bullets[]` (sentence-split server-side, same regex rules
  as the prototype's `fieldBullets()`); short facts get `short: true`.
- Attachments resolved through the leadership signed-URL allow-list machinery
  (path allow-list rebuilt from file-bearing JSONB columns; traversal guard; 120 s TTL).

### 4.4 `POST /reviewer/reviews` / `PATCH /reviewer/reviews/{id}` — EXTENDED
Body additions: `flags: string[]` (≤8, each ≤80 chars), `disagree_with_ai:
{<dim>: reason}`, `notes` → stored in `quick_notes` (leadership-visible).
Response additions: `overall` (server-computed weighted mean — Problem .22,
Solution .30, Tech .22, Founders .14, Commitment .12, over non-null scores),
`editWindowExpiresAt` = `locked_at`. Lock behavior unchanged (60 min, 423 after).
AI-screening strip in `/reviewer/applications/...` detail path: **removed**.

### 4.5 `GET /reviewer/history` — NEW
```json
{ "stats": {"total": 12, "avgVariance": 0.4, "consistencyPct": null, "avgMinutes": null},
  "rows": [{"appId": "...", "name": "...", "date": "<submitted_at>",
            "myScore": 7.9, "aiScore": 8.4, "variance": 0.5,
            "reco": "yes", "adminDecision": "approved|rejected|pending"}] }
```
`adminDecision` mapping: shortlisted/interview/offered/onboarded → approved;
rejected → rejected; everything else → pending. `myScore` = weighted overall.
Null stats render as "—" in the UI. Edit from history follows the same lock rules
(re-openable only while `locked_at` is in the future).

### 4.6 `GET /reviewer/rubric?track=tir|sip` — NEW
Versioned constant (`v3.1 · 2026-04-01`): 5 dimensions, weights, anchor tiers,
track-specific title. Single source for the rubric modal, inline panel, and the
`scoring.md` download.

### 4.7 Validation (server enforces what the UI promises)
- Non-draft submit: 5 scores + recommendation (existing 422 `incomplete_review`)
  **+ non-empty notes** (422 `notes_required`).
- Where `|score − ai_score| > 1.0` for a dimension and AI exists: a
  `disagree_with_ai[dim]` reason required on submit (422 `disagreement_reason_required`).
- `flags` cap 8 / 80 chars (422 `flags_invalid`).

---

## 5. SIP AI scoring — track adapter (provisional logic)

Same LangGraph graph, same `ai_screening` columns, same SQS message shape
(`{application_id, track}` — already carried). New, isolated under
`backend/workers/ai_screener/` + `backend/app/services/ai_scoring/tracks/sip/`:

- `evidence_sip.py` — maps `sip_applications` fields (incorporation, TRL, traction
  level/details/files, founders/cap table, DPIIT, problem/solution/execution columns,
  pitch-deck metadata) into the evidence shape.
- `prompts_sip.py` — node prompts adapted from TIR, every string tagged
  `# PROVISIONAL_V0 — rewrite when SIP rubric is final`. One file, no graph edits
  needed to swap.
- `caps_sip.py` — v0 rules (pre-incorporation or TRL ≤ 3 → cap overall; missing pitch
  deck → flag `needs_human_review`), same provisional tag.
- `POST /admin/ai-screening/run` — remove the TIR-only gate.
- `scripts/backfill_sip_ai_scores.py` — idempotent (UNIQUE upsert), throttled,
  run **after** cutover, never inside the window.

---

## 6. Frontend integration

Port prototype screens into the prod SPA on `reviewer_final`
(`frontend/src/pages/reviewer/`), replacing `ReviewerInboxPage` /
`ReviewerCompletedPage` / `ReviewerScoringPage`:

- Components from `REVIEWER-UI/os/reviewer.jsx` become ES modules; shared atoms
  reconciled with `admin.css` §5 primitives + `colors_and_type.css`; portal-specific
  styles from `os/styles.css` land in `frontend/src/styles/reviewer.css`.
- `os/api.js` mock bodies → fetches in `frontend/src/lib/reviewerApi.js`
  (signatures preserved; the prototype's `useAsync` hook is kept as-is and moved to
  `frontend/src/hooks/useAsync.js`).
- Routes (deep-linkable, replacing tab state): `/reviewer` (dashboard),
  `/reviewer/queue`, `/reviewer/eval/:track/:appId`, `/reviewer/history`. Gated by
  existing `ProtectedRoute` + reviewer capability; landing path for the reviewer role
  already points at `/reviewer`.
- Real wiring for previously-dead controls: sign out (session teardown), Home,
  Save draft (flush autosave), Submit (optimistic + confirmation toast), rubric
  download (from §4.6), CSV export (client-side over the queue payload).
- Edit-window countdown driven by `editWindowExpiresAt` from the server (no
  mount-time 3240 s timer).
- Loading / error / empty states already exist in the prototype via `useAsync` —
  preserved.

Accessibility/polish items from handoff §5 (slider ARIA, modal focus trap, keyboard
rows) ride along only if cheap; they are not release-blocking.

---

## 7. Branching, testing, rollout (hard constraints)

**Branches**
- `reviewer_final` — all Spec 1 work (worktree `.claude/worktrees/reviewer_final`).
- `release/reviewer-portal-v1` — cut from `reviewer_final` only when stable;
  used solely for the production push.
- `admin_final` — created, parked for Spec 2.
- `release/sip-launch-v1` receives no direct commits; it is merged INTO the release
  branch (or fast-forwarded from it) only at cutover.

**Testing**
- pytest: queue shaping (per-track), presenter serialization (TIR + SIP fixtures,
  bullets/facts), weighted overall, validation matrix (notes, disagreements, flags),
  lock/423, assignment-create conflicts, SIP scorer with `AI_STUB=true`.
- Staging rehearsal (Supabase `exqmxvdtcsvpgtftwjml`, stack `artpark-eir-api-staging`,
  staging Vercel URL): migration 022 → deploy → end-to-end
  assign → queue → content → draft autosave → submit → auto-`evaluated` → history;
  SIP scoring smoke with stub then one real Gemini run.

**Production cutover (window ≤ 15 min)**
Pre-window (zero-risk): migration 022 applied to prod Supabase (additive, unused);
`sam build` completed from the `release/reviewer-portal-v1` worktree (never build
across a HEAD flip); Vercel preview build green.
Window: `sam deploy` (~5–8 min) → Vercel production promote (~2 min) → smoke
(login → queue → submit on a test assignment) (~3 min).
Rollback: redeploy previous Lambda commit + Vercel instant rollback; schema requires
no rollback. Post-window: SIP backfill script; seed reviewer accounts via
`/admin/users`.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Presenter drifts from wizard questions | Serializer tables live next to field maps; pytest fixture asserts every wizard question id appears in a section |
| Old reviewer pages referenced elsewhere | Routes replaced atomically in one commit; `landing.js` path unchanged (`/reviewer`) |
| SIP provisional prompts produce junk scores | `flags: needs_human_review` + provisional tags; backfill reviewable before reviewers onboard SIP apps |
| Anti-anchoring removal regret | Single code path (`include_ai` helper) so re-introducing a strip later is a one-line gate |
| Cutover overrun | Everything heavy pre-window; window is deploy+promote+smoke only |
