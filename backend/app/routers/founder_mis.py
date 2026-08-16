"""VIP MIS reporting — monthly update + quarterly review.

Gate: `require_founder_access` resolves the caller's own application; this
router additionally rejects any non-VIP track via `require_vip`, whose
shape is copied from `founder_air.py` rather than imported — the two
routers have different prefixes, and this is a deliberate, acknowledged
duplication of a six-line guard (see the phase's own pre-flight scan).
Ownership is therefore structural throughout this file: `application_id`
always comes from `ctx`, never from a path/body/query parameter, and every
read or write below is scoped by it.

Freeze semantics (constraint 6): every write handler resolves the period
via `_own_draft_period`, which 409s `mis_already_submitted` on anything but
a draft. Every read handler uses `_fetch_own_period`/`mq.period_bundle`
instead — no status gate at all — so a submitted period stays fully
readable for the life of the round. Phase 2 shipped exactly the opposite
mistake on a read endpoint (locking founders out of their own submitted
documents); this file is deliberately asymmetric to avoid repeating it.

Onboarding-date resolution: `mis_periods.expected_periods` needs the
venture's onboarding date to compute which calendar periods exist, but no
table carries that as its own column. `application_status_log`
(state_machine.py's audit trail of every status transition) is the actual
record of when this application moved to 'onboarded', so `GET /founder/mis`
reads its earliest such row rather than reusing `submitted_at` (which is
when the application was filed — typically months earlier, and would
over-generate a long backlog of periods the founder never owed). `GET
/founder/mis` only attempts this at all when `ctx["status"] == "onboarded"`
— an `offered` founder owes nothing yet and gets an empty calendar, not a
guessed one. See `_resolve_onboarded_on` for the fallback this still needs
for an onboarded founder whose status-log row is itself missing (a real,
if rare, data-quality gap — not the normal case).

TRL sourcing (constraint 4): `_current_verified_trl` reads live from the
AIR tables via `aq.fetch_round`/`aq.fetch_lever_scores` — never
`aq.ensure_round`, so viewing or saving MIS never side-effect-creates an
AIR round the founder has not opened AIR for — and is applied to a
period_bundle's response by `_with_trl` as a response-shaping step, because
`mis_query.py` is off-limits to edit for this task and cannot be taught to
do this itself.
"""
from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from ..models.mis import FinancialAmountIn, HeadcountRowIn, MetricIn
from ..services import air_query as aq
from ..services import air_scoring as sc
from ..services import mis_catalog as cat
from ..services import mis_periods as mp
from ..services import mis_query as mq
from ..supabase_client import get_admin_client
from .founder import require_founder_access

log = logging.getLogger(__name__)

router = APIRouter(prefix="/founder/mis", tags=["founder-mis"])


def require_vip(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    """MIS is a VIP-programme instrument, same as AIR; TIR runs its own
    residency track and has no MIS surface."""
    if ctx["track"] != "sip":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={"code": "not_available_for_track"},
        )
    return ctx


# ── onboarding-date resolution ───────────────────────────────────────────

_IST = ZoneInfo("Asia/Kolkata")


def _ist_date_of(value: str | datetime) -> date:
    """A timestamptz column value — an ISO string from Postgrest, or a
    datetime already — as an Asia/Kolkata calendar date. Same conversion
    `mis_periods._ist_date` performs, reimplemented rather than imported:
    that helper is private to its own module, and this repo's own
    precedent (`require_vip` above) is to copy a small guard across a
    module boundary rather than reach into another module's underscored
    internals."""
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(_IST).date()


