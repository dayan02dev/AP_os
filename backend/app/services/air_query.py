"""Reads and lazy creation for the AIR assessment.

Rounds are quarterly and generated on read rather than by a cron: computing
the current label and inserting if absent is idempotent and leaves nothing to
operate. Sorting is done in Python because the FakeSupabase test double treats
.order() as a no-op and lever order is contractual.

ensure_round is convergent rather than create-once: PostgREST offers no
client-side transaction and this project deliberately has no exec_sql RPC
(prod DDL is Studio-only), so a multi-statement write cannot be wrapped in
one. Instead every call reconciles state to what it should be regardless of
what it started as, which absorbs three failure modes with the same
recovery shape (insert; on a unique violation, re-read and trust whoever
won): a concurrent-insert race on the (application_id, round_label) unique
constraint on vip_air_assessments; the same race one table down, on the
(assessment_id, lever) unique constraint on vip_air_lever_scores, reachable
because the loser of the first race falls straight into the same
unconditional lever-reconciliation path the winner is running for that same
brand-new round; and a process that died mid-way through a previous call
and left the round with fewer than six lever rows.

Genuine new-round creation also seeds the six lever rows' answers from the
most recent earlier round of the same application (spec §4.5: "A new round
seeds its answers from the previous round so the founder edits deltas").
The repair path — filling in levers missing from a round that already
exists — does not re-seed; see ensure_round's docstring for how the two are
told apart. Evidence is not carried forward and is not reachable across
rounds from any endpoint: all three /founder/air/evidence routes resolve
only the current quarter's round, by design — reopening a prior round's
evidence is deferred to the admin phase.
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


def _is_unique_violation(exc: Exception) -> bool:
    """Whether an insert failure looks like it hit a unique constraint
    rather than some other error. supabase-py surfaces PostgREST errors as a
    plain Exception, not a typed one, so message-sniffing is the least bad
    option — the same check already used in app/routers/waitlist.py and
    app/routers/admin_users.py, pulled out here so both call sites in this
    module share one place to get the predicate right.
    """
    msg = str(exc).lower()
    return "duplicate" in msg or "unique" in msg or "23505" in msg


def _missing_levers(assessment_id: str) -> list[str]:
    have = {row["lever"] for row in fetch_lever_scores(assessment_id)}
    return [lever for lever in cat.LEVER_KEYS if lever not in have]


def _seed_answers(application_id: str, round_label: str) -> dict[str, dict]:
    """Answers to seed a genuinely new round from, per spec §4.5: "A new round
    seeds its answers from the previous round so the founder edits deltas."

    Keyed by lever, each value carrying q1_option/q2_option/q3_option and
    criteria_checked only — never verified_level, verifier_note,
    verified_at/verified_by, or evidence, all of which belong to the round
    they were actually performed on. Returns {} when there is no earlier
    round (the first-ever round is empty, not seeded from nothing).

    "Most recent earlier round" = the max of round_label among labels less
    than the new one. round_label sorts lexicographically in chronological
    order for this format (FY26-27-Q1 < FY26-27-Q2 < FY27-28-Q1), so that
    max is found by sorting in Python — not via .order(), which FakeSupabase
    treats as a no-op — over every round for this application (a `<` filter
    is not expressible via .eq()/.in_() anyway).
    """
    rows = (
        get_admin_client().table("vip_air_assessments").select("*")
        .eq("application_id", application_id).execute().data or []
    )
    earlier = sorted(
        (r for r in rows if r["round_label"] < round_label),
        key=lambda r: r["round_label"],
        reverse=True,
    )
    if not earlier:
        return {}
    return {
        row["lever"]: {
            "q1_option": row.get("q1_option"),
            "q2_option": row.get("q2_option"),
            "q3_option": row.get("q3_option"),
            "criteria_checked": row.get("criteria_checked") or [],
        }
        for row in fetch_lever_scores(earlier[0]["id"])
    }


def _insert_levers(sb, assessment_id: str, levers: list[str],
                    seed: dict[str, dict] | None = None) -> None:
    seed = seed or {}
    rows = []
    for lever in levers:
        row = {"assessment_id": assessment_id, "lever": lever, "criteria_checked": []}
        s = seed.get(lever)
        if s:
            row["q1_option"] = s["q1_option"]
            row["q2_option"] = s["q2_option"]
            row["q3_option"] = s["q3_option"]
            row["criteria_checked"] = s["criteria_checked"]
            row["claimed_level"] = sc.lever_level(lever, {
                "q1": s["q1_option"], "q2": s["q2_option"], "q3": s["q3_option"],
            })
        rows.append(row)
    sb.table("vip_air_lever_scores").insert(rows).execute()


def ensure_round(application_id: str, round_label: str) -> dict:
    """The round for this quarter, created as a draft if it does not exist.

    Idempotent, and generated on read rather than by a cron: there is nothing
    to schedule and nothing to operate. Convergent, not create-once: the
    assessment row and its six lever rows are reconciled to the correct
    state on every call, not only when the round is first created — see the
    module docstring for why, including why the lever insert below needs the
    same race recovery as the round insert.

    Genuine new-round creation seeds its six levers from the most recent
    earlier round (see _seed_answers) — but the repair path, which only
    fills in levers missing from a round that already existed, must not:
    `is_new_round` is latched from whether *this call's* initial read found
    no round at all, before any insert or race recovery, so both winner and
    loser of a round-insert race still seed (both correctly observed no
    round existed yet), while a later call repairing a partially-written
    existing round does not (correctly — that round already exists).
    """
    sb = get_admin_client()
    rnd = fetch_round(application_id, round_label)
    is_new_round = rnd is None
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
            if not _is_unique_violation(exc):
                raise
            rnd = fetch_round(application_id, round_label)
            if rnd is None:
                raise

    seed = _seed_answers(application_id, round_label) if is_new_round else {}

    missing = _missing_levers(rnd["id"])
    if missing:
        try:
            _insert_levers(sb, rnd["id"], missing, seed)
        except Exception as exc:
            # Same race, one table down: the loser of the round-insert race
            # above falls into this same unconditional reconciliation for
            # the same brand-new round, and can lose a second race on
            # vip_air_lever_scores' (assessment_id, lever) constraint. Only
            # a unique violation is recoverable here; re-read what is
            # actually still missing and, if the other writer beat us to
            # all six, there is nothing left to do. If some genuinely remain,
            # attempt those once — a second failure is not caught again and
            # propagates, same as an unrecoverable failure at the round site.
            if not _is_unique_violation(exc):
                raise
            missing = _missing_levers(rnd["id"])
            if missing:
                _insert_levers(sb, rnd["id"], missing, seed)

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
