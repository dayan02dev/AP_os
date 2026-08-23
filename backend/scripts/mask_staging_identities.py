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

COLLISION SAFETY (C1, round-3 review — this used to abort the run)
    `public.profiles.email` is `text not null unique`
    (001_initial_schema.sql:39). fake_identity() draws from a 24 x 26 x 14 =
    8,736-handle space, and masking 226 non-exempt `profiles` rows into it
    produces ~2.9 expected birthday collisions — measured against live
    staging: exactly 3, all between DIFFERENT real people. With one
    `update()` per row and no error handling, the first `--apply` used to
    23505 partway through `profiles` (the LAST table in TARGETS), leaving the
    application tables masked and 153 `profiles` rows still holding real
    names and real email addresses, on the very screens (/admin/users, the
    reviewer roster) the demo handout points at. A re-run could not heal it:
    the already-masked winner became exempt, and the loser re-derived the
    same taken address.

    The fix is offline and deterministic. Every patch for every target table
    is planned BEFORE any write (`build_plan`), one synthetic identity is
    assigned per distinct seed (`resolve_identities`), and a seed whose
    synthetic email is already taken is re-salted with `|dup1`, `|dup2`, ...
    until it is free. Resolution walks the seeds in sorted order — never
    dict/fetch order — so the same input set always produces the same output
    set. Assignment is keyed on the SEED rather than the row, so:
      * two rows for the same real person still share one synthetic identity
        (277 `tir_applications` rows carry only 264 distinct seeds), and
      * the 191 seeds that appear in both `profiles` and `tir_applications`
        get the same identity in both, which is the whole point of keying on
        the original value.
    `taken` is pre-loaded with the current email of every row this run will
    NOT patch, so a synthetic address written by an earlier partial run
    counts as occupied and the loser lands on the same `|dup1` it would have
    landed on in a clean run.

SAFETY
    * Refuses to run unless SUPABASE_URL points at the staging project.
    * --dry-run is the default; nothing is written without --apply.
    * Staff accounts (@artpark.in/.info/.test) are skipped — masking those
      would break the logins staging depends on.
    * Every update is wrapped: one bad row is logged and counted, and the run
      continues to completion. A partial mask that reports honestly beats one
      that dies at row 64 and says nothing.

RUN IT TO COMPLETION, IN ONE GO
    The one operational rule. Identities are resolved across all three target
    tables in a single planning pass, but WRITES go table by table, so an
    interrupted run leaves a person masked in the tables it reached and
    unmasked in the tables it did not. The next run re-plans from a changed
    input set — the rows already masked are now exempt and drop out of the seed
    set — so that person can be assigned a DIFFERENT synthetic identity in the
    remaining tables. Simulated against the live staging snapshot: interrupting
    after 40 of the 226 `profiles` writes gave 157 of the 186 remaining rows a
    different stand-in than a clean run would have (the round-4 review measured
    151/186 from a slightly different interruption point — the exact count
    depends on where it stops; the shape is the same either way).

    What this is NOT: no real data is re-exposed, no synthetic address is ever
    duplicated (the `taken` set covers rows written by earlier runs), and no
    row already masked is touched again. The only symptom is cosmetic —
    /admin/users and the application detail page can disagree about one
    person's FAKE name, which reads as a product bug when it is not.

    So: let it finish, and check the summary line reports `0 failed`. If it was
    interrupted, the fix is to run it again and let it complete, not to poke at
    individual rows. Persisting the seed->identity map across runs would remove
    this entirely; that machinery was deliberately not built for a disposable
    demo environment.

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


def seed_key(original: str | None) -> str:
    """The exact string fake_identity() hashes.

    Dedupe and grouping key on THIS, not on the raw column value, so two
    spellings of the same seed ("A@B.com" / "a@b.com ") can never be handed
    two different synthetic identities — which would defeat the whole
    same-person-maps-to-the-same-stand-in promise.
    """
    return (original or "anonymous").strip().lower()


def fake_identity(original: str) -> dict:
    """Deterministic synthetic identity derived from `original`."""
    seed = seed_key(original)
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


