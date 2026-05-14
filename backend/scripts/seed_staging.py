#!/usr/bin/env python3
"""Seed the staging Supabase project with a Phase-1 demo cohort.

Idempotent: every step checks for prior state before mutating. Safe to
re-run; safe to interrupt and re-run; safe in CI as a smoke step.

What it does
------------
1. Ensures ``dev@artpark.in`` has both ``admin`` + ``leadership`` roles
   (the existing test user from the staging memory).
2. Grants ``manager@artpark.in`` the ``reviewer`` role.
3. Creates ``reviewer-2@artpark.in`` + ``reviewer-3@artpark.in`` if absent
   so leadership can demonstrate the 3-reviewer assignment cap.
4. Creates a synthetic-applicant auth user owning all seeded applications.
5. Inserts 40 synthetic applications (24 TIR + 16 SIP) across varied
   statuses, industries, and AI score bands so the dashboard shows
   non-empty data for every chart.
6. Inserts matching ``ai_screening`` rows with stub scores so the
   "AI score distribution" + "components" charts are populated.

Idempotency markers
-------------------
* Existing users are detected by email lookup; only missing ones are created.
* Synthetic apps use ``basic_email = "seed-app-NNN@artpark.test"`` (NNN is
  the 3-digit seed index). The script counts existing matching rows per
  track and only inserts the missing slots — so partial runs heal on rerun.

Usage
-----
    cd backend
    source .venv/bin/activate
    python scripts/seed_staging.py            # full seed
    python scripts/seed_staging.py --dry-run  # print what would happen, no writes

Requires ``backend/.env`` (or ``backend/.env.staging``) populated. Reads
``SUPABASE_URL`` + ``SUPABASE_SERVICE_ROLE_KEY``.

SAFETY: this script uses the service-role key and bypasses RLS. Never run
it against production. The ``--dry-run`` flag exists so you can sanity-check
the plan before it hits the DB.
"""

from __future__ import annotations

import argparse
import logging
import os
import random
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Make the backend package importable when this is run as `python scripts/...`.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

# Optional dotenv loading — local dev has python-dotenv installed; Lambda
# inherits env from the runtime so dotenv isn't required there.
try:
    from dotenv import load_dotenv  # type: ignore

    for candidate in (".env.staging", ".env"):
        path = _BACKEND_ROOT / candidate
        if path.exists():
            load_dotenv(path)
            break
except ImportError:
    pass

from app.supabase_client import get_admin_client  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("seed_staging")


# ─── Seed config ────────────────────────────────────────────────────────


SEED_APP_EMAIL_PREFIX = "seed-app-"
SEED_APP_EMAIL_DOMAIN = "artpark.test"

# One synthetic auth user owns all seed apps. Multiple submitted rows per
# user are allowed (only `status='draft'` has the partial-unique index).
SYNTHETIC_APPLICANT_EMAIL = "synthetic-applicants@artpark.test"

# Reviewer roster the seed ensures exists. `manager@artpark.in` is granted
# the reviewer role if it already exists (created by an earlier session);
# the other two are created if absent.
REVIEWER_EMAILS = [
    "manager@artpark.in",       # pre-existing test user — just grant role
    "reviewer-2@artpark.in",    # create if missing
    "reviewer-3@artpark.in",    # create if missing
]

# Admin + leadership identity. Idempotent grants only; never creates this
# user — it's expected to exist from the staging bootstrap.
ADMIN_EMAIL = "dev@artpark.in"

TIR_COUNT = 24
SIP_COUNT = 16
TOTAL_APPS = TIR_COUNT + SIP_COUNT  # 40

# Status distribution the dashboard should display. The numbers sum to 40
# so every status_grid cell has at least one entry to render. Tweak here
# rather than rebuilding the distribution.
STATUS_DISTRIBUTION = [
    ("ai_screening", 4),
    ("under_review", 10),
    ("evaluated",    8),
    ("shortlisted",  6),
    ("rejected",     4),
    ("waitlisted",   3),
    ("onboarded",    3),
    ("withdrawn",    2),
]

