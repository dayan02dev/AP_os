"""Shape twelve STAGING applications into a full pipeline tour and create the
demo login.

WHY
    Product managers get a guided demo of the whole applicant pipeline —
    submitted through offered/rejected, including reviewer disagreement, a
    Gate-1 hold, a signed IC memo, and a track-move — without touching
    production and without a bespoke fixture database. Twelve REAL staging
    applications are reused and reshaped (reviews/decisions/status) rather
    than invented, so the content reads like the real product.

WHAT IS WRITTEN
    A `demo@artpark.test` login with admin + leadership + reviewer roles (no
    applicant — the wizard is not part of this tour). Three roster reviewer
    accounts (`reviewer-demo-1..3@artpark.test`) and two batches. Twelve
    application rows get reviewer_assignments, reviews, an ai_screening row,
    a batch slot, admin_decisions, jury_assignments/jury_selections, an
    ic_documents memo, and (for one row) a track-move — then, last, the
    application's own `status`.

DETERMINISM
    `application_admin_meta` has no free column to tag a row with, so
    selection is deterministic by APPLICATION ID rather than by a marker
    (see `select_demo_rows`). Twelve ids are PINNED in
    `PINNED_APPLICATION_IDS` (recorded from the round where this script was
    reviewed) so a second `--apply` targets the exact same twelve
    applications as the first, instead of drifting: slot 10 writes status
    `offered`, which the candidate pool excludes, so on a naive re-run
    slot 10's own application would drop out of its own pool and every
    later slot would shift onto a previously-untouched application — silent
    cohort growth, one application at a time, on every re-run. Each slot
    resolves to its pinned id independently; a slot whose pinned id has
    left the pool (status changed, application withdrawn, etc.) falls back
    to the sorted-order rule and logs a warning, since that is the case a
    human needs to look at. Candidates with no pinning info at all (e.g. a
    caller that never passes `pinned`) fall back to sorted-order for every
    slot, same as before pinning existed.

    THIS LIST GOES STALE if staging is ever re-imported from production —
    the ids it pins may no longer exist, or may point at different
    applications after a fresh import. Regenerate it: run a dry run against
    the fresh pool and copy its twelve resolved ids into
    `PINNED_APPLICATION_IDS`.

SCHEMA WARNING
    The migration files do NOT describe staging's live schema — migration
    022 reshaped `reviews` out from under migration 014's column list, for
    example. Every insert in this script is built from columns confirmed
    against the LIVE table (via `select=*` and, for tables with zero rows,
    the PostgREST OpenAPI schema), never from a migration file.

SAFETY
    * Refuses to run unless SUPABASE_URL points at the staging project.
    * --dry-run is the default; nothing is written without --apply.
    * Never deletes an application row.
    * Never selects claude-test-applicant-sip@artpark.in as a demo row — the
      in-progress VIP branch tests against that founder.
    * The demo password is generated at runtime and printed to stdout only —
      this repo is public.

USAGE
    cd backend
    python scripts/seed_demo_cohort.py              # dry run
    python scripts/seed_demo_cohort.py --apply
    python scripts/seed_demo_cohort.py --apply --reset-password  # mint a new
                                                                  # demo login
                                                                  # even if it
                                                                  # already exists
"""

from __future__ import annotations

import argparse
import logging
import os
import secrets
import sys
import uuid
from datetime import UTC, datetime
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
log = logging.getLogger("seed_demo_cohort")

STAGING_PROJECT_ID = "exqmxvdtcsvpgtftwjml"
PROD_PROJECT_ID = "xtmszlpwgbyoumalgbhs"

DEMO_EMAIL = "demo@artpark.test"

# The in-progress VIP onboarding branch tests against this founder — never
# pick it as a demo row, on either track.
_EXCLUDED_EMAILS = {"claude-test-applicant-sip@artpark.in"}

# One entry per demo slot. `reviews` selects a recommendation set; `gate` writes
# an admin_decisions row; `memo` controls ic_documents; `moved` sets
# moved_to_track so the effective-track overlay badge appears.
#
# NOTE on the memo placement (corrected after initial review): the draft this
# was transcribed from put "signed" on BOTH slot 8 and slot 10, which collides
# with TestPlanShape.test_exactly_one_slot_has_a_signed_memo (exactly one
# signed memo across the plan). The signed memo belongs on slot 8, NOT slot
# 10 — the Admin "Selected Applications" tab (AdminSelectedApplications.jsx)
# only ever fetches status=jury_review plus gate-2-rejected rows (its `pipeline`
# and `rejectedPipeline` queries), and its green ACCEPTED row
# (`decisionStateOf`) requires `doc.signed`. Slot 10 is `offered`, so it never
# appears on that tab at all — a signed memo sitting there would never render
# as the green row anywhere in the demo. Slot 8 is `jury_review`, so it DOES
# render there, with a signed memo, as the green ACCEPTED example (spec §6.1).
# Slot 10 deliberately has NO memo — do not "helpfully" add one back, it will
# break test_exactly_one_slot_has_a_signed_memo again.
DEMO_PLAN = [
    {"slot": 1,  "track": "tir", "status": "submitted",    "reviews": "none",       "gate": None,          "memo": None,     "moved": False},
    {"slot": 2,  "track": "tir", "status": "under_review", "reviews": "none",       "gate": None,          "memo": None,     "moved": False},
    {"slot": 3,  "track": "tir", "status": "under_review", "reviews": "split",      "gate": None,          "memo": None,     "moved": False},
    {"slot": 4,  "track": "tir", "status": "evaluated",    "reviews": "verdict_yes","gate": None,          "memo": None,     "moved": False},
    {"slot": 5,  "track": "tir", "status": "evaluated",    "reviews": "verdict_no", "gate": None,          "memo": None,     "moved": False},
    {"slot": 6,  "track": "tir", "status": "on_hold",      "reviews": "verdict_yes","gate": "on_hold",     "memo": None,     "moved": False},
    {"slot": 7,  "track": "tir", "status": "jury_review",  "reviews": "verdict_yes","gate": "jury_review", "memo": None,     "moved": False},
    {"slot": 8,  "track": "tir", "status": "jury_review",  "reviews": "verdict_yes","gate": "jury_review", "memo": "signed", "moved": False},
    {"slot": 9,  "track": "tir", "status": "rejected",     "reviews": "verdict_no", "gate": "gate2_reject","memo": None,     "moved": False},
    {"slot": 10, "track": "tir", "status": "offered",      "reviews": "verdict_yes","gate": "gate2_offer", "memo": None,     "moved": False},
    {"slot": 11, "track": "sip", "status": "jury_review",  "reviews": "verdict_yes","gate": "jury_review", "memo": None,     "moved": False},
    {"slot": 12, "track": "tir", "status": "jury_review",  "reviews": "split",      "gate": "jury_review", "memo": None,     "moved": True},
]

