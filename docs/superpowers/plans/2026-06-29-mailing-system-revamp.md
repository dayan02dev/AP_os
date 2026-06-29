# ARTPARK Mailing-System Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all transactional email onto one on-brand ARTPARK shell and complete five mail flows (two new): applicant decision, reviewer invite (credentials), reviewer assigned, reviewer daily reminder, admin daily update.

**Architecture:** A backward-compatible rewrite of the shared Jinja `base.html` (purple-band ARTPARK shell) that every template extends; restyled/new content templates; new + adjusted senders in `email_service.py`; the reviewer-invite credentials path wired into `admin_users.create_user`; a new EventBridge-scheduled `reviewer_reminder` Lambda; the admin digest rebuilt on `admin_query.fetch_roster`. A standalone script sends all five to a test inbox for visual QA.

**Tech Stack:** FastAPI + Supabase, Jinja2 email templates, Resend HTTP API, AWS SAM (EventBridge schedules), pytest.

**Spec:** `docs/superpowers/specs/2026-06-29-mailing-system-revamp-design.md`

---

## Worktree

Already created: `.claude/worktrees/feat-mailing-revamp` (branch `feat/mailing-revamp`, off `release/sip-launch-v1` @ `88999d1`). The spec + this plan are committed there. All paths below are relative to that worktree root. **Commit messages must NOT include any Claude/AI co-author line.**

Backend tests run from `backend/`: `python -m pytest <path> -v --no-cov` (coverage gate → use `--no-cov` for single-file runs; ~19 pre-existing unrelated failures elsewhere — ignore those).

## Brand snippets (reuse verbatim in templates)

These inline styles encode the ARTPARK brand (`#3213b7` purple, Trebuchet headings, Open Sans body, sharp corners, one `→`). Paste them where each template task references "EYEBROW", "H1", "CTA", or "CODEBLOCK".

- **EYEBROW** (uppercase label above the headline):
  `<div style="font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#8a86a0;margin-bottom:10px;">TEXT</div>`
- **H1** (headline, ends with a period):
  `<div style="font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:700;font-size:22px;line-height:1.25;letter-spacing:-0.01em;color:#242424;margin:0 0 14px;">TEXT.</div>`
- **CTA** (purple button, one arrow):
  `<a href="{{ inbox_url }}" style="display:inline-block;background:#3213b7;color:#ffffff;text-decoration:none;font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:600;font-size:14px;padding:11px 20px;">Open reviewer inbox &nbsp;→</a>`
- **CODEBLOCK** (credentials):
  `<div style="background:#f6f6f8;border:1px solid #e4e2ee;padding:14px 16px;font-family:'Courier New',monospace;font-size:13px;color:#242424;margin:4px 0 20px;line-height:1.7;">…</div>`
- Paragraphs: `<p style="margin:0 0 14px;">…</p>`. Sign-off: `<p style="margin:24px 0 0;color:#5a5a66;">— The ARTPARK team</p>`.

---

## Task 1: Branded base shell (`base.html` + `base.txt`)

**Files:**
- Modify: `backend/app/templates/email/base.html`
- Modify: `backend/app/templates/email/base.txt`
- Test: `backend/tests/test_email_brand.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_email_brand.py`:

```python
"""The shared email shell renders the ARTPARK brand, and existing templates
still render through it (backward-compatible base rewrite)."""
from app.services import email_service as es


def _render_html(template_base, ctx):
    es.get_email_service.cache_clear()
    svc = es.EmailService()
    return svc._render_pair(template_base, ctx)[0]


def test_base_shell_is_artpark_branded_via_existing_template():
    # submission_confirmation extends base.html and is otherwise unchanged.
    html = _render_html("submission_confirmation", {
        "applicant_name": "Asha", "application_id": "abc12345",
        "track": "tir", "program_name": "ARTPARK TIR",
    })
    assert "#3213b7" in html          # purple brand accent
    assert "ARTPARK" in html          # wordmark
    assert "artpark.in" in html       # footer
    assert "#f4f1ea" not in html      # old beige shell is gone
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python -m pytest tests/test_email_brand.py -v --no-cov`
Expected: FAIL — `#3213b7` not present / `#f4f1ea` still present.

- [ ] **Step 3: Rewrite `base.html`**

Replace the entire file with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{% block title %}ARTPARK{% endblock %}</title>
</head>
<body style="margin:0;padding:0;background:#f6f6f8;font-family:'Open Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#242424;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f6f8;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border:1px solid #e4e2ee;">
          <tr>
            <td style="background:#3213b7;padding:22px 28px;">
              <div style="font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:700;font-size:20px;letter-spacing:-0.01em;color:#ffffff;">ARTPARK</div>
              <div style="font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#c9bdf5;margin-top:3px;">IISc Bengaluru{% block header_sublabel %}{% endblock %}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:15px;line-height:1.6;color:#242424;">
              {% block content %}{% endblock %}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;border-top:1px solid #ececf2;font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:11px;color:#9a96a8;">
              ARTPARK at IISc &nbsp;·&nbsp; Bengaluru &nbsp;·&nbsp; <a href="https://artpark.in" style="color:#9a96a8;text-decoration:underline;">artpark.in</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

- [ ] **Step 4: Update `base.txt`**

First read the current `base.txt` to confirm the block name it exposes. Keep that block (almost certainly `content`). Replace with:

```
{% block content %}{% endblock %}

— ARTPARK · IISc Bengaluru · artpark.in
```

