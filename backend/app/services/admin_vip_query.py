"""Admin "VIP cohort" verification surface — reads + writes for the AIR
verification queue and the MIS submissions matrix (spec §7).

Read helpers reuse `air_query.assessment_bundle` / `mis_query.period_bundle`
rather than re-deriving lever levels or period shapes: the founder-facing
`claimed` computation and the admin-facing `claimed` shown here must never
be able to drift, since the verifier is confirming/downgrading against
exactly what the founder's own wizard would show. This module never calls
`air_query.ensure_round`/`mis_query.ensure_periods` directly with a
newly-chosen round/period — every write is scoped by an explicit id path
(`assessment_id` for AIR, `(application_id, kind, period_key)` for MIS),
never by "the current round"/"the latest period" by implicit resolution
(Ruling 2 — verification is per-round).

List reads page past PostgREST's ~1000-row default cap via
`admin_query._fetch_all` (reused, not re-implemented — this project has
shipped that exact bug three times already). `vip_air_lever_scores` reads
scoped to a single assessment id are the one exception: a round always has
exactly six lever rows by construction, so `air_query.fetch_lever_scores`'s
own unpaginated `.eq()` is safe to reuse as-is.
"""
from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import HTTPException, status

from ..supabase_client import get_admin_client
from . import air_catalog, air_query, air_scoring, applications_query, mis_periods, mis_query, stats
from .admin_query import _fetch_all
from .audit import write_audit

# Mirrors founder_air.py's own `BUCKET` constant (044_vip_air.sql's bucket
# id) rather than importing it: that constant lives in a router module, and
# a service must not depend on a router — the same layering this repo
# already keeps by re-implementing small guards across module boundaries
# (e.g. founder_mis.py's `require_vip`, copied from founder_air.py's rather
# than imported).
_AIR_BUCKET = "vip-founder-docs"

_LEVER_ORDER = {k: i for i, k in enumerate(air_catalog.LEVER_KEYS)}
_LEVER_BY_KEY = {l["key"]: l for l in air_catalog.LEVERS}


# ── shared: startup display names ────────────────────────────────────────

def _startup_names(application_ids: list[str]) -> dict[str, str]:
    """Best-effort display name per VIP application id: the AI-extracted
    project_name where available (`applications_query.fetch_project_names_for`,
    reused rather than re-derived), else the same `basic_org`/`solution_describe`
    heuristic the admin pipeline already falls back to
    (`stats.derive_project_name`). Every VIP-only table's `application_id` is
    a real `sip_applications(id)` FK (spec §4.6/§5.1) — the track is always
    "sip" here, never resolved or guessed.
    """
    ids = sorted(set(application_ids))
    if not ids:
        return {}
    sb = get_admin_client()
    names = applications_query.fetch_project_names_for([("sip", aid) for aid in ids])
    rows = _fetch_all(
        lambda: sb.table("sip_applications")
        .select("id,basic_org,solution_describe")
        .in_("id", ids)
    )
    by_id = {r["id"]: r for r in rows}
    out: dict[str, str] = {}
    for aid in ids:
        name = names.get(("sip", aid))
        if not name:
            name = stats.derive_project_name(by_id.get(aid))
        out[aid] = name or "(unnamed)"
    return out


# ── AIR verification queue ───────────────────────────────────────────────

def _signed_url(sb, storage_path: str) -> str | None:
    """Best-effort signed URL for one evidence object, same 300s TTL and
    response-shape handling as `founder_air.evidence_signed_url` (not
    imported for the same router/service layering reason `_AIR_BUCKET`
    isn't). Returns `None` rather than raising: a queue/detail READ must
    not fail wholesale because one storage object's signing call errored —
    the row still carries every other field, with just that evidence link
    absent, which the verifier can retry rather than losing the whole
    round's detail view.
    """
    try:
        signed = sb.storage.from_(_AIR_BUCKET).create_signed_url(storage_path, 300)
    except Exception:
        return None
    if isinstance(signed, dict):
        return signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
    if isinstance(signed, str):
        return signed
    return None


