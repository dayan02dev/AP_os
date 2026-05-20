#!/usr/bin/env python3
"""Backfill ``industry_category_id`` on existing applications.

Iterates non-draft apps from both tracks (oldest first), runs an
industry-only LLM prompt for each, and UPDATES ``ai_screening`` with
``industry_category_id`` + ``industry_confidence``. Idempotent — skips
rows already populated.

Why not just re-run the full screener?
--------------------------------------
The full AI screener pipeline overwrites ``score_overall`` and the five
component scores. We don't want to disturb those for the 65 existing apps;
we only want to backfill the new industry columns. This script uses a
leaner industry-only prompt against the same model
(``google/gemini-2.5-flash``) — about $0.001 per app, ~$0.05 total for
the staging corpus.

Usage
-----
    cd backend
    source .venv/bin/activate
    python scripts/backfill_industry.py             # full backfill
    python scripts/backfill_industry.py --dry-run   # log decisions, no writes
    python scripts/backfill_industry.py --limit 5   # per-track limit

Requires ``backend/.env`` (or ``backend/.env.staging``) populated. Reads
``SUPABASE_URL``, ``SUPABASE_SERVICE_ROLE_KEY``, ``OPENROUTER_API_KEY``.

SAFETY: this script uses the service-role key and bypasses RLS. Never run
it against production without first running on staging and reviewing the
classifications it produced.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

# Make the backend package importable when this is run as `python scripts/...`.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

# Optional dotenv loading — local dev has python-dotenv installed.
try:
    from dotenv import load_dotenv  # type: ignore

    for candidate in (".env.staging", ".env"):
        path = _BACKEND_ROOT / candidate
        if path.exists():
            load_dotenv(path)
            break
except ImportError:
    pass

import httpx  # noqa: E402
from app.services import industry_categories  # noqa: E402
from app.supabase_client import get_admin_client  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("backfill_industry")

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = "google/gemini-2.5-flash"

_SYSTEM_PROMPT = (
    "You are classifying a startup application into an industry category. "
    "Reply ONLY with valid JSON of the shape: "
    '{"industry": {"category_id": "<existing id>" OR '
    '"new_category": {"id": "<slug>", "label": "<display>"}, '
    '"industry_confidence": 0.0-1.0}}. '
    "Pick the best EXISTING match. Only propose a new category if NONE "
    "of the existing categories describes the venture's primary domain "
    "AND slots_remaining > 0 AND the new category would clearly fit "
    ">= 3 plausible future ventures. For multi-domain ventures (e.g. a "
    "medical robot), prefer the bucket matching the primary differentiator "
    "described in solution_core_tech. Fall back to 'other' only when no "
    "bucket dominates."
)


def _build_user_message(
    app_row: dict[str, Any],
    categories: list[dict],
    slots_remaining: int,
) -> str:
    """Compose the user message for the LLM call. Mirrors openrouter_client
    layout but is leaner (no scoring instructions)."""
    parts: list[str] = []
    if app_row.get("basic_full_name"):
        parts.append(f"Applicant: {app_row['basic_full_name']}")
    if app_row.get("basic_org"):
        parts.append(f"Organisation: {app_row['basic_org']}")
    if app_row.get("problem_describe"):
        parts.append(f"Problem: {app_row['problem_describe']}")
    if app_row.get("solution_describe"):
        parts.append(f"Solution: {app_row['solution_describe']}")
    if app_row.get("solution_core_tech"):
        parts.append(f"Core technology: {app_row['solution_core_tech']}")
    cat_lines = "\n".join(f"  - {c['id']}: {c['label']}" for c in categories)
    parts.append(
        "Existing industry categories:\n"
        f"{cat_lines}\n"
        f"slots_remaining for new categories: {slots_remaining}"
    )
    return "\n\n".join(parts)


def _strip_json_fence(content: str) -> str:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].lstrip("\n")
    return stripped


def _call_openrouter(user_message: str) -> dict:
    """POST to OpenRouter; return the parsed JSON content. Raises on
    non-2xx and on bad/missing JSON."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set — required for LLM classification"
        )
    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            _OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    return json.loads(_strip_json_fence(content))