(If the existing `base.txt` used a different block name, keep that name so child `.txt` templates still resolve.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && python -m pytest tests/test_email_brand.py -v --no-cov`
Expected: PASS.

- [ ] **Step 6: Regression — existing email tests still green**

Run: `cd backend && python -m pytest tests/test_email_service.py -v --no-cov`
Expected: PASS (templates still render through the new shell).

- [ ] **Step 7: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-mailing-revamp
git add backend/app/templates/email/base.html backend/app/templates/email/base.txt backend/tests/test_email_brand.py
git commit -m "feat(email): ARTPARK-branded shared email shell (purple band, Trebuchet/Open Sans)"
```

---

## Task 2: Mail 3 — reviewer-assigned revamp (count only)

**Files:**
- Modify: `backend/app/templates/email/reviewer_assigned.html`
- Modify: `backend/app/templates/email/reviewer_assigned.txt`
- Test: `backend/tests/test_email_brand.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_email_brand.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python -m pytest tests/test_email_brand.py::test_reviewer_assigned_is_count_only -v --no-cov`
Expected: FAIL — current template lists the app id `deadbeef` and the reassign line.

- [ ] **Step 3: Rewrite `reviewer_assigned.html`**

```html
{% extends "base.html" %}
{% block title %}New applications to review — ARTPARK{% endblock %}
{% block header_sublabel %} · Reviewer{% endblock %}
{% block content %}
<div style="font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#8a86a0;margin-bottom:10px;">New applications assigned</div>
<div style="font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:700;font-size:22px;line-height:1.25;letter-spacing:-0.01em;color:#242424;margin:0 0 14px;">Hello {{ reviewer_name }} — {{ count }} application{{ "s" if count != 1 else "" }} {{ "are" if count != 1 else "is" }} waiting for your review.</div>
<p style="margin:0 0 14px;">Thank you for lending ARTPARK your time and judgement. {{ count }} application{{ "s have" if count != 1 else " has" }} been added to your reviewer inbox — you can score {{ "them" if count != 1 else "it" }} whenever suits you.</p>
<p style="margin:0 0 22px;">We're grateful to have you on the panel.</p>
<a href="{{ inbox_url }}" style="display:inline-block;background:#3213b7;color:#ffffff;text-decoration:none;font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:600;font-size:14px;padding:11px 20px;">Open reviewer inbox &nbsp;→</a>
<p style="margin:24px 0 0;color:#5a5a66;">— The ARTPARK team</p>
{% endblock %}
```

- [ ] **Step 4: Rewrite `reviewer_assigned.txt`**

```
{% extends "base.txt" %}
{% block content %}Hello {{ reviewer_name }},

{{ count }} application{{ "s" if count != 1 else "" }} {{ "are" if count != 1 else "is" }} waiting for your review. Thank you for lending ARTPARK your time and judgement — you can score them whenever suits you.

Open your reviewer inbox: {{ inbox_url }}

We're grateful to have you on the panel.
— The ARTPARK team{% endblock %}
```

(If `base.txt` does not use a `content` block, make this a standalone plain-text file with the same body.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && python -m pytest tests/test_email_brand.py::test_reviewer_assigned_is_count_only -v --no-cov`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/templates/email/reviewer_assigned.html backend/app/templates/email/reviewer_assigned.txt backend/tests/test_email_brand.py
git commit -m "feat(email): reviewer-assigned email is count-only (drop app list + reassign line)"
```

---

## Task 3: Mail 1 — applicant decision (restyle + program label)

**Files:**
- Modify: `backend/app/templates/email/applicant_decision_advanced.html` / `.txt`
- Modify: `backend/app/templates/email/applicant_decision_rejected.html` / `.txt`
- Modify: `backend/app/services/email_service.py` (`send_applicant_decision`)
- Modify: `backend/app/services/decision_email.py` (thread `program_label`)
- Test: `backend/tests/test_email_brand.py` (append) + `backend/tests/test_decision_email.py` (new or append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_email_brand.py`:

```python
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
    assert "!" not in html_text(html)   # no exclamation marks in the copy (brand rule)

def html_text(h):
    import re
    return re.sub(r"<[^>]+>", "", h)
```

Create `backend/tests/test_decision_email.py`:

```python
from unittest.mock import MagicMock, patch
from app.services import decision_email as de


def test_notify_threads_program_label_for_sip():
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"basic_full_name": "Asha", "basic_email": "asha@x.com"}]
    )
    svc = MagicMock()
    with patch.object(de, "get_email_service", return_value=svc):
        de.notify_applicant_decided(sb, track="sip", application_id="app-1", decision="jury_review")
    kwargs = svc.send_applicant_decision.call_args.kwargs
    assert kwargs["outcome"] == "advanced"
    assert kwargs["program_label"] == "VIP"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_email_brand.py::test_applicant_advanced_has_program_label_and_brand tests/test_decision_email.py -v --no-cov`
Expected: FAIL — `program_label` not in context / not passed.

- [ ] **Step 3: Rewrite `applicant_decision_advanced.html`**

```html
{% extends "base.html" %}
{% block title %}Your ARTPARK application has advanced{% endblock %}
{% block content %}
<div style="font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#8a86a0;margin-bottom:10px;">Application update</div>
<div style="font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:700;font-size:22px;line-height:1.25;letter-spacing:-0.01em;color:#242424;margin:0 0 14px;">Congratulations, {{ applicant_name }} — you've advanced to the next round.</div>
<p style="margin:0 0 14px;">Thank you for applying to the ARTPARK {{ program_label }} programme. We're glad to share that your application has advanced to the next stage of evaluation.</p>
<p style="margin:0 0 14px;">Please keep an eye on your inbox — any further updates will be communicated by email.</p>
<p style="margin:24px 0 0;color:#5a5a66;">With appreciation,<br />— The ARTPARK team</p>
{% endblock %}
```

- [ ] **Step 4: Rewrite `applicant_decision_rejected.html`**

```html
{% extends "base.html" %}
{% block title %}An update on your ARTPARK application{% endblock %}
{% block content %}
<div style="font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#8a86a0;margin-bottom:10px;">Application update</div>
<div style="font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:700;font-size:22px;line-height:1.25;letter-spacing:-0.01em;color:#242424;margin:0 0 14px;">An update on your application, {{ applicant_name }}.</div>
<p style="margin:0 0 14px;">Thank you for taking the time to apply to the ARTPARK {{ program_label }} programme. After careful review, we won't be moving your application forward this round.</p>
<p style="margin:0 0 14px;">This was a competitive cycle and the decision was a difficult one. We genuinely value the work you put into your application, and we'd warmly encourage you to apply again in a future cohort.</p>
<p style="margin:24px 0 0;color:#5a5a66;">With appreciation,<br />— The ARTPARK team</p>
{% endblock %}
```

- [ ] **Step 5: Rewrite the two `.txt` files**

`applicant_decision_advanced.txt`:
```
{% extends "base.txt" %}
{% block content %}Congratulations, {{ applicant_name }} — you've advanced to the next round.

