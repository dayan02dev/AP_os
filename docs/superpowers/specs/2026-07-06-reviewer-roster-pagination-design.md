# Reviewer Roster Pagination Fix — Design Spec

> **Date:** 2026-07-06
> **Type:** Bug fix (admin portal reviewer roster)
> **Base:** `origin/release/sip-launch-v1` @ `2da2d09`, on isolated branch `fix/reviewer-roster-pagination`.
> **⚠ Parallel session:** another Claude session is actively editing `admin_query.py` (esp. `assign_reviewers_to_batch`), plus `state_machine.py`, `handler.py`, `leadership_actions.py`, `admin_platform.py`, `reviewer.py`. This fix touches **only `fetch_roster` in `admin_query.py`** (a different, non-overlapping function) and no other listed file. Do not commit to `release/sip-launch-v1`.

## 1. Symptom (reported)

Assigning a batch to a **newly created** reviewer (`udayanpawar2@gmail.com`) appears not to work: the reviewer roster shows **"No assignments"** / no batch for them, even though the batch was assigned. It "worked for older reviewers." The admin also saw the assign action do nothing on repeats, and reported not receiving an invite email.

## 2. Root cause (confirmed on prod)

The reviewer roster (`GET /admin/platform/reviewers` → `admin_query.fetch_roster`) bulk-fetches `reviewer_assignments` with a single un-ranged `.select("*")`, which **PostgREST silently caps at 1000 rows**.

Evidence (prod, `xtmszlpwgbyoumalgbhs`):
- `reviewer_assignments` has **3,320 rows**; the roster's capped fetch returns exactly **1,000**, covering only **3 of 8 reviewers**.
- `udayanpawar2` (`defd24a9…`): roster sees **0** assignment rows; **true count is 449** (all 328 of "Batch B" + all 121 of "Batch D"; audit log confirms `batch_reviewers_assigned … created: 121`). So the assignment **succeeded in the DB** — the roster just can't see it.
- Other reviewers are also silently dropped/undercounted: `d5daaf7b` 0/462, `99a86d9f` 0/274, `dc19fbb0` 0/268, `51d2ca78` 0/265, "Udayan pawar" (`2a7b899c`) 78/121.

**Why "worked for old reviewers, not the new one":** older reviewers' assignment rows were inserted earlier and fall within the first 1,000 rows returned; the newest reviewer's rows sort last and fall past row 1,000, so the roster shows "No assignments."

`fetch_roster`'s helper comment already acknowledges this cap for `profiles`, and the mitigation (filter by reviewer ids) does **not** help `reviewer_assignments` because a handful of reviewers together own 3,320 rows — still far over 1,000.

Note: a paginated generator `iter_assignment_rows()` already exists in `admin_query.py` (added by the parallel session for the assign-path dedup snapshots), but `fetch_roster` does not use it — the roster path is still capped.

## 3. The email report is NOT a code bug (investigated, no fix)

Full CloudWatch trace of the invite request (`request_id 09ed9b175f3e4b00`, `POST /admin/users`) shows the backend created the user, granted the reviewer role, set `reviewer_profiles.batch_id`, fanned out the batch assignments, and sent the credentials email:

```
POST https://api.resend.com/emails "HTTP/1.1 200 OK"
resend send ok
```

So `send_reviewer_invite` **succeeded (Resend 200)**. "Not received" is a **deliverability** issue, not code. **Action (ops, no code change):** check the Gmail spam/Promotions folder; check the Resend dashboard for that message's delivery status (delivered/bounced); verify `artpark.info` DKIM/SPF/DMARC for Gmail. Out of scope for this code fix.

## 4. Fix

**File:** `backend/app/services/admin_query.py`, function `fetch_roster()` only.

Make its two nested bulk-fetch helpers paginate through `.range(offset, offset+999)` until a short page returns, instead of a single capped `.select("*")`:

```python
    _PAGE = 1000

    def _fetch(table: str) -> list[dict]:
        rows: list[dict] = []
        offset = 0
        try:
            while True:
                page = (sb.table(table).select("*")
                        .range(offset, offset + _PAGE - 1).execute().data) or []
                rows.extend(page)
                if len(page) < _PAGE:
                    break
                offset += _PAGE
        except Exception as exc:
            log.warning("roster: fetch failed", extra={"table": table, "err": str(exc)})
        return rows

    def _fetch_in(table: str, col: str) -> list[dict]:
        if not id_list:
            return []
        rows: list[dict] = []
        offset = 0
        try:
            while True:
                page = (sb.table(table).select("*").in_(col, id_list)
                        .range(offset, offset + _PAGE - 1).execute().data) or []
                rows.extend(page)
                if len(page) < _PAGE:
                    break
                offset += _PAGE
        except Exception as exc:
            log.warning("roster: fetch_in failed", extra={"table": table, "err": str(exc)})
        return rows
```

This one change fixes every roster sub-fetch: `reviewer_assignments` (the 3,320-row culprit), plus `reviews`, `ai_screening`, `application_batches`, `profiles`, `reviewer_profiles` — all become complete and stay correct as data grows. No behavior change other than "return all rows instead of the first 1,000."

**Deliberately NOT reusing `iter_assignment_rows`:** that helper returns only assignment-specific columns and only covers `reviewer_assignments`; generic pagination in the two helpers fixes `reviews`/`ai_screening`/`application_batches` too, and keeps the change entirely inside `fetch_roster` (zero coupling to the parallel session's functions).

## 5. Testing (TDD)

`backend/tests/test_roster_pagination.py`:
- A fake Supabase client whose `.range(start,end)` returns successive 1,000-row pages of a synthetic `reviewer_assignments` table with **> 1,000 rows across ≥ 2 reviewers** (e.g., 1,200 rows). Assert `fetch_roster()` attributes the **full** per-reviewer counts (e.g. reviewer X shows all their N assignments, not a truncated count), proving the loop reads beyond page 1.
- A page-boundary case (exactly 1,000 rows → one extra empty/short page terminates the loop; no infinite loop).
- Run with `--no-cov` for the single-file run (repo coverage gate).

## 6. Deploy & coordination (parallel session aware)

- Implement in the isolated worktree `.claude/worktrees/roster-pagination` on `fix/reviewer-roster-pagination` (off `2da2d09`). Reuse the primary `.venv`; copy `.env` for tests, `.env.prod` (with **both** `TIR_/SIP_SUBMISSIONS_CLOSED=true`) for deploy — re-grep the flags before any deploy (per [[project-tir-intake-closed]]).
- **Do not push to `release/sip-launch-v1`.** Push `fix/reviewer-roster-pagination` to origin as its own branch.
- **Merge + deploy is coordinated with the user**, because the parallel session is mid-flight on `admin_query.py`. Options: (a) user merges this branch to release once the parallel work lands and deploys once; or (b) if deployed sooner, ensure the deploy is from a worktree that also carries the parallel session's committed work to avoid a Lambda-code race (`sam build` reads disk). The merge itself is expected to be conflict-free (different function).
- Backend-only (API Lambda). No migration, no frontend change.
- Post-deploy verify: `fetch_roster` returns correct counts (re-run the prod check showing `defd24a9` → 449 and "Batch B (328) + Batch D (121)"); intake flags unchanged.

## 7. Out of scope

- The missing invite email (deliverability — §3; ops check, no code).
- The `created: 0` silent re-assign feedback and the duplicate "Udayan"/"Udayan pawar" accounts + `AI_` domain artifact (cosmetic).
- Any change to the assign paths, `iter_assignment_rows`, or the parallel session's files.
