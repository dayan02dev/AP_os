# Admin/Leadership Decision Emails + UI Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin approves an application it moves to `jury_review` and the applicant is emailed they advanced; when rejected it moves to `rejected` and the applicant is emailed a gracious decline — plus three admin UI cleanups (status-breakdown card, HOME button, bulk-bar/decision-panel option pruning).

**Architecture:** All decision paths (admin single, admin bulk, leadership reject) funnel through `decisions.record_decision()`, which maps the decision string directly to the new status. We add a best-effort applicant-email hook there (fires only for `rejected`/`jury_review`), extend the state machine + `admin_decisions` CHECK to allow `jury_review`, and add `jury_review` to the display maps so both surfaces render "Jury review". Frontend changes are pure removals + one decision→wire remap.

**Tech Stack:** FastAPI + Supabase (Python), Jinja2 email templates over Resend, React (Vite/Jest), SAM/Lambda deploy, Vercel frontend.

**Worktree:** `/Users/apple/Desktop/Final_AP_os/.claude/worktrees/feat-admin-decision-emails` (branch `feat/admin-decision-emails` off `release/sip-launch-v1`). All paths below are relative to this worktree. Run backend commands from `backend/`, frontend from `frontend/`.

**Spec:** `docs/superpowers/specs/2026-06-28-admin-decision-emails-design.md`

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `backend/app/services/state_machine.py` | Modify | Allow `*→jury_review` from review states |
| `backend/migrations/027_jury_review_decision.sql` | Create | Relax `admin_decisions.decision` CHECK |
| `backend/app/templates/email/applicant_decision_advanced.{html,txt}` | Create | "Advanced to jury" applicant copy |
| `backend/app/templates/email/applicant_decision_rejected.{html,txt}` | Create | Gracious decline copy |
| `backend/app/services/email_service.py` | Modify | `send_applicant_decision()` method |
| `backend/app/services/decision_email.py` | Create | `notify_applicant_decided()` — resolve email, best-effort send |
| `backend/app/services/decisions.py` | Modify | Call the email hook after status change |
| `backend/app/routers/admin_platform.py` | Modify | Accept `jury_review` in decision Literals |
| `backend/app/services/stats.py` | Modify | Count/label `jury_review` |
| `frontend/src/lib/adminDataAdapter.js` | Modify | `approve→jury_review`; render `jury_review` |
| `frontend/src/pages/leadership/components/statusBuckets.js` | Modify | `jury_review` bucket |
| `frontend/src/pages/admin/platform/screens/AdminDashboard.jsx` | Modify | Remove status-breakdown card |
| `frontend/src/pages/admin/platform/AdminPortal.jsx` | Modify | Remove HOME button |
| `frontend/src/styles/admin-portal.css` | Modify | Drop dead HOME-btn CSS / left-align brand |
| `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` | Modify | Bulk bar → Reject + Assign batch only |
| `frontend/src/pages/admin/platform/screens/AdminGate1.jsx` | Modify | Decision panel → Approve + Reject |
| `frontend/src/pages/admin/platform/screens/AdminDetail.jsx` | Modify | Decide grid → Approve + Reject + caption |

---

## TASK GROUP A — Backend (feature logic)

### Task 1: State machine allows `jury_review` from review states