Thank you for applying to the ARTPARK {{ program_label }} programme. Your application has advanced to the next stage of evaluation. Please keep an eye on your inbox — further updates will be communicated by email.

With appreciation,
— The ARTPARK team{% endblock %}
```

`applicant_decision_rejected.txt`:
```
{% extends "base.txt" %}
{% block content %}An update on your application, {{ applicant_name }}.

Thank you for taking the time to apply to the ARTPARK {{ program_label }} programme. After careful review, we won't be moving your application forward this round. This was a competitive cycle and the decision was a difficult one. We'd warmly encourage you to apply again in a future cohort.

With appreciation,
— The ARTPARK team{% endblock %}
```

- [ ] **Step 6: Add `program_label` to the sender**

In `email_service.py`, change `send_applicant_decision` to accept and pass `program_label`:

```python
    def send_applicant_decision(
        self,
        *,
        to: str,
        applicant_name: str,
        outcome: str,
        application_ref: str = "",
        program_label: str = "ARTPARK",
    ) -> dict[str, str]:
        if outcome == "advanced":
            template_base = "applicant_decision_advanced"
            subject = "Your ARTPARK application has advanced to the next round"
        else:
            template_base = "applicant_decision_rejected"
            subject = "An update on your ARTPARK application"
        html, text = self._render_pair(
            template_base,
            {"applicant_name": applicant_name or "there", "application_ref": application_ref,
             "program_label": program_label},
        )
        return self.send_raw([to], subject, html, text)
```

- [ ] **Step 7: Thread the label in `decision_email.py`**

In `notify_applicant_decided`, compute the label from `track` and pass it:

```python
        name = rows[0].get("basic_full_name") or "there"
        program_label = "VIP" if track == "sip" else "TIR"
        get_email_service().send_applicant_decision(
            to=email, applicant_name=name, outcome=outcome,
            application_ref=application_id[:8], program_label=program_label,
        )
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_email_brand.py::test_applicant_advanced_has_program_label_and_brand tests/test_email_brand.py::test_applicant_rejected_is_gracious tests/test_decision_email.py -v --no-cov`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/templates/email/applicant_decision_*.html backend/app/templates/email/applicant_decision_*.txt backend/app/services/email_service.py backend/app/services/decision_email.py backend/tests/test_email_brand.py backend/tests/test_decision_email.py
git commit -m "feat(email): brand applicant decision emails + thread VIP/TIR program label"
```

---

## Task 4: Mail 2 — reviewer-invite template + sender

**Files:**
- Create: `backend/app/templates/email/reviewer_invite.html` / `.txt`
- Modify: `backend/app/services/email_service.py` (`send_reviewer_invite`)
- Test: `backend/tests/test_email_brand.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_email_brand.py`:

```python
def test_reviewer_invite_carries_credentials():
    html = _render_html("reviewer_invite", {
        "reviewer_name": "Vikram", "login_email": "vikram@x.in",
        "temp_password": "Pass-F5FY3U", "inbox_url": "https://apply.artpark.info/reviewer",
    })
    assert "vikram@x.in" in html
    assert "Pass-F5FY3U" in html
    assert "Open reviewer inbox" in html
    assert "#3213b7" in html
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python -m pytest tests/test_email_brand.py::test_reviewer_invite_carries_credentials -v --no-cov`
Expected: FAIL — template `reviewer_invite.html` does not exist.

- [ ] **Step 3: Create `reviewer_invite.html`**