def _resolve_onboarded_on(ctx: dict) -> date:
    """The venture's onboarding month (spec §5.1), read from
    `application_status_log` — the earliest row where this application
    moved `to_status = 'onboarded'` — because no application table carries
    that date as its own column. Deliberately NOT `submitted_at`: that is
    when the application was filed, typically months before an offer is
    even made, and would over-generate a long backlog of periods (all
    already overdue) the founder never actually owed.

    Earliest such transition is used on purpose, in case of a
    reopen-then-reapprove: the calendar should not roll forward just
    because status moved back to 'onboarded' a second time.

    Falls back to today when no such row exists. `get_mis` only calls this
    for a founder whose status IS ALREADY `'onboarded'` (see its own status
    gate) — so an empty result here is never the ordinary "not onboarded
    yet" case, it is a genuine data-quality gap: `state_machine.py`'s
    status-log insert is best-effort (a failed write there is swallowed and
    only logged as a warning, it does not roll back the status change
    itself — see state_machine.py's own transition method), and a status
    set by a direct Studio edit or manual data injection — this repo has a
    documented history of both — writes no log row at all. Logged at
    WARNING with the application_id so a silently missing reporting backlog
    is visible in the logs rather than only discovered by a founder noticing
    their calendar is empty. The safe failure mode is still to
    under-generate (a single period starting today, nothing retroactive)
    rather than invent a historical date — the same no-fail-open spirit
    `ensure_periods` applies by raising on a malformed `onboarded_on`, just
    applied here to a missing signal instead of a bad one.
    """
    rows = (
        get_admin_client().table("application_status_log").select("changed_at")
        .eq("application_id", ctx["application_id"])
        .eq("application_track", ctx["track"])
        .eq("to_status", "onboarded")
        .execute().data or []
    )
    dates = [_ist_date_of(r["changed_at"]) for r in rows if r.get("changed_at")]
    if dates:
        return min(dates)
    log.warning(
        "founder_mis: onboarded application has no application_status_log "
        "'onboarded' transition; falling back to today as onboarded_on",
        extra={"application_id": ctx["application_id"], "track": ctx["track"]},
    )
    return mp.today_ist()


# ── TRL sourcing (constraint 4) ──────────────────────────────────────────

def _current_verified_trl(application_id: str) -> int | None:
    """The monthly metric grid's one computed row: `trl_level`'s `actual`,
    read live from the founder's CURRENT (this quarter's) verified overall
    AIR level — never persisted to `vip_mis_metrics`, never taken from a
    request. Same "derive, never store" rule `mis_query._derived` applies
    to vs_last/needs_gap/net_change, extended here to a value that lives in
    another module's tables entirely.

    Uses `aq.fetch_round` (read-only), not `aq.ensure_round`: opening or
    saving an MIS period must never side-effect-create an AIR round for a
    quarter the founder has not touched AIR for.

    Returns None whenever there is no AIR round yet for the current
    quarter, or when any of the six levers is unverified
    (`air_scoring.rollups`' own "a family with an unscored lever has no
    defensible score" rule, reused as-is rather than re-derived). Since no
    admin surface writes `verified_level` anywhere in this codebase yet,
    that is every round that exists today — expected, not a bug: it is
    exactly the "leave it null rather than inventing a value" instruction.
    """
    label = aq.current_round_label(mp.today_ist())
    rnd = aq.fetch_round(application_id, label)
    if rnd is None:
        return None
    verified = {
        row["lever"]: row.get("verified_level")
        for row in aq.fetch_lever_scores(rnd["id"])
    }
    return sc.rollups(verified)["overall"]


def _with_trl(bundle: dict, application_id: str) -> dict:
    """Overwrites `trl_level`'s `actual` in a period_bundle's metrics list
    with the live-computed verified AIR level, for monthly periods only —
    quarterly bundles carry no metrics at all. Done as a response-shaping
    step here, not inside `mis_query.period_bundle`, because that module is
    off-limits to edit for this task.

    Builds a fresh list (and a fresh dict for the one row it changes)
    rather than mutating `bundle["metrics"]`'s rows in place — the
    "copy before you mutate" discipline `mis_query.py` states explicitly
    for exactly this reason: under `FakeSupabase`, `.select().execute().data`
    returns references straight into the fake's own stored table rows, not
    fresh copies, so an in-place `m["actual"] = trl` would silently corrupt
    the test double's stored `vip_mis_metrics` state rather than only
    shaping this one response."""
    if bundle["period"]["kind"] == "monthly":
        trl = _current_verified_trl(application_id)
        bundle["metrics"] = [
            {**m, "actual": trl} if m.get("metric_key") == "trl_level" else m
            for m in bundle["metrics"]
        ]
    return bundle


def _bundle(ctx: dict, kind: str, period_key: str) -> dict:
    return _with_trl(mq.period_bundle(ctx["application_id"], kind, period_key),
                      ctx["application_id"])


# ── ownership + freeze ───────────────────────────────────────────────────