def identity_seed(row: dict) -> str | None:
    """The identity key for one row, or None when the row is exempt.

    Seeded from the row's email when it has one, else its name — many staging
    rows have a null email but a real name, and those must still be masked.
    """
    email = row.get("basic_email") or row.get("email")
    if is_exempt(email):
        return None
    raw = email or row.get("basic_full_name") or row.get("full_name") or row.get("id") or ""
    return seed_key(str(raw))


def mask_row(row: dict, columns: set[str], ident: dict | None = None) -> dict:
    """Build the patch for one row. Keys are restricted to `columns`.

    `ident` lets the caller supply a pre-resolved, collision-free identity
    (see `resolve_identities`). Left out — as the unit tests do — it falls
    back to the plain per-row `fake_identity`, which is fine for a single row
    but is exactly what `build_plan` must NOT do across a whole table: two
    different seeds can hash to the same synthetic email, and
    `profiles.email` is `unique`.
    """
    seed = identity_seed(row)
    if seed is None:
        return {}

    if ident is None:
        ident = fake_identity(seed)

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

# Cap on re-salt attempts per seed. 8,736 handles against ~300 seeds means one
# attempt is almost always enough and two is the practical worst case; a
# runaway loop here would mean the pool has been shrunk to nothing, which is a
# bug worth crashing on rather than spinning forever.
_MAX_RESALTS = 1000


def resolve_identities(
    seeds: set[str] | list[str], taken: set[str] | None = None,
) -> tuple[dict[str, dict], set[str]]:
    """Assign exactly one synthetic identity per distinct seed, with no two
    distinct seeds sharing a synthetic email.

    Returns ``(identity_by_seed, seeds_that_were_re_salted)``.

    `taken` is a set of email addresses that are already occupied — in
    practice the current email of every row this run will NOT patch, so an
    address written by an earlier partial run counts as taken. A seed whose
    synthetic email is taken is re-salted with `|dup1`, `|dup2`, ... until it
    is free.

    Determinism: seeds are walked in sorted order, so the same input set
    always yields the same output set no matter what order PostgREST returned
    the rows in. Keying on the seed (not the row id) is deliberate — a seed
    can legitimately span several rows and several tables, and it must resolve
    to one identity in all of them.
    """
    assigned: dict[str, dict] = {}
    used = {str(t).strip().lower() for t in (taken or ()) if t}
    re_salted: set[str] = set()

    for seed in sorted(seeds):
        ident = fake_identity(seed)
        attempt = 0
        while ident["email"].lower() in used:
            attempt += 1
            if attempt > _MAX_RESALTS:
                raise RuntimeError(
                    f"no free synthetic email after {_MAX_RESALTS} re-salts — "
                    "the name pool is exhausted"
                )
            ident = fake_identity(f"{seed}|dup{attempt}")
        if attempt:
            re_salted.add(seed)
        used.add(ident["email"].lower())
        assigned[seed] = ident

    return assigned, re_salted


