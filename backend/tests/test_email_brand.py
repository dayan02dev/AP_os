"""The shared email shell renders the ARTPARK brand, and existing templates
still render through it (backward-compatible base rewrite)."""
import os

# Stub required settings so this test runs without a .env file (same pattern
# as conftest.py's SENTRY_DSN stub).
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test_anon_key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test_service_role_key")

from app.services import email_service as es


def _render_html(template_base, ctx):
    es.get_email_service.cache_clear()
    svc = es.EmailService()
    return svc._render_pair(template_base, ctx)[0]


def test_base_shell_is_artpark_branded_via_existing_template():
    # reviewer_assigned extends base.html and is otherwise unchanged.
    html = _render_html("reviewer_assigned", {
        "reviewer_name": "Asha", "count": 1,
        "apps": [{"applicant_name": "Test User", "track_label": "TIR",
                  "application_id_short": "abc12345"}],
        "inbox_url": "https://apply.artpark.info/reviewer",
    })
    assert "#3213b7" in html          # purple brand accent
    assert "ARTPARK" in html          # wordmark
    assert "artpark.in" in html       # footer
    assert "#f4f1ea" not in html      # old beige shell is gone


def test_reviewer_assigned_is_count_only():
    html = _render_html("reviewer_assigned", {
        "reviewer_name": "Udita", "count": 6,
        "apps": [{"applicant_name": "X", "application_id_short": "deadbeef", "track_label": "TIR"}],
        "inbox_url": "https://apply.artpark.info/reviewer",
    })
    assert "6 application" in html                 # the count
    assert "Open reviewer inbox" in html           # CTA
    assert "reassign" not in html.lower()          # removed line
    assert "deadbeef" not in html                  # no per-app ID list


import re

def _html_text(h):
    return re.sub(r"<[^>]+>", "", h)

def test_applicant_advanced_has_program_label_and_brand():
    html = _render_html("applicant_decision_advanced", {
        "applicant_name": "Asha", "application_ref": "abc12345", "program_label": "VIP",
    })
    assert "advanced" in html.lower()
    assert "VIP" in html
    assert "#3213b7" in html

def test_applicant_rejected_is_gracious():
    html = _render_html("applicant_decision_rejected", {
        "applicant_name": "Asha", "application_ref": "abc12345", "program_label": "TIR",
    })
    assert "!" not in _html_text(html)   # brand rule: no exclamation marks in copy


def test_reviewer_invite_carries_credentials():
    html = _render_html("reviewer_invite", {
        "reviewer_name": "Vikram", "login_email": "vikram@x.in",
        "temp_password": "Pass-F5FY3U", "inbox_url": "https://apply.artpark.info/reviewer",
    })
    assert "vikram@x.in" in html
    assert "Pass-F5FY3U" in html
    assert "Open reviewer inbox" in html
    assert "#3213b7" in html


def test_reviewer_reminder_shows_pending_and_completed():
    html = _render_html("reviewer_reminder", {
        "reviewer_name": "Udita", "pending_count": 2, "completed_count": 4,
        "inbox_url": "https://apply.artpark.info/reviewer",
    })
    assert "2 application" in html        # pending
    assert "4" in html                    # completed
    assert "Open reviewer inbox" in html
    assert "#3213b7" in html


def test_daily_digest_lists_all_reviewers():
    html = _render_html("daily_digest", {
        "date_label": "29 Jun 2026",
        "reviewers": [
            {"name": "Udita", "assigned": 6, "completed": 4, "pending": 2},
            {"name": "Nirav", "assigned": 0, "completed": 0, "pending": 0},
        ],
        "total_pending": 2, "total_assigned": 6,
    })
    assert "Udita" in html and "Nirav" in html
    assert "#3213b7" in html


def test_header_has_logo_and_colour_locked_band():
    """New shell header: ARTPARK+IISc logo image on white + colour-locked band."""
    html = _render_html("reviewer_invite", {
        "reviewer_name": "Vikram", "login_email": "vikram@x.in",
        "temp_password": "Pass-F5FY3U", "inbox_url": "https://apply.artpark.info/reviewer",
    })
    assert "<img" in html                                      # logo is an image now
    assert "email-assets/artpark-iisc-logo.png" in html        # the hosted logo asset
    assert 'bgcolor="#3213b7"' in html                         # bulletproof band bg (mobile dark-mode lock)
    assert 'name="color-scheme"' in html                       # color-scheme meta present
    assert 'content="light only"' in html                      # locked to light
    assert "Reviewer invitation" in html                       # context label via header_sublabel
