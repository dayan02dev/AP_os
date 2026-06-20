"""Shared guard + side-effects for editing a *submitted* application in-window.

Used by the text-edit endpoints and the file routers so the owner/status/
window rule and the 'edited_after_submit' stamp live in exactly one place.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import sqs_publisher
from .edit_window import is_edit_open
from ..supabase_client import get_admin_client

_EDITABLE_STATUSES = {"submitted", "under_review"}
_TRACK_FOR_TABLE = {"tir_applications": "tir", "sip_applications": "sip"}


class EditWindowError(Exception):
    """Raised when a submitted-app edit is not permitted. Carries an HTTP shape."""
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def load_editable_app(table: str, application_id: str, user_id: str, select: str) -> dict[str, Any]:
    """Fetch a submitted row by id and enforce owner + status + window.

    Raises EditWindowError(404 / 409 / 403). `select` must include
    id, user_id, status and whatever columns the caller needs.
    """
    track = _TRACK_FOR_TABLE[table]
    res = (
        get_admin_client()
        .table(table)
        .select(select)
        .eq("id", application_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    row = rows[0] if rows else None
    if row is None or row.get("user_id") != user_id:
        raise EditWindowError(404, "not_found", "Application not found.")
    if row.get("status") not in _EDITABLE_STATUSES:
        raise EditWindowError(409, "not_editable", f"Application is {row.get('status')} and cannot be edited.")
    if not is_edit_open(track):
        raise EditWindowError(403, "edit_window_closed", "The edit window for this track has closed.")
    return row


def mark_edited(table: str, application_id: str, track: str) -> None:
    """Stamp edited_after_submit + last_edited_at and re-queue AI screening."""
    (
        get_admin_client()
        .table(table)
        .update({
            "edited_after_submit": True,
            "last_edited_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", application_id)
        .execute()
    )
    sqs_publisher.publish(application_id, track)