def fetch_air_queue() -> dict:
    """Every lever still awaiting verification, across every submitted VIP
    AIR round (spec §7: rows are "(startup, lever, claimed level,
    submitted)"). One row per (assessment, lever) whose `verified_level` is
    still null — a lever the assessment's verifier already confirmed or
    downgraded drops off the queue rather than reappearing as if it still
    needed action (an assessment stays `submitted`, not yet `verified`,
    until all six of its levers carry a `verified_level` — see
    `_finalize_if_complete`), and its detail stays reachable regardless via
    the assessment endpoint.

    `claimed_level` is recomputed live from the stored answers via
    `air_scoring.lever_level`, never read off the `claimed_level` column —
    the same rule `air_query.assessment_bundle` already applies, so a
    catalog revision can never leave a stale number in the queue.
    """
    sb = get_admin_client()
    assessments = _fetch_all(
        lambda: sb.table("vip_air_assessments").select("*").eq("status", "submitted")
    )
    if not assessments:
        return {"rows": []}

    assessment_ids = [a["id"] for a in assessments]
    lever_rows = _fetch_all(
        lambda: sb.table("vip_air_lever_scores").select("*").in_("assessment_id", assessment_ids)
    )
    by_assessment: dict[str, list[dict]] = {}
    for row in lever_rows:
        by_assessment.setdefault(row["assessment_id"], []).append(row)

    names = _startup_names([a["application_id"] for a in assessments])

    rows = []
    for a in assessments:
        for lever_row in by_assessment.get(a["id"], []):
            if lever_row.get("verified_level") is not None:
                continue
            lever = lever_row["lever"]
            claimed = air_scoring.lever_level(lever, {
                "q1": lever_row.get("q1_option"),
                "q2": lever_row.get("q2_option"),
                "q3": lever_row.get("q3_option"),
            })
            rows.append({
                "assessment_id": a["id"],
                "application_id": a["application_id"],
                "startup": names.get(a["application_id"], "(unnamed)"),
                "round_label": a["round_label"],
                "lever": lever,
                "lever_name": _LEVER_BY_KEY[lever]["name"],
                "family": _LEVER_BY_KEY[lever]["family"],
                "claimed_level": claimed,
                "submitted_at": a.get("submitted_at"),
            })
    rows.sort(key=lambda r: (r["submitted_at"] or "", r["startup"], _LEVER_ORDER.get(r["lever"], 99)))
    return {"rows": rows}


def _assessment_or_404(assessment_id: str) -> dict:
    rows = (
        get_admin_client().table("vip_air_assessments").select("*")
        .eq("id", assessment_id).limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "assessment_not_found"})
    return rows[0]


def _lever_row_or_404(assessment_id: str, lever: str) -> dict:
    for row in air_query.fetch_lever_scores(assessment_id):
        if row["lever"] == lever:
            return row
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                        detail={"code": "lever_not_found"})


def _require_submitted(a: dict) -> None:
    """Ruling 2 (per-round): a verify/confirm-all write only ever targets an
    assessment that is currently `submitted` — never `draft` (nothing to
    verify yet) and never already `verified` (that round's verification is
    done; reopening a verified AIR round, unlike an MIS period, is
    deliberately out of scope for this phase — see the phase report)."""
    if a["status"] != "submitted":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
            "code": "air_not_open_for_verification",
            "status": a["status"],
        })


def fetch_assessment_detail(assessment_id: str) -> dict:
    """Everything the verifier needs for one round in one read: the same
    bundle shape `air_query.assessment_bundle` gives the founder (levers
    with answers/criteria/claimed+verified, both rollup sets) — reused, not
    re-derived — plus a signed URL per evidence document (spec §7: "the
    evidence document behind a signed URL"), generated fresh on every read
    exactly like the founder's own `/founder/air/evidence/{id}/signed-url`,
    and the resolved startup name.
    """
    a = _assessment_or_404(assessment_id)
    bundle = air_query.assessment_bundle(a["application_id"], a["round_label"])
    bundle["round"]["verified_by"] = a.get("verified_by")
    bundle["application_id"] = a["application_id"]
    bundle["startup"] = _startup_names([a["application_id"]]).get(a["application_id"], "(unnamed)")

    sb = get_admin_client()
    for lever in bundle["levers"]:
        lever["evidence"] = [
            {**e, "signed_url": _signed_url(sb, e["storage_path"])}
            for e in lever["evidence"]
        ]
    return bundle


