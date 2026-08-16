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
over-generate a long backlog of periods the founder never owed). See
`_resolve_onboarded_on` for the fallback when no such row exists yet.

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

    Falls back to today when no such row exists yet. That is reachable only
    for a founder whose application is 'offered' but not yet 'onboarded' —
    require_founder_access's own gate admits both statuses, but MIS
    reporting has no real start date before actual onboarding. The safe
    failure mode here is to under-generate (a single period starting today,
    nothing retroactive) rather than invent a historical date — the same
    no-fail-open spirit `ensure_periods` applies by raising on a malformed
    `onboarded_on`, just applied here to a missing signal instead of a bad
    one.
    """
    rows = (
        get_admin_client().table("application_status_log").select("changed_at")
        .eq("application_id", ctx["application_id"])
        .eq("application_track", ctx["track"])
        .eq("to_status", "onboarded")
        .execute().data or []
    )
    dates = [_ist_date_of(r["changed_at"]) for r in rows if r.get("changed_at")]
    return min(dates) if dates else mp.today_ist()


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
    off-limits to edit for this task."""
    if bundle["period"]["kind"] == "monthly":
        trl = _current_verified_trl(application_id)
        for m in bundle["metrics"]:
            if m.get("metric_key") == "trl_level":
                m["actual"] = trl
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
    Deliberately excludes the annual_revenue bucket labels — those are
    period-relative (`mis_catalog.annual_revenue_buckets`), so there is no
    single answer at the index level; the per-period detail bundle
    (`mis_query.period_bundle`) carries them, scoped to that period's own
    fiscal year."""
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
        "financial_buckets_needs": cat.FINANCIAL_BUCKETS["needs"],
    }


@router.get("")
async def get_mis(ctx: Annotated[dict, Depends(require_vip)]) -> dict:
    onboarded_on = _resolve_onboarded_on(ctx)
    today = mp.today_ist()
    out: dict[str, Any] = {"catalog": _index_catalog()}
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

    period = _own_draft_period(ctx, kind, period_key)
    if body:
        rows = [{
            "period_id": period["id"], "metric_key": item.metric_key,
            "target": item.target, "actual": item.actual,
            "rag": item.rag, "commentary": item.commentary,
        } for item in body]
        get_admin_client().table("vip_mis_metrics").upsert(
            rows, on_conflict="period_id,metric_key"
        ).execute()
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

@router.put("/{kind}/{period_key}/entries/{section}")
async def put_entries(
    kind: str, period_key: str, section: str, body: list[dict[str, Any]],
    ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    """Replaces every `vip_mis_entries` row for `(period_id, section)` with
    `body`, in one delete followed by one insert.

    Concurrency: this is NOT atomic. PostgREST offers no client-side
    multi-statement transaction and this project has no `exec_sql` RPC (see
    mis_query.py's own module docstring), and `vip_mis_entries` deliberately
    carries no unique constraint (two milestones may legitimately share a
    title), so there is no constraint here to catch a collision the way the
    metrics/financials/headcount upserts below are protected by one.

    Two concurrent PUTs for the same section can therefore still interleave
    between this delete and this insert. The ordering below (delete first,
    insert second, scoped tightly to `(period_id, section)` on both) is
    chosen so the *observable* failure mode of that interleaving is rows
    going missing — recoverable, and visible the moment the founder reloads
    the section and sees it short — rather than rows getting duplicated,
    which nothing here or in the schema would ever surface or clean up. A
    retry of a partial failure is safe (the retry's own delete clears
    whatever the partial attempt left behind before it re-inserts), but two
    genuinely concurrent requests racing each other is a residual window
    this endpoint does not close. A `seeded_at`-style claim column (the
    same remedy Task 5's review recorded as a deliberate, deferred follow-up
    for the carry-forward race) would close it properly; that is a schema
    change and is out of scope here.
    """
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
    sb.table("vip_mis_entries").delete().eq("period_id", period["id"]).eq("section", section).execute()
    if body:
        sb.table("vip_mis_entries").insert([
            {"period_id": period["id"], "section": section, "sort_order": i, "data": dict(row)}
            for i, row in enumerate(body)
        ]).execute()
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