def _fetch_own_period(ctx: dict, kind: str, period_key: str) -> dict:
    """kind/period_key resolved into the caller's own period row — never a
    path-supplied id trusted on its own. 404s on an unknown kind or a
    period_key that has not been created yet: only `GET /founder/mis` (via
    `ensure_periods`) creates period rows; every route below reads or
    writes one that must already exist."""
    if kind not in cat.KINDS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_kind"})
    period = mq.fetch_period(ctx["application_id"], kind, period_key)
    if period is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    return period


def _own_draft_period(ctx: dict, kind: str, period_key: str) -> dict:
    """`_fetch_own_period`, plus require the period still be a draft
    (constraint 6). Every write handler below calls this; every read
    handler calls `_fetch_own_period` directly instead — see the module
    docstring for why that split must never be blurred."""
    period = _fetch_own_period(ctx, kind, period_key)
    if period["status"] != "draft":
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT,
                            detail={"code": "mis_already_submitted"})
    return period


def _stamp_updated_at(period_id: str) -> None:
    """Every write handler below calls this after its own table write, so
    `vip_mis_periods.updated_at` reflects the period's true last-edited
    time regardless of which child table the edit actually touched — not
    only the two writes (`narrative`, `submit`) that happen to already
    update the `vip_mis_periods` row directly for another reason."""
    get_admin_client().table("vip_mis_periods").update({
        "updated_at": datetime.now(UTC).isoformat(),
    }).eq("id", period_id).execute()


# ── index catalog ─────────────────────────────────────────────────────────

def _entries_sections_for_kind(kind: str) -> list[str]:
    """Every entries-section id `kind` actually owns, unioned with
    `mis_catalog.SECTION_EXTRA_ENTRIES` per that module's documented
    convention (mirrors `mis_query._entries_sections_for_kind`, which is
    private to its module — reimplemented here for the same reason
    `_ist_date_of` is)."""
    ids: list[str] = []
    for s in cat.SECTIONS[kind]:
        if s["type"] == "entries":
            ids.append(s["id"])
            ids.extend(cat.SECTION_EXTRA_ENTRIES.get(s["id"], []))
    return ids


def _narrative_field_ids(kind: str) -> set[str]:
    """Every narrative field id valid for `kind` — the union of
    `NARRATIVE_FIELDS[sid]` over every section id `kind` actually has, so a
    monthly narrative PUT cannot smuggle in a quarterly-only field id (or
    vice versa)."""
    section_ids = {s["id"] for s in cat.SECTIONS[kind]}
    return {
        f["id"]
        for sid, fields in cat.NARRATIVE_FIELDS.items() if sid in section_ids
        for f in fields
    }


def _index_catalog() -> dict:
    """The period-independent slice of the catalog `GET /founder/mis`
    needs: every section for both kinds, their narrative prompts and entry
    field schemas, plus the metric/headcount/financial-series definitions.
    `financial_buckets` deliberately carries only `"needs"`, not
    `"annual_revenue"` — those buckets are period-relative
    (`mis_catalog.annual_revenue_buckets`), so there is no single answer at
    the index level; the per-period detail bundle (`mis_query.period_bundle`)
    carries the full `{"annual_revenue", "needs"}` shape, scoped to that
    period's own fiscal year. Nested under the same `financial_buckets` key
    the detail bundle uses (rather than a separate `financial_buckets_needs`
    key) so a frontend reader can use one access path, `.financial_buckets
    .needs`, against either response."""
    all_entry_ids = {sid for kind in cat.KINDS for sid in _entries_sections_for_kind(kind)}
    return {
        "kinds": list(cat.KINDS),
        "sections": cat.SECTIONS,
        "narrative_fields": cat.NARRATIVE_FIELDS,
        "entry_fields": {sid: cat.entry_fields(sid) for sid in all_entry_ids},
        "metrics": cat.METRICS,
        "metric_groups": cat.METRIC_GROUPS,
        "headcount_categories": cat.HEADCOUNT_CATEGORIES,
        "financial_series": cat.FINANCIAL_SERIES,
        "financial_buckets": {"needs": cat.FINANCIAL_BUCKETS["needs"]},
    }


