"""Send one of each ARTPARK email to a test inbox for visual QA.

Usage (from backend/, with RESEND_API_KEY + SES_FROM_EMAIL exported):
    python scripts/send_test_emails.py udayanpawar03@gmail.com

Calls each sender directly with representative sample data — no DB writes,
no real account creation (the invite mail uses a sample temp password)."""
from __future__ import annotations

import sys

from app.services.email_service import get_email_service, frontend_url

TO = sys.argv[1] if len(sys.argv) > 1 else "udayanpawar03@gmail.com"
INBOX = frontend_url("/reviewer")


def main() -> None:
    svc = get_email_service()
    print(f"Sending all sample emails to {TO} …")

    svc.send_applicant_decision(to=TO, applicant_name="Asha R", outcome="advanced",
                                application_ref="abc12345", program_label="VIP")
    print("  ✓ applicant decision — advanced")

    svc.send_applicant_decision(to=TO, applicant_name="Asha R", outcome="rejected",
                                application_ref="abc12345", program_label="TIR")
    print("  ✓ applicant decision — rejected")

    svc.send_reviewer_invite(to=TO, reviewer_name="Vikram Sundar", login_email=TO,
                             temp_password="Pass-F5FY3U", inbox_url=INBOX)
    print("  ✓ reviewer invite (credentials)")

    svc.send_reviewer_assigned(to=TO, reviewer_name="Udita",
                               apps=[{}] * 6, inbox_url=INBOX)
    print("  ✓ reviewer assigned (count = 6)")

    svc.send_reviewer_reminder(to=TO, reviewer_name="Udita", pending_count=2,
                               completed_count=4, inbox_url=INBOX)
    print("  ✓ reviewer daily reminder")

    svc.send_daily_digest(
        to=[TO], date_label="29 Jun 2026",
        reviewers=[
            {"name": "Udita Uniyal", "assigned": 6, "completed": 4, "pending": 2},
            {"name": "Nirav Dedhia", "assigned": 4, "completed": 4, "pending": 0},
            {"name": "Abhijit Lele", "assigned": 0, "completed": 0, "pending": 0},
        ],
        total_pending=2, total_assigned=10,
    )
    print("  ✓ admin daily digest")
    print("Done.")


if __name__ == "__main__":
    main()
