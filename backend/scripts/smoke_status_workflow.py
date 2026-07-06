# backend/scripts/smoke_status_workflow.py
"""Live end-to-end status-workflow smoke test — STAGING ONLY.

Drives the REAL assignment-driven status workflow (see
docs/superpowers/plans/2026-07-06-status-workflow-assignment-driven.md)
against a live, deployed backend using a single real account —
`udayanpawar03@gmail.com` — acting as BOTH the applicant, the admin who
assigns/decides, and the reviewer who scores. That account must already
hold both `admin` and `reviewer` roles (`user_roles` rows) on the target
Supabase project before this script is run.

For EACH track ("tir", "sip") this creates one throwaway draft application
and walks it through:

    (submit)  draft        -> submitted
    (assign)  submitted    -> under_review   (reviewer assignment is the trigger)
    (review)  under_review -> evaluated      (first submitted review is the trigger)
    (decide)  evaluated    -> jury_review    (admin approve)

Each observed hop is printed. The script fails loudly (non-zero exit, HTTP
body included) on any non-2xx response or any status that doesn't match
what the state machine promises at that step.

THIS SCRIPT NEVER RUNS IN CI. It is a manual rollout tool: run it by hand,
once, right after deploying this change to staging, pointed at the staging
API only.

    !!! NEVER point this at production !!!

    Production API base is `https://api.artpark.info` (or any host without
    "staging" in it). The script refuses to run if STAGING_API_BASE looks
    like a production host — see `_assert_not_prod()` below. That check is
    a safety net, not a substitute for pointing this at the right place.

Env vars (both required):
    STAGING_API_BASE   e.g. https://<staging-host>/  (no trailing slash needed)
    STAGING_TOKEN       a Supabase access-token (JWT) for udayanpawar03@gmail.com
                         on the STAGING Supabase project, already carrying
                         both the `admin` and `reviewer` roles.

Usage:
    STAGING_API_BASE=https://... STAGING_TOKEN=eyJ... python scripts/smoke_status_workflow.py

Notes:
  * There is no applicant-facing "withdraw"/delete endpoint, so the two
    throwaway applications this script creates are left behind on staging
    in `jury_review` status (harmless staging fixture data; clean up via
    Supabase Studio SQL if desired).
  * Re-running this script against a staging account that already has a
    non-draft application in a given track will fail loudly at the submit
    step (409 `not_draft`) rather than silently reusing the old app —
    that's intentional; use a fresh draft or clean up staging data first.
  * Exact endpoint routes/bodies mirror the hermetic lifecycle driver in
    backend/tests/test_status_lifecycle_e2e.py — keep the two in sync if
    the API shape changes.
"""
from __future__ import annotations

import os
import sys

import httpx

TRACKS = ("tir", "sip")

SUBMIT_PATH = {
    "tir": "/applications/me/submit",
    "sip": "/sip-applications/me/submit",
}

# Any of these substrings appearing in STAGING_API_BASE aborts the run.
_PROD_HOST_MARKERS = ("api.artpark.info",)


def _env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        sys.exit(
            f"Missing required env var {name}. "
            f"Set STAGING_API_BASE + STAGING_TOKEN before running this script."
        )
    return val


BASE = _env("STAGING_API_BASE").rstrip("/")
TOKEN = _env("STAGING_TOKEN")
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def _assert_not_prod(base: str) -> None:
    lowered = base.lower()
    if "staging" not in lowered:
        print(
            f"WARNING: STAGING_API_BASE ({base!r}) does not contain "
            f"'staging' — double-check this is not production.",
            file=sys.stderr,
        )
    for marker in _PROD_HOST_MARKERS:
        if marker in lowered:
            sys.exit(
                f"REFUSING TO RUN: STAGING_API_BASE ({base!r}) looks like "
                f"production (matched {marker!r}). This script must only "
                f"ever target staging."
            )


def _check(resp: httpx.Response, label: str, want: tuple[int, ...] = (200, 201)) -> dict:
    """Fail loudly (HTTP body included) on any unexpected status code."""
    if resp.status_code not in want:
        sys.exit(
            f"FAILED at {label}: HTTP {resp.status_code}\n"
            f"  URL: {resp.request.method} {resp.request.url}\n"
            f"  Body: {resp.text}"
        )
    print(f"  [ok] {label}: HTTP {resp.status_code}")
    try:
        return resp.json()
    except ValueError:
        return {}


def _get_detail(client: httpx.Client, track: str, application_id: str) -> dict:
    """Admin detail read — the single source of truth for observed status."""
    r = client.get(f"/admin/platform/applications/{track}/{application_id}")
    payload = _check(r, f"[{track}] get admin detail", want=(200,))
    return payload


