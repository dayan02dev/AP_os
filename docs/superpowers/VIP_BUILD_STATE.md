# VIP onboarding build — resumable state

**Read this first if you are picking this work up cold.** It is the durable record; per-phase SDD ledgers under `.superpowers/sdd/` are deleted when a phase closes.

**Branch:** `feat/vip-onboarding` · **Worktree:** `.claude/worktrees/vip-onboarding` · **Base:** `release/sip-launch-v1` @ `a8f470e`

Work only in that worktree — concurrent sessions cross-contaminate otherwise.

## Documents

| | |
|---|---|
| Spec (binding authority) | `docs/superpowers/specs/2026-08-15-vip-onboarding-design.md` |
| AIR framework source | `docs/reference/air-framework.md` |
| MIS template source | `docs/reference/mis-templates.md` |
| Phase plans | `docs/superpowers/plans/2026-08-15-vip-phase1-*.md`, `2026-08-16-vip-phase2-*.md`, `2026-08-16-vip-phase3-*.md` |

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Track generalisation, shell, COHORT deletion | ✅ complete, whole-phase reviewed, fix wave applied |
| 2 | AIR readiness assessment **backend** | ✅ complete, whole-phase reviewed, fix wave applied |
| 3 | MIS reporting **backend** | ✅ complete, whole-phase reviewed, fix wave + scoped re-review + residual fixes |
| 4 | Founder UI: AIR wizard (spec §4.3/§4.4) | ✅ complete, whole-phase reviewed, 18-item fix wave applied |
| 5 | Founder UI: MIS monthly + quarterly forms (spec §5.3/§5.4) | ✅ complete — 6 components + shell |
| 6 | VIP process dashboard (spec §6) | ✅ complete — derivations + 5 panels + shell |
| 7 | Admin "VIP cohort" verification surface (spec §7) | ✅ complete — backend (28 tests) + both screens (71 tests) |
| 8 | docx import + xlsx export (spec §5.6/§5.7) | ✅ complete — parser, review+commit endpoints, xlsx/csv export |

**The phase numbering diverges from spec §10 deliberately.** §10 folded each
surface's UI into the phase that built its backend — its phase 2 was "AIR
endpoints *and* the 5-step wizard", its phase 3 "period generation *and* the
monthly and quarterly forms". In execution both shipped backend-only, so the two
UI tails are now phases 4 and 5, and everything after shifts by two. Spec §10's
*ordering* still holds; only the boundaries moved.

**All eight phases are code-complete.** Baseline at completion: backend
**1647 passed / 20 failed** (the 20 are the known pre-existing baseline,
verified byte-identical against untouched HEAD by two agents independently,
one via a disposable worktree); frontend **894 passed / 2 failed**
(`AdminPipeline.test.js`, `AdminPipeline.unassign.test.jsx` — same known
baseline). `vite build` clean.

**Deployed and smoke-tested on staging 2026-08-17.**

| | |
|---|---|
| API | `https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com` (stack `artpark-eir-api-staging`) |
| Preview | `https://ap-os-git-feat-vip-onboarding-artpark.vercel.app` |
| Test founder | `claude-test-applicant-sip@artpark.in` — onboarded, 4 monthly + 2 quarterly periods, 4 overdue |
| Smoke test | `backend/scripts/smoke_vip_portal.py` (`--writes` to include write paths) |

Two defects that only surfaced against live infrastructure:

1. **The CORS change did not apply.** SAM buries CORS in the OpenAPI body, so
   CFN reported no change and the branch preview origin never reached the
   allow-list — every browser request would have failed with no clear cause,
   while the code itself deployed fine. Patched live with
   `aws apigatewayv2 update-api --cors-configuration`; verified it survives a
   redeploy. **Any future preview origin needs the same manual patch.**
2. **The docx import commit blanked fields it did not carry** (fixed,
   `c79e014`). `put_metrics`/`put_headcount` are full-row upserts; the import
   commit passes only the founder-confirmed subset, so a template naming an
   actual but no target nulled a hand-typed target.

**Correction to a claim repeated throughout this build:** "the API validates,
never coerces" is true only for **entries** (`_validate_entry_value`).
Metrics, financials and headcount go through Pydantic in lax mode — `"12"`
returns 200 and stores `12.0`. Sending real JSON numbers is still right, but
not for the reason previously stated.

## Founder UI conventions (read before phases 4-6)

Established by the TIR pages; VIP must match them, not invent a second dialect.

- `frontend/src/lib/founderApi.js` — flat map of endpoint thunks over
  `api.get/post/patch/del`. Add AIR and MIS entries here; do not create a
  second client module.
- `frontend/src/pages/founder/ui.jsx` — `Loading`, `ErrorState`, `Tile`,
  `fmtINR`, `fmtL`, `sum`.
- `frontend/src/pages/founder/components/Stepper.jsx` — the numbered-circle
  wizard chrome (active / done / default, connectors, progress bar), already
  driven by `steps / current / furthest / onGo / eyebrow / progressLabel`. The
  AIR wizard reuses it as-is; it was built generic for exactly this.
