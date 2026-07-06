# backend/scripts/backfill_status_workflow.py
"""Re-map existing application statuses to the assignment-driven workflow.

Rules (matches state_machine after the 2026-07-06 change):
  * decided/terminal statuses are kept as-is
  * else: >=1 submitted review -> evaluated
  * else: >=1 active assignment -> under_review
  * else: submitted
Run with --dry-run (default) to report; --apply to write (backup first).

NOTE: `apply_status_change` (state_machine.py) asserts legal transitions, and
`under_review -> submitted` / `evaluated -> under_review`/`submitted` are
rewinds that are NOT in LEGAL_TRANSITIONS. The backfill therefore bypasses
that guard: `run()` writes directly to the applications table and inserts
its own `application_status_log` row, so legitimate down-mappings (e.g.
under_review -> submitted) don't 422."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

TERMINAL = frozenset({
    "draft", "withdrawn", "rejected", "jury_review", "on_hold",
    "waitlisted", "shortlisted", "offered", "onboarded", "interview",
})


def remap_status(current: str, *, has_review: bool, has_active_assignment: bool) -> str:
    if current in TERMINAL:
        return current
    if has_review:
        return "evaluated"
    if has_active_assignment:
        return "under_review"
    return "submitted"


def compute_changes(apps_by_track, review_keys, active_assignment_keys):
    """apps_by_track: {track: [{id, status}]}. review_keys / active_assignment_keys:
    sets of (app_id, track). Returns [{track, id, frm, to}] for rows that change."""
    out = []
    for track, apps in apps_by_track.items():
        for a in apps:
            aid, cur = a["id"], a.get("status")
            new = remap_status(
                cur,
                has_review=(aid, track) in review_keys,
                has_active_assignment=(aid, track) in active_assignment_keys,
            )
            if new != cur:
                out.append({"track": track, "id": aid, "frm": cur, "to": new})
    return out


def _load(sb):
    apps_by_track, review_keys, active = {}, set(), set()
    for track in ("tir", "sip"):
        apps_by_track[track] = (
            sb.table(f"{track}_applications").select("id,status").execute().data or []
        )
    for r in (sb.table("reviews").select("application_id,application_track,status,submitted_at").execute().data or []):
        if r.get("status") == "submitted" or r.get("submitted_at"):
            review_keys.add((r["application_id"], r["application_track"]))
    for a in (sb.table("reviewer_assignments").select("application_id,application_track,declined_at,reassigned_to").execute().data or []):
        if a.get("declined_at") is None and a.get("reassigned_to") is None:
            active.add((a["application_id"], a["application_track"]))
    return apps_by_track, review_keys, active


def run(apply: bool):
    from app.supabase_client import get_admin_client
    sb = get_admin_client()
    apps_by_track, review_keys, active = _load(sb)
    changes = compute_changes(apps_by_track, review_keys, active)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = f"status_backfill_backup_{ts}.json"
    print(f"{len(changes)} status changes computed. Backup -> {backup_path}")
    for c in changes:
        print(f"  [{c['track']}] {c['id']}: {c['frm']} -> {c['to']}")
    if not apply:
        print("DRY RUN — no writes. Re-run with --apply to write.")
        return
    # Backup every app's current (id, track, status) BEFORE writing.
    backup = [{"track": t, "id": a["id"], "status": a.get("status")}
              for t, apps in apps_by_track.items() for a in apps]
    with open(backup_path, "w") as f:
        json.dump(backup, f)
    # Direct write + explicit log insert (NOT apply_status_change): some of
    # these are legitimate down-mappings (e.g. under_review -> submitted)
    # that apply_status_change's LEGAL_TRANSITIONS guard would reject.
    for c in changes:
        table = "tir_applications" if c["track"] == "tir" else "sip_applications"
        sb.table(table).update({"status": c["to"]}).eq("id", c["id"]).execute()
        sb.table("application_status_log").insert({
            "application_id": c["id"], "application_track": c["track"],
            "from_status": c["frm"], "to_status": c["to"], "changed_by": None,
            "reason": "status workflow backfill 2026-07-06",
        }).execute()
    print(f"APPLIED {len(changes)} changes.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    run(apply=p.parse_args().apply)