**Files:**
- Modify: `backend/app/services/state_machine.py` (the `LEGAL_TRANSITIONS` dict, ~lines 39–54)
- Test: `backend/tests/test_state_machine.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_state_machine.py` (match the file's existing import of `state_machine`):

```python
def test_jury_review_reachable_from_review_states():
    # Approve → jury_review must be legal from every realistic pre-jury state.
    for frm in ("under_review", "evaluated", "on_hold", "shortlisted"):
        state_machine.assert_legal_transition(frm, "jury_review")  # must not raise


def test_jury_review_can_be_rejected():
    # Smoke test relies on approve-then-reject of one app.
    state_machine.assert_legal_transition("jury_review", "rejected")  # must not raise
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd backend && python -m pytest tests/test_state_machine.py -k jury_review -v --no-cov`
Expected: FAIL — `under_review → jury_review` / `evaluated → jury_review` raise (illegal transition).

- [ ] **Step 3: Add `jury_review` to the three transition sets**

In `backend/app/services/state_machine.py`, change these three lines:

```python
    "under_review":     frozenset({"evaluated", "jury_review", "rejected", "withdrawn"}),
    "evaluated":        frozenset({"shortlisted", "on_hold", "jury_review", "rejected", "waitlisted", "withdrawn"}),
    "on_hold":          frozenset({"evaluated", "shortlisted", "jury_review", "rejected", "waitlisted", "withdrawn"}),
```

(`"shortlisted"` already includes `"jury_review"`; `"jury_review" → {"rejected","withdrawn"}` already exists.)

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd backend && python -m pytest tests/test_state_machine.py -v --no-cov`
Expected: PASS (new + existing transition tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/state_machine.py backend/tests/test_state_machine.py
git commit -m "feat(state-machine): allow approve→jury_review from review states"
```

---

### Task 2: Migration — relax `admin_decisions.decision` CHECK

**Files:**
- Create: `backend/migrations/027_jury_review_decision.sql`

> Note: `jury_staging` independently uses a `027_*` migration. These live on separate branches; if jury ever merges to prod, renumber one. On `release/sip-launch-v1` the next free number is 027.

- [ ] **Step 1: Write the migration**

Create `backend/migrations/027_jury_review_decision.sql`:

```sql
-- 027_jury_review_decision.sql
-- Allow 'jury_review' as a gate-1 admin decision (admin "Approve" now advances
-- an application to the jury_review status). Mirrors the value already legal in
-- the application state machine. Idempotent: drop-if-exists then re-add.

alter table admin_decisions
  drop constraint if exists admin_decisions_decision_check;

alter table admin_decisions
  add constraint admin_decisions_decision_check
  check (decision in ('shortlisted','on_hold','rejected','waitlisted','jury_review'));
```

- [ ] **Step 2: Verify the constraint name locally (sanity)**

Run: `grep -n "decision" backend/migrations/024_admin_platform.sql`
Expected: confirms the original inline `check (decision in (...))` on `admin_decisions`. (Postgres auto-names the inline check `admin_decisions_decision_check`; the `drop ... if exists` makes the migration safe even if the name differs — a differing name simply leaves the old constraint, so if `grep` shows a non-default name, add a second `drop constraint if exists <that_name>` line.)

- [ ] **Step 3: Commit** (applied to prod DB later in Task 17)

```bash
git add backend/migrations/027_jury_review_decision.sql
git commit -m "feat(db): migration 027 — allow jury_review admin decision"
```

---

### Task 3: Applicant decision email templates

**Files:**
- Create: `backend/app/templates/email/applicant_decision_advanced.html`
- Create: `backend/app/templates/email/applicant_decision_advanced.txt`
- Create: `backend/app/templates/email/applicant_decision_rejected.html`
- Create: `backend/app/templates/email/applicant_decision_rejected.txt`

- [ ] **Step 1: Create `applicant_decision_advanced.html`**

```html
{% extends "base.html" %}
{% block title %}Your ARTPARK application has advanced — ARTPARK{% endblock %}
{% block content %}
<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;line-height:1.3;">Good news, {{ applicant_name }} — you're moving forward.</h1>

<p style="margin:0 0 14px 0;">After review, your ARTPARK application has <strong>advanced to the next round</strong> and will now go before our evaluation jury.</p>

<p style="margin:0 0 14px 0;">There's nothing you need to do right now — we'll be in touch with the next steps as the jury evaluation progresses.</p>

<p style="margin:24px 0 0 0;">Thank you for your interest in ARTPARK.</p>
<p style="margin:8px 0 0 0;">— The ARTPARK team</p>
{% endblock %}
```

- [ ] **Step 2: Create `applicant_decision_advanced.txt`**

```text
{% extends "base.txt" %}
{% block content %}Good news, {{ applicant_name }} — you're moving forward.

After review, your ARTPARK application has advanced to the next round and will now go before our evaluation jury.

There's nothing you need to do right now — we'll be in touch with the next steps as the jury evaluation progresses.

Thank you for your interest in ARTPARK.

— The ARTPARK team
{% endblock %}
```

- [ ] **Step 3: Create `applicant_decision_rejected.html`**

```html
{% extends "base.html" %}
{% block title %}An update on your ARTPARK application{% endblock %}
{% block content %}
<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;line-height:1.3;">An update on your application, {{ applicant_name }}.</h1>

<p style="margin:0 0 14px 0;">Thank you for taking the time to apply to ARTPARK. After careful review, we won't be moving your application forward this round.</p>

<p style="margin:0 0 14px 0;">This was a competitive cycle and the decision was not an easy one. We genuinely appreciate the effort you put into your application and encourage you to apply again in the future.</p>

<p style="margin:24px 0 0 0;">With appreciation,</p>
<p style="margin:8px 0 0 0;">— The ARTPARK team</p>
{% endblock %}
```

- [ ] **Step 4: Create `applicant_decision_rejected.txt`**

```text
{% extends "base.txt" %}
{% block content %}An update on your application, {{ applicant_name }}.

Thank you for taking the time to apply to ARTPARK. After careful review, we won't be moving your application forward this round.

This was a competitive cycle and the decision was not an easy one. We genuinely appreciate the effort you put into your application and encourage you to apply again in the future.

With appreciation,
— The ARTPARK team
{% endblock %}
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/templates/email/applicant_decision_*
git commit -m "feat(email): applicant decision templates (advanced / rejected)"
```

---

### Task 4: `EmailService.send_applicant_decision()`

**Files:**
- Modify: `backend/app/services/email_service.py` (add a method on `EmailService`, near `send_role_granted` ~line 262)
- Test: `backend/tests/test_email_service.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_email_service.py` (mirror how existing tests build the service + assert on `send_raw`; if the file stubs Resend via monkeypatch, reuse that fixture):

```python
def test_send_applicant_decision_advanced_renders_and_sends(monkeypatch):
    from app.services import email_service as es
    es.get_email_service.cache_clear()
    svc = es.get_email_service()
    captured = {}
    monkeypatch.setattr(svc, "send_raw",
        lambda to, subject, html, text, reply_to=None: captured.update(
            to=to, subject=subject, html=html, text=text) or {"message_id": "x", "status": "sent"})
    out = svc.send_applicant_decision(to="a@b.com", applicant_name="Ada", outcome="advanced", application_ref="abcd1234")
    assert out["status"] == "sent"
    assert captured["to"] == ["a@b.com"]
    assert "advanced" in captured["text"].lower()
    assert "Ada" in captured["html"]


def test_send_applicant_decision_rejected_uses_decline_copy(monkeypatch):
    from app.services import email_service as es
    es.get_email_service.cache_clear()
    svc = es.get_email_service()
    captured = {}
    monkeypatch.setattr(svc, "send_raw",
        lambda to, subject, html, text, reply_to=None: captured.update(text=text) or {"message_id": "x", "status": "sent"})
    svc.send_applicant_decision(to="a@b.com", applicant_name="Ada", outcome="rejected")
    assert "won't be moving" in captured["text"]
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && python -m pytest tests/test_email_service.py -k applicant_decision -v --no-cov`
Expected: FAIL — `AttributeError: 'EmailService' object has no attribute 'send_applicant_decision'`.

- [ ] **Step 3: Implement the method**

In `backend/app/services/email_service.py`, add inside the `EmailService` class (e.g. after `send_role_granted`):

```python
    def send_applicant_decision(
        self,
        *,
        to: str,
        applicant_name: str,
        outcome: str,
        application_ref: str = "",
    ) -> dict[str, str]:
        """Applicant-facing gate-1 decision email.

        outcome="advanced" → moved to jury_review; outcome="rejected" → declined.
        The rejected copy is deliberately gracious and exposes NO internal rationale.
        """
        if outcome == "advanced":
            template_base = "applicant_decision_advanced"
            subject = "Your ARTPARK application has advanced to the next round"
        else:
            template_base = "applicant_decision_rejected"
            subject = "An update on your ARTPARK application"
        html, text = self._render_pair(
            template_base,
            {"applicant_name": applicant_name or "there", "application_ref": application_ref},
        )
        return self.send_raw([to], subject, html, text)
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && python -m pytest tests/test_email_service.py -k applicant_decision -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/email_service.py backend/tests/test_email_service.py
git commit -m "feat(email): EmailService.send_applicant_decision"
```

---

### Task 5: `decision_email.notify_applicant_decided()`

**Files:**
- Create: `backend/app/services/decision_email.py`
- Test: `backend/tests/test_decision_email.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_decision_email.py`:

```python
"""notify_applicant_decided: resolves applicant email, maps decision→outcome,
best-effort send. Mirrors test_assignment_email's fake-client style."""
from __future__ import annotations

from types import SimpleNamespace

from app.services import decision_email


class _Q:
    def __init__(self, rows): self._rows = rows
    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def execute(self): return SimpleNamespace(data=self._rows)


class _SB:
    def __init__(self, rows): self._rows = rows
    def table(self, _name): return _Q(self._rows)


def test_jury_review_sends_advanced(monkeypatch):
    calls = []
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: calls.append(kw)))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])
    decision_email.notify_applicant_decided(sb, track="tir", application_id="id1", decision="jury_review")
    assert len(calls) == 1
    assert calls[0]["outcome"] == "advanced" and calls[0]["to"] == "ada@x.com"


def test_rejected_sends_rejected(monkeypatch):
    calls = []
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: calls.append(kw)))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])
    decision_email.notify_applicant_decided(sb, track="sip", application_id="id1", decision="rejected")
    assert calls and calls[0]["outcome"] == "rejected"


def test_other_decisions_send_nothing(monkeypatch):
    calls = []
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: calls.append(kw)))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])
    for d in ("shortlisted", "on_hold", "waitlisted"):
        decision_email.notify_applicant_decided(sb, track="tir", application_id="id1", decision=d)
    assert calls == []


def test_missing_email_is_swallowed(monkeypatch):
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: (_ for _ in ()).throw(AssertionError("should not send"))))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": ""}])
    # Must not raise and must not send.
    decision_email.notify_applicant_decided(sb, track="tir", application_id="id1", decision="rejected")


def test_send_failure_is_swallowed(monkeypatch):
    def boom(**_kw): raise RuntimeError("resend down")
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=boom))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])
    decision_email.notify_applicant_decided(sb, track="tir", application_id="id1", decision="rejected")  # no raise
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && python -m pytest tests/test_decision_email.py -v --no-cov`
Expected: FAIL — `ModuleNotFoundError: app.services.decision_email`.

- [ ] **Step 3: Implement the module**

Create `backend/app/services/decision_email.py`:

```python
"""Applicant-facing decision email (best-effort).

Fires when a gate-1 decision moves an application to an applicant-visible
outcome: ``rejected`` → gracious decline; ``jury_review`` → "advanced to jury".
Modeled on assignment_email.notify_reviewers_assigned — any failure is logged
and swallowed so the decision + status change always commit.
"""
from __future__ import annotations

import logging

from .email_service import get_email_service

log = logging.getLogger(__name__)

_OUTCOME = {"rejected": "rejected", "jury_review": "advanced"}


def notify_applicant_decided(sb, *, track: str, application_id: str, decision: str) -> None:
    outcome = _OUTCOME.get(decision)
    if outcome is None:
        return  # not an applicant-notifying decision
    try:
        table = f"{track}_applications"
        rows = (
            sb.table(table)
            .select("basic_full_name,basic_email")
            .eq("id", application_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            log.warning("notify_applicant_decided: app %s/%s not found", track, application_id)
            return
        email = (rows[0].get("basic_email") or "").strip()
        if not email:
            log.warning("notify_applicant_decided: no email for %s/%s", track, application_id)
            return
        name = rows[0].get("basic_full_name") or "there"
        get_email_service().send_applicant_decision(
            to=email, applicant_name=name, outcome=outcome, application_ref=application_id[:8],
        )
    except Exception:  # noqa: BLE001
        log.warning("notify_applicant_decided failed for %s/%s", track, application_id, exc_info=True)
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && python -m pytest tests/test_decision_email.py -v --no-cov`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/decision_email.py backend/tests/test_decision_email.py
git commit -m "feat(email): notify_applicant_decided best-effort sender"
```

---

### Task 6: Hook the email into `record_decision`

**Files:**
- Modify: `backend/app/services/decisions.py` (import + one call before `return`, ~line 84)
- Test: `backend/tests/test_decisions_hook.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_decisions_hook.py`:

```python
"""record_decision fires the applicant email for rejected/jury_review only,
and email failure never breaks the decision. Fake admin client captures writes."""
from __future__ import annotations

from types import SimpleNamespace

from app.services import decisions


class _Q:
    def __init__(self, parent, name): self._p, self._n = parent, name; self._mode = "select"
    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def insert(self, payload): self._p.inserts.append((self._n, payload)); return self
    def execute(self):
        if self._n.endswith("_applications"):
            return SimpleNamespace(data=[{"status": "evaluated", "basic_full_name": "Ada", "basic_email": "ada@x.com"}])
        return SimpleNamespace(data=[])


class _SB:
    def __init__(self): self.inserts = []
    def table(self, name): return _Q(self, name)


def _patch(monkeypatch):
    sb = _SB()
    monkeypatch.setattr(decisions, "get_admin_client", lambda: sb)
    monkeypatch.setattr(decisions.state_machine, "apply_status_change", lambda *a, **k: None)
    monkeypatch.setattr(decisions, "write_audit", lambda **k: None)
    calls = []
    monkeypatch.setattr(decisions.decision_email, "notify_applicant_decided",
        lambda _sb, **kw: calls.append(kw))
    return sb, calls


def test_jury_review_triggers_advanced_notify(monkeypatch):
    _sb, calls = _patch(monkeypatch)
    decisions.record_decision(track="tir", application_id="id1", decision="jury_review",
                              rationale=None, decided_by="u1")
    assert calls == [{"track": "tir", "application_id": "id1", "decision": "jury_review"}]


def test_on_hold_does_not_notify(monkeypatch):
    _sb, calls = _patch(monkeypatch)
    decisions.record_decision(track="tir", application_id="id1", decision="on_hold",
                              rationale="x", decided_by="u1")
    assert calls == []


def test_email_failure_does_not_break_decision(monkeypatch):
    _sb, _calls = _patch(monkeypatch)
    monkeypatch.setattr(decisions.decision_email, "notify_applicant_decided",
        lambda _sb, **kw: (_ for _ in ()).throw(RuntimeError("boom")))
    # notify_applicant_decided is best-effort internally, but guard here too:
    out = decisions.record_decision(track="tir", application_id="id1", decision="rejected",
                                    rationale="no", decided_by="u1")
    assert out["decision"] == "rejected"
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && python -m pytest tests/test_decisions_hook.py -v --no-cov`
Expected: FAIL — `AttributeError: module 'app.services.decisions' has no attribute 'decision_email'`.

- [ ] **Step 3: Add import + call**

In `backend/app/services/decisions.py`, add to the imports (after line 31 `from .audit import write_audit`):

```python
from . import decision_email
```

Then in `record_decision`, between the audit block (ends line 83) and the `return` (line 84), insert:

```python
    # 5. Best-effort applicant notification (rejected / jury_review only).
    #    Swallows its own errors; guard again so a notify bug can't break the decision.
    try:
        decision_email.notify_applicant_decided(
            sb, track=track, application_id=application_id, decision=decision,
        )
    except Exception:  # noqa: BLE001
        pass
```

(`record_decision_safe` calls `record_decision`, so bulk + leadership paths are covered automatically.)

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && python -m pytest tests/test_decisions_hook.py -v --no-cov`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/decisions.py backend/tests/test_decisions_hook.py
git commit -m "feat(decisions): email applicant on reject/approve (all decision paths)"
```

---

### Task 7: Accept `jury_review` in the decision endpoints

**Files:**
- Modify: `backend/app/routers/admin_platform.py` (`DecisionBody` + `BulkDecisionItem` Literals, ~lines 97 & 128)
- Test: `backend/tests/test_admin_platform.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_admin_platform.py` (reuse the file's existing fake-client + `get_current_user` override + `client` fixture; model on the existing decision test):

```python
def test_decision_accepts_jury_review(client_admin):
    # client_admin = TestClient with an admin user override (see existing decision tests).
    r = client_admin.post(
        "/admin/platform/applications/tir/APP_EVALUATED/decision",
        json={"decision": "jury_review"},
    )
    # 200 (decided) — NOT 422 (invalid enum). Exact body depends on the fake; assert not-422.
    assert r.status_code != 422, r.text
```

> If the existing tests use a different fixture name than `client_admin`, match it. The key assertion: `decision="jury_review"` is no longer rejected by the Literal (was 422), and needs no rationale.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && python -m pytest tests/test_admin_platform.py -k jury_review -v --no-cov`
Expected: FAIL — 422 (`jury_review` not a permitted Literal value).

- [ ] **Step 3: Extend both Literals**

In `backend/app/routers/admin_platform.py`, in `DecisionBody` and `BulkDecisionItem`, change:

```python
    decision: Literal["shortlisted", "on_hold", "rejected", "waitlisted", "jury_review"]
```

(Leave the rationale-required check unchanged — it lists `rejected/waitlisted/on_hold`, so `jury_review` correctly requires no rationale.)

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && python -m pytest tests/test_admin_platform.py -k jury_review -v --no-cov`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/admin_platform.py backend/tests/test_admin_platform.py
git commit -m "feat(admin): accept jury_review decision in decide endpoints"
```

---

### Task 8: `stats.py` — count + label `jury_review`

**Files:**
- Modify: `backend/app/services/stats.py` (lines 39–68)

- [ ] **Step 1: Add `jury_review` to the three constants**

In `backend/app/services/stats.py`:

In `PHASE_1_STATUSES`, add after the `("shortlisted", "Shortlisted"),` line (44):

```python
    ("jury_review",  "Jury review"),
```

In `FUNNEL_BUCKETS`, change the `"advanced"` line (63):

```python
    "advanced":   ["shortlisted", "interview", "jury_review"],
```

Change `ADVANCED_PAST_REVIEW` (68):

```python
ADVANCED_PAST_REVIEW: list[str] = ["shortlisted", "interview", "jury_review", "offered", "onboarded"]
```

- [ ] **Step 2: Run leadership/stats tests — expect PASS (no regressions)**

Run: `cd backend && python -m pytest tests/test_leadership_reads.py -v --no-cov`
Expected: PASS (label/funnel constants still consistent; `jury_review` now present).

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/stats.py
git commit -m "feat(stats): count + label jury_review (leadership funnel)"
```

---

## TASK GROUP B — Frontend

### Task 9: Data adapter — approve→jury_review + render jury_review

**Files:**
- Modify: `frontend/src/lib/adminDataAdapter.js` (lines 1–18)

- [ ] **Step 1: Edit the three maps + flagColor**

In `frontend/src/lib/adminDataAdapter.js`:

`STATUS_TO_CHIP` — add `jury_review` (line ~3, after `shortlisted`):

```js
  evaluated: "EVALUATED", shortlisted: "SHORTLISTED", jury_review: "JURY REVIEW", interview: "JURY REVIEW",
```

`DECISION_TO_ADMIN` — add `jury_review` (line ~8):

```js
export const DECISION_TO_ADMIN = {
  shortlisted: "APPROVED", jury_review: "APPROVED", on_hold: "HOLD", rejected: "REJECTED", waitlisted: "WAITLISTED",
};
```

`BUTTON_TO_DECISION` — remap `approve` (line ~11):

```js
export const BUTTON_TO_DECISION = {
  approve: "jury_review", hold: "on_hold", reject: "rejected", waitlist: "waitlisted",
};
```

`flagColor` — treat `jury_review` as advanced (line ~15):

```js
  if (["shortlisted", "interview", "jury_review", "offered", "onboarded"].includes(status)) return "darkgreen";
```

- [ ] **Step 2: Verify AdminPipeline chip round-trip handles "JURY REVIEW" → jury_review**

Run: `grep -n "'JURY REVIEW'" frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`
For each reverse map that converts the chip string back to a status (e.g. `'JURY REVIEW': 'interview'`), change the target to `'jury_review'`. (`interview` is unreachable in practice, so pointing the chip at `jury_review` is safe and keeps status filters correct for approved apps.)

- [ ] **Step 3: Run adapter/pipeline tests + build**

Run: `cd frontend && npx jest adminDataAdapter src/pages/admin/platform/__tests__/AdminPipeline 2>/dev/null; npm run build`
Expected: tests pass (update any assertion that hard-codes `approve→shortlisted`); build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/adminDataAdapter.js frontend/src/pages/admin/platform/screens/AdminPipeline.jsx
git commit -m "feat(admin-ui): approve advances to jury_review; render jury_review chip"
```

---

### Task 10: Leadership statusBuckets — add `jury_review`

**Files:**
- Modify: `frontend/src/pages/leadership/components/statusBuckets.js`

- [ ] **Step 1: Add the bucket**

In `STATUS_BUCKET`, add after `shortlisted: "advance",`:

```js
  jury_review:  "advance",
```

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/leadership/components/statusBuckets.js
git commit -m "feat(leadership): bucket jury_review as advance for status chip"
```

---

### Task 11: Remove the admin status-breakdown card

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminDashboard.jsx`

- [ ] **Step 1: Delete the `StatusBreakdown` component**

Remove the entire `function StatusBreakdown({ go, statusCounts }) { ... }` definition (~lines 137–172).

- [ ] **Step 2: Delete its render block**

Remove the `{/* Status breakdown */}` card `<div>` that contains the "§ Status breakdown" eyebrow, the "Where every application sits right now" `<h2>`, the "Click a status…" line, and `<StatusBreakdown go={go} statusCounts={statusCounts} />` (~lines 346–356).

- [ ] **Step 3: Remove the now-unused `statusCounts` derivation**

Remove the line `const statusCounts = data?.statusCounts || [];` (~line 203). (Confirm with `grep -n "statusCounts" frontend/src/pages/admin/platform/screens/AdminDashboard.jsx` — there should be no remaining references after the card is gone.)

- [ ] **Step 4: Update tests + build**

Run: `cd frontend && npx jest src/pages/admin/platform/__tests__/AdminDashboard 2>/dev/null; npm run build`
Expected: build passes. Update `AdminDashboard.test.jsx` — remove/adjust any assertion that expects "Status breakdown" / "Where every application sits right now"; add an assertion that the text is absent.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminDashboard.jsx frontend/src/pages/admin/platform/__tests__/AdminDashboard.test.jsx
git commit -m "feat(admin-ui): remove status-breakdown card from dashboard"
```

---

### Task 12: Remove the HOME button + left-align brand

**Files:**
- Modify: `frontend/src/pages/admin/platform/AdminPortal.jsx` (line 80)
- Modify: `frontend/src/styles/admin-portal.css` (lines 1893–1914)

- [ ] **Step 1: Remove the HOME button JSX**

In `AdminPortal.jsx`, delete line 80:

```jsx
      <button className="lp-home-btn" onClick={() => { setPage('dashboard'); }}>← HOME</button>
```

(The `<div className="lp-brand">…</div>` becomes the first child of `.lp-topbar`, so the logo shifts left into the freed space.)

- [ ] **Step 2: Remove the dead HOME-btn CSS**

In `admin-portal.css`, delete the `.adm-portal .lp-home-btn { … }` rule (1893–1910) and the `.adm-portal .lp-home-btn:hover { … }` rule (1911–1914).

- [ ] **Step 3: Tighten left padding for a clean look**

In the `.adm-portal .lp-topbar` rule (1883), change `padding: 0 28px;` to `padding: 0 20px;` so the brand sits a touch further left.

- [ ] **Step 4: Build + visual sanity**

Run: `cd frontend && npm run build`
Expected: success. (Visual confirmation happens in Task 20.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/AdminPortal.jsx frontend/src/styles/admin-portal.css
git commit -m "feat(admin-ui): remove HOME button, left-align brand in top bar"
```

---

### Task 13: Pipeline bulk bar → Reject + Assign batch only

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx` (buttons ~1237–1240; handlers ~412–415)

- [ ] **Step 1: Remove three bulk buttons**

Delete these three lines (keep the `Reject` button on line 1239 and everything from line 1241 onward — the jury/batch select branch):

```jsx
          <button className="os-floating-btn" disabled={busy} onClick={handleBulkHold}>Hold</button>
          <button className="os-floating-btn primary" disabled={busy} onClick={handleBulkNextLevel}>Send to Next Level</button>
          <button className="os-floating-btn" disabled={busy} onClick={handleBulkArchive}>Archive</button>
```

- [ ] **Step 2: Remove the dead handlers**

Delete lines 412, 413, 415:

```jsx
  const handleBulkHold = () => runBulkDecision('on_hold', 'Hold', true);
  const handleBulkNextLevel = () => runBulkDecision('shortlisted', 'Send to Next Level', false);
  const handleBulkArchive = () => runBulkMeta({ is_archived: true }, 'Archive');
```

Keep `const handleBulkReject = () => runBulkDecision('rejected', 'Reject', true);` (line 414).

- [ ] **Step 3: Remove `runBulkMeta` if now unused**

Run: `grep -n "runBulkMeta" frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`
If `handleBulkArchive` was its only caller (no other references remain), delete the `runBulkMeta` definition too. If other callers exist, leave it.

- [ ] **Step 4: Update tests + build**

Run: `cd frontend && npx jest src/pages/admin/platform/__tests__/AdminPipeline 2>/dev/null; npm run build`
Expected: build passes. Update any assertion referencing "Hold" / "Send to Next Level" / "Archive" in the bulk bar; add an assertion they're absent and "Reject" + "Assign batch" remain.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminPipeline.jsx frontend/src/pages/admin/platform/__tests__/
git commit -m "feat(admin-ui): pipeline bulk bar keeps only Reject + Assign batch"
```

---

### Task 14: Gate-1 decision panel → Approve + Reject

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminGate1.jsx` (lines 324–331)

- [ ] **Step 1: Remove the Waitlist button + fix placeholder**

In the `.os-reco-group` block, delete the Waitlist button (line 325):

```jsx
              <button className={"os-reco-btn waitlist " + (decisions[s.id] === "waitlist" ? "active" : "")} disabled={busy} onClick={() => decide("waitlist")}>Waitlist</button>
```

Change the textarea placeholder (line 331) to:

```jsx
              placeholder="Decision rationale (required for reject)…"
```

- [ ] **Step 2: Update tests + build**

Run: `cd frontend && npx jest src/pages/admin/platform/__tests__/AdminGate1Review 2>/dev/null; npm run build`
Expected: build passes. Update any assertion expecting a "Waitlist" button here; add absence assertion.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminGate1.jsx frontend/src/pages/admin/platform/__tests__/
git commit -m "feat(admin-ui): Gate-1 decision panel keeps only Approve + Reject"
```

---

### Task 15: Detail decide grid → Approve + Reject + jury caption

**Files:**
- Modify: `frontend/src/pages/admin/platform/screens/AdminDetail.jsx` (lines 707–739)

- [ ] **Step 1: Reduce the decision button array to Approve + Reject**

Replace the array (lines 707–712) so only approve + reject remain:

```jsx
              {[
                { id: 'approve', label: 'Approve', activeStyle: { background: '#3213b7', color: '#fff', borderColor: '#3213b7' } },
                { id: 'reject',  label: 'Reject',  activeStyle: {} },
              ].map(btn => (
```

- [ ] **Step 2: Replace the caption**

Replace the caption block (lines 725–729) with a single jury-advancement line:

```jsx
            <div className="os-mt-sm" style={{ fontSize: 12, color: '#6f6f78', fontStyle: 'italic' }}>
              Approval advances the application to the jury evaluation round.
            </div>
```

- [ ] **Step 3: Fix the placeholder (only reject needs a rationale)**

Replace the placeholder expression (lines 735–738) with:

```jsx
              placeholder={
                decision === 'reject'
                  ? 'Rationale (required for reject)…'
                  : 'Rationale (optional for approve)…'
              }
```

- [ ] **Step 4: Verify the submit path maps via BUTTON_TO_DECISION**

Run: `grep -n "BUTTON_TO_DECISION\|decision\b" frontend/src/pages/admin/platform/screens/AdminDetail.jsx | head`
Confirm the decision submit uses `BUTTON_TO_DECISION[decision]` (so `approve → jury_review`). If AdminDetail has its own inline map, update `approve` there to `jury_review`.

- [ ] **Step 5: Update tests + build**

Run: `cd frontend && npx jest src/pages/admin/platform/__tests__/AdminApplicationDetail 2>/dev/null; npm run build`
Expected: build passes. Update assertions referencing Hold/Waitlist or the psychometry caption.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/platform/screens/AdminDetail.jsx frontend/src/pages/admin/platform/__tests__/
git commit -m "feat(admin-ui): detail decide grid keeps Approve + Reject, jury caption"
```

---

## TASK GROUP C — Verify, ship, smoke test

### Task 16: Full suite + merge to release

**Files:** none (validation + merge)

- [ ] **Step 1: Backend full suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS (or only the pre-existing known failures recorded in repo notes — no NEW failures).

- [ ] **Step 2: Frontend full suite + build**

Run: `cd frontend && npx jest && npm run build`
Expected: all green, build clean.

- [ ] **Step 3: Merge feature branch into `release/sip-launch-v1`**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
git fetch && git merge --no-ff feat/admin-decision-emails -m "merge: admin decision emails + UI cleanup"
```

- [ ] **Step 4: STOP — do not push or deploy yet.** Report status to the user; proceed to Tasks 17–20 with the user in the loop.

---

### Task 17: Apply migration 027 to prod Supabase

**Files:** `backend/migrations/027_jury_review_decision.sql`

- [ ] **Step 1: Apply the SQL to the PROD Supabase project** (prod project ref per `project_artpark_tir_structure` memory) via the Supabase SQL editor — paste the contents of `027_jury_review_decision.sql`. (This is a plain `public.admin_decisions` constraint swap — not subject to the `auth.users` trigger ownership gotcha.)

- [ ] **Step 2: Verify**

Run (Supabase SQL editor):
```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'admin_decisions_decision_check';
```
Expected: the CHECK now includes `'jury_review'`.

---

### Task 18: Deploy backend to prod (SAM)

**Files:** none (deploy)

- [ ] **Step 1: Pick a deploy worktree and VERIFY intake flags are CLOSED**

The deploy reads `backend/` from disk and uses that worktree's `.env.prod`. Use a worktree whose `.env.prod` has both flags true (per the intake-reopen footgun). Run:
```bash
grep -iE "SUBMISSIONS_CLOSED" <deploy-worktree>/backend/.env.prod
```
Expected: `TIR_SUBMISSIONS_CLOSED=true` AND `SIP_SUBMISSIONS_CLOSED=true`. If not both true — STOP, fix the env, do not deploy.

- [ ] **Step 2: Ensure that worktree is at the merged `release/sip-launch-v1` tip** (so it ships the new code), confirm `git log --oneline -1` shows the merge commit.

- [ ] **Step 3: Deploy**

Locate the prod deploy command (check `samconfig.toml` / any `Makefile` / deploy script in `backend/` or `infra/`). Run the standard prod SAM build + deploy (e.g. `sam build && sam deploy --config-env production` — confirm exact env name from `samconfig.toml`).

- [ ] **Step 4: Smoke the deploy**

Run: `curl -s https://api.artpark.info/health` (or the project's health path).
Expected: healthy. Confirm intake is still CLOSED (try the closed-intake signal you normally check).

---

### Task 19: Production smoke test (existing test app, email → Gmail)

**Files:** optional `backend/scripts/smoke_decision_email.py` (operational, not committed unless useful)

> Runs the SAME `record_decision` path the endpoint uses, against prod, with prod env loaded. No real applicant is touched — only the one evaluated test app, with its email swapped to the Gmail and restored afterward.

- [ ] **Step 1: Identify the test app + capture originals**

Find the single evaluated test app ("Cognitive Warfare AI") via the prod admin client: its `track`, `id`, current `status`, and current `basic_email`. Save these to a scratch file (`scratchpad/smoke_restore.json`).

- [ ] **Step 2: Set its email to the Gmail**

Update `{track}_applications.basic_email = 'udayanpawar03@gmail.com'` for that id (prod admin client).

- [ ] **Step 3: Trigger APPROVE**

Invoke `decisions.record_decision(track=…, application_id=…, decision="jury_review", rationale=None, decided_by=<an admin user_id>)` against prod (script with prod `.env.prod` loaded).
Expected: returns `{decision: "jury_review", from_status: "evaluated", …}`; an `applicant_decision_advanced` email is sent (Resend returns a message_id; CloudWatch shows the send). **Verify** status now reads "Jury review" on the admin pipeline AND leadership list/chip. **Ask the user to confirm** the "advanced" email arrived at udayanpawar03@gmail.com.

- [ ] **Step 4: Trigger REJECT**

Invoke `record_decision(..., decision="rejected", rationale="smoke test")` (legal from `jury_review`).
Expected: status → `rejected`; `applicant_decision_rejected` email sent. **Verify** status reads "Not selected/Rejected" on admin + leadership. **Ask the user to confirm** the rejection email arrived.

- [ ] **Step 5: RESTORE**

Using `scratchpad/smoke_restore.json`: set `basic_email` back to the original, set `status` back to the original (`evaluated`), and delete the two `admin_decisions` rows + two `application_status_log` rows created during the smoke test (filter by this app id + the smoke timestamps). Confirm the app looks exactly as before.

- [ ] **Step 6: Report results to the user** (status transitions observed, email message_ids, inbox confirmations).

---

### Task 20: Frontend promote + visual QA (user-driven)

**Files:** none

- [ ] **Step 1: Push `release/sip-launch-v1`**

```bash
cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1
git push origin release/sip-launch-v1
```

- [ ] **Step 2: USER performs Vercel Promote-to-Production** on the resulting build.

- [ ] **Step 3: Visual QA on prod** (after promote): admin dashboard has no status-breakdown card; top bar has no HOME button and the logo sits cleanly to the left; pipeline bulk bar shows only Reject + Assign batch; Gate-1 + detail decision panels show only Approve + Reject; an approved app shows "Jury review" on admin + leadership. Use the browse/QA tooling against `apply.artpark.info` (admin login required).

---

## Self-Review

**Spec coverage:** §3.1 dashboard cleanup → Tasks 11,12. §3.2 bulk bar → Task 13. §3.3 decision panels → Tasks 14,15 (+9 for the wire remap). §3.4 jury_review display → Tasks 9,10,8. §3.5 emails → Tasks 3,4,5,6. §3.6 backend plumbing → Tasks 1,2,7. §6 testing → per-task TDD + Tasks 16,19. §7 delivery → Tasks 16–20. All covered.

**Placeholder scan:** No TBD/TODO; every code step has concrete code. Operational steps (deploy command, test-app id) name the exact discovery command/source rather than hand-waving.

**Type/name consistency:** `notify_applicant_decided(sb, *, track, application_id, decision)` and `send_applicant_decision(*, to, applicant_name, outcome, application_ref)` and `outcome ∈ {"advanced","rejected"}` are used identically across Tasks 4, 5, 6 and their tests. `BUTTON_TO_DECISION.approve = "jury_review"` consistent across Tasks 9, 15. Migration constraint name `admin_decisions_decision_check` consistent across Tasks 2, 17.