def _finalize_if_complete(assessment_id: str, actor_user_id: str) -> None:
    """After a lever write, checks whether all six levers of this assessment
    now carry a `verified_level` and — if so — flips the assessment to
    `verified` and publishes the rollups, computed over the VERIFIED set
    with the identical minimum-across-the-group rule `air_scoring.rollups`
    already applies to the claimed set (spec §7: "the same rule as the
    claimed rollups"). A no-op while any lever is still unverified, or (
    no-fail-open guard) while a lever row is altogether missing — which a
    submitted assessment should never have, since `submit_air` refuses to
    submit while any lever's `claimed_level` is null."""
    levers = air_query.fetch_lever_scores(assessment_id)
    verified = {row["lever"]: row.get("verified_level") for row in levers}
    if len(verified) < len(air_catalog.LEVER_KEYS) or any(v is None for v in verified.values()):
        return
    roll = air_scoring.rollups(verified)
    now = datetime.now(UTC).isoformat()
    get_admin_client().table("vip_air_assessments").update({
        "status": "verified",
        "verified_at": now,
        "verified_by": actor_user_id,
        "overall_verified": roll["overall"],
        "tech_verified": roll["technology"],
        "comm_verified": roll["commercial"],
        "updated_at": now,
    }).eq("id", assessment_id).execute()


def verify_lever(
    *, assessment_id: str, lever: str, verified_level: int,
    verifier_note: str | None, actor_user_id: str, actor_role: str | None = None,
) -> dict:
    """Confirms or downgrades one lever's AIR level (spec §7). Scoped
    entirely by `assessment_id` — never by "the current round" — so this can
    never write onto a lever of any round other than the one the caller is
    actually looking at (Ruling 2).

    `verified_level` may only confirm the founder's own claimed level or
    downgrade below it, never raise it above what was claimed: verification
    checks the evidence behind what the founder CLAIMED, it does not credit
    a venture with more maturity than it claimed for itself.
    """
    if lever not in air_catalog.LEVER_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_lever"})
    a = _assessment_or_404(assessment_id)
    _require_submitted(a)
    row = _lever_row_or_404(assessment_id, lever)
    claimed = air_scoring.lever_level(lever, {
        "q1": row.get("q1_option"), "q2": row.get("q2_option"), "q3": row.get("q3_option"),
    })
    if claimed is None:
        # A submitted assessment can never actually reach this in practice —
        # submit_air rejects the whole submission (422 air_incomplete) while
        # any lever's claimed_level is null — but guarded anyway per this
        # phase's no-fail-open constraint rather than trusted implicitly.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail={"code": "lever_not_claimed"})
    if not (1 <= verified_level <= claimed):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={
            "code": "verified_level_out_of_range",
            "claimed_level": claimed,
        })

    sb = get_admin_client()
    now = datetime.now(UTC).isoformat()
    sb.table("vip_air_lever_scores").update({
        "verified_level": verified_level,
        "verifier_note": verifier_note,
        "verified_at": now,
        "verified_by": actor_user_id,
        "updated_at": now,
    }).eq("assessment_id", assessment_id).eq("lever", lever).execute()

    _finalize_if_complete(assessment_id, actor_user_id)

    write_audit(
        actor_user_id=actor_user_id, actor_role=actor_role or "admin",
        action_type="vip_air_lever_verified",
        target_table="vip_air_lever_scores", target_id=assessment_id,
        after={"lever": lever, "verified_level": verified_level, "claimed_level": claimed},
    )
    return fetch_assessment_detail(assessment_id)


