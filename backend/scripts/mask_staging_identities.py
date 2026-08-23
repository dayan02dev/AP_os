"""Replace every real identity in the STAGING Supabase project with a synthetic one.

WHY
    Staging is a copy of production: real founder names, real Gmail and
    university addresses. It is being handed to product managers who are
    deliberately NOT given production access, so the identities have to go
    while the application CONTENT stays — the demo has to read like the real
    product.

WHAT IS PRESERVED
    Everything except identity: all long-form answers, statuses, AI scores,
    industries, dates, file references, moved_to_track. Only who they are
    changes, never what they wrote.

DETERMINISM
    fake_identity() is a pure function of the original value, so the same real
    person maps to the same synthetic person in every table and on every run.
    That keeps an applicant's name consistent between their application row and
    their profile row, and makes the script idempotent.

SAFETY
    * Refuses to run unless SUPABASE_URL points at the staging project.
    * --dry-run is the default; nothing is written without --apply.
    * Staff accounts (@artpark.in/.info/.test) are skipped — masking those
      would break the logins staging depends on.

LIMIT, STATED PLAINLY
    auth.users.email still holds real addresses. No portal screen renders it
    (they all read `profiles`), and rewriting it would break those accounts'
    sign-in for no UI-visible gain. Deliberate, not an oversight.

USAGE
    cd backend
    python scripts/mask_staging_identities.py              # dry run
    python scripts/mask_staging_identities.py --apply
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv  # type: ignore

    for candidate in (".env.staging", ".env"):
        path = _BACKEND_ROOT / candidate
        if path.exists():
            load_dotenv(path)
            break
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("mask_staging")

STAGING_PROJECT_ID = "exqmxvdtcsvpgtftwjml"
PROD_PROJECT_ID = "xtmszlpwgbyoumalgbhs"

EXEMPT_DOMAINS = ("@artpark.in", "@artpark.info", "@artpark.test")

# Synthetic pool. Indian names because the real applicant population is Indian
# and a demo full of Anglo names would read as obviously fake.
FIRST = [
    "Aarav", "Ananya", "Advait", "Bhavya", "Chirag", "Divya", "Eshan", "Gauri",
    "Harsh", "Ishita", "Jatin", "Kavya", "Lakshya", "Meera", "Nikhil", "Oindrila",
    "Pranav", "Riya", "Sahil", "Tanvi", "Utkarsh", "Vaishnavi", "Yash", "Zoya",
]
LAST = [
    "Agarwal", "Bhat", "Chandra", "Deshpande", "Iyer", "Joshi", "Kulkarni",
    "Menon", "Nair", "Pillai", "Rao", "Sharma", "Thakur", "Varma",
]
ORGS = [
    "Aether Robotics", "Bharat Sensing", "Cyclone Mobility", "Delta Neural",
    "Ekaant Systems", "Fathom Analytics", "Girish Aerospace", "Helix BioWorks",
    "Indus Photonics", "Jyoti Energy", "Kalpa Materials", "Lumen Diagnostics",
]

# 24 first names x 14 surnames = 336 combinations, not enough headroom for the
# ~550 rows this script masks (duplicate synthetic founders would read as a
# product bug, not a masking artefact). A middle initial, deterministically
# derived from the same seed, multiplies the space by 26 to 8,736 combinations
# without inventing a whole new name list or touching determinism/idempotency.
MIDDLE_INITIALS = [chr(c) for c in range(ord("A"), ord("Z") + 1)]


def _idx(seed: str, modulo: int) -> int:
    return int(hashlib.sha256(seed.encode("utf-8")).hexdigest(), 16) % modulo


def fake_identity(original: str) -> dict:
    """Deterministic synthetic identity derived from `original`."""
    seed = (original or "anonymous").strip().lower()
    first = FIRST[_idx(seed + "|f", len(FIRST))]
    last = LAST[_idx(seed + "|l", len(LAST))]
    middle = MIDDLE_INITIALS[_idx(seed + "|m", len(MIDDLE_INITIALS))]
    org = ORGS[_idx(seed + "|o", len(ORGS))]
    handle = f"{first}.{middle}.{last}".lower()
    return {
        "name": f"{first} {middle}. {last}",
        "email": f"{handle}@artpark.test",
        "phone": f"+9198{_idx(seed + '|p', 90000000) + 10000000}",
        "org": org,
        "linkedin": f"https://www.linkedin.com/in/{handle}",
    }


def is_exempt(email: str | None) -> bool:
    """True for staff / seed accounts, which must not be masked."""
    if not email:
        return False
    return email.strip().lower().endswith(EXEMPT_DOMAINS)


# Column -> which field of fake_identity() fills it.
FIELD_MAP = {
    "basic_full_name": "name",
    "full_name": "name",
    "basic_email": "email",
    "email": "email",
    "basic_phone": "phone",
    "phone": "phone",
    "basic_org": "org",
    "linkedin_url": "linkedin",
}


def mask_row(row: dict, columns: set[str]) -> dict:
    """Build the patch for one row. Keys are restricted to `columns`.

    Seeded from the row's email when it has one, else its name — many staging
    rows have a null email but a real name, and those must still be masked.
    """
    email = row.get("basic_email") or row.get("email")
    if is_exempt(email):
        return {}

    seed = email or row.get("basic_full_name") or row.get("full_name") or row.get("id") or ""
    ident = fake_identity(str(seed))

    patch: dict = {}
    for col, field in FIELD_MAP.items():
        if col in columns and col in row:
            patch[col] = ident[field]

    # Teammates: rewrite each name, keep every other key so the shape survives.
    if "basic_teammates" in columns and "basic_teammates" in row:
        mates = row.get("basic_teammates")
        if isinstance(mates, list):
            out = []
            for i, m in enumerate(mates):
                if isinstance(m, dict):
                    m2 = dict(m)
                    if "name" in m2:
                        m2["name"] = fake_identity(f"{seed}|mate{i}")["name"]
                    if "email" in m2:
                        m2["email"] = fake_identity(f"{seed}|mate{i}")["email"]
                    out.append(m2)
                else:
                    out.append(m)
            patch["basic_teammates"] = out
        elif mates is None:
            pass  # never write null into a NOT NULL column
        else:
            patch["basic_teammates"] = mates

    # Media URLs point at real people's demos; blank them to a placeholder.
    for col in ("github_url", "evidence_video_url", "sip_demo_video_url"):
        if col in columns and row.get(col):
            patch[col] = "https://example.test/redacted"

    return patch


TARGETS = ("tir_applications", "sip_applications", "profiles")


def _guard(url: str) -> None:
    if PROD_PROJECT_ID in url:
        log.error("REFUSING: SUPABASE_URL points at PRODUCTION.")
        sys.exit(2)
    if STAGING_PROJECT_ID not in url:
        log.error("REFUSING: SUPABASE_URL is not the known staging project.")
        log.error("  expected to contain: %s", STAGING_PROJECT_ID)
        sys.exit(2)


def _columns_of(sb, table: str) -> set[str]:
    """Live column set. The migration files are NOT authoritative — `reviews`
    proves it — so always ask the database."""
    rows = sb.table(table).select("*").limit(1).execute().data or []
    return set(rows[0].keys()) if rows else set()


def _fetch_all(sb, table: str, columns: set[str]) -> list[dict]:
    """Paginate. PostgREST silently caps a plain select at 1000 rows."""
    wanted = sorted({"id"} | (columns & set(FIELD_MAP) | {"basic_teammates",
                    "github_url", "evidence_video_url", "sip_demo_video_url"}) & (columns | {"id"}))
    out: list[dict] = []
    page = 0
    while True:
        lo, hi = page * 500, page * 500 + 499
        chunk = sb.table(table).select(",".join(wanted)).range(lo, hi).execute().data or []
        out.extend(chunk)
        if len(chunk) < 500:
            return out
        page += 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    _guard(url)
    log.info("target: staging (%s) — mode: %s", STAGING_PROJECT_ID,
             "APPLY" if args.apply else "DRY RUN")

    from app.supabase_client import get_admin_client
    sb = get_admin_client()

    grand = 0
    for table in TARGETS:
        cols = _columns_of(sb, table)
        if not cols:
            log.warning("%-20s no rows — skipping", table)
            continue
        rows = _fetch_all(sb, table, cols)
        patches = [(r["id"], mask_row(r, cols)) for r in rows]
        patches = [(rid, p) for rid, p in patches if p]
        log.info("%-20s %d rows, %d to mask", table, len(rows), len(patches))
        for rid, p in patches[:3]:
            log.info("    e.g. %s -> %s", rid[:8], {k: p[k] for k in list(p)[:3]})
        if args.apply:
            for rid, p in patches:
                sb.table(table).update(p).eq("id", rid).execute()
        grand += len(patches)

    log.info("%s %d rows", "masked" if args.apply else "would mask", grand)
    if not args.apply:
        log.info("re-run with --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