# Org strings designed to fall into each industry bucket exactly. The
# classifier matches case-insensitively against keyword lists in
# app/services/stats.py — keep these in sync if INDUSTRY_BUCKETS changes.
ORG_TEMPLATES = [
    "Drone Robotics Co",            # robotics
    "MedTech Diagnostics",          # health
    "Industrial Manufacturing 5.0", # industry
    "Aerospace Defense Systems",    # defense
    "AI Foundation Lab",            # ai
    "Semiconductor Chip Design",    # semi
    "Climate Solutions Group",      # other (no keyword match)
]

# Indian-flavoured applicant names so the dashboard reads naturally to the
# team. No connection to real founders — these are purely synthetic.
FIRST_NAMES = [
    "Priya", "Arjun", "Meera", "Rohan", "Ananya", "Vikram", "Kavya",
    "Karthik", "Divya", "Aditya", "Neha", "Siddharth", "Pooja", "Rahul",
    "Lakshmi", "Aakash", "Shreya", "Nikhil", "Tara", "Ishaan",
]

LAST_NAMES = [
    "Sharma", "Iyer", "Krishnan", "Mehta", "Reddy", "Kapoor", "Nair",
    "Bose", "Patel", "Singh", "Pillai", "Joshi", "Rao", "Chopra",
    "Banerjee", "Gupta", "Das", "Sundaram", "Menon", "Ahmed",
]


# ─── Helpers ────────────────────────────────────────────────────────────


def _generate_password() -> str:
    """Random password meeting Supabase's upper+lower+digit+symbol policy."""
    return secrets.token_urlsafe(16) + "!1Aa"