def confirm_all_at_claimed(
    *, assessment_id: str, actor_user_id: str, actor_role: str | None = None,
) -> dict:
    """Confirms every lever of an assessment at its own claimed level in one
    action (spec §7: "the common case"). Unconditionally overwrites all six
    lever rows' verified_level/verifier_note/verified_at/verified_by —
    including a lever an earlier call already verified or downgraded —
    because this is a single deliberate "confirm everything as claimed"
    action, not a merge: an admin who wants to keep an earlier downgrade
    uses the per-lever verify endpoint instead of this one.
    """
    a = _assessment_or_404(assessment_id)
    _require_submitted(a)
    levers = air_query.fetch_lever_scores(assessment_id)
    if len(levers) < len(air_catalog.LEVER_KEYS):
        # No-fail-open guard: a submitted assessment should always have all
        # six lever rows (ensure_round's own convergent reconciliation).
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail={"code": "air_incomplete"})

    sb = get_admin_client()
    now = datetime.now(UTC).isoformat()
    confirmed: dict[str, int] = {}
    for row in levers:
        lever = row["lever"]
        claimed = air_scoring.lever_level(lever, {
            "q1": row.get("q1_option"), "q2": row.get("q2_option"), "q3": row.get("q3_option"),
        })
        if claimed is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail={"code": "lever_not_claimed", "lever": lever})
        confirmed[lever] = claimed
        sb.table("vip_air_lever_scores").update({
            "verified_level": claimed,
            "verifier_note": None,
            "verified_at": now,
            "verified_by": actor_user_id,
            "updated_at": now,
        }).eq("assessment_id", assessment_id).eq("lever", lever).execute()

    _finalize_if_complete(assessment_id, actor_user_id)

    write_audit(
        actor_user_id=actor_user_id, actor_role=actor_role or "admin",
        action_type="vip_air_confirm_all", target_table="vip_air_assessments",
        target_id=assessment_id, after={"confirmed": confirmed},
    )
    return fetch_assessment_detail(assessment_id)


# ── MIS submissions ──────────────────────────────────────────────────────

def fetch_mis_matrix(kind: str) -> dict:
    """Startups × periods, for one calendar kind at a time (spec §7). Reads
    only whatever `vip_mis_periods` rows already exist — this never calls
    `mis_query.ensure_periods` itself, so it never side-effect-creates a
    period on a founder's behalf from an admin GET; a founder's own calendar
    is generated lazily by their own `GET /founder/mis`
    (`mis_query`'s own module docstring), and this view only ever reads that
    state, it never becomes a second writer of it.
    """
    sb = get_admin_client()
    periods = _fetch_all(
        lambda: sb.table("vip_mis_periods").select("*").eq("kind", kind)
    )
    if not periods:
        return {"kind": kind, "period_keys": [], "startups": []}

    today = mis_periods.today_ist()
    application_ids = sorted({p["application_id"] for p in periods})
    names = _startup_names(application_ids)

    by_app: dict[str, dict[str, dict]] = {}
    period_labels: dict[str, str] = {}
    for p in periods:
        due = p["due_date"] if isinstance(p["due_date"], date) else date.fromisoformat(p["due_date"])
        overdue = p["status"] == "draft" and due < today
        by_app.setdefault(p["application_id"], {})[p["period_key"]] = {
            "status": p["status"], "due_date": p["due_date"], "overdue": overdue,
        }
        period_labels.setdefault(p["period_key"], p["label"])

    period_keys = sorted(period_labels.keys())
    startups = [
        {"application_id": aid, "startup": names.get(aid, "(unnamed)"), "periods": by_app[aid]}
        for aid in application_ids
    ]
    startups.sort(key=lambda s: s["startup"])
    return {
        "kind": kind,
        "period_keys": [{"period_key": k, "label": period_labels[k]} for k in period_keys],
        "startups": startups,
    }


def fetch_mis_period(application_id: str, kind: str, period_key: str) -> dict:
    """One period, read-only (spec §7: "opening one renders it read-only").
    Reuses `mis_query.period_bundle` unchanged — including its own
    draft-only child reconciliation — rather than re-deriving the period
    shape a second time."""
    period = mis_query.fetch_period(application_id, kind, period_key)
    if period is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    bundle = mis_query.period_bundle(application_id, kind, period_key)
    bundle["application_id"] = application_id
    bundle["startup"] = _startup_names([application_id]).get(application_id, "(unnamed)")
    return bundle