@router.get("")
async def get_mis(ctx: Annotated[dict, Depends(require_vip)]) -> dict:
    out: dict[str, Any] = {"catalog": _index_catalog()}
    if ctx["status"] != "onboarded":
        # require_founder_access admits 'offered' as well as 'onboarded',
        # but MIS reporting has no real start date before actual onboarding
        # — generating a calendar from a guessed date would create period
        # rows that then persist forever and go overdue the moment their
        # due_date passes (periods_index lists every EXISTING row, not the
        # expected calendar, so nothing later prunes a spurious one). An
        # 'offered' founder owes nothing yet; give them an empty calendar
        # rather than one manufactured from a placeholder date.
        for kind in cat.KINDS:
            out[kind] = []
        return out
    onboarded_on = _resolve_onboarded_on(ctx)
    today = mp.today_ist()
    for kind in cat.KINDS:
        mq.ensure_periods(ctx["application_id"], kind, onboarded_on, today)
        out[kind] = mq.periods_index(ctx["application_id"], kind, today)
    return out


@router.get("/{kind}/{period_key}")
async def get_period(kind: str, period_key: str,
                      ctx: Annotated[dict, Depends(require_vip)]) -> dict:
    _fetch_own_period(ctx, kind, period_key)
    return _bundle(ctx, kind, period_key)


# ── metrics (monthly only) ────────────────────────────────────────────────

_METRIC_KEYS = {m["key"] for m in cat.METRICS}
_METRIC_BY_KEY = {m["key"]: m for m in cat.METRICS}
# 045_vip_mis.sql: `rag text check (rag in ('green','amber','red'))`. Not
# validated here would mean a bad value 500s (23514, unhandled) instead of
# a clean 422 — the same class of gap the duplicate-key check below closes.
_RAG_VALUES = {"green", "amber", "red"}


@router.put("/{kind}/{period_key}/metrics")
async def put_metrics(
    kind: str, period_key: str, body: list[MetricIn],
    ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    if kind not in cat.KINDS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_kind"})
    if kind != "monthly":
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    for item in body:
        if item.metric_key not in _METRIC_KEYS:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "unknown_field", "field": item.metric_key})
        if item.metric_key == "trl_level" and item.actual is not None:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "computed_metric", "field": "actual"})
        if item.rag is not None and item.rag not in _RAG_VALUES:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "invalid_value", "field": "rag"})
    keys = [item.metric_key for item in body]
    if len(keys) != len(set(keys)):
        # PostgREST's upsert compiles to a single ON CONFLICT DO UPDATE
        # statement; two rows in one payload sharing a conflict target hit
        # Postgres 21000 ("command cannot affect row a second time") and
        # 500 rather than reject cleanly — reject before it ever reaches
        # that statement.
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "duplicate_key", "field": "metric_key"})

    period = _own_draft_period(ctx, kind, period_key)
    if body:
        rows = []
        for item in body:
            catalog_row = _METRIC_BY_KEY[item.metric_key]
            rows.append({
                "period_id": period["id"], "metric_key": item.metric_key,
                # label/group_key are NOT NULL with no default (045_vip_mis.sql)
                # and are not part of the unique key, so a plain upsert of
                # only the founder-editable columns would 23502 the moment
                # this row does not already exist — reachable whenever a PUT
                # lands on a period whose children were never reconciled
                # (`_own_draft_period` deliberately does not reconcile; only
                # `mis_query.ensure_periods`/`period_bundle` do).
                "label": catalog_row["label"], "group_key": catalog_row["group"],
                "unit": catalog_row["unit"],
                "target": item.target, "actual": item.actual,
                "rag": item.rag, "commentary": item.commentary,
            })
        get_admin_client().table("vip_mis_metrics").upsert(
            rows, on_conflict="period_id,metric_key"
        ).execute()
    _stamp_updated_at(period["id"])
    return _bundle(ctx, kind, period_key)


# ── narrative (whole-blob replace) ────────────────────────────────────────

@router.put("/{kind}/{period_key}/narrative")
async def put_narrative(
    kind: str, period_key: str, body: dict[str, str | None],
    ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    if kind not in cat.KINDS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_kind"})
    unknown = set(body.keys()) - _narrative_field_ids(kind)
    if unknown:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "unknown_field", "fields": sorted(unknown)})

    period = _own_draft_period(ctx, kind, period_key)
    get_admin_client().table("vip_mis_periods").update({
        "narrative": body, "updated_at": datetime.now(UTC).isoformat(),
    }).eq("id", period["id"]).execute()
    return _bundle(ctx, kind, period_key)


