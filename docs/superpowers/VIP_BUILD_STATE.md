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
| 2 | AIR readiness assessment backend | ✅ complete, whole-phase reviewed, fix wave applied |
| 3 | MIS reporting backend | ✅ 6/6 tasks reviewed; whole-phase review done; **fix wave in progress** |
| 4 | VIP process dashboard | not started |
| 5 | Admin "VIP cohort" verification surface | not started |
| 6 | docx import + xlsx export | not started |

## Migrations

| File | Contents | Staging | Prod |
|---|---|---|---|
| `043_vip_track_generalisation.sql` | `track` column on the 5 shared founder tables; FKs to `tir_applications` dropped | ✅ applied, verified | ❌ not applied |
| `044_vip_air.sql` | 3 AIR tables + private `vip-founder-docs` bucket | ✅ applied, verified | ❌ not applied |
| `045_vip_mis.sql` | 5 MIS tables | ✅ applied, verified | ❌ not applied |

`043_044_VIP_STAGING_APPLY.sql` is a Studio-paste convenience concatenation, not a new migration.

**Deploy order is migration → backend, never the reverse.** The code hard-references these columns and tables; a backend deployed first returns 500 on every VIP founder request. All three migrations are additive and safe to apply early. Prod DDL is Studio-only — a human pastes it.

## Decisions the user still owes

1. **The MOU a VIP founder signs is TIR's** — it has them acknowledge full-time presence at ARTPARK campus, the residency expense account, and post-25L equity, stamped `tir-mou-v2`. The user scoped MOU changes to "afterwards". **Must be settled before any VIP founder is added to `FOUNDER_PORTAL_ALLOWLIST`**, because it is a signed legal artefact.
2. **AIR source quirks** — three duplicate option→level mappings (`supply_chain` Q3 A/B → 8; `reliability` Q2 A/B → 6, Q3 A/B → 8). Preserved deliberately and guarded by a test. Worth ARTPARK confirming the intended levels; affects real scores.
3. **Unreachable AIR levels** — `supply_chain` can never claim AIR 3, `reliability` can never claim 2 or 4. Faithful to the source (no option maps there), but a founder cannot express those states.
4. **Evidence from prior AIR rounds is unreachable** — all three evidence endpoints resolve only the current quarter's round. Deliberately deferred to the admin phase.
5. **Reopen semantics** — `vip_mis_periods.reopened_at`/`reopened_by` exist but no reopen code does. If reopening flips status back to `draft`, that period stops being a carry-forward seed source while open. Decide when the reopen task lands (Phase 5).

## Standing constraints for later phases

- **No fail-open defaults.** Every parameter selecting a track, kind, period or catalog key is required; unknown keys raise. Phase 2 shipped a lookup returning `0` for an unknown question, which made an unknown question an *ungated* one.
- **Convergent creation, not create-once.** No client-side transactions (PostgREST) and no `exec_sql` RPC. Catch unique violations narrowly on the insert, re-read, reconcile missing children on *every* call, bulk-insert the missing, retry once then propagate. Reuse `air_query._is_unique_violation`; never copy it.
- **`new_keys` must mean "I inserted it", not "it was missing when I read".** Phase 3 shipped the latter and both racers seeded.
- **Derive, never store** anything computable: `overdue`, `vs_last`, `needs_gap`, headcount `net_change`.
- **Dates are IST.** Phase 2 shipped a UTC bug mislabelling the period for 5.5 hours after every boundary.
- **Submitted means frozen** (ruling P3-R5): writes 409, reads stay open, `trl_level` snapshots at submit, no reconciliation into submitted periods.
- **Tests must guard what they claim.** Every test whose name asserts a property gets broken in memory to prove it fails. Phase 2's final review found three that passed against deliberately broken code; Phase 3 found several more.
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

## Staging gap

There are **zero `sip` applications in `offered`/`onboarded` on staging**, so no VIP founder exists to exercise the portal against. Schema and code are ready; this needs seed data plus a staging deploy before anyone can click through it.