def reopen_period(
    *, application_id: str, kind: str, period_key: str,
    actor_user_id: str, actor_role: str | None = None,
) -> dict:
    """Returns a submitted period to `draft` for correction (spec §7).

    Exact counterpart of `founder_mis._reject_out_of_order_submit`, mirrored
    rather than imported — that function lives in a router module, and this
    file already re-implements small guards across module boundaries rather
    than reaching into another router's private helpers, the same choice
    `founder_mis.py` itself makes for `require_vip`/`_ist_date_of` — but the
    direction is reversed: a SUBMIT is blocked by an EARLIER period still
    being draft; a REOPEN is blocked by a LATER period already being
    submitted. Both protect the exact same invariant
    (`mis_query._previous_period`'s derived comparisons — `vs_last`,
    headcount `net_change` — are computed against whichever period is
    immediately adjacent by `period_start`, regardless of that neighbour's
    own status): reopening an EARLIER period while a LATER one is already
    submitted would let an edit to the reopened period silently move the
    already-submitted later period's own numbers the next time it is read —
    exactly the bug ruling P3-R7 closed, from the other direction.

    409s `mis_later_period_submitted`, naming the nearest blocking later
    period, mirroring the founder-side submit 409's own
    `period_key`/`label` detail shape.

    Reuses `mis_query._fetch_periods` — a private helper of a *service*
    module, not a router — the same way `founder_mis._reject_out_of_order_
    submit` already does, rather than re-querying the same rows a second
    way.
    """
    period = mis_query.fetch_period(application_id, kind, period_key)
    if period is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    if period["status"] != "submitted":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail={"code": "mis_not_submitted"})

    periods = mis_query._fetch_periods(application_id, kind)
    later_submitted = sorted(
        (p for p in periods
         if p["status"] == "submitted" and p["period_start"] > period["period_start"]),
        key=lambda p: p["period_start"],
    )
    if later_submitted:
        blocker = later_submitted[0]
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
            "code": "mis_later_period_submitted",
            "period_key": blocker["period_key"],
            "label": blocker["label"],
        })

    now = datetime.now(UTC).isoformat()
    get_admin_client().table("vip_mis_periods").update({
        "status": "draft", "reopened_at": now, "reopened_by": actor_user_id,
        "updated_at": now,
    }).eq("id", period["id"]).execute()

    write_audit(
        actor_user_id=actor_user_id, actor_role=actor_role or "admin",
        action_type="vip_mis_period_reopened", target_table="vip_mis_periods",
        target_id=period["id"],
        after={"application_id": application_id, "kind": kind, "period_key": period_key},
    )
    return fetch_mis_period(application_id, kind, period_key)


# ── MIS charts (cohort roll-up + per-startup) ────────────────────────────

# Hand-synced with frontend/src/components/MisChartCard.jsx's own `GRAPH`
# constant — same convention as rbac.py/rbac.js (core domain invariant:
# change one, change the other). All four are monthly-only metrics
# (mis_catalog.METRICS); quarterly periods carry no metrics at all, so this
# never touches vip_mis_financials/vip_mis_headcount.
MIS_GRAPH = (
    ("revenue", "revenue_month"),
    ("burn", "net_burn_month"),
    ("headcount", "headcount_eom"),
    ("paying", "active_customers"),
)
_MIS_GRAPH_METRIC_KEYS = {mk for _, mk in MIS_GRAPH}


def _onboarded_vip_application_ids() -> list[str]:
    """Every VIP (sip) application currently `onboarded` — the roster the
    per-startup chart section walks, INCLUDING a venture with zero
    `vip_mis_periods` rows (one that has never opened its own MIS tab —
    periods are only ever lazily created by a founder's own `GET
    /founder/mis`, mis_query's own module docstring). `fetch_mis_matrix`
    deliberately does NOT do this — it derives its startup list purely from
    existing period rows, silently omitting a never-visited venture — but
    this view's own empty-state contract (G5: "hasn't opened MIS reporting
    yet") requires seeing that venture in order to say so, distinctly from
    G6 (no onboarded ventures at all, so `startups` itself is empty).
    """
    sb = get_admin_client()
    rows = _fetch_all(
        lambda: sb.table("sip_applications").select("id").eq("status", "onboarded")
    )
    return sorted({r["id"] for r in rows})