- **Autosave pattern:** optimistic local `setState`, fire the PATCH, push the
  error into a non-blocking `actionError`. See `FounderApproach.jsx:64-100`.
  No save buttons on field edits.
- CSS classes are `fj-*` / `tile` / `eyebrow`, defined in the founder
  stylesheet. Reuse; do not add inline style objects beyond what `ui.jsx`
  already does.
- **The MIS API validates rather than coerces.** `"12"` for a numeric field is
  a 422, not `12`. Forms must send JSON numbers, and `null` for empty — not
  `""`.
- **`founderApi.js` already carries every AIR and MIS thunk.** Phases 5-6 must
  not edit it; that file was the one choke point forcing those phases to run
  in series, so it was filled in ahead of them.
- **Each new surface owns its own stylesheet**, imported by its page —
  `founder-mis.css`, `vip-dashboard.css`. Only the AIR wizard and the shared
  atoms live in `founder-portal.css`. This is what lets phases 5 and 6 be
  built concurrently.
- **Empty states need one message per cause.** Five defects in phase 4 were a
  single shape: a null with two distinct causes and one message true for only
  one of them (a lever never touched vs. one whose Q1 was skipped; a document
  undefined vs. not yet earned). Enumerate every empty state and give each its
  own copy.

## Migrations

| File | Contents | Staging | Prod |
|---|---|---|---|
| `043_vip_track_generalisation.sql` | `track` column on the 5 shared founder tables; FKs to `tir_applications` dropped | ✅ applied, verified | ❌ not applied |
| `044_vip_air.sql` | 3 AIR tables + private `vip-founder-docs` bucket | ✅ applied, verified | ❌ not applied |
| `045_vip_mis.sql` | 5 MIS tables | ✅ applied, verified | ❌ not applied |

`043_044_VIP_STAGING_APPLY.sql` is a Studio-paste convenience concatenation, not a new migration.

**Deploy order is migration → backend, never the reverse.** The code hard-references these columns and tables; a backend deployed first returns 500 on every VIP founder request. All three migrations are additive and safe to apply early. Prod DDL is Studio-only — a human pastes it.

## Decisions the user still owes

1. ~~**The MOU a VIP founder signs is TIR's**~~ — **settled 2026-08-18.** VIP signs the ARTPARK **Facility Agreement** only; TIR signs Facility + Collaboration. See `specs/2026-08-18-mou-agreements-and-resource-lock-design.md`. Original note follows.
   **The MOU a VIP founder signs is TIR's** — it has them acknowledge full-time presence at ARTPARK campus, the residency expense account, and post-25L equity, stamped `tir-mou-v2`. The user scoped MOU changes to "afterwards". **Must be settled before any VIP founder is added to `FOUNDER_PORTAL_ALLOWLIST`**, because it is a signed legal artefact.
2. **AIR source quirks** — three duplicate option→level mappings (`supply_chain` Q3 A/B → 8; `reliability` Q2 A/B → 6, Q3 A/B → 8). Preserved deliberately and guarded by a test. Worth ARTPARK confirming the intended levels; affects real scores.
3. **Unreachable AIR levels** — `supply_chain` can never claim AIR 3, `reliability` can never claim 2 or 4. Faithful to the source (no option maps there), but a founder cannot express those states.
4. **Evidence from prior AIR rounds is unreachable** — all three evidence endpoints resolve only the current quarter's round. Deliberately deferred to the admin phase.
5. ~~**Reopen semantics**~~ — **settled in Phase 7.** Reopen flips a submitted period back to `draft` and stamps `reopened_at`/`reopened_by`, but **409s `mis_later_period_submitted` when any later period of the same kind is still submitted** — the exact mirror of `founder_mis._reject_out_of_order_submit`, protecting the same adjacency invariant from the other side. Still open for the user: in-order submit means a founder holding one unfillable historical period cannot file the current one, and reopen is not an escape hatch for that (it only moves submitted→draft). If ARTPARK needs a venture to skip a period entirely, that is a separate mechanism nobody has asked for yet.
6. **No write path for custom MIS metrics** — the source template invites a venture to add its own metrics, and the backend seeds and carries them forward correctly, but `put_metrics` rejects any key outside the catalog. The template promises something the API cannot do. Product decision.
7. **AIR trajectory cannot be built as specced** — spec §6 wants overall AIR plotted per round, but no founder-facing endpoint returns any round except the current IST quarter's. The dashboard ships a single point with an honest "history not available" note. Exposing prior rounds is an admin-phase change.
8. **Overdue backlog on day one** — a venture onboarded months ago gets every intervening period generated at once, all draft and overdue. With in-order submit they must be filed oldest-first. Confirm that matches how ARTPARK actually wants catch-up handled.

## Standing constraints for later phases