# ── entries (wholesale section replace) ───────────────────────────────────

def _replace_entries_section(sb, period_id: str, section: str,
                              rows: list[dict[str, Any]]) -> None:
    """Replaces every `vip_mis_entries` row for `(period_id, section)` with
    `rows`, converged against a concurrent writer doing the same thing.

    Not atomic: PostgREST offers no client-side multi-statement transaction
    and this project has no `exec_sql` RPC (see mis_query.py's own module
    docstring), and `vip_mis_entries` deliberately carries no unique
    constraint (two milestones may legitimately share a title), so there is
    no constraint here to catch a collision the way the metrics/financials/
    headcount upserts are protected by one.

    Six interleavings are possible between two concurrent callers A and B,
    each individually ordered delete-before-insert. In four of them both
    deletes land before either insert — each delete finds nothing left to
    remove — so the result is the UNION of A's and B's rows: duplicates, not
    missing rows. (An earlier version of this function's docstring claimed
    the opposite; it was wrong, and so was the ordering rationale behind
    it — plain delete-then-insert cannot make missing rows the failure mode,
    because ordering the two statements within ONE writer says nothing about
    how two writers' statements interleave with each other.) The duplicates
    are also not silent (the section renders doubled on the founder's next
    reload) and not permanent on their own (the next wholesale PUT to the
    same section clears and re-inserts, converging normally) — the one case
    that is NOT self-healing is a period that gets submitted while carrying
    doubled rows: writes freeze at that point, so the duplicate survives
    into the statutory report until an admin reopens the period.

    Mitigation, not a fix: write once, then re-select this exact
    `(period_id, section)`'s row count. A count that does not match what
    was just written means a concurrent writer's insert landed inside this
    call's own window, so delete and re-insert (this writer's own `rows`)
    once more — the same "insert; on a mismatch, reconcile once" discipline
    `mis_query.py` uses throughout for its own convergent writes, applied
    here at the router boundary since that module is off-limits to edit for
    this task. This converges to last-writer-wins for the common case where
    the colliding writer's insert has already landed by the time this
    writer reads back; it does NOT close the window entirely — a writer
    whose own insert lands strictly after the OTHER writer's read-back check
    is not caught by that other writer's retry, so a vanishingly narrow
    version of the same race still exists one layer down. Closing it fully
    needs a real mutex (a `seeded_at`/version claim column — the same
    remedy Task 5's review recorded as a deliberate, deferred follow-up for
    the carry-forward race), which is a schema change and out of scope
    here.
    """
    def _write() -> None:
        sb.table("vip_mis_entries").delete().eq("period_id", period_id).eq("section", section).execute()
        if rows:
            sb.table("vip_mis_entries").insert([
                {"period_id": period_id, "section": section, "sort_order": i, "data": dict(row)}
                for i, row in enumerate(rows)
            ]).execute()

    _write()
    after = (
        sb.table("vip_mis_entries").select("id")
        .eq("period_id", period_id).eq("section", section).execute().data or []
    )
    if len(after) != len(rows):
        _write()


@router.put("/{kind}/{period_key}/entries/{section}")
async def put_entries(
    kind: str, period_key: str, section: str, body: list[dict[str, Any]],
    ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    if kind not in cat.KINDS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_kind"})
    if section not in _entries_sections_for_kind(kind):
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_section"})
    fields = {f["key"] for f in cat.entry_fields(section)}
    for row in body:
        unknown = set(row.keys()) - fields
        if unknown:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "unknown_field", "fields": sorted(unknown)})

    period = _own_draft_period(ctx, kind, period_key)
    sb = get_admin_client()
    _replace_entries_section(sb, period["id"], section, body)
    _stamp_updated_at(period["id"])
    return _bundle(ctx, kind, period_key)


# ── financials (quarterly only) ───────────────────────────────────────────

_ANNUAL_REVENUE_SERIES = tuple(s["key"] for s in cat.FINANCIAL_SERIES["annual_revenue"])
# needs_gap is deliberately excluded — it is computed on read
# (mis_query._needs_gap), never stored, and is rejected below as a
# computed_metric the same way trl_level is.
_NEEDS_SERIES = ("needs_total", "needs_confirmed", "needs_projected")


