# Admin/Leadership UI cleanup + applicant decision emails — Design Spec

**Date:** 2026-06-28
**Branch:** `feat/admin-decision-emails` (off `release/sip-launch-v1` @ `fc7c3a1`)
**Surfaces:** Admin portal (frontend), Leadership (display only), backend decision pipeline + email
**Author:** dayan02dev

---

## 1. Goal

Four changes to the production admin + leadership surfaces:

1. Clean up the admin dashboard (remove the "Status breakdown" card; remove the "← HOME" button; shift the brand logos left).
2. Reduce the admin **Pipeline bulk action bar** to **Reject** + **Assign batch…** only.
3. Build an **applicant decision-email + status** feature: when an admin **rejects**, the app moves to `rejected` and the applicant is emailed; when an admin **approves**, the app moves to `jury_review` ("Jury review") and the applicant is emailed that they advanced to the jury round. Status reflects on both admin + leadership.
4. Reduce the two admin **decision panels** to **Approve** + **Reject** only (remove Hold/Waitlist).

This is display-only for leadership and does **not** build the jury portal — `jury_review` here is a status + email, nothing more.

---

## 2. Key facts established from the code

- `decisions.record_decision()` / `record_decision_safe()` (`backend/app/services/decisions.py`) is the **single chokepoint** for every decision path: admin single decide, admin bulk decide, and leadership reject. The `decision` string is used **directly as the new status** (`to_status=decision`), validated against the state machine.
- The decide endpoints' `decision` field is `Literal["shortlisted","on_hold","rejected","waitlisted"]` (`backend/app/routers/admin_platform.py`, single + bulk).
- Frontend `BUTTON_TO_DECISION` (`frontend/src/lib/adminDataAdapter.js:10`) maps `approve: "shortlisted"` today.
- `admin_decisions.decision` has a CHECK constraint `in ('shortlisted','on_hold','rejected','waitlisted')` (`backend/migrations/024_admin_platform.sql:47`) — **excludes `jury_review`**, so a migration is required.
- `state_machine.LEGAL_TRANSITIONS`: `under_review → {evaluated,rejected,withdrawn}`, `evaluated → {shortlisted,on_hold,rejected,waitlisted,withdrawn}`, `on_hold → {evaluated,shortlisted,rejected,waitlisted,withdrawn}`, `shortlisted → {jury_review,rejected,withdrawn}`. Only `shortlisted → jury_review` reaches `jury_review` today. Nothing transitions **into** `interview`.
- **Display gap:** the status rendered as "JURY REVIEW" in the admin UI is the legacy `interview` status (`STATUS_TO_CHIP: interview → "JURY REVIEW"`). `jury_review` is in **no** display map (`STATUS_TO_CHIP`, `statusBuckets.js`, `stats.PHASE_1_STATUSES`, funnel buckets). Decision chosen: use the proper `jury_review` status and add it to the display maps (forward-compatible with the built-but-unrolled jury portal on `jury_staging`, which keys off `jury_review`).
- Applicant email + name are denormalized on the application row as `basic_email` / `basic_full_name` (no join).
- Email service (`backend/app/services/email_service.py`) renders `<base>.html`/`.txt` pairs from `backend/app/templates/email/` and sends via Resend; `assignment_email.py` is the best-effort sender pattern to model on. A `status_change` template already exists but is unused here.
- Two admin decision UIs: the gate-review "DECISION" panel in `AdminGate1.jsx` (Approve/Waitlist/Reject), and the 2×2 "DECIDE" grid in `AdminDetail.jsx:~720` (Approve/Hold/Reject/Waitlist) with caption "Approval will invite to psychometry" at `AdminDetail.jsx:727-728`.

---

## 3. Design

### 3.1 Admin dashboard cleanup (frontend only)
- **`AdminDashboard.jsx`** — delete the `StatusBreakdown` component (~137–172), its render block (~347–356), and the now-unused `statusCounts` derivation (~203). No backend change (the `stats` endpoint still returns `statusCounts`; we simply stop rendering it).
- **`AdminPortal.jsx`** — remove the `.lp-home-btn` ("← HOME") button (~80).
- **`admin-portal.css`** — adjust `.lp-topbar` / `.lp-brand` so the brand block left-aligns cleanly in the space the HOME button vacated.

