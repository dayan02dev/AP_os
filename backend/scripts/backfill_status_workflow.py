# backend/scripts/backfill_status_workflow.py
"""Re-map existing application statuses to the assignment-driven workflow.

Rules (matches state_machine after the 2026-07-06 change):
  * decided/terminal statuses are kept as-is
  * else: >=1 submitted review -> evaluated
  * else: >=1 active assignment -> under_review
  * else: submitted
Run with --dry-run (default) to report; --apply to write (backup first)."""
from __future__ import annotations

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