def _fy_start_year(period_start: date) -> int:
    """The calendar year the reporting period's Indian FY starts in — same
    rule as `mis_query._fy_start_year` (private to its module), applied
    here to validate the buckets a financials PUT is allowed to name."""
    return period_start.year if period_start.month >= 4 else period_start.year - 1


@router.put("/{kind}/{period_key}/financials")
async def put_financials(
    kind: str, period_key: str, body: list[FinancialAmountIn],
    ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    if kind not in cat.KINDS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_kind"})
    if kind != "quarterly":
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    for item in body:
        if item.series == "needs_gap":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "computed_metric", "field": "series"})
        if item.series not in _ANNUAL_REVENUE_SERIES and item.series not in _NEEDS_SERIES:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "unknown_field", "field": "series"})
    conflict_keys = [(item.series, item.bucket) for item in body]
    if len(conflict_keys) != len(set(conflict_keys)):
        # Same class of gap as the metrics duplicate-key check: two rows in
        # one payload sharing (series, bucket) would hit Postgres 21000 on
        # the upsert below rather than reject cleanly. Checked here, ahead
        # of bucket validity, because duplicate detection needs only the
        # request itself — not the period's fiscal year the bucket check
        # below needs.
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "duplicate_key", "field": "series,bucket"})

    # Bucket validity for the annual_revenue series is relative to this
    # period's own fiscal year, so it cannot be checked until the period is
    # resolved — series-only checks stay above, ahead of the ownership/
    # freeze gate, and bucket checks happen after.
    period = _own_draft_period(ctx, kind, period_key)
    fy_start_year = _fy_start_year(period["period_start"])
    valid_annual_buckets = set(cat.annual_revenue_buckets(fy_start_year))
    valid_needs_buckets = set(cat.FINANCIAL_BUCKETS["needs"])

    rows = []
    for item in body:
        valid_buckets = (
            valid_annual_buckets if item.series in _ANNUAL_REVENUE_SERIES
            else valid_needs_buckets
        )
        if item.bucket not in valid_buckets:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "unknown_field", "field": "bucket"})
        rows.append({
            "period_id": period["id"], "series": item.series, "bucket": item.bucket,
            "amount": item.amount,
        })
    if rows:
        get_admin_client().table("vip_mis_financials").upsert(
            rows, on_conflict="period_id,series,bucket"
        ).execute()
    _stamp_updated_at(period["id"])
    return _bundle(ctx, kind, period_key)


# ── headcount (quarterly only) ────────────────────────────────────────────

_HEADCOUNT_KEYS = {c["key"] for c in cat.HEADCOUNT_CATEGORIES}


@router.put("/{kind}/{period_key}/headcount")
async def put_headcount(
    kind: str, period_key: str, body: list[HeadcountRowIn],
    ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    if kind not in cat.KINDS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_kind"})
    if kind != "quarterly":
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    for item in body:
        if item.category not in _HEADCOUNT_KEYS:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "unknown_field", "field": item.category})
    categories = [item.category for item in body]
    if len(categories) != len(set(categories)):
        # Same class of gap as the metrics/financials duplicate-key checks:
        # two rows sharing `category` would hit Postgres 21000 on the
        # upsert below rather than reject cleanly.
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "duplicate_key", "field": "category"})

    period = _own_draft_period(ctx, kind, period_key)
    if body:
        rows = [{
            "period_id": period["id"], "category": item.category,
            "current_count": item.current_count, "exited": item.exited,
            "remarks": item.remarks,
        } for item in body]
        get_admin_client().table("vip_mis_headcount").upsert(
            rows, on_conflict="period_id,category"
        ).execute()
    _stamp_updated_at(period["id"])
    return _bundle(ctx, kind, period_key)


# ── submit ─────────────────────────────────────────────────────────────

@router.post("/{kind}/{period_key}/submit")
async def submit_period(
    kind: str, period_key: str, ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    period = _own_draft_period(ctx, kind, period_key)
    now = datetime.now(UTC).isoformat()
    get_admin_client().table("vip_mis_periods").update({
        "status": "submitted", "submitted_at": now, "updated_at": now,
    }).eq("id", period["id"]).execute()
    return _bundle(ctx, kind, period_key)