### 3.2 Pipeline bulk action bar (frontend only)
- **`AdminPipeline.jsx`** — in the bulk bar (~1236–1240) keep only **Reject** + the **Assign batch…** dropdown (~1259–1274). Remove the **Hold**, **Send to Next Level**, **Archive** buttons and delete their now-dead handlers `handleBulkHold`, `handleBulkNextLevel`, `handleBulkArchive` (~412/413/415). Reject keeps its existing rationale prompt (`runBulkDecision('rejected','Reject', true)`).

### 3.3 Decision panels → Approve / Reject only (frontend only)
- **`AdminGate1.jsx`** (gate-review DECISION panel, ~324–326) — keep **Approve** + **Reject**, remove **Waitlist**. Update the rationale placeholder to "Decision rationale (required for reject)…".
- **`AdminDetail.jsx`** (2×2 DECIDE grid, ~720) — keep **Approve** + **Reject**, remove **Hold** + **Waitlist**. Replace the caption (`727-728`) "Approval will invite to psychometry" / "...cohort onboarding" with copy describing advancement to the **jury evaluation round**.
- **`adminDataAdapter.js`** — change `BUTTON_TO_DECISION.approve` from `"shortlisted"` → **`"jury_review"`**. Add `DECISION_TO_ADMIN.jury_review = "APPROVED"` and `STATUS_TO_CHIP.jury_review = "JURY REVIEW"`.
- Approve requires **no** rationale; Reject still requires one (existing rule: reject/waitlist/hold need rationale — after this change only reject remains).

### 3.4 `jury_review` status — display coverage (frontend + leadership backend)
Add `jury_review` so it renders "Jury review" and counts correctly on **both** surfaces:
- **`adminDataAdapter.js`**: `STATUS_TO_CHIP.jury_review = "JURY REVIEW"`, `DECISION_TO_ADMIN.jury_review = "APPROVED"`, and `flagColor`/chip-color treats `jury_review` as advanced/green.
- **`AdminPipeline.jsx`**: audit the chip↔status round-trip helpers (the `'JURY REVIEW' → 'interview'` reverse maps at ~56/123). Point the "JURY REVIEW" chip at `jury_review` so an approved app round-trips to the right status filter. `interview` is unreachable in practice, so this is safe.
- **`backend/app/services/stats.py`**: add `("jury_review","Jury review")` to `PHASE_1_STATUSES`; add `jury_review` to `FUNNEL_BUCKETS["advanced"]` and `ADVANCED_PAST_REVIEW`. This makes leadership label + count it correctly.
- **`frontend/src/pages/leadership/components/statusBuckets.js`**: add `jury_review: "advance"`.

### 3.5 Applicant decision emails + status (backend)

**Hook:** in `decisions.record_decision()` and `record_decision_safe()`, **after** the status change succeeds, best-effort send an applicant email **iff** `decision in {"rejected","jury_review"}`. Failure is logged and swallowed (never blocks the status change). This single hook covers all entry points (admin single, admin bulk, leadership reject).

**New helper** `notify_applicant_decided(sb, *, track, application_id, decision, applicant_email, applicant_name)` (new module `backend/app/services/decision_email.py`, modeled on `assignment_email.py`).

**New `EmailService.send_applicant_decision(*, to, applicant_name, outcome, application_id)`** where `outcome ∈ {"advanced","rejected"}`, selecting the template:
- `applicant_decision_advanced.html`/`.txt` — "Your application has advanced to the next round (jury evaluation)." Warm, forward-looking. No internal scores.
- `applicant_decision_rejected.html`/`.txt` — **gracious & generic**: "After careful review, your application was not selected this round." **Does not** include the admin's rationale or any internal notes.

Both templates extend the existing `base.html`/`base.txt`, use VIP/TIR-neutral language, and link to a generic ARTPARK URL (no action required of the applicant).

**Status mapping:** Approve → decision/status `jury_review`; Reject → `rejected` (unchanged).

### 3.6 Backend decision plumbing for `jury_review`
- **`admin_platform.py`** — extend the `DecisionBody` and `BulkDecisionItem` `decision` Literals to include `"jury_review"`. `jury_review` does **not** require a rationale (only `rejected`/`waitlisted`/`on_hold` do — keep that rule; approve/jury_review omitted).
- **`state_machine.py`** — add `jury_review` to the allowed targets of `under_review`, `evaluated`, and `on_hold` (it is already a target of `shortlisted`). Reject (`→ rejected`) is already legal from all active states. `jury_review → rejected` is already legal (needed for the smoke test: approve then reject the same app).
- **Migration `027_jury_review_decision.sql`** (next free number on prod; note `jury_staging` independently uses a `027` — reconcile if/when jury merges): extend the `admin_decisions.decision` CHECK to include `'jury_review'`. Applied manually to prod Supabase (standard flow).