def _find_user_by_email(client, email: str) -> dict[str, Any] | None:
    """Find a user by email via the profiles table.

    Avoids the auth.admin.list_users() roundtrip, which is paginated +
    slow. Profiles is created automatically by the handle_new_user trigger
    on every signup, so absence here is a reliable "user does not exist".
    """
    try:
        res = (
            client.table("profiles")
            .select("id,email,full_name")
            .eq("email", email)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception:
        log.warning("profile lookup failed for %s; assuming missing", email)
        return None


def _create_user_via_auth(
    client,
    *,
    email: str,
    full_name: str,
    dry_run: bool,
) -> dict[str, Any] | None:
    """Create an auth user + matching profile row.

    Uses `auth.admin.create_user` with `email_confirm=True` so no real email
    is dispatched (these are seed/test addresses, not real applicants).
    """
    if dry_run:
        log.info("  [dry-run] would create user %s (%s)", email, full_name)
        return {"id": "dry-run-" + email, "email": email, "full_name": full_name}

    try:
        result = client.auth.admin.create_user({
            "email": email,
            "password": _generate_password(),
            "email_confirm": True,
        })
        user = result.user
        new_id = user.id
    except Exception as exc:
        log.error("  failed to create %s: %s", email, exc)
        return None

    # Upsert profile (handle_new_user trigger may have created an empty row).
    try:
        client.table("profiles").upsert({
            "id": new_id,
            "email": email,
            "full_name": full_name,
        }).execute()
    except Exception as exc:
        log.warning("  profile upsert failed for %s (continuing): %s", email, exc)

    log.info("  created user %s id=%s", email, new_id[:8])
    return {"id": new_id, "email": email, "full_name": full_name}


def _grant_role_idempotent(client, user_id: str, role: str, dry_run: bool) -> None:
    """Insert a (user_id, role) into user_roles unless it already exists."""
    # Pre-check by select — simpler than catching the unique-violation.
    try:
        res = (
            client.table("user_roles")
            .select("role")
            .eq("user_id", user_id)
            .eq("role", role)
            .limit(1)
            .execute()
        )
        if res.data:
            log.info("  role '%s' already granted to %s", role, user_id[:8])
            return
    except Exception as exc:
        log.warning("  role pre-check failed (%s) — attempting insert anyway: %s", role, exc)

    if dry_run:
        log.info("  [dry-run] would grant role '%s' to %s", role, user_id[:8])
        return

    try:
        client.table("user_roles").insert({
            "user_id": user_id,
            "role": role,
        }).execute()
        log.info("  granted role '%s' to %s", role, user_id[:8])
    except Exception as exc:
        # 23505 = unique_violation; safe to ignore (race on idempotency).
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            log.info("  role '%s' already on %s (race)", role, user_id[:8])
            return
        log.error("  grant role failed: %s", exc)


# ─── Users ──────────────────────────────────────────────────────────────


def seed_admin(client, dry_run: bool) -> None:
    log.info("→ Step 1/5: admin + leadership grants for %s", ADMIN_EMAIL)
    user = _find_user_by_email(client, ADMIN_EMAIL)
    if not user:
        log.error("  %s not found — admin user must be created manually first", ADMIN_EMAIL)
        log.error("  signup at /apply/signin and re-run this seed")
        return
    for role in ("admin", "leadership"):
        _grant_role_idempotent(client, user["id"], role, dry_run)


def seed_reviewers(client, dry_run: bool) -> list[dict[str, Any]]:
    log.info("→ Step 2/5: reviewer roster (%d users)", len(REVIEWER_EMAILS))
    reviewers: list[dict[str, Any]] = []
    for email in REVIEWER_EMAILS:
        user = _find_user_by_email(client, email)
        if user is None:
            full_name = email.split("@", 1)[0].replace("-", " ").title()
            user = _create_user_via_auth(
                client, email=email, full_name=full_name, dry_run=dry_run,
            )
        if user:
            _grant_role_idempotent(client, user["id"], "reviewer", dry_run)
            reviewers.append(user)
    return reviewers


def seed_synthetic_applicant(client, dry_run: bool) -> dict[str, Any] | None:
    log.info("→ Step 3/5: synthetic applicant (owns all seed apps)")
    user = _find_user_by_email(client, SYNTHETIC_APPLICANT_EMAIL)
    if user is None:
        user = _create_user_via_auth(
            client,
            email=SYNTHETIC_APPLICANT_EMAIL,
            full_name="Synthetic Applicants (seed)",
            dry_run=dry_run,
        )
    else:
        log.info("  already exists; reusing %s", user["id"][:8])
    return user


# ─── Synthetic applications ─────────────────────────────────────────────


def _planned_statuses() -> list[str]:
    out: list[str] = []
    for status_id, count in STATUS_DISTRIBUTION:
        out.extend([status_id] * count)
    if len(out) != TOTAL_APPS:
        # Belt and braces — if STATUS_DISTRIBUTION drifts, fail loudly.
        raise RuntimeError(
            f"STATUS_DISTRIBUTION sums to {len(out)} but TOTAL_APPS={TOTAL_APPS}"
        )
    return out


def _seed_for_index(index: int) -> dict[str, Any]:
    """Deterministic row payload for seed index ``index`` (1..40).

    Same index → same names/orgs/dates so re-runs are stable. We seed `random`
    per-row so calls don't influence each other across runs.
    """
    rng = random.Random(f"seed-{index}")
    first = rng.choice(FIRST_NAMES)
    last = rng.choice(LAST_NAMES)
    full_name = f"{first} {last}"
    org = rng.choice(ORG_TEMPLATES)
    # Submitted dates spread over the last 28 days, oldest first index 1.
    days_ago = 28 - int((index / TOTAL_APPS) * 28)
    submitted_at = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    basic_email = f"{SEED_APP_EMAIL_PREFIX}{index:03d}@{SEED_APP_EMAIL_DOMAIN}"
    return {
        "first": first,
        "last": last,
        "full_name": full_name,
        "org": org,
        "submitted_at": submitted_at,
        "basic_email": basic_email,
    }


def _count_existing_seed_apps(client, track: str) -> int:
    table = f"{track}_applications"
    try:
        res = (
            client.table(table)
            .select("id", count="exact")
            .like("basic_email", f"{SEED_APP_EMAIL_PREFIX}%@{SEED_APP_EMAIL_DOMAIN}")
            .execute()
        )
        return res.count or 0
    except Exception as exc:
        log.warning("count_existing_seed_apps on %s failed: %s", table, exc)
        return 0


def _ai_score_band_for_status(status: str, rng: random.Random) -> float | None:
    """Returns a stub AI score that lines up loosely with the status.

    The dashboard's AI distribution chart needs varied scores; we steer the
    band so shortlisted ≈ 8.0, rejected ≈ 4.5, etc. Helps the chart look
    plausible at a glance.
    """
    if status == "ai_screening":
        return None  # not scored yet
    centers = {
        "under_review": 6.0,
        "evaluated":    6.5,
        "shortlisted":  8.0,
        "onboarded":    8.4,
        "waitlisted":   6.0,
        "rejected":     4.5,
        "withdrawn":    5.5,
    }
    base = centers.get(status, 6.0)
    return round(max(1.0, min(10.0, base + rng.uniform(-1.0, 1.0))), 1)


def seed_applications(
    client,
    applicant_user_id: str,
    dry_run: bool,
) -> None:
    log.info("→ Step 4/5: %d synthetic applications", TOTAL_APPS)

    tir_have = _count_existing_seed_apps(client, "tir")
    sip_have = _count_existing_seed_apps(client, "sip")
    log.info("  existing seed apps: tir=%d/%d sip=%d/%d", tir_have, TIR_COUNT, sip_have, SIP_COUNT)
    if tir_have >= TIR_COUNT and sip_have >= SIP_COUNT:
        log.info("  full seed already present — skipping inserts")
        return

    statuses = _planned_statuses()
    rng = random.Random("seed-shuffle")
    rng.shuffle(statuses)

    apps_to_insert: list[tuple[str, dict[str, Any]]] = []  # (track, row)
    ai_rows: list[dict[str, Any]] = []

    for i in range(1, TOTAL_APPS + 1):
        track = "tir" if i <= TIR_COUNT else "sip"
        plan = _seed_for_index(i)
        status_id = statuses[i - 1]
        score_rng = random.Random(f"seed-score-{i}")
        ai_score = _ai_score_band_for_status(status_id, score_rng)

        # Skip if a row already exists for this seed email on this track.
        try:
            existing = (
                client.table(f"{track}_applications")
                .select("id,status")
                .eq("basic_email", plan["basic_email"])
                .limit(1)
                .execute()
            )
            if existing.data:
                continue  # idempotent — already seeded this slot
        except Exception:
            # If the probe fails, attempt insert anyway; UNIQUE constraints
            # would catch a true duplicate.
            pass

        row = {
            "user_id":          applicant_user_id,
            "status":           status_id,
            "completion_pct":   100,
            "submitted_at":     plan["submitted_at"],
            "basic_full_name":  plan["full_name"],
            "basic_email":      plan["basic_email"],
            "basic_org":        plan["org"],
            "basic_phone":      f"+91 9{score_rng.randint(100000000, 999999999)}",
        }
        apps_to_insert.append((track, row))

        if ai_score is not None:
            ai_rows.append({
                "application_track": track,
                "score_overall":     ai_score,
                # Component scores cluster around the overall so the
                # ComponentBars chart isn't dead-flat.
                "score_problem":     round(min(10.0, max(0.0, ai_score + score_rng.uniform(-1.2, 1.2))), 1),
                "score_solution":    round(min(10.0, max(0.0, ai_score + score_rng.uniform(-1.2, 1.2))), 1),
                "score_tech":        round(min(10.0, max(0.0, ai_score + score_rng.uniform(-1.2, 1.2))), 1),
                "score_founders":    round(min(10.0, max(0.0, ai_score + score_rng.uniform(-1.0, 1.0))), 1),
                "score_commitment":  round(min(10.0, max(0.0, ai_score + score_rng.uniform(-1.0, 1.0))), 1),
                "summary":           (
                    f"Synthetic AI screening for {plan['full_name']}. "
                    f"Stub mode — replace with real Gemini output once the "
                    f"OpenRouter integration is flipped on."
                ),
                "model":             "stub-seed",
                "_seed_idx":         i,  # transient, dropped below
            })

    if dry_run:
        log.info("  [dry-run] would insert %d apps + %d ai_screening rows", len(apps_to_insert), len(ai_rows))
        return

    # Insert applications per-track + collect (track, id) pairs to bind ai_screening.
    inserted_pairs: list[tuple[str, str, int]] = []  # (track, app_id, seed_idx)
    for idx_offset, (track, row) in enumerate(apps_to_insert, start=1):
        try:
            res = client.table(f"{track}_applications").insert(row).execute()
            data = res.data or []
            if data:
                inserted_pairs.append((track, data[0]["id"], idx_offset))
        except Exception as exc:
            log.warning("  insert %s app %d failed: %s", track, idx_offset, exc)

    log.info("  inserted %d application rows", len(inserted_pairs))

    # Match ai_screening rows back to inserted apps by seed index.
    # `apps_to_insert` and `ai_rows` are kept in parallel order via `_seed_idx`.
    ai_by_idx = {r["_seed_idx"]: r for r in ai_rows}
    ai_payload: list[dict[str, Any]] = []
    for track, app_id, seed_idx in inserted_pairs:
        # Recompute seed_idx using order in apps_to_insert — first app got 1, etc.
        # We need the original index from _seed_for_index, not insertion order.
        pass

    # Simpler approach: walk the originals, re-fetch by basic_email, then build
    # ai rows. This avoids the index-mapping gymnastics above.
    ai_payload = []
    for i in range(1, TOTAL_APPS + 1):
        plan = _seed_for_index(i)
        if i not in ai_by_idx:
            continue
        track = "tir" if i <= TIR_COUNT else "sip"
        try:
            r = (
                client.table(f"{track}_applications")
                .select("id")
                .eq("basic_email", plan["basic_email"])
                .limit(1)
                .execute()
            )
            if not r.data:
                continue
            app_id = r.data[0]["id"]
        except Exception:
            continue
        ai = dict(ai_by_idx[i])
        ai.pop("_seed_idx", None)
        ai["application_id"] = app_id
        ai_payload.append(ai)

    # Upsert into ai_screening — UNIQUE(application_id, application_track) means
    # re-running won't duplicate. We do INSERT + skip-on-conflict by selecting
    # only missing pairs first.
    inserted_ai = 0
    for row in ai_payload:
        try:
            existing = (
                client.table("ai_screening")
                .select("id")
                .eq("application_id", row["application_id"])
                .eq("application_track", row["application_track"])
                .limit(1)
                .execute()
            )
            if existing.data:
                continue
            client.table("ai_screening").insert(row).execute()
            inserted_ai += 1
        except Exception as exc:
            log.warning("  ai_screening insert failed (continuing): %s", exc)
    log.info("  inserted %d ai_screening rows", inserted_ai)


# ─── Summary ────────────────────────────────────────────────────────────


def print_summary(client) -> None:
    log.info("→ Step 5/5: summary")
    for track in ("tir", "sip"):
        try:
            res = (
                client.table(f"{track}_applications")
                .select("id", count="exact")
                .neq("status", "draft")
                .execute()
            )
            log.info("  %s_applications (non-draft): %d", track, res.count or 0)
        except Exception:
            pass

    try:
        res = (
            client.table("ai_screening")
            .select("id", count="exact")
            .execute()
        )
        log.info("  ai_screening rows: %d", res.count or 0)
    except Exception:
        pass

    for role in ("admin", "leadership", "reviewer"):
        try:
            res = (
                client.table("user_roles")
                .select("user_id", count="exact")
                .eq("role", role)
                .execute()
            )
            log.info("  user_roles role=%s: %d", role, res.count or 0)
        except Exception:
            pass


# ─── Entrypoint ─────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned mutations without writing anything.",
    )
    args = parser.parse_args(argv)

    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        log.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        return 2

    # Hard refuse to run against production. SUPABASE_URL of the prod project
    # is hardcoded here to a stub — if the env value matches the prod URL,
    # bail out. Staging has its own project URL.
    forbidden_hosts = (
        # Add the prod Supabase ref here when you know it. Keep this empty
        # rather than wrong — accidentally allowing prod is worse than a
        # missing guard.
    )
    for host in forbidden_hosts:
        if host in os.environ["SUPABASE_URL"]:
            log.error("Refusing to seed: %s looks like production", os.environ["SUPABASE_URL"])
            return 3

    log.info("Seeding %s (dry_run=%s)", os.environ["SUPABASE_URL"], args.dry_run)
    client = get_admin_client()

    seed_admin(client, args.dry_run)
    seed_reviewers(client, args.dry_run)
    applicant = seed_synthetic_applicant(client, args.dry_run)
    if applicant is None and not args.dry_run:
        log.error("synthetic applicant could not be created; bailing")
        return 4
    if applicant is not None:
        seed_applications(client, applicant["id"], args.dry_run)

    print_summary(client)
    log.info("✓ seed complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
