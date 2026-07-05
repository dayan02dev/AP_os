# Design — Status-lifecycle end-to-end tests (TIR + VIP)

Date: 2026-07-06
Branch base: `release/sip-launch-v1` (prod)
Status: approved design, pending implementation plan

## Motivation

We need a hermetic, deterministic test "agent" (a pytest suite) that drives an
application through its **entire status lifecycle** and asserts the status after
every hop — for **both tracks (TIR and VIP/`sip`)** — so any future change that
alters a transition trigger fails loudly.

This was prompted by a mistaken mental model of the flow. The corrected,
code-verified lifecycle is the contract these tests lock in.

## The verified status lifecycle (the contract)

Status lives on each track's own row: `tir_applications.status` /
`sip_applications.status`. Every transition is also appended to
`application_status_log`. The transition logic is **track-agnostic** — the same
functions switch table name by track (`state_machine.py:163,225`,
`decisions.py:43`).

```
draft ──submit──▶ submitted ──AI worker (auto)──▶ under_review
                                                     │
   (assign reviewers here: inserts reviewer_assignments, NO status change)
                                                     │
   under_review ──LAST active reviewer submits──▶ evaluated
                                                     │
   evaluated ──admin decision──▶ jury_review (Approve) │ rejected (Reject)
                                 │ on_hold (Hold) │ waitlisted (Waitlist)
```

Stage-by-stage, with the code that performs each write:

| # | Transition | Trigger | Code |
|---|------------|---------|------|
| 1 | `draft → submitted` | Applicant submits (only from `draft`, else 409) | `applications.py:827` (TIR) / `sip_applications.py:546` (VIP); then `sqs_publisher.publish(id, track)` |
| 2 | `submitted → under_review` | **AI worker, automatic** — on screening complete | `workers/ai_screener/handler.py` → `pipeline.persist(..., advance_status=True)` at `pipeline.py:186–193` |
| — | (assign reviewers) | Leadership/admin assign | inserts `reviewer_assignments` only — **no status write** (`leadership_actions.py:132`, `admin_platform.py:926`) |
| 3 | `under_review → evaluated` | **Last** active assignment completes | `reviewer.py:487/690` → `state_machine.auto_transition_to_evaluated_if_complete` (`state_machine.py:97–211`) |
| 4 | `evaluated → jury_review/rejected/on_hold/waitlisted` | Admin Gate-1 decision | `decisions.record_decision` (`decisions.py:34`) → `admin_decisions` row + `apply_status_change` |

Key facts the tests must encode:
- **Assigning a reviewer does NOT change status.** The app is already
  `under_review` (set by AI) before anyone assigns.
- `evaluated` fires only when **every** active (non-declined, non-reassigned)
  assignment has `completed_at`, and only if current status is `under_review`.
- Admins may Approve/Reject **directly from `submitted`/`under_review`**, skipping
  `evaluated` (that is why some apps reach `jury_review` with no reviewer score).
- Legal transitions are enforced by `LEGAL_TRANSITIONS` (`state_machine.py:39–54`);
  rewinds (e.g. `evaluated → submitted`) raise 422 `illegal_transition`.
- `ai_screening`/`screening_failed` statuses exist in the enum but the current
  worker never writes them (submitted → under_review in one hop). Not exercised.
- TIR ≡ VIP: identical logic; only the table name and SQS track string differ.
  (TIR-only founder-check writes `ai_screening.founder_check`, never status.)

## Architecture of the testing agent

**Approach: endpoint-driven end-to-end via FastAPI `TestClient`, backed by one
WHERE-aware in-memory fake Supabase, with the async AI-worker step simulated by
calling the real `pipeline.persist(...)`.** Parametrized over `track ∈ {tir, sip}`.

Rationale: driving the real HTTP routes exercises routing, request validation,
and role-gating — "what actually happens" when the app runs. AI screening has no
synchronous endpoint (SQS→Lambda), so we call the real `pipeline.persist(...,
advance_status=True)` (exactly what the worker calls) with **canned scores**
instead of a live LLM call, keeping the suite deterministic.

Components:

