"""Best-effort writer for audit_log_v2.

Phase 1 has no UI surface for the audit log (deferred to Phase 2), but
every privileged state change must be captured so we have history when
the UI lands. Failures here MUST NOT propagate — audit-infra problems
should never break the primary action.
"""
from __future__ import annotations

import logging
from typing import Any

from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)


def write_audit(
    *,
    actor_user_id: str | None,
    actor_role: str | None,
    action_type: str,
    target_table: str | None = None,
    target_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
) -> None:
    """Append-only insert into audit_log_v2. Never raises."""
    try:
        get_admin_client().table("audit_log_v2").insert({
            "actor_user_id": actor_user_id,
            "actor_role": actor_role,
            "action_type": action_type,
            "target_table": target_table,
            "target_id": target_id,
            "before_state": before,
            "after_state": after,
            "reason": reason,
        }).execute()
    except Exception:
        log.warning(
            "write_audit failed (swallowed)",
            extra={"action_type": action_type, "target_id": target_id},
            exc_info=True,
        )
