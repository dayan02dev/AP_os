#!/usr/bin/env python3
"""Dev-only OTP bypass.

Uses the Supabase service-role key to generate a magic link for any email.
Supabase's generate_link response carries both a 6-digit `email_otp` (the same
code it would have sent via SMTP) and a one-click `action_link`.

Use this when:
  - SMTP is misconfigured and no OTPs are arriving in your inbox
  - You need to sign in quickly without touching a real email flow
  - You're demoing to a reviewer and don't want to wait for email delivery

Usage:
  cd backend && source .venv/bin/activate
  python scripts/dev_get_otp.py [email]

If `email` is omitted, defaults to `dev@artpark.in`. Reads SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY from backend/.env (never checks them into code).

SECURITY:
  - This script needs the service-role key, which bypasses RLS. NEVER run it
    in prod, NEVER share the output, NEVER commit a session captured via this.
  - Anyone who runs this can sign in as any user. Treat like an ssh key.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    # Make the local `app` package importable when we're run from backend/.
    here = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(here))

    try:
        from app.config import settings  # noqa: WPS433
        from app.supabase_client import get_admin_client  # noqa: WPS433
    except Exception as exc:
        print(f"✗ Could not load app config: {exc}")
        print("  Make sure you're in backend/ with the .venv active.")
        return 1

    email = (sys.argv[1] if len(sys.argv) > 1 else "dev@artpark.in").strip().lower()
    if "@" not in email:
        print(f"✗ '{email}' doesn't look like an email.")
        return 1

    if not settings.supabase_service_role_key:
        print("✗ SUPABASE_SERVICE_ROLE_KEY is not set in backend/.env")
        return 1

    print(f"→ Asking Supabase for a magic link for {email}…")
    admin = get_admin_client()

    try:
        # generate_link's 'magiclink' type returns both email_otp and action_link.
        # The email_otp is what Supabase would have sent via SMTP.
        res = admin.auth.admin.generate_link(
            {"type": "magiclink", "email": email}
        )
    except Exception as exc:
        print(f"✗ Supabase rejected the request: {exc}")
        print("  Common causes:")
        print("  - email not in auth.users yet — sign up first via /apply/signin")
        print("  - wrong service-role key in .env")
        return 1

    props = getattr(res, "properties", None) or getattr(res, "data", None)
    if props is None:
        print(f"✗ Unexpected response shape from Supabase: {res!r}")
        return 1

    otp = getattr(props, "email_otp", None) or props.get("email_otp")
    link = getattr(props, "action_link", None) or props.get("action_link")
    expires_iso = (
        getattr(props, "verification_type", None) or props.get("verification_type")
    )

    print()
    print("┌─────────────────────────────────────────────┐")
    print(f"│  OTP code: {otp or '(missing)':<33}│")
    print("└─────────────────────────────────────────────┘")
    if link:
        print()
        print("Or click this magic link to sign in directly:")
        print(f"  {link}")
    print()
    print(f"Type: {expires_iso}")
    print()
    print("Enter the 6-digit OTP on http://localhost:5173/apply/verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