1. **`tests/fixtures/fake_supabase.py`** — a single WHERE-aware in-memory client
   supporting `table / insert / update / select / eq / in_ / maybe_single /
   limit / execute`. Unlike the copy-pasted per-file fakes (several treat `.eq()`
   on SELECTs as a no-op), this one honors `.eq()` filters so "update status →
   read it back by id" is faithful. Reusable; may later replace the duplicates.
2. **`LifecycleDriver`** helper — walks one application through real code paths:
   - `submit()` — applicant auth → track submit endpoint → expect `submitted`
   - `run_ai()` — real `pipeline.persist(fake, id, track, canned_result, advance_status=True)` → expect `under_review`
   - `assign(reviewers)` — admin auth → assign endpoint → expect status **unchanged**
   - `submit_review(assignment, draft=False)` — reviewer auth → reviewer submit endpoint → triggers `auto_transition`
   - `decide(decision, rationale)` — admin auth → decide endpoint → `record_decision`
   - `status()` — read the app row from the fake to assert
3. **Auth** via `app.dependency_overrides[get_current_user]` for applicant / admin
   / reviewer roles as each step needs.
4. **Stubs**: `sqs_publisher.publish` (no AWS), email sends (no Resend),
   `write_audit` (no-op) — matching existing tests. Email hooks are asserted as
   "invoked" via a spy where relevant (A5, C1).

## Test cases (each parametrized over TIR and VIP unless noted)

**A — Happy-path spine (core end-to-end smoke):**
- A1 submit → `submitted`
- A2 AI completes → `under_review`
- A3 assign a reviewer → stays `under_review` (assignment ≠ status change)
- A4 reviewer submits → `evaluated` (single reviewer = all complete)
- A5 admin Approve → `jury_review` (+ `admin_decisions` row + applicant-email hook fired)
- A6 full chain A1→A5 asserting every hop

**B — Reviewer-completion edges:**
- B1 2 assigned, 1 submits → stays `under_review`
- B2 last (2nd) submits → `evaluated`
- B3 draft review → no completion, stays `under_review`
- B4 auto-transition is a no-op when status isn't `under_review` (idempotent)
- B5 auto-transition is a no-op with zero active assignments

**C — Admin decision branches (from `evaluated`):**
- C1 Reject → `rejected` (+ email hook)
- C2 Hold → `on_hold`
- C3 Waitlist → `waitlisted`
- C4 reject/hold/waitlist with no rationale (batch `record_decision_safe` path) → `rationale_required`, status unchanged

**D — Skip / illegal:**
- D1 Approve directly from `under_review` (no reviews) → `jury_review`
- D2 Reject directly from `submitted` → `rejected`
- D3 illegal rewind `evaluated → submitted` → 422 `illegal_transition`, status unchanged

**E — AI idempotency:**
- E1 running AI on a non-`submitted` row does not change status

**F — TIR ≡ VIP parity (explicit requirement):**
- F1 the same action sequence yields the same status at each hop for both tracks
- F2 writes land in the correct per-track table, never the other

**G — Frontend display (referenced, not rebuilt):**
- The status→label mapping is already covered by the shipped vitest tests
  (`adminDataAdapter` `CHIP_META`, `AdminPipeline.juryLabel`). Referenced here; not
  duplicated.

## Files

- `backend/tests/fixtures/fake_supabase.py` — reusable WHERE-aware fake client
- `backend/tests/test_status_lifecycle_e2e.py` — `LifecycleDriver` + all cases, parametrized over tracks

Run: `pytest tests/test_status_lifecycle_e2e.py -v --no-cov` (single-file runs
need `--no-cov` for the coverage gate).

## Success criteria

- All cases green for both TIR and VIP.
- The suite fails loudly if any transition trigger changes — e.g. if assignment
  starts changing status (A3 fails), if Approve stops producing `jury_review`
  (A5/D1 fail), or if a rewind becomes silently allowed (D3 fails).

## Out of scope

- Live/staging smoke run against the deployed API (explicitly deferred; hermetic
  chosen).
- Testing AI scoring quality / the LLM pipeline internals (canned scores used).
- Jury Gate-2 / post-`jury_review` flow (deferred, unshipped).
- Frontend render lifecycle test (existing vitest coverage referenced instead).