# NEW-1 (round 2, 2026-08-24 review): pinned from the round-1 report so a
# second --apply targets the SAME twelve applications as the first, rather
# than drifting. Slot 10 writes status `offered`, which the candidate pool
# excludes (C1) — so a naive re-run would find slot 10's OWN application no
# longer in its own pool, and the pure-sorted-order rule in
# `select_demo_rows` would then shift every later slot onto a
# previously-untouched application. `select_demo_rows` resolves each slot
# to its own pinned id independently, so losing one pin can only ever
# affect that one slot.
#
# STALE WARNING: this list must be regenerated if staging is ever
# re-imported from production — see the module docstring.
PINNED_APPLICATION_IDS: dict[int, str] = {
    1:  "06fec58f-ee52-4108-8233-aedbe7be4b9c",
    2:  "0976e40d-ce45-4630-8c5d-72a27632b7ad",
    3:  "0a79fd93-d418-4848-a236-52a827d69452",
    4:  "14ff7156-a8d1-4ddc-b1a6-b9de7fbcd619",
    5:  "1790618c-6f2f-44c1-bb81-ef09584d7fa2",
    6:  "1b3bc14b-9bdc-440e-9b24-a42c0c66f82e",
    7:  "1bc5c5ca-5c4e-49e0-9755-cb580ad619b6",
    8:  "1fc86d90-a7c1-4121-9755-270c5dfb63c1",
    9:  "2607afb2-6d3a-4048-8ed0-9807d3850f25",
    10: "2626f42a-b770-474c-8271-81a26c1725fe",
    11: "4af584c4-6b6d-4331-a7db-878b4ae8c3d1",
    12: "283c71f5-af2c-493b-a3f5-67b4e04c065f",
}

_SCORES = {
    "score_problem": 7.5, "score_solution": 7.0, "score_tech": 8.0,
    "score_founders": 7.5, "score_commitment": 8.0, "score_integrity": 8.5,
    "score_overall": 7.7,
}
_SUBMITTED = "2026-07-15T10:00:00+00:00"

_REVIEW_SETS = {
    "none": [],
    "split": ["yes", "maybe"],
    "verdict_yes": ["yes", "yes", "maybe"],
    "verdict_no": ["no", "no", "maybe"],
}


def _jittered_scores(slot: int) -> dict:
    """`_SCORES` offset by a small, deterministic, per-slot amount (C2,
    2026-08-24 review). Without this, every review on every slot carries the
    exact same score_overall (7.7) as the canned ai_screening row this script
    used to write everywhere — reviewer avgVariance came out to exactly 0.0
    and the Reviewers-screen consistency metric to exactly 1.0 for every
    reviewer, which reads as fabricated data, not a demo. Derived from the
    slot number (not random) so re-runs stay idempotent: same slot, same
    jitter, every time.

    Modulo 12 (not 9, round-2 nit): with exactly twelve slots numbered 1-12,
    `% 9` only produced nine distinct remainders, so slots 1/10, 2/11 and
    3/12 collided on identical jitter. `% 12` gives one distinct offset per
    slot, all twelve different. Range is -0.6..+0.5 in steps of 0.1, small
    enough that every score stays a plausible 6.4-9.0.
    """
    jitter = ((slot * 37) % 12 - 6) / 10.0
    return {k: round(v + jitter, 1) for k, v in _SCORES.items()}


def reviews_for(spec: str, slot: int = 0) -> list[dict]:
    """Review rows for a slot. NOTE: the live `reviews` table has no `status`
    column — `submitted_at` is what marks a review submitted, which is what
    `reco_verdict` and the auto-transition both key on.

    `slot` defaults to 0 so the signature stays call-compatible with the
    original single-argument tests; the seed driver always passes the real
    slot number so scores are jittered per application (see
    `_jittered_scores`)."""
    scores = _jittered_scores(slot)
    out = []
    for rec in _REVIEW_SETS[spec]:
        out.append({
            **scores,
            "recommendation": rec,
            "strengths": "Strong technical grounding; credible route to a pilot.",
            "concerns": "Go-to-market is thin and the team is small for the scope.",
            "submitted_at": _SUBMITTED,
        })
    return out


def select_demo_rows(
    candidates: list[dict], plan: list[dict], pinned: dict[int, str] | None = None,
) -> list[tuple[dict, dict]]:
    """Pair each plan slot with a candidate application, deterministically.

    Without `pinned`: sorted by id, so the same pool always yields the same
    twelve, regardless of the order PostgREST returned them.
    `application_admin_meta` has no spare column to tag rows with, so
    stability comes from the ordering rather than from a marker. (All the
    original callers/tests use this path and are unaffected by the
    `pinned` parameter below — none of their synthetic ids ever match a
    real pinned id, so every slot always falls through to this rule.)

    With `pinned` (a ``{slot: application_id}`` map — see
    `PINNED_APPLICATION_IDS`): each slot FIRST tries to resolve to its own
    pinned id, independently of every other slot. This is what NEW-1 (round
    2, 2026-08-24 review) fixes: with sorted-order-only selection, losing
    ONE previously-chosen application from the pool (e.g. slot 10 writes
    status `offered`, which the pool then excludes on the next run) shifted
    every slot that sorted after it onto a different, previously-untouched
    application — silent, undetected drift on every re-run. Resolving each
    slot independently means a lost pin can only ever affect that one slot.

    A slot whose pinned id is missing from `candidates` (or already claimed
    by an earlier plan entry, which should never legitimately happen) falls
    back to the sorted-order rule, filled from whichever candidates remain
    once every other pinned slot has claimed its row, and logs a warning —
    that fallback is exactly the situation a human needs to look at, because
    the recorded pinned-id list is no longer fully accurate.
    """
    if len(candidates) < len(plan):
        raise ValueError(
            f"not enough candidate applications: need {len(plan)}, have {len(candidates)}"
        )

    if not pinned:
        ordered = sorted(candidates, key=lambda r: str(r["id"]))
        return [(ordered[i], plan[i]) for i in range(len(plan))]

    by_id = {str(c["id"]): c for c in candidates}
    result: list[tuple[dict, dict] | None] = [None] * len(plan)
    used_ids: set[str] = set()
    unresolved: list[int] = []

    for i, p in enumerate(plan):
        pin = pinned.get(p["slot"])
        cand = by_id.get(pin) if pin else None
        if cand is not None and str(cand["id"]) not in used_ids:
            result[i] = (cand, p)
            used_ids.add(str(cand["id"]))
        else:
            unresolved.append(i)

    remaining = sorted(
        (c for c in candidates if str(c["id"]) not in used_ids),
        key=lambda r: str(r["id"]),
    )
    if len(remaining) < len(unresolved):
        raise ValueError(
            f"not enough candidate applications: need {len(plan)}, have {len(candidates)}"
        )
    # strict=False: `remaining` may legitimately be longer than `unresolved`
    # (more spare candidates than fallback slots needed) — zip is meant to
    # truncate here, not to assert equal length.
    for slot_index, cand in zip(unresolved, remaining, strict=False):
        p = plan[slot_index]
        log.warning(
            "select_demo_rows: slot %s pinned id %s not resolvable in the "
            "current pool — falling back to sorted-order pick %s. A human "
            "should check whether PINNED_APPLICATION_IDS needs updating.",
            p["slot"], pinned.get(p["slot"]), cand["id"],
        )
        result[slot_index] = (cand, p)

    return result  # type: ignore[return-value]