def build_plan(
    tables: dict[str, tuple[list[dict], set[str]]],
) -> tuple[dict[str, list[tuple[str, dict]]], dict[str, int], set[str]]:
    """Plan every write for every table BEFORE anything is written.

    `tables` maps table name -> (rows, live column set).
    Returns ``({table: [(row_id, patch), ...]},
    {table: re_salted_row_count}, {re_salted_seed, ...})`` — the row count and
    the seed count differ whenever one re-salted person owns rows in more than
    one table, which is the normal case here.

    Identity resolution spans all the tables at once so a person who appears
    in both `profiles` and `tir_applications` gets the same stand-in in both.
    Patches are emitted in row-id order, which also fixes the old behaviour
    where the write order (and therefore the abort point) depended on however
    PostgREST happened to page the table.
    """
    seeds: set[str] = set()
    taken: set[str] = set()
    for rows, _columns in tables.values():
        for row in rows:
            seed = identity_seed(row)
            if seed is None:
                current = row.get("basic_email") or row.get("email")
                if current:
                    taken.add(str(current).strip().lower())
            else:
                seeds.add(seed)

    identities, re_salted = resolve_identities(seeds, taken)

    plans: dict[str, list[tuple[str, dict]]] = {}
    counts: dict[str, int] = {}
    for table, (rows, columns) in tables.items():
        out: list[tuple[str, dict]] = []
        n_re_salted = 0
        for row in sorted(rows, key=lambda r: str(r.get("id"))):
            seed = identity_seed(row)
            if seed is None:
                continue
            patch = mask_row(row, columns, ident=identities[seed])
            if not patch:
                continue
            out.append((row["id"], patch))
            if seed in re_salted:
                n_re_salted += 1
        plans[table] = out
        counts[table] = n_re_salted
    return plans, counts, re_salted


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
    """Paginate. PostgREST silently caps a plain select at 1000 rows.

    `.order("id")` is not optional (M8, fixed in the seed script first and
    missed here): without a stable sort, PostgREST's `range` windows are cut
    from an unspecified order, so a row can come back in two pages — or in
    none — and the row a failing run stops at changes between runs.
    """
    wanted = sorted({"id"} | (columns & set(FIELD_MAP) | {"basic_teammates",
                    "github_url", "evidence_video_url", "sip_demo_video_url"}) & (columns | {"id"}))
    out: list[dict] = []
    page = 0
    while True:
        lo, hi = page * 500, page * 500 + 499
        chunk = (
            sb.table(table).select(",".join(wanted)).order("id").range(lo, hi).execute().data
        ) or []
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

    # Read + plan everything first. Nothing is written until every patch for
    # every table exists and every synthetic email is known to be unique.
    tables: dict[str, tuple[list[dict], set[str]]] = {}
    for table in TARGETS:
        cols = _columns_of(sb, table)
        if not cols:
            log.warning("%-20s no rows — skipping", table)
            continue
        tables[table] = (_fetch_all(sb, table, cols), cols)

    plans, re_salt_counts, re_salted_seeds = build_plan(tables)
    email_col = {"profiles": "email"}

    planned = written = failed = 0
    for table in TARGETS:
        if table not in tables:
            continue
        rows, _cols = tables[table]
        patches = plans[table]
        planned += len(patches)
        log.info("%-20s %d rows, %d to mask, %d re-salted to keep synthetic "
                 "emails unique", table, len(rows), len(patches), re_salt_counts[table])
        for rid, p in patches[:3]:
            log.info("    e.g. %s -> %s", str(rid)[:8], {k: p[k] for k in list(p)[:3]})
        # Show the re-salted rows explicitly: an operator should be able to see
        # the collision handling working rather than take it on trust. Only the
        # SYNTHETIC address is printed — never the real one it replaces.
        if re_salt_counts[table]:
            col = email_col.get(table, "basic_email")
            for rid, synthetic in _re_salted_examples(patches, rows, col):
                log.info("    re-salted: row %s -> %s", str(rid)[:8], synthetic)

        if args.apply:
            for rid, p in patches:
                try:
                    sb.table(table).update(p).eq("id", rid).execute()
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    log.error("    FAILED to mask %s row %s: %s", table, rid, exc)
                else:
                    written += 1

    re_salted_rows = sum(re_salt_counts.values())
    collisions = (f"{re_salted_rows} row(s) across {len(re_salted_seeds)} distinct "
                  f"identit{'y' if len(re_salted_seeds) == 1 else 'ies'} re-salted "
                  "to avoid an email collision")
    if args.apply:
        log.info("masked %d of %d rows (%d failed; %s)",
                 written, planned, failed, collisions)
        if failed:
            log.error("%d row(s) could not be masked — see the FAILED lines above. "
                      "Re-running is safe: already-masked rows are skipped and only "
                      "the failures are retried.", failed)
    else:
        log.info("would mask %d rows (%s)", planned, collisions)
        log.info("re-run with --apply to write")
    return 0


def _re_salted_examples(
    patches: list[tuple[str, dict]], rows: list[dict], email_col: str, limit: int = 3,
) -> list[tuple[str, str]]:
    """Up to `limit` (row_id, synthetic_email) pairs whose identity had to be
    re-salted, for the dry-run report. Recomputed rather than threaded through
    so the reporting path cannot influence the planning path."""
    by_id = {str(r.get("id")): r for r in rows}
    out: list[tuple[str, str]] = []
    for rid, patch in patches:
        if email_col not in patch:
            continue
        row = by_id.get(str(rid))
        if row is None:
            continue
        seed = identity_seed(row)
        if seed is None:
            continue
        if fake_identity(seed)["email"] != patch[email_col]:
            out.append((rid, patch[email_col]))
            if len(out) >= limit:
                break
    return out


if __name__ == "__main__":
    raise SystemExit(main())
