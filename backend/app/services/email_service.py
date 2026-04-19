"""AWS SES wrapper — filled in Phase 6.

Will expose `send_email(to, subject, body_html, body_text)` backed by boto3's
SES client (region from settings.aws_region, from-address from
settings.ses_from_email). Support tickets and application-status emails go
through here.
"""

# Phase 6 implementation goes here.