```html
{% extends "base.html" %}
{% block title %}You've been invited to review for ARTPARK{% endblock %}
{% block header_sublabel %} · Reviewer invitation{% endblock %}
{% block content %}
<div style="font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#8a86a0;margin-bottom:10px;">Reviewer invitation</div>
<div style="font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:700;font-size:22px;line-height:1.25;letter-spacing:-0.01em;color:#242424;margin:0 0 14px;">You've been invited to review for ARTPARK.</div>
<p style="margin:0 0 14px;">Hello {{ reviewer_name }}, the ARTPARK admin team has invited you to help review applications for the TIR and VIP programmes. Thank you for lending us your expertise.</p>
<p style="margin:0 0 8px;">Use these credentials to sign in:</p>
<div style="background:#f6f6f8;border:1px solid #e4e2ee;padding:14px 16px;font-family:'Courier New',monospace;font-size:13px;color:#242424;margin:4px 0 20px;line-height:1.7;">
  Email: {{ login_email }}<br />
  Temporary password: {{ temp_password }}
</div>
<a href="{{ inbox_url }}" style="display:inline-block;background:#3213b7;color:#ffffff;text-decoration:none;font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:600;font-size:14px;padding:11px 20px;">Open reviewer inbox &nbsp;→</a>
<p style="margin:22px 0 0;color:#5a5a66;font-size:13px;">For your security, please change this temporary password after your first sign-in.</p>
<p style="margin:18px 0 0;color:#5a5a66;">— The ARTPARK team</p>
{% endblock %}
```

- [ ] **Step 4: Create `reviewer_invite.txt`**

```
{% extends "base.txt" %}
{% block content %}You've been invited to review for ARTPARK.

Hello {{ reviewer_name }}, the ARTPARK admin team has invited you to help review applications for the TIR and VIP programmes.

Sign in with these credentials:
  Email: {{ login_email }}
  Temporary password: {{ temp_password }}

Open your reviewer inbox: {{ inbox_url }}

For your security, please change this temporary password after your first sign-in.
— The ARTPARK team{% endblock %}
```

- [ ] **Step 5: Add the `send_reviewer_invite` sender**

In `email_service.py`, add (next to `send_reviewer_assigned`):

```python
    def send_reviewer_invite(
        self,
        *,
        to: str,
        reviewer_name: str,
        login_email: str,
        temp_password: str,
        inbox_url: str,
    ) -> dict[str, str]:
        """Branded reviewer invitation carrying sign-in credentials."""
        html, text = self._render_pair(
            "reviewer_invite",
            {"reviewer_name": reviewer_name or login_email, "login_email": login_email,
             "temp_password": temp_password, "inbox_url": inbox_url},
        )
        return self.send_raw(
            to=[to],
            subject="You've been invited to review for ARTPARK",
            html=html,
            text=text,
        )
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && python -m pytest tests/test_email_brand.py::test_reviewer_invite_carries_credentials -v --no-cov`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/templates/email/reviewer_invite.* backend/app/services/email_service.py backend/tests/test_email_brand.py
git commit -m "feat(email): reviewer-invite credentials template + send_reviewer_invite sender"
```

---

## Task 5: Mail 2 — wire credentials email into `create_user`

**Files:**
- Modify: `backend/app/routers/admin_users.py` (`create_user`)
- Test: `backend/tests/test_admin_users.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_admin_users.py` (the harness — `_FakeAdminClient`, `_FakeCreateAuth`, `_override_user`, `admin_users_router`, `app`, `get_current_user` — is already in this file):

```python
class _RecordingCreateAuth(_FakeCreateAuth):
    def __init__(self, new_user_id="u-new"):
        super().__init__(new_user_id)
        self.invited = False
        self.created = False
    def invite_user_by_email(self, email):
        self.invited = True
        return super().invite_user_by_email(email)
    def create_user(self, payload):
        self.created = True
        return super().create_user(payload)


class _InviteEmailService:
    def __init__(self):
        self.reviewer_invite_calls = []
    def send_reviewer_invite(self, **kwargs):
        self.reviewer_invite_calls.append(kwargs)
        return {"message_id": "test", "status": "sent"}


def test_reviewer_invite_emails_credentials(client, monkeypatch, _clear_overrides):
    auth = _RecordingCreateAuth()
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []}, auth=auth)
    fake_email = _InviteEmailService()
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: fake_email)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
        json={"email": "rev@x.com", "full_name": "Rev", "roles": ["reviewer"], "send_invite": True},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    # reviewer invite takes the create-with-password path, not the magic link
    assert auth.created and not auth.invited
    assert body["temp_password"]                       # returned so the modal shows the real one
    assert len(fake_email.reviewer_invite_calls) == 1
    call = fake_email.reviewer_invite_calls[0]
    assert call["to"] == "rev@x.com"
    assert call["temp_password"] == body["temp_password"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python -m pytest tests/test_admin_users.py::test_reviewer_invite_emails_credentials -v --no-cov`
Expected: FAIL — current flow calls `invite_user_by_email` (auth.invited True) and `temp_password` is None.

- [ ] **Step 3: Update `create_user`**

In `admin_users.py`, replace the create/invite block (the `try: if body.send_invite: …` around lines 91-101) and the return so reviewers take the password path + get the branded email. Change the branch:

```python
    is_reviewer_invite = "reviewer" in body.roles

    try:
        if body.send_invite and not is_reviewer_invite:
            invite = client.auth.admin.invite_user_by_email(body.email)
            new_user = invite.user
        else:
            create = client.auth.admin.create_user({
                "email": body.email,
                "password": temp_password,
                "email_confirm": True,
            })
            new_user = create.user
    except Exception as exc:
        msg = str(exc)
        if "already" in msg.lower() or "registered" in msg.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "email_exists", "email": body.email},
            )
        log.error("admin create_user failed", extra={"email": body.email, "err": msg[:200]})
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "auth_create_failed", "message": msg[:200]},
        )