def _classify(app_row: dict) -> tuple[str | None, float | None, dict | None]:
    """Return ``(category_id, confidence, new_proposal)`` for one app."""
    cats = industry_categories.fetch_categories()
    slots_remaining = max(0, industry_categories.CATEGORY_CAP - len(cats))
    user_msg = _build_user_message(app_row, cats, slots_remaining)
    parsed = _call_openrouter(user_msg)

    ind = parsed.get("industry") or {}
    conf_raw = ind.get("industry_confidence")
    try:
        conf = float(conf_raw) if conf_raw is not None else None
    except (TypeError, ValueError):
        conf = None

    new_cat = ind.get("new_category")
    if isinstance(new_cat, dict) and new_cat.get("id") and new_cat.get("label"):
        return None, conf, {"id": str(new_cat["id"]), "label": str(new_cat["label"])}

    cid = ind.get("category_id")
    if isinstance(cid, str) and cid:
        return cid, conf, None
    return None, conf, None


def _fetch_apps_to_backfill(track: str, client) -> list[dict]:
    """Return non-draft apps on ``track`` that don't yet have
    ``ai_screening.industry_category_id`` populated."""
    table = f"{track}_applications"
    res = (
        client.table(table)
        .select(
            "id,submitted_at,created_at,basic_full_name,basic_org,"
            "problem_describe,solution_describe,solution_core_tech"
        )
        .neq("status", "draft")
        .order("submitted_at", desc=False)
        .order("created_at", desc=False)
        .execute()
    )
    apps = res.data or []
    if not apps:
        return []

    ids = [a["id"] for a in apps]
    # Batch in chunks of 500 ids to stay under URL limits.
    populated: set[str] = set()
    for i in range(0, len(ids), 500):
        chunk = ids[i : i + 500]
        sres = (
            client.table("ai_screening")
            .select("application_id,industry_category_id")
            .eq("application_track", track)
            .in_("application_id", chunk)
            .execute()
        )
        for r in sres.data or []:
            if r.get("industry_category_id") is not None:
                populated.add(r["application_id"])

    return [a for a in apps if a["id"] not in populated]


def _update_industry(
    client,
    application_id: str,
    track: str,
    category_id: str,
    confidence: float | None,
) -> None:
    """UPDATE the industry columns on ai_screening, or INSERT a minimal row
    if none exists (an app submitted before AI screener landed has no
    ai_screening row at all)."""
    res = (
        client.table("ai_screening")
        .select("application_id")
        .eq("application_id", application_id)
        .eq("application_track", track)
        .limit(1)
        .execute()
    )
    if res.data:
        client.table("ai_screening").update(
            {
                "industry_category_id": category_id,
                "industry_confidence": confidence,
            }
        ).eq("application_id", application_id).eq(
            "application_track", track
        ).execute()
    else:
        client.table("ai_screening").insert(
            {
                "application_id": application_id,
                "application_track": track,
                "industry_category_id": category_id,
                "industry_confidence": confidence,
                "flags": [],
            }
        ).execute()


def run(*, dry_run: bool, limit: int | None) -> None:
    client = get_admin_client()
    grand_total = 0
    skipped = 0

    for track in ["tir", "sip"]:
        apps = _fetch_apps_to_backfill(track, client)
        if limit:
            apps = apps[:limit]
        log.info("Track %s: %d apps to backfill", track, len(apps))

        for i, app in enumerate(apps, 1):
            app_id = app["id"]
            log.info("[%s %d/%d] app_id=%s", track, i, len(apps), app_id)
            try:
                cid, conf, new_proposal = _classify(app)
            except Exception as exc:
                log.warning("Classification failed for %s: %s", app_id, exc)
                skipped += 1
                continue

            if new_proposal and conf is not None and conf >= 0.7:
                ok = industry_categories.create_category_if_under_cap(
                    category_id=new_proposal["id"],
                    label=new_proposal["label"],
                    created_by_app_id=app_id,
                )
                if ok:
                    cid = new_proposal["id"]
                    log.info(
                        "Created new category %s (%s) from app %s",
                        new_proposal["id"],
                        new_proposal["label"],
                        app_id,
                    )

            if not cid:
                log.info("No industry resolved for %s — leaving null", app_id)
                skipped += 1
                continue

            if dry_run:
                log.info(
                    "[dry-run] would set %s.industry_category_id=%s confidence=%s",
                    app_id,
                    cid,
                    conf,
                )
                continue

            _update_industry(client, app_id, track, cid, conf)
            grand_total += 1

    log.info(
        "Backfill complete. %d rows updated, %d skipped/unresolved.",
        grand_total,
        skipped,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log decisions but don't write to ai_screening.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of apps per track (useful for sanity-testing).",
    )
    args = parser.parse_args()
    run(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