def fetch_mis_charts() -> dict:
    """Cohort roll-up + per-startup series for the four MIS_GRAPH metrics,
    read from every SUBMITTED monthly period across the VIP cohort (spec
    §6). A quarterly period carries no chart metrics at all (same rule
    `mis_query.period_bundle` already applies), so only `kind == "monthly"`
    periods are ever read here.

    Two distinguishable empty states, never collapsed into one:
      * `startups == []` — no VIP venture is currently onboarded at all
        (G6, page-level: "No VIP startups are onboarded yet.").
      * a startup row with `has_any_period is False` — that venture IS
        onboarded but has never once opened its own MIS page, so no
        `vip_mis_periods` row exists for it yet (G5, per-startup: "Hasn't
        opened MIS reporting yet."). This is distinct from a startup that
        HAS opened MIS (`has_any_period is True`) but simply hasn't
        submitted anything yet — that startup's `monthly_status` is
        non-empty (drafts) while its `series` stay empty arrays.

    OPEN QUESTION, deliberately not resolved here: what a cohort month's
    total means when startups do not share a reporting calendar. Shipped
    default — a partial sum over whichever startups reported that exact
    period_key, mirroring `mis_query._partial_sum`'s own "partial entry is
    still useful information" rule. NOT zero-filled, NOT gated on every
    onboarded venture having reported. This is a product decision this
    function does not have the authority to make silently — see this
    plan's own "invented formulas" section before treating this number as
    authoritative.
    """
    sb = get_admin_client()
    application_ids = _onboarded_vip_application_ids()
    names = _startup_names(application_ids)
    app_id_set = set(application_ids)

    periods = _fetch_all(
        lambda: sb.table("vip_mis_periods").select("*").eq("kind", "monthly")
    )
    periods = [mis_query._normalise_period(p) for p in periods if p["application_id"] in app_id_set]

    by_app_periods: dict[str, list[dict]] = {aid: [] for aid in application_ids}
    for p in periods:
        by_app_periods[p["application_id"]].append(p)

    submitted_period_ids = [p["id"] for p in periods if p["status"] == "submitted"]
    metrics_by_period: dict[str, dict[str, float | int | None]] = {}
    if submitted_period_ids:
        # PostgREST's ~1000-row cap has silently truncated list reads in
        # this codebase three times before (admin_query.py's own module
        # docstring) — _fetch_all, not a bare .execute(), even though a
        # single cohort is unlikely to hit it soon.
        metric_rows = _fetch_all(
            lambda: sb.table("vip_mis_metrics").select("period_id,metric_key,actual")
            .in_("period_id", submitted_period_ids)
        )
        for r in metric_rows:
            if r["metric_key"] not in _MIS_GRAPH_METRIC_KEYS:
                continue
            metrics_by_period.setdefault(r["period_id"], {})[r["metric_key"]] = r.get("actual")

    today = mis_periods.today_ist()
    startups = []
    cohort_by_period: dict[str, dict[str, list[float]]] = {}
    period_labels: dict[str, str] = {}

    for aid in application_ids:
        app_periods = sorted(by_app_periods[aid], key=lambda p: p["period_key"])
        submitted = [p for p in app_periods if p["status"] == "submitted"]

        series: dict[str, list[dict]] = {ck: [] for ck, _ in MIS_GRAPH}
        for p in submitted:
            values = metrics_by_period.get(p["id"], {})
            period_labels.setdefault(p["period_key"], p["label"])
            for chart_key, metric_key in MIS_GRAPH:
                value = values.get(metric_key)
                series[chart_key].append(
                    {"period_key": p["period_key"], "label": p["label"], "value": value}
                )
                if value is not None:
                    cohort_by_period.setdefault(p["period_key"], {}).setdefault(
                        chart_key, []
                    ).append(value)

        monthly_status = [
            {"period_key": p["period_key"], "label": p["label"], "status": p["status"],
             "due_date": p["due_date"], "overdue": mis_periods.is_overdue(p, today)}
            for p in app_periods
        ]
        latest = submitted[-1] if submitted else None

        startups.append({
            "application_id": aid,
            "startup": names.get(aid, "(unnamed)"),
            "has_any_period": len(app_periods) > 0,
            "monthly_status": monthly_status,
            "latest_period": (
                {"period_key": latest["period_key"], "label": latest["label"],
                 "submitted_at": latest.get("submitted_at")}
                if latest else None
            ),
            "series": series,
        })
    startups.sort(key=lambda s: s["startup"])

    cohort_period_keys = sorted(cohort_by_period.keys())
    cohort_series: dict[str, list[dict]] = {ck: [] for ck, _ in MIS_GRAPH}
    for pk in cohort_period_keys:
        for chart_key, _ in MIS_GRAPH:
            values = cohort_by_period[pk].get(chart_key, [])
            cohort_series[chart_key].append({
                "period_key": pk, "label": period_labels[pk],
                "value": sum(values) if values else None,
            })

    return {
        "cohort": {"period_keys": cohort_period_keys, "series": cohort_series},
        "startups": startups,
    }