### 3.7 Out of scope (YAGNI)
- The actual jury portal (separate, on `jury_staging`).
- Psychometry (mock screen untouched).
- `on_hold` / `waitlisted` remain backend-valid (leadership may still use them) but are removed from the admin UIs and never trigger applicant email.

---

## 4. Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `decision_email.py` (new) | Resolve applicant contact, map decision→outcome, call email service. Best-effort. | `email_service`, supabase client |
| `EmailService.send_applicant_decision` (new) | Render + send the two applicant templates. | Jinja templates, Resend |
| `applicant_decision_{advanced,rejected}.{html,txt}` (new) | Applicant-facing copy. | `base.*` |
| `decisions.record_decision[_safe]` (edit) | Add post-status-change email hook for `{rejected,jury_review}`. | `decision_email` |
| `state_machine.LEGAL_TRANSITIONS` (edit) | Allow `*→jury_review` from active pre-jury states. | — |
| `admin_platform.py` Literals (edit) | Accept `jury_review` decision. | — |
| `027` migration (new) | Relax `admin_decisions.decision` CHECK. | — |
| `stats.py` (edit) | Count/label `jury_review`. | — |
| Frontend maps + 4 screens (edit) | Show Approve/Reject only; render `jury_review` as "Jury review". | — |

---

## 5. Error handling
- Email send is best-effort: any exception in `notify_applicant_decided` / `send_applicant_decision` is caught and logged; the decision + status change always commit.
- Missing/blank `basic_email` → skip send, log a warning, no error to caller.
- Illegal transitions still raise 422 (unchanged) — the new legal transitions prevent that for approve from realistic states.

---

## 6. Testing

**Backend unit (FakeSupabase, pattern from `test_admin_platform.py` / `test_leadership_writes.py`):**
- `evaluated → jury_review` legal; `under_review → jury_review` legal; `evaluated → rejected` legal; `jury_review → rejected` legal.
- `record_decision(decision="jury_review")` writes admin_decisions row + flips status + triggers email hook (mock email service asserts `send_applicant_decision(outcome="advanced")` called once).
- `record_decision(decision="rejected")` triggers `outcome="rejected"`; `decision="on_hold"`/`"waitlisted"` trigger **no** email.
- Email send failure does not fail `record_decision`.
- `DecisionBody` accepts `jury_review`; rationale not required for it; still required for `rejected`.

**Frontend unit:** existing admin tests updated — pipeline bulk bar renders only Reject + Assign batch; decision panels render only Approve + Reject; dashboard no longer renders the status-breakdown card.

**Production smoke test (controlled, on the existing evaluated test app — "Cognitive Warfare AI"):**
1. Record the test app's original `basic_email` + `status`. Set `basic_email = udayanpawar03@gmail.com`.
2. Trigger **Approve** via the deployed prod path (script invoking the same `record_decision` the endpoint uses): assert status → `jury_review`, Resend returns a sent `message_id`, CloudWatch shows the send. User confirms the "advanced" email in the Gmail inbox. Verify the chip shows "Jury review" on admin + leadership.
3. Trigger **Reject** (`jury_review → rejected`): assert status → `rejected`, 2nd email sent; user confirms the rejection email.
4. **Restore** the test app's original `basic_email` + `status`; remove the two test `admin_decisions` rows + status-log rows created during the test.
- No real applicant is ever emailed during the smoke test.

---

## 7. Delivery
- All work on `feat/admin-decision-emails` (worktree `.claude/worktrees/feat-admin-decision-emails`) → merge to `release/sip-launch-v1`.
- **Migration 027** applied to prod Supabase before backend deploy.
- **Backend** (decisions, email, templates, state machine, endpoint Literals, stats.py) → SAM deploy to prod **from a worktree whose `.env.prod` has `TIR_SUBMISSIONS_CLOSED=true` and `SIP_SUBMISSIONS_CLOSED=true`** (grep before deploy — per the repeat intake-reopen footgun).
- **Frontend** (dashboard, pipeline, decision panels, adapter maps, statusBuckets) → pushed to `release/sip-launch-v1`; **user performs the Vercel Promote-to-Production**.
- Backend tests green (with `--no-cov` for single-file runs per the coverage-gate note); frontend tests green.