# ─── apply half ────────────────────────────────────────────────────────────

_ROSTER_REVIEWERS = [
    f"reviewer-demo-{i}@artpark.test" for i in (1, 2, 3)
]
_ROSTER_DOMAINS = [
    ["hardware", "robotics"],
    ["climate-tech", "materials"],
    ["healthtech", "diagnostics"],
]

_SECTION_BULLETS = {
    "problem": [
        "The problem is described with a concrete, quantifiable failure mode.",
        "Severity is tied to a specific stakeholder who bears the cost today.",
        "The status quo workaround is named and its limits are explained.",
    ],
    "solution": [
        "The approach maps directly onto the stated problem, not a generic pitch.",
        "A working prototype or pilot is referenced as evidence.",
        "The team names the hardest technical step and how they closed it.",
    ],
    "moats": [
        "Domain expertise on the founding team is hard to replicate quickly.",
        "Early customer relationships give a data or distribution edge.",
        "Some IP or proprietary process is claimed, though not yet filed.",
    ],
    "watchouts": [
        "Go-to-market motion is thin relative to the technical depth shown.",
        "Team size looks small for the scope of the roadmap described.",
        "Regulatory or procurement cycles could slow the path to revenue.",
    ],
}

_IC_BUCKET = "ic-documents"
_PDF_MIME = "application/pdf"


def _pdf_escape(text: str) -> str:
    """Escape a literal string for a PDF content stream: backslash and the
    two parens are the only characters `(...)` strings must escape."""
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _minimal_pdf(lines: list[str]) -> bytes:
    """A hand-rolled, single-page, valid PDF — no external library, so no new
    entry in requirements.txt. Renders `lines` top-to-bottom in Helvetica on
    a Letter page. Good enough for a browser to open and a human to read;
    not a general-purpose PDF writer.

    Structure: catalog -> pages -> one page -> a Helvetica font -> a content
    stream of absolute text-positioning (Tm) + show-text (Tj) operators, then
    a byte-accurate xref table + trailer so real PDF readers (not just
    permissive ones) accept it.
    """
    content_lines = [b"BT", b"/F1 14 Tf"]
    y = 720
    for line in lines:
        escaped = _pdf_escape(line).encode("latin-1", "replace")
        content_lines.append(b"1 0 0 1 72 %d Tm (%s) Tj" % (y, escaped))
        y -= 22
    content_lines.append(b"ET")
    content = b"\n".join(content_lines)

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]

    buf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(buf))
        buf += b"%d 0 obj\n" % i + obj + b"\nendobj\n"

    xref_offset = len(buf)
    buf += b"xref\n0 %d\n" % (len(objects) + 1)
    buf += b"0000000000 65535 f \n"
    for off in offsets:
        buf += b"%010d 00000 n \n" % off
    buf += b"trailer\n<< /Size %d /Root 1 0 R >>\n" % (len(objects) + 1)
    buf += b"startxref\n%d\n%%%%EOF" % xref_offset
    return bytes(buf)


_PLACEHOLDER_NOTICE = [
    "ARTPARK demo environment",
    "Placeholder IC memo -- NOT a real document.",
    "Generated by scripts/seed_demo_cohort.py for staging only.",
]


