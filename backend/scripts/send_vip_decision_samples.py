"""Send the three VIP applicant decision mails to one inbox for visual QA.

    python scripts/send_vip_decision_samples.py --to you@example.com --dry-run
    python scripts/send_vip_decision_samples.py --to you@example.com

Renders the real templates through the real EmailService (Resend) with the
arguments the decision hooks pass for a VIP (sip) application: the gate-1
rejection, the gate-1 "advanced" update and the selection mail. Sample data
only (applicant "Udayan Pawar", venture "Sample Venture"); nothing is read
from or written to the database.

app.config needs the Supabase settings even though they are never used, and a
real send needs RESEND_API_KEY + SES_FROM_EMAIL. Run from backend/ with its
.env, or point --env-file at one (e.g. the main checkout's backend/.env when
running from a worktree). --dry-run sends nothing and prints each subject and
text body instead.
"""
from __future__ import annotations

import argparse
import os
import sys

# Make `app` importable when run as `python scripts/...` from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

APPLICANT = "Udayan Pawar"
VENTURE = "Sample Venture"
APPLICATION_REF = "sample00"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--to", required=True, help="the single address that receives all three mails")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the subjects and text bodies; send nothing")
    parser.add_argument("--env-file", help="load settings from this .env before importing the app")
    args = parser.parse_args()

    if args.env_file:
        from dotenv import load_dotenv

        if not load_dotenv(args.env_file):
            parser.error(f"--env-file {args.env_file!r} could not be read")

    from app.services.decision_email import program_label
    from app.services.email_service import EmailService

    class DryRunEmailService(EmailService):
        """Prints what would be sent instead of calling Resend."""

        def send_raw(self, to, subject, html, text, reply_to=None):
            print(f"To:      {', '.join(to)}\nSubject: {subject}\n\n{text.rstrip()}\n{'-' * 72}")
            return {"message_id": "dry-run", "status": "dry-run"}

    svc = DryRunEmailService() if args.dry_run else EmailService()
    label = program_label("sip")
    mails = [
        ("VIP gate-1 rejection", lambda: svc.send_applicant_decision(
            to=args.to, applicant_name=APPLICANT, outcome="rejected",
            application_ref=APPLICATION_REF, program_label=label)),
        ("VIP gate-1 advanced", lambda: svc.send_applicant_decision(
            to=args.to, applicant_name=APPLICANT, outcome="advanced",
            application_ref=APPLICATION_REF, program_label=label)),
        ("VIP gate-2 selection", lambda: svc.send_applicant_selected(
            to=args.to, applicant_name=APPLICANT, track="sip", venture=VENTURE)),
    ]
    for title, send in mails:
        result = send()
        print(f"{title}: {result['status']} ({result['message_id']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
