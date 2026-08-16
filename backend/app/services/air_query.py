"""Reads and lazy creation for the AIR assessment.

Rounds are quarterly and generated on read rather than by a cron: computing
the current label and inserting if absent is idempotent and leaves nothing to
operate. Sorting is done in Python because the FakeSupabase test double treats
.order() as a no-op and lever order is contractual.

ensure_round is convergent rather than create-once: PostgREST offers no
client-side transaction and this project deliberately has no exec_sql RPC
(prod DDL is Studio-only), so a multi-statement write cannot be wrapped in
one. Instead every call reconciles state to what it should be regardless of
what it started as, which absorbs both a concurrent-insert race on the
(application_id, round_label) unique constraint and a process that died
mid-way through a previous call and left the round with fewer than six
lever rows.
"""
from __future__ import annotations

from datetime import date

from ..supabase_client import get_admin_client
from . import air_catalog as cat
from . import air_scoring as sc


def current_round_label(today: date) -> str:
    """Indian FY quarter label, e.g. FY26-27-Q1 for Apr-Jun 2026.

    The fiscal year starts in April, so January-March belongs to the year that
    began the previous April — the boundary worth being explicit about.
    """
    y, m = today.year, today.month
    if m >= 4:
        fy_start, quarter = y, (m - 4) // 3 + 1
    else:
        fy_start, quarter = y - 1, (m + 8) // 3 + 1
    return f"FY{fy_start % 100:02d}-{(fy_start + 1) % 100:02d}-Q{quarter}"


def fetch_round(application_id: str, round_label: str) -> dict | None:
    rows = (
        get_admin_client().table("vip_air_assessments").select("*")
        .eq("application_id", application_id).eq("round_label", round_label)
        .limit(1).execute().data or []
    )
    return rows[0] if rows else None


def ensure_round(application_id: str, round_label: str) -> dict:
    """The round for this quarter, created as a draft if it does not exist.

    Idempotent, and generated on read rather than by a cron: there is nothing
    to schedule and nothing to operate. Convergent, not create-once: the
    assessment row and its six lever rows are reconciled to the correct
    state on every call, not only when the round is first created — see the
    module docstring for why.
    """
    sb = get_admin_client()
    rnd = fetch_round(application_id, round_label)
    if rnd is None:
        try:
            rnd = sb.table("vip_air_assessments").insert({
                "application_id": application_id,
                "round_label": round_label,
                "status": "draft",
            }).execute().data[0]
        except Exception as exc:
            # The loser of a concurrent-insert race hits the
            # (application_id, round_label) unique constraint. Read the
            # winner's row back instead of propagating a 500; anything that
            # is not resolvable that way is re-raised, not swallowed.
            msg = str(exc).lower()
            if "duplicate" in msg or "unique" in msg or "23505" in msg:
                rnd = fetch_round(application_id, round_label)
                if rnd is None:
                    raise
            else:
                raise

    have = {row["lever"] for row in fetch_lever_scores(rnd["id"])}
    missing = [lever for lever in cat.LEVER_KEYS if lever not in have]
    if missing:
        sb.table("vip_air_lever_scores").insert([
            {"assessment_id": rnd["id"], "lever": lever, "criteria_checked": []}
            for lever in missing
        ]).execute()

    return rnd


def fetch_lever_scores(assessment_id: str) -> list[dict]:
    rows = (
        get_admin_client().table("vip_air_lever_scores").select("*")
        .eq("assessment_id", assessment_id).execute().data or []
    )
    order = {k: i for i, k in enumerate(cat.LEVER_KEYS)}
    return sorted(rows, key=lambda r: order.get(r.get("lever"), 99))


def fetch_evidence(assessment_id: str) -> list[dict]:
    return (
        get_admin_client().table("vip_air_evidence").select("*")
        .eq("assessment_id", assessment_id).execute().data or []
    )


def _answers_of(row: dict) -> dict[str, str | None]:
    return {q: row.get(f"{q}_option") for q in ("q1", "q2", "q3")}


def assessment_bundle(application_id: str, round_label: str) -> dict:
    """Everything the wizard needs in one read: the framework, the round, the
    six lever states, and both rollup sets.

    claimed_level is recomputed from the stored answers rather than read from
    the column, so a catalog revision cannot leave a stale score on screen.
    """
    rnd = ensure_round(application_id, round_label)
    scores = fetch_lever_scores(rnd["id"])
    evidence = fetch_evidence(rnd["id"])

    claimed: dict[str, int | None] = {}
    verified: dict[str, int | None] = {}
    levers: list[dict] = []
    by_key = {l["key"]: l for l in cat.LEVERS}

    for row in scores:
        key = row["lever"]
        level = sc.lever_level(key, _answers_of(row))
        claimed[key] = level
        verified[key] = row.get("verified_level")
        levers.append({
            "lever": key,
            "name": by_key[key]["name"],
            "family": by_key[key]["family"],
            "q1_option": row.get("q1_option"),
            "q2_option": row.get("q2_option"),
            "q3_option": row.get("q3_option"),
            "criteria_checked": row.get("criteria_checked") or [],
            "claimed_level": level,
            "verified_level": row.get("verified_level"),
            "verifier_note": row.get("verifier_note"),
            "required_document": cat.required_document(key, level) if level else None,
            "criteria": cat.criteria_for(key, level) if level else [],
            "evidence": [e for e in evidence if e.get("lever") == key],
        })

    return {
        "catalog": {
            "levers": cat.LEVERS,
            "questions": cat.QUESTIONS,
            "criteria": cat.CRITERIA,
            "documents": cat.DOCUMENTS,
        },
        "round": {
            "id": rnd["id"],
            "round_label": rnd["round_label"],
            "status": rnd["status"],
            "submitted_at": rnd.get("submitted_at"),
            "verified_at": rnd.get("verified_at"),
        },
        "levers": levers,
        "rollups": {"claimed": sc.rollups(claimed), "verified": sc.rollups(verified)},
    }