```

After the `user_roles` insert + before `write_audit`, send the branded credentials email for reviewer invites:

```python
    credentials_emailed = False
    if is_reviewer_invite and body.send_invite:
        try:
            get_email_service().send_reviewer_invite(
                to=body.email,
                reviewer_name=body.full_name,
                login_email=body.email,
                temp_password=temp_password,
                inbox_url=frontend_url("/reviewer"),
            )
            credentials_emailed = True
        except Exception:  # noqa: BLE001
            log.warning("reviewer invite email failed for %s", body.email, exc_info=True)
```

Change the return so the reviewer path exposes the real temp password:

```python
    return {
        "id": new_user_id,
        "email": body.email,
        "full_name": body.full_name,
        "roles": body.roles,
        "temp_password": temp_password if (is_reviewer_invite or not body.send_invite) else None,
        "invite_sent": body.send_invite,
        "credentials_emailed": credentials_emailed,
    }
```

(`get_email_service` and `frontend_url` are already imported at the top of this module.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && python -m pytest tests/test_admin_users.py::test_reviewer_invite_emails_credentials -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Regression — the admin_users suite stays green**

Run: `cd backend && python -m pytest tests/test_admin_users.py -v --no-cov`
Expected: PASS (the existing `test_create_user_writes_audit` uses `_FakeCreateAuth`, which still supports both methods; with `roles=['reviewer']` it now records via `create_user` — still returns 201; the audit assertion is unaffected).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/admin_users.py backend/tests/test_admin_users.py
git commit -m "feat(admin): reviewer invite creates a password account and emails branded credentials"
```

---

## Task 6: Mail 4 — reviewer-reminder template + sender

**Files:**
- Create: `backend/app/templates/email/reviewer_reminder.html` / `.txt`
- Modify: `backend/app/services/email_service.py` (`send_reviewer_reminder`)
- Test: `backend/tests/test_email_brand.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_email_brand.py`:

```python
def test_reviewer_reminder_shows_pending_and_completed():
    html = _render_html("reviewer_reminder", {
        "reviewer_name": "Udita", "pending_count": 2, "completed_count": 4,
        "inbox_url": "https://apply.artpark.info/reviewer",
    })
    assert "2 application" in html        # pending
    assert "4" in html                    # completed
    assert "Open reviewer inbox" in html
    assert "#3213b7" in html
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python -m pytest tests/test_email_brand.py::test_reviewer_reminder_shows_pending_and_completed -v --no-cov`
Expected: FAIL — template does not exist.

- [ ] **Step 3: Create `reviewer_reminder.html`**

```html
{% extends "base.html" %}
{% block title %}Applications awaiting your review — ARTPARK{% endblock %}
{% block header_sublabel %} · Reviewer{% endblock %}
{% block content %}
<div style="font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#8a86a0;margin-bottom:10px;">Daily review reminder</div>
<div style="font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:700;font-size:22px;line-height:1.25;letter-spacing:-0.01em;color:#242424;margin:0 0 14px;">You have {{ pending_count }} application{{ "s" if pending_count != 1 else "" }} left to review.</div>
<p style="margin:0 0 14px;">Hello {{ reviewer_name }} — you've completed {{ completed_count }} so far. {{ pending_count }} {{ "are" if pending_count != 1 else "is" }} still pending. Thank you for keeping the panel moving.</p>
<p style="margin:0 0 22px;">A few minutes today keeps the cohort on track.</p>
<a href="{{ inbox_url }}" style="display:inline-block;background:#3213b7;color:#ffffff;text-decoration:none;font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:600;font-size:14px;padding:11px 20px;">Open reviewer inbox &nbsp;→</a>
<p style="margin:24px 0 0;color:#5a5a66;">— The ARTPARK team</p>
{% endblock %}
```

- [ ] **Step 4: Create `reviewer_reminder.txt`**

```
{% extends "base.txt" %}
{% block content %}You have {{ pending_count }} application{{ "s" if pending_count != 1 else "" }} left to review.

Hello {{ reviewer_name }} — you've completed {{ completed_count }} so far. {{ pending_count }} still pending. Thank you for keeping the panel moving.

Open your reviewer inbox: {{ inbox_url }}

— The ARTPARK team{% endblock %}
```

- [ ] **Step 5: Add the `send_reviewer_reminder` sender**

In `email_service.py`:

```python
    def send_reviewer_reminder(
        self,
        *,
        to: str,
        reviewer_name: str,
        pending_count: int,
        completed_count: int,
        inbox_url: str,
    ) -> dict[str, str]:
        """Daily reminder of a reviewer's pending applications."""
        html, text = self._render_pair(
            "reviewer_reminder",
            {"reviewer_name": reviewer_name, "pending_count": pending_count,
             "completed_count": completed_count, "inbox_url": inbox_url},
        )
        plural = "s" if pending_count != 1 else ""
        return self.send_raw(
            to=[to],
            subject=f"{pending_count} application{plural} awaiting your review — ARTPARK",
            html=html,
            text=text,
        )
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && python -m pytest tests/test_email_brand.py::test_reviewer_reminder_shows_pending_and_completed -v --no-cov`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/templates/email/reviewer_reminder.* backend/app/services/email_service.py backend/tests/test_email_brand.py
git commit -m "feat(email): reviewer daily-reminder template + send_reviewer_reminder sender"
```

---

## Task 7: Mail 4 — reviewer-reminder worker

**Files:**
- Create: `backend/workers/reviewer_reminder/__init__.py` (empty)
- Create: `backend/workers/reviewer_reminder/handler.py`
- Test: `backend/tests/test_reviewer_reminder.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_reviewer_reminder.py`:

```python
from unittest.mock import MagicMock, patch
from workers.reviewer_reminder import handler as h


