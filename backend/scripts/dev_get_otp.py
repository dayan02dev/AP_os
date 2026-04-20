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

    frontend_origin = os.environ.get("DEV_FRONTEND_ORIGIN", "http://localhost:5173")

    try:
        # generate_link's 'magiclink' type returns both email_otp and action_link.
        # The email_otp is what Supabase would have sent via SMTP.
        #
        # Pass redirect_to so Supabase's fallback magic-link URL points at the
        # right port (Supabase defaults to whatever Site URL is set to, which
        # is often :3000 out of the box). This isn't the recommended signin
        # path — the one-click URL below is — but it's a useful fallback.
        res = admin.auth.admin.generate_link(
            {
                "type": "magiclink",
                "email": email,
                "options": {"redirect_to": f"{frontend_origin}/apply"},
            }
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

    # The actual one-click URL: a direct link into our frontend's /apply/verify
    # page with both email and code pre-filled. VerifyPage auto-submits on the
    # 6th digit so this is a single-click signin — no typing, no Supabase
    # redirect dance.
    from urllib.parse import quote

    frontend_verify_url = (
        f"{frontend_origin}/apply/verify"
        f"?email={quote(email)}&code={otp or ''}"
    )

    print()
    print("┌─────────────────────────────────────────────┐")
    print(f"│  OTP code: {otp or '(missing)':<33}│")
    print("└─────────────────────────────────────────────┘")
    print()
    print("★ ONE-CLICK SIGN IN (recommended) — paste into your browser:")
    print()
    print(f"  {frontend_verify_url}")
    print()
    print("  Loads /apply/verify with email + code pre-filled; auto-submits;")
    print("  lands you straight in the wizard.")
    print()
    if link:
        print("Alternative — Supabase magic link (falls back to localhost:5173/apply):")
        print(f"  {link}")
        print()
    print(f"Or manually enter the OTP at {frontend_origin}/apply/verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