def _assert_status(payload: dict, expected: str, track: str, hop: str) -> None:
    actual = (payload.get("application") or {}).get("status")
    if actual != expected:
        sys.exit(
            f"FAILED at [{track}] {hop}: expected status {expected!r}, "
            f"observed {actual!r}. Full admin detail payload: {payload}"
        )
    print(f"  [{track}] {hop}: status == {actual!r}")


def run_track(client: httpx.Client, track: str) -> None:
    print(f"\n=== {track.upper()} ===")

    # 1) submit — draft (auto-created by any GET .../me, or already exists)
    #    -> submitted. The current backend does not hard-block submission
    #    on missing optional fields (see _MANDATORY_FIELDS in the routers),
    #    so a bare submit of a freshly auto-created draft is sufficient to
    #    reach 'submitted'.
    r = client.post(SUBMIT_PATH[track])
    submit_result = _check(r, f"[{track}] submit", want=(200, 201))
    application_id = submit_result.get("application_id")
    if not application_id:
        sys.exit(
            f"FAILED at [{track}] submit: no application_id in response body: {submit_result}"
        )
    print(f"  [{track}] submit: application_id = {application_id}")

    detail = _get_detail(client, track, application_id)
    _assert_status(detail, "submitted", track, "after submit")
    reviewer_user_id = (detail.get("application") or {}).get("user_id")
    if not reviewer_user_id:
        sys.exit(f"FAILED at [{track}] submit: admin detail missing application.user_id: {detail}")

    # 2) assign self as reviewer -> under_review (assignment is THE trigger).
    r = client.post(
        f"/leadership/applications/{application_id}/reviewers",
        json={"reviewer_user_ids": [reviewer_user_id], "due_at": None},
    )
    assign_result = _check(r, f"[{track}] assign self as reviewer", want=(200,))
    results = assign_result.get("results") or []
    own_result = next((res for res in results if res.get("reviewer_user_id") == reviewer_user_id), None)
    if own_result is None or own_result.get("status") != "created":
        sys.exit(
            f"FAILED at [{track}] assign: expected status 'created' for "
            f"{reviewer_user_id}, got {own_result!r}. Full response: {assign_result}. "
            f"(If this says 'not_a_reviewer', udayanpawar03@gmail.com is missing "
            f"the 'reviewer' role on this Supabase project.)"
        )

    detail = _get_detail(client, track, application_id)
    _assert_status(detail, "under_review", track, "after assign")

    # 3) find the assignment_id the reviewer API needs for POST /reviewer/reviews.
    r = client.get("/reviewer/assignments")
    inbox = _check(r, f"[{track}] fetch reviewer inbox", want=(200,))
    assignment = next(
        (a for a in (inbox.get("assignments") or [])
         if a.get("application_id") == application_id and a.get("application_track") == track),
        None,
    )
    if assignment is None:
        sys.exit(
            f"FAILED at [{track}] fetch reviewer inbox: no assignment found for "
            f"application_id={application_id}. Inbox: {inbox}"
        )
    assignment_id = assignment["assignment_id"]
    print(f"  [{track}] assignment_id = {assignment_id}")

    # 4) submit a (non-draft) review -> evaluated (first submitted review is the trigger).
    review_body = {
        "application_id": application_id,
        "application_track": track,
        "assignment_id": assignment_id,
        "score_problem": 7.0,
        "score_solution": 7.0,
        "score_tech": 7.0,
        "score_founders": 7.0,
        "score_commitment": 7.0,
        "recommendation": "yes",
        "quick_notes": "staging smoke test — solid application",
        "draft": False,
    }
    r = client.post("/reviewer/reviews", json=review_body)
    _check(r, f"[{track}] submit review", want=(200, 201))

    detail = _get_detail(client, track, application_id)
    _assert_status(detail, "evaluated", track, "after review")

    # 5) admin approve -> jury_review.
    r = client.post(
        f"/admin/platform/applications/{track}/{application_id}/decision",
        json={"decision": "jury_review", "rationale": "staging smoke test — approve"},
    )
    _check(r, f"[{track}] admin decision (approve)", want=(200,))

    detail = _get_detail(client, track, application_id)
    _assert_status(detail, "jury_review", track, "after admin approve")

    print(f"=== {track.upper()} OK: submitted -> under_review -> evaluated -> jury_review ===")


def main() -> None:
    _assert_not_prod(BASE)
    print(f"Target: {BASE}")
    with httpx.Client(base_url=BASE, headers=HEADERS, timeout=30.0) as client:
        for track in TRACKS:
            run_track(client, track)
    print("\nAll tracks passed: submitted -> under_review -> evaluated -> jury_review.")


if __name__ == "__main__":
    main()
