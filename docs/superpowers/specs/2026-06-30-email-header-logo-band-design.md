# Design — Transactional email header: ARTPARK+IISc logo + colour-locked violet band

**Date:** 2026-06-30
**Status:** Approved (Variant A); pending user spec review → implement → deploy
**Surface:** Shared email shell `backend/app/templates/email/base.html` → propagates to ALL transactional emails
**Prod:** API `artpark-eir-api-production` (ap-south-1) + the DailyDigest/ReviewerReminder Lambdas (share the backend package)

---

## 1. Problem

Two changes to **every** transactional email (applicant accept/reject, reviewer invite, reviewer reminder, reviewer assigned, admin daily digest, role granted, submission confirmation, support/ticket):

1. **Violet band renders a different colour on mobile than on laptop.** Want one consistent `#3213b7` everywhere.
2. **Add the ARTPARK + IISc logo**, presentably (not pasted onto the violet).

All 11 templates `{% extends "base.html" %}`, so both changes live in **one file**.

## 2. Root cause

- **Band colour:** `base.html:14` sets the band via `style="background:#3213b7"` only — no `bgcolor` attribute and no `color-scheme` meta. Mobile dark-mode clients (Gmail app, iOS Mail) auto-shift/darken unlocked background colours, so the band drifts off-brand on phones.
- **Logo:** the header shows a *text* "ARTPARK" wordmark (`base.html:15`), no image. The combined lockup exists only as `frontend/public/assets/artpark-iisc-logo.webp` (1500×300, transparent) — and **webp is not reliably rendered by email clients** (Outlook etc.).

## 3. Decision — Variant A (approved from rendered mockup)

**Header becomes two rows:**
1. **White logo strip** — the ARTPARK+IISc logo (PNG, transparent) centred on white, ~270px wide, scales down on mobile.
2. **Slim colour-locked violet band** — carries only the context label `IISc Bengaluru{header_sublabel}` (e.g. "· Reviewer invitation"). The redundant white "ARTPARK" wordmark is removed (the logo carries it).

The logo is colour-on-transparent → it needs white, hence the white strip above the band (not on the violet).

### 3.1 Colour-lock (mobile = laptop)
- Add to `<head>`: `<meta name="color-scheme" content="light only">` and `<meta name="supported-color-schemes" content="light only">`.
- On the band `<td>`: add `bgcolor="#3213b7"` **and** keep inline `background-color:#3213b7` (belt-and-suspenders; `bgcolor` is the bulletproof fallback for clients that drop inline CSS).

### 3.2 Logo asset + hosting
- Convert `artpark-iisc-logo.webp` → PNG, resized to ~**600×120** (2× the ~270px display width; smaller file than the 1500px original, sharp on retina). Keep transparency.
- **Host on Supabase public storage** (bucket e.g. `email-assets`), giving a stable `https://xtmszlpwgbyoumalgbhs.supabase.co/storage/v1/object/public/email-assets/artpark-iisc-logo.png`.
  - *Chosen over the frontend `apply.artpark.info/assets/…` path on purpose:* a frontend asset would only go live on a Vercel deploy/promote (done manually, possibly delayed) — coupling email correctness to that risks a broken-image window. Supabase storage is live the instant we upload, independent of any deploy. (A copy can also be committed to `frontend/public/assets/` for portal reuse, but the email references the Supabase URL.)
- Reference via `<img src="<url>" width="270" height="54" alt="ARTPARK — AI & Robotics Technology Park @ IISc" style="display:block;margin:0 auto;width:270px;max-width:72%;height:auto;border:0;">`. `alt` text means the brand still reads if a client blocks images (and the violet band + footer remain brand-bearing regardless).

### 3.3 Scope of effect
Single edit to `base.html`. The `{% block header_sublabel %}` is preserved (reviewer_invite/assigned/reminder/daily_digest define it; others fall back to plain "IISc Bengaluru"). No per-template edits needed.

## 4. Tests
- `backend/tests/test_email_brand.py` existing asserts **stay green** without edits: `"#3213b7"` still present (band), `"ARTPARK"` still present (now via the logo `alt` text + the footer "ARTPARK at IISc" rather than the removed in-band wordmark), `artpark.in` footer unchanged, old beige `#f4f1ea` still absent. **Add** positive assertions for the new elements: the logo `<img src=…>` is present, `bgcolor="#3213b7"` on the band, and the `color-scheme`/`supported-color-schemes` metas in `<head>`.
- Run the email suite: `test_email_brand`, `test_email_service`, `test_assignment_email`, `test_decision_email`, `test_daily_digest`, `test_reviewer_reminder` (all render through the shell) — expect all green.

## 5. Runbook
1. Build the email PNG (600×120) from the webp; verify transparency.
2. Create/confirm a **public** Supabase bucket; upload the PNG; **curl the public URL → expect HTTP 200 image** before touching templates.
3. Edit `base.html`: head metas; replace the single band `<td>` with white-logo-strip row + slim band row (`bgcolor` + inline bg); drop the wordmark `<div>`.
4. Update `test_email_brand.py`; run the email test suite (green).
5. Render-check locally (reuse `scripts/send_test_emails.py` render path) — confirm no Jinja errors and the logo URL is in the HTML.
6. **SAM deploy** from the release worktree. ⚠️ Confirm `backend/.env.prod` has `TIR_SUBMISSIONS_CLOSED=true` and `SIP_SUBMISSIONS_CLOSED=true` before deploy (per-worktree `.env`; a stale one reopens intake). `sam build` reads `backend/` from disk — deploy from the correct worktree/HEAD.
7. Send a **real test email to `dev@artpark.in`** (reviewer-invite + an applicant-decision sample) via `scripts/send_test_emails.py`. User verifies colour + logo on **actual phone + laptop**.
8. On confirmation: commit + push `base.html` + test + (optional) the committed PNG to `origin/release/sip-launch-v1`.

## 6. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Broken-image if logo URL not public/live | Step 2 curls the URL (HTTP 200) before deploy; Supabase upload is immediate |
| webp unsupported in email clients | Ship PNG (step 1) |
| Mobile dark-mode still shifts band | `bgcolor` attr + `color-scheme: light only` metas + inline bg (3-layer lock); verified via real test email on phone (step 7) |
| `test_email_brand` assertions | Existing asserts stay green ("ARTPARK" survives via logo `alt` + footer); add positive asserts for logo/`bgcolor`/metas (step 4) |
| Wrong-worktree/stale-env SAM deploy reopens intake | Step 6 verifies both intake flags true before deploy |
| Images-off clients show nothing | `alt` text + band/footer remain brand-bearing |

## 7. Out of scope
Email *body* redesigns; new colours/type; changing which events send mail; the frontend portal logo (already `.webp`, unaffected).