def _roster():
    return {"reviewers": [
        {"name": "A", "email": "a@x.in", "assigned": 5, "completed": 2},   # pending 3 → send
        {"name": "B", "email": "b@x.in", "assigned": 4, "completed": 4},   # pending 0 → skip
        {"name": "C", "email": None,     "assigned": 3, "completed": 0},   # no email → skip
    ]}


def test_sends_only_to_reviewers_with_pending_and_email():
    svc = MagicMock()
    with patch.object(h, "fetch_roster", return_value=_roster()), \
         patch.object(h, "get_email_service", return_value=svc):
        out = h.lambda_handler({}, None)
    assert svc.send_reviewer_reminder.call_count == 1
    kwargs = svc.send_reviewer_reminder.call_args.kwargs
    assert kwargs["to"] == "a@x.in"
    assert kwargs["pending_count"] == 3 and kwargs["completed_count"] == 2
    assert out["sent"] == 1 and out["skipped"] == 2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python -m pytest tests/test_reviewer_reminder.py -v --no-cov`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the worker**

`backend/workers/reviewer_reminder/__init__.py` — empty file.

`backend/workers/reviewer_reminder/handler.py`:

```python
"""EventBridge-scheduled Lambda: daily 09:00-IST reminder to each reviewer with
pending applications. Skips reviewers with nothing pending or no email. Best-effort."""
from __future__ import annotations

import logging
from typing import Any

from app.services.admin_query import fetch_roster
from app.services.email_service import frontend_url, get_email_service

log = logging.getLogger(__name__)
logging.getLogger().setLevel(logging.INFO)


def lambda_handler(event: dict, context: Any) -> dict:
    roster = fetch_roster() or {}
    reviewers = roster.get("reviewers", [])
    inbox = frontend_url("/reviewer")
    svc = get_email_service()
    sent = 0
    skipped = 0
    for r in reviewers:
        email = (r.get("email") or "").strip()
        assigned = int(r.get("assigned") or 0)
        completed = int(r.get("completed") or 0)
        pending = assigned - completed
        if pending <= 0 or not email:
            skipped += 1
            continue
        try:
            svc.send_reviewer_reminder(
                to=email,
                reviewer_name=r.get("name") or email,
                pending_count=pending,
                completed_count=completed,
                inbox_url=inbox,
            )
            sent += 1
        except Exception:  # noqa: BLE001
            log.warning("reviewer_reminder: send failed for %s", email, exc_info=True)
            skipped += 1
    log.info("reviewer_reminder: sent=%d skipped=%d", sent, skipped)
    return {"sent": sent, "skipped": skipped}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && python -m pytest tests/test_reviewer_reminder.py -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/workers/reviewer_reminder/ backend/tests/test_reviewer_reminder.py
git commit -m "feat(email): reviewer daily-reminder worker (fetch_roster, skip zero-pending)"
```

---

## Task 8: Mail 5 — admin daily digest = all-reviewers progress

**Files:**
- Modify: `backend/app/templates/email/daily_digest.html` / `.txt`
- Modify: `backend/app/services/email_service.py` (`send_daily_digest`)
- Modify: `backend/workers/daily_digest/handler.py`
- Modify: `backend/tests/test_daily_digest.py` (rewrite — current behaviour changes)
- Test: `backend/tests/test_email_brand.py` (append)

- [ ] **Step 1: Write/replace the failing tests**

Append to `backend/tests/test_email_brand.py`:

```python
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
```

Replace the body of `backend/tests/test_daily_digest.py` with roster-based tests:

```python
from unittest.mock import MagicMock, patch
from workers.daily_digest import handler as h


def _roster():
    return {"reviewers": [
        {"name": "Udita", "email": "u@x.in", "assigned": 6, "completed": 4},
        {"name": "Nirav", "email": "n@x.in", "assigned": 0, "completed": 0},
    ]}


def test_digest_sends_all_reviewers_to_admins():
    svc = MagicMock()
    with patch.object(h, "fetch_roster", return_value=_roster()), \
         patch.object(h, "get_admin_client", return_value=MagicMock()), \
         patch.object(h, "get_admin_emails", return_value=["admin@artpark.in"]), \
         patch.object(h, "get_email_service", return_value=svc):
        out = h.lambda_handler({}, None)
    assert svc.send_daily_digest.call_count == 1
    kwargs = svc.send_daily_digest.call_args.kwargs
    assert kwargs["to"] == ["admin@artpark.in"]
    assert len(kwargs["reviewers"]) == 2
    assert kwargs["total_pending"] == 2     # Udita 2 + Nirav 0
    assert out["sent"] is True


