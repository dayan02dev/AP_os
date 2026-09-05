"""Role-based access control — Phase 1.

Kept intentionally simple: a static role → capability map plus a FastAPI
dependency that asserts the caller's roles include a given capability.

If rules grow conditional/temporal (e.g. "reviewer can score X only if
assigned AND in their sector AND not already scored 3 times"), migrate
to Casbin or Cerbos. The `require_capability()` dep is the only API
surface to swap — handlers don't change.

Keep `ROLE_CAPABILITIES` in sync with `frontend/src/lib/rbac.js`.
"""

from __future__ import annotations

from typing import Set

from fastapi import Depends, HTTPException, status

from .deps import get_current_user


ROLE_CAPABILITIES: dict[str, Set[str]] = {
    "applicant": {
        "manage_own_draft",
        "submit_app",
        "view_own_status",
    },
    "founder": {
        "view_own_milestones",
        "upload_milestone_evidence",
    },
    "reviewer": {
        "view_assigned_apps",
        "score_app",
        "comment_app",
        "decline_assignment",
    },
    "jury": {
        "view_assigned_jury_apps",
        "submit_jury_picks",
    },
    "mentor": {
        "view_assigned_founders",
        "comment_founder",
    },
    # External commercial party -- a supplier, not ARTPARK staff. Scoped to
    # its OWN vendor row and its OWN products and nothing else: no
    # applications, no founders, no other vendors. Every vendor-scoped call
    # takes vendorId as its first argument and never reads it from a payload.
    "vendor": {
        "manage_own_vendor_profile",
        "manage_own_products",
    },
    "leadership": {
        "view_all_apps",
        "view_app_detail",
        "assign_reviewers",
        "assign_jurors",
        "change_app_status",
        "view_stats",
        "export_data",
        "view_audit_log",
        "decide_application",
        "manage_ic_documents",
    },
    "admin": {
        "manage_users",
        "grant_role",
        "revoke_role",
        "reset_password",
        "view_all_apps",
        "view_app_detail",
        "assign_reviewers",
        "assign_jurors",
        "manage_jury_roster",
        "change_app_status",
        "view_audit_log",
        "manage_support",
        "decide_application",
        "manage_batches",
        "manage_reviewers_roster",
        "view_stats",
        "manage_ic_documents",
    },
}


def capabilities_for(roles: list[str]) -> set[str]:
    """Union of capabilities across a user's roles."""
    out: set[str] = set()
    for r in roles:
        out |= ROLE_CAPABILITIES.get(r, set())
    return out


def has_capability(roles: list[str], cap: str) -> bool:
    return cap in capabilities_for(roles)


def require_capability(cap: str):
    """Build a FastAPI dependency that 403s if the current user lacks `cap`.

    Reads roles from the dict returned by `get_current_user` (extended in
    Task 3 to include a `roles` list).
    """

    async def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        roles = current_user.get("roles", []) or []
        if not has_capability(roles, cap):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "missing_capability",
                    "required": cap,
                    "your_roles": roles,
                },
            )
        return current_user

    return _dep
