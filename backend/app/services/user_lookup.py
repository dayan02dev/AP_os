"""Best-effort identity lookups for email features. Never raises."""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def get_contact(sb, user_id: str) -> dict | None:
    """{'email','name'} for a user id, from profiles (fallback auth.users). None if unknown."""
    try:
        rows = (
            sb.table("profiles").select("id, email, full_name")
            .eq("id", user_id).limit(1).execute().data
        ) or []
        if rows and rows[0].get("email"):
            return {"email": rows[0]["email"], "name": rows[0].get("full_name") or rows[0]["email"]}
    except Exception:  # noqa: BLE001
        log.warning("get_contact: profiles lookup failed for %s", user_id, exc_info=True)
    try:
        res = sb.auth.admin.get_user(user_id)
        u = getattr(res, "user", None) or res
        email = getattr(u, "email", None)
        if email:
            return {"email": email, "name": email}
    except Exception:  # noqa: BLE001
        log.warning("get_contact: auth lookup failed for %s", user_id, exc_info=True)
    return None


def get_admin_emails(sb) -> list[str]:
    """Distinct emails of all users holding the `admin` role. Empty list on error."""
    try:
        rows = sb.table("user_roles").select("user_id").eq("role", "admin").execute().data or []
        ids = list({r["user_id"] for r in rows if r.get("user_id")})
        if not ids:
            return []
        profs = sb.table("profiles").select("id, email").in_("id", ids).execute().data or []
        emails = [p["email"] for p in profs if p.get("email")]
        seen, out = set(), []
        for e in emails:
            if e not in seen:
                seen.add(e); out.append(e)
        return out
    except Exception:  # noqa: BLE001
        log.warning("get_admin_emails failed", exc_info=True)
        return []