- **No fail-open defaults.** Every parameter selecting a track, kind, period or catalog key is required; unknown keys raise. Phase 2 shipped a lookup returning `0` for an unknown question, which made an unknown question an *ungated* one.
- **Convergent creation, not create-once.** No client-side transactions (PostgREST) and no `exec_sql` RPC. Catch unique violations narrowly on the insert, re-read, reconcile missing children on *every* call, bulk-insert the missing, retry once then propagate. Reuse `air_query._is_unique_violation`; never copy it.
- **`new_keys` must mean "I inserted it", not "it was missing when I read".** Phase 3 shipped the latter and both racers seeded.
- **Derive, never store** anything computable: `overdue`, `vs_last`, `needs_gap`, headcount `net_change`.
- **Dates are IST.** Phase 2 shipped a UTC bug mislabelling the period for 5.5 hours after every boundary.
- **Submitted means frozen** (ruling P3-R5): writes 409, reads stay open, `trl_level` snapshots at submit, no reconciliation into submitted periods (submit reconciles once, while still a draft, at the freeze boundary).
- **MIS periods submit in order** (ruling P3-R7). `POST /founder/mis/{kind}/{period_key}/submit` 409s `mis_earlier_period_open` — with the blocking period's `period_key` and `label` in the detail — while any earlier period of the same kind is still draft. Monthly and quarterly are independent ladders. The forms UI (Phase 5) must present periods oldest-first and surface that 409 as a link to the blocking period, not as a generic error. Rejected alternative: snapshotting the comparison basis at submit, which would permanently freeze a NULL delta for any period filed before its predecessor.
- **Entry values are validated, not coerced.** `"12"` for a numeric field is a 422 `invalid_value`, dates must be strict `YYYY-MM-DD`, ints reject floats. Forms send JSON numbers and `null` for empty — never `""`.
- **Tests must guard what they claim — and a plan-supplied test is not exempt.**
  Every test whose name asserts a property gets broken in memory to prove it
  fails. Beyond that: **run each new test against the UNMODIFIED code first and
  confirm it fails for the right reason.** Five separate vacuous tests have now
  been caught this way, and every one was handed down in a plan:
    - a read-only assertion whose fixture rendered zero inputs, so "no enabled
      inputs" was trivially true;
    - a metrics-grid test asserting only that `"12"` appeared *somewhere*, which
      survived swapping the Target and Actual columns;
    - `test_founder_write_routes_are_gone`, which 404'd because its precondition
      never created the period — not because the route was gone;
    - the same test's financials/headcount cases, run against a monthly period
      where those endpoints 404 on kind-mismatch regardless;
    - a sort test whose fixture happened to be pre-sorted, so a function with no
      sort passed.
  The failure mode is always the same: the test passes for a reason unrelated to
  what it names. Writing it is not enough; watch it fail first.
- **Enumerate derived values whose formula the spec does not state**, and require them raised as questions rather than resolved silently. This is the lesson from the `net_change` Critical: the spec said "computed, not typed" and stopped, an implementer invented a formula, and three reviews read it without flagging it because the only checkable question was "is it computed?".
- `sqlglot` parses every migration in `backend/migrations/` via `tests/test_migrations_parse.py` — this project's DDL is hand-pasted into Studio with no CI gate.

## Known-good verification commands

```bash
cd .claude/worktrees/vip-onboarding/backend
PY=/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python
$PY -m pytest tests/test_founder_access.py tests/test_founder_crud.py tests/test_founder_mou.py \
  tests/test_founder_query.py tests/test_founder_journey.py tests/test_founder_resources.py \
  tests/test_vip_migration.py tests/test_vip_mou.py tests/test_vip_resources.py \
  tests/test_vip_endpoint_isolation.py tests/test_founder_project_name.py \
  tests/test_air_*.py tests/test_vip_air_migration.py tests/test_mis_*.py \
  tests/test_vip_mis_migration.py tests/test_migrations_parse.py -q --no-cov
```

Baseline: roughly **20 pre-existing backend failures** on this branch, unrelated to this work. Verify any failure against untouched `release/sip-launch-v1` before attributing it.

Staging env for verification scripts: `source /Users/apple/Desktop/Final_AP_os/backend/.env.staging` (the worktree has no `.env.staging` of its own).

## Known untested paths

Carried forward deliberately rather than left to be rediscovered:

- **Admin MIS period render, quarterly branch.** `AdminVipMisPeriod.jsx`'s
  `FinancialsSection` / `HeadcountSection` were written against the real
  backend shapes but exercised only with monthly fixtures. The quarterly path
  has no test. Highest-value gap to close first.
- **CSS and the `accept` attribute** have no assertions anywhere in this repo's
  suite — verified by inspection only.
- **Integration between surfaces.** Nine agents built against written
  contracts; unit coverage is strong but the seams are where defects should be
  expected. Nothing has been exercised in a browser yet.
- **Quarterly docx import is detect-and-flag, not prefill.** Seven of the
  quarterly template's entry sections are free prose with no per-field textual
  anchor, so the parser surfaces them as flagged raw text rather than guessing
  structured fields. Deliberate, but it means quarterly import does far less
  than monthly import does.

## Staging gap

There are **zero `sip` applications in `offered`/`onboarded` on staging**, so no VIP founder exists to exercise the portal against. Schema and code are ready; this needs seed data plus a staging deploy before anyone can click through it.