def _upload_placeholder_pdf(sb, storage_path: str, extra_lines: list[str]) -> None:
    """Best-effort upload of a hand-rolled placeholder PDF to the ic-documents
    bucket. Upsert semantics: re-running never fails on a conflict and never
    needs an existence check first (`upsert: true` overwrites in place with
    the same content, which is a no-op in every way that matters).

    Failures are logged and swallowed rather than raised — a storage hiccup
    on one slot's memo must not abort the other eleven slots' writes."""
    try:
        sb.storage.from_(_IC_BUCKET).upload(
            path=storage_path,
            file=_minimal_pdf(_PLACEHOLDER_NOTICE + extra_lines),
            file_options={"content-type": _PDF_MIME, "upsert": "true"},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("ic_documents: placeholder PDF upload failed for %s: %s",
                    storage_path, exc)


def _guard(url: str) -> None:
    if PROD_PROJECT_ID in url:
        log.error("REFUSING: SUPABASE_URL points at PRODUCTION.")
        sys.exit(2)
    if STAGING_PROJECT_ID not in url:
        log.error("REFUSING: SUPABASE_URL is not the known staging project.")
        log.error("  expected to contain: %s", STAGING_PROJECT_ID)
        sys.exit(2)


def _gen_password() -> str:
    # Supabase policy: upper+lower+digit+symbol. token_urlsafe lacks a symbol.
    return secrets.token_urlsafe(9) + "!1Aa"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _table_for(track: str) -> str:
    return "tir_applications" if track == "tir" else "sip_applications"


def _find_user_by_email(sb, email: str):
    """Walk every page of auth.admin.list_users until the email is found or
    the roster is exhausted. list_users does not auto-paginate."""
    target = email.lower()
    page = 1
    while True:
        batch = sb.auth.admin.list_users(page=page, per_page=200)
        if not batch:
            return None
        hit = next((u for u in batch if (u.email or "").lower() == target), None)
        if hit or len(batch) < 200:
            return hit
        page += 1


def _find_or_create_user(sb, email: str, *, apply: bool) -> tuple[str | None, str | None]:
    """Return (user_id, password). password is None for a pre-existing user;
    a freshly generated one only when this call created the account."""
    existing = _find_user_by_email(sb, email)
    if existing:
        return existing.id, None
    if not apply:
        return None, None
    password = _gen_password()
    created = sb.auth.admin.create_user({
        "email": email, "password": password, "email_confirm": True,
    })
    return created.user.id, password


def _columns_of(sb, table: str) -> set[str]:
    """Live column set. The migration files are NOT authoritative — `reviews`
    proves it — so always ask the database. A table with zero rows returns
    nothing from a row sample; fall back to the PostgREST OpenAPI schema,
    which describes every table regardless of row count."""
    rows = sb.table(table).select("*").limit(1).execute().data or []
    if rows:
        return set(rows[0].keys())
    try:
        import httpx

        base = os.environ["SUPABASE_URL"].rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        resp = httpx.get(
            f"{base}/rest/v1/",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=30,
        )
        props = (resp.json().get("definitions", {}).get(table, {}) or {}).get("properties", {})
        return set(props.keys())
    except Exception as exc:  # noqa: BLE001
        log.warning("could not introspect empty table %s via OpenAPI: %s", table, exc)
        return set()


# Statuses a candidate must NOT already be in. `draft` is obviously not a
# real application yet. `offered`/`onboarded` are excluded for a sharper
# reason (C1, 2026-08-24 review): Founder/VIP portal access is gated on
# owning an application in offered/onboarded, and the VIP onboarding branch
# is mid-build against this same staging stack. Demoting one of staging's
# few offered/onboarded rows to a lesser status (which is what every slot in
# DEMO_PLAN does — none of them target `offered` as a NO-OP, slot 10 assigns
# it fresh) would break someone else's in-progress work, irreversibly. Never
# select an application that is already further along than the state a slot
# intends to put it in.
_EXCLUDED_STATUSES = {"draft", "offered", "onboarded"}


def _fetch_all_apps(sb, track: str) -> list[dict]:
    """Non-draft, non-offered, non-onboarded applications for one track,
    paginated (PostgREST caps a plain select at 1000 rows) and ordered by id
    (M8: unordered paging can return a row twice across pages, and
    `select_demo_rows` does not dedupe)."""
    table = _table_for(track)
    out: list[dict] = []
    page = 0
    while True:
        lo, hi = page * 500, page * 500 + 499
        chunk = (
            sb.table(table)
            .select("id,status,basic_email")
            .neq("status", "draft")
            .order("id")
            .range(lo, hi)
            .execute()
            .data
        ) or []
        out.extend(chunk)
        if len(chunk) < 500:
            break
        page += 1
    return [
        {"id": r["id"], "status": r.get("status"), "track": track}
        for r in out
        if r.get("status") not in _EXCLUDED_STATUSES
        and (r.get("basic_email") or "").strip().lower() not in _EXCLUDED_EMAILS
    ]


def _prefer_ai_screened(sb, track: str, candidates: list[dict], needed: int) -> list[dict]:
    """Prefer candidates that already carry an ai_screening row, so the AI
    panels have something to show. Falls back to the full pool if that
    isn't enough (the `where possible` in the brief)."""
    try:
        ids = [c["id"] for c in candidates]
        screened = set()
        for i in range(0, len(ids), 200):
            chunk_ids = ids[i:i + 200]
            rows = (
                sb.table("ai_screening")
                .select("application_id")
                .eq("application_track", track)
                .in_("application_id", chunk_ids)
                .execute()
                .data
            ) or []
            screened |= {r["application_id"] for r in rows}
    except Exception as exc:  # noqa: BLE001
        log.warning("ai_screening lookup failed for track=%s: %s", track, exc)
        return candidates

    preferred = [c for c in candidates if c["id"] in screened]
    if len(preferred) >= needed:
        return preferred
    return candidates


# Every column this script writes, per table — checked against the LIVE
# schema before any write happens. This is the actual enforcement of the
# module's central warning: migrations do not describe staging's live
# schema, so column names are verified against the database, not assumed
# from a CREATE TABLE statement.
_EXPECTED_COLUMNS: dict[str, set[str]] = {
    "profiles": {"id", "email", "full_name"},
    "user_roles": {"user_id", "role", "granted_at"},
    "reviewer_profiles": {"reviewer_user_id", "expertise_domains", "weight"},
    "batches": {"id", "name", "created_at", "updated_at"},
    "batch_reviewers": {"batch_id", "reviewer_user_id", "added_by", "added_at"},
    "reviewer_assignments": {
        "id", "application_id", "application_track", "reviewer_user_id",
        "assigned_by", "assigned_at", "state", "due_at",
    },
    "reviews": {
        "application_id", "application_track", "reviewer_user_id", "assignment_id",
        "score_problem", "score_solution", "score_tech", "score_founders",
        "score_commitment", "score_integrity", "score_overall", "recommendation",
        "strengths", "concerns", "submitted_at",
    },
    "ai_screening": {
        "application_id", "application_track", "score_problem", "score_completeness",
        "score_tech", "score_founders", "score_commitment", "score_integrity",
        "score_overall", "confidence", "summary", "flags", "model", "ran_at",
        "error", "sections",
    },
    "application_batches": {"application_id", "application_track", "batch_id", "added_at"},
    "admin_decisions": {
        "application_id", "application_track", "gate_stage", "decision",
        "rationale", "decided_by", "decided_at",
    },
    "jury_assignments": {
        "application_id", "application_track", "juror_user_id", "assigned_by", "assigned_at",
    },
    "jury_selections": {
        "application_id", "application_track", "juror_user_id", "note",
        "submitted_at", "updated_at",
    },
    "ic_documents": {
        "application_id", "application_track", "bucket", "storage_path", "file_name",
        "uploaded_by", "uploaded_at", "created_at", "updated_at",
        "signed_storage_path", "signed_file_name", "signed_by", "signer_name", "signed_at",
        "superseded_at",
    },
    "tir_applications": {"id", "status", "basic_email", "moved_to_track", "moved_at", "moved_by"},
    "sip_applications": {"id", "status", "basic_email"},
    "application_status_log": {
        "application_id", "application_track", "from_status", "to_status",
        "changed_by", "reason", "changed_at",
    },
}


def _verify_application_batches_conflict_target(sb) -> bool:
    """Prove — WITHOUT writing anything, ever — that `application_batches`
    has a unique/exclusion constraint on exactly (application_id,
    application_track, batch_id), which is the on_conflict target
    `_ensure_batch_slot` upserts against.

    Why this needs its own probe instead of a column check: migration 024
    created a 2-column unique constraint on this table and migration 034
    step 2 replaces it with the 3-column one. Both migrations leave the same
    columns in place either way, so `_verify_schema`'s column-existence check
    is blind to which constraint is actually live. If only 024 landed, the
    real upsert in `_ensure_batch_slot` raises 42P10 ("no unique or exclusion
    constraint matching the ON CONFLICT specification") on slot 1 and aborts
    mid-write. Evidence (git history) says 034 was atomic and did land, but
    this script should not run its first real write on "probably".

    Technique (genuinely read-only, not just "cleans up after itself"):
    attempt the exact same upsert `_ensure_batch_slot` would issue, with
    `application_id`/`batch_id` set to a freshly-generated random UUID that
    is certain not to exist. Postgres resolves an ON CONFLICT arbiter against
    pg_constraint/pg_index BEFORE it ever attempts to insert a row — so if
    the 3-column constraint is missing, this raises 42P10 immediately and
    nothing is ever inserted. If the constraint DOES exist, Postgres proceeds
    to the insert, which then hits the always-guaranteed-to-fail foreign key
    on `batch_id` (a random UUID can't reference a real `batches` row) and
    raises 23503 instead — again, nothing is ever inserted, because the
    whole statement is one all-or-nothing transaction. Either branch leaves
    zero rows behind; verified empirically during this fix (probe run,
    followed by a SELECT confirming no row was left over).
    """
    probe_id = str(uuid.uuid4())
    try:
        sb.table("application_batches").upsert(
            {"application_id": probe_id, "application_track": "tir",
             "batch_id": probe_id, "added_at": _now()},
            on_conflict="application_id,application_track,batch_id",
            ignore_duplicates=True,
        ).execute()
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "42P10" in msg or "no unique or exclusion constraint" in msg.lower():
            log.error("schema check: application_batches has NO unique constraint "
                      "on (application_id, application_track, batch_id) — migration "
                      "034 step 2 has not landed on this project; refusing to write")
            return False
        if "23503" in msg or "violates foreign key" in msg.lower():
            return True  # constraint resolved fine; it failed at the FK check instead
        log.error("schema check: application_batches conflict-target probe raised an "
                  "unrecognized error — cannot confirm the constraint exists, "
                  "refusing to proceed: %s", msg)
        return False
    else:
        # Should be impossible (the FK is guaranteed to fail) — if it somehow
        # inserted a row, clean up immediately and hard-fail rather than
        # silently trusting an unverified assumption.
        sb.table("application_batches").delete().eq("application_id", probe_id).execute()
        log.error("schema check: application_batches conflict-target probe "
                  "unexpectedly inserted a row (cleaned up) — investigate before "
                  "trusting this check")
        return False


def _verify_schema(sb) -> bool:
    """Confirm every column this script writes actually exists on the LIVE
    table, and that `application_batches`'s on_conflict target is real (see
    `_verify_application_batches_conflict_target`). Returns False (and logs
    every mismatch) if anything is wrong, so the caller can refuse to run
    rather than fail midway through with a 400 after some slots have already
    been written."""
    ok = True
    for table, expected in _EXPECTED_COLUMNS.items():
        live = _columns_of(sb, table)
        if not live:
            log.warning("schema check: %-24s no columns discovered (table empty and "
                        "OpenAPI introspection failed) — proceeding without verification", table)
            continue
        missing = expected - live
        if missing:
            log.error("schema check: %-24s LIVE table is missing columns this script "
                      "writes: %s", table, sorted(missing))
            ok = False
    if not _verify_application_batches_conflict_target(sb):
        ok = False
    return ok


def _ensure_role(sb, user_id: str, role: str, *, apply: bool) -> None:
    if not apply:
        return
    sb.table("user_roles").upsert(
        {"user_id": user_id, "role": role, "granted_at": _now()},
        on_conflict="user_id,role", ignore_duplicates=True,
    ).execute()


def _ensure_demo_account(sb, *, apply: bool, reset_password: bool = False) -> tuple[str | None, str | None]:
    """Find or create demo@artpark.test. Grants admin+leadership+reviewer,
    never applicant (the wizard is hidden for these roles already; adding
    applicant would just muddle the role switcher).

    I4 (2026-08-24 review): spec §6.2 calls for "three reviewer accounts
    PLUS the demo account, with reviewer_profiles rows" — the demo account
    holds the reviewer role but had no reviewer_profiles row of its own.
    Added below, same shape as the roster's.
    """
    user_id, password = _find_or_create_user(sb, DEMO_EMAIL, apply=apply)
    if user_id is None:
        log.info("[dry-run] would create/find %s", DEMO_EMAIL)
        return None, None

    if reset_password and apply and password is None:
        password = _gen_password()
        sb.auth.admin.update_user_by_id(user_id, {"password": password})

    if apply:
        sb.table("profiles").upsert({
            "id": user_id, "email": DEMO_EMAIL, "full_name": "Demo Product Manager",
        }).execute()
        for role in ("admin", "leadership", "reviewer"):
            _ensure_role(sb, user_id, role, apply=apply)
        sb.table("reviewer_profiles").upsert(
            {
                "reviewer_user_id": user_id,
                "expertise_domains": ["cross-domain", "product"],
                "weight": 1.0,
            },
            on_conflict="reviewer_user_id",
        ).execute()
    log.info("demo account: %s (%s)", DEMO_EMAIL, user_id)
    return user_id, password


def _ensure_reviewer_roster(sb, *, apply: bool) -> list[str]:
    """Ensure reviewer-demo-1..3@artpark.test exist with the reviewer role and
    a reviewer_profiles row. Returns the three user_ids (None entries when
    running dry and the account doesn't exist yet)."""
    ids: list[str] = []
    for i, email in enumerate(_ROSTER_REVIEWERS):
        user_id, _pw = _find_or_create_user(sb, email, apply=apply)
        ids.append(user_id)
        if user_id is None:
            log.info("[dry-run] would create/find %s", email)
            continue
        if apply:
            sb.table("profiles").upsert({
                "id": user_id, "email": email, "full_name": f"Demo Reviewer {i + 1}",
            }).execute()
            _ensure_role(sb, user_id, "reviewer", apply=apply)
            sb.table("reviewer_profiles").upsert(
                {
                    "reviewer_user_id": user_id,
                    "expertise_domains": _ROSTER_DOMAINS[i],
                    "weight": 1.0,
                },
                on_conflict="reviewer_user_id",
            ).execute()
        log.info("roster reviewer: %s (%s)", email, user_id)
    return ids


def _ensure_batches(sb, *, apply: bool) -> dict[str, str | None]:
    """Batch A / Batch B, matched on name. Returns {"A": id, "B": id}."""
    out: dict[str, str | None] = {}
    for label, name in (("A", "Batch A"), ("B", "Batch B")):
        rows = sb.table("batches").select("*").eq("name", name).execute().data or []
        if rows:
            out[label] = rows[0]["id"]
            continue
        if not apply:
            out[label] = None
            log.info("[dry-run] would create batch %s", name)
            continue
        created = sb.table("batches").insert({
            "name": name, "created_at": _now(), "updated_at": _now(),
        }).execute().data
        out[label] = created[0]["id"] if created else None
        log.info("created batch %s (%s)", name, out[label])
    return out


def _ensure_batch_reviewer(sb, batch_id: str, reviewer_user_id: str, added_by: str, *, apply: bool) -> None:
    if not apply or not batch_id or not reviewer_user_id:
        return
    sb.table("batch_reviewers").upsert(
        {"batch_id": batch_id, "reviewer_user_id": reviewer_user_id,
         "added_by": added_by, "added_at": _now()},
        on_conflict="batch_id,reviewer_user_id", ignore_duplicates=True,
    ).execute()


def _existing_assignment(sb, app_id: str, track: str, reviewer_user_id: str) -> dict | None:
    rows = (
        sb.table("reviewer_assignments").select("*")
        .eq("application_id", app_id).eq("application_track", track)
        .eq("reviewer_user_id", reviewer_user_id)
        .limit(1).execute().data
    ) or []
    return rows[0] if rows else None


def _ensure_assignment(
    sb, app_id: str, track: str, reviewer_user_id: str, assigned_by: str,
    state: str, *, apply: bool,
) -> str | None:
    """Idempotent create; returns the assignment id (existing or new)."""
    existing = _existing_assignment(sb, app_id, track, reviewer_user_id)
    if existing:
        return existing["id"]
    if not apply:
        return None
    row = {
        "application_id": app_id, "application_track": track,
        "reviewer_user_id": reviewer_user_id, "assigned_by": assigned_by,
        "assigned_at": _now(), "state": state, "due_at": None,
    }
    created = sb.table("reviewer_assignments").insert(row).execute().data
    return created[0]["id"] if created else None


def _existing_review(sb, app_id: str, track: str, reviewer_user_id: str) -> dict | None:
    rows = (
        sb.table("reviews").select("*")
        .eq("application_id", app_id).eq("application_track", track)
        .eq("reviewer_user_id", reviewer_user_id)
        .limit(1).execute().data
    ) or []
    return rows[0] if rows else None


def _ensure_review(
    sb, app_id: str, track: str, reviewer_user_id: str, assignment_id: str | None,
    review: dict, *, apply: bool,
) -> None:
    if _existing_review(sb, app_id, track, reviewer_user_id):
        return
    if not apply:
        return
    row = {
        **review,
        "application_id": app_id, "application_track": track,
        "reviewer_user_id": reviewer_user_id, "assignment_id": assignment_id,
    }
    sb.table("reviews").insert(row).execute()


def _existing_ai_screening(sb, app_id: str, track: str) -> dict | None:
    rows = (
        sb.table("ai_screening").select("*")
        .eq("application_id", app_id).eq("application_track", track)
        .limit(1).execute().data
    ) or []
    return rows[0] if rows else None


def _ensure_ai_screening(sb, app_id: str, track: str, *, apply: bool) -> None:
    """C2 (2026-08-24 review): the old version unconditionally upserted the
    canned row, which OVERWROTE real AI analysis — 67 of 69 non-draft TIR
    rows on staging already carry a real ai_screening row, and all 11 chosen
    TIR slots do. That silently destroyed genuine score_*/summary/model/
    ran_at data (irreversible on staging, and a direct violation of spec
    §5.3, which preserves AI scores and section text) and flattened every
    slot to an identical overall (7.7) with an identical summary.

    Fix: insert the full canned row ONLY when no ai_screening row exists yet.
    When one already exists, the ONLY thing ever missing on a real row is
    `sections` (all 67 existing rows checked have it null — the four-block
    AI-summary panel was added after those rows were scored) — patch exactly
    that column and touch nothing else.
    """
    if not apply:
        return
    existing = _existing_ai_screening(sb, app_id, track)
    if existing:
        if existing.get("sections"):
            return  # already has sections; nothing to add, nothing to touch
        sb.table("ai_screening").update({"sections": _SECTION_BULLETS}) \
            .eq("application_id", app_id).eq("application_track", track).execute()
        return

    row = {
        "application_id": app_id, "application_track": track,
        "score_problem": 7.6, "score_completeness": 7.4, "score_tech": 8.1,
        "score_founders": 7.3, "score_commitment": 7.8, "score_integrity": None,
        "score_overall": 7.7, "confidence": 0.82,
        "summary": (
            "A technically grounded early-stage venture with a credible pilot "
            "path; go-to-market is the main open question."
        ),
        "flags": [], "model": "google/gemini-2.5-flash", "ran_at": _now(),
        "error": None, "sections": _SECTION_BULLETS,
    }
    sb.table("ai_screening").insert(row).execute()


def _ensure_batch_slot(sb, app_id: str, track: str, batch_id: str | None, *, apply: bool) -> None:
    if not apply or not batch_id:
        return
    sb.table("application_batches").upsert(
        {"application_id": app_id, "application_track": track,
         "batch_id": batch_id, "added_at": _now()},
        on_conflict="application_id,application_track,batch_id", ignore_duplicates=True,
    ).execute()


_GATE1_GATES = {"on_hold": "on_hold", "jury_review": "jury_review"}
_GATE2_GATES = {
    "gate2_reject": "rejected",
    "gate2_offer": "offered",
}


def _existing_decision(sb, app_id: str, track: str, gate_stage: str, decision: str) -> dict | None:
    rows = (
        sb.table("admin_decisions").select("*")
        .eq("application_id", app_id).eq("application_track", track)
        .eq("gate_stage", gate_stage).eq("decision", decision)
        .limit(1).execute().data
    ) or []
    return rows[0] if rows else None


def _ensure_gate_decision(sb, app_id: str, track: str, gate: str | None, decided_by: str, *, apply: bool) -> None:
    if not gate:
        return
    if gate in _GATE1_GATES:
        gate_stage, decision = "gate1", _GATE1_GATES[gate]
    else:
        gate_stage, decision = "gate2", _GATE2_GATES[gate]
    if _existing_decision(sb, app_id, track, gate_stage, decision):
        return
    if not apply:
        return
    sb.table("admin_decisions").insert({
        "application_id": app_id, "application_track": track,
        "gate_stage": gate_stage, "decision": decision,
        "rationale": "Demo cohort seed." if decision != "offered" else None,
        "decided_by": decided_by, "decided_at": _now(),
    }).execute()


def _fetch_jurors(sb) -> list[str]:
    rows = sb.table("user_roles").select("user_id").eq("role", "jury").execute().data or []
    return sorted({r["user_id"] for r in rows})


def _ensure_jury(sb, app_id: str, track: str, juror_id: str, assigned_by: str, *, apply: bool) -> None:
    existing = (
        sb.table("jury_assignments").select("id")
        .eq("application_id", app_id).eq("application_track", track)
        .eq("juror_user_id", juror_id).limit(1).execute().data
    ) or []
    if not existing and apply:
        sb.table("jury_assignments").insert({
            "application_id": app_id, "application_track": track,
            "juror_user_id": juror_id, "assigned_by": assigned_by, "assigned_at": _now(),
        }).execute()

    if not apply:
        return
    sb.table("jury_selections").upsert(
        {
            "application_id": app_id, "application_track": track,
            "juror_user_id": juror_id, "note": "Strong candidate to mentor.",
            "submitted_at": _now(), "updated_at": _now(),
        },
        on_conflict="application_id,application_track,juror_user_id",
    ).execute()


def _existing_current_ic_doc(sb, app_id: str, track: str) -> dict | None:
    rows = (
        sb.table("ic_documents").select("*")
        .eq("application_id", app_id).eq("application_track", track)
        .is_("superseded_at", None)
        .limit(1).execute().data
    ) or []
    rows = [r for r in rows if r.get("superseded_at") is None]
    return rows[0] if rows else None


def _ensure_ic_document(sb, app_id: str, track: str, memo: str | None, uploaded_by: str, *, apply: bool) -> None:
    """I3 (2026-08-24 review): the old version returned early when a current
    ic_documents ROW already existed, before ever attempting the storage
    upload. That meant a first `--apply` that wrote the DB row but then hit
    a storage failure could never heal — the early-return skipped the retry
    on every subsequent run, leaving a permanent 404 download with no path
    to fix it. Chosen fix (of the two the review offered): attempt the
    upload unconditionally, every run, regardless of whether the DB row
    exists — `upsert: true` makes this safe and idempotent (a successful
    prior upload is just overwritten with the same bytes). The DB row
    insert is still skipped once it exists, since that part IS already
    idempotent and correct.
    """
    if not memo or not apply:
        return

    storage_path = f"demo/{app_id}.pdf"
    signed_storage_path = f"demo/{app_id}-signed.pdf"

    _upload_placeholder_pdf(sb, storage_path, [f"Application: {app_id}"])
    if memo == "signed":
        _upload_placeholder_pdf(sb, signed_storage_path, [
            f"Application: {app_id}",
            "SIGNED (demo) by Demo Product Manager",
        ])

    if _existing_current_ic_doc(sb, app_id, track):
        return

    now = _now()
    row = {
        "application_id": app_id, "application_track": track,
        "bucket": _IC_BUCKET, "storage_path": storage_path,
        "file_name": "IC-memo-demo.pdf", "uploaded_by": uploaded_by,
        "uploaded_at": now, "created_at": now, "updated_at": now,
    }
    if memo == "signed":
        row.update({
            "signed_storage_path": signed_storage_path,
            "signed_file_name": "IC-memo-demo-signed.pdf",
            "signed_by": uploaded_by, "signer_name": "Demo Product Manager",
            "signed_at": now,
        })
    sb.table("ic_documents").insert(row).execute()


def _ensure_moved(sb, app_id: str, moved_by: str, *, apply: bool) -> None:
    if not apply:
        return
    sb.table("tir_applications").update({
        "moved_to_track": "sip", "moved_at": _now(), "moved_by": moved_by,
    }).eq("id", app_id).execute()


def _write_status(sb, app_id: str, track: str, status: str, *, apply: bool) -> None:
    """Written directly, never via the state machine — the seed is
    ESTABLISHING a state, not transitioning through one."""
    if not apply:
        return
    sb.table(_table_for(track)).update({"status": status}).eq("id", app_id).execute()


# I7 (2026-08-24 review): a plausible predecessor status per target status,
# for the application_status_log row below. Without any row here, the
# leadership status-history panel and the admin Audit tab render empty for
# every one of the twelve applications. `rejected`/`offered` specifically
# come from `jury_review` because that IS the only legal predecessor for a
# gate-2 decision (`record_gate2_decision` 409s unless the app is currently
# `jury_review`) — the others follow the ordinary pipeline order.
_PLAUSIBLE_FROM_STATUS: dict[str, str | None] = {
    "submitted": None,
    "under_review": "submitted",
    "evaluated": "under_review",
    "on_hold": "evaluated",
    "jury_review": "evaluated",
    "rejected": "jury_review",
    "offered": "jury_review",
}


def _existing_status_log(sb, app_id: str, track: str, to_status: str) -> dict | None:
    rows = (
        sb.table("application_status_log").select("id")
        .eq("application_id", app_id).eq("application_track", track)
        .eq("to_status", to_status)
        .limit(1).execute().data
    ) or []
    return rows[0] if rows else None


def _log_status_transition(sb, app_id: str, track: str, to_status: str, changed_by: str, *, apply: bool) -> None:
    if not apply:
        return
    if _existing_status_log(sb, app_id, track, to_status):
        return
    sb.table("application_status_log").insert({
        "application_id": app_id, "application_track": track,
        "from_status": _PLAUSIBLE_FROM_STATUS.get(to_status),
        "to_status": to_status, "changed_by": changed_by,
        "reason": "Demo cohort seed.", "changed_at": _now(),
    }).execute()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    ap.add_argument("--reset-password", action="store_true",
                     help="mint a new demo@artpark.test password even if the account already exists")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    _guard(url)
    log.info("target: staging (%s) — mode: %s", STAGING_PROJECT_ID,
             "APPLY" if args.apply else "DRY RUN")

    from app.supabase_client import get_admin_client
    sb = get_admin_client()

    if not _verify_schema(sb):
        log.error("refusing to proceed — live schema does not match what this "
                  "script writes (see mismatches above)")
        return 1

    # 2. Demo account.
    demo_id, demo_password = _ensure_demo_account(
        sb, apply=args.apply, reset_password=args.reset_password,
    )

    # 3. Reviewer roster.
    roster_ids = _ensure_reviewer_roster(sb, apply=args.apply)

    # 4. Batches + membership.
    batches = _ensure_batches(sb, apply=args.apply)
    actor = demo_id or "00000000-0000-0000-0000-000000000000"
    for rid in roster_ids:
        if rid:
            _ensure_batch_reviewer(sb, batches.get("A"), rid, actor, apply=args.apply)
    if demo_id:
        _ensure_batch_reviewer(sb, batches.get("B"), demo_id, actor, apply=args.apply)

    # 5. Candidates.
    tir_plan = [p for p in DEMO_PLAN if p["track"] == "tir"]
    sip_plan = [p for p in DEMO_PLAN if p["track"] == "sip"]

    tir_candidates = _fetch_all_apps(sb, "tir")
    sip_candidates = _fetch_all_apps(sb, "sip")
    tir_candidates = _prefer_ai_screened(sb, "tir", tir_candidates, len(tir_plan))
    sip_candidates = _prefer_ai_screened(sb, "sip", sip_candidates, len(sip_plan))

    # NEW-1: resolve by pinned id first (see PINNED_APPLICATION_IDS) so a
    # second --apply targets the same twelve applications as the first.
    pairs = (
        select_demo_rows(tir_candidates, tir_plan, pinned=PINNED_APPLICATION_IDS)
        + select_demo_rows(sip_candidates, sip_plan, pinned=PINNED_APPLICATION_IDS)
    )
    pairs_by_slot = {plan["slot"]: (cand, plan) for cand, plan in pairs}

    seen_ids: set[str] = set()
    jurors = _fetch_jurors(sb)
    juror_id = jurors[0] if jurors else None
    if not juror_id:
        log.warning("no user_roles row with role=jury on staging — "
                     "jury_assignments/jury_selections will be skipped")

    log.info("── per-slot plan ──────────────────────────────────────────")
    for slot in sorted(pairs_by_slot):
        cand, plan = pairs_by_slot[slot]
        app_id, track = cand["id"], plan["track"]
        seen_ids.add(app_id)
        review_rows = reviews_for(plan["reviews"], slot)

        log.info(
            "slot %2d  track=%-3s  %-12s -> %-12s  reviews=%-11s gate=%-13s memo=%-6s moved=%s  app=%s",
            slot, track, cand.get("status"), plan["status"], plan["reviews"],
            plan["gate"] or "-", plan["memo"] or "-", plan["moved"], app_id,
        )

        # 6a. reviewer_assignments + reviews for the roster (round-robin).
        for i, rev in enumerate(review_rows):
            rid = roster_ids[i % len(roster_ids)] if roster_ids else None
            if not rid:
                continue
            aid = _ensure_assignment(sb, app_id, track, rid, actor, "completed", apply=args.apply)
            _ensure_review(sb, app_id, track, rid, aid, rev, apply=args.apply)

        # The reviewer-portal trap: the demo account holds the reviewer role,
        # so it needs its OWN reviewer_assignments or its Queue/History read
        # empty and the portal looks broken. Slots 2-5 give it: slot 2 a
        # completely fresh pending item (nothing reviewed yet -> Queue/eval
        # screen reachable), slots 3 and 5 a pending item on an app others
        # have already reviewed, and slot 4 an assignment the demo account
        # itself has SUBMITTED a review against (-> History populated).
        if demo_id and slot in (2, 3, 4, 5):
            demo_has_review = slot == 4
            demo_state = "completed" if demo_has_review else "pending"
            demo_aid = _ensure_assignment(sb, app_id, track, demo_id, actor, demo_state, apply=args.apply)
            if demo_has_review:
                _ensure_review(
                    sb, app_id, track, demo_id, demo_aid,
                    {**_jittered_scores(slot), "recommendation": "yes",
                     "strengths": "Strong technical grounding; credible route to a pilot.",
                     "concerns": "Go-to-market is thin and the team is small for the scope.",
                     "submitted_at": _SUBMITTED},
                    apply=args.apply,
                )

        # 6c. ai_screening.
        _ensure_ai_screening(sb, app_id, track, apply=args.apply)

        # 6d. application_batches. Every slot sits in Batch A (the roster
        # reviewers' batch — matches the reviewer_assignments just written
        # for the review set). Slots 2-5 ALSO sit in Batch B, since those are
        # exactly the ones carrying the demo account's own assignment — its
        # Batches tab and its Queue then agree with each other.
        _ensure_batch_slot(sb, app_id, track, batches.get("A"), apply=args.apply)
        if slot in (2, 3, 4, 5):
            _ensure_batch_slot(sb, app_id, track, batches.get("B"), apply=args.apply)

        # 6e. admin_decisions.
        _ensure_gate_decision(sb, app_id, track, plan["gate"], actor, apply=args.apply)

        # 6f. jury_assignments + jury_selections (slots 7-12).
        if slot >= 7 and juror_id:
            _ensure_jury(sb, app_id, track, juror_id, actor, apply=args.apply)

        # 6g. ic_documents.
        _ensure_ic_document(sb, app_id, track, plan["memo"], actor, apply=args.apply)

        # 6h. moved_to_track (slot 12 only; native track is always "tir" here).
        if plan["moved"]:
            _ensure_moved(sb, app_id, actor, apply=args.apply)

        # 6i. status LAST, written directly (not via the state machine).
        _write_status(sb, app_id, track, plan["status"], apply=args.apply)

        # 6j. application_status_log (I7) — without this, the leadership
        # status-history panel and the admin Audit tab render empty for
        # every one of the twelve applications.
        _log_status_transition(sb, app_id, track, plan["status"], actor, apply=args.apply)

    if len(seen_ids) != len(DEMO_PLAN):
        log.error("resolved %d distinct application ids for %d slots — "
                   "selection did not produce twelve distinct rows",
                   len(seen_ids), len(DEMO_PLAN))
        return 1
    log.info("resolved %d distinct application ids for %d slots", len(seen_ids), len(DEMO_PLAN))

    if args.apply:
        # M11 (2026-08-24 review), three fixes:
        #  1. `log.info` goes to stderr (logging's default StreamHandler);
        #     the global constraint is "printed to stdout ONLY" so the
        #     credentials block uses print() instead, not the logger.
        #  2. `.env.staging` has FRONTEND_ORIGIN (comma-separated, several
        #     preview URLs), never FRONTEND_URL/STAGING_FRONTEND_URL — those
        #     never existed, so the printed URL used to always be the
        #     placeholder. Read the real var and take the first entry.
        #  3. A re-run against an existing account used to print "password
        #     unchanged" with no way to get a working password if the first
        #     run's terminal output was lost. --reset-password (handled in
        #     _ensure_demo_account) mints a new one on request.
        origin = (os.environ.get("FRONTEND_ORIGIN") or "").split(",")[0].strip()
        staging_url = origin or "(FRONTEND_ORIGIN not set in .env.staging)"
        print("── demo login ─────────────────────────────────────────")
        print(f"email:    {DEMO_EMAIL}")
        if demo_password:
            print(f"password: {demo_password}")
        else:
            print("password: (account already existed — unchanged; "
                  "re-run with --reset-password to mint a new one)")
        print(f"staging:  {staging_url}")
    else:
        log.info("dry run only — re-run with --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