def test_digest_skips_when_no_admins():
    svc = MagicMock()
    with patch.object(h, "fetch_roster", return_value={"reviewers": []}), \
         patch.object(h, "get_admin_client", return_value=MagicMock()), \
         patch.object(h, "get_admin_emails", return_value=[]), \
         patch.object(h, "get_email_service", return_value=svc):
        out = h.lambda_handler({}, None)
    svc.send_daily_digest.assert_not_called()
    assert out["sent"] is False
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_daily_digest.py tests/test_email_brand.py::test_daily_digest_lists_all_reviewers -v --no-cov`
Expected: FAIL — handler still uses the window query / `send_daily_digest` signature mismatch / template lacks the rows.

- [ ] **Step 3: Rewrite `daily_digest.html`**

```html
{% extends "base.html" %}
{% block title %}Reviewer progress — ARTPARK OS{% endblock %}
{% block header_sublabel %} · Admin digest{% endblock %}
{% block content %}
<div style="font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#8a86a0;margin-bottom:10px;">Reviewer activity</div>
<div style="font-family:'Trebuchet MS','Lucida Grande',Tahoma,sans-serif;font-weight:700;font-size:22px;line-height:1.25;letter-spacing:-0.01em;color:#242424;margin:0 0 14px;">Reviewer progress — {{ date_label }}.</div>
<p style="margin:0 0 16px;">{{ total_pending }} of {{ total_assigned }} assigned application{{ "s" if total_assigned != 1 else "" }} still pending across the panel.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:13px;">
  <tr>
    <td style="padding:8px 10px;border-bottom:2px solid #3213b7;font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8a86a0;">Reviewer</td>
    <td style="padding:8px 10px;border-bottom:2px solid #3213b7;font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8a86a0;" align="right">Completed / Assigned</td>
    <td style="padding:8px 10px;border-bottom:2px solid #3213b7;font-family:'Open Sans',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8a86a0;" align="right">Pending</td>
  </tr>
  {% for r in reviewers %}
  <tr>
    <td style="padding:9px 10px;border-bottom:1px solid #ececf2;color:#242424;">{{ r.name }}</td>
    <td style="padding:9px 10px;border-bottom:1px solid #ececf2;color:#5a5a66;" align="right">{{ r.completed }} / {{ r.assigned }}</td>
    <td style="padding:9px 10px;border-bottom:1px solid #ececf2;font-weight:700;color:{{ '#3213b7' if r.pending else '#9a96a8' }};" align="right">{{ r.pending }}</td>
  </tr>
  {% endfor %}
</table>
<p style="margin:24px 0 0;color:#5a5a66;">— ARTPARK OS</p>
{% endblock %}
```

- [ ] **Step 4: Rewrite `daily_digest.txt`**

```
{% extends "base.txt" %}
{% block content %}Reviewer progress — {{ date_label }}.

{{ total_pending }} of {{ total_assigned }} assigned applications still pending across the panel.

{% for r in reviewers %}{{ r.name }}: {{ r.completed }}/{{ r.assigned }} done, {{ r.pending }} pending
{% endfor %}
— ARTPARK OS{% endblock %}
```

- [ ] **Step 5: Change the `send_daily_digest` signature**

In `email_service.py`:

```python
    def send_daily_digest(
        self,
        *,
        to: list[str],
        date_label: str,
        reviewers: list[dict],
        total_pending: int,
        total_assigned: int,
    ) -> dict[str, str]:
        """Daily admin digest: progress for every active reviewer."""
        html, text = self._render_pair(
            "daily_digest",
            {"date_label": date_label, "reviewers": reviewers,
             "total_pending": total_pending, "total_assigned": total_assigned},
        )
        return self.send_raw(
            to=to,
            subject=f"Reviewer progress — {date_label} — ARTPARK OS",
            html=html,
            text=text,
        )
```

- [ ] **Step 6: Rewrite the digest worker**

Replace `backend/workers/daily_digest/handler.py` with:

```python
"""EventBridge-scheduled Lambda: daily 08:00-IST admin digest of every active
reviewer's progress (assigned / completed / pending). Emailed to all admins.
Best-effort."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.admin_query import fetch_roster
from app.services.email_service import get_email_service
from app.services.user_lookup import get_admin_emails
from app.supabase_client import get_admin_client  # noqa: F401  (kept for parity/mocks)

log = logging.getLogger(__name__)
logging.getLogger().setLevel(logging.INFO)

_IST = timezone(timedelta(hours=5, minutes=30))


def lambda_handler(event: dict, context: Any) -> dict:
    roster = fetch_roster() or {}
    reviewers = []
    total_pending = 0
    total_assigned = 0
    for r in roster.get("reviewers", []):
        assigned = int(r.get("assigned") or 0)
        completed = int(r.get("completed") or 0)
        pending = assigned - completed
        total_pending += max(0, pending)
        total_assigned += assigned
        reviewers.append({"name": r.get("name") or r.get("email") or "—",
                          "assigned": assigned, "completed": completed, "pending": pending})
    reviewers.sort(key=lambda x: x["pending"], reverse=True)

    sb = get_admin_client()
    recipients = get_admin_emails(sb)
    if not recipients:
        log.warning("daily_digest: no admin recipients — skipping")
        return {"sent": False, "reviewers": len(reviewers)}

    date_label = datetime.now(_IST).strftime("%d %b %Y")
    try:
        get_email_service().send_daily_digest(
            to=recipients, date_label=date_label, reviewers=reviewers,
            total_pending=total_pending, total_assigned=total_assigned,
        )
    except Exception:  # noqa: BLE001
        log.warning("daily_digest: send failed", exc_info=True)
        return {"sent": False, "reviewers": len(reviewers)}

    log.info("daily_digest: sent %d reviewers to %d admins", len(reviewers), len(recipients))
    return {"sent": True, "reviewers": len(reviewers), "recipients": len(recipients)}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_daily_digest.py tests/test_email_brand.py::test_daily_digest_lists_all_reviewers -v --no-cov`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/templates/email/daily_digest.* backend/app/services/email_service.py backend/workers/daily_digest/handler.py backend/tests/test_daily_digest.py backend/tests/test_email_brand.py
git commit -m "feat(email): admin daily digest = all-reviewers progress snapshot (fetch_roster)"
```

---

## Task 9: SAM — `ReviewerReminderFunction` (09:00 IST schedule)

**Files:**
- Modify: `infra/sam/template.yaml` (add function + log group after the `DailyDigestLogGroup` block, before `Outputs:`)

- [ ] **Step 1: Add the function + log group**

Insert before the `Outputs:` line:

```yaml
  ReviewerReminderFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub artpark-eir-reviewer-reminder-${EnvName}
      CodeUri: ../../backend/
      Handler: workers.reviewer_reminder.handler.lambda_handler
      Timeout: 60
      Events:
        DailyMorning:
          Type: Schedule
          Properties:
            # 03:30 UTC = 09:00 IST, every day
            Schedule: "cron(30 3 * * ? *)"
      Policies:
        - CloudWatchLogsFullAccess

  ReviewerReminderLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub /aws/lambda/artpark-eir-reviewer-reminder-${EnvName}
      RetentionInDays: 30
```

- [ ] **Step 2: Validate the template**

Run: `cd infra/sam && sam validate --lint 2>&1 | tail -5`
Expected: "template.yaml is a valid SAM Template" (or no errors). If `sam` is unavailable locally, grep-confirm the block parses: `python -c "import yaml,sys; yaml.safe_load(open('infra/sam/template.yaml'))" ` from the worktree root (note: SAM intrinsics may need `yaml.SafeLoader` to ignore `!Sub` — if it errors on the tag, skip and rely on the deploy build).

- [ ] **Step 3: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-mailing-revamp
git add infra/sam/template.yaml
git commit -m "feat(infra): scheduled ReviewerReminderFunction (09:00 IST) + log group"
```

---

## Task 10: Test-send script (all 5 mails → test inbox)

**Files:**
- Create: `backend/scripts/send_test_emails.py`

- [ ] **Step 1: Create the script**

`backend/scripts/send_test_emails.py`:

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/send_test_emails.py
git commit -m "chore(email): script to send all 5 sample emails to a test inbox"
```

---

## Task 11: Full verification, real-send QA, deploy

- [ ] **Step 1: Full backend suite for touched areas**

Run: `cd backend && python -m pytest tests/test_email_brand.py tests/test_email_service.py tests/test_decision_email.py tests/test_admin_users.py tests/test_daily_digest.py tests/test_reviewer_reminder.py -v --no-cov`
Expected: PASS.

- [ ] **Step 2: Real-send QA to the test inbox**

Source the prod Resend credentials and run the script (the values live in `backend/.env.prod` — copy it into this worktree first; it's gitignored):
```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-mailing-revamp
cp ../release-sip-launch-v1/backend/.env.prod backend/.env.prod   # if not already present
cd backend && set -a && source .env.prod && set +a && python scripts/send_test_emails.py udayanpawar03@gmail.com
```
Expected: 6 sends print ✓. **User confirms all six look on-brand and coherent in the inbox.** Iterate on templates if the user requests visual tweaks (re-run this step).

- [ ] **Step 3: Deploy (SAM) — intake stays closed**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-mailing-revamp
grep -E 'TIR_SUBMISSIONS_CLOSED|SIP_SUBMISSIONS_CLOSED' backend/.env.prod   # MUST be true/true
cd infra/sam && bash deploy-prod.sh
```
Expected: stack `artpark-eir-api-production` updates (now with `ReviewerReminderFunction`); `curl -s https://api.artpark.info/health` → ok.

- [ ] **Step 4: Push to release**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-mailing-revamp
git fetch origin
git rebase origin/release/sip-launch-v1     # resolve if the concurrent session advanced it
git push origin feat/mailing-revamp:release/sip-launch-v1
```
(Frontend: no logic change expected — the invite modal already renders `result.temp_password`. If a tweak is needed, the user Vercel-promotes.)

- [ ] **Step 5: Lock**

After the user signs off on the inbox QA, record in memory that these five emails (templates + senders + triggers + the two EventBridge schedules) are the canonical, frozen ARTPARK mailing set — not to be restyled/rewired in unrelated future work.

---

## Self-review notes

- **Spec coverage:** shell → T1; mail 3 → T2; mail 1 → T3; mail 2 (template+sender) → T4, (wiring) → T5; mail 4 (template+sender) → T6, (worker) → T7, (schedule) → T9; mail 5 → T8; test script → T10; testing/deploy/lock → T11. All covered.
- **Signature consistency:** `send_applicant_decision(..., program_label)` (T3) matches `decision_email` call (T3) + test-script call (T10); `send_reviewer_invite(to, reviewer_name, login_email, temp_password, inbox_url)` used identically in T4/T5/T10; `send_reviewer_reminder(to, reviewer_name, pending_count, completed_count, inbox_url)` in T6/T7/T10; `send_daily_digest(to, date_label, reviewers, total_pending, total_assigned)` in T8/T10; worker `fetch_roster` reviewer keys `name/email/assigned/completed` match `admin_query.fetch_roster` output.
- **No placeholders:** every step has full code/commands.
- **Backward-compat:** base rewrite keeps `title`/`content` blocks; `header_sublabel` is optional with an empty default, so untouched templates (submission/support/ticket/role_granted/status_change) still render.
